# DevDB × FinancialTracker: Cash Flow Integration Roadmap

## Status: Design Complete, Implementation Next

Both projects owned by same agent. DevDB at C:\DevDB_Claude_Git_v2, FT at C:\DevDB_FinancialTracker_v1.
Same PostgreSQL instance (devdb schema + marks_mirror DB). Same machine, same filesystem.

---

## The Integration

DevDB provides the **timeline** (when lots start, complete, close — projected forward 7+ years).
FinancialTracker provides the **dollars** (what each lot costs and sells for).
Together: **projected cash flow** grounded in actual construction schedules.

## Architecture Decision

Cash flow engine lives in **FinancialTracker** (Option A). FT already has P&L, budgets, investors.
FT queries DevDB's `devdb` schema directly via cross-schema SQL (same Postgres instance).

## Implementation Phases

### Phase 1: Entity Mapping
- Add `devdb_ent_group_id` column to FT's `projects` table (links FT project to DevDB community)
- Build mapping UI: dropdown in FT project settings to link a DevDB community
- Query: `SELECT ent_group_id, ent_group_name FROM devdb.sim_entitlement_groups`

### Phase 2: Closings Projection Feed
- FT reads `devdb.v_sim_ledger_monthly` for linked community
- Extract `cls_plan` (closings per month) by dev_id
- Map DevDB dev_id → FT phase via `marks_dev_code` match
- Result: per-phase monthly closings schedule

### Phase 3: Revenue Timing
- For each projected closing month: multiply by avg revenue per lot (from FT budget/actuals)
- Revenue source priority: FT lot_sales avg (actuals) → FT budget_revenue_lines (pro-forma) → fallback
- Result: monthly projected revenue inflow

### Phase 4: Cost Timing
- Phase delivery date from DevDB → land cost draw (from FT phase allocation)
- Construction start date from DevDB → construction cost curve (from FT budget per-lot cost)
- Build lag curves from DevDB → cost recognition over construction period
- Result: monthly projected cost outflow

### Phase 5: Cash Flow View
- New FT tab: "Projected Cash Flow" per project
- Monthly grid: inflows (closings × revenue), outflows (land + construction + overhead), net, cumulative
- Chart: cumulative cash flow curve with cash-positive date marker
- Reads fresh from DevDB projection on each load (always current)

### Phase 6: Portfolio Cash Dashboard
- Company-wide rollup across all linked projects
- Total monthly inflow/outflow, peak cash need, cash-positive dates
- Reuses DevDB's portfolio aggregation pattern

### Phase 7: Scenario Overlay
- FT reads DevDB scenario results (`devdb.sim_scenario_results` or `devdb.sim_projection_lots`)
- Produces two cash flow curves: base + scenario
- Delta view: financial impact of operational changes

## Key Data Contracts

### DevDB → FT (read via cross-schema query)

| DevDB Table/View | FT Consumer | Data |
|---|---|---|
| `devdb.sim_entitlement_groups` | Project linking | ent_group_id, ent_group_name |
| `devdb.v_sim_ledger_monthly` | Monthly closings | cls_plan, str_plan, cmp_plan by dev_id/month |
| `devdb.sim_projection_lots` | Lot-level dates | date_str, date_cmp, date_cls per lot |
| `devdb.sim_dev_phases` | Delivery schedule | date_dev_projected per phase |
| `devdb.developments` | Dev code match | dev_id, marks_code |
| `devdb.sim_scenario_results` | Scenario comparison | Same shape as ledger monthly |

### FT Internal (existing)

| FT Table | Cash Flow Role |
|---|---|
| `phase_allocations` (current) | Land cost per phase |
| `budget_items` | Construction cost per lot |
| `lot_sales` | Actual revenue per lot |
| `budget_revenue_lines` | Projected revenue per unit type |
| `annual_expenses` | Overhead per year |
| `investor_contributions` | Capital inflows |
| `investor_payouts` | Distribution outflows |

## What Makes This Transformative

1. **Automated**: Change a starts target → cash flow updates in seconds
2. **Lot-level**: Not "12 closings/yr" but "lot DC00000005 closes Mar 2027 at $485K"
3. **Scenario-aware**: "What if 16/yr?" instantly shows financial impact
4. **Always current**: Both systems read MARKS; projections update on every sim run
5. **Decision support**: "Can we afford to buy this parcel?" answered with data

## Next Action

Start with Phase 1-2: entity mapping + closings feed. This is the foundation everything else builds on.
Work in the FinancialTracker project directory. DevDB side needs no changes — it already exposes everything via the `devdb` schema.
