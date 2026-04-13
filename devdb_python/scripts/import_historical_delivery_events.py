"""
import_historical_delivery_events.py

Deduce and import historical delivery events from qrxPYM0C_03_Month.csv.

The LotsDeveloped column captures the month lots were delivered (taken down) per
projection group. Groups with the same development in the same month are the same
delivery event. Multiple instruments in one ent-group that both show LotsDeveloped
in the same month are all part of one event.

Phase auto-assignment:
  Primary:  date_td clustering -- real/pre lots whose date_td falls in the event month
            grouped by phase_id. Reliable where MARKS data is available.
  Fallback: Sequential -- next unassigned phase(s) per instrument, in sequence_number
            order. Delivery events always proceed in phase order.

Confidence labels:
  HIGH   -- date_td method confirmed, or lot count matches projected within 2 lots
  MEDIUM -- sequential assignment, lot count within 5 lots
  LOW    -- sequential assignment, lot count mismatch > 5 lots

Usage:
  python import_historical_delivery_events.py [--csv PATH] [--apply] [--ent-group N]

  --apply      Write to DB (default: dry-run)
  --ent-group  Scope to one ent_group_id only
"""

import argparse
import csv
import re
from collections import defaultdict
from datetime import date

import psycopg2

TODAY = date(2026, 4, 12)

DEFAULT_CSV = "C:/DevDB_Claude_Git_v2/ReferenceFiles/qrxPYM0C_03_Month.csv"

DB = dict(dbname="devdb", user="postgres", password="postgres", host="localhost", port=5432)

# Manual overrides where CSV dev name != DB dev_name exactly
# Maps lowercased CSV dev name -> DB dev_name (exact)
CSV_TO_DEV_NAME = {
    "dykema / schimmel":   "Dykema / Schimmel (Kent)",
    "notenbaum":           "Laketown Notenbaum",
    "prairie winds":       "Prairie Winds (SF)",   # SF is primary; CD/TH handled via lot-type rows
    "waterton condos":     None,                   # split across Pointe + Village instruments
}

# Lowercased CSV dev names to skip entirely
SKIP_CSV_DEVS = {"algoma pitsch", "schuring"}


def base_dev(name):
    """Strip trailing lot-type qualifier: 'Abbey Farms (SF)' -> 'Abbey Farms'."""
    return re.sub(r"\s*\([^)]+\)\s*$", "", name).strip()


def load_db_state(conn):
    """
    Returns:
      dev_name_map:  {dev_name_lower: [(ent_group_id, instrument_id)]}
      phase_map:     {instrument_id: [(phase_id, seq, lot_count_projected), ...]}  sorted by seq
      existing_events: {(ent_group_id, yr, mo)} — events that already have date_dev_actual in that month
    """
    cur = conn.cursor()

    # dev_name -> (ent_group_id, instrument_id)
    cur.execute("""
        SELECT seg.ent_group_id, sli.instrument_id, d.dev_name
        FROM devdb.sim_entitlement_groups seg
        JOIN devdb.sim_ent_group_developments segd ON segd.ent_group_id = seg.ent_group_id
        JOIN devdb.sim_legal_instruments sli        ON sli.dev_id = segd.dev_id
        JOIN devdb.dim_development dd               ON dd.development_id = segd.dev_id
        JOIN devdb.developments d                   ON d.marks_code = dd.dev_code2
        WHERE seg.is_test IS NOT TRUE
    """)
    dev_name_map = defaultdict(list)
    for eid, iid, dname in cur.fetchall():
        dev_name_map[dname.lower()].append((eid, iid))

    # phases per instrument
    cur.execute("""
        SELECT sdp.instrument_id, sdp.phase_id, sdp.sequence_number, sdp.lot_count_projected
        FROM devdb.sim_dev_phases sdp
        ORDER BY sdp.instrument_id, sdp.sequence_number
    """)
    phase_map = defaultdict(list)
    for iid, pid, seq, proj in cur.fetchall():
        phase_map[iid].append((pid, seq, proj))

    # existing historical delivery events (date_dev_actual set)
    cur.execute("""
        SELECT ent_group_id,
               EXTRACT(YEAR FROM date_dev_actual)::int,
               EXTRACT(MONTH FROM date_dev_actual)::int
        FROM devdb.sim_delivery_events
        WHERE date_dev_actual IS NOT NULL
    """)
    existing_events = set()
    for row in cur.fetchall():
        existing_events.add((row[0], row[1], row[2]))

    # phases already assigned to any delivery event
    cur.execute("""
        SELECT dep.phase_id
        FROM devdb.sim_delivery_event_phases dep
        JOIN devdb.sim_delivery_events de ON de.delivery_event_id = dep.delivery_event_id
        WHERE de.date_dev_actual IS NOT NULL
    """)
    assigned_phases = {row[0] for row in cur.fetchall()}

    cur.close()
    return dev_name_map, phase_map, existing_events, assigned_phases


def load_date_td_map(conn):
    """
    Returns {phase_id: {(yr, mo): count}} — real/pre lots with date_td grouped by phase+month.
    """
    cur = conn.cursor()
    cur.execute("""
        SELECT phase_id,
               EXTRACT(YEAR FROM date_td)::int,
               EXTRACT(MONTH FROM date_td)::int,
               COUNT(*) AS cnt
        FROM devdb.sim_lots
        WHERE lot_source IN ('real', 'pre')
          AND date_td IS NOT NULL
          AND phase_id IS NOT NULL
        GROUP BY phase_id, EXTRACT(YEAR FROM date_td), EXTRACT(MONTH FROM date_td)
    """)
    td_map = defaultdict(lambda: defaultdict(int))
    for phase_id, yr, mo, cnt in cur.fetchall():
        td_map[phase_id][(int(yr), int(mo))] = int(cnt)
    cur.close()
    return td_map


def parse_csv_events(csv_path, dev_name_map):
    """
    Parse CSV, return historical events grouped by (ent_group_id, yr, mo).
    Each entry: list of {instrument_id, csv_dev, lots}
    """
    events = defaultdict(list)   # (ent_group_id, yr, mo) -> [{instrument_id, csv_dev, lots}]
    unresolved = set()

    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            lots = float(row["LotsDeveloped"] or 0)
            if lots <= 0:
                continue
            yr, mo = int(row["Year"]), int(row["MonthNo"])
            if date(yr, mo, 1) >= TODAY:
                continue

            csv_dev = row["Development"].strip()
            csv_dev_lower = csv_dev.lower()
            base = base_dev(csv_dev).lower()

            if base in SKIP_CSV_DEVS or csv_dev_lower in SKIP_CSV_DEVS:
                continue

            # Resolve to (ent_group_id, instrument_id) pairs
            resolved = []
            if csv_dev_lower in CSV_TO_DEV_NAME:
                mapped = CSV_TO_DEV_NAME[csv_dev_lower]
                if mapped is None:
                    # e.g. "Waterton Condos" -> find all instruments for ent_group 9002
                    # by base name match
                    for dk, entries in dev_name_map.items():
                        if "waterton" in dk and "condos" in dk.lower():
                            resolved.extend(entries)
                else:
                    resolved = dev_name_map.get(mapped.lower(), [])
            elif csv_dev_lower in dev_name_map:
                resolved = dev_name_map[csv_dev_lower]
            elif base in dev_name_map:
                resolved = dev_name_map[base]
            else:
                unresolved.add(csv_dev)
                continue

            if not resolved:
                unresolved.add(csv_dev)
                continue

            # All resolved entries should share the same ent_group_id
            eid = resolved[0][0]
            for e, iid in resolved:
                events[(eid, yr, mo)].append({
                    "instrument_id": iid,
                    "csv_dev":       csv_dev,
                    "lots":          lots / len(resolved),  # split evenly if multi-instrument match
                })

    return events, unresolved


def auto_assign_phases(events, phase_map, td_map, assigned_phases):
    """
    Returns {(ent_group_id, yr, mo): [(phase_id, confidence, note)]}
    Updates assigned_phases in-place so later events don't re-use the same phase.
    """
    results = {}
    # Process chronologically so sequential logic is correct
    for key in sorted(events.keys()):
        eid, yr, mo = key
        instr_rows = events[key]
        assignments = []

        # Collect all instrument_ids involved
        instrs = {}
        for r in instr_rows:
            iid = r["instrument_id"]
            instrs[iid] = instrs.get(iid, 0) + r["lots"]

        for iid, csv_lots in instrs.items():
            phases = phase_map.get(iid, [])

            # Method 1: date_td — find phases whose lots cluster in this month
            td_phases = [
                pid for pid, seq, proj in phases
                if pid not in assigned_phases and td_map[pid].get((yr, mo), 0) > 0
            ]
            if td_phases:
                for pid in td_phases:
                    td_count = td_map[pid][(yr, mo)]
                    assignments.append((
                        pid, "HIGH",
                        f"date_td: {td_count} lots in {yr}-{mo:02d}"
                    ))
                    assigned_phases.add(pid)
                continue

            # Method 2: sequential — next unassigned phase for this instrument
            for pid, seq, proj in phases:
                if pid in assigned_phases:
                    continue
                # Determine confidence from lot count match
                if proj is None:
                    conf = "LOW"
                    note = f"seq={seq}, proj=unknown, csv={csv_lots:.0f}"
                elif abs(proj - csv_lots) <= 2:
                    conf = "HIGH"
                    note = f"seq={seq}, proj={proj}, csv={csv_lots:.0f} (exact)"
                elif abs(proj - csv_lots) <= 5:
                    conf = "MEDIUM"
                    note = f"seq={seq}, proj={proj}, csv={csv_lots:.0f} (close)"
                else:
                    conf = "LOW"
                    note = f"seq={seq}, proj={proj}, csv={csv_lots:.0f} (mismatch)"
                assignments.append((pid, conf, note))
                assigned_phases.add(pid)
                break

        results[key] = assignments
    return results


def apply_events(conn, events, phase_assignments, existing_events, dry_run):
    cur = conn.cursor()
    created, skipped, phases_assigned = 0, 0, 0

    for key in sorted(events.keys()):
        eid, yr, mo = key
        if (eid, yr, mo) in existing_events:
            skipped += 1
            continue

        event_date = date(yr, mo, 1)
        assignments = phase_assignments.get(key, [])
        phase_ids = [pid for pid, conf, note in assignments]

        conf_summary = ""
        if assignments:
            confs = [c for _, c, _ in assignments]
            low = confs.count("LOW")
            med = confs.count("MEDIUM")
            hi  = confs.count("HIGH")
            parts = []
            if hi:  parts.append(f"{hi} HIGH")
            if med: parts.append(f"{med} MED")
            if low: parts.append(f"{low} LOW")
            conf_summary = " [" + ", ".join(parts) + "]"

        print(f"  CREATE [{eid}] {yr}-{mo:02d}  phases={[p for p,_,_ in assignments]}{conf_summary}")
        for pid, conf, note in assignments:
            print(f"         phase {pid}: {conf} — {note}")

        if not dry_run:
            cur.execute(
                """
                INSERT INTO devdb.sim_delivery_events
                    (ent_group_id, date_dev_actual, is_auto_created)
                VALUES (%s, %s, false)
                RETURNING delivery_event_id
                """,
                (eid, event_date),
            )
            dev_event_id = cur.fetchone()[0]
            for pid in phase_ids:
                cur.execute(
                    "INSERT INTO devdb.sim_delivery_event_phases (delivery_event_id, phase_id) VALUES (%s, %s)",
                    (dev_event_id, pid),
                )
            conn.commit()
            phases_assigned += len(phase_ids)

        created += 1

    cur.close()
    return created, skipped, phases_assigned


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", default=DEFAULT_CSV)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--ent-group", type=int, default=None)
    args = parser.parse_args()

    dry_run = not args.apply
    if dry_run:
        print("DRY RUN — pass --apply to write\n")

    conn = psycopg2.connect(**DB)

    dev_name_map, phase_map, existing_events, assigned_phases = load_db_state(conn)
    td_map = load_date_td_map(conn)

    print(f"Existing historical events in DB: {len(existing_events)}")
    print(f"Phases already assigned to events: {len(assigned_phases)}")
    print(f"Instruments in DB: {len(phase_map)}")
    print()

    csv_events, unresolved = parse_csv_events(args.csv, dev_name_map)

    if args.ent_group:
        csv_events = {k: v for k, v in csv_events.items() if k[0] == args.ent_group}

    if unresolved:
        print(f"Unresolved CSV dev names (skipped): {sorted(unresolved)}\n")

    phase_assignments = auto_assign_phases(
        csv_events, phase_map, td_map, set(assigned_phases)
    )

    print(f"Historical events to process: {len(csv_events)}")
    print()

    created, skipped, phases_assigned = apply_events(
        conn, csv_events, phase_assignments, existing_events, dry_run
    )

    print()
    print(f"Summary: {created} events {'created' if not dry_run else 'would create'}, "
          f"{skipped} skipped (already exist), "
          f"{phases_assigned} phases {'assigned' if not dry_run else 'would assign'}")

    conn.close()


if __name__ == "__main__":
    main()
