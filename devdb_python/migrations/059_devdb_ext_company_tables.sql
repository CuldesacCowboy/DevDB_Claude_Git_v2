-- Migration 059: Add remaining company export tables to devdb_ext schema.
--
-- Source files: ReferenceFiles/csv exports/
-- Tables added: categorymaster, companymaster, costcodemaster, gltrans,
--               housecostdetail, housecostsummary, housestatuses, optionlotmaster
--
-- Note: devdb_ext.housemaster already exists (migration 058). Skipped here.
-- Load script: devdb_python/scripts/load_ext_company_tables.py

-- ── categorymaster ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS devdb_ext.categorymaster (
    companycode   VARCHAR(20)  NOT NULL,
    categorycode  VARCHAR(20)  NOT NULL,
    description   TEXT,
    imported_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (companycode, categorycode)
);

-- ── companymaster ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS devdb_ext.companymaster (
    companycode        VARCHAR(20)  NOT NULL PRIMARY KEY,
    company_name       TEXT,
    regioncode         VARCHAR(20),
    address1           TEXT,
    address2           TEXT,
    phonenumber        VARCHAR(30),
    faxnumber          VARCHAR(30),
    abbreviation       VARCHAR(20),
    legaldesc          TEXT,
    idnumber           VARCHAR(30),
    liabilitystart     VARCHAR(20),
    equitystart        VARCHAR(20),
    revenuestart       VARCHAR(20),
    expensestart       VARCHAR(20),
    retainedearnings   VARCHAR(20),
    currfiscalyear     VARCHAR(10),
    currentperiod      VARCHAR(10),
    fystartperiod      VARCHAR(10),
    accountspayable    VARCHAR(20),
    discountstaken     VARCHAR(20),
    apcash             VARCHAR(20),
    apduetofrom        VARCHAR(20),
    acctsreceivable    VARCHAR(20),
    arprogress         VARCHAR(20),
    altcompanycode     VARCHAR(20),
    landcompanycode    VARCHAR(20),
    altsalescompcode   VARCHAR(20),
    imported_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── costcodemaster ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS devdb_ext.costcodemaster (
    companycode   VARCHAR(20)  NOT NULL,
    categorycode  VARCHAR(20)  NOT NULL,
    costcode      VARCHAR(20)  NOT NULL,
    description   TEXT,
    inactive      VARCHAR(5),
    stagecode     VARCHAR(20),
    imported_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (companycode, categorycode, costcode)
);

-- ── gltrans (1.3M rows; no natural unique key) ────────────────────────────────
CREATE TABLE IF NOT EXISTS devdb_ext.gltrans (
    id               BIGSERIAL    PRIMARY KEY,
    fiscal_year      VARCHAR(10),
    companycode      VARCHAR(20),
    glaccount        VARCHAR(30),
    transaction_date DATE,
    transactioncode  VARCHAR(20),
    sequencenumber   VARCHAR(30),
    trans2_date      DATE,
    drcrcode         VARCHAR(5),
    cashflag         VARCHAR(5),
    amount           NUMERIC(18,4),
    remarkcode       VARCHAR(20),
    transremark      TEXT,
    batchnum         VARCHAR(20),
    distributioncomp VARCHAR(20),
    journalnumber    VARCHAR(20),
    invoicenumber    VARCHAR(30),
    vendornumber     VARCHAR(20),
    bankcode         VARCHAR(20),
    checknumber      VARCHAR(20),
    developmentcode  VARCHAR(20),
    housenumber      VARCHAR(20),
    categorycode     VARCHAR(20),
    costcode         VARCHAR(20),
    variancecode     VARCHAR(20),
    optioncode       VARCHAR(20),
    loannumber       VARCHAR(20),
    drawtype         VARCHAR(5),
    imported_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gltrans_dev_house
    ON devdb_ext.gltrans (companycode, developmentcode, housenumber);
CREATE INDEX IF NOT EXISTS idx_gltrans_account
    ON devdb_ext.gltrans (companycode, glaccount);

-- ── housecostdetail (529K rows) ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS devdb_ext.housecostdetail (
    companycode      VARCHAR(20)  NOT NULL,
    developmentcode  VARCHAR(20)  NOT NULL,
    housenumber      VARCHAR(20)  NOT NULL,
    categorycode     VARCHAR(20)  NOT NULL,
    costcode         VARCHAR(20)  NOT NULL,
    sequencenumber   VARCHAR(20)  NOT NULL,
    transaction_date DATE,
    sourcecode       VARCHAR(10),
    remarks          TEXT,
    optioncode       VARCHAR(20),
    variancecode     VARCHAR(20),
    memo             TEXT,
    batchnum         VARCHAR(20),
    amount           NUMERIC(18,4),
    imported_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (companycode, developmentcode, housenumber, categorycode, costcode, sequencenumber)
);
CREATE INDEX IF NOT EXISTS idx_housecostdetail_dev_house
    ON devdb_ext.housecostdetail (companycode, developmentcode, housenumber);

-- ── housecostsummary (368K rows) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS devdb_ext.housecostsummary (
    companycode      VARCHAR(20)  NOT NULL,
    developmentcode  VARCHAR(20)  NOT NULL,
    housenumber      VARCHAR(20)  NOT NULL,
    categorycode     VARCHAR(20)  NOT NULL,
    costcode         VARCHAR(20)  NOT NULL,
    budgetamount     NUMERIC(18,4),
    actual           NUMERIC(18,4),
    originalbudget   NUMERIC(18,4),
    imported_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (companycode, developmentcode, housenumber, categorycode, costcode)
);
CREATE INDEX IF NOT EXISTS idx_housecostsummary_dev_house
    ON devdb_ext.housecostsummary (companycode, developmentcode, housenumber);

-- ── housestatuses ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS devdb_ext.housestatuses (
    companycode       VARCHAR(20),
    developmentcode   VARCHAR(20),
    unpackedhousenum  VARCHAR(20),
    companyname       TEXT,
    developmentname   TEXT,
    blocknumber       VARCHAR(20),
    lotnumber         VARCHAR(20),
    buyername         TEXT,
    salespersoncode   VARCHAR(20),
    modelcode         VARCHAR(20),
    elevationcode     VARCHAR(20),
    aosdate           DATE,
    ratifieddate      DATE,
    settlementdate    DATE,
    lendercode        VARCHAR(20),
    loantype          VARCHAR(20),
    category          VARCHAR(20),
    categorydesc      TEXT,
    salesamount       NUMERIC(18,4),
    imported_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_housestatuses_key
    ON devdb_ext.housestatuses (companycode, developmentcode, unpackedhousenum)
    WHERE unpackedhousenum IS NOT NULL AND unpackedhousenum <> '';

-- ── optionlotmaster ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS devdb_ext.optionlotmaster (
    companycode        VARCHAR(20)  NOT NULL,
    developmentcode    VARCHAR(20)  NOT NULL,
    lotnumber          VARCHAR(20)  NOT NULL,
    taxblock           VARCHAR(20),
    taxlot             VARCHAR(20),
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
    sellercity         VARCHAR(100),
    sellerstate        VARCHAR(50),
    sellerzip          VARCHAR(20),
    sellercountry      VARCHAR(50),
    sellerphone        VARCHAR(50),
    selleremail        VARCHAR(100),
    optionexpdate      DATE,
    orientation        VARCHAR(5),
    lotpremium         NUMERIC(18,4),
    misc1_field        TEXT,
    misc2_field        TEXT,
    imported_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (companycode, developmentcode, lotnumber)
);
