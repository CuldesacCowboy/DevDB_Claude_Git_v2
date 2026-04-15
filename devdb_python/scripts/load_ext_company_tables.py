"""
load_ext_company_tables.py
Load company export CSVs into devdb_ext schema (truncate + reload).

Source: ReferenceFiles/csv exports/
Target: devdb_ext.<table>

Usage:
  python load_ext_company_tables.py --all
  python load_ext_company_tables.py --table gltrans
  python load_ext_company_tables.py --all --dry-run

Tables (housemaster is handled by load_ext_housemaster.py):
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


# ── Helpers ───────────────────────────────────────────────────────────────────

def s(v):
    """Empty string → None, else stripped string."""
    v = v.strip() if v else ""
    return v or None


def d(v):
    """Parse date string (M/D/YYYY or M/D/YYYY H:MM:SS). Empty → None."""
    v = v.strip() if v else ""
    if not v:
        return None
    for fmt in ("%m/%d/%Y %H:%M:%S", "%m/%d/%Y"):
        try:
            return datetime.strptime(v, fmt).date()
        except ValueError:
            pass
    return None


def n(v):
    """Parse numeric string. Empty → None."""
    v = v.strip() if v else ""
    if not v:
        return None
    try:
        return Decimal(v)
    except InvalidOperation:
        return None


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
            cc = s(r["companycode"])
            cat = s(r["categorycode"])
            if not cc or not cat:
                continue
            rows.append((cc, cat, s(r["description"])))

    print(f"  categorymaster: {len(rows):,} rows parsed")
    if dry_run:
        return

    cur.execute("TRUNCATE devdb_ext.categorymaster")
    insert_chunks(cur,
        "INSERT INTO devdb_ext.categorymaster (companycode,categorycode,description,imported_at) VALUES %s",
        [(cc, cat, desc, "NOW()") for cc, cat, desc in rows],
        "categorymaster",
    )


def load_companymaster(cur, dry_run):
    cols = [
        "companycode","company_name","regioncode","address1","address2",
        "phonenumber","faxnumber","abbreviation","legaldesc","idnumber",
        "liabilitystart","equitystart","revenuestart","expensestart","retainedearnings",
        "currfiscalyear","currentperiod","fystartperiod",
        "accountspayable","discountstaken","apcash","apduetofrom",
        "acctsreceivable","arprogress","altcompanycode","landcompanycode","altsalescompcode",
    ]
    rows = []
    with open(csv_path("companymaster"), encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            cc = s(r.get("companycode", ""))
            if not cc:
                continue
            rows.append(tuple(s(r.get(c, "")) for c in cols))

    print(f"  companymaster: {len(rows):,} rows parsed")
    if dry_run:
        return

    cur.execute("TRUNCATE devdb_ext.companymaster")
    placeholders = ",".join(["%s"] * len(cols))
    col_list = ",".join(cols)
    for row in rows:
        cur.execute(
            f"INSERT INTO devdb_ext.companymaster ({col_list},imported_at) VALUES ({placeholders},NOW())",
            row,
        )


def load_costcodemaster(cur, dry_run):
    rows = []
    with open(csv_path("costcodemaster"), encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            cc = s(r["companycode"])
            cat = s(r["categorycode"])
            cost = s(r["costcode"])
            if not cc or not cat or not cost:
                continue
            rows.append((cc, cat, cost, s(r["description"]), s(r["inactive"]), s(r["stagecode"])))

    print(f"  costcodemaster: {len(rows):,} rows parsed")
    if dry_run:
        return

    cur.execute("TRUNCATE devdb_ext.costcodemaster")
    insert_chunks(cur,
        """INSERT INTO devdb_ext.costcodemaster
           (companycode,categorycode,costcode,description,inactive,stagecode,imported_at)
           VALUES %s""",
        [(cc, cat, cost, desc, inact, stage, "NOW()") for cc, cat, cost, desc, inact, stage in rows],
        "costcodemaster",
    )


def load_gltrans(cur, dry_run):
    rows = []
    skipped = 0
    with open(csv_path("gltrans"), encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            try:
                rows.append((
                    s(r["fiscal_year"]), s(r["companycode"]), s(r["glaccount"]),
                    d(r["transaction_date"]), s(r["transactioncode"]), s(r["sequencenumber"]),
                    d(r["trans2_date"]), s(r["drcrcode"]), s(r["cashflag"]),
                    n(r["amount"]), s(r["remarkcode"]), s(r["transremark"]),
                    s(r["batchnum"]), s(r["distributioncomp"]), s(r["journalnumber"]),
                    s(r["invoicenumber"]), s(r["vendornumber"]), s(r["bankcode"]),
                    s(r["checknumber"]), s(r["developmentcode"]), s(r["housenumber"]),
                    s(r["categorycode"]), s(r["costcode"]), s(r["variancecode"]),
                    s(r["optioncode"]), s(r["loannumber"]), s(r["drawtype"]),
                ))
            except (KeyError, Exception):
                skipped += 1

    print(f"  gltrans: {len(rows):,} rows parsed" + (f", {skipped} skipped" if skipped else ""))
    if dry_run:
        return

    cur.execute("TRUNCATE devdb_ext.gltrans RESTART IDENTITY")
    insert_chunks(cur,
        """INSERT INTO devdb_ext.gltrans
           (fiscal_year,companycode,glaccount,transaction_date,transactioncode,sequencenumber,
            trans2_date,drcrcode,cashflag,amount,remarkcode,transremark,batchnum,
            distributioncomp,journalnumber,invoicenumber,vendornumber,bankcode,checknumber,
            developmentcode,housenumber,categorycode,costcode,variancecode,optioncode,
            loannumber,drawtype,imported_at)
           VALUES %s""",
        [r + ("NOW()",) for r in rows],
        "gltrans",
    )


def load_housecostdetail(cur, dry_run):
    rows = []
    skipped = 0
    with open(csv_path("housecostdetail"), encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            cc = s(r["companycode"])
            dev = s(r["developmentcode"])
            house = s(r["housenumber"])
            cat = s(r["categorycode"])
            cost = s(r["costcode"])
            seq = s(r["sequencenumber"])
            if not all([cc, dev, house, cat, cost, seq]):
                skipped += 1
                continue
            rows.append((
                cc, dev, house, cat, cost, seq,
                d(r["transaction_date"]), s(r["sourcecode"]), s(r["remarks"]),
                s(r["optioncode"]), s(r["variancecode"]), s(r["memo"]),
                s(r["batchnum"]), n(r["amount"]),
            ))

    print(f"  housecostdetail: {len(rows):,} rows parsed" + (f", {skipped} skipped" if skipped else ""))
    if dry_run:
        return

    cur.execute("TRUNCATE devdb_ext.housecostdetail")
    insert_chunks(cur,
        """INSERT INTO devdb_ext.housecostdetail
           (companycode,developmentcode,housenumber,categorycode,costcode,sequencenumber,
            transaction_date,sourcecode,remarks,optioncode,variancecode,memo,
            batchnum,amount,imported_at)
           VALUES %s""",
        [r + ("NOW()",) for r in rows],
        "housecostdetail",
    )


def load_housecostsummary(cur, dry_run):
    rows = []
    skipped = 0
    with open(csv_path("housecostsummary"), encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            cc = s(r["companycode"])
            dev = s(r["developmentcode"])
            house = s(r["housenumber"])
            cat = s(r["categorycode"])
            cost = s(r["costcode"])
            if not all([cc, dev, house, cat, cost]):
                skipped += 1
                continue
            rows.append((cc, dev, house, cat, cost, n(r["budgetamount"]), n(r["actual"]), n(r["originalbudget"])))

    print(f"  housecostsummary: {len(rows):,} rows parsed" + (f", {skipped} skipped" if skipped else ""))
    if dry_run:
        return

    cur.execute("TRUNCATE devdb_ext.housecostsummary")
    insert_chunks(cur,
        """INSERT INTO devdb_ext.housecostsummary
           (companycode,developmentcode,housenumber,categorycode,costcode,
            budgetamount,actual,originalbudget,imported_at)
           VALUES %s""",
        [r + ("NOW()",) for r in rows],
        "housecostsummary",
    )


def load_housestatuses(cur, dry_run):
    rows = []
    skipped = 0
    with open(csv_path("housestatuses"), encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            # Skip blank summary rows (no company or dev code)
            if not s(r.get("companycode")) and not s(r.get("developmentcode")):
                skipped += 1
                continue
            rows.append((
                s(r["companycode"]), s(r["developmentcode"]), s(r["unpackedhousenum"]),
                s(r["companyname"]), s(r["developmentname"]),
                s(r["blocknumber"]), s(r["lotnumber"]), s(r["buyername"]),
                s(r["salespersoncode"]), s(r["modelcode"]), s(r["elevationcode"]),
                d(r["aosdate"]), d(r["ratifieddate"]), d(r["settlementdate"]),
                s(r["lendercode"]), s(r["loantype"]),
                s(r["category"]), s(r["categorydesc"]), n(r["salesamount"]),
            ))

    print(f"  housestatuses: {len(rows):,} rows parsed" + (f", {skipped} blank rows skipped" if skipped else ""))
    if dry_run:
        return

    cur.execute("TRUNCATE devdb_ext.housestatuses")
    insert_chunks(cur,
        """INSERT INTO devdb_ext.housestatuses
           (companycode,developmentcode,unpackedhousenum,companyname,developmentname,
            blocknumber,lotnumber,buyername,salespersoncode,modelcode,elevationcode,
            aosdate,ratifieddate,settlementdate,lendercode,loantype,
            category,categorydesc,salesamount,imported_at)
           VALUES %s""",
        [r + ("NOW()",) for r in rows],
        "housestatuses",
    )


def load_optionlotmaster(cur, dry_run):
    rows = []
    skipped = 0
    with open(csv_path("optionlotmaster"), encoding="utf-8-sig", newline="") as f:
        for r in csv.DictReader(f):
            cc = s(r["companycode"])
            dev = s(r["developmentcode"])
            lot = s(r["lotnumber"])
            if not all([cc, dev, lot]):
                skipped += 1
                continue
            rows.append((
                cc, dev, lot,
                s(r["taxblock"]), s(r["taxlot"]),
                s(r["address1"]), s(r["address2"]), s(r["address3"]),
                d(r["lotcontractdate"]), d(r["lotconverdate"]), d(r["releasesalesdate"]),
                s(r["lotcomments"]), s(r["sellername"]),
                s(r["selleraddress1"]), s(r["selleraddress2"]),
                s(r["sellercity"]), s(r["sellerstate"]), s(r["sellerzip"]),
                s(r["sellercountry"]), s(r["sellerphone"]), s(r["selleremail"]),
                d(r["optionexpdate"]), s(r["orientation"]),
                n(r["lotpremium"]), s(r["misc1_field"]), s(r["misc2_field"]),
            ))

    print(f"  optionlotmaster: {len(rows):,} rows parsed" + (f", {skipped} skipped" if skipped else ""))
    if dry_run:
        return

    cur.execute("TRUNCATE devdb_ext.optionlotmaster")
    insert_chunks(cur,
        """INSERT INTO devdb_ext.optionlotmaster
           (companycode,developmentcode,lotnumber,taxblock,taxlot,
            address1,address2,address3,lotcontractdate,lotconverdate,releasesalesdate,
            lotcomments,sellername,selleraddress1,selleraddress2,
            sellercity,sellerstate,sellerzip,sellercountry,sellerphone,selleremail,
            optionexpdate,orientation,lotpremium,misc1_field,misc2_field,imported_at)
           VALUES %s""",
        [r + ("NOW()",) for r in rows],
        "optionlotmaster",
    )


# ── Dispatcher ────────────────────────────────────────────────────────────────

LOADERS = {
    "categorymaster":  load_categorymaster,
    "companymaster":   load_companymaster,
    "costcodemaster":  load_costcodemaster,
    "gltrans":         load_gltrans,
    "housecostdetail": load_housecostdetail,
    "housecostsummary":load_housecostsummary,
    "housestatuses":   load_housestatuses,
    "optionlotmaster": load_optionlotmaster,
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
