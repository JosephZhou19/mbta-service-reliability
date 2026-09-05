#!/usr/bin/env python3
"""Ingest MBTA's official service alerts (the same information published at
mbta.com/news) into a single compact table: data/alerts.parquet.

Source: LAMP's realtime-alerts archive (performancedata.mbta.com), which snapshots
the live GTFS-RT alerts feed repeatedly for as long as an alert stays active --
confirmed by inspection, one real-world Green Line closure appeared as 320 nearly
identical rows spanning its ~6-week active period. `id` is stable across every
snapshot of the same alert (unlike header text, which MBTA re-words over time as an
incident develops), so collapsing to one row per (id, route, direction) is exact,
not a heuristic. This is unlike lamp_ingest.py's per-day reconciliation: alerts
already come with their own start/end, so there's no daily manifest to track --
each run just re-fetches, re-dedupes, and overwrites the whole table.

Restricted to the 9 lines and the 2023-01-01+ window this project already covers,
via predicate pushdown -- the source file is 130MB+ across every route MBTA runs
(bus included), but filtering server-side keeps this to a ~15s fetch.

Not restricted by `effect` type at ingestion: every alert (from a multi-week
suspension down to a single elevator outage) is kept here. Which effect types
should actually influence a line's displayed day-status, and which are noise
(accessibility issues in particular are active on most days, for some elevator
somewhere, and would swamp a real closure if not deprioritized) is a rollup-time /
display concern (see service_availability.py's alert-status precedence order), not
an ingestion-time filter -- keeping the full picture here means that policy can
change later without re-ingesting.

Usage:
    python backend/alerts_ingest.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import fsspec
import pandas as pd
import pyarrow.dataset as ds

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
ALERTS_PATH = DATA_DIR / "alerts.parquet"

ALERTS_URL = "https://performancedata.mbta.com/lamp/tableau/alerts/LAMP_RT_ALERTS.parquet"
HTTP_FS = fsspec.filesystem("https")

LINES = ["Red", "Orange", "Blue", "Green-B", "Green-C", "Green-D", "Green-E", "Mattapan"]
START_DATE = "2023-01-01"  # matches the rest of this project's data scope

SOURCE_COLUMNS = [
    "id",
    "effect",
    "cause",
    "header_text.translation.text",
    "active_period.start_datetime",
    "active_period.end_datetime",
    "informed_entity.route_id",
    "informed_entity.direction_id",
    "last_modified_datetime",
]


def fetch_and_dedupe() -> pd.DataFrame:
    dataset = ds.dataset(ALERTS_URL, filesystem=HTTP_FS, format="parquet")
    filt = ds.field("informed_entity.route_id").isin(LINES) & (
        ds.field("active_period.start_datetime") >= pd.Timestamp(START_DATE)
    )
    df = dataset.to_table(filter=filt, columns=SOURCE_COLUMNS).to_pandas()
    if df.empty:
        return df

    group_keys = ["id", "informed_entity.route_id", "informed_entity.direction_id"]
    df = df.sort_values("last_modified_datetime")
    # dropna=False: direction_id is legitimately null for a line-wide (not
    # direction-specific) alert -- the default dropna=True would silently exclude
    # those rows from the transform below instead of grouping them together.
    latest_end = df.groupby(group_keys, dropna=False)["active_period.end_datetime"].transform("max")
    df = df.assign(**{"active_period.end_datetime": latest_end})
    deduped = df.drop_duplicates(subset=group_keys, keep="last")
    return deduped.reset_index(drop=True)


def main() -> None:
    print("Fetching and deduplicating MBTA service alerts...", file=sys.stderr)
    alerts = fetch_and_dedupe()
    if alerts.empty:
        sys.exit("No alerts returned -- check the source URL and filter.")

    alerts = alerts.rename(columns={
        "header_text.translation.text": "header",
        "active_period.start_datetime": "start",
        "active_period.end_datetime": "end",
        "informed_entity.route_id": "route_id",
        "informed_entity.direction_id": "direction_id",
    })
    alerts = alerts[["id", "route_id", "direction_id", "effect", "cause", "header", "start", "end"]]
    alerts = alerts.sort_values(["route_id", "start"]).reset_index(drop=True)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    alerts.to_parquet(ALERTS_PATH, index=False)
    print(f"Wrote {len(alerts)} deduplicated alerts -> {ALERTS_PATH}", file=sys.stderr)
    print(alerts["effect"].value_counts().to_string(), file=sys.stderr)


if __name__ == "__main__":
    main()
