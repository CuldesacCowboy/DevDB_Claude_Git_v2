#!/usr/bin/env python
"""
1. Split Stonewater Condos TDA 7042 into 3 phase-based TDAs:
     Ph1 = SC1-27  (closed)
     Ph2 = SC28-50 (closed)
     Ph3 = SC51-73 (active, inherits the existing Oct 2026 checkpoint)
2. Read the Done tab of 2026 Lot Take Down Requirements.xlsx and create
   historical closed TDAs for 2023 batches not yet covered.
Usage: python import_done_tab.py [--dry-run] [--force]
"""
import sys, os, re, calendar, argparse
from datetime import date, datetime
from collections import defaultdict
from dotenv import load_dotenv
import psycopg2
import psycopg2.extras
import openpyxl

load_dotenv()
sys.stdout.reconfigure(encoding='utf-8')

parser = argparse.ArgumentParser()
parser.add_argument('--dry-run', action='store_true')
parser.add_argument('--force', action='store_true', help='Re-create even if TDA already exists')
args = parser.parse_args()
DRY = args.dry_run

FOLDER = r'C:\DevDB_Claude_Git_v2\ReferenceFiles\Lot Takedown Requirements'

# ── Community map (same as import_tda_spreadsheets.py) ────────────────────────
COMMUNITY_MAP = {
    'Stony Bluff':                     (9067, ['SB']),
    'Stonewater':                      (9066, ['ST']),
    'Stonewater Condos':               (9066, ['SC']),
    'Villages of Silver Lake':         (9080, ['SL']),
    'RAVINES Ph3':                     (9053, ['RV']),
    'Villas at  RAVINES Ph3':          (9053, ['RV']),
    'Graymoor':                        (9029, ['GM']),
    'Woods of Albright':               (9084, ['WA']),
    'Trailside South Haven':           (9078, ['TI']),
    'Jason Ridge Condos':              (9036, ['JC']),
    'Valley Point':                    (9079, ['VP']),
    'Kettle Preserve Ph1':             (9038, ['KP']),
    'West Point (Redstone)':           (9081, ['WP']),
    'Railside 7':                      (9051, ['RS']),
    'Railside 8':                      (9051, ['RS']),
    'Rivertown Highlands TH':          (9058, ['RP']),
    'Peacefield':                      (9048, ['PF']),
    'Hidden Shores West/Waters Edge':  (9033, ['HW', 'WC']),
    'Deer Creek SF Ph1':               (9019, ['DC']),
    'Deer Creek Townhome Ph1':         (9019, ['DT']),
    'The Range SF Ph1':                (9073, ['TR']),
    'The Range Condos':                (9073, ['TC']),
}

# Done-tab community name -> canonical COMMUNITY_MAP key
DONE_TAB_NAME_MAP = {
    'Stony Bluff':                              'Stony Bluff',
    'Stonewater':                               'Stonewater',
    'STONEWATER':                               'Stonewater',
    'Stonewater Condos':                        'Stonewater Condos',
    'Villages of Silver Lake':                  'Villages of Silver Lake',
    'RAVINES Ph 3':                             'RAVINES Ph3',
    'RAVINES Ph3':                              'RAVINES Ph3',
    'Villas at  RAVINES Ph3':                   'Villas at  RAVINES Ph3',
    'GRAYMOOR':                                 'Graymoor',
    'Graymoor':                                 'Graymoor',
    'Woods of Albright':                        'Woods of Albright',
    'Trailside South Haven':                    'Trailside South Haven',
    'Jason Ridge Condos':                       'Jason Ridge Condos',
    'Valley Point':                             'Valley Point',
    'Kettle Preserve Ph1':                      'Kettle Preserve Ph1',
    'West Point (Redstone)':                    'West Point (Redstone)',
    'Railside 7':                               'Railside 7',
    'Railside 8':                               'Railside 8',
    'Rivertown Highlands TH':                   'Rivertown Highlands TH',
    'Hidden Shores West/Waters Edge':           'Hidden Shores West/Waters Edge',
    'Hidden Shores West and Waters Edge':       'Hidden Shores West/Waters Edge',
    'Hidden Shores West / Waters Edge Condos':  'Hidden Shores West/Waters Edge',
    'Deer Creek SF Ph1':                        'Deer Creek SF Ph1',
    'Deer Creek Townhome Ph1':                  'Deer Creek Townhome Ph1',
    'The Range SF Ph1':                         'The Range SF Ph1',
    'The Range Condos':                         'The Range Condos',
}

MONTH_ABBR = {
    'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
    'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12,
    'January': 1, 'February': 2, 'March': 3, 'April': 4, 'June': 6,
    'July': 7, 'August': 8, 'September': 9, 'October': 10, 'November': 11, 'December': 12,
}

def parse_month_year(s):
    """Parse 'Aug 2023' or 'August 2024' -> date(year, mon, last_day)."""
    s = str(s).strip()
    m = re.match(r'^([A-Za-z]+)\s+(\d{4})$', s)
    if not m:
        return None
    mon_str, year_str = m.group(1), m.group(2)
    mon = MONTH_ABBR.get(mon_str.capitalize()) or MONTH_ABBR.get(mon_str[:3].capitalize())
    if not mon:
        return None
    year = int(year_str)
    last_day = calendar.monthrange(year, mon)[1]
    return date(year, mon, last_day)

def extract_lot_int(v):
    """Extract leading integer from lot field (int or string like '42 SB - Bld')."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        n = int(v)
        return n if n > 0 else None
    m = re.match(r'^\s*(\d+)', str(v).strip())
    return int(m.group(1)) if m else None


def extract_lot_ints(v):
    """Extract all lot integers from a field that may contain comma-separated values.
    Handles: 42, '42 SB', '60,45, 66 , 44', '118 TL Closed 9/5'."""
    if v is None:
        return []
    if isinstance(v, (int, float)):
        n = int(v)
        return [n] if n > 0 else []
    s = str(v).strip()
    # Check for comma-separated list
    if ',' in s:
        results = []
        for part in s.split(','):
            m = re.match(r'^\s*(\d+)', part.strip())
            if m:
                results.append(int(m.group(1)))
        return results
    m = re.match(r'^\s*(\d+)', s)
    return [int(m.group(1))] if m else []

def make_lot_num(prefix, n):
    return f'{prefix}{n:08d}'

# ── Connect DB ─────────────────────────────────────────────────────────────────
conn = psycopg2.connect(
    host='localhost', database='devdb',
    user=os.getenv('PG_USER', 'postgres'),
    password=os.getenv('PG_PASSWORD', ''),
    port=int(os.getenv('PG_PORT', 5432)),
    options='-c search_path=devdb',
)
cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

# Build DB lot lookup
cur.execute(
    '''
    SELECT d.community_id, l.lot_id, l.lot_number
    FROM devdb.sim_lots l
    JOIN devdb.sim_dev_phases p ON p.phase_id = l.phase_id
    JOIN devdb.developments d ON d.dev_id = p.dev_id
    WHERE l.lot_source = 'real' AND d.community_id IS NOT NULL
    ''',
)
lot_num_to_id = {}
db_lots_by_cid = defaultdict(set)
for r in cur.fetchall():
    db_lots_by_cid[r['community_id']].add(r['lot_number'])
    lot_num_to_id[r['lot_number']] = r['lot_id']

def find_lot_id(eid, prefixes, lot_int):
    for p in prefixes:
        candidate = make_lot_num(p, lot_int)
        if candidate in db_lots_by_cid[eid]:
            return lot_num_to_id.get(candidate), candidate
    return None, None

# Load existing TDAs
cur.execute('SELECT tda_id, ent_group_id, tda_name, status FROM devdb.sim_takedown_agreements')
existing_tdas = {}  # (ent_group_id, tda_name) -> tda_id
all_tda_rows = {}   # tda_id -> row
for r in cur.fetchall():
    existing_tdas[(r['ent_group_id'], r['tda_name'])] = r['tda_id']
    all_tda_rows[r['tda_id']] = r


def tda_exists(eid, name):
    return (eid, name) in existing_tdas


def create_tda(eid, name, status='active', checkpoint_lead_days=16):
    if DRY:
        return None
    cur.execute(
        '''
        INSERT INTO devdb.sim_takedown_agreements
            (tda_name, ent_group_id, status, checkpoint_lead_days, created_at, updated_at)
        VALUES (%s, %s, %s, %s, now(), now())
        RETURNING tda_id
        ''',
        (name, eid, status, checkpoint_lead_days),
    )
    tda_id = cur.fetchone()['tda_id']
    existing_tdas[(eid, name)] = tda_id
    return tda_id


def create_checkpoint(tda_id, cp_num, cp_date, required, cp_status='open'):
    if DRY:
        return None
    cur.execute(
        '''
        INSERT INTO devdb.sim_takedown_checkpoints
            (tda_id, checkpoint_number, checkpoint_name, checkpoint_date,
             lots_required_cumulative, status)
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING checkpoint_id
        ''',
        (tda_id, cp_num, f'Checkpoint {cp_num}', cp_date, required, cp_status),
    )
    return cur.fetchone()['checkpoint_id']


def add_lot_pool(tda_id, lot_id):
    if DRY:
        return
    cur.execute(
        'INSERT INTO devdb.sim_takedown_agreement_lots (tda_id, lot_id) VALUES (%s, %s) ON CONFLICT DO NOTHING',
        (tda_id, lot_id),
    )


def add_lot_assignment(cp_id, lot_id):
    if DRY:
        return
    cur.execute(
        'INSERT INTO devdb.sim_takedown_lot_assignments (checkpoint_id, lot_id, assigned_at) VALUES (%s, %s, now()) ON CONFLICT DO NOTHING',
        (cp_id, lot_id),
    )


# ═══════════════════════════════════════════════════════════════════════════════
# PART 1: Split Stonewater Condos TDA 7042 into 3 phase-based TDAs
# ═══════════════════════════════════════════════════════════════════════════════
print('=' * 70)
print('PART 1: Split Stonewater Condos TDA 7042 into 3 phase TDAs')
print('=' * 70)

SC_EID = 9066

# Fetch current TDA 7042 state
cur.execute('SELECT * FROM devdb.sim_takedown_agreements WHERE tda_id = 7042')
tda_7042 = cur.fetchone()

if tda_7042 is None:
    print('  TDA 7042 not found — skipping split')
else:
    cur.execute(
        '''
        SELECT l.lot_id, l.lot_number,
               la.checkpoint_id, la.assignment_id
        FROM devdb.sim_takedown_agreement_lots tal
        JOIN devdb.sim_lots l ON l.lot_id = tal.lot_id
        LEFT JOIN devdb.sim_takedown_lot_assignments la
            ON la.lot_id = l.lot_id
            AND la.checkpoint_id IN (
                SELECT checkpoint_id FROM devdb.sim_takedown_checkpoints WHERE tda_id = 7042
            )
        WHERE tal.tda_id = 7042
        ORDER BY l.lot_number
        '''
    )
    lots_7042 = cur.fetchall()

    # Bucket by phase range
    ph1 = []  # SC1-27
    ph2 = []  # SC28-50
    ph3 = []  # SC51-73
    for r in lots_7042:
        m = re.match(r'^SC(\d+)$', r['lot_number'])
        if not m:
            continue
        n = int(m.group(1))
        if 1 <= n <= 27:
            ph1.append(r)
        elif 28 <= n <= 50:
            ph2.append(r)
        elif 51 <= n <= 73:
            ph3.append(r)

    print(f'  TDA 7042 lots: {len(lots_7042)} total → Ph1={len(ph1)} Ph2={len(ph2)} Ph3={len(ph3)}')

    # Define the 3 new TDAs
    NEW_TDAS = [
        {
            'name': 'Stonewater Condos Ph1',
            'status': 'closed',
            'lots': ph1,
            'checkpoints': [
                (date(2023, 7, 31), 12, 'closed'),
                (date(2024, 7, 31), 12, 'closed'),
            ],
        },
        {
            'name': 'Stonewater Condos Ph2',
            'status': 'closed',
            'lots': ph2,
            'checkpoints': [
                (date(2025, 10, 31), 16, 'closed'),
            ],
        },
        {
            'name': 'Stonewater Condos Ph3',
            'status': 'active',
            'lots': ph3,
            'checkpoints': [
                (date(2026, 10, 31), 15, 'open'),
            ],
        },
    ]

    for td in NEW_TDAS:
        name = td['name']
        if tda_exists(SC_EID, name) and not args.force:
            print(f'  SKIP   {name} (already exists)')
            continue

        mode = 'DRY' if DRY else 'CREATE'
        print(f'  {mode}   {name}  status={td["status"]}  lots={len(td["lots"])}  cps={len(td["checkpoints"])}')

        tda_id = create_tda(SC_EID, name, status=td['status'])
        if tda_id is None and not DRY:
            continue

        # Create checkpoints
        cp_id_list = []
        for cp_num, (cp_date, required, cp_status) in enumerate(td['checkpoints'], 1):
            cp_id = create_checkpoint(tda_id, cp_num, cp_date, required, cp_status)
            cp_id_list.append((cp_date, cp_id))
            print(f'         CP{cp_num}: {cp_date} required={required} status={cp_status}')

        # Add lots to pool and assign to appropriate checkpoint
        # For Ph1: assign lots to CP1 if lot_number <= SC27 (all go to CP2 if they were in Jul 2024 batch)
        # For simplicity: assign all to last checkpoint
        last_cp_id = cp_id_list[-1][1] if cp_id_list else None
        for lot_r in td['lots']:
            add_lot_pool(tda_id, lot_r['lot_id'])
            if last_cp_id:
                add_lot_assignment(last_cp_id, lot_r['lot_id'])

    # Delete TDA 7042 (and cascade) if not dry-run
    if not DRY:
        print('  DELETE TDA 7042 (cascading)')
        cur.execute('DELETE FROM devdb.sim_takedown_lot_assignments WHERE checkpoint_id IN (SELECT checkpoint_id FROM devdb.sim_takedown_checkpoints WHERE tda_id = 7042)')
        cur.execute('DELETE FROM devdb.sim_takedown_checkpoints WHERE tda_id = 7042')
        cur.execute('DELETE FROM devdb.sim_takedown_agreement_lots WHERE tda_id = 7042')
        cur.execute('DELETE FROM devdb.sim_takedown_agreements WHERE tda_id = 7042')
    else:
        print('  DRY: would DELETE TDA 7042')


# ═══════════════════════════════════════════════════════════════════════════════
# PART 2: Read Done tab and create historical closed TDAs for 2023 batches
# ═══════════════════════════════════════════════════════════════════════════════
print()
print('=' * 70)
print('PART 2: Historical closed TDAs from Done tab (2023 batches)')
print('=' * 70)

wb = openpyxl.load_workbook(os.path.join(FOLDER, '2026 Lot Take Down Requirements.xlsx'), data_only=True)
ws = wb['Done']

# Collect rows: (canon_community_key, cp_date, required, lot_int)
done_rows = []
for row in ws.iter_rows(min_row=6, values_only=True):
    col_b = str(row[1] or '').strip() if len(row) > 1 else ''
    col_c = str(row[2] or '').strip() if len(row) > 2 else ''
    col_f = row[5] if len(row) > 5 else None

    if not col_b or not col_c:
        continue

    cp_date = parse_month_year(col_b)
    if cp_date is None:
        continue

    # Only process 2023 data (pre-existing TDAs cover 2024+)
    if cp_date.year != 2023:
        continue

    # Parse "N Community" in col_c
    m = re.match(r'^(\d+)\s+(.+)$', col_c)
    if not m:
        continue
    required = int(m.group(1))
    done_comm = m.group(2).strip()

    canon = DONE_TAB_NAME_MAP.get(done_comm)
    if not canon or canon == 'Stonewater Condos':
        # Skip Stonewater Condos — handled in PART 1
        continue

    lot_ints = extract_lot_ints(col_f)
    if not lot_ints:
        continue

    for lot_int in lot_ints:
        done_rows.append((canon, cp_date, required, lot_int))

print(f'  {len(done_rows)} done-tab rows for 2023 matched communities (excl. Stonewater Condos)')

# Group by (canon, cp_date, required) — that's one batch
batches = defaultdict(lambda: {'lot_ints': [], 'required': 0})
for canon, cp_date, required, lot_int in done_rows:
    key = (canon, cp_date)
    batches[key]['lot_ints'].append(lot_int)
    batches[key]['required'] = max(batches[key]['required'], required)

# TDA names for historical batches
HIST_TDA_NAMES = {
    'Stony Bluff':                     'Stony Bluff 2023',
    'Stonewater':                      'Stonewater SF 2023',
    'Villages of Silver Lake':         'Villages of Silver Lake 2023',
    'RAVINES Ph3':                     'Ravines Phase 3 2023',
    'Villas at  RAVINES Ph3':          'Ravines Villas 2023',
    'Graymoor':                        'Graymoor 2023',
    'Woods of Albright':               'Woods of Albright 2023',
    'Trailside South Haven':           'Trailside South Haven 2023',
    'Jason Ridge Condos':              'Jason Ridge Condos 2023',
    'Valley Point':                    'Valley Point 2023',
    'Kettle Preserve Ph1':             'Kettle Preserve 2023',
    'West Point (Redstone)':           'West Point 2023',
    'Railside 7':                      'Railside 7 2023',
    'Railside 8':                      'Railside 8 2023',
    'Rivertown Highlands TH':          'Rivertown Highlands TH 2023',
    'Hidden Shores West/Waters Edge':  'Hidden Shores West/Waters Edge 2023',
    'Deer Creek SF Ph1':               'Deer Creek SF 2023',
    'Deer Creek Townhome Ph1':         'Deer Creek Townhomes 2023',
    'The Range SF Ph1':                'The Range SF 2023',
    'The Range Condos':                'The Range Condos 2023',
}

total_created = 0
for (canon, cp_date), batch in sorted(batches.items()):
    eid, prefixes = COMMUNITY_MAP[canon]
    tda_name = HIST_TDA_NAMES.get(canon, f'{canon} 2023')
    required = batch['required']

    if tda_exists(eid, tda_name) and not args.force:
        print(f'  SKIP   {tda_name} (already exists)')
        continue

    # Resolve lot IDs
    lot_ids = []
    missed = 0
    for lot_int in batch['lot_ints']:
        lot_id, lot_num = find_lot_id(eid, prefixes, lot_int)
        if lot_id:
            lot_ids.append(lot_id)
        else:
            missed += 1

    mode = 'DRY' if DRY else 'CREATE'
    print(f'  {mode}   {tda_name:48s}  CP={cp_date}  req={required}  lots={len(lot_ids)}  missed={missed}')

    total_created += 1

    tda_id = create_tda(eid, tda_name, status='closed')
    if tda_id is None and not DRY:
        continue

    cp_id = create_checkpoint(tda_id, 1, cp_date, required, 'closed')

    for lot_id in lot_ids:
        add_lot_pool(tda_id, lot_id)
        if cp_id:
            add_lot_assignment(cp_id, lot_id)


# ═══════════════════════════════════════════════════════════════════════════════
# PART 3: Stonewater Condos Jul 2023 lots into Ph1 TDA
# ═══════════════════════════════════════════════════════════════════════════════
print()
print('=' * 70)
print('PART 3: Assign Jul 2023 Done-tab lots to Stonewater Condos Ph1 TDA')
print('=' * 70)

SC1_LOTS_2023 = [6, 7, 24, 25, 9, 10, 11, 8]  # From Done tab Jul 2023

ph1_tda_id = existing_tdas.get((SC_EID, 'Stonewater Condos Ph1'))
if ph1_tda_id is None:
    print('  Stonewater Condos Ph1 TDA not found (not yet created in this run if dry-run)')
else:
    cur.execute(
        'SELECT checkpoint_id, checkpoint_number FROM devdb.sim_takedown_checkpoints WHERE tda_id = %s ORDER BY checkpoint_number',
        (ph1_tda_id,)
    )
    ph1_cps = cur.fetchall()
    cp1_id = ph1_cps[0]['checkpoint_id'] if ph1_cps else None

    found = 0
    for lot_int in SC1_LOTS_2023:
        lot_id, lot_num = find_lot_id(SC_EID, ['SC'], lot_int)
        if lot_id:
            # Check if already in pool
            cur.execute(
                'SELECT 1 FROM devdb.sim_takedown_agreement_lots WHERE tda_id = %s AND lot_id = %s',
                (ph1_tda_id, lot_id)
            )
            if not cur.fetchone():
                add_lot_pool(ph1_tda_id, lot_id)
            # Assign to CP1
            if cp1_id:
                cur.execute(
                    'SELECT 1 FROM devdb.sim_takedown_lot_assignments WHERE checkpoint_id = %s AND lot_id = %s',
                    (cp1_id, lot_id)
                )
                if not cur.fetchone():
                    add_lot_assignment(cp1_id, lot_id)
            found += 1
    mode = 'DRY' if DRY else 'ASSIGNED'
    print(f'  {mode}  {found} lots to Ph1 CP1 (Jul 2023)')

# ── Commit ─────────────────────────────────────────────────────────────────────
if not DRY:
    conn.commit()
    print('\nCOMMITTED.')
else:
    print('\nDRY RUN — no changes made.')

cur.close()
conn.close()
