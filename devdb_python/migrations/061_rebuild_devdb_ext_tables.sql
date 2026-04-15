-- Migration 061: Rebuild all devdb_ext tables as exact source replicas.
--
-- Drops all existing devdb_ext tables and recreates them with:
--   * Every column from the source CSV, exact names (lowercased for Postgres)
--   * Natural PKs as defined by the source database
--   * No imported_at, no surrogate keys, no added constraints
--
-- Tables: categorymaster, codetail, companymaster, costcodemaster, gltrans,
--         housecostdetail, housecostsummary, housemaster, housestatuses, optionlotmaster

-- ── Drop existing tables ──────────────────────────────────────────────────────
DROP TABLE IF EXISTS devdb_ext.categorymaster;
DROP TABLE IF EXISTS devdb_ext.codetail;
DROP TABLE IF EXISTS devdb_ext.companymaster;
DROP TABLE IF EXISTS devdb_ext.costcodemaster;
DROP TABLE IF EXISTS devdb_ext.gltrans;
DROP TABLE IF EXISTS devdb_ext.housecostdetail;
DROP TABLE IF EXISTS devdb_ext.housecostsummary;
DROP TABLE IF EXISTS devdb_ext.housemaster;
DROP TABLE IF EXISTS devdb_ext.housestatuses;
DROP TABLE IF EXISTS devdb_ext.optionlotmaster;

-- ── categorymaster ────────────────────────────────────────────────────────────
-- PK: (companycode, categorycode)
CREATE TABLE devdb_ext.categorymaster (
    companycode   VARCHAR(20)  NOT NULL,
    categorycode  VARCHAR(20)  NOT NULL,
    description   TEXT,
    PRIMARY KEY (companycode, categorycode)
);

-- ── codetail ──────────────────────────────────────────────────────────────────
-- PK: (companycode, developmentcode, housenumber, conumber, adddeleteflag, optioncode)
-- Note: adddeleteflag is always empty string in source data; stored as '' not NULL
CREATE TABLE devdb_ext.codetail (
    companycode       VARCHAR(20)  NOT NULL,
    developmentcode   VARCHAR(20)  NOT NULL,
    housenumber       INTEGER      NOT NULL,
    conumber          VARCHAR(20)  NOT NULL,
    adddeleteflag     VARCHAR(5)   NOT NULL,
    optioncode        VARCHAR(20)  NOT NULL,
    optioncategory    TEXT,
    location          TEXT,
    quantity          NUMERIC,
    description       TEXT,
    salesprice        NUMERIC(18,4),
    PRIMARY KEY (companycode, developmentcode, housenumber, conumber, adddeleteflag, optioncode)
);
CREATE INDEX idx_ext_codetail_lot ON devdb_ext.codetail (developmentcode, housenumber);

-- ── companymaster ─────────────────────────────────────────────────────────────
-- PK: companycode
CREATE TABLE devdb_ext.companymaster (
    companycode        VARCHAR(20)  NOT NULL  PRIMARY KEY,
    company_name       TEXT,
    regioncode         TEXT,
    address1           TEXT,
    address2           TEXT,
    phonenumber        TEXT,
    faxnumber          TEXT,
    abbreviation       TEXT,
    legaldesc          TEXT,
    idnumber           TEXT,
    liabilitystart     TEXT,
    equitystart        TEXT,
    revenuestart       TEXT,
    expensestart       TEXT,
    retainedearnings   TEXT,
    currfiscalyear     TEXT,
    currentperiod      TEXT,
    fystartperiod      TEXT,
    accountspayable    TEXT,
    discountstaken     TEXT,
    apcash             TEXT,
    apduetofrom        TEXT,
    acctsreceivable    TEXT,
    arprogress         TEXT,
    altcompanycode     TEXT,
    landcompanycode    TEXT,
    altsalescompcode   TEXT
);

-- ── costcodemaster ────────────────────────────────────────────────────────────
-- PK: (companycode, categorycode, costcode)
CREATE TABLE devdb_ext.costcodemaster (
    companycode   VARCHAR(20)  NOT NULL,
    categorycode  VARCHAR(20)  NOT NULL,
    costcode      VARCHAR(20)  NOT NULL,
    description   TEXT,
    inactive      TEXT,
    stagecode     TEXT,
    PRIMARY KEY (companycode, categorycode, costcode)
);

-- ── gltrans ───────────────────────────────────────────────────────────────────
-- PK: (fiscal_year, companycode, glaccount, transaction_date, transactioncode, sequencenumber)
CREATE TABLE devdb_ext.gltrans (
    fiscal_year       VARCHAR(10)  NOT NULL,
    companycode       VARCHAR(20)  NOT NULL,
    glaccount         VARCHAR(30)  NOT NULL,
    transaction_date  DATE         NOT NULL,
    transactioncode   VARCHAR(20)  NOT NULL,
    sequencenumber    VARCHAR(30)  NOT NULL,
    trans2_date       DATE,
    drcrcode          TEXT,
    cashflag          TEXT,
    amount            NUMERIC(18,4),
    remarkcode        TEXT,
    transremark       TEXT,
    batchnum          TEXT,
    distributioncomp  TEXT,
    journalnumber     TEXT,
    invoicenumber     TEXT,
    vendornumber      TEXT,
    bankcode          TEXT,
    checknumber       TEXT,
    developmentcode   TEXT,
    housenumber       TEXT,
    categorycode      TEXT,
    costcode          TEXT,
    variancecode      TEXT,
    optioncode        TEXT,
    loannumber        TEXT,
    drawtype          TEXT,
    PRIMARY KEY (fiscal_year, companycode, glaccount, transaction_date, transactioncode, sequencenumber)
);
CREATE INDEX idx_ext_gltrans_dev_house ON devdb_ext.gltrans (companycode, developmentcode, housenumber);
CREATE INDEX idx_ext_gltrans_account   ON devdb_ext.gltrans (companycode, glaccount);

-- ── housecostdetail ───────────────────────────────────────────────────────────
-- PK: (companycode, developmentcode, housenumber, categorycode, costcode, transaction_date, sequencenumber)
CREATE TABLE devdb_ext.housecostdetail (
    companycode       VARCHAR(20)  NOT NULL,
    developmentcode   VARCHAR(20)  NOT NULL,
    housenumber       VARCHAR(20)  NOT NULL,
    categorycode      VARCHAR(20)  NOT NULL,
    costcode          VARCHAR(20)  NOT NULL,
    transaction_date  DATE         NOT NULL,
    sequencenumber    VARCHAR(20)  NOT NULL,
    sourcecode        TEXT,
    remarks           TEXT,
    optioncode        TEXT,
    variancecode      TEXT,
    memo              TEXT,
    batchnum          TEXT,
    amount            NUMERIC(18,4),
    PRIMARY KEY (companycode, developmentcode, housenumber, categorycode, costcode, transaction_date, sequencenumber)
);
CREATE INDEX idx_ext_housecostdetail_lot ON devdb_ext.housecostdetail (companycode, developmentcode, housenumber);

-- ── housecostsummary ──────────────────────────────────────────────────────────
-- PK: (companycode, developmentcode, housenumber, categorycode, costcode)
CREATE TABLE devdb_ext.housecostsummary (
    companycode      VARCHAR(20)   NOT NULL,
    developmentcode  VARCHAR(20)   NOT NULL,
    housenumber      VARCHAR(20)   NOT NULL,
    categorycode     VARCHAR(20)   NOT NULL,
    costcode         VARCHAR(20)   NOT NULL,
    budgetamount     NUMERIC(18,4),
    actual           NUMERIC(18,4),
    originalbudget   NUMERIC(18,4),
    PRIMARY KEY (companycode, developmentcode, housenumber, categorycode, costcode)
);
CREATE INDEX idx_ext_housecostsummary_lot ON devdb_ext.housecostsummary (companycode, developmentcode, housenumber);

-- ── housemaster ───────────────────────────────────────────────────────────────
-- PK: (companycode, developmentcode, housenumber)
-- All 138 columns from tzzM01_JTH_HOUSEMASTER1 export
CREATE TABLE devdb_ext.housemaster (
    code1             TEXT,
    companycode       VARCHAR(20)   NOT NULL,
    developmentcode   VARCHAR(20)   NOT NULL,
    housenumber       INTEGER       NOT NULL,
    modelcode         TEXT,
    elevationcode     TEXT,
    remarks           TEXT,
    blocknumber       TEXT,
    lotnumber         TEXT,
    comments          TEXT,
    release_date      DATE,
    jionumber         TEXT,
    unused            TEXT,
    currentjobstart   DATE,
    lastjobstart      DATE,
    buyername         TEXT,
    settlement_date   DATE,
    deposit_date      DATE,
    misc1_date        DATE,
    unused_2          TEXT,
    financing_type    TEXT,
    misc2_date        DATE,
    misc3_date        DATE,
    costflag          TEXT,
    salesreleasedate  DATE,
    contract_date     DATE,
    ratified_date     DATE,
    building_num      TEXT,
    cntrk_submt_date  DATE,
    homephone         TEXT,
    workphone         TEXT,
    option_incv_amt   NUMERIC(18,4),
    closing_incv_amt  NUMERIC(18,4),
    points_incv_amt   NUMERIC(18,4),
    coop_amount       NUMERIC(18,4),
    permitnumber      TEXT,
    coop_yn           TEXT,
    unused_3          TEXT,
    orientation       TEXT,
    loan_num          TEXT,
    warrantypolicy    TEXT,
    address1          TEXT,
    address2          TEXT,
    address3          TEXT,
    warranty_date     DATE,
    unpackedhousenum  TEXT,
    misc4_date        DATE,
    broker_amount     NUMERIC(18,4),
    misc5_date        DATE,
    misc6_date        DATE,
    misc7_date        DATE,
    unused2           TEXT,
    upgradeprice      NUMERIC(18,4),
    agentcode         TEXT,
    brokercode        TEXT,
    coop_name         TEXT,
    house_type        TEXT,
    broker_pct        NUMERIC(18,4),
    lst_chgord_num    TEXT,
    misc8_date        DATE,
    permit_date       DATE,
    pvc8              TEXT,
    deposit_due       NUMERIC(18,4),
    est_base_price    NUMERIC(18,4),
    est_options_prc   NUMERIC(18,4),
    est_lot_premium   NUMERIC(18,4),
    salesmancode      TEXT,
    title_co          TEXT,
    mtg_prequal_date  DATE,
    aosacceptedflag   TEXT,
    est_upgrade_prc   NUMERIC(18,4),
    releasenum        TEXT,
    coop_agent_addr1  TEXT,
    coop_agent_addr2  TEXT,
    not_used_2        TEXT,
    estsettl_date     DATE,
    misc9_date        DATE,
    walk_thru_date    DATE,
    mtg_approv_date   DATE,
    postage           NUMERIC(18,4),
    walk_thru_time    TEXT,
    am_pm             TEXT,
    unused4           TEXT,
    conststart_date   DATE,
    lothold           TEXT,
    mtg_applied_date  DATE,
    misc10_date       DATE,
    wostage           TEXT,
    misc11_date       DATE,
    misc12_date       DATE,
    misc1_field       TEXT,
    misc2_field       TEXT,
    buyersname1       TEXT,
    buyersname2       TEXT,
    buyersname3       TEXT,
    previousaddress1  TEXT,
    previousaddress2  TEXT,
    promissorynote1   TEXT,
    promissorynote2   TEXT,
    promissory1date   DATE,
    promissory2date   DATE,
    promissoryamt1    NUMERIC(18,4),
    promissoryamt2    NUMERIC(18,4),
    pvc               TEXT,
    warrantycomments  TEXT,
    promissorynote3   TEXT,
    promissory3date   DATE,
    promissoryamt3    NUMERIC(18,4),
    depositamtpaid    NUMERIC(18,4),
    ins1_date         DATE,
    ins2_date         DATE,
    ins3_date         DATE,
    ins4_date         DATE,
    ins5_date         DATE,
    pctcompl          NUMERIC(18,4),
    pvc1              TEXT,
    casenumber        TEXT,
    lotcontractdate   DATE,
    lotratifydate     DATE,
    lotsettledate     DATE,
    specflag          TEXT,
    housetaxenable    TEXT,
    cellphone         TEXT,
    email             TEXT,
    superuserid       TEXT,
    swornstatement    TEXT,
    terminator        TEXT,
    housetaxpercent   NUMERIC(18,4),
    baseprice         NUMERIC(18,4),
    optionsprice      NUMERIC(18,4),
    lotpremium        NUMERIC(18,4),
    not_used_6        TEXT,
    depositamount     NUMERIC(18,4),
    mortgage_amount   NUMERIC(18,4),
    fee_pct           NUMERIC(18,4),
    points_code       TEXT,
    constr_loan_amt   NUMERIC(18,4),
    pct_of_blding     NUMERIC(18,4),
    PRIMARY KEY (companycode, developmentcode, housenumber)
);

-- ── housestatuses ─────────────────────────────────────────────────────────────
-- No PK defined in source; all 19 columns included
CREATE TABLE devdb_ext.housestatuses (
    companycode       TEXT,
    developmentcode   TEXT,
    unpackedhousenum  TEXT,
    companyname       TEXT,
    developmentname   TEXT,
    blocknumber       TEXT,
    lotnumber         TEXT,
    buyername         TEXT,
    salespersoncode   TEXT,
    modelcode         TEXT,
    elevationcode     TEXT,
    aosdate           DATE,
    ratifieddate      DATE,
    settlementdate    DATE,
    lendercode        TEXT,
    loantype          TEXT,
    category          TEXT,
    categorydesc      TEXT,
    salesamount       NUMERIC(18,4)
);

-- ── optionlotmaster ───────────────────────────────────────────────────────────
-- PK: (companycode, developmentcode, lotnumber)
CREATE TABLE devdb_ext.optionlotmaster (
    companycode        VARCHAR(20)  NOT NULL,
    developmentcode    VARCHAR(20)  NOT NULL,
    lotnumber          VARCHAR(20)  NOT NULL,
    taxblock           TEXT,
    taxlot             TEXT,
    address1           TEXT,
    address2           TEXT,
    address3           TEXT,
    lotcontractdate    DATE,
    lotconverdate      DATE,
    releasesalesdate   DATE,
    lotcomments        TEXT,
    sellername         TEXT,
    selleraddress1     TEXT,
    selleraddress2     TEXT,
    sellercity         TEXT,
    sellerstate        TEXT,
    sellerzip          TEXT,
    sellercountry      TEXT,
    sellerphone        TEXT,
    selleremail        TEXT,
    optionexpdate      DATE,
    orientation        TEXT,
    lotpremium         NUMERIC(18,4),
    misc1_field        TEXT,
    misc2_field        TEXT,
    PRIMARY KEY (companycode, developmentcode, lotnumber)
);
