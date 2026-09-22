/**
 * Watchlist persistence (task T082, FR-039).
 *
 * Stored in the database rather than in memory, because the requirement is that the
 * watchlist survives a restart. Order is the order councils were added, so the list
 * does not reshuffle itself as results change.
 */

import type { Database } from "bun:sqlite"

export interface WatchedCouncil {
  kodzastup: string
  name: string
  parentName: string | null
  position: number
  addedAt: string
}

/** True when the council is on the watchlist. */
export function isWatched(db: Database, kodzastup: string): boolean {
  const row = db.query("SELECT 1 AS present FROM watchlist_entry WHERE kodzastup = $k").get({ k: kodzastup })
  return row !== null
}

/**
 * Adds a council, appending it to the end of the list.
 *
 * Adding one that is already watched is a no-op rather than an error: the caller is a
 * toggle, and a duplicate key would otherwise surface as a crash on a double keypress.
 */
export function addToWatchlist(db: Database, kodzastup: string, now = new Date()): void {
  const max = db.query("SELECT COALESCE(MAX(position), -1) AS m FROM watchlist_entry").get() as {
    m: number
  }
  db.query(
    "INSERT OR IGNORE INTO watchlist_entry (kodzastup, added_at, position) VALUES ($k, $at, $pos)",
  ).run({ k: kodzastup, at: now.toISOString(), pos: max.m + 1 })
}

/** Removes a council. Removing one that is not watched is a no-op. */
export function removeFromWatchlist(db: Database, kodzastup: string): void {
  db.query("DELETE FROM watchlist_entry WHERE kodzastup = $k").run({ k: kodzastup })
}

/** Adds or removes, returning the state afterwards. */
export function toggleWatchlist(db: Database, kodzastup: string, now = new Date()): boolean {
  if (isWatched(db, kodzastup)) {
    removeFromWatchlist(db, kodzastup)
    return false
  }
  addToWatchlist(db, kodzastup, now)
  return true
}

/**
 * The watchlist in the order councils were added.
 *
 * Left-joined to `council` so an entry survives even when reference data has not been
 * loaded: it then shows its code rather than disappearing, which is what FR-011 asks
 * for and also stops a watched council vanishing on a fresh install.
 */
export function listWatchlist(db: Database): WatchedCouncil[] {
  const rows = db
    .query(
      `SELECT w.kodzastup, w.position, w.added_at, c.name, p.name AS parent_name
         FROM watchlist_entry w
         LEFT JOIN council c ON c.kodzastup = w.kodzastup
         LEFT JOIN council p ON p.kodzastup = c.parent_kodzastup
        ORDER BY w.position`,
    )
    .all() as Record<string, unknown>[]

  return rows.map((row) => ({
    kodzastup: String(row.kodzastup),
    name: row.name === null || row.name === undefined ? String(row.kodzastup) : String(row.name),
    parentName: row.parent_name === null || row.parent_name === undefined ? null : String(row.parent_name),
    position: Number(row.position ?? 0),
    addedAt: String(row.added_at),
  }))
}

/** Council codes on the watchlist, for keeping their sources subscribed (FR-018a). */
export function watchedCodes(db: Database): string[] {
  const rows = db.query("SELECT kodzastup FROM watchlist_entry ORDER BY position").all() as {
    kodzastup: string
  }[]
  return rows.map((r) => r.kodzastup)
}
