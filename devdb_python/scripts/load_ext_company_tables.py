"""
load_ext_company_tables.py
Load company export CSVs into devdb_ext schema (truncate + reload).

Source: ReferenceFiles/csv exports/
Target: devdb_ext.<table>

Usage:
  python load_ext_company_tables.py --all
  python load_ext_company_tables.py --table gltrans
  python load_ext_company_tables.py --all --dry-run

Tables (housemaster handled by load_ext_housemaster.py, codetail by load_ext_codetail.py):
  categorymaster, companymaster, costcodemaster, gltrans,
  housecostdetail, housecostsummary, housestatuses, optionlotmaster
"""

import argparse
import csv
import os
import sys
from datetime import datetime
from decimal import Decimal, InvalidOperation

import psycopg2
import psycopg2.extras

CSV_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "ReferenceFiles", "csv exports")
DB = dict(dbname="devdb", user="postgres", password="postgres", host="localhost", port=5432)
CHUNK = 10_000


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


def _pk(v):
    """PK string field: strip only, keep empty string (never None)."""
    return (v or "").strip()


def csv_path(name):
    return os.path.join(CSV_DIR, f"{name}.csv")


def insert_chunks(cur, sql, rows, table):
    total = 0
    for i in range(0, len(rows), CHUNK):
        chunk = rows[i:i + CHUNK]
        psycopg2.extras.execute_values(cur, sql, chunk)
        total += len(chunk)
        if len(rows) > CHUNK:
            print(f"  {table}: {total:,}/{len(rows):,} rows inserted...", end="\r")
    if len(rows) > CHUNK:
        print()
    return total


# ── Per-table loaders ─────────────────────────────────────────────────────────

def load_categorymaster(cur, dry_run):
    rows = []
    with open(csv_path("categorymaster"), encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            cc  = _pk(r["companycode"])
            cat = _pk(r["categorycode"])
            if not cc or not cat:
                continue
            rows.append((cc, cat, _s(r["description"])))
    print(f"  categorymaster: {len(rows):,} rows parsed")
    if dry_run:
        return
    cur.execute("TRUNCATE devdb_ext.categorymaster")
    insert_chunks(cur,
        "INSERT INTO devdb_ext.categorymaster (companycode, categorycode, description) VALUES %s",
        rows, "categorymaster")


def load_companymaster(cur, dry_run):
    cols = [
        "companycode", "company_name", "regioncode", "address1", "address2",
        "phonenumber", "faxnumber", "abbreviation", "legaldesc", "idnumber",
        "liabilitystart", "equitystart", "revenuestart", "expensestart", "retainedearnings",
        "currfiscalyear", "currentperiod", "fystartperiod",
        "accountspayable", "discountstaken", "apcash", "apduetofrom",
        "acctsreceivable", "arprogress", "altcompanycode", "landcompanycode", "altsalescompcode",
    ]
    rows = []
    with open(csv_path("companymaster"), encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            cc = _pk(r.get("companycode", ""))
            if not cc:
                continue
            # companycode is PK (keep as-is); all others are _s
            row = (_pk(r.get("companycode", "")),) + tuple(_s(r.get(c, "")) for c in cols[1:])
            rows.append(row)
    print(f"  companymaster: {len(rows):,} rows parsed")
    if dry_run:
        return
    cur.execute("TRUNCATE devdb_ext.companymaster")
    col_list = ", ".join(cols)
    placeholders = ", ".join(["%s"] * len(cols))
    for row in rows:
        cur.execute(f"INSERT INTO devdb_ext.companymaster ({col_list}) VALUES ({placeholders})", row)


def load_costcodemaster(cur, dry_run):
    rows = []
    with open(csv_path("costcodemaster"), encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            cc   = _pk(r["companycode"])
            cat  = _pk(r["categorycode"])
            cost = _pk(r["costcode"])
            if not cc or not cat or not cost:
                continue
            rows.append((cc, cat, cost, _s(r["description"]), _s(r["inactive"]), _s(r["stagecode"])))
    print(f"  costcodemaster: {len(rows):,} rows parsed")
    if dry_run:
        return
    cur.execute("TRUNCATE devdb_ext.costcodemaster")
    insert_chunks(cur,
        "INSERT INTO devdb_ext.costcodemaster (companycode, categorycode, costcode, description, inactive, stagecode) VALUES %s",
        rows, "costcodemaster")


def load_gltrans(cur, dry_run):
    rows = []
    skipped = 0
    with open(csv_path("gltrans"), encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            fy   = _pk(r["fiscal_year"])
            cc   = _pk(r["companycode"])
            acct = _pk(r["glaccount"])
            tdt  = _d(r["transaction_date"])
            tc   = _pk(r["transactioncode"])
            seq  = _pk(r["sequencenumber"])
            if not all([fy, cc, acct, tdt, tc, seq]):
                skipped += 1
                continue
            rows.append((
                fy, cc, acct, tdt, tc, seq,
                _d(r["trans2_date"]),
                _s(r["drcrcode"]), _s(r["cashflag"]), _n(r["amount"]),
                _s(r["remarkcode"]), _s(r["transremark"]), _s(r["batchnum"]),
                _s(r["distributioncomp"]), _s(r["journalnumber"]), _s(r["invoicenumber"]),
                _s(r["vendornumber"]), _s(r["bankcode"]), _s(r["checknumber"]),
                _s(r["developmentcode"]), _s(r["housenumber"]),
                _s(r["categorycode"]), _s(r["costcode"]), _s(r["variancecode"]),
                _s(r["optioncode"]), _s(r["loannumber"]), _s(r["drawtype"]),
            ))
    print(f"  gltrans: {len(rows):,} rows parsed" + (f", {skipped} skipped" if skipped else ""))
    if dry_run:
        return
    cur.execute("TRUNCATE devdb_ext.gltrans")
    insert_chunks(cur,
        """INSERT INTO devdb_ext.gltrans
           (fiscal_year, companycode, glaccount, transaction_date, transactioncode, sequencenumber,
            trans2_date, drcrcode, cashflag, amount, remarkcode, transremark, batchnum,
            distributioncomp, journalnumber, invoicenumber, vendornumber, bankcode, checknumber,
            developmentcode, housenumber, categorycode, costcode, variancecode, optioncode,
            loannumber, drawtype)
           VALUES %s""",
        rows, "gltrans")


def load_housecostdetail(cur, dry_run):
    rows = []
    skipped = 0
    with open(csv_path("housecostdetail"), encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            cc   = _pk(r["companycode"])
            dev  = _pk(r["developmentcode"])
            hn   = _pk(r["housenumber"])
            cat  = _pk(r["categorycode"])
            cost = _pk(r["costcode"])
            tdt  = _d(r["transaction_date"])
            seq  = _pk(r["sequencenumber"])
            if not all([cc, dev, hn, cat, cost, tdt, seq]):
                skipped += 1
                continue
            rows.append((
                cc, dev, hn, cat, cost, tdt, seq,
                _s(r["sourcecode"]), _s(r["remarks"]), _s(r["optioncode"]),
                _s(r["variancecode"]), _s(r["memo"]), _s(r["batchnum"]), _n(r["amount"]),
            ))
    print(f"  housecostdetail: {len(rows):,} rows parsed" + (f", {skipped} skipped" if skipped else ""))
    if dry_run:
        return
    cur.execute("TRUNCATE devdb_ext.housecostdetail")
    insert_chunks(cur,
        """INSERT INTO devdb_ext.housecostdetail
           (companycode, developmentcode, housenumber, categorycode, costcode,
            transaction_date, sequencenumber, sourcecode, remarks, optioncode,
            variancecode, memo, batchnum, amount)
           VALUES %s ON CONFLICT DO NOTHING""",
        rows, "housecostdetail")


def load_housecostsummary(cur, dry_run):
    rows = []
    skipped = 0
    with open(csv_path("housecostsummary"), encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            cc   = _pk(r["companycode"])
            dev  = _pk(r["developmentcode"])
            hn   = _pk(r["housenumber"])
            cat  = _pk(r["categorycode"])
            cost = _pk(r["costcode"])
            if not all([cc, dev, hn, cat, cost]):
                skipped += 1
                continue
            rows.append((cc, dev, hn, cat, cost,
                         _n(r["budgetamount"]), _n(r["actual"]), _n(r["originalbudget"])))
    print(f"  housecostsummary: {len(rows):,} rows parsed" + (f", {skipped} skipped" if skipped else ""))
    if dry_run:
        return
    cur.execute("TRUNCATE devdb_ext.housecostsummary")
    insert_chunks(cur,
        """INSERT INTO devdb_ext.housecostsummary
           (companycode, developmentcode, housenumber, categorycode, costcode,
            budgetamount, actual, originalbudget)
           VALUES %s""",
        rows, "housecostsummary")


def load_housestatuses(cur, dry_run):
    rows = []
    with open(csv_path("housestatuses"), encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            rows.append((
                _s(r["companycode"]), _s(r["developmentcode"]), _s(r["unpackedhousenum"]),
                _s(r["companyname"]), _s(r["developmentname"]),
                _s(r["blocknumber"]), _s(r["lotnumber"]), _s(r["buyername"]),
                _s(r["salespersoncode"]), _s(r["modelcode"]), _s(r["elevationcode"]),
                _d(r["aosdate"]), _d(r["ratifieddate"]), _d(r["settlementdate"]),
                _s(r["lendercode"]), _s(r["loantype"]),
                _s(r["category"]), _s(r["categorydesc"]), _n(r["salesamount"]),
            ))
    print(f"  housestatuses: {len(rows):,} rows parsed")
    if dry_run:
        return
    cur.execute("TRUNCATE devdb_ext.housestatuses")
    insert_chunks(cur,
        """INSERT INTO devdb_ext.housestatuses
           (companycode, developmentcode, unpackedhousenum, companyname, developmentname,
            blocknumber, lotnumber, buyername, salespersoncode, modelcode, elevationcode,
            aosdate, ratifieddate, settlementdate, lendercode, loantype,
            category, categorydesc, salesamount)
           VALUES %s""",
        rows, "housestatuses")


def load_optionlotmaster(cur, dry_run):
    rows = []
    skipped = 0
    with open(csv_path("optionlotmaster"), encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            cc  = _pk(r["companycode"])
            dev = _pk(r["developmentcode"])
            lot = _pk(r["lotnumber"])
            if not all([cc, dev, lot]):
                skipped += 1
                continue
            rows.append((
                cc, dev, lot,
                _s(r["taxblock"]), _s(r["taxlot"]),
                _s(r["address1"]), _s(r["address2"]), _s(r["address3"]),
                _d(r["lotcontractdate"]), _d(r["lotconverdate"]), _d(r["releasesalesdate"]),
                _s(r["lotcomments"]), _s(r["sellername"]),
                _s(r["selleraddress1"]), _s(r["selleraddress2"]),
                _s(r["sellercity"]), _s(r["sellerstate"]), _s(r["sellerzip"]),
                _s(r["sellercountry"]), _s(r["sellerphone"]), _s(r["selleremail"]),
                _d(r["optionexpdate"]), _s(r["orientation"]),
                _n(r["lotpremium"]), _s(r["misc1_field"]), _s(r["misc2_field"]),
            ))
    print(f"  optionlotmaster: {len(rows):,} rows parsed" + (f", {skipped} skipped" if skipped else ""))
    if dry_run:
        return
    cur.execute("TRUNCATE devdb_ext.optionlotmaster")
    insert_chunks(cur,
        """INSERT INTO devdb_ext.optionlotmaster
           (companycode, developmentcode, lotnumber, taxblock, taxlot,
            address1, address2, address3, lotcontractdate, lotconverdate, releasesalesdate,
            lotcomments, sellername, selleraddress1, selleraddress2,
            sellercity, sellerstate, sellerzip, sellercountry, sellerphone, selleremail,
            optionexpdate, orientation, lotpremium, misc1_field, misc2_field)
           VALUES %s""",
        rows, "optionlotmaster")


# ── Dispatcher ────────────────────────────────────────────────────────────────

LOADERS = {
    "categorymaster":   load_categorymaster,
    "companymaster":    load_companymaster,
    "costcodemaster":   load_costcodemaster,
    "gltrans":          load_gltrans,
    "housecostdetail":  load_housecostdetail,
    "housecostsummary": load_housecostsummary,
    "housestatuses":    load_housestatuses,
    "optionlotmaster":  load_optionlotmaster,
}


def main():
    parser = argparse.ArgumentParser(description="Load company export CSVs into devdb_ext")
    parser.add_argument("--all", action="store_true", help="Load all tables")
    parser.add_argument("--table", metavar="TABLE", help=f"Load one table: {', '.join(LOADERS)}")
    parser.add_argument("--dry-run", action="store_true", help="Parse only, no DB writes")
    args = parser.parse_args()

    if not args.all and not args.table:
        parser.print_help()
        sys.exit(1)
    if args.table and args.table not in LOADERS:
        print(f"Unknown table '{args.table}'. Valid: {', '.join(LOADERS)}")
        sys.exit(1)

    tables = list(LOADERS) if args.all else [args.table]

    if args.dry_run:
        print("DRY RUN — parsing only, no DB writes.\n")
        for t in tables:
            LOADERS[t](None, dry_run=True)
        return

    conn = psycopg2.connect(**DB)
    cur = conn.cursor()
    try:
        for t in tables:
            print(f"Loading {t}...")
            LOADERS[t](cur, dry_run=False)
            conn.commit()
            print(f"  {t}: done.")
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()

    print("\nAll done.")


if __name__ == "__main__":
    main()
