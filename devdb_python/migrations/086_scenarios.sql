-- 086_scenarios.sql
-- Scenario comparison: named parameter override sets with stored results.

CREATE TABLE IF NOT EXISTS sim_scenarios (
    scenario_id    SERIAL PRIMARY KEY,
    ent_group_id   INT NOT NULL,
    scenario_name  TEXT NOT NULL,
    description    TEXT,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    updated_at     TIMESTAMPTZ DEFAULT NOW(),
    last_run_at    TIMESTAMPTZ,
    UNIQUE(ent_group_id, scenario_name)
);

CREATE TABLE IF NOT EXISTS sim_scenario_overrides (
    override_id   SERIAL PRIMARY KEY,
    scenario_id   INT NOT NULL REFERENCES sim_scenarios(scenario_id) ON DELETE CASCADE,
    scope         TEXT NOT NULL CHECK (scope IN ('dev', 'instrument', 'ent_group')),
    scope_id      INT NOT NULL,
    param_name    TEXT NOT NULL,
    param_value   JSONB NOT NULL,
    UNIQUE(scenario_id, scope, scope_id, param_name)
);

CREATE TABLE IF NOT EXISTS sim_scenario_results (
    result_id       SERIAL PRIMARY KEY,
    scenario_id     INT NOT NULL REFERENCES sim_scenarios(scenario_id) ON DELETE CASCADE,
    dev_id          INT NOT NULL,
    calendar_month  DATE NOT NULL,
    ent_plan        INT DEFAULT 0,
    dev_plan        INT DEFAULT 0,
    td_plan         INT DEFAULT 0,
    str_plan        INT DEFAULT 0,
    str_plan_spec   INT DEFAULT 0,
    str_plan_build  INT DEFAULT 0,
    cmp_plan        INT DEFAULT 0,
    cls_plan        INT DEFAULT 0,
    p_end           INT DEFAULT 0,
    e_end           INT DEFAULT 0,
    d_end           INT DEFAULT 0,
    h_end           INT DEFAULT 0,
    u_end           INT DEFAULT 0,
    uc_end          INT DEFAULT 0,
    c_end           INT DEFAULT 0,
    closed_cumulative INT DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_scenario_results ON sim_scenario_results(scenario_id, dev_id, calendar_month);
