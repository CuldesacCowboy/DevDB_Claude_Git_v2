#!/usr/bin/env python
"""
Import TDA agreements, checkpoints, lot assignments, and takedown dates
from ReferenceFiles/Lot Takedown Requirements spreadsheets (2024-2026).
Idempotent: skips communities that already have TDAs unless --force is passed.
Usage: python import_tda_spreadsheets.py [--dry-run] [--force]
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
parser.add_argument('--force',   action='store_true', help='Re-create TDAs even if community already has them')
args = parser.parse_args()

DRY    = args.dry_run
FOLDER = r'C:\DevDB_Claude_Git_v2\ReferenceFiles\Lot Takedown Requirements'

# ── Community map: spreadsheet name -> (ent_group_id, [lot_prefixes]) ─────────
COMMUNITY_MAP = {
    'Stony Bluff':                     (9067, ['SB']),
    'Stonewater':                      (9066, ['ST']),   # SF lots
    'Stonewater Condos':               (9066, ['SC']),   # condo lots
    'Villages of Silver Lake':         (9080, ['SL']),
    'RAVINES Ph3':                     (9053, ['RV']),
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
}

TDA_NAME_MAP = {
    'Stony Bluff':                     'Stony Bluff',
    'Stonewater':                      'Stonewater SF',
    'Stonewater Condos':               'Stonewater Condos',
    'Villages of Silver Lake':         'Villages of Silver Lake',
    'RAVINES Ph3':                     'Ravines Phase 3',
    'Graymoor':                        'Graymoor',
    'Woods of Albright':               'Woods of Albright',
    'Trailside South Haven':           'Trailside South Haven',
    'Jason Ridge Condos':              'Jason Ridge Condos',
    'Valley Point':                    'Valley Point',
    'Kettle Preserve Ph1':             'Kettle Preserve',
    'West Point (Redstone)':           'West Point (Redstone)',
    'Railside 7':                      'Railside 7',
    'Railside 8':                      'Railside 8',
    'Rivertown Highlands TH':          'Rivertown Highlands TH',
    'Peacefield':                      'Peacefield',
    'Hidden Shores West/Waters Edge':  'Hidden Shores West / Waters Edge',
}

# ── Helpers ────────────────────────────────────────────────────────────────────

MONTH_ABBR = {
    'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
    'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12,
    'January': 1, 'February': 2, 'March': 3, 'April': 4,
    'June': 6, 'July': 7, 'August': 8, 'September': 9,
    'October': 10, 'November': 11, 'December': 12,
}

def parse_month_to_date(s):
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

def extract_lot_int(s):
    if s is None:
        return None
    m = re.match(r'^(\d+)', str(s).strip())
    return int(m.group(1)) if m else None

def make_lot_num(prefix, n):
    return f'{prefix}{n:08d}'

def parse_close_date(s):
    if not s:
        return None
    try:
        return datetime.strptime(s.strip(), '%m/%d/%Y').date()
    except Exception:
        return None

# ── Read spreadsheets ──────────────────────────────────────────────────────────

print('Reading spreadsheets...')
all_rows = []  # (year, month_str, required, community, lot_str, closed, close_date_str)
for fname in [
    '2024 Lot Take Down Requirements.xlsx',
    '2025 Lot Take Down Requirements.xlsx',
    '2026 Lot Take Down Requirements.xlsx',
]:
    wb = openpyxl.load_workbook(os.path.join(FOLDER, fname), data_only=True)
    ws = wb['Checklist']
    year = fname[:4]
    for row in ws.iter_rows(min_row=1, values_only=True):
        col_a = row[0] if len(row) > 0 else None
        col_b = row[1] if len(row) > 1 else None
        col_c = row[2] if len(row) > 2 else None
        col_f = row[5] if len(row) > 5 else None
        col_g = row[6] if len(row) > 6 else None
        if not col_b or not col_c:
            continue
        c_str = str(col_c).strip()
        m = re.match(r'^(\d+)\s+(.+)$', c_str)
        if not m:
            continue
        required   = int(m.group(1))
        community  = m.group(2).strip()
        if community not in COMMUNITY_MAP:
            continue
        month_str     = str(col_b).strip()
        closed        = col_a in ('X', 'x', '\u2713')
        close_date_str = None
        if col_g and isinstance(col_g, str):
            dm = re.search(
                r'[Cc]los(?:ed|ing date scheduled|ing scheduled)\s+(\d+/\d+/\d+)',
                str(col_g),
            )
            if dm:
                close_date_str = dm.group(1)
        all_rows.append((year, month_str, required, community, col_f, closed, close_date_str))

print(f'  {len(all_rows)} data rows across 3 years for matched communities')

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
    SELECT d.community_id, l.lot_id, l.lot_number, l.date_td
    FROM devdb.sim_lots l
    JOIN devdb.sim_dev_phases p ON p.phase_id = l.phase_id
    JOIN devdb.developments d ON d.dev_id = p.dev_id
    WHERE l.lot_source = %s AND d.community_id IS NOT NULL
    ''',
    ('real',),
)
lot_num_to_id   = {}
lot_has_date_td = {}
db_lots_by_cid  = defaultdict(set)
for r in cur.fetchall():
    db_lots_by_cid[r['community_id']].add(r['lot_number'])
    lot_num_to_id[r['lot_number']]  = r['lot_id']
    lot_has_date_td[r['lot_id']]    = (r['date_td'] is not None)


def find_lot_id(eid, prefixes, lot_int):
    for p in prefixes:
        candidate = make_lot_num(p, lot_int)
        if candidate in db_lots_by_cid[eid]:
            return lot_num_to_id.get(candidate), candidate
    return None, None


# Existing TDAs
cur.execute('SELECT tda_id, ent_group_id, tda_name FROM devdb.sim_takedown_agreements')
existing_tdas = {}  # (ent_group_id, tda_name) -> tda_id
for r in cur.fetchall():
    existing_tdas[(r['ent_group_id'], r['tda_name'])] = r['tda_id']

# ── Build per-TDA data ─────────────────────────────────────────────────────────
tda_data = defaultdict(lambda: {
    'checkpoints': {},   # date -> per_year_required
    'lots': {},          # lot_id -> {'lot_num': str, 'cp_date': date, 'close_date': date|None}
    'eid': None,
    'prefixes': None,
})

for year, month_str, required, community, lot_str, closed, close_date_str in all_rows:
    eid, prefixes = COMMUNITY_MAP[community]
    cp_date = parse_month_to_date(month_str)
    if cp_date is None:
        continue
    lot_int = extract_lot_int(lot_str)
    if lot_int is None:
        continue
    lot_id, lot_num = find_lot_id(eid, prefixes, lot_int)
    if lot_id is None:
        continue

    close_date = parse_close_date(close_date_str) if (closed and close_date_str) else None

    td = tda_data[community]
    td['eid']      = eid
    td['prefixes'] = prefixes
    td['checkpoints'][cp_date] = max(td['checkpoints'].get(cp_date, 0), required)

    # Deduplicate lots: prefer entry with close_date
    if lot_id not in td['lots']:
        td['lots'][lot_id] = {'lot_num': lot_num, 'cp_date': cp_date, 'close_date': close_date}
    else:
        existing = td['lots'][lot_id]
        # Update cp_date to the earliest checkpoint this lot appears in
        if cp_date < existing['cp_date']:
            existing['cp_date'] = cp_date
        # Keep close_date if found
        if close_date and not existing['close_date']:
            existing['close_date'] = close_date

# ── Execute ────────────────────────────────────────────────────────────────────
print()
total_tdas = 0; total_cps = 0; total_assigned = 0; total_dates_set = 0

for community in sorted(tda_data.keys()):
    td       = tda_data[community]
    eid      = td['eid']
    tda_name = TDA_NAME_MAP.get(community, community)

    if (eid, tda_name) in existing_tdas and not args.force:
        print(f'  SKIP   {tda_name} (TDA {existing_tdas[(eid, tda_name)]} already exists)')
        continue

    sorted_dates = sorted(td['checkpoints'].keys())
    cumulative   = 0
    cp_cumulative = {}
    for d in sorted_dates:
        cumulative += td['checkpoints'][d]
        cp_cumulative[d] = cumulative

    n_lots   = len(td['lots'])
    n_closed = sum(1 for v in td['lots'].values() if v['close_date'])
    cp_desc  = ', '.join(f"{d.strftime('%b %Y')}={cp_cumulative[d]}" for d in sorted_dates)

    mode = 'DRY' if DRY else 'CREATE'
    print(f'  {mode}  {tda_name:45s}  CPs={len(sorted_dates)}  lots={n_lots}  dates={n_closed}')
    print(f'         checkpoints: {cp_desc}')

    total_tdas     += 1
    total_cps      += len(sorted_dates)
    total_assigned += n_lots
    total_dates_set += n_closed

    if DRY:
        continue

    # 1. Create TDA
    cur.execute(
        '''
        INSERT INTO devdb.sim_takedown_agreements
            (tda_name, ent_group_id, status, checkpoint_lead_days, created_at, updated_at)
        VALUES (%s, %s, 'active', 16, now(), now())
        RETURNING tda_id
        ''',
        (tda_name, eid),
    )
    tda_id = cur.fetchone()['tda_id']
    existing_tdas[(eid, tda_name)] = tda_id

    # 2. Checkpoints
    cp_id_map = {}
    for cp_num, cp_date in enumerate(sorted_dates, 1):
        cur.execute(
            '''
            INSERT INTO devdb.sim_takedown_checkpoints
                (tda_id, checkpoint_number, checkpoint_name, checkpoint_date,
                 lots_required_cumulative, status)
            VALUES (%s, %s, %s, %s, %s, 'open')
            RETURNING checkpoint_id
            ''',
            (tda_id, cp_num, f'Year {cp_num}', cp_date, cp_cumulative[cp_date]),
        )
        cp_id_map[cp_date] = cur.fetchone()['checkpoint_id']

    last_cp_id = cp_id_map[sorted_dates[-1]]

    # 3. Pool + assignments + date_td
    for lot_id, info in td['lots'].items():
        # Pool
        cur.execute(
            'INSERT INTO devdb.sim_takedown_agreement_lots (tda_id, lot_id) VALUES (%s, %s) ON CONFLICT DO NOTHING',
            (tda_id, lot_id),
        )
        # Assignment — use the checkpoint this lot was listed under
        cp_id = cp_id_map.get(info['cp_date'], last_cp_id)
        cur.execute(
            'INSERT INTO devdb.sim_takedown_lot_assignments (checkpoint_id, lot_id, assigned_at) VALUES (%s, %s, now()) ON CONFLICT DO NOTHING',
            (cp_id, lot_id),
        )
        # date_td (only if lot doesn't already have a MARKS date)
        if info['close_date'] and not lot_has_date_td.get(lot_id, False):
            cur.execute(
                'UPDATE devdb.sim_lots SET date_td = %s WHERE lot_id = %s AND date_td IS NULL',
                (info['close_date'], lot_id),
            )

if not DRY:
    conn.commit()
    print('\nCOMMITTED.')
else:
    print('\nDRY RUN — no changes made.')

print(f'\nSummary: {total_tdas} TDAs | {total_cps} checkpoints | {total_assigned} lot assignments | {total_dates_set} date_td values set')
cur.close()
conn.close()
