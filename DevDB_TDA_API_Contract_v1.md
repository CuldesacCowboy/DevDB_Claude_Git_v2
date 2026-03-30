# DevDB TDA API Contract v1

Takedown Agreement endpoints for the TDA form UI.
All endpoints are prefixed with /api.
All responses are JSON. All dates are ISO 8601 strings (YYYY-MM-DD).
All IDs are integers.

---

## 1. GET /api/entitlement-groups/{ent_group_id}/takedown-agreements

Returns the list of TDAs for an entitlement group. Used to populate
the TDA page header and agreement list.

### Path parameters
- ent_group_id (int): the entitlement group

### Response 200
```json
{
  "ent_group_id": 9002,
  "ent_group_name": "Waterton Station",
  "agreements": [
    {
      "tda_id": 1,
      "tda_name": "TDA-2024-01",
      "status": "active",
      "anchor_date": "2024-01-01",
      "total_lots": 10,
      "checkpoint_count": 3
    }
  ]
}
```

---

## 2. GET /api/takedown-agreements/{tda_id}/detail

Returns a single TDA with all checkpoints and all lot assignments.
This is the full payload needed to render the TDA form.

### Path parameters
- tda_id (int): the TDA

### Response 200
```json
{
  "tda_id": 1,
  "tda_name": "TDA-2024-01",
  "status": "active",
  "anchor_date": "2024-01-01",
  "checkpoints": [
    {
      "checkpoint_id": 1,
      "checkpoint_number": 1,
      "checkpoint_name": "CP1",
      "checkpoint_date": "2024-06-30",
      "status": "pending",
      "lots_required_cumulative": 6,
      "lots": [
        {
          "assignment_id": 1,
          "lot_id": 101,
          "lot_number": "WS-101",
          "building_group_id": null,
          "hc_marks_date": "2024-02-10",
          "hc_projected_date": "2024-02-10",
          "hc_is_locked": true,
          "bldr_marks_date": "2024-02-14",
          "bldr_projected_date": "2024-02-14",
          "bldr_is_locked": true
        }
      ]
    }
  ],
  "unassigned_lots": [
    {
      "lot_id": 308,
      "lot_number": "WS-308",
      "building_group_id": null
    }
  ]
}
```

### Notes
- hc_marks_date: read from sim_lots.date_str (actual or projected).
  Null if not yet set. Always read-only — never stored in TDA tables.
- bldr_marks_date: read from sim_lots.date_cmp (actual or projected).
  Null if not yet set. Always read-only — never stored in TDA tables.
- hc_projected_date / bldr_projected_date: stored in
  sim_takedown_lot_assignments. Null until user sets them.
- unassigned_lots: lots linked to this TDA via
  sim_takedown_agreement_lots but not yet assigned to any checkpoint.

---

## 3. PATCH /api/takedown-agreements/{tda_id}/lots/{lot_id}/assign

Assigns a lot to a checkpoint (drag from unassigned bank into a
checkpoint). Creates a row in sim_takedown_lot_assignments.

### Path parameters
- tda_id (int)
- lot_id (int)

### Request body
```json
{ "checkpoint_id": 1 }
```

### Behavior
- Validates that lot_id is linked to this tda_id in
  sim_takedown_agreement_lots. Returns 422 if not.
- Validates that lot_id is not already assigned to any checkpoint
  in this TDA. Returns 409 if already assigned.
- Inserts one row into sim_takedown_lot_assignments with
  hc_is_locked=false, bldr_is_locked=false, dates null.
- Writes to sim_assignment_log (action=assign_lot_to_checkpoint).

### Response 200
```json
{ "assignment_id": 42, "lot_id": 101, "checkpoint_id": 1 }
```

---

## 4. DELETE /api/takedown-agreements/{tda_id}/lots/{lot_id}/assign

Removes a lot from its checkpoint (drag back to unassigned bank).
Deletes the row from sim_takedown_lot_assignments.

### Path parameters
- tda_id (int)
- lot_id (int)

### Behavior
- Looks up the assignment_id for this lot in this TDA.
  Returns 404 if no assignment exists.
- Deletes the row from sim_takedown_lot_assignments.
- Writes to sim_assignment_log (action=unassign_lot_from_checkpoint).

### Response 200
```json
{ "lot_id": 101, "unassigned": true }
```

---

## 5. PATCH /api/tda-lot-assignments/{assignment_id}/dates

Updates HC and/or BLDR projected dates on a lot assignment.
Fans out to building group mates if applicable.

### Path parameters
- assignment_id (int)

### Request body
All fields optional. Only provided fields are updated.
```json
{
  "hc_projected_date": "2024-02-10",
  "bldr_projected_date": "2024-02-14"
}
```

### Behavior
- Updates the specified date fields on the target assignment row.
- If the lot has a building_group_id: finds all other rows in
  sim_takedown_lot_assignments for lots sharing that
  building_group_id within the same tda_id, and applies the same
  date updates to all of them in the same transaction.
- Does not change any lock flags.
- Writes one sim_assignment_log entry per row updated
  (action=update_tda_lot_date).

### Response 200
```json
{
  "assignment_id": 42,
  "updated_assignment_ids": [42, 43, 44],
  "hc_projected_date": "2024-02-10",
  "bldr_projected_date": "2024-02-14"
}
```

### Notes
- updated_assignment_ids includes the target assignment plus all
  building group mates that were updated in the same transaction.
  Will be [assignment_id] when lot has no building group.

---

## 6. PATCH /api/tda-lot-assignments/{assignment_id}/lock

Locks or unlocks the HC and/or BLDR date on a lot assignment.
Fans out to building group mates if applicable.

### Path parameters
- assignment_id (int)

### Request body
All fields optional. Only provided fields are updated.
```json
{
  "hc_is_locked": true,
  "bldr_is_locked": false
}
```

### Behavior
- Updates the specified lock flags on the target assignment row.
- If the lot has a building_group_id: finds all other rows in
  sim_takedown_lot_assignments for lots sharing that
  building_group_id within the same tda_id, and applies the same
  lock changes to all of them in the same transaction.
- Does not change any date fields.
- Writes one sim_assignment_log entry per row updated
  (action=update_tda_lot_lock).

### Response 200
```json
{
  "assignment_id": 42,
  "updated_assignment_ids": [42, 43, 44],
  "hc_is_locked": true,
  "bldr_is_locked": false
}
```

---

## Error responses (all endpoints)

| Status | Meaning |
|--------|---------|
| 404 | Resource not found |
| 409 | Conflict (e.g. lot already assigned) |
| 422 | Validation failure (e.g. lot not in TDA) |
| 500 | Unexpected server error |

---

## Building group fan-out rule (endpoints 5 and 6)

When a lot assignment is updated and the lot belongs to a building
group, the same update must be applied to ALL other lot assignments
sharing that building_group_id within the same tda_id. This is
enforced at the API layer in a single atomic Postgres transaction.
The frontend does not need to know about building groups — it sends
one request and receives back all updated assignment IDs.

---
