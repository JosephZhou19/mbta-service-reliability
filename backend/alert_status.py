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

Two filters decide which alerts are even eligible to set a day's status -- most
ingested alerts don't represent "the day's transport was affected" at all:

1. EXCLUDED_EFFECTS: ACCESSIBILITY_ISSUE (16,364 of 26,667 ingested alerts --
   overwhelmingly single-elevator/escalator outages, affecting only riders who need
   that one facility, not train service) and ADDITIONAL_SERVICE (extra service added,
   not a disruption). Excluded regardless of duration -- these are categorically not
   about whether trains are running for most riders.

2. MIN_DURATION_HOURS: confirmed by inspection that every remaining effect type has a
   sharp, consistent bimodal split in alert duration -- a cluster of single-incident
   alerts at 2-6 hours (a stalled train, a brief reroute affecting a handful of trips),
   then a clean jump straight to 14-48+ hour planned/major disruptions, with almost
   nothing in between. This matters most for OTHER_EFFECT (8,493 alerts, 96% mentioning
   "delay" -- MBTA barely uses the SIGNIFICANT_DELAYS category in practice, so most real
   delay incidents are filed here instead) since 98.1% of it is under 6 hours: a single
   disabled-train incident, not a day-wide problem. A 12-hour threshold (roughly half a
   service day) sits cleanly in every category's gap, so it separates "affected the
   day's transport" from "a short-lived incident" regardless of which effect label MBTA
   happened to file it under.

EFFECT_PRECEDENCE decides which alert wins a day's color when more than one *eligible*
alert applies to a line at once. Ordered most-service-affecting first; a day with both
a NO_SERVICE closure and an eligible long DETOUR shows as NO_SERVICE.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent
ALERTS_PATH = ROOT / "data" / "alerts.parquet"

EXCLUDED_EFFECTS = {"ACCESSIBILITY_ISSUE", "ADDITIONAL_SERVICE"}
MIN_DURATION_HOURS = 12

# A long-duration alert whose header mentions a parking lot or garage, but names no
# specific line, is pure facility/parking-access noise, not a train-service issue --
# confirmed by inspection of all 189 long eligible alerts mentioning "parking" or
# "garage": every one naming a line too ("Orange Line: Service will bypass Haymarket
# ... to allow for work on the Government Center Garage demolition") was a genuine
# service impact just caused by garage work, while every one naming neither was a pure
# parking-lot notice (closure, pricing, capacity) with zero train impact. Deliberately
# NOT a blanket "must name a line" rule for all alerts: real station-level closures
# routinely name only the station ("Bowdoin station is closed through end of
# service"), which would be wrongly excluded by a broader rule.
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
    # Only a line mention in roughly the opening clause counts -- confirmed by
    # inspection that every facility-mentioning header where the line name appeared
    # past character ~50 was still pure parking noise, referencing a line only as a
    # reason clause ("...to allow equipment to stage for Red Line track work"), while
    # every genuine service impact named the line within the first ~40 characters.
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
