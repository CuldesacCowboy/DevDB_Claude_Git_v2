-- Migration 071: Seed county_id and school_district_id on sim_entitlement_groups.
--
-- Source: JTB development list cross-referenced against ref_counties and
-- ref_school_districts. Matched on ent_group_name using the canonical DB name.
--
-- DB name differences from source list:
--   'Laketown Notenbaum'  = source 'Notenbaum (GW/SF/TH)'
--   'Prairie Winds West'  = source 'Prairie Winds (CD/GW/SF/TH)'
--
-- Communities with no county/SD data available (left NULL):
--   City View Estates, Firestone, Summerset South
--   All Kanto/Johto Station test communities
--
-- Communities in source list not yet in DB (no action needed):
--   Algoma Pitsch, Schuring, Engles - Hamilton, Spring Ridge

WITH loc (ent_group_name, county_name, sd_name) AS (
    VALUES
    ('43 North',                   'Kent',       'Rockford'),
    ('Abbey Farms',                'Kalamazoo',  'Portage'),
    ('Alaska Avenue',              'Kent',        'Caledonia'),
    ('Algoma Ortwein',             'Kent',        'Rockford'),
    ('Alward Estates',             'Ottawa',      'Hudsonville'),
    ('Arlington Park',             'Kent',        'Byron Center'),
    ('Austin Landings',            'Kalamazoo',  'Portage'),
    ('Berryfield',                 'Ottawa',      'West Ottawa'),
    ('Blackhawk',                  'Kent',        'Forest Hills'),
    ('Blueberry Woods',            'Ottawa',      'Grand Haven'),
    ('Bristol - Dykema',           'Kent',        'Grand Rapids'),
    ('Centennial Acres',           'Allegan',     'Zeeland'),
    ('Chase Farms',                'Kent',        'Byron Center'),
    ('Cobblestone at the Ravines', 'Kent',        'Kentwood'),
    ('Deer Creek Meadows',         'Muskegon',    'Fruitport'),
    ('Douglas Trail',              'Kent',        'Byron Center'),
    ('Dutton Preserve',            'Kent',        'Caledonia'),
    ('Dykema / Schimmel (Kent)',   'Kent',        'Rockford'),
    ('Eagles Landing',             'Ottawa',      'Hudsonville'),
    ('Eagles Ridge',               'Ottawa',      'Hudsonville'),
    ('Emerald Lake',               'Kent',        'Forest Hills'),
    ('Fallasburg Park',            'Kent',        'Lowell'),
    ('Flat River Estates',         'Kent',        'Lowell'),
    ('Graymoor',                   'Kent',        'Caledonia'),
    ('Hawk''s Valley',             'Ottawa',      'Hudsonville'),
    ('Hawthorne Meadows',          'Van Buren',   'Paw Paw'),
    ('Hidden Ridge',               'Kent',        'Byron Center'),
    ('Hidden Shores West',         'Ottawa',      'Allendale'),
    ('Highpoint View',             'Ottawa',      'Hudsonville'),
    ('Honeysuckle Hill',           'Kent',        'Forest Hills'),
    ('Jason Ridge Condos',         'Kent',        'Grandville'),
    ('Jasonville Ridge',           'Kent',        'Caledonia'),
    ('Kettle Preserve',            'Kent',        'Caledonia'),
    ('Kuipers Meadow',             'Kent',        'Byron Center'),
    ('Laketown Notenbaum',         'Allegan',     'Hamilton'),
    ('Meadow Creek',               'Kent',        'Rockford'),
    ('Meadows of Abbeydale',       'Kent',        'Forest Hills'),
    ('Northport Village',          'Muskegon',    'Reeths-Puffer'),
    ('Northwood Crossings',        'Kent',        'Rockford'),
    ('Oak Harbor',                 'Kent',        'Forest Hills'),
    ('OFFSITE',                    'OFFSITE',     'OFFSITE'),
    ('OTHER',                      'OTHER',       'OTHER'),
    ('Peacefield Estates',         'Ottawa',      'Hudsonville'),
    ('Placid Waters',              'Ottawa',      'Allendale'),
    ('Prairie Winds West',         'Ottawa',      'Zeeland'),
    ('Railside',                   'Kent',        'Byron Center'),
    ('Ravines - Dykema',           'Kent',        'Rockford'),
    ('Ravines at Inwood',          'Kent',        'Rockford'),
    ('Redstone Farms',             'Kalamazoo',  'Kalamazoo'),
    ('Richmond - JAG',             'Kent',        'Kenowa Hills'),
    ('Riley Crossings',            'Ottawa',      'Hudsonville'),
    ('Riverbend',                  'Kent',        'Grandville'),
    ('Rivertown Park Highlands',   'Kent',        'Grandville'),
    ('Rockford Highlands',         'Kent',        'Rockford'),
    ('Rolling Meadows',            'Kent',        'Byron Center'),
    ('Sandy Acres',                'Montcalm',    'Greenville'),
    ('Seneca Ridge',               'Kent',        'Thornapple Kellog'),
    ('Spring Grove Farms',         'Ottawa',      'Hudsonville'),
    ('Spring Grove Village',       'Ottawa',      'Hudsonville'),
    ('Stonewater',                 'Ottawa',      'Grand Haven'),
    ('Stony Bluff',                'Kent',        'Lowell'),
    ('Summerbrooke Estates',       'Kent',        'Kenowa Hills'),
    ('Summerset Meadows North',    'Kent',        'Rockford'),
    ('Summit Pointe',              'Kent',        'Rockford'),
    ('The Dales',                  'Ottawa',      'Allendale'),
    ('The Range',                  'Kent',        'Kenowa Hills'),
    ('The Reserve',                'Kent',        'Grandville'),
    ('Thornapple Mill',            'Kent',        'Caledonia'),
    ('Timberline',                 'Ottawa',      'West Ottawa'),
    ('Trailside',                  'Ottawa',      'Zeeland'),
    ('Trailside Townhomes',        'Van Buren',   'South Haven'),
    ('Valley Point',               'Kent',        'Caledonia'),
    ('Villages of Silver Lake',    'Kent',        'Rockford'),
    ('Waterton Station',           'Ottawa',      'Hudsonville'),
    ('Westpoint',                  'Kalamazoo',  'Kalamazoo'),
    ('Wilder Crossings',           'Kent',        'Kenowa Hills'),
    ('Windchime Estates',          'Kent',        'Comstock Park'),
    ('Woods of Albright',          'Kent',        'Grandville')
)
UPDATE devdb.sim_entitlement_groups eg
SET
    county_id          = c.county_id,
    school_district_id = sd.sd_id
FROM loc
JOIN devdb.ref_counties            c  ON c.county_name   = loc.county_name
JOIN devdb.ref_school_districts    sd ON sd.district_name = loc.sd_name
WHERE eg.ent_group_name = loc.ent_group_name;
