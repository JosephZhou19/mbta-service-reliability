#!/usr/bin/env python3
"""Ingest MBTA's official service alerts (the same information published at
mbta.com/news) into a single compact table: data/alerts.parquet.

Source: LAMP's realtime-alerts archive, which snapshots the live GTFS-RT alerts feed
repeatedly for as long as an alert stays active -- one real closure can appear as
hundreds of near-identical rows. `id` is stable across snapshots but NOT unique to a
single occurrence: MBTA reuses the same id for a genuinely recurring pattern (e.g. a
nightly bypass repeated over weeks), issuing a new start/end each time. See
fetch_and_dedupe for why `start` has to be part of the dedup key.

Restricted to the 9 lines and the 2023-01-01+ window this project covers, via
predicate pushdown -- the source file is 130MB+ across every MBTA route, but
filtering server-side keeps this to a ~15s fetch.

Not restricted by `effect` type or scope here: every alert is kept, and which effect
types/scopes should influence a line's displayed status is a display-time concern (see
alert_status.py) so that policy can change without re-ingesting.

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
    "informed_entity.stop_id",
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

    # `start` is part of the group key, not just id/route/direction: grouping by id
    # alone and taking the max end ever seen once stitched ~90 separate 6-hour
    # overnight occurrences of one recurring alert into a fake 357-day closure.
    # Grouping by start too keeps distinct recurrences separate, while still
    # collapsing repeated snapshots of the same still-ongoing occurrence into one.
    group_keys = ["id", "informed_entity.route_id", "informed_entity.direction_id", "active_period.start_datetime"]
    df = df.sort_values("last_modified_datetime")
    # dropna=False: direction_id is legitimately null for a line-wide (not
    # direction-specific) alert -- the default dropna=True would silently exclude
    # those rows from the transform below instead of grouping them together.
    latest_end = df.groupby(group_keys, dropna=False)["active_period.end_datetime"].transform("max")
    # Distinct stops named across every snapshot of this occurrence -- a scope signal
    # for alert_status.py to tell a single-station bypass (e.g. 2: a stop + its parent
    # station id) from a real segment closure (dozens). 0 means no stop-level detail was
    # ever given, i.e. the alert is scoped at the route/line level, not narrower.
    n_stops = df.groupby(group_keys, dropna=False)["informed_entity.stop_id"].transform("nunique")
    df = df.assign(**{"active_period.end_datetime": latest_end, "n_stops": n_stops})
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
    alerts = alerts[["id", "route_id", "direction_id", "effect", "cause", "header", "start", "end", "n_stops"]]
    alerts = alerts.sort_values(["route_id", "start"]).reset_index(drop=True)

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    alerts.to_parquet(ALERTS_PATH, index=False)
    print(f"Wrote {len(alerts)} deduplicated alerts -> {ALERTS_PATH}", file=sys.stderr)
    print(alerts["effect"].value_counts().to_string(), file=sys.stderr)


if __name__ == "__main__":
    main()
