/**
 * T117: firstRow must point at the first selectable row, whatever optional notes sit
 * above the table.
 *
 * The old implementation located the header by searching for the first line beginning
 * with a box-drawing rule. That is the full-width rule under the title, not the column
 * underline, so when the "still loading" note sat between them the index was two rows
 * short and the selection marker pointed at the wrong council.
 */

import type { Database } from "bun:sqlite"
import { beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { extractArchiveFile } from "../../src/reference/archive.ts"
import { loadReference, type ReferenceArchives } from "../../src/reference/loader.ts"
import { ingestDistrict, ingestNational } from "../../src/sources/ingest.ts"
import { openMemoryDatabase } from "../../src/storage/db.ts"
import { listCouncilsInDistrict } from "../../src/storage/queries/areas.ts"
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

describe("the first selectable row (T117)", () => {
  test("is correct when every council has arrived", () => {
    const first = listCouncilsInDistrict(db, "CZ0642")[0]
    const content = composeScreen(db, { kind: "district", nuts: "CZ0642" }, opts)
    expect(content.lines[content.firstRow]).toContain(first?.name ?? "never")
  })

  test("is still correct when a loading note sits above the table", () => {
    // Drop one council's results so the district reports itself as partly loaded,
    // which is what puts the note between the title rule and the column header.
    const councils = listCouncilsInDistrict(db, "CZ0642")
    const last = councils[councils.length - 1]
    db.query("DELETE FROM result_snapshot WHERE area_kind = 'council' AND area_id = $k").run({
      k: last?.kodzastup ?? "",
    })

    const content = composeScreen(db, { kind: "district", nuts: "CZ0642" }, opts)
    expect(content.lines.some((l) => l.includes("Načteno"))).toBe(true)

    const first = listCouncilsInDistrict(db, "CZ0642")[0]
    expect(content.lines[content.firstRow]).toContain(first?.name ?? "never")
  })
})
