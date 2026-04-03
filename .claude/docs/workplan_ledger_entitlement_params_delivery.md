# Work Plan: Ledger Balance, Entitlement Date Model, Parameter Surfacing, Delivery Scheduling
*Created: 2026-04-03 | Status: In progress*

---

## How to use this document

Each section ends with a **STOP — decision needed** block. Do not begin the next section until you have confirmed decisions in the current one. Sections that are purely implementation (no decisions) are marked **IMPLEMENT — no decisions needed**.

---

## Section 1 — Ledger Balance: Verify the d_end/e_end fix

**IMPLEMENT — no decisions needed**

### What was fixed
The `d_end` and `e_end` buckets in `v_sim_ledger_monthly` were missing the
`COALESCE(date_str, date_str_projected)` guard. Any real D-status or E-status lot
whose `date_str_projected` had passed was simultaneously counted in its own bucket
AND in `uc_end`. Fixed in commit fe73dc3.

### What to do
1. Re-run the simulation for ent_group 9002 (Waterton Station).
2. Look at the June 2023 total in the monthly ledger for All Product Types. It should now hold at 360 (not 364).
3. Confirm in writing before proceeding.

### Remaining known issue (addressed in Section 2)
October 2020 total = 0 on the entitlement month. Root cause is **not** the bucket
logic — it is the date model. The UI frontend recomputes `p_end` as
`totalPlannedLots - entitledSoFar`. In October 2020, `ent_plan = 360` so
`entitledSoFar = 360` and UI sets `p_end = 0`. Simultaneously, the DB view's
`e_end` is also 0 because `date_ent_actual` on the ent group may be stored as a
mid-month date (e.g., 2020-10-15), which does NOT satisfy `date_ent <= 2020-10-01`
(the spine's first-of-month). The total drops to 0 for that one month.

This is fixed structurally by Section 2 (phase-level date model), not by patching
the view. Do not attempt to patch the view for this.

---

## Section 2 — Entitlements Date: Move to Phase Level

**STOP — decisions needed before implementation**

### Current behavior
`date_ent_actual` lives on `sim_entitlement_groups`. The coordinator re-stamps
`date_ent = group.date_ent_actual` on every `sim_lots` row after each dev's starts
pipeline run. The simulation page has an "Entitlements Date" field that writes to
`sim_entitlement_groups.date_ent_actual`.

### Problem
- One date stamps ALL lots across ALL devs in the group. No per-dev or per-phase
  resolution.
- If `date_ent_actual` is stored as any day other than the 1st of the month, the
  ledger spine (which uses first-of-month calendar months) will show a one-month gap
  where `p_end = 0` AND `e_end = 0` on the entitlement month itself.

### Proposed change
Move `date_ent` to the **phase level** (`sim_dev_phases`). When the user sets the
Entitlements Date on the simulation page, write that date to all phases belonging to
that development. The coordinator then reads `phase.date_ent` and stamps
`sim_lots.date_ent` from the phase the lot belongs to (not from the group-level field).

**Why phase level?** Eventually different phases may have different entitlement
dates (a later phase may be entitled separately). Putting the anchor at the phase
level is the correct architectural home. For now it will still be one date per dev
(you set it once and it propagates to all phases in that dev).

### Implementation steps (once decisions confirmed)
1. Migration: `ALTER TABLE sim_dev_phases ADD COLUMN IF NOT EXISTS date_ent DATE`.
2. API change: PUT `/entitlement-groups/{id}/ledger-config` — when `date_ent` is
   submitted, write to `sim_dev_phases.date_ent` for all phases in all devs of that
   group (instead of writing to `sim_entitlement_groups.date_ent_actual`).
3. Coordinator change: `_group_date_ent` → read `phase.date_ent` per lot's
   `phase_id`; stamp `sim_lots.date_ent = phase.date_ent` (not a group-wide update).
4. Keep `sim_entitlement_groups.date_ent_actual` as read-only legacy field (do not
   drop it yet — other queries may reference it).
5. Ensure `date_ent` is always stored as the **first of the month** (truncate before
   writing). This eliminates the mid-month gap in the ledger.

### STOP — decisions needed

**Decision 2-A:** Should the Entitlements Date remain one date per dev (all phases
in a dev share the same date), or should it be settable per phase independently?
*(Recommended: per dev for now, per phase in future — confirm.)*

**Decision 2-B:** Should the "Entitlements Date" label on the simulation page stay
as-is, or do you want it renamed? If so, to what?

**Decision 2-C:** The coordinator currently re-stamps ALL lots in a dev with the
same `date_ent`. With phase-level dates, lots in different phases could have
different `date_ent` values. Is that acceptable now, or should all phases within a
dev continue to share the same date?

---

## Section 3 — "First Paper Lots" Rename and Phase-Level Anchor

**STOP — decisions needed before implementation**

### Current behavior
`date_paper` on `sim_entitlement_groups` serves two purposes:
1. **Ledger start date**: the frontend filters rows to `calendar_month >= date_paper`.
2. **Semantic anchor**: marks when the development first had paper (pre-entitlement) lots.

### Problem
- Name "First Paper Lots" is confusing — it sounds like a count, not a date.
- The date currently lives at the group level and has no effect on lot-level data.
- Per your request: this date should also sit at the phase level and propagate
  downward so lots know their "plan start" date.

### Proposed new name
**"Plan Start Date"** — the date on which this development's lot planning begins.
This aligns with how it is used: it anchors the ledger and represents the beginning
of the project's planning horizon.

*Alternative options to consider:* "Pre-Development Date", "Paper Date",
"Land Close Date", "Project Start".

### Proposed change
1. Rename the field in the UI from "First Paper Lots" → "Plan Start Date".
2. Add `date_plan_start DATE` column to `sim_dev_phases` via migration.
3. When user saves the Plan Start Date on the simulation page, write to all phases
   for the relevant dev(s) in the ent group, in addition to `sim_entitlement_groups.date_paper`.
4. `sim_entitlement_groups.date_paper` continues to drive the ledger start date
   filter (no change to that logic).
5. `sim_dev_phases.date_plan_start` is available for future engine use (e.g., as
   the earliest valid demand date for a phase).

### STOP — decisions needed

**Decision 3-A:** Approve or change the new field name. Options: "Plan Start Date",
"Pre-Development Date", "Paper Date", "Land Close Date", "Project Start".

**Decision 3-B:** Should Plan Start Date be one date per dev (propagates to all
phases in the dev) or settable per phase? *(Recommended: per dev for now.)*

**Decision 3-C:** The current "First Paper Lots" date also drives the ledger start
filter. Should the ledger start filter remain tied to this date, or should it become
a separate field? *(Recommended: keep them the same field for now.)*

---

## Section 4 — Parameter Inventory and Surfacing Plan

**STOP — decisions needed before implementation**

### Currently surfaced to the user (simulation page)

| Parameter | Location | Description |
|---|---|---|
| Annual starts target | Per dev (starts targets section) | Drives monthly demand pace |
| Floor tolerances: min P/E/D/U/UC/C | Delivery config section | Highlights ledger when below floor |
| First Paper Lots (date_paper) | Ledger config section | Ledger start date |
| Entitlements Date (date_ent_actual) | Ledger config section | Groups lots by entitlement month |

### Parameters that exist but are NOT surfaced to user

#### Per-development (sim_dev_params)
| Parameter | Column | Default | Notes |
|---|---|---|---|
| Max starts per month | `max_starts_per_month` | NULL (no cap) | Caps monthly starts regardless of annual target |
| Seasonal weight set | `seasonal_weight_set` | `balanced_2yr` | Controls which monthly weight curve to use for distributing annual starts |

#### Per-entitlement-group delivery config (sim_entitlement_delivery_config)
| Parameter | Column | Default | Notes |
|---|---|---|---|
| Auto-schedule on/off | `auto_schedule_enabled` | (depends) | Toggles whether placeholder events are rebuilt each run |
| Delivery window start | `delivery_window_start` | 5 (May) | Earliest month (1-12) a delivery event can be scheduled |
| Delivery window end | `delivery_window_end` | 11 (Nov) | Latest month (1-12) a delivery event can be scheduled |
| Max deliveries per year | `max_deliveries_per_year` | 1 | Maximum number of auto-scheduled delivery events per calendar year |
| Min gap between deliveries | `min_gap_months` | 0 | Minimum months between consecutive delivery events |

#### TDA checkpoints (sim_takedown_checkpoints)
| Parameter | Column | Default | Notes |
|---|---|---|---|
| Checkpoint lead days | `checkpoint_lead_days` | 16 | Days before checkpoint date that a hold (date_td_hold) is written to lot |

#### Hardcoded constants (coordinator.py)
| Parameter | Value | Location | Notes |
|---|---|---|---|
| Default str→cmp lag | 270 days | `DEFAULT_CMP_LAG` in coordinator.py | Fallback when no empirical build lag curve exists for a lot type |
| Default cmp→cls lag | 45 days | `DEFAULT_CLS_LAG` in coordinator.py | Fallback when no empirical build lag curve exists for a lot type |
| Max convergence iterations | 10 | `max_iterations=10` in coordinator.py | Safety limit — normal convergence is 1 iteration |

#### Build lag curves (sim_build_lag_curves table)
Empirical P10/P25/P50/P75/P90 percentile curves for `str_to_cmp` and `cmp_to_cls`
by lot_type_id. Currently a database table with no UI. The coordinator samples from
these curves to assign `date_cmp` and `date_cls` to sim lots.

### Recommended surfacing plan (requires your decisions)

**Recommend surfacing (add to simulation page):**
- `max_starts_per_month` — practical cap for operational scheduling; easy to misset
  annual target without this. Low risk to expose.
- `delivery_window_start` / `delivery_window_end` — currently hardcoded to May-Nov
  in config. User should control this.
- `auto_schedule_enabled` — user should be able to turn off auto-scheduling.
- `max_deliveries_per_year` — currently 1; user should control.

**Recommend surfacing (future, not immediately):**
- `seasonal_weight_set` — needs a UI that shows the curve options meaningfully.
- Build lag curves — complex; needs a dedicated editor UI.
- `checkpoint_lead_days` — currently on TDA checkpoint form; could stay there.

**Recommend keeping hardcoded (for now):**
- `DEFAULT_CMP_LAG` / `DEFAULT_CLS_LAG` — only used as fallback when no curve
  data exists. Surfacing adds complexity for an edge-case fallback.
- `max_iterations` — internal engine safety valve; not user-facing.
- `min_gap_months` — currently 0; only relevant for groups with multiple deliveries
  per year. Expose only when needed.

### STOP — decisions needed

**Decision 4-A:** Approve or modify the surfacing plan above. For each parameter
recommended for surfacing, confirm whether to add it to the simulation page now.

**Decision 4-B:** Should the delivery config parameters (window, max per year,
auto-schedule toggle) live in a new "Delivery Config" section on the simulation
page, or be folded into the existing settings sections?

**Decision 4-C:** For build lag curves — the current fallback values (270/45 days)
are hardcoded. Should these fallback constants be moved to the delivery config table
or to sim_dev_params so they're editable without a code change?

---

## Section 5 — Delivery Event Scheduling Fix

**IMPLEMENT — no decisions needed. Highest priority: implement today.**

### Problem statement
Months exist where a development's D-status inventory (Developed, awaiting takedown)
drops to zero between the last confirmed delivery event and the next auto-scheduled
event. The requirement: from the moment the last locked delivery event occurs, D
inventory MUST NEVER reach zero until all entitlement inventory has been consumed.

### Root cause (confirmed by code analysis)

`_find_violation_month` in `p0000_placeholder_rebuilder.py`:

```python
def _find_violation_month(dev_id_key: int, scan_floor: date) -> date | None:
    bal = d_balance.get(dev_id_key, {})
    for m in sorted(bal.keys()):
        if m <= scan_floor:
            continue
        if bal[m] < min_buffer:   # ← BUG: uses strict less-than
            return m
    return None
```

When `min_d_count` is not configured (defaults to 0), `min_buffer = 0`. The
condition `bal[m] < 0` can never be satisfied for a non-negative d_balance. The
function always returns `None`. The D-floor protection is **completely disabled**.
Scheduling then falls through to the `demand_date` fallback, which schedules based
on when starts are needed — not when D inventory will be exhausted.

### The fix

Change `bal[m] < min_buffer` → `bal[m] <= min_buffer`.

With this fix:
- `min_buffer = 0`: violation fires when D hits 0 (true exhaustion). Delivery is
  scheduled at the latest window month before exhaustion.
- `min_buffer = N > 0`: violation fires when D drops to N or below. Delivery
  is scheduled to maintain at least N lots in D at all times.

### Additional hardening to apply in the same change

1. **Scan horizon**: the d_balance query currently goes 10 years forward. Replace
   `INTERVAL '10 years'` with the group's sellout horizon (MAX date_cls across all
   sim lots) or 30 years — whichever is larger — to ensure violations near the end
   of the projection are detected.

2. **Demand-date fallback removed**: once the D-floor analysis works correctly,
   remove the fallback path that uses `demand_date` as the scheduling anchor. The
   D-balance analysis is the authoritative mechanism. The `demand_date` should
   remain as a signal only (for phases where d_balance never shows a violation
   because they have no sim lots from locked phases yet — handle as: if no
   d_balance data exists for a phase's dev, schedule at `max(today_first, demand_date_window_snap)`).

3. **Per-dev constraint correctness**: `last_event_year` is currently a global
   counter shared across all devs. D-119 says no auto-scheduled event in the same
   year as the **last locked** event. Verify this is scoped per-dev (or that the
   cross-dev bundling makes global correct).

### Verification after fix
After implementing and re-running the simulation:
- Inspect `v_sim_ledger_monthly` for all devs in ent_group 9002.
- Confirm D_end > 0 for every month from the last locked delivery date forward,
  until the phase sequence is exhausted.
- Confirm that where D_end does eventually reach 0, it is because all lots have
  moved to U/UC/C/Closed (no more entitlement inventory to develop), not because
  a delivery event arrived too late.

---

## Sequence summary

```
Section 5 (Delivery Fix) — implement NOW, no decisions needed
    ↓
Section 1 (Verify Jun 2023 = 360) — re-run sim, confirm
    ↓  STOP: confirm Jun 2023 is fixed
Section 2 (Entitlements Date → phase level) — decisions 2-A, 2-B, 2-C
    ↓  STOP: get decisions
Section 3 (First Paper Lots rename + phase level) — decisions 3-A, 3-B, 3-C
    ↓  STOP: get decisions
Section 4 (Parameter surfacing) — decisions 4-A, 4-B, 4-C
    ↓  STOP: get decisions, then implement approved parameters
```
