#!/usr/bin/env python3
"""Ingest MBTA LAMP daily subway performance data into per-day summary files.

Data source: performancedata.mbta.com/lamp/subway-on-time-performance-v1/
(one Parquet file per service_date, scheduled + observed values already
joined per stop-event) plus two small reference tables used to compute
scheduled trip counts (LAMP_service_id_by_date_and_route.parquet +
LAMP_static_trips.parquet).

Reconciliation, not a "yesterday" cursor: every run re-fetches the source
index.csv and compares its (service_date, last_modified) against our own
manifest (data/manifest.csv). LAMP revises past days after the fact (the
very first day in its history, 2019-09-15, has a last_modified from years
later — confirmed by inspection), so "already have this date" is not
enough; a date is reprocessed whenever the source's last_modified is newer
than what we recorded. A run that dies partway through a date simply never
updates that date's manifest entry, so the next run retries it automatically
— no separate crash-recovery path needed.

Idempotent by construction: each service_date's output
(data/daily/{date}.parquet) is fully overwritten on every (re)process, never
appended to. Re-running the whole pipeline any number of times converges to
the same state.

Delay is summarized at route+branch+direction+hour+day grain (hour bucketed
by the SCHEDULED time, so a very late train doesn't get miscategorized into
a different hour than a rider would have expected it in). Schedule footprint
(which stops the published schedule actually calls at, per line+direction+day
— the input to service_availability.py's reduced-service detection) is
recorded at route+branch+direction+day grain only (no hour) — not because
LAMP_static_stop_times.parquet is too large to use (predicate pushdown over
HTTP makes a day's filtered read <1s, well under 1MB), but because it isn't
needed for that grain.

Delivery rate (observed vs. scheduled stop-visits) was tracked here too in an
earlier version, and dropped: schedule-footprint-based reduced-service
detection (service_availability.py) turned out to explain construction/
diversion-driven shortfall more precisely and more legibly than a bare
percentage did, and genuine random cancellations on an otherwise-normal day
are rare enough to show up as a delay spike rather than needing their own
metric.

Usage:
    python scripts/lamp_ingest.py                 # reconcile: process anything missing/stale
    python scripts/lamp_ingest.py --limit 10       # process at most 10 dates (for testing)
    python scripts/lamp_ingest.py --date 2026-08-18  # force-reprocess one specific date
"""
from __future__ import annotations

import argparse
import sys
import zoneinfo
from pathlib import Path

import fsspec
import numpy as np
import pandas as pd
import pyarrow.dataset as ds
import requests

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DAILY_DIR = DATA_DIR / "daily"
MANIFEST_PATH = DATA_DIR / "manifest.csv"
REF_CACHE_DIR = DATA_DIR / "ref_cache"

LAMP_BASE = "https://performancedata.mbta.com/lamp"
INDEX_URL = f"{LAMP_BASE}/subway-on-time-performance-v1/index.csv"
SVC_BY_DATE_ROUTE_URL = f"{LAMP_BASE}/tableau/rail/LAMP_service_id_by_date_and_route.parquet"
STATIC_TRIPS_URL = f"{LAMP_BASE}/tableau/rail/LAMP_static_trips.parquet"
STATIC_STOP_TIMES_URL = f"{LAMP_BASE}/tableau/rail/LAMP_static_stop_times.parquet"  # 2GB+ total, but
# clustered/sorted by static_version_key, so predicate pushdown over HTTP (via fsspec) reads only the
# relevant row groups — a day's worth of stop_times comes back in <1s without downloading the file.

HTTP_FS = fsspec.filesystem("https")

EASTERN = zoneinfo.ZoneInfo("America/New_York")
PERCENTILES = [0.5, 0.9]


def fetch_index() -> pd.DataFrame:
    idx = pd.read_csv(INDEX_URL, parse_dates=["last_modified"])
    idx["service_date"] = pd.to_datetime(idx["service_date"]).dt.strftime("%Y-%m-%d")
    return idx.sort_values("service_date").reset_index(drop=True)


def load_manifest() -> pd.DataFrame:
    if MANIFEST_PATH.exists():
        m = pd.read_csv(MANIFEST_PATH, parse_dates=["last_modified"])
        return m
    return pd.DataFrame(columns=["service_date", "last_modified", "status"])


def save_manifest(manifest: pd.DataFrame) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    manifest.sort_values("service_date").to_csv(MANIFEST_PATH, index=False)


def dates_needing_processing(index_df: pd.DataFrame, manifest: pd.DataFrame) -> pd.DataFrame:
    merged = index_df.merge(
        manifest[["service_date", "last_modified"]], on="service_date", how="left", suffixes=("", "_done")
    )
    stale_or_missing = merged["last_modified_done"].isna() | (merged["last_modified"] > merged["last_modified_done"])
    return merged[stale_or_missing][["service_date", "last_modified", "file_url"]].reset_index(drop=True)


def remote_last_modified(url: str) -> pd.Timestamp | None:
    resp = requests.head(url, timeout=30)
    resp.raise_for_status()
    lm = resp.headers.get("Last-Modified")
    return pd.Timestamp(lm) if lm else None


def ensure_ref_tables() -> tuple[pd.DataFrame, pd.DataFrame]:
    """Download the two reference tables if missing or the remote copy is newer than our cache."""
    REF_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    stamp_path = REF_CACHE_DIR / "stamps.csv"
    stamps = pd.read_csv(stamp_path, index_col="name")["last_modified"].to_dict() if stamp_path.exists() else {}

    tables = {}
    new_stamps = dict(stamps)
    for name, url in [("svc_by_date_route", SVC_BY_DATE_ROUTE_URL), ("static_trips", STATIC_TRIPS_URL)]:
        local_path = REF_CACHE_DIR / f"{name}.parquet"
        remote_lm = remote_last_modified(url)
        cached_lm = stamps.get(name)
        if local_path.exists() and cached_lm is not None and remote_lm is not None and str(remote_lm) == cached_lm:
            print(f"  {name}: using cached copy (unchanged since {cached_lm})", file=sys.stderr)
        else:
            print(f"  {name}: downloading (cache stale or missing)", file=sys.stderr)
            df = pd.read_parquet(url)
            df.to_parquet(local_path)
            new_stamps[name] = str(remote_lm) if remote_lm is not None else ""
        tables[name] = pd.read_parquet(local_path)

    pd.Series(new_stamps, name="last_modified").rename_axis("name").to_csv(stamp_path)
    return tables["svc_by_date_route"], tables["static_trips"]


def scheduled_epoch(service_date_str: str, seconds_since_midnight: pd.Series) -> pd.Series:
    """Convert GTFS-style local (Eastern) seconds-since-midnight to a UTC POSIX epoch,
    DST-aware. Naive fixed-offset arithmetic is wrong across the March/November DST
    boundary — this was a real bug caught during validation, not a hypothetical one."""
    midnight_local = pd.Timestamp(service_date_str, tz=EASTERN)
    midnight_epoch = midnight_local.timestamp()
    return midnight_epoch + seconds_since_midnight


MAX_PLAUSIBLE_DELAY_SEC = 3600  # subway arrival delay beyond +/-1h at a single stop is a
# realtime-to-schedule mismatch on MBTA's side, not a real delay (confirmed by inspection:
# e.g. a matched pair implying an 8-hour-early or 6-hour-late arrival). Excluded, not clipped,
# since a clipped value would still corrupt the percentile rather than just the tail.


def compute_delay_summary(df: pd.DataFrame, service_date_str: str) -> pd.DataFrame:
    d = df.dropna(subset=["stop_timestamp", "scheduled_arrival_time"]).copy()
    if d.empty:
        return pd.DataFrame()

    # Same rationale as compute_delivery_summary: a null branch_route_id on Red
    # specifically means bus-shuttle diversion placeholder or an unattributable
    # gap, not real rail service comparable to Red-A/Red-B — drop rather than
    # let it form a spurious "Red" catch-all bucket.
    d = d[~((d["route_id"] == "Red") & d["branch_route_id"].isna())]
    if d.empty:
        return pd.DataFrame()
    d["line"] = d["branch_route_id"].fillna(d["route_id"])
    d["scheduled_arrival_epoch"] = scheduled_epoch(service_date_str, d["scheduled_arrival_time"])
    d["arrival_delay_sec"] = d["stop_timestamp"] - d["scheduled_arrival_epoch"]
    d = d[d["arrival_delay_sec"].abs() <= MAX_PLAUSIBLE_DELAY_SEC]
    d["hour"] = (d["scheduled_arrival_time"] // 3600 % 24).astype("int8")

    grouped = d.groupby(["line", "route_id", "direction_id", "hour"], observed=True)["arrival_delay_sec"]
    stats = grouped.quantile(PERCENTILES).unstack()
    stats.columns = [f"delay_p{int(q * 100)}_sec" for q in stats.columns]
    stats["n"] = grouped.size()
    stats = stats.reset_index()
    stats.insert(0, "service_date", service_date_str)
    return stats


def build_scheduled_roster(service_date_str: str, svc_by_date_route: pd.DataFrame, static_trips: pd.DataFrame) -> pd.DataFrame:
    """The set of trips actually scheduled to run on service_date_str, one row per
    trip_id, with 'line' resolved to branch_route_id where one exists (Red) and
    route_id otherwise (Green's branches are already distinct route_ids). Shared by
    delivery-rate and schedule-footprint computation so both agree on exactly which
    trips count as "scheduled" for the day.
    """
    date_int = int(service_date_str.replace("-", ""))
    day_svc = svc_by_date_route[svc_by_date_route.service_date == date_int]
    if day_svc.empty:
        return pd.DataFrame()

    scheduled_trips = static_trips.merge(day_svc[["route_id", "service_id", "static_version_key"]], on=["route_id", "service_id", "static_version_key"])
    if scheduled_trips.empty:
        return pd.DataFrame()
    scheduled_trips = scheduled_trips.copy()
    # Only Red has route_id=='Red' for every branch with branch_route_id as the sole
    # disambiguator; Green's branches are already distinct route_ids (Green-B/C/D/E),
    # so a null branch_route_id there correctly falls back to route_id. For Red, a null
    # branch_route_id turned out (on inspection) to mean either a bus-shuttle diversion
    # placeholder or a rare scheduled short-turnback confined to the shared trunk north
    # of the Ashmont/Braintree split — in every sampled case, these never appear in the
    # observed subway data at all (buses aren't rail; the short-turnbacks apparently
    # just don't run), producing a spurious permanent 0% "Red" catch-all bucket that
    # also silently starved Red-A/Red-B's own scheduled counts. Drop them outright
    # rather than let them land in an unattributable bucket.
    scheduled_trips = scheduled_trips[~((scheduled_trips["route_id"] == "Red") & scheduled_trips["branch_route_id"].isna())]
    scheduled_trips["line"] = scheduled_trips["branch_route_id"].fillna(scheduled_trips["route_id"])
    return scheduled_trips


def fetch_scheduled_stop_times(scheduled_trips: pd.DataFrame) -> pd.DataFrame:
    """Every (trip, stop) the static schedule calls for on the day scheduled_trips
    represents, with line/route/direction attached. Predicate-pushed over HTTP by
    static_version_key, so this stays a sub-second, <1MB read despite the source
    table being 2GB+ (see STATIC_STOP_TIMES_URL comment)."""
    version_keys = scheduled_trips["static_version_key"].unique().tolist()
    stop_times_dataset = ds.dataset(STATIC_STOP_TIMES_URL, filesystem=HTTP_FS, format="parquet")
    st = stop_times_dataset.to_table(filter=ds.field("static_version_key").isin(version_keys)).to_pandas()
    st = st.merge(scheduled_trips[["trip_id", "static_version_key", "line", "route_id", "direction_id"]], on=["trip_id", "static_version_key"])
    return st


def compute_schedule_footprint(st: pd.DataFrame, service_date_str: str) -> pd.DataFrame:
    """Which stops the published schedule actually calls at for each line+direction
    on this service date — the raw fact behind service-availability detection. A
    shuttle-bus diversion or construction closure shows up here as stops silently
    missing from the day's schedule, distinct from delivery-rate's day-of shortfall
    against a schedule that was otherwise normal. One row per (line, direction, stop)
    actually scheduled; interpreting "missing vs. this line's normal stop set" is a
    rollup-time concern, not this ingestion step's."""
    if st.empty:
        return pd.DataFrame()
    footprint = st[["line", "route_id", "direction_id", "stop_id"]].drop_duplicates().reset_index(drop=True)
    footprint.insert(0, "service_date", service_date_str)
    return footprint


def process_date(service_date_str: str, file_url: str, svc_by_date_route: pd.DataFrame, static_trips: pd.DataFrame) -> str:
    """Returns a status string: 'ok', 'empty', or 'error: ...'."""
    try:
        df = pd.read_parquet(file_url)
    except Exception as e:
        return f"error: failed to download/read ({e})"

    DAILY_DIR.mkdir(parents=True, exist_ok=True)
    delay_path = DAILY_DIR / f"{service_date_str}-delay.parquet"
    stops_path = DAILY_DIR / f"{service_date_str}-stops.parquet"

    if len(df) == 0:
        # Overwrite with empty frames so a previously-good day that somehow
        # regressed to empty doesn't leave stale data behind.
        pd.DataFrame().to_parquet(delay_path)
        pd.DataFrame().to_parquet(stops_path)
        return "empty"

    try:
        delay = compute_delay_summary(df, service_date_str)
        scheduled_trips = build_scheduled_roster(service_date_str, svc_by_date_route, static_trips)
        st = fetch_scheduled_stop_times(scheduled_trips) if not scheduled_trips.empty else pd.DataFrame()
        footprint = compute_schedule_footprint(st, service_date_str)
    except Exception as e:
        return f"error: computation failed ({e})"

    delay.to_parquet(delay_path)
    footprint.to_parquet(stops_path)
    return "ok"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--limit", type=int, default=None, help="Process at most N dates (for testing)")
    parser.add_argument("--date", default=None, help="Force-reprocess a single YYYY-MM-DD date")
    parser.add_argument("--start-date", default=None, help="Only reconcile dates >= this YYYY-MM-DD (ignored with --date)")
    args = parser.parse_args()

    print("Fetching LAMP index...", file=sys.stderr)
    index_df = fetch_index()
    manifest = load_manifest()

    if args.date:
        row = index_df[index_df.service_date == args.date]
        if row.empty:
            sys.exit(f"{args.date} not found in LAMP index")
        todo = row[["service_date", "last_modified", "file_url"]].reset_index(drop=True)
    else:
        if args.start_date:
            index_df = index_df[index_df.service_date >= args.start_date]
        todo = dates_needing_processing(index_df, manifest)
        if args.limit:
            todo = todo.head(args.limit)

    if todo.empty:
        print("Nothing to do — up to date.", file=sys.stderr)
        return

    print(f"{len(todo)} date(s) need processing.", file=sys.stderr)
    print("Ensuring reference tables (scheduled trip rosters)...", file=sys.stderr)
    svc_by_date_route, static_trips = ensure_ref_tables()

    manifest = manifest.set_index("service_date") if not manifest.empty else pd.DataFrame(columns=["last_modified", "status"]).rename_axis("service_date")
    error_count = 0
    for i, row in todo.iterrows():
        print(f"[{i + 1}/{len(todo)}] {row.service_date} ...", file=sys.stderr, end=" ")
        status = process_date(row.service_date, row.file_url, svc_by_date_route, static_trips)
        print(status, file=sys.stderr)
        if status.startswith("error"):
            # Do NOT record this date as done: leaving its manifest entry stale (or
            # absent) means the next run's reconciliation sees it as still-needed and
            # retries automatically, rather than silently and permanently skipping a
            # date that failed on a transient network error.
            error_count += 1
            continue
        manifest.loc[row.service_date, ["last_modified", "status"]] = [row.last_modified, status]
        if (i + 1) % 50 == 0:
            save_manifest(manifest.reset_index())  # periodic checkpoint for long runs

    save_manifest(manifest.reset_index())
    print(f"\nDone. {error_count} error(s) will be retried on next run. Manifest -> {MANIFEST_PATH}", file=sys.stderr)


if __name__ == "__main__":
    main()
