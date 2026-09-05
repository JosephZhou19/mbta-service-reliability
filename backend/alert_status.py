#!/usr/bin/env python3
"""Turn ingested MBTA service alerts (data/alerts.parquet) into a day-by-day service
status per line: which alert effect (if any) was in effect that day, and why.

MBTA's own alerts are a direct, authoritative account of what happened, unlike
inferring from indirect signals (a missing published stop, a collapsed observation
count) with no explanation attached.

Two filters decide which alerts are eligible to set a day's status:

1. EXCLUDED_EFFECTS: ACCESSIBILITY_ISSUE (overwhelmingly single-elevator/escalator
   outages, not train service) and ADDITIONAL_SERVICE (extra service, not a
   disruption) -- excluded regardless of duration.

2. MIN_DURATION_HOURS: every remaining effect type has a sharp bimodal split in alert
   duration -- single-incident alerts cluster at 2-6 hours, planned/major disruptions
   jump straight to 14-48+ hours, with almost nothing in between. This matters most
   for OTHER_EFFECT (MBTA rarely uses SIGNIFICANT_DELAYS, so real delay incidents
   mostly land here, but 98% of it is a single disabled-train incident under 6 hours).
   A 12-hour cutoff sits cleanly in every category's gap.

EFFECT_PRECEDENCE decides which alert wins a day's color when more than one eligible
alert applies at once, ordered most-service-affecting first.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent
ALERTS_PATH = ROOT / "data" / "alerts.parquet"

EXCLUDED_EFFECTS = {"ACCESSIBILITY_ISSUE", "ADDITIONAL_SERVICE"}
MIN_DURATION_HOURS = 12

# A long-duration alert mentioning a parking lot or garage, but naming no line, is pure
# facility noise, not a train-service issue (e.g. "Wollaston Parking Lot is partially
# closed..." vs. "Orange Line: Service will bypass Haymarket... due to Garage
# demolition"). Not a blanket "must name a line" rule: real station-level closures
# often name only the station ("Bowdoin station is closed..."), which that would
# wrongly exclude.
FACILITY_PATTERN = r"parking|garage"
LINE_NAME_PATTERN = r"Orange Line|Red Line|Blue Line|Green Line|Mattapan"

EFFECT_PRECEDENCE = [
    "NO_SERVICE",
    "REDUCED_SERVICE",
    "SIGNIFICANT_DELAYS",
    "MODIFIED_SERVICE",
    "DETOUR",
    "STOP_MOVED",
    "OTHER_EFFECT",
    "UNKNOWN_EFFECT",
]


def load_alerts() -> pd.DataFrame:
    df = pd.read_parquet(ALERTS_PATH)
    df["start"] = pd.to_datetime(df["start"]).dt.tz_localize(None)
    df["end"] = pd.to_datetime(df["end"]).dt.tz_localize(None)
    return df


def eligible_alerts(alerts: pd.DataFrame) -> pd.DataFrame:
    """Alerts allowed to set a day's status: transport-relevant effect type, long
    enough to represent more than a short-lived incident, and not pure parking/garage
    facility noise. See module docstring for each filter's rationale."""
    duration_hours = (alerts["end"] - alerts["start"]).dt.total_seconds() / 3600
    long_enough = duration_hours >= MIN_DURATION_HOURS
    right_effect = ~alerts["effect"].isin(EXCLUDED_EFFECTS)
    mentions_facility = alerts["header"].str.contains(FACILITY_PATTERN, case=False, na=False)
    # Only a line mention in the opening clause counts: a line named later is usually
    # just a reason clause ("...to allow equipment to stage for Red Line track work"),
    # not a real service impact naming the line up front.
    mentions_line_early = alerts["header"].str.slice(0, 50).str.contains(LINE_NAME_PATTERN, case=False, na=False)
    pure_facility_noise = mentions_facility & ~mentions_line_early
    return alerts[right_effect & long_enough & ~pure_facility_noise]


def daily_status(alerts: pd.DataFrame, line: str, date_range: pd.DatetimeIndex) -> pd.DataFrame:
    """One row per date in date_range: the winning effect (None if no eligible alert
    applied) and its explanatory header text, for `line` with both directions combined
    -- a direction-specific alert (e.g. "suspended between X and Y" on one branch)
    still marks the whole line's day, since the calendar is a per-line, not
    per-direction, view."""
    line_alerts = eligible_alerts(alerts[alerts["route_id"] == line])
    rows = []
    for date in date_range:
        day_end = date + pd.Timedelta(days=1)
        active = line_alerts[(line_alerts["start"] < day_end) & (line_alerts["end"] > date)]
        if active.empty:
            rows.append({"date": date, "effect": None, "reason": None})
            continue
        for effect in EFFECT_PRECEDENCE:
            match = active[active["effect"] == effect]
            if match.empty:
                continue
            # When several alerts share the winning effect on the same day, use the
            # longest-running one as the representative explanation.
            best = match.assign(_dur=match["end"] - match["start"]).sort_values("_dur", ascending=False).iloc[0]
            rows.append({"date": date, "effect": effect, "reason": best["header"]})
            break
        else:
            # Effect outside EFFECT_PRECEDENCE -- shouldn't happen, but don't drop it.
            best = active.iloc[0]
            rows.append({"date": date, "effect": best["effect"], "reason": best["header"]})
    return pd.DataFrame(rows)


def status_ranges(daily: pd.DataFrame) -> list[dict]:
    """Contiguous same-effect runs of days, collapsing across whichever specific
    alerts contributed within each run (using the longest/most descriptive header
    text seen as the run's representative reason)."""
    d = daily.reset_index(drop=True).copy()
    d["run"] = (d["effect"] != d["effect"].shift()).cumsum()
    ranges = []
    for _, g in d.groupby("run"):
        effect = g["effect"].iloc[0]
        # pandas' string dtype surfaces a missing entry as float NaN, not the Python
        # None it was assigned as -- pd.isna() catches both.
        if pd.isna(effect):
            continue
        reasons = [r for r in g["reason"].unique() if pd.notna(r)]
        reason = max(reasons, key=len) if reasons else None
        ranges.append({
            "start": g["date"].iloc[0].strftime("%Y-%m-%d"),
            "end": g["date"].iloc[-1].strftime("%Y-%m-%d"),
            "days": len(g),
            "effect": effect,
            "reason": reason,
        })
    return ranges


def main() -> None:
    print("Loading alerts...", file=sys.stderr)
    alerts = load_alerts()
    lines = ["Red", "Orange", "Blue", "Green-B", "Green-C", "Green-D", "Green-E", "Mattapan"]
    date_range = pd.date_range("2025-09-01", "2026-09-05", freq="D")  # recent window for a quick look

    for line in lines:
        daily = daily_status(alerts, line, date_range)
        ranges = status_ranges(daily)
        print(f"\n{line}: {len(ranges)} status period(s)")
        for r in ranges[:15]:
            print(f"  {r['start']} to {r['end']} ({r['days']}d) [{r['effect']}] {r['reason'][:90] if r['reason'] else ''}")


if __name__ == "__main__":
    main()
