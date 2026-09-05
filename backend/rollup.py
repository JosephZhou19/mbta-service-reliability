#!/usr/bin/env python3
"""Roll up per-day delay summaries and schedule footprints into the JSON the
frontend will read.

Produces:

  data/rollup/overview.json
      One entry per line, blended across direction and hour. Trailing-30-day
      delay (p50/p90), a guesstimated typical/p90 actual trip time, the
      trailing-365-day % of days with no active service-affecting alert, and
      a 30-day daily delay trend for sparklines.

  data/rollup/lines/{line}.json
      One file per line, trailing 365 days, NOT blended across direction --
      daily delay (p50/p90) split by direction, plus the line's alert-derived
      status ranges (see alert_status.py's module docstring) over that same
      window: contiguous date ranges each tagged with the winning MBTA alert
      effect type and a representative explanation.

Written to frontend/public/data -- not committed (see frontend/.gitignore),
fully regenerable from data/daily/ and data/alerts.parquet. The frontend dev
server and build both read straight from there.

Blending across hours/directions to get one "current" percentile per line is
an approximation, not an exact combined percentile -- the daily summaries
don't retain raw values, so this uses a size-weighted average (weight = n)
instead.

Usage:
    python backend/rollup.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import fsspec
import pandas as pd
import pyarrow.dataset as ds

import alert_status
import lamp_ingest

ROOT = Path(__file__).resolve().parent
DAILY_DIR = ROOT / "data" / "daily"
OUTPUT_DIR = ROOT.parent / "frontend" / "public" / "data"

STATIC_STOP_TIMES_URL = "https://performancedata.mbta.com/lamp/tableau/rail/LAMP_static_stop_times.parquet"
HTTP_FS = fsspec.filesystem("https")

TRAILING_WINDOW_DAYS = 30
LINE_DETAIL_WINDOW_DAYS = 365  # a year shows real seasonal/incident patterns without
# diluting across periods nobody's comparing day-to-day against anyway.

SCHEDULE_SAMPLE_DAYS = 30  # trailing days sampled for "typical" scheduled trip length


def load_all_delay() -> pd.DataFrame:
    files = sorted(DAILY_DIR.glob("*-delay.parquet"))
    frames = [pd.read_parquet(f) for f in files]
    frames = [f for f in frames if not f.empty]
    if not frames:
        sys.exit(f"No non-empty delay files in {DAILY_DIR} — run backend/lamp_ingest.py first.")
    return pd.concat(frames, ignore_index=True)


def weighted_percentile_blend(df: pd.DataFrame, value_col: str, weight_col: str, group_cols: list[str]) -> pd.Series:
    """Size-weighted average of an already-computed percentile column across groups.
    See module docstring for why this is an approximation, not an exact combined percentile."""
    weighted = df[value_col] * df[weight_col]
    num = weighted.groupby([df[c] for c in group_cols]).sum()
    den = df[weight_col].groupby([df[c] for c in group_cols]).sum()
    return (num / den).rename(value_col)


def compute_scheduled_durations(as_of_date: pd.Timestamp) -> pd.Series:
    """Typical terminus-to-terminus SCHEDULED trip duration per line, blended across
    direction. Sampled across the trailing SCHEDULE_SAMPLE_DAYS rather than just the
    latest date, since a single day could be mid-diversion. Takes the MAX of each
    sampled day's median trip length, not the median-of-medians: a real extended
    closure can dominate a median once diverted days are the majority, but max only
    needs one normal day anywhere in the window to recover the real length.
    """
    # ensure_ref_tables, not a plain read: data/ref_cache/ is gitignored/regenerable,
    # and a fresh checkout has no cache until lamp_ingest.py populates it.
    svc_by_date_route, static_trips = lamp_ingest.ensure_ref_tables()

    sample_dates = [int((as_of_date - pd.Timedelta(days=i)).strftime("%Y%m%d")) for i in range(SCHEDULE_SAMPLE_DAYS)]
    day_svc = svc_by_date_route[svc_by_date_route.service_date.isin(sample_dates)]
    scheduled_trips = static_trips.merge(day_svc[["route_id", "service_id", "static_version_key"]], on=["route_id", "service_id", "static_version_key"]).drop_duplicates()
    scheduled_trips = scheduled_trips[~((scheduled_trips["route_id"] == "Red") & scheduled_trips["branch_route_id"].isna())].copy()
    scheduled_trips["line"] = scheduled_trips["branch_route_id"].fillna(scheduled_trips["route_id"])
    scheduled_trips = scheduled_trips.merge(
        day_svc[["route_id", "service_id", "static_version_key", "service_date"]], on=["route_id", "service_id", "static_version_key"]
    )

    version_keys = scheduled_trips["static_version_key"].unique().tolist()
    stop_times_dataset = ds.dataset(STATIC_STOP_TIMES_URL, filesystem=HTTP_FS, format="parquet")
    st = stop_times_dataset.to_table(filter=ds.field("static_version_key").isin(version_keys)).to_pandas()
    st = st.merge(scheduled_trips[["trip_id", "static_version_key", "line", "service_date"]], on=["trip_id", "static_version_key"])

    trip_span = st.groupby(["line", "service_date", "trip_id"])["arrival_time"].agg(lambda s: s.max() - s.min())
    daily_median = trip_span.groupby(["line", "service_date"]).median()
    duration = daily_median.groupby("line").max().rename("scheduled_duration_sec")
    return duration


# Alerts' informed_entity.route_id doesn't distinguish Red Line branches the way our
# LAMP-derived "line" labels do -- MBTA's alert system tracks "Red" as one route, not
# separate Ashmont/Braintree route_ids -- so both branches read from the same alert pool.
ALERT_ROUTE_FOR_LINE = {"Red-A": "Red", "Red-B": "Red"}


def compute_alert_status(delay_lines: list[str], date_range: pd.DatetimeIndex) -> tuple[pd.DataFrame, dict[str, list[dict]]]:
    """Trailing-365-day alert-derived status stats + date ranges per line, restricted
    to the lines the delay data actually reports on."""
    print("Loading service alerts...", file=sys.stderr)
    alerts = alert_status.load_alerts()

    cutoff = date_range.max() - pd.Timedelta(days=LINE_DETAIL_WINDOW_DAYS)

    rows = []
    status_ranges_by_line = {}
    for line in delay_lines:
        alert_route = ALERT_ROUTE_FOR_LINE.get(line, line)
        daily = alert_status.daily_status(alerts, alert_route, date_range)

        windowed = daily[daily["date"] > cutoff]
        total_days = len(windowed)
        normal_days = int(windowed["effect"].isna().sum())
        pct = round(100 * normal_days / total_days, 1) if total_days else None
        rows.append({"line": line, "classifiable_days": total_days, "normal_days": normal_days, "availability_pct": pct})

        clipped = [r for r in alert_status.status_ranges(daily) if pd.Timestamp(r["end"]) > cutoff]
        for r in clipped:
            r_start = max(pd.Timestamp(r["start"]), cutoff + pd.Timedelta(days=1))
            r["start"] = r_start.strftime("%Y-%m-%d")
            r["days"] = (pd.Timestamp(r["end"]) - r_start).days + 1
        status_ranges_by_line[line] = clipped

    return pd.DataFrame(rows), status_ranges_by_line


def build_overview(delay: pd.DataFrame, availability: pd.DataFrame) -> pd.DataFrame:
    max_date = pd.to_datetime(delay["service_date"]).max()
    cutoff = (max_date - pd.Timedelta(days=TRAILING_WINDOW_DAYS)).strftime("%Y-%m-%d")
    d = delay[delay["service_date"] >= cutoff].copy()

    p50 = weighted_percentile_blend(d, "delay_p50_sec", "n", ["line"])
    p90 = weighted_percentile_blend(d, "delay_p90_sec", "n", ["line"])
    delay_n = d.groupby("line")["n"].sum().rename("delay_n")

    print("Computing typical scheduled trip duration per line...", file=sys.stderr)
    scheduled_duration = compute_scheduled_durations(max_date)

    current = pd.concat([p50.round(1), p90.round(1), delay_n, scheduled_duration], axis=1).reset_index()
    current = current.rename(columns={"index": "line"})
    current["typical_trip_sec"] = (current["scheduled_duration_sec"] + current["delay_p50_sec"]).round(0)
    current["p90_trip_sec"] = (current["scheduled_duration_sec"] + current["delay_p90_sec"]).round(0)
    current = current.merge(availability, on="line", how="left")

    daily_delay = weighted_percentile_blend(d, "delay_p50_sec", "n", ["line", "service_date"]).reset_index()

    def nullable(v):
        return None if pd.isna(v) else v

    result = []
    for _, row in current.iterrows():
        trend = daily_delay[daily_delay.line == row["line"]][["service_date", "delay_p50_sec"]].round(1).to_dict(orient="records")
        result.append({
            "line": row["line"],
            "delay_p50_sec": row["delay_p50_sec"],
            "delay_p90_sec": row["delay_p90_sec"],
            "scheduled_duration_sec": nullable(row["scheduled_duration_sec"]),
            "typical_trip_sec": nullable(row["typical_trip_sec"]),
            "p90_trip_sec": nullable(row["p90_trip_sec"]),
            "n_observations": int(row["delay_n"]),
            "availability_pct_last_year": nullable(row.get("availability_pct")),
            "normal_days_last_year": nullable(row.get("normal_days")),
            "classifiable_days_last_year": nullable(row.get("classifiable_days")),
            "trend": trend,
        })
    result.sort(key=lambda r: r["line"])

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_DIR / "overview.json", "w") as f:
        json.dump({
            "generated_at": pd.Timestamp.now("UTC").isoformat(),
            "window_days": TRAILING_WINDOW_DAYS,
            "availability_window_days": LINE_DETAIL_WINDOW_DAYS,
            "as_of": max_date.strftime("%Y-%m-%d"),
            "lines": result,
        }, f, indent=2)
    print(f"Wrote {OUTPUT_DIR / 'overview.json'} ({len(result)} lines)", file=sys.stderr)
    return current


def build_line_detail(delay: pd.DataFrame, status_ranges: dict[str, list[dict]]) -> None:
    lines_dir = OUTPUT_DIR / "lines"
    lines_dir.mkdir(parents=True, exist_ok=True)

    max_date = pd.to_datetime(delay["service_date"]).max()
    cutoff = (max_date - pd.Timedelta(days=LINE_DETAIL_WINDOW_DAYS)).strftime("%Y-%m-%d")
    delay = delay[delay["service_date"] >= cutoff]

    # Daily, not weekly, resolution -- a genuine sudden delay spike should read as a
    # cliff on the chart, not get smoothed across the days around it.
    daily_delay_p50 = weighted_percentile_blend(delay, "delay_p50_sec", "n", ["line", "route_id", "direction_id", "service_date"])
    daily_delay_p90 = weighted_percentile_blend(delay, "delay_p90_sec", "n", ["line", "route_id", "direction_id", "service_date"])
    daily_delay = pd.concat([daily_delay_p50, daily_delay_p90], axis=1).reset_index()

    for line in sorted(daily_delay["line"].unique()):
        d = daily_delay[daily_delay.line == line].sort_values(["direction_id", "service_date"])
        by_direction = {}
        for dir_id, group in d.groupby("direction_id"):
            by_direction[str(bool(dir_id)).lower()] = group[
                ["service_date", "delay_p50_sec", "delay_p90_sec"]
            ].round(1).to_dict(orient="records")

        safe_name = line.replace("/", "-")
        with open(lines_dir / f"{safe_name}.json", "w") as f:
            json.dump({
                "line": line,
                "route_id": d["route_id"].iloc[0] if not d.empty else line,
                "by_direction": by_direction,
                "status_ranges": status_ranges.get(line, []),
            }, f, indent=2)

    print(f"Wrote {lines_dir} ({daily_delay['line'].nunique()} lines)", file=sys.stderr)


def main() -> None:
    print("Loading daily delay summaries...", file=sys.stderr)
    delay = load_all_delay()
    # Bare "Red" (as opposed to Red-A/Red-B) is residue from older backfilled dates
    # computed before lamp_ingest.py's unbranched-Red exclusion existed at the source;
    # never worth a full historical reprocess for a ~0.2%-of-rows fix. Real Red data
    # always resolves to Red-A or Red-B.
    delay = delay[delay["line"] != "Red"]
    delay_lines = sorted(delay["line"].unique())
    date_range = pd.date_range(pd.to_datetime(delay["service_date"]).min(), pd.to_datetime(delay["service_date"]).max(), freq="D")

    availability, status_ranges = compute_alert_status(delay_lines, date_range)
    build_overview(delay, availability)
    build_line_detail(delay, status_ranges)


if __name__ == "__main__":
    main()
