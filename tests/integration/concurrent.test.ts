/**
 * Two instances against one database file (FR-048).
 *
 * A user may well leave the application running and start a second copy. WAL is what
 * makes that safe; without it the second connection blocks and eventually errors.
 */

import { describe, expect, test } from "bun:test"
import { openDatabase } from "../../src/storage/db.ts"
import { readCurrent, type SnapshotInput, writeSnapshot } from "../../src/storage/snapshots.ts"
import { withTempDataDir } from "../helpers/tmpdir.ts"

function snapshot(areaId: string, counted: number): SnapshotInput {
  return {
    areaKind: "council",
    areaId,
    oznacTypu: null,
    publishedAt: `2026-10-09T20:${String(counted).padStart(2, "0")}:00`,
    fetchedAt: "2026-10-09T20:00:05",
    districtsTotal: 13,
    districtsCounted: counted,
    districtsPct: null,
    votersRegistered: 10177,
    envelopesIssued: null,
    envelopesReturned: null,
    validVotes: counted * 1000,
    turnoutPct: null,
    seatsTotal: 21,
    isFinal: false,
    parties: [],
  }
}

describe("two connections to one file", () => {
  test("a reader sees what a writer committed, and neither corrupts the file", async () => {
    await withTempDataDir((dir) => {
      const path = dir.file("volby.sqlite")
      const writer = openDatabase(path)
      const reader = openDatabase(path)
      try {
        writeSnapshot(writer, snapshot("551082", 6))
        expect(readCurrent(reader, "council", "551082")?.districts_counted).toBe(6)

        writeSnapshot(writer, snapshot("551082", 9))
        expect(readCurrent(reader, "council", "551082")?.districts_counted).toBe(9)
      } finally {
        reader.close()
        writer.close()
      }
    })
  })

  test("both connections can write different areas without corruption", async () => {
    await withTempDataDir((dir) => {
      const path = dir.file("volby.sqlite")
      const a = openDatabase(path)
      const b = openDatabase(path)
      try {
        writeSnapshot(a, snapshot("551082", 6))
        writeSnapshot(b, snapshot("582786", 8))

        const rows = a.query("SELECT COUNT(*) AS n FROM result_snapshot").get() as { n: number }
        expect(rows.n).toBe(2)

        const check = a.query("PRAGMA integrity_check").get() as { integrity_check: string }
        expect(check.integrity_check).toBe("ok")
      } finally {
        b.close()
        a.close()
      }
    })
  })

  test("a second connection does not have to recreate the schema", async () => {
    await withTempDataDir((dir) => {
      const path = dir.file("volby.sqlite")
      const first = openDatabase(path)
      writeSnapshot(first, snapshot("551082", 6))
      first.close()

      // Reopening must find the existing schema and data, not start over.
      const second = openDatabase(path)
      try {
        expect(readCurrent(second, "council", "551082")?.districts_counted).toBe(6)
      } finally {
        second.close()
      }
    })
  })
})
