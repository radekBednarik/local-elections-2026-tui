/**
 * Database opening (task T024).
 *
 * WAL is not optional here. FR-048 requires two instances against one file not to
 * corrupt each other's data, and WAL is what lets a reader and a writer proceed
 * concurrently instead of blocking and timing out.
 */

import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { createSchema, readSchemaVersion, SCHEMA_VERSION } from "./schema.ts"

export interface OpenOptions {
  /** Applied on open. A second instance waits rather than failing immediately. */
  busyTimeoutMs?: number
  readonly?: boolean
}

/**
 * Opens the database, creating the file, its directory and the schema as needed.
 *
 * `strict: true` lets parameters bind without `$` prefixes and makes a typo in a
 * parameter name an error rather than a silent null.
 */
export function openDatabase(path: string, options: OpenOptions = {}): Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true })
  }

  const db = new Database(path, { strict: true, create: true, readonly: options.readonly ?? false })

  // WAL persists in the file, but setting it each time is harmless and means a
  // database created elsewhere still ends up in the right mode.
  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA foreign_keys = ON")
  db.run(`PRAGMA busy_timeout = ${options.busyTimeoutMs ?? 5000}`)
  // NORMAL is the recommended pairing with WAL: durable across application crashes,
  // and far fewer fsyncs than FULL during a fast-moving count.
  db.run("PRAGMA synchronous = NORMAL")

  if (!options.readonly) {
    try {
      const version = readSchemaVersion(db)
      if (version === null) {
        createSchema(db)
      } else if (version !== SCHEMA_VERSION) {
        // No migration path exists yet, and none is needed: everything in the database
        // is either reference data that can be re-fetched or results that refresh
        // within a minute. Rebuilding is simpler than migrating, per KISS.
        throw new SchemaVersionError(version, SCHEMA_VERSION)
      }
    } catch (error) {
      // Never leak the handle on a failed open. On Windows an open handle also blocks
      // the file from being deleted, which turns a clear error into a stuck state.
      db.close()
      throw error
    }
  }

  return db
}

export class SchemaVersionError extends Error {
  constructor(
    readonly found: number,
    readonly expected: number,
  ) {
    super(
      `Databáze má verzi schématu ${found}, očekává se ${expected}. ` +
        "Smažte soubor databáze; registry a výsledky se stáhnou znovu.",
    )
    this.name = "SchemaVersionError"
  }
}

/** Opens an in-memory database with the schema applied. For tests. */
export function openMemoryDatabase(): Database {
  return openDatabase(":memory:")
}
