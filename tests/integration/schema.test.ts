import type { Database } from "bun:sqlite"
import { describe, expect, test } from "bun:test"
import { openDatabase, openMemoryDatabase, SchemaVersionError } from "../../src/storage/db.ts"
import { createSchema, readSchemaVersion, SCHEMA_VERSION } from "../../src/storage/schema.ts"
import { withTempDataDir } from "../helpers/tmpdir.ts"

function tableNames(db: Database): string[] {
  const rows = db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[]
  return rows.map((r) => r.name)
}

describe("schema creation", () => {
  test("creates every table the data model calls for", () => {
    const db = openMemoryDatabase()
    try {
      const tables = tableNames(db)
      for (const expected of [
        "candidate",
        "candidate_result",
        "council",
        "council_class",
        "council_type",
        "district",
        "electoral_party",
        "electoral_party_composition",
        "municipality",
        "party_result",
        "political_affiliation",
        "political_party",
        "region",
        "result_snapshot",
        "source_subscription",
        "watchlist_entry",
        "app_config",
      ]) {
        expect(tables).toContain(expected)
      }
    } finally {
      db.close()
    }
  })

  test("is idempotent", () => {
    const db = openMemoryDatabase()
    try {
      expect(() => {
        createSchema(db)
        createSchema(db)
      }).not.toThrow()
      expect(readSchemaVersion(db)).toBe(SCHEMA_VERSION)
    } finally {
      db.close()
    }
  })

  test("enables WAL on a real file", async () => {
    await withTempDataDir((dir) => {
      const db = openDatabase(dir.file("volby.sqlite"))
      try {
        const mode = db.query("PRAGMA journal_mode").get() as { journal_mode: string }
        expect(mode.journal_mode.toLowerCase()).toBe("wal")
      } finally {
        db.close()
      }
    })
  })

  test("refuses to open a database written by a different schema version", async () => {
    await withTempDataDir((dir) => {
      const path = dir.file("volby.sqlite")
      const db = openDatabase(path)
      db.run("UPDATE app_config SET value = '999' WHERE key = 'schema_version'")
      db.close()

      expect(() => openDatabase(path)).toThrow(SchemaVersionError)
    })
  })

  test("is at version 2, which added finality to the polling state", () => {
    expect(SCHEMA_VERSION).toBe(2)
  })

  test("a source subscription records whether its source is final, defaulting to not", () => {
    const db = openMemoryDatabase()
    try {
      const columns = db.query("PRAGMA table_info(source_subscription)").all() as {
        name: string
        type: string
        notnull: number
        dflt_value: string | null
      }[]
      const final = columns.find((c) => c.name === "final")
      expect(final).toBeDefined()
      expect(final?.type).toBe("INTEGER")
      expect(final?.notnull).toBe(1)
      expect(final?.dflt_value).toBe("0")

      db.run(
        "INSERT INTO source_subscription (source_key, area_kind, area_id) VALUES ('national', 'national', '')",
      )
      const row = db.query("SELECT final FROM source_subscription").get() as { final: number }
      expect(row.final).toBe(0)
    } finally {
      db.close()
    }
  })
})

/** The `source_subscription` table exactly as schema version 1 created it. */
const VERSION_1_SUBSCRIPTION = `
CREATE TABLE source_subscription (
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
  pinned                INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1))
)`

describe("upgrading from schema version 1", () => {
  test("a version-1 database opens, gains the column and keeps every row", async () => {
    await withTempDataDir((dir) => {
      const path = dir.file("volby.sqlite")
      const old = openDatabase(path)
      old.run("DROP TABLE source_subscription")
      old.run(VERSION_1_SUBSCRIPTION)
      old.run("UPDATE app_config SET value = '1' WHERE key = 'schema_version'")
      old.run(
        "INSERT INTO source_subscription (source_key, area_kind, area_id, next_due_at) VALUES ('national', 'national', '', '2026-10-09T20:00:00Z')",
      )
      old.run(
        "INSERT INTO watchlist_entry (kodzastup, added_at, position) VALUES ('551082', '2026-09-24T10:00:00Z', 0)",
      )
      old.close()

      const db = openDatabase(path)
      try {
        expect(readSchemaVersion(db)).toBe(2)
        const row = db.query("SELECT final, next_due_at FROM source_subscription").get() as {
          final: number
          next_due_at: string
        }
        expect(row.final).toBe(0)
        expect(row.next_due_at).toBe("2026-10-09T20:00:00Z")
        expect(db.query("SELECT kodzastup FROM watchlist_entry").all()).toEqual([{ kodzastup: "551082" }])
      } finally {
        db.close()
      }
    })
  })
})

describe("constraints", () => {
  test("area_kind is restricted to the three real levels", () => {
    const db = openMemoryDatabase()
    try {
      expect(() => {
        db.run(
          "INSERT INTO result_snapshot (area_kind, area_id, published_at, fetched_at) VALUES ('okrsek', 'x', 'p', 'f')",
        )
      }).toThrow()
    } finally {
      db.close()
    }
  })

  test("oznac_typu on a council is restricted to OBEC or MCMO", () => {
    const db = openMemoryDatabase()
    try {
      expect(() => {
        db.run(
          "INSERT INTO council (kodzastup, name, name_folded, oznac_typu) VALUES ('1', 'X', 'x', 'JINY')",
        )
      }).toThrow()
    } finally {
      db.close()
    }
  })

  test("only one current snapshot may exist per area (FR-036a)", () => {
    const db = openMemoryDatabase()
    try {
      const insert = db.query(
        "INSERT INTO result_snapshot (area_kind, area_id, published_at, fetched_at, is_current) VALUES ('council', '551082', $p, 'f', 1)",
      )
      insert.run({ p: "2026-10-09T20:00:00" })
      // A second current row for the same area must be impossible.
      expect(() => {
        insert.run({ p: "2026-10-09T21:00:00" })
      }).toThrow()
    } finally {
      db.close()
    }
  })

  test("the national area may hold one current row per council type", () => {
    const db = openMemoryDatabase()
    try {
      const insert = db.query(
        "INSERT INTO result_snapshot (area_kind, area_id, oznac_typu, published_at, fetched_at, is_current) VALUES ('national', '', $t, 'p', 'f', 1)",
      )
      expect(() => {
        insert.run({ t: "OBEC" })
        insert.run({ t: "MCMO" })
      }).not.toThrow()
    } finally {
      db.close()
    }
  })

  test("a subscription's finality is restricted to 0 or 1", () => {
    const db = openMemoryDatabase()
    try {
      const insert = db.query(
        "INSERT INTO source_subscription (source_key, area_kind, area_id, final) VALUES ($k, 'national', '', $f)",
      )
      expect(() => insert.run({ k: "a", f: 1 })).not.toThrow()
      expect(() => insert.run({ k: "b", f: 2 })).toThrow()
    } finally {
      db.close()
    }
  })

  test("deleting a snapshot removes its party rows", () => {
    const db = openMemoryDatabase()
    try {
      db.run(
        "INSERT INTO result_snapshot (id, area_kind, area_id, published_at, fetched_at) VALUES (1, 'council', '551082', 'p', 'f')",
      )
      db.run(
        "INSERT INTO party_result (snapshot_id, vstrana, name, name_folded, votes) VALUES (1, '768', 'ANO 2011', 'ano 2011', 10)",
      )
      db.run("DELETE FROM result_snapshot WHERE id = 1")
      const left = db.query("SELECT COUNT(*) AS n FROM party_result").get() as { n: number }
      expect(left.n).toBe(0)
    } finally {
      db.close()
    }
  })
})
