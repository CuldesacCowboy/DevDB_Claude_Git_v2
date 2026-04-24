"""
delivery_event_writer -- Persist delivery events and predecessor links to DB.

Owns: INSERT delivery events + phase links, INSERT predecessor rows
      (intra-dev sequence + cross-tier enforcement).
"""

import logging
from collections import defaultdict
from .connection import DBConnection

logger = logging.getLogger(__name__)

def write_new_events(conn, ent_group_id: int, events_to_create: list,
                      valid_months: frozenset) -> list:
    """Insert delivery events and their phase links. Returns list of new event IDs."""
    new_event_ids = []
    months_list   = sorted(list(valid_months))

    for i, ev in enumerate(events_to_create, start=1):
        seq_df    = conn.read_df("SELECT nextval('devdb.sim_delivery_events_id_seq') AS next_id")
        event_id  = int(seq_df.iloc[0]["next_id"])
        event_name     = f"Auto-scheduled delivery {i}"
        projected_date = ev["date"].strftime("%Y-%m-%d")

        conn.execute(
            """
            INSERT INTO sim_delivery_events
                (delivery_event_id, ent_group_id, event_name,
                 delivery_months,
                 date_dev_actual, date_dev_projected,
                 is_auto_created, is_placeholder,
                 created_at, updated_at)
            VALUES (
                %s, %s, %s,
                %s,
                NULL, %s,
                TRUE, TRUE,
                current_timestamp, current_timestamp
            )
            """,
            (event_id, ent_group_id, event_name, months_list, projected_date),
        )
        for ph_id in ev["phases"]:
            link_seq_df  = conn.read_df("SELECT nextval('devdb.sim_delivery_event_phases_id_seq') AS next_id")
            next_link_id = int(link_seq_df.iloc[0]["next_id"])
            conn.execute(
                "INSERT INTO sim_delivery_event_phases (id, delivery_event_id, phase_id) VALUES (%s, %s, %s)",
                (next_link_id, event_id, ph_id),
            )
        new_event_ids.append(event_id)

    logger.info(
        f"placeholder_rebuilder: Created {len(new_event_ids)} placeholder delivery event(s) "
        f"for ent_group_id={ent_group_id}."
    )
    return new_event_ids


# ---------------------------------------------------------------------------
# Step 7 — Write predecessor links (intra-dev sequence + tier enforcement)
# ---------------------------------------------------------------------------

def write_predecessor_links(conn, ent_group_id: int, events_to_create: list,
                              new_event_ids: list, all_phases_df, locked_phase_ids: set) -> None:
    """
    Write sim_delivery_event_predecessors rows for:
      7   — intra-dev sequence (consecutive placeholder events per dev)
      7c  — locked-anchor predecessors (first placeholder anchored to latest locked event per dev)
      7b  — cross-tier predecessors (tier-N events must follow all tier-(N-1) events)
    """
    phase_dev_map = {
        int(r["phase_id"]): int(r["dev_id"])
        for _, r in all_phases_df.iterrows()
    }

    # Step 7: Intra-dev sequence
    dev_event_sequence: dict[int, list[int]] = defaultdict(list)
    for ev_dict, event_id in zip(events_to_create, new_event_ids):
        devs_seen: set[int] = set()
        for ph_id in ev_dict["phases"]:
            dev_id = phase_dev_map.get(ph_id)
            if dev_id is not None and dev_id not in devs_seen:
                dev_event_sequence[dev_id].append(event_id)
                devs_seen.add(dev_id)

    pred_count = 0
    for dev_id, event_ids in dev_event_sequence.items():
        for i in range(1, len(event_ids)):
            conn.execute(
                "INSERT INTO sim_delivery_event_predecessors (event_id, predecessor_event_id) VALUES (%s, %s)",
                (event_ids[i], event_ids[i - 1]),
            )
            pred_count += 1
    if pred_count:
        logger.info(f"placeholder_rebuilder: Created {pred_count} intra-dev sequence predecessor row(s).")

    # Step 7c: Locked-anchor predecessors
    if locked_phase_ids and dev_event_sequence:
        anchor_df = conn.read_df(
            """
            SELECT sdp.dev_id, dep.delivery_event_id,
                   MAX(sdp.sequence_number) AS max_seq
            FROM sim_delivery_event_phases dep
            JOIN sim_delivery_events sde
                 ON sde.delivery_event_id = dep.delivery_event_id
            JOIN sim_dev_phases sdp ON sdp.phase_id = dep.phase_id
            WHERE sde.ent_group_id = %s
              AND sde.date_dev_actual IS NOT NULL
            GROUP BY sdp.dev_id, dep.delivery_event_id
            """,
            (ent_group_id,),
        )
        dev_anchor: dict[int, tuple[int, int]] = {}
        for _, r in anchor_df.iterrows():
            dev_id = int(r["dev_id"])
            ev_id  = int(r["delivery_event_id"])
            seq    = int(r["max_seq"]) if r["max_seq"] is not None else 0
            if dev_id not in dev_anchor or seq > dev_anchor[dev_id][1]:
                dev_anchor[dev_id] = (ev_id, seq)

        anchor_pred_count = 0
        for dev_id, placeholder_event_ids in dev_event_sequence.items():
            if dev_id not in dev_anchor or not placeholder_event_ids:
                continue
            anchor_ev_id, _ = dev_anchor[dev_id]
            first_placeholder = placeholder_event_ids[0]
            conn.execute(
                "INSERT INTO sim_delivery_event_predecessors (event_id, predecessor_event_id) VALUES (%s, %s)",
                (first_placeholder, anchor_ev_id),
            )
            anchor_pred_count += 1
            logger.info(f"placeholder_rebuilder: Dev {dev_id}: anchor predecessor event {first_placeholder} → locked event {anchor_ev_id}.")
        if anchor_pred_count:
            logger.info(f"placeholder_rebuilder: Created {anchor_pred_count} locked-anchor predecessor row(s).")

    # Step 7b: Cross-tier predecessors
    tier_df = conn.read_df(
        """
        SELECT sdp.phase_id, sdp.delivery_tier
        FROM sim_dev_phases sdp
        JOIN sim_ent_group_developments egd ON egd.dev_id = sdp.dev_id
        WHERE egd.ent_group_id = %s
          AND sdp.delivery_tier IS NOT NULL
        """,
        (ent_group_id,),
    )
    if tier_df.empty:
        return

    phase_tier_map = {int(r["phase_id"]): int(r["delivery_tier"]) for _, r in tier_df.iterrows()}
    event_tiers: dict[int, set[int]] = {}

    for ev_dict, ev_id in zip(events_to_create, new_event_ids):
        tiers = {phase_tier_map[ph] for ph in ev_dict["phases"] if ph in phase_tier_map}
        if tiers:
            event_tiers[ev_id] = tiers

    if locked_phase_ids:
        locked_ev_df = conn.read_df(
            """
            SELECT dep.delivery_event_id, dep.phase_id
            FROM sim_delivery_event_phases dep
            JOIN sim_delivery_events sde
                 ON sde.delivery_event_id = dep.delivery_event_id
            WHERE sde.ent_group_id = %s
              AND sde.date_dev_actual IS NOT NULL
            """,
            (ent_group_id,),
        )
        for _, r in locked_ev_df.iterrows():
            ev_id = int(r["delivery_event_id"])
            t     = phase_tier_map.get(int(r["phase_id"]))
            if t is not None:
                event_tiers.setdefault(ev_id, set()).add(t)

    tier_to_events: dict[int, list[int]] = defaultdict(list)
    for ev_id, tiers in event_tiers.items():
        for t in tiers:
            tier_to_events[t].append(ev_id)

    tier_pred_count  = 0
    tier_pairs_written: set[tuple[int, int]] = set()
    for tier_n in sorted(tier_to_events.keys()):
        tier_n1 = tier_n - 1
        if tier_n1 not in tier_to_events:
            continue
        for ev_n in tier_to_events[tier_n]:
            for ev_n1 in tier_to_events[tier_n1]:
                if ev_n == ev_n1:
                    continue
                pair = (ev_n, ev_n1)
                if pair in tier_pairs_written:
                    continue
                tier_pairs_written.add(pair)
                conn.execute(
                    "INSERT INTO sim_delivery_event_predecessors (event_id, predecessor_event_id) VALUES (%s, %s)",
                    (ev_n, ev_n1),
                )
                tier_pred_count += 1
    if tier_pred_count:
        logger.info(f"placeholder_rebuilder: Created {tier_pred_count} cross-tier predecessor row(s).")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

