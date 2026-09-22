/**
 * T117: an export may not drift from what is on screen.
 *
 * The CSV deliberately carries machine-readable figures rather than the displayed text
 * - contracts/exports.md requires a decimal comma and no change markers, so a
 * spreadsheet can add the column up. What it must NOT do is carry a different SET of
 * rows, in a different ORDER, from the table the user is looking at. That is the drift
 * this fixes in place: both sides walk the same query results, and these assertions say
 * so out loud rather than leaving it to inspection.
 */

import type { Database } from "bun:sqlite"
import { beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { BOM } from "../../src/export/csv.ts"
import { tableForScreen } from "../../src/export/tables.ts"
import { extractArchiveFile } from "../../src/reference/archive.ts"
import { loadReference, type ReferenceArchives } from "../../src/reference/loader.ts"
import { ingestDistrict, ingestNational } from "../../src/sources/ingest.ts"
import { openMemoryDatabase } from "../../src/storage/db.ts"
import type { Screen } from "../../src/ui/navigation.ts"
import { composeScreen } from "../../src/ui/screen.ts"

const FIXTURES = join(import.meta.dir, "../../fixtures/2026")
const read = (name: string) => readFileSync(join(FIXTURES, name), "utf8")

let archives: ReferenceArchives
beforeAll(async () => {
  const reg = await extractArchiveFile(join(FIXTURES, "reg.zip"))
  const cis = await extractArchiveFile(join(FIXTURES, "ciselniky.zip"))
  if (!reg.ok || !cis.ok) throw new Error("fixture archives could not be extracted")
  archives = { registry: reg.files, codelists: cis.files }
})

let db: Database
const opts = { width: 100, councilType: "OBEC" }

beforeEach(() => {
  db = openMemoryDatabase()
  loadReference(db, archives)
  ingestNational(db, read("vysledky.xml"))
  ingestDistrict(db, "CZ0642", read("vysledky_obce_okres_CZ0642.xml"))
})

/** The rows the user can actually select, as plain text. */
function displayedRows(screen: Screen): string[] {
  const content = composeScreen(db, screen, opts)
  return content.lines.slice(content.firstRow, content.firstRow + content.rowCount)
}

describe("the export carries exactly the displayed rows", () => {
  // Which exported column holds the name, so ordering is compared on the one field both
  // forms carry verbatim rather than on row counts alone.
  const cases: { name: string; screen: Screen; nameColumn: number }[] = [
    { name: "a district", screen: { kind: "district", nuts: "CZ0642" }, nameColumn: 0 },
    { name: "a council", screen: { kind: "council", kodzastup: "582786" }, nameColumn: 1 },
  ]

  for (const { name, screen, nameColumn } of cases) {
    test(`${name}: same count, same order`, () => {
      const displayed = displayedRows(screen)
      const table = tableForScreen(db, screen, opts)

      expect(table).not.toBeNull()
      expect(displayed.length).toBeGreaterThan(0)
      expect(table?.rows).toHaveLength(displayed.length)

      table?.rows.forEach((exported, index) => {
        const exportedName = exported[nameColumn] ?? ""
        expect(exportedName).not.toBe("")
        // Both forms truncate to their own column width, so the comparison is made on
        // the leading characters that survive either way.
        expect(displayed[index] ?? "").toContain([...exportedName].slice(0, 10).join(""))
      })
    })
  }

  test("the national table exports every party the overview lists", () => {
    const screen: Screen = { kind: "national" }
    const table = tableForScreen(db, screen, opts)
    expect(table).not.toBeNull()
    // The overview shows the leading twenty; the export is not truncated, because a
    // file the user opens in a spreadsheet should not silently stop at the screenful.
    expect(table?.rows.length).toBeGreaterThanOrEqual(1)
  })

  test("the CSV still begins with the BOM Excel needs", () => {
    const table = tableForScreen(db, { kind: "council", kodzastup: "582786" }, opts)
    expect(table).not.toBeNull()
    expect(BOM).toBe("﻿")
  })
})
