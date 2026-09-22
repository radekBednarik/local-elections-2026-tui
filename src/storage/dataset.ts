/**
 * Which dataset the stored data came from.
 *
 * The data directory holds one database, and nothing in it recorded WHERE its contents
 * were fetched from. So a run against a mirror left mirrored figures behind, and the
 * next run - pointed at the real source, or at nothing in particular - found them,
 * decided they were current, and drew them. A 2022 result presented as a 2026 one is the
 * worst thing this application can do: every other requirement about provenance exists
 * to prevent exactly that (FR-029, FR-050, SC-017).
 *
 * A dataset is identified by where it came from and what it is: base URL, election and
 * date. Any difference means the stored results describe something else, and something
 * else must not be shown as if it were this.
 *
 * What is kept and what goes:
 *
 *   - Results and subscriptions: always cleared. They belong to the old source, and so
 *     do the ETags that would otherwise suppress a re-fetch.
 *   - Reference data: cleared too. The registries are published per source as well - a
 *     mirror serves its own - so keeping them would resolve new codes against old names.
 *   - The watchlist: kept when only the source or the date changed, because a council
 *     code means the same thing across mirrors of one election. Cleared when the
 *     ELECTION changes, because then it does not.
 *   - Preferences, theme and panel: always kept. They are the user's, not the data's.
 */

import type { Database } from "bun:sqlite"
import { invalidateReference } from "../reference/loader.ts"

const DATASET_KEY = "dataset"

export interface DatasetIdentity {
  baseUrl: string
  election: string
  date: string
}

/**
 * The stored form of an identity.
 *
 * A single string so the comparison is one equality rather than three, and so a value
 * written by an older version that knew fewer fields simply fails to match and triggers
 * a clean reload - which is the safe direction to fail in.
 */
export function datasetKey(identity: DatasetIdentity): string {
  return `${identity.election}|${identity.date}|${identity.baseUrl}`
}

export function readDataset(db: Database): string | null {
  const row = db.query("SELECT value FROM app_config WHERE key = $k").get({ k: DATASET_KEY }) as {
    value: string
  } | null
  return row?.value ?? null
}

export function writeDataset(db: Database, identity: DatasetIdentity): void {
  db.query("INSERT OR REPLACE INTO app_config (key, value) VALUES ($k, $v)").run({
    k: DATASET_KEY,
    v: datasetKey(identity),
  })
}

/** The election part of a stored key, for deciding whether the watchlist still means anything. */
function electionOf(key: string): string {
  return key.split("|", 1)[0] ?? ""
}

/** Every table holding results fetched from a source. */
const RESULT_TABLES = ["result_snapshot", "source_subscription"]

/**
 * Every table holding reference data.
 *
 * `party_result` and `candidate_result` are absent deliberately: they cascade from
 * `result_snapshot`, and listing them as well would be a second place to keep correct.
 */
const REFERENCE_TABLES = [
  "candidate",
  "council_party",
  "electoral_party_composition",
  "electoral_party",
  "political_affiliation",
  "political_party",
  "council_class",
  "council_type",
  "council",
  "municipality",
  "district",
  "region",
]

/** Drops every stored result, leaving the application waiting for fresh data (FR-045). */
export function clearResults(db: Database): void {
  for (const table of RESULT_TABLES) db.run(`DELETE FROM ${table}`)
}

/**
 * Drops reference data and the marker that says it was loaded.
 *
 * The marker is removed through `invalidateReference` rather than by deleting the key
 * here, so the name of that key stays known in exactly one place.
 */
export function clearReference(db: Database): void {
  for (const table of REFERENCE_TABLES) db.run(`DELETE FROM ${table}`)
  invalidateReference(db)
}

export function clearWatchlist(db: Database): void {
  db.run("DELETE FROM watchlist_entry")
}

export interface DatasetChange {
  /** What the database held before, or null on a first run. */
  previous: string | null
  /** True when stored data belonged to a different dataset and was dropped. */
  cleared: boolean
  /** True when the election itself changed, so the watchlist went too. */
  watchlistCleared: boolean
}

/**
 * Makes the database belong to `identity`, clearing whatever belonged to another.
 *
 * Runs in one transaction: a half-cleared database that still claimed to be current
 * would be worse than either state.
 */
export function adoptDataset(db: Database, identity: DatasetIdentity): DatasetChange {
  const previous = readDataset(db)
  const wanted = datasetKey(identity)

  if (previous === wanted) {
    return { previous, cleared: false, watchlistCleared: false }
  }

  // A first run has nothing to clear; it only records what it is about to fetch.
  if (previous === null) {
    const empty = (db.query("SELECT COUNT(*) AS n FROM result_snapshot").get() as { n: number }).n === 0
    if (empty) {
      writeDataset(db, identity)
      return { previous, cleared: false, watchlistCleared: false }
    }
    // Data with no recorded origin: written by a version that did not record one. It
    // cannot be shown to belong here, so it is treated as foreign.
  }

  const watchlistCleared = previous !== null && electionOf(previous) !== identity.election

  db.transaction(() => {
    clearResults(db)
    clearReference(db)
    if (watchlistCleared) clearWatchlist(db)
    writeDataset(db, identity)
  })()

  return { previous, cleared: true, watchlistCleared }
}

/** Clears everything fetched, whatever the dataset, for `--reset`. */
export function resetData(db: Database, identity: DatasetIdentity): void {
  db.transaction(() => {
    clearResults(db)
    clearReference(db)
    writeDataset(db, identity)
  })()
}
