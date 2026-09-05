#!/usr/bin/env python3
"""Turn daily schedule-footprint files (data/daily/{date}-stops.parquet) into a
service-availability metric: what fraction of the year each line ran its normal,
full schedule vs. a reduced/construction pattern, and the specific date ranges
of each closure.

Method: for each (line, direction, stop_id), a trailing 90-service-day majority
vote decides whether that stop counts as "normally served" as of a given date --
present on >=50% of the preceding 90 days. A day is "reduced" for a line if any
stop that's normally served there is missing from that day's actual published
schedule. Trailing (not centered) so the baseline is self-healing: a change that
holds for enough of the window becomes the new normal, rather than the line
being flagged as permanently reduced forever after a real, permanent change.

Baseline is computed separately per day-type -- weekday, Saturday, and Sunday
each get their own rolling window, not pooled across all calendar days. This
was NOT the original design; it went through two rounds of a real bug found
by spot-checking output against raw data, not by inspection alone:

1. A single pooled baseline flagged Green-D as "reduced" on essentially every
   Saturday/Sunday for 18 months straight. Cause: 10 stop_ids on Green-D are
   permanently absent every Saturday+Sunday (a genuine weekday-only segment),
   which a pooled vote reads as "present 5/7 of the time" -- comfortably
   "normal" -- so every single weekend correctly having 0 of those stops
   reads as a deviation from that pooled normal.
2. Splitting into weekday vs. weekend fixed that, but a *second* case survived:
   Green-E's stop 70504 is present on 83% of Saturdays but 0% of Sundays,
   all year. Pooling Saturday+Sunday into one "weekend" bucket averages that
   to ~41% -- just under the 50% threshold -- so every single Sunday still
   got misflagged as reduced. Saturday and Sunday schedules can legitimately
   differ from each other, not just from weekdays, so they need independent
   baselines too.

A stop's "normal" is judged only against other days of the same type, so a
permanent day-of-week schedule difference is never flagged, while a *new*
closure on that same day-of-week still reads as reduced against its own
baseline specifically.

The weekend (Saturday/Sunday) windows are deliberately longer in elapsed time
than the weekday window (13 occurrences ~= 3 months each, vs. 90 weekday
occurrences ~= 4.5 months) since a short multi-weekend closure should not get
absorbed into "the new normal Saturday" as quickly as a weekday disruption
would be forgotten -- Saturdays/Sundays are sparser, so reaching a comparable
real-time span already requires a smaller occurrence count.

This is an analysis/rollup step, not part of daily ingestion -- it recomputes
over full history each run, which is cheap (a few hundred thousand rows, all
already on disk).
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent
DAILY_DIR = ROOT / "data" / "daily"

WEEKDAY_WINDOW = 90
WEEKDAY_MIN_PERIODS = 30
SATURDAY_WINDOW = 13
SATURDAY_MIN_PERIODS = 5
SUNDAY_WINDOW = 13
SUNDAY_MIN_PERIODS = 5
NORMAL_THRESHOLD = 0.5


def load_all_footprints() -> pd.DataFrame:
    frames = []
    for path in sorted(DAILY_DIR.glob("*-stops.parquet")):
        df = pd.read_parquet(path)
        if not df.empty:
            frames.append(df)
    return pd.concat(frames, ignore_index=True)


def build_presence_matrix(footprints: pd.DataFrame) -> tuple[pd.DataFrame, pd.DatetimeIndex]:
    """Dense boolean matrix: rows = every service_date in range, columns =
    every (line, direction_id, stop_id) ever seen scheduled. True = that stop
    was in the published schedule that day."""
    footprints = footprints.copy()
    footprints["service_date"] = pd.to_datetime(footprints["service_date"])
    footprints["present"] = True

    wide = footprints.pivot_table(
        index="service_date",
        columns=["line", "direction_id", "stop_id"],
        values="present",
        aggfunc="any",
        fill_value=False,
    )
    full_range = pd.date_range(wide.index.min(), wide.index.max(), freq="D")
    wide = wide.reindex(full_range, fill_value=False)
    return wide, full_range


def compute_baseline(presence: pd.DataFrame) -> pd.DataFrame:
    """Trailing majority-vote presence-rate per (line, direction, stop), computed
    separately for weekdays, Saturdays, and Sundays so a permanent day-of-week
    schedule difference doesn't get misread as a deviation from a pooled norm."""
    dow = presence.index.dayofweek
    parts = []
    for mask, window, min_periods in [
        (dow < 5, WEEKDAY_WINDOW, WEEKDAY_MIN_PERIODS),
        (dow == 5, SATURDAY_WINDOW, SATURDAY_MIN_PERIODS),
        (dow == 6, SUNDAY_WINDOW, SUNDAY_MIN_PERIODS),
    ]:
        parts.append(presence.loc[mask].shift(1).rolling(window=window, min_periods=min_periods).mean())
    return pd.concat(parts).sort_index()


def flag_reduced_days(presence: pd.DataFrame) -> pd.DataFrame:
    """For each (line, direction) column-group, a day is reduced if any stop that
    was "normally served" (per the trailing-window majority vote) is absent."""
    baseline = compute_baseline(presence)
    normally_served = baseline >= NORMAL_THRESHOLD
    missing_but_normal = normally_served & ~presence
    # Only well-defined once the baseline has enough history; before that, NaN
    # propagates through normally_served as False, which would wrongly read as
    # "never normal" rather than "not yet classifiable" -- mask those out.
    has_baseline = baseline.notna()
    reduced_signal = missing_but_normal & has_baseline

    lines_dirs = presence.columns.droplevel("stop_id").unique()
    out = pd.DataFrame(index=presence.index)
    classifiable = pd.DataFrame(index=presence.index)
    for line, direction in lines_dirs:
        cols = reduced_signal.loc[:, (line, direction, slice(None))]
        base_cols = has_baseline.loc[:, (line, direction, slice(None))]
        out[(line, direction)] = cols.any(axis=1)
        classifiable[(line, direction)] = base_cols.any(axis=1)
    out.columns = pd.MultiIndex.from_tuples(out.columns, names=["line", "direction_id"])
    classifiable.columns = out.columns
    return out, classifiable


def summarize(reduced: pd.DataFrame, classifiable: pd.DataFrame) -> pd.DataFrame:
    lines = reduced.columns.get_level_values("line").unique()
    rows = []
    for line in lines:
        line_reduced = reduced.loc[:, (line, slice(None))].any(axis=1)
        line_classifiable = classifiable.loc[:, (line, slice(None))].any(axis=1)
        elig = line_classifiable.sum()
        pct = 100 * line_reduced[line_classifiable].sum() / elig if elig else float("nan")
        rows.append({"line": line, "classifiable_days": int(elig), "reduced_days": int(line_reduced[line_classifiable].sum()), "reduced_pct": round(pct, 1)})
    return pd.DataFrame(rows).sort_values("reduced_pct", ascending=False)


def closure_ranges(reduced: pd.DataFrame, line: str) -> list[tuple[str, str, int]]:
    """Contiguous runs of reduced days for one line, collapsed across directions."""
    s = reduced.loc[:, (line, slice(None))].any(axis=1)
    runs = []
    in_run = False
    start = None
    for date, val in s.items():
        if val and not in_run:
            in_run = True
            start = date
        elif not val and in_run:
            in_run = False
            runs.append((start, date - pd.Timedelta(days=1)))
    if in_run:
        runs.append((start, s.index[-1]))
    return [(a.strftime("%Y-%m-%d"), b.strftime("%Y-%m-%d"), (b - a).days + 1) for a, b in runs]


def main():
    print("Loading schedule footprints...", file=sys.stderr)
    footprints = load_all_footprints()
    print(f"{len(footprints)} (date, line, direction, stop) rows loaded.", file=sys.stderr)

    print("Building presence matrix...", file=sys.stderr)
    presence, _ = build_presence_matrix(footprints)
    print(f"Matrix: {presence.shape[0]} days x {presence.shape[1]} (line,direction,stop) columns.", file=sys.stderr)

    print("Flagging reduced-service days...", file=sys.stderr)
    reduced, classifiable = flag_reduced_days(presence)

    summary = summarize(reduced, classifiable)
    print("\n=== % of classifiable days each line ran a reduced schedule ===")
    print(summary.to_string(index=False))

    print("\n=== Closure date ranges (>=1 day) ===")
    for line in reduced.columns.get_level_values("line").unique():
        ranges = closure_ranges(reduced, line)
        if ranges:
            print(f"\n{line}:")
            for start, end, days in ranges:
                print(f"  {start} to {end}  ({days} day{'s' if days != 1 else ''})")


if __name__ == "__main__":
    main()
