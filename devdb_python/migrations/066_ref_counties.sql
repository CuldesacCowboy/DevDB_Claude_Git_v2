-- Migration 066: ref_counties reference table.
--
-- Each county belongs to a state via state_id FK.
-- OFFSITE (state XX) and OTHER (state ZZ) are sentinel rows used when a
-- community or lot is outside the normal service area.
--
-- state_id values resolved by joining ref_states on state_abbr:
--   MI = state_id for Michigan
--   XX = OFFSITE sentinel state
--   ZZ = OTHER sentinel state

CREATE TABLE IF NOT EXISTS devdb.ref_counties (
    county_id   SERIAL PRIMARY KEY,
    county_name TEXT NOT NULL,
    state_id    INT  NOT NULL REFERENCES devdb.ref_states(state_id)
);

DELETE FROM devdb.ref_counties;

INSERT INTO devdb.ref_counties (county_name, state_id)
SELECT v.county_name, s.state_id
FROM (VALUES
    ('Kent',        'MI'),
    ('Ottawa',      'MI'),
    ('Muskegon',    'MI'),
    ('Kalamazoo',   'MI'),
    ('Clinton',     'MI'),
    ('Ingham',      'MI'),
    ('Eaton',       'MI'),
    ('Allegan',     'MI'),
    ('Newaygo',     'MI'),
    ('Van Buren',   'MI'),
    ('Montcalm',    'MI'),
    ('OFFSITE',     'XX'),
    ('OTHER',       'ZZ')
) AS v(county_name, state_abbr)
JOIN devdb.ref_states s ON s.state_abbr = v.state_abbr;
