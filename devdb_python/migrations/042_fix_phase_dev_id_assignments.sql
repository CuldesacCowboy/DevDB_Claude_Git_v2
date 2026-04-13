-- 042_fix_phase_dev_id_assignments.sql
--
-- Corrects sim_legal_instruments.dev_id and sim_dev_phases.dev_id where the
-- original seeding assigned phases/instruments to the wrong development.
-- Instruments are the authoritative anchor: instrument_name → correct dev_id.
-- Phase dev_id is updated to match its instrument.
--
-- Skipped (ambiguous or actually correct):
--   Instrument 70109 "The Reserve" → phases named "Rivertown Valley ph. 3-7"
--     Both instrument and phases agree on dev_id=23 (The Reserve). Internal naming only.
--   Instrument 70088 "Ravines at Inwood Villas" → phases "Villas at the Ravines"
--     Both agree on dev_id=21. Internal naming only.

-- ─── 1. Fix sim_legal_instruments.dev_id ─────────────────────────────────────

UPDATE devdb.sim_legal_instruments SET dev_id = 45  -- Waterton Station (SF)
WHERE instrument_id = 1;   -- "Waterton Station Plat" was 48 (Jason Ridge Condos)

UPDATE devdb.sim_legal_instruments SET dev_id = 46  -- Waterton Condos (Pointe)
WHERE instrument_id = 2;   -- "Waterton Pointe" was 49 (Summerset South)

UPDATE devdb.sim_legal_instruments SET dev_id = 58  -- Waterton Condos (Village)
WHERE instrument_id = 3;   -- "Waterton Village" was 62 (Deer Creek Meadows TH)

UPDATE devdb.sim_legal_instruments SET dev_id = 58  -- Waterton Condos (Village)
WHERE instrument_id = 4;   -- "Waterton Station Site Condo" was 48 (Jason Ridge Condos)

UPDATE devdb.sim_legal_instruments SET dev_id = 84  -- Abbey Farms (GW)
WHERE instrument_id = 5;   -- "Abbey Farms Gateway Homes" was 89 (Douglas Trail GW)

UPDATE devdb.sim_legal_instruments SET dev_id = 82  -- Abbey Farms (SF)
WHERE instrument_id = 7;   -- "Abbey Farms" was 87 (Douglas Trail SF)

UPDATE devdb.sim_legal_instruments SET dev_id = 83  -- Abbey Farms (TH)
WHERE instrument_id = 9;   -- "Abbey Farms Townhomes" was 88 (Douglas Trail TH)

UPDATE devdb.sim_legal_instruments SET dev_id = 73  -- Dutton Preserve
WHERE instrument_id = 14;  -- "Dutton Preserve SC" was 78 (Centennial Acres)

UPDATE devdb.sim_legal_instruments SET dev_id = 77  -- Alaska Avenue
WHERE instrument_id = 70053; -- "Alaska Avenue Splits" was 82 (Abbey Farms SF)

UPDATE devdb.sim_legal_instruments SET dev_id = 78  -- Centennial Acres
WHERE instrument_id = 70058; -- "Centennial Acres" was 83 (Abbey Farms TH)

UPDATE devdb.sim_legal_instruments SET dev_id = 42  -- Chase Farms
WHERE instrument_id = 70059; -- "Chase Farms" was 45 (Waterton Station SF)

UPDATE devdb.sim_legal_instruments SET dev_id = 41  -- City View Estates
WHERE instrument_id = 70060; -- "City View Estates" was 43 (Eagles Landing)

UPDATE devdb.sim_legal_instruments SET dev_id = 86  -- Cobblestone at the Ravines
WHERE instrument_id = 70061; -- "Cobblestone at the Ravines" was 91 (Hawk's Valley)

UPDATE devdb.sim_legal_instruments SET dev_id = 62  -- Deer Creek Meadows (TH)
WHERE instrument_id = 70063; -- "Deer Creek Meadows (TH)" was 66 (Prairie Winds CD)

UPDATE devdb.sim_legal_instruments SET dev_id = 43  -- Eagles Landing
WHERE instrument_id = 70064; -- "Eagles Landing" was 46 (Waterton Condos Pointe)

UPDATE devdb.sim_legal_instruments SET dev_id = 76  -- Fallasburg Park
WHERE instrument_id = 70066; -- "Fallasburg Park" was 81 (Sandy Acres)

UPDATE devdb.sim_legal_instruments SET dev_id = 75  -- Flat River Estates
WHERE instrument_id = 70067; -- "Flat River Estates" was 80 (Trailside Townhomes)

UPDATE devdb.sim_legal_instruments SET dev_id = 79  -- Hawthorne Meadows
WHERE instrument_id = 70069; -- "Hawthorne Meadows" was 84 (Abbey Farms GW)

UPDATE devdb.sim_legal_instruments SET dev_id = 48  -- Jason Ridge Condos
WHERE instrument_id = 70074; -- "Jason Ridge Condos" was 51 (The Range)

UPDATE devdb.sim_legal_instruments SET dev_id = 53  -- Kettle Preserve
WHERE instrument_id = 70076; -- "Kettle Preserve" was 57 (Summit Pointe)

UPDATE devdb.sim_legal_instruments SET dev_id = 63  -- Kuipers Meadow
WHERE instrument_id = 70077; -- "Kuipers Meadow" was 67 (Prairie Winds TH)

UPDATE devdb.sim_legal_instruments SET dev_id = 47  -- Peacefield Estates
WHERE instrument_id = 70054; -- "Peacefield Estates" was 50 (Wilder Crossings SF)

UPDATE devdb.sim_legal_instruments SET dev_id = 66  -- Prairie Winds (CD)
WHERE instrument_id = 70082; -- "Prairie Winds (CD)" was 70 (Austin Landings GW)

UPDATE devdb.sim_legal_instruments SET dev_id = 64  -- Prairie Winds (SF)
WHERE instrument_id = 70084; -- "Prairie Winds (SF)" was 68 (Villages of Silver Lake)

UPDATE devdb.sim_legal_instruments SET dev_id = 67  -- Prairie Winds (TH)
WHERE instrument_id = 70085; -- "Prairie Winds (TH)" was 71 (Austin Landings TH)

UPDATE devdb.sim_legal_instruments SET dev_id = 100 -- Riverbend
WHERE instrument_id = 70091; -- "Riverbend" was 105 (Dykema / Schimmel Kent)

UPDATE devdb.sim_legal_instruments SET dev_id = 85  -- Rivertown Park Highlands
WHERE instrument_id = 70092; -- "Rivertown Park Highlands" was 90 (Schuring)

UPDATE devdb.sim_legal_instruments SET dev_id = 81  -- Sandy Acres
WHERE instrument_id = 70095; -- "Sandy Acres" was 86 (Cobblestone at the Ravines)

UPDATE devdb.sim_legal_instruments SET dev_id = 44  -- Summerbrooke Estates
WHERE instrument_id = 70102; -- "Summerbrooke Estates" was 47 (Peacefield Estates)

UPDATE devdb.sim_legal_instruments SET dev_id = 52  -- Summerset Meadows North
WHERE instrument_id = 70103; -- "Summerset Meadows North" was 56 (OTHER)

UPDATE devdb.sim_legal_instruments SET dev_id = 57  -- Summit Pointe
WHERE instrument_id = 70104; -- "Summit Pointe" was 61 (Deer Creek Meadows SF)

UPDATE devdb.sim_legal_instruments SET dev_id = 51  -- The Range
WHERE instrument_id = 70106; -- "The Range" was 55 (OFFSITE)

UPDATE devdb.sim_legal_instruments SET dev_id = 59  -- The Range Condos
WHERE instrument_id = 70107; -- "The Range Condos" was 63 (Kuipers Meadow)

UPDATE devdb.sim_legal_instruments SET dev_id = 60  -- The Range Townhomes
WHERE instrument_id = 70108; -- "The Range Townhomes" was 64 (Prairie Winds SF)

UPDATE devdb.sim_legal_instruments SET dev_id = 80  -- Trailside Townhomes
WHERE instrument_id = 70113; -- "Trailside Townhomes" was 85 (Rivertown Park Highlands)

UPDATE devdb.sim_legal_instruments SET dev_id = 74  -- Valley Point
WHERE instrument_id = 70114; -- "Valley Point" was 79 (Hawthorne Meadows)

UPDATE devdb.sim_legal_instruments SET dev_id = 68  -- Villages of Silver Lake
WHERE instrument_id = 70115; -- "Villages of Silver Lake" was 72 (Meadows of Abbeydale)


-- ─── 2. Fix sim_dev_phases.dev_id to match correct instrument dev_id ──────────

-- Waterton Station (SF) → dev_id 45
UPDATE devdb.sim_dev_phases SET dev_id = 45
WHERE phase_id IN (93, 126);

-- Waterton Condos (Pointe) → dev_id 46
UPDATE devdb.sim_dev_phases SET dev_id = 46
WHERE phase_id IN (103, 128, 9013, 9014, 9015);

-- Waterton Condos (Village) → dev_id 58
UPDATE devdb.sim_dev_phases SET dev_id = 58
WHERE phase_id IN (102, 127, 9006, 9007, 9008, 9009, 9010, 9019, 9020, 9021, 9024);

-- Abbey Farms (GW) → dev_id 84
UPDATE devdb.sim_dev_phases SET dev_id = 84
WHERE phase_id IN (156, 159, 161);

-- Abbey Farms (SF) → dev_id 82
UPDATE devdb.sim_dev_phases SET dev_id = 82
WHERE phase_id IN (150, 151, 152, 153, 154, 155);

-- Abbey Farms (TH) → dev_id 83
UPDATE devdb.sim_dev_phases SET dev_id = 83
WHERE phase_id IN (157, 160);

-- Alaska Avenue → dev_id 77
UPDATE devdb.sim_dev_phases SET dev_id = 77
WHERE phase_id IN (141);

-- Centennial Acres → dev_id 78
UPDATE devdb.sim_dev_phases SET dev_id = 78
WHERE phase_id IN (142);

-- Chase Farms → dev_id 42
UPDATE devdb.sim_dev_phases SET dev_id = 42
WHERE phase_id IN (80, 81);

-- City View Estates → dev_id 41
UPDATE devdb.sim_dev_phases SET dev_id = 41
WHERE phase_id IN (76);

-- Cobblestone at the Ravines → dev_id 86
UPDATE devdb.sim_dev_phases SET dev_id = 86
WHERE phase_id IN (166);

-- Deer Creek Meadows (TH) → dev_id 62
UPDATE devdb.sim_dev_phases SET dev_id = 62
WHERE phase_id IN (110, 111, 70110);

-- Dutton Preserve → dev_id 73
UPDATE devdb.sim_dev_phases SET dev_id = 73
WHERE phase_id IN (176);

-- Eagles Landing → dev_id 43
UPDATE devdb.sim_dev_phases SET dev_id = 43
WHERE phase_id IN (83);

-- Fallasburg Park → dev_id 76
UPDATE devdb.sim_dev_phases SET dev_id = 76
WHERE phase_id IN (136);

-- Flat River Estates → dev_id 75
UPDATE devdb.sim_dev_phases SET dev_id = 75
WHERE phase_id IN (135);

-- Hawthorne Meadows → dev_id 79 (instrument name; phase_name says "Paw Paw Hazen Street")
UPDATE devdb.sim_dev_phases SET dev_id = 79
WHERE phase_id IN (143, 144);

-- Jason Ridge Condos → dev_id 48
UPDATE devdb.sim_dev_phases SET dev_id = 48
WHERE phase_id IN (88, 98, 99, 134);

-- Kettle Preserve → dev_id 53
UPDATE devdb.sim_dev_phases SET dev_id = 53
WHERE phase_id IN (137, 138, 139);

-- Kuipers Meadow → dev_id 63
UPDATE devdb.sim_dev_phases SET dev_id = 63
WHERE phase_id IN (112, 113, 114);

-- Peacefield Estates → dev_id 47
UPDATE devdb.sim_dev_phases SET dev_id = 47
WHERE phase_id IN (70107);

-- Prairie Winds (CD) → dev_id 66
UPDATE devdb.sim_dev_phases SET dev_id = 66
WHERE phase_id IN (120, 121, 122);

-- Prairie Winds (SF) → dev_id 64
UPDATE devdb.sim_dev_phases SET dev_id = 64
WHERE phase_id IN (115, 116, 117);

-- Prairie Winds (TH) → dev_id 67
UPDATE devdb.sim_dev_phases SET dev_id = 67
WHERE phase_id IN (123);

-- Riverbend → dev_id 100
UPDATE devdb.sim_dev_phases SET dev_id = 100
WHERE phase_id IN (175);

-- Rivertown Park Highlands → dev_id 85
UPDATE devdb.sim_dev_phases SET dev_id = 85
WHERE phase_id IN (165);

-- Sandy Acres → dev_id 81
UPDATE devdb.sim_dev_phases SET dev_id = 81
WHERE phase_id IN (147, 148, 149);

-- Summerbrooke Estates → dev_id 44
UPDATE devdb.sim_dev_phases SET dev_id = 44
WHERE phase_id IN (86);

-- Summerset Meadows North → dev_id 52
UPDATE devdb.sim_dev_phases SET dev_id = 52
WHERE phase_id IN (94);

-- Summit Pointe → dev_id 57
UPDATE devdb.sim_dev_phases SET dev_id = 57
WHERE phase_id IN (131);

-- The Range → dev_id 51
UPDATE devdb.sim_dev_phases SET dev_id = 51
WHERE phase_id IN (168, 169, 170);

-- The Range Condos → dev_id 59
UPDATE devdb.sim_dev_phases SET dev_id = 59
WHERE phase_id IN (171);

-- The Range Townhomes → dev_id 60
UPDATE devdb.sim_dev_phases SET dev_id = 60
WHERE phase_id IN (172);

-- Trailside Townhomes → dev_id 80
UPDATE devdb.sim_dev_phases SET dev_id = 80
WHERE phase_id IN (145, 146);

-- Valley Point → dev_id 74
UPDATE devdb.sim_dev_phases SET dev_id = 74
WHERE phase_id IN (164);

-- Villages of Silver Lake → dev_id 68
UPDATE devdb.sim_dev_phases SET dev_id = 68
WHERE phase_id IN (124, 125);
