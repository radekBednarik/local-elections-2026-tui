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
