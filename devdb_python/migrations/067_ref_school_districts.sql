-- Migration 067: ref_school_districts reference table.
--
-- county_id is the district's primary home county (used to filter SD dropdowns
-- when a county is already selected). NULL = district's home county is outside
-- the current ref_counties list (e.g. Berrien, Ionia, Barry counties).
--
-- quality_grade: A/B/C/D/F rating; NULL for sentinel rows (OFFSITE, OTHER).
-- sd_code: 4-char code from legacy Access system.

CREATE TABLE IF NOT EXISTS devdb.ref_school_districts (
    sd_id          SERIAL PRIMARY KEY,
    district_name  TEXT    NOT NULL,
    sd_code        CHAR(4) NOT NULL UNIQUE,
    quality_grade  CHAR(1),
    county_id      INT     REFERENCES devdb.ref_counties(county_id)
);

DELETE FROM devdb.ref_school_districts;

-- Districts with a known home county in ref_counties
INSERT INTO devdb.ref_school_districts (district_name, sd_code, quality_grade, county_id)
SELECT v.district_name, v.sd_code, v.quality_grade, c.county_id
FROM (VALUES
    ('Allendale',         'ALLE', 'B', 'Ottawa'),
    ('Black River',       'BRIV', 'A', 'Ottawa'),
    ('Coopersville',      'COOP', 'B', 'Ottawa'),
    ('Grand Haven',       'GHAV', 'B', 'Ottawa'),
    ('Holland City',      'HOLL', 'D', 'Ottawa'),
    ('Hudsonville',       'HUDS', 'A', 'Ottawa'),
    ('Jenison',           'JENI', 'A', 'Ottawa'),
    ('Spring Lake',       'SPLK', 'A', 'Ottawa'),
    ('West Ottawa',       'WOTT', 'C', 'Ottawa'),
    ('Zeeland',           'ZEEL', 'B', 'Ottawa'),
    ('Byron Center',      'BCTR', 'A', 'Kent'),
    ('Caledonia',         'CALE', 'A', 'Kent'),
    ('Cedar Springs',     'CDSP', 'B', 'Kent'),
    ('Comstock Park',     'CPAR', 'C', 'Kent'),
    ('East Grand Rapids', 'EGRR', 'A', 'Kent'),
    ('Forest Hills',      'FORE', 'A', 'Kent'),
    ('Godfrey Lee',       'GLEE', 'F', 'Kent'),
    ('Godwin Heights',    'GHEI', 'F', 'Kent'),
    ('Grand Rapids',      'GRRP', 'F', 'Kent'),
    ('Grandville',        'GVIL', 'B', 'Kent'),
    ('Kellogsville',      'KELL', 'F', 'Kent'),
    ('Kenowa Hills',      'KHIL', 'D', 'Kent'),
    ('Kent City',         'KCTY', 'D', 'Kent'),
    ('Kentwood',          'KENT', 'D', 'Kent'),
    ('Lowell',            'LOWE', 'A', 'Kent'),
    ('Northview',         'NORT', 'C', 'Kent'),
    ('Oakridge',          'OAKR', 'F', 'Kent'),
    ('Rockford',          'ROCK', 'A', 'Kent'),
    ('Sparta',            'SPAR', 'C', 'Kent'),
    ('Wyoming',           'WYOM', 'F', 'Kent'),
    ('Fruitport',         'FRUI', 'C', 'Muskegon'),
    ('Mona Shores',       'MONA', 'D', 'Muskegon'),
    ('Muskegon',          'MUSK', 'F', 'Muskegon'),
    ('Ravenna',           'RAVE', 'D', 'Muskegon'),
    ('Reeths-Puffer',     'RPUF', 'D', 'Muskegon'),
    ('Kalamazoo',         'KZOO', 'D', 'Kalamazoo'),
    ('Parchment',         'PARC', 'D', 'Kalamazoo'),
    ('Portage',           'PORT', 'B', 'Kalamazoo'),
    ('Hamilton',          'HAMI', 'B', 'Allegan'),
    ('Otsego',            'OTSE', 'B', 'Allegan'),
    ('Plainwell',         'PLAI', 'C', 'Allegan'),
    ('Saugatuck',         'SAUG', 'A', 'Allegan'),
    ('Paw Paw',           'PAWP', 'C', 'Van Buren'),
    ('South Haven',       'SHAV', 'D', 'Van Buren'),
    ('Greenville',        'GRNV', 'B', 'Montcalm'),
    ('Wayland',           'WAYL', 'C', 'Allegan')
) AS v(district_name, sd_code, quality_grade, county_name)
JOIN devdb.ref_counties c ON c.county_name = v.county_name;

-- Districts whose home county is not in ref_counties (county_id = NULL)
INSERT INTO devdb.ref_school_districts (district_name, sd_code, quality_grade, county_id) VALUES
('Berrian Springs',    'BRSP', 'D', NULL),
('Saranac',           'SARA', 'B', NULL),
('Thornapple Kellog', 'TKEL', 'B', NULL);

-- Sentinel rows: OFFSITE and OTHER
INSERT INTO devdb.ref_school_districts (district_name, sd_code, quality_grade, county_id)
SELECT v.district_name, v.sd_code, NULL, c.county_id
FROM (VALUES
    ('OFFSITE', 'XXXX', 'OFFSITE'),
    ('OTHER',   'ZZZZ', 'OTHER')
) AS v(district_name, sd_code, county_name)
JOIN devdb.ref_counties c ON c.county_name = v.county_name;
