/**
 * Database schema (tasks T020-T023).
 *
 * Three groups with different lifecycles, per data-model.md:
 *   reference/  written once on first run, read-only afterwards (FR-020)
 *   result/     overwritten continuously, at most two rows per area (FR-036a)
 *   local/      watchlist, config, polling subscriptions
 *
 * DEVIATIONS FROM data-model.md, all driven by the real published documents that were
 * downloaded in T010 and are described in fixtures/README.md:
 *
 *   1. Result documents carry `NAZEV_STRANY` inline, so a party's name does not depend
 *      on reference data. Reference data is still needed for full candidate lists and
 *      for code-to-name lookups, but the degraded mode in FR-011 is less degraded than
 *      the data model assumed.
 *   2. Results identify a party by `VSTRANA` (a nationwide electoral-party code) plus
 *      `POR_STR_HLAS_LIST` (its ballot position in that council), not by the `OSTRANA`
 *      the data model predicted from the KVROS registry.
 *   3. `ZASTUPITEL` in the results lists only ELECTED representatives. Full candidate
 *      lists come from the KVRK registry, which is why FR-034 needs reference data.
 */

import type { Database } from "bun:sqlite"

/** Bumped whenever the statements below change in a way that needs a rebuild. */
export const SCHEMA_VERSION = 1

/*
 * Reference tables carry NO foreign keys between them, deliberately.
 *
 * Each one is loaded from a separately published file, and those files are not
 * guaranteed to be mutually consistent - 311 of 565 party codes in cvs_slozeni.xml have
 * no row in cns.xml. More importantly, FR-011 requires that a missing or unreadable
 * code list degrade to showing numeric codes rather than preventing the application
 * from starting. A foreign key would turn that graceful degradation into a hard failure.
 *
 * The result tables below DO use foreign keys, because both sides are written by this
 * application inside one transaction and consistency is ours to guarantee.
 */
const REFERENCE_TABLES = `
CREATE TABLE IF NOT EXISTS region (
  numnuts      TEXT PRIMARY KEY,
  nuts         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  name_folded  TEXT NOT NULL
);

-- The 78 districts, being exactly the six-character NUTS codes in CNUMNUTS. This list
-- is what determines which per-district result files exist and are polled (FR-008).
CREATE TABLE IF NOT EXISTS district (
  nuts         TEXT PRIMARY KEY,
  numnuts      TEXT,
  region_nuts  TEXT,
  name         TEXT NOT NULL,
  name_folded  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS municipality (
  obec           TEXT PRIMARY KEY,
  district_nuts  TEXT,
  name           TEXT NOT NULL,
  name_folded    TEXT NOT NULL
);

-- The unit results are actually reported for: a municipal or borough assembly.
CREATE TABLE IF NOT EXISTS council (
  kodzastup         TEXT PRIMARY KEY,
  obec              TEXT,
  -- The registry's numeric OKRES code. NOT reliably the district whose result file
  -- covers this council: Prague's councils carry 1100, which maps to the REGION CZ010,
  -- while Prague's district file is CZ0100 (NUMNUTS 1199). Kept for reference only.
  okres_code        TEXT,
  -- The district whose result document actually contains this council. Filled when a
  -- district document is ingested, because membership is only reliable from the
  -- document itself, not from the registry code above.
  district_nuts     TEXT,
  name              TEXT NOT NULL,
  name_folded       TEXT NOT NULL,
  -- OBEC = municipal assembly, MCMO = borough or city-district assembly (FR-035).
  oznac_typu        TEXT NOT NULL CHECK (oznac_typu IN ('OBEC', 'MCMO')),
  druhzastup        TEXT,
  typzastup         TEXT,
  mandaty           INTEGER,
  cobvodu           INTEGER,
  stav_obce         TEXT,
  -- Set for boroughs so FR-035 can attribute them to their parent municipality.
  parent_kodzastup  TEXT
);

CREATE TABLE IF NOT EXISTS council_type (
  druhzastup  TEXT PRIMARY KEY,
  name        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS council_class (
  typzastup  TEXT PRIMARY KEY,
  name       TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS political_party (
  nstrana     TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  abbrev_30   TEXT,
  abbrev_8    TEXT
);

CREATE TABLE IF NOT EXISTS political_affiliation (
  pstrana    TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  abbrev_30  TEXT,
  abbrev_8   TEXT
);

-- Nationwide catalogue of electoral parties (CVS). NAZEVCELK runs to 2000 characters.
CREATE TABLE IF NOT EXISTS electoral_party (
  vstrana      TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  name_folded  TEXT NOT NULL,
  typvs        TEXT
);

-- No foreign key to political_party, deliberately.
--
-- The publisher's own files are not referentially consistent: 311 of the 565 distinct
-- NSTRANA codes in cvs_slozeni.xml have no matching row in cns.xml. Enforcing the
-- reference would mean either discarding more than half the coalition composition or
-- refusing to start because of someone else's data quality. Instead the row is kept and
-- an unresolvable code degrades to being shown as a code, which is what FR-011 asks for.
CREATE TABLE IF NOT EXISTS electoral_party_composition (
  vstrana  TEXT NOT NULL,
  nstrana  TEXT NOT NULL,
  PRIMARY KEY (vstrana, nstrana)
);

-- THE BRIDGE between a result and a candidate list, from the KV_ROS registry.
--
-- Result documents identify a party by VSTRANA (its nationwide code). Candidate lists
-- identify it by OSTRANA (its number within that one council). Nothing else carries
-- both, so without this table FR-034 cannot connect a party's result to its candidates.
CREATE TABLE IF NOT EXISTS council_party (
  kodzastup     TEXT NOT NULL,
  ostrana       TEXT NOT NULL,
  vstrana       TEXT NOT NULL,
  name          TEXT NOT NULL,
  name_folded   TEXT NOT NULL,
  ballot_order  INTEGER,
  PRIMARY KEY (kodzastup, ostrana)
);

-- Full candidate lists, from the KVRK registry, including candidates not elected.
-- The largest table by far: 110 MB uncompressed for the whole country.
CREATE TABLE IF NOT EXISTS candidate (
  kodzastup    TEXT NOT NULL,
  ostrana      TEXT NOT NULL,
  por_str_hl   INTEGER NOT NULL,
  name         TEXT NOT NULL,
  name_folded  TEXT NOT NULL,
  pstrana      TEXT,
  nstrana      TEXT,
  cobvodu      INTEGER,
  age          INTEGER,
  occupation   TEXT,
  votes        INTEGER,
  elected      INTEGER NOT NULL DEFAULT 0 CHECK (elected IN (0, 1)),
  PRIMARY KEY (kodzastup, ostrana, por_str_hl)
);
`

const RESULT_TABLES = `
-- One area's figures at one moment. At most two rows per area: the current one and the
-- one before it, which is all FR-036a permits. Enforced by a trigger below rather than
-- by application discipline.
CREATE TABLE IF NOT EXISTS result_snapshot (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  area_kind          TEXT NOT NULL CHECK (area_kind IN ('national', 'district', 'council')),
  area_id            TEXT NOT NULL,
  -- Present only for the national document, which reports OBEC and MCMO separately.
  oznac_typu         TEXT,
  -- The publisher's DATUM_CAS_GENEROVANI. Authoritative for "last updated" (FR-021).
  published_at       TEXT NOT NULL,
  -- Local time of retrieval. Used only to compute staleness age (FR-044).
  fetched_at         TEXT NOT NULL,
  districts_total    INTEGER NOT NULL DEFAULT 0,
  districts_counted  INTEGER NOT NULL DEFAULT 0,
  -- Stored as published, never recomputed (FR-029).
  districts_pct      REAL,
  voters_registered  INTEGER,
  envelopes_issued   INTEGER,
  envelopes_returned INTEGER,
  valid_votes        INTEGER,
  turnout_pct        REAL,
  seats_total        INTEGER,
  is_final           INTEGER NOT NULL DEFAULT 0 CHECK (is_final IN (0, 1)),
  is_current         INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),
  -- Digest of everything a user can see, excluding timestamps. Lets an unchanged
  -- re-fetch be recognised and discarded, so it cannot consume the prior snapshot
  -- that change highlighting depends on (FR-036, see storage/snapshots.ts).
  digest             TEXT
);

-- Keyed by ballot position, not by party code.
--
-- One nationwide party code can field TWO SEPARATE LISTS in the same council: Brno-
-- Bosonohy has VSTRANA 90 twice. Keying on (snapshot_id, vstrana) therefore loses a
-- real candidate list, and did, until a district ingest hit the constraint. The ballot
-- position (POR_STR_HLAS_LIST) is what actually distinguishes lists within a council.
-- The national document has no ballot position, but its party codes are unique there,
-- which is why the uniqueness rule coalesces a missing position rather than ignoring it.
CREATE TABLE IF NOT EXISTS party_result (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id   INTEGER NOT NULL REFERENCES result_snapshot(id) ON DELETE CASCADE,
  vstrana       TEXT NOT NULL,
  ballot_order  INTEGER,
  name          TEXT NOT NULL,
  name_folded   TEXT NOT NULL,
  votes         INTEGER NOT NULL DEFAULT 0,
  votes_pct     REAL,
  candidates    INTEGER,
  seats_won     INTEGER NOT NULL DEFAULT 0,
  seats_pct     REAL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_party_result_unique
  ON party_result(snapshot_id, vstrana, COALESCE(ballot_order, -1));

-- Elected representatives as reported in the result document (FR-034).
-- Scoped by ballot position for the same reason as party_result above.
CREATE TABLE IF NOT EXISTS candidate_result (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id   INTEGER NOT NULL REFERENCES result_snapshot(id) ON DELETE CASCADE,
  vstrana       TEXT NOT NULL,
  ballot_order  INTEGER,
  ballot_number INTEGER NOT NULL,
  given_name    TEXT NOT NULL,
  family_name   TEXT NOT NULL,
  name_folded   TEXT NOT NULL,
  title_before  TEXT,
  title_after   TEXT,
  votes         INTEGER NOT NULL DEFAULT 0,
  votes_pct     REAL,
  elected       INTEGER NOT NULL DEFAULT 1 CHECK (elected IN (0, 1))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_candidate_result_unique
  ON candidate_result(snapshot_id, vstrana, COALESCE(ballot_order, -1), ballot_number);
`

const LOCAL_TABLES = `
-- One row per source being polled. Implements FR-015, FR-016 and FR-043.
CREATE TABLE IF NOT EXISTS source_subscription (
  source_key            TEXT PRIMARY KEY,
  area_kind             TEXT NOT NULL,
  area_id               TEXT NOT NULL,
  last_success_at       TEXT,
  last_attempt_at       TEXT,
  last_error            TEXT,
  consecutive_failures  INTEGER NOT NULL DEFAULT 0,
  next_due_at           TEXT,
  etag                  TEXT,
  last_modified         TEXT,
  -- A watched source stays subscribed even when it is off screen (FR-018a).
  pinned                INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1))
);

CREATE TABLE IF NOT EXISTS watchlist_entry (
  kodzastup  TEXT PRIMARY KEY,
  added_at   TEXT NOT NULL,
  position   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_config (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
`

const INDEXES = `
CREATE INDEX IF NOT EXISTS idx_council_obec          ON council(obec);
CREATE INDEX IF NOT EXISTS idx_council_district      ON council(district_nuts);
CREATE INDEX IF NOT EXISTS idx_council_parent        ON council(parent_kodzastup);
CREATE INDEX IF NOT EXISTS idx_council_folded        ON council(name_folded);
CREATE INDEX IF NOT EXISTS idx_municipality_folded   ON municipality(name_folded);
CREATE INDEX IF NOT EXISTS idx_candidate_list        ON candidate(kodzastup, ostrana);
CREATE INDEX IF NOT EXISTS idx_council_party_vstrana ON council_party(kodzastup, vstrana);
CREATE INDEX IF NOT EXISTS idx_candidate_folded      ON candidate(name_folded);
CREATE INDEX IF NOT EXISTS idx_electoral_party_fold  ON electoral_party(name_folded);
-- The hottest read path: every render asks for an area's current snapshot.
CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshot_current
  ON result_snapshot(area_kind, area_id, COALESCE(oznac_typu, ''))
  WHERE is_current = 1;
CREATE INDEX IF NOT EXISTS idx_snapshot_area         ON result_snapshot(area_kind, area_id);
CREATE INDEX IF NOT EXISTS idx_subscription_due      ON source_subscription(next_due_at);
CREATE INDEX IF NOT EXISTS idx_party_result_snapshot ON party_result(snapshot_id);
`

/** Creates every table and index. Safe to run repeatedly. */
export function createSchema(db: Database): void {
  db.run("PRAGMA foreign_keys = ON")
  for (const block of [REFERENCE_TABLES, RESULT_TABLES, LOCAL_TABLES, INDEXES]) {
    db.run(block)
  }
  db.query("INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', $v)").run({
    v: String(SCHEMA_VERSION),
  })
}

/**
 * The schema version recorded in the database, or null when the database is empty.
 *
 * An empty database has no `app_config` table at all, so querying it throws rather
 * than returning no rows. That case means "not yet created", not "broken".
 */
export function readSchemaVersion(db: Database): number | null {
  const exists = db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_config'").get()
  if (exists === null) return null

  const row = db.query("SELECT value FROM app_config WHERE key = 'schema_version'").get() as {
    value: string
  } | null
  return row === null ? null : Number(row.value)
}
