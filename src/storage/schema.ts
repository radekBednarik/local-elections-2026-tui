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

const REFERENCE_TABLES = `
CREATE TABLE IF NOT EXISTS region (
  numnuts      TEXT PRIMARY KEY,
  nuts         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  name_folded  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS district (
  nuts         TEXT PRIMARY KEY,
  region_nuts  TEXT REFERENCES region(nuts),
  name         TEXT NOT NULL,
  name_folded  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS municipality (
  obec           TEXT PRIMARY KEY,
  district_nuts  TEXT REFERENCES district(nuts),
  name           TEXT NOT NULL,
  name_folded    TEXT NOT NULL
);

-- The unit results are actually reported for: a municipal or borough assembly.
CREATE TABLE IF NOT EXISTS council (
  kodzastup         TEXT PRIMARY KEY,
  obec              TEXT REFERENCES municipality(obec),
  district_nuts     TEXT REFERENCES district(nuts),
  name              TEXT NOT NULL,
  name_folded       TEXT NOT NULL,
  -- OBEC = municipal assembly, MCMO = borough or city-district assembly (FR-035).
  oznac_typu        TEXT NOT NULL CHECK (oznac_typu IN ('OBEC', 'MCMO')),
  druhzastup        TEXT REFERENCES council_type(druhzastup),
  typzastup         TEXT REFERENCES council_class(typzastup),
  mandaty           INTEGER,
  cobvodu           INTEGER,
  stav_obce         TEXT,
  -- Set for boroughs so FR-035 can attribute them to their parent municipality.
  parent_kodzastup  TEXT REFERENCES council(kodzastup)
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

CREATE TABLE IF NOT EXISTS electoral_party_composition (
  vstrana  TEXT NOT NULL REFERENCES electoral_party(vstrana),
  nstrana  TEXT NOT NULL REFERENCES political_party(nstrana),
  PRIMARY KEY (vstrana, nstrana)
);

-- Full candidate lists, from the KVRK registry. The largest table by far: every
-- candidate in every municipality nationwide.
CREATE TABLE IF NOT EXISTS candidate (
  kodzastup    TEXT NOT NULL REFERENCES council(kodzastup),
  vstrana      TEXT NOT NULL,
  por_str_hl   INTEGER NOT NULL,
  name         TEXT NOT NULL,
  name_folded  TEXT NOT NULL,
  pstrana      TEXT REFERENCES political_affiliation(pstrana),
  cobvodu      INTEGER,
  PRIMARY KEY (kodzastup, vstrana, por_str_hl)
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

CREATE TABLE IF NOT EXISTS party_result (
  snapshot_id   INTEGER NOT NULL REFERENCES result_snapshot(id) ON DELETE CASCADE,
  vstrana       TEXT NOT NULL,
  ballot_order  INTEGER,
  name          TEXT NOT NULL,
  name_folded   TEXT NOT NULL,
  votes         INTEGER NOT NULL DEFAULT 0,
  votes_pct     REAL,
  candidates    INTEGER,
  seats_won     INTEGER NOT NULL DEFAULT 0,
  seats_pct     REAL,
  PRIMARY KEY (snapshot_id, vstrana)
);

-- Elected representatives as reported in the result document (FR-034).
CREATE TABLE IF NOT EXISTS candidate_result (
  snapshot_id   INTEGER NOT NULL REFERENCES result_snapshot(id) ON DELETE CASCADE,
  vstrana       TEXT NOT NULL,
  ballot_number INTEGER NOT NULL,
  given_name    TEXT NOT NULL,
  family_name   TEXT NOT NULL,
  name_folded   TEXT NOT NULL,
  title_before  TEXT,
  title_after   TEXT,
  votes         INTEGER NOT NULL DEFAULT 0,
  votes_pct     REAL,
  elected       INTEGER NOT NULL DEFAULT 1 CHECK (elected IN (0, 1)),
  PRIMARY KEY (snapshot_id, vstrana, ballot_number)
);
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
CREATE INDEX IF NOT EXISTS idx_candidate_list        ON candidate(kodzastup, vstrana);
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
