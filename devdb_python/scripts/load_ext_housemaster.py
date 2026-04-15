"""
load_ext_housemaster.py
Load housemaster.csv into devdb_ext.housemaster (truncate + reload).

Source: ReferenceFiles/csv exports/housemaster.csv  (tzzM01_JTH_HOUSEMASTER1)
Target: devdb_ext.housemaster  (138 columns, PK: companycode/developmentcode/housenumber)

Usage:
  python load_ext_housemaster.py [--csv PATH] [--dry-run]
"""

import argparse
import csv
import os
from datetime import datetime
from decimal import Decimal, InvalidOperation

import psycopg2
import psycopg2.extras

DEFAULT_CSV = os.path.join(
    os.path.dirname(__file__), "..", "..", "ReferenceFiles", "csv exports", "housemaster.csv"
)
DB = dict(dbname="devdb", user="postgres", password="postgres", host="localhost", port=5432)
CHUNK = 500


# ── Type parsers ──────────────────────────────────────────────────────────────

def _s(v):
    """String: empty → None."""
    v = v.strip() if v else ""
    return v or None


def _d(v):
    """Date: M/D/YYYY or M/D/YYYY H:MM:SS. Empty → None."""
    v = v.strip() if v else ""
    if not v:
        return None
    for fmt in ("%m/%d/%Y %H:%M:%S", "%m/%d/%Y"):
        try:
            return datetime.strptime(v, fmt).date()
        except ValueError:
            pass
    return None


def _n(v):
    """Numeric: empty → None."""
    v = v.strip() if v else ""
    if not v:
        return None
    try:
        return Decimal(v)
    except InvalidOperation:
        return None


def _i(v):
    """Integer (strips leading zeros). Empty or non-numeric → None."""
    v = v.strip() if v else ""
    if not v:
        return None
    try:
        return int(v)
    except ValueError:
        return None


# ── Column spec ───────────────────────────────────────────────────────────────
# (csv_header, db_column, parser)

COLS = [
    ("code1",             "code1",             _s),
    ("COMPANYCODE",       "companycode",       _s),
    ("DEVELOPMENTCODE",   "developmentcode",   _s),
    ("HOUSENUMBER",       "housenumber",       _i),
    ("MODELCODE",         "modelcode",         _s),
    ("ELEVATIONCODE",     "elevationcode",     _s),
    ("REMARKS",           "remarks",           _s),
    ("BLOCKNUMBER",       "blocknumber",       _s),
    ("LOTNUMBER",         "lotnumber",         _s),
    ("COMMENTS",          "comments",          _s),
    ("RELEASE_DATE",      "release_date",      _d),
    ("JIONUMBER",         "jionumber",         _s),
    ("UNUSED",            "unused",            _s),
    ("CURRENTJOBSTART",   "currentjobstart",   _d),
    ("LASTJOBSTART",      "lastjobstart",      _d),
    ("BUYERNAME",         "buyername",         _s),
    ("SETTLEMENT_DATE",   "settlement_date",   _d),
    ("DEPOSIT_DATE",      "deposit_date",      _d),
    ("MISC1_DATE",        "misc1_date",        _d),
    ("UNUSED_2",          "unused_2",          _s),
    ("FINANCING_TYPE",    "financing_type",    _s),
    ("MISC2_DATE",        "misc2_date",        _d),
    ("MISC3_DATE",        "misc3_date",        _d),
    ("COSTFLAG",          "costflag",          _s),
    ("SALESRELEASEDATE",  "salesreleasedate",  _d),
    ("CONTRACT_DATE",     "contract_date",     _d),
    ("RATIFIED_DATE",     "ratified_date",     _d),
    ("BUILDING_NUM",      "building_num",      _s),
    ("CNTRK_SUBMT_DATE",  "cntrk_submt_date",  _d),
    ("HOMEPHONE",         "homephone",         _s),
    ("WORKPHONE",         "workphone",         _s),
    ("OPTION_INCV_AMT",   "option_incv_amt",   _n),
    ("CLOSING_INCV_AMT",  "closing_incv_amt",  _n),
    ("POINTS_INCV_AMT",   "points_incv_amt",   _n),
    ("COOP_AMOUNT",       "coop_amount",       _n),
    ("PERMITNUMBER",      "permitnumber",      _s),
    ("COOP_YN",           "coop_yn",           _s),
    ("UNUSED_3",          "unused_3",          _s),
    ("ORIENTATION",       "orientation",       _s),
    ("LOAN_NUM",          "loan_num",          _s),
    ("WARRANTYPOLICY",    "warrantypolicy",    _s),
    ("ADDRESS1",          "address1",          _s),
    ("ADDRESS2",          "address2",          _s),
    ("ADDRESS3",          "address3",          _s),
    ("WARRANTY_DATE",     "warranty_date",     _d),
    ("UNPACKEDHOUSENUM",  "unpackedhousenum",  _s),
    ("MISC4_DATE",        "misc4_date",        _d),
    ("BROKER_AMOUNT",     "broker_amount",     _n),
    ("MISC5_DATE",        "misc5_date",        _d),
    ("MISC6_DATE",        "misc6_date",        _d),
    ("MISC7_DATE",        "misc7_date",        _d),
    ("UNUSED2",           "unused2",           _s),
    ("UPGRADEPRICE",      "upgradeprice",      _n),
    ("AGENTCODE",         "agentcode",         _s),
    ("BROKERCODE",        "brokercode",        _s),
    ("COOP_NAME",         "coop_name",         _s),
    ("HOUSE_TYPE",        "house_type",        _s),
    ("BROKER_PCT",        "broker_pct",        _n),
    ("LST_CHGORD_NUM",    "lst_chgord_num",    _s),
    ("MISC8_DATE",        "misc8_date",        _d),
    ("PERMIT_DATE",       "permit_date",       _d),
    ("PVC8",              "pvc8",              _s),
    ("DEPOSIT_DUE",       "deposit_due",       _n),
    ("EST_BASE_PRICE",    "est_base_price",    _n),
    ("EST_OPTIONS_PRC",   "est_options_prc",   _n),
    ("EST_LOT_PREMIUM",   "est_lot_premium",   _n),
    ("SALESMANCODE",      "salesmancode",      _s),
    ("TITLE_CO",          "title_co",          _s),
    ("MTG_PREQUAL_DATE",  "mtg_prequal_date",  _d),
    ("AOSACCEPTEDFLAG",   "aosacceptedflag",   _s),
    ("EST_UPGRADE_PRC",   "est_upgrade_prc",   _n),
    ("RELEASENUM",        "releasenum",        _s),
    ("COOP_AGENT_ADDR1",  "coop_agent_addr1",  _s),
    ("COOP_AGENT_ADDR2",  "coop_agent_addr2",  _s),
    ("NOT_USED_2",        "not_used_2",        _s),
    ("ESTSETTL_DATE",     "estsettl_date",     _d),
    ("MISC9_DATE",        "misc9_date",        _d),
    ("WALK_THRU_DATE",    "walk_thru_date",    _d),
    ("MTG_APPROV_DATE",   "mtg_approv_date",   _d),
    ("POSTAGE",           "postage",           _n),
    ("WALK_THRU_TIME",    "walk_thru_time",    _s),
    ("AM_PM",             "am_pm",             _s),
    ("UNUSED4",           "unused4",           _s),
    ("CONSTSTART_DATE",   "conststart_date",   _d),
    ("LOTHOLD",           "lothold",           _s),
    ("MTG_APPLIED_DATE",  "mtg_applied_date",  _d),
    ("MISC10_DATE",       "misc10_date",       _d),
    ("WOSTAGE",           "wostage",           _s),
    ("MISC11_DATE",       "misc11_date",       _d),
    ("MISC12_DATE",       "misc12_date",       _d),
    ("MISC1_FIELD",       "misc1_field",       _s),
    ("MISC2_FIELD",       "misc2_field",       _s),
    ("BUYERSNAME1",       "buyersname1",       _s),
    ("BUYERSNAME2",       "buyersname2",       _s),
    ("BUYERSNAME3",       "buyersname3",       _s),
    ("PREVIOUSADDRESS1",  "previousaddress1",  _s),
    ("PREVIOUSADDRESS2",  "previousaddress2",  _s),
    ("PROMISSORYNOTE1",   "promissorynote1",   _s),
    ("PROMISSORYNOTE2",   "promissorynote2",   _s),
    ("PROMISSORY1DATE",   "promissory1date",   _d),
    ("PROMISSORY2DATE",   "promissory2date",   _d),
    ("PROMISSORYAMT1",    "promissoryamt1",    _n),
    ("PROMISSORYAMT2",    "promissoryamt2",    _n),
    ("PVC",               "pvc",               _s),
    ("WARRANTYCOMMENTS",  "warrantycomments",  _s),
    ("PROMISSORYNOTE3",   "promissorynote3",   _s),
    ("PROMISSORY3DATE",   "promissory3date",   _d),
    ("PROMISSORYAMT3",    "promissoryamt3",    _n),
    ("DEPOSITAMTPAID",    "depositamtpaid",    _n),
    ("INS1_DATE",         "ins1_date",         _d),
    ("INS2_DATE",         "ins2_date",         _d),
    ("INS3_DATE",         "ins3_date",         _d),
    ("INS4_DATE",         "ins4_date",         _d),
    ("INS5_DATE",         "ins5_date",         _d),
    ("PCTCOMPL",          "pctcompl",          _n),
    ("PVC1",              "pvc1",              _s),
    ("CASENUMBER",        "casenumber",        _s),
    ("LOTCONTRACTDATE",   "lotcontractdate",   _d),
    ("LOTRATIFYDATE",     "lotratifydate",     _d),
    ("LOTSETTLEDATE",     "lotsettledate",     _d),
    ("SPECFLAG",          "specflag",          _s),
    ("HOUSETAXENABLE",    "housetaxenable",    _s),
    ("CELLPHONE",         "cellphone",         _s),
    ("EMAIL",             "email",             _s),
    ("SUPERUSERID",       "superuserid",       _s),
    ("SWORNSTATEMENT",    "swornstatement",    _s),
    ("TERMINATOR",        "terminator",        _s),
    ("HOUSETAXPERCENT",   "housetaxpercent",   _n),
    ("BASEPRICE",         "baseprice",         _n),
    ("OPTIONSPRICE",      "optionsprice",      _n),
    ("LOTPREMIUM",        "lotpremium",        _n),
    ("NOT_USED_6",        "not_used_6",        _s),
    ("DEPOSITAMOUNT",     "depositamount",     _n),
    ("MORTGAGE_AMOUNT",   "mortgage_amount",   _n),
    ("FEE_PCT",           "fee_pct",           _n),
    ("POINTS_CODE",       "points_code",       _s),
    ("CONSTR_LOAN_AMT",   "constr_loan_amt",   _n),
    ("PCT_OF_BLDING",     "pct_of_blding",     _n),
]

_COL_LIST = ", ".join(c[1] for c in COLS)
_INSERT   = f"INSERT INTO devdb_ext.housemaster ({_COL_LIST}) VALUES %s"


def _parse_row(r):
    return tuple(parser(r.get(csv_key, "")) for csv_key, _, parser in COLS)


def load_csv(csv_path):
    rows = []
    skipped = 0
    with open(csv_path, encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            cc  = (r.get("COMPANYCODE", "") or "").strip()
            dev = (r.get("DEVELOPMENTCODE", "") or "").strip()
            num = _i(r.get("HOUSENUMBER", ""))
            if not cc or not dev or num is None:
                skipped += 1
                continue
            rows.append(_parse_row(r))
    if skipped:
        print(f"  Skipped {skipped} rows (missing PK fields)")
    return rows


def main():
    parser = argparse.ArgumentParser(description="Load housemaster CSV into devdb_ext.housemaster")
    parser.add_argument("--csv", default=DEFAULT_CSV)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    print(f"Loading: {args.csv}")
    rows = load_csv(args.csv)
    print(f"  Parsed {len(rows):,} rows")

    if args.dry_run:
        print("DRY RUN — no DB writes.")
        return

    conn = psycopg2.connect(**DB)
    cur = conn.cursor()
    cur.execute("TRUNCATE devdb_ext.housemaster")
    print("  Truncated devdb_ext.housemaster")

    for i in range(0, len(rows), CHUNK):
        chunk = rows[i:i + CHUNK]
        psycopg2.extras.execute_values(cur, _INSERT, chunk)
        if len(rows) > CHUNK:
            print(f"  {min(i + CHUNK, len(rows)):,}/{len(rows):,} inserted...", end="\r")
    if len(rows) > CHUNK:
        print()

    conn.commit()
    cur.close()
    conn.close()
    print(f"  Inserted {len(rows):,} rows into devdb_ext.housemaster")
    print("Done.")


if __name__ == "__main__":
    main()
