# import_builder_splits_from_csv.py
# Reads qrxPYM0C_03_Month.csv (old projection system) and applies historical
# builder splits (JTB Homes / Interra Homes share) to sim_phase_builder_splits
# for phases that don't already have splits configured.
#
# The CSV works at (Development, LotType, Builder) grain — no phase-level detail.
# For multi-phase developments the same computed split is applied to all phases
# with matching lot types (user can review and adjust afterward).
#
# Usage:
#   cd devdb_python
#   python scripts/import_builder_splits_from_csv.py           # dry run (no DB writes)
#   python scripts/import_builder_splits_from_csv.py --apply   # write to DB
#
# Options:
#   --csv PATH          Override default CSV path
#   --dev "Name"        Process only this development name (exact DevDB name)
#   --apply             Write splits to DB (default: dry run)

from __future__ import annotations

import argparse
import csv
import os
import sys
from collections import defaultdict
from pathlib import Path

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()

_DEFAULT_CSV = Path(__file__).resolve().parents[2] / "ReferenceFiles" / "qrxPYM0C_03_Month.csv"

# ── Builder IDs ───────────────────────────────────────────────────────────────
BUILDER_IDS = {
    "JTB Homes": 188,
    "Interra Homes": 189,
}

# ── CSV LotType → DevDB lot_type_ids ─────────────────────────────────────────
# Maps CSV lot type label to the set of DevDB lot_type_ids that fall under it.
CSV_LOTTYPE_MAP: dict[str, list[int]] = {
    "Single Family": [101, 102],          # SF, SF-Large Lot
    "Townhome":      [107, 108],          # Front-Load TH, Rear-Load TH
    "Condo":         [111],               # Condo - General
    "Gateway":       [109],               # Gateway
    "Villa":         [103],               # Villa
    "Duplex":        [104],
    "Triplex":       [105],
    "Quadplex":      [106],
}

# ── DB helpers ────────────────────────────────────────────────────────────────

def _connect():
    return psycopg2.connect(
        host="localhost",
        database="devdb",
        user=os.getenv("PG_USER", "postgres"),
        password=os.getenv("PG_PASSWORD", ""),
        port=int(os.getenv("PG_PORT", 5432)),
        options="-c search_path=devdb",
    )


# ── Step 1: Compute builder splits from CSV ───────────────────────────────────

def load_csv_splits(csv_path: Path) -> dict[tuple[str, str], dict[str, float]]:
    """
    Returns { (dev_name, csv_lot_type): {"JTB Homes": share, "Interra Homes": share} }
    Shares computed from cumulative LotStart counts across all months.
    """
    totals: dict[tuple[str, str], dict[str, float]] = defaultdict(lambda: defaultdict(float))

    with csv_path.open(newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            dev = row["Development"].strip()
            lt  = row["LotType"].strip()
            bld = row["Builder"].strip()
            if bld not in BUILDER_IDS:
                continue  # skip unknown builders
            try:
                starts = float(row["LotStart"] or 0)
            except ValueError:
                starts = 0.0
            totals[(dev, lt)][bld] += starts

    splits: dict[tuple[str, str], dict[str, float]] = {}
    for (dev, lt), bld_starts in totals.items():
        total = sum(bld_starts.values())
        if total == 0:
            # No historical starts — assume 50/50 if both builders present, else 100%
            builders = list(bld_starts.keys())
            if len(builders) == 1:
                splits[(dev, lt)] = {builders[0]: 1.0}
            else:
                splits[(dev, lt)] = {b: 1.0 / len(builders) for b in builders}
        else:
            splits[(dev, lt)] = {b: round(s / total, 6) for b, s in bld_starts.items()}

    return splits


# ── Step 2: Load DevDB development + phase structure ──────────────────────────

def load_devdb_phases(conn, dev_filter: str | None) -> list[dict]:
    """
    Returns list of dicts:
      { dev_id, dev_name, phase_id, phase_name, lot_type_ids_in_phase, has_splits }
    """
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    dev_clause = "AND d.dev_name = %s" if dev_filter else ""
    params = [dev_filter] if dev_filter else []

    # Phases with their product split lot_type_ids
    cur.execute(f"""
        SELECT
            d.dev_id,
            d.dev_name,
            dp.phase_id,
            dp.phase_name,
            ARRAY_AGG(DISTINCT ps.lot_type_id) FILTER (WHERE ps.lot_type_id IS NOT NULL) AS split_lot_types,
            ARRAY_AGG(DISTINCT sl.lot_type_id) FILTER (WHERE sl.lot_type_id IS NOT NULL) AS actual_lot_types,
            COUNT(DISTINCT bs.split_id) AS split_count
        FROM devdb.developments d
        JOIN devdb.dim_development dd ON dd.dev_code2 = d.marks_code
        JOIN devdb.sim_legal_instruments sli ON sli.dev_id = dd.development_id
        JOIN devdb.sim_dev_phases dp ON dp.instrument_id = sli.instrument_id
        LEFT JOIN devdb.sim_phase_product_splits ps ON ps.phase_id = dp.phase_id
        LEFT JOIN devdb.sim_lots sl ON sl.phase_id = dp.phase_id AND sl.lot_source IN ('real','pre')
        LEFT JOIN devdb.sim_phase_builder_splits bs ON bs.phase_id = dp.phase_id
        {dev_clause}
        GROUP BY d.dev_id, d.dev_name, dp.phase_id, dp.phase_name
        ORDER BY d.dev_name, dp.phase_id
    """, params)

    rows = []
    for r in cur.fetchall():
        split_lts  = list(r["split_lot_types"]  or [])
        actual_lts = list(r["actual_lot_types"] or [])
        # Union both sources for matching purposes
        all_lts = sorted(set(split_lts) | set(actual_lts))
        rows.append({
            "dev_id":     r["dev_id"],
            "dev_name":   r["dev_name"],
            "phase_id":   r["phase_id"],
            "phase_name": r["phase_name"],
            "lot_types":  all_lts,
            "has_splits": r["split_count"] > 0,
        })
    return rows


# ── Step 3: Match CSV splits to phases ───────────────────────────────────────

def match_splits(
    csv_splits: dict[tuple[str, str], dict[str, float]],
    phases: list[dict],
) -> list[dict]:
    """
    Returns list of action dicts:
      { phase_id, phase_name, dev_name, csv_lot_type, builders: {name: share}, skip_reason }
    """
    # Index phases by dev_name
    by_dev: dict[str, list[dict]] = defaultdict(list)
    for p in phases:
        by_dev[p["dev_name"]].append(p)

    actions = []

    for (csv_dev, csv_lt), builder_shares in sorted(csv_splits.items()):
        if csv_lt not in CSV_LOTTYPE_MAP:
            continue  # OFFSITE, OTHER, etc.

        devdb_lts = set(CSV_LOTTYPE_MAP[csv_lt])
        dev_phases = by_dev.get(csv_dev)

        if dev_phases is None:
            actions.append({
                "phase_id": None,
                "phase_name": None,
                "dev_name": csv_dev,
                "csv_lot_type": csv_lt,
                "builders": builder_shares,
                "skip_reason": "NO_MATCH_DEV",
            })
            continue

        # Find phases in this dev that have matching lot types
        matched = [p for p in dev_phases if devdb_lts & set(p["lot_types"])]

        if not matched:
            # Dev matched but no phases with these lot types (could be all-PG or no phases yet)
            actions.append({
                "phase_id": None,
                "phase_name": None,
                "dev_name": csv_dev,
                "csv_lot_type": csv_lt,
                "builders": builder_shares,
                "skip_reason": "NO_PHASES_WITH_LOT_TYPE",
            })
            continue

        for p in matched:
            if p["has_splits"]:
                actions.append({
                    "phase_id":   p["phase_id"],
                    "phase_name": p["phase_name"],
                    "dev_name":   csv_dev,
                    "csv_lot_type": csv_lt,
                    "builders":   builder_shares,
                    "skip_reason": "ALREADY_HAS_SPLITS",
                })
            else:
                actions.append({
                    "phase_id":   p["phase_id"],
                    "phase_name": p["phase_name"],
                    "dev_name":   csv_dev,
                    "csv_lot_type": csv_lt,
                    "builders":   builder_shares,
                    "skip_reason": None,  # will apply
                })

    return actions


# ── Step 4: Apply splits ──────────────────────────────────────────────────────

def apply_splits(conn, actions: list[dict]) -> int:
    """Insert builder splits for actions with skip_reason=None. Returns rows inserted."""
    to_apply = [a for a in actions if a["skip_reason"] is None and a["phase_id"] is not None]
    if not to_apply:
        return 0

    cur = conn.cursor()
    inserted = 0

    for a in to_apply:
        for builder_name, share in a["builders"].items():
            builder_id = BUILDER_IDS.get(builder_name)
            if builder_id is None:
                continue
            # Upsert: skip if already exists (shouldn't happen given our filter, but safe)
            cur.execute("""
                INSERT INTO devdb.sim_phase_builder_splits (phase_id, builder_id, share)
                VALUES (%s, %s, %s)
                ON CONFLICT DO NOTHING
            """, (a["phase_id"], builder_id, share))
            inserted += cur.rowcount

    conn.commit()
    return inserted


# ── Reporting ─────────────────────────────────────────────────────────────────

def print_report(actions: list[dict], apply_mode: bool) -> None:
    will_apply  = [a for a in actions if a["skip_reason"] is None and a["phase_id"] is not None]
    skipped     = [a for a in actions if a["skip_reason"] == "ALREADY_HAS_SPLITS"]
    no_dev      = [a for a in actions if a["skip_reason"] == "NO_MATCH_DEV"]
    no_phases   = [a for a in actions if a["skip_reason"] == "NO_PHASES_WITH_LOT_TYPE"]

    mode_label = "APPLY MODE" if apply_mode else "DRY RUN (pass --apply to write)"

    print(f"\n{'='*70}")
    print(f"  Builder Splits Import  —  {mode_label}")
    print(f"{'='*70}")

    if will_apply:
        print(f"\nWILL APPLY: {len(will_apply)} phase(s)")
        for a in sorted(will_apply, key=lambda x: (x["dev_name"], x["phase_name"])):
            shares_str = "  ".join(
                f"{b.split()[0]} {v*100:.0f}%" for b, v in sorted(a["builders"].items())
            )
            print(f"   [{a['phase_id']:>5}] {a['dev_name']} -- {a['phase_name']}"
                  f"  ({a['csv_lot_type']})  {shares_str}")

    if skipped:
        print(f"\nSKIPPED (already configured): {len(skipped)} phase(s)")
        for a in sorted(skipped, key=lambda x: (x["dev_name"], x["phase_name"])):
            print(f"   [{a['phase_id']:>5}] {a['dev_name']} -- {a['phase_name']}")

    if no_dev:
        print(f"\nNO DEV MATCH in DevDB: {len(no_dev)} combo(s)")
        seen = set()
        for a in sorted(no_dev, key=lambda x: x["dev_name"]):
            key = (a["dev_name"], a["csv_lot_type"])
            if key not in seen:
                seen.add(key)
                print(f"   {a['dev_name']}  [{a['csv_lot_type']}]")

    if no_phases:
        print(f"\nNO PHASES WITH LOT TYPE: {len(no_phases)} combo(s)")
        for a in sorted(no_phases, key=lambda x: (x["dev_name"], x["csv_lot_type"])):
            print(f"   {a['dev_name']}  [{a['csv_lot_type']}]")

    print(f"\n{'='*70}")
    print(f"  Summary: {len(will_apply)} apply | {len(skipped)} skip | "
          f"{len(no_dev)} no-dev | {len(no_phases)} no-phases")
    print(f"{'='*70}\n")


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Import builder splits from CSV projection system")
    parser.add_argument("--csv",   default=str(_DEFAULT_CSV), help="Path to qrxPYM0C_03_Month.csv")
    parser.add_argument("--dev",   default=None, help="Process only this DevDB dev_name (exact)")
    parser.add_argument("--apply", action="store_true", help="Write splits to DB (default: dry run)")
    args = parser.parse_args()

    csv_path = Path(args.csv)
    if not csv_path.exists():
        print(f"ERROR: CSV not found: {csv_path}", file=sys.stderr)
        sys.exit(1)

    print(f"Reading CSV: {csv_path}")
    csv_splits = load_csv_splits(csv_path)
    print(f"  {len(csv_splits)} (dev, lot_type) combos loaded from CSV")

    conn = _connect()
    try:
        print("Loading DevDB phase structure...")
        phases = load_devdb_phases(conn, args.dev)
        print(f"  {len(phases)} phases loaded from DevDB")

        actions = match_splits(csv_splits, phases)
        print_report(actions, args.apply)

        if args.apply:
            n = apply_splits(conn, actions)
            print(f"Inserted {n} builder split rows.\n")
        else:
            will_apply = sum(1 for a in actions if a["skip_reason"] is None and a["phase_id"])
            if will_apply:
                print(f"Run with --apply to insert {will_apply} split(s).\n")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
