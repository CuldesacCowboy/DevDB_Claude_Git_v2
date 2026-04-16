-- Migration 073: Add status to sim_entitlement_groups.
--
-- Manual entry — cannot be derived from lot data.
-- 'Active' vs 'Sold Out' vs 'Unlikely' requires business judgment.
--
-- Allowed values enforced by CHECK constraint.
-- OFFSITE and OTHER sentinels get their own status values.

ALTER TABLE devdb.sim_entitlement_groups
    ADD COLUMN IF NOT EXISTS status VARCHAR(20)
    CHECK (status IN ('Active', 'Prospective', 'Sold Out', 'Unlikely', 'Abandoned', 'OFFSITE', 'OTHER'));

-- Seed from JTB development reference list.
-- DB name differences from source: Laketown Notenbaum = Notenbaum, Prairie Winds West = Prairie Winds.
-- Communities not in source list left NULL: City View Estates, Firestone, Summerset South.
-- Jason Ridge Condos: appears as both Active + Sold Out in source; set Active (active instrument in DevDB).

WITH src (ent_group_name, status) AS (
    VALUES
    ('43 North',                   'Sold Out'),
    ('Abbey Farms',                'Active'),
    ('Alaska Avenue',              'Active'),
    ('Algoma Ortwein',             'Unlikely'),
    ('Alward Estates',             'Sold Out'),
    ('Arlington Park',             'Sold Out'),
    ('Austin Landings',            'Prospective'),
    ('Berryfield',                 'Sold Out'),
    ('Blackhawk',                  'Sold Out'),
    ('Blueberry Woods',            'Prospective'),
    ('Bristol - Dykema',           'Prospective'),
    ('Centennial Acres',           'Active'),
    ('Chase Farms',                'Sold Out'),
    ('Cobblestone at the Ravines', 'Active'),
    ('Deer Creek Meadows',         'Active'),
    ('Douglas Trail',              'Active'),
    ('Dutton Preserve',            'Active'),
    ('Dykema / Schimmel (Kent)',   'Prospective'),
    ('Eagles Landing',             'Sold Out'),
    ('Eagles Ridge',               'Sold Out'),
    ('Emerald Lake',               'Active'),
    ('Fallasburg Park',            'Active'),
    ('Flat River Estates',         'Active'),
    ('Graymoor',                   'Active'),
    ('Hawk''s Valley',             'Prospective'),
    ('Hawthorne Meadows',          'Active'),
    ('Hidden Ridge',               'Sold Out'),
    ('Hidden Shores West',         'Active'),
    ('Highpoint View',             'Sold Out'),
    ('Honeysuckle Hill',           'Sold Out'),
    ('Jason Ridge Condos',         'Active'),
    ('Jasonville Ridge',           'Sold Out'),
    ('Kettle Preserve',            'Active'),
    ('Kuipers Meadow',             'Active'),
    ('Laketown Notenbaum',         'Unlikely'),
    ('Meadow Creek',               'Sold Out'),
    ('Meadows of Abbeydale',       'Abandoned'),
    ('Northport Village',          'Sold Out'),
    ('Northwood Crossings',        'Active'),
    ('Oak Harbor',                 'Sold Out'),
    ('OFFSITE',                    'OFFSITE'),
    ('OTHER',                      'OTHER'),
    ('Peacefield Estates',         'Active'),
    ('Placid Waters',              'Active'),
    ('Prairie Winds West',         'Active'),
    ('Railside',                   'Active'),
    ('Ravines - Dykema',           'Active'),
    ('Ravines at Inwood',          'Active'),
    ('Redstone Farms',             'Active'),
    ('Richmond - JAG',             'Prospective'),
    ('Riley Crossings',            'Sold Out'),
    ('Riverbend',                  'Active'),
    ('Rivertown Park Highlands',   'Active'),
    ('Rockford Highlands',         'Sold Out'),
    ('Rolling Meadows',            'Sold Out'),
    ('Sandy Acres',                'Active'),
    ('Seneca Ridge',               'Active'),
    ('Spring Grove Farms',         'Sold Out'),
    ('Spring Grove Village',       'Active'),
    ('Stonewater',                 'Active'),
    ('Stony Bluff',                'Active'),
    ('Summerbrooke Estates',       'Sold Out'),
    ('Summerset Meadows North',    'Sold Out'),
    ('Summit Pointe',              'Active'),
    ('The Dales',                  'Sold Out'),
    ('The Range',                  'Active'),
    ('The Reserve',                'Sold Out'),
    ('Thornapple Mill',            'Sold Out'),
    ('Timberline',                 'Active'),
    ('Trailside',                  'Sold Out'),
    ('Trailside Townhomes',        'Active'),
    ('Valley Point',               'Active'),
    ('Villages of Silver Lake',    'Active'),
    ('Waterton Station',           'Active'),
    ('Westpoint',                  'Active'),
    ('Wilder Crossings',           'Active'),
    ('Windchime Estates',          'Sold Out'),
    ('Woods of Albright',          'Active')
)
UPDATE devdb.sim_entitlement_groups eg
SET status = src.status
FROM src
WHERE eg.ent_group_name = src.ent_group_name;
