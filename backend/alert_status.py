#!/usr/bin/env python3
"""Turn ingested MBTA service alerts (data/alerts.parquet) into a day-by-day service
status per line: which alert effect (if any) was in effect that day, and why.

Replaces the earlier schedule-footprint / match-rate-collapse detection
(service_availability.py) as the source of truth for the UI's service calendar and
delay-chart shading -- MBTA's own alerts are a direct, authoritative account of what
happened and why, where the old approach could only infer that *something* happened
from indirect signals (a missing published stop, a collapsed observation count) with
no explanation attached. service_availability.py's functions are left in place, just
unused by rollup.py now.

EFFECT_PRECEDENCE decides which alert wins a day's color when more than one applies to
a line at once -- necessary because two effect types are active on MOST days for some
line, for reasons that have nothing to do with whether trains are running normally:
ACCESSIBILITY_ISSUE (16,364 of 26,667 ingested alerts -- overwhelmingly single-elevator
or single-escalator outages, unrelated to train service) and OTHER_EFFECT (8,493 --
vague/uncategorized informational blurbs). Without a precedence order, a real
multi-week NO_SERVICE closure could get outranked or averaged against noise like that.
Ordered most-service-affecting first; a day with, say, both a NO_SERVICE closure and an
unrelated elevator outage active shows as NO_SERVICE, not ACCESSIBILITY_ISSUE.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent
ALERTS_PATH = ROOT / "data" / "alerts.parquet"

EFFECT_PRECEDENCE = [
    "NO_SERVICE",
    "REDUCED_SERVICE",
    "SIGNIFICANT_DELAYS",
    "MODIFIED_SERVICE",
    "DETOUR",
    "STOP_MOVED",
    "ADDITIONAL_SERVICE",
    "ACCESSIBILITY_ISSUE",
    "OTHER_EFFECT",
    "UNKNOWN_EFFECT",
]


def load_alerts() -> pd.DataFrame:
    df = pd.read_parquet(ALERTS_PATH)
    df["start"] = pd.to_datetime(df["start"]).dt.tz_localize(None)
    df["end"] = pd.to_datetime(df["end"]).dt.tz_localize(None)
    return df


def daily_status(alerts: pd.DataFrame, line: str, date_range: pd.DatetimeIndex) -> pd.DataFrame:
    """One row per date in date_range: the winning effect (None if no alert applied)
    and its explanatory header text, for `line` with both directions combined -- a
    direction-specific alert (e.g. "suspended between X and Y" on one branch) still
    marks the whole line's day, since the calendar is a per-line, not per-direction,
    view."""
    line_alerts = alerts[alerts["route_id"] == line]
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
            # An effect value outside EFFECT_PRECEDENCE (shouldn't happen given the
            # known vocabulary, but don't silently drop a real alert if it does).
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
        # pandas' string dtype (pandas>=3.0) surfaces a missing entry as float NaN,
        # not the Python None it was assigned as -- confirmed by inspection after `is
        # None` silently failed to filter no-alert days out of the ranges. pd.isna()
        # catches both, regardless of which one wound up here.
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
