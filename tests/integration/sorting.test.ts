/**
 * Sorting, end to end (FR-037).
 *
 * T062 was marked complete on the strength of src/ui/sort.ts and its unit tests, but
 * nothing ever called them: the `s` key was documented in contracts/cli.md and did
 * nothing at all. These assertions go through composeScreen, which is the path the
 * application actually uses, so the feature cannot be "done" again without working.
 */

import type { Database } from "bun:sqlite"
import { beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { extractArchiveFile } from "../../src/reference/archive.ts"
import { loadReference, type ReferenceArchives } from "../../src/reference/loader.ts"
import { ingestDistrict, ingestNational } from "../../src/sources/ingest.ts"
import { openMemoryDatabase } from "../../src/storage/db.ts"
import { listCouncilParties } from "../../src/storage/queries/areas.ts"
import { intentFor } from "../../src/ui/keymap.ts"
import type { Screen } from "../../src/ui/navigation.ts"
import { composeScreen } from "../../src/ui/screen.ts"
import { nextSort, type SortState, UNSORTED } from "../../src/ui/sort.ts"

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
beforeEach(() => {
  db = openMemoryDatabase()
  loadReference(db, archives)
  ingestNational(db, read("vysledky.xml"))
  ingestDistrict(db, "CZ0642", read("vysledky_obce_okres_CZ0642.xml"))
})

const COUNCIL: Screen = { kind: "council", kodzastup: "582786" }
const compose = (screen: Screen, sort: SortState) =>
  composeScreen(db, screen, { width: 110, councilType: "OBEC", sort })

/** The selectable rows, as text. */
const dataLines = (screen: Screen, sort: SortState) => {
  const content = compose(screen, sort)
  return content.lines.slice(content.firstRow, content.firstRow + content.rowCount)
}

describe("the key is wired (FR-037)", () => {
  test("s asks for a sort", () => {
    expect(intentFor({ name: "s" } as never)).toEqual({ kind: "action", id: "sort" })
  })

  test("a table screen reports how many columns it can sort by", () => {
    expect(compose(COUNCIL, UNSORTED).sortableColumns).toBe(5)
    expect(compose({ kind: "help" }, UNSORTED).sortableColumns).toBe(0)
  })
})

describe("sorting a council table", () => {
  test("changes the order of the rows", () => {
    const published = dataLines(COUNCIL, UNSORTED)
    const byName = dataLines(COUNCIL, { column: 1, direction: "asc" })
    expect(byName).not.toEqual(published)
    expect(byName).toHaveLength(published.length)
  })

  test("sorts by party name in Czech collation", () => {
    const names = listCouncilParties(db, "582786").map((p) => p.name)
    const expected = [...names].sort((a, b) => a.localeCompare(b, "cs"))
    const lines = dataLines(COUNCIL, { column: 1, direction: "asc" })
    // Compared on the leading characters, since the column truncates long coalitions.
    expect(lines[0]).toContain([...(expected[0] ?? "")].slice(0, 10).join(""))
  })

  test("returns to the published order after a full cycle", () => {
    let sort = UNSORTED
    const published = dataLines(COUNCIL, sort)
    for (let press = 0; press < 11; press += 1) sort = nextSort(sort, 5)
    expect(sort.column).toBeNull()
    expect(dataLines(COUNCIL, sort)).toEqual(published)
  })

  test("the sorted column is marked in its header, without colour", () => {
    const content = compose(COUNCIL, { column: 2, direction: "desc" })
    const header = content.lines.find((l) => l.includes("Volební strana"))
    expect(header).toContain("▾")
  })
})

describe("a sorted row opens the right thing", () => {
  // This is the failure a naive implementation produces: the table is sorted but the
  // caller resolves the selection against the unsorted query, so Enter opens whichever
  // party happened to be in that position before.
  test("the party opened matches the party displayed", () => {
    const sort: SortState = { column: 1, direction: "asc" }
    const content = compose(COUNCIL, sort)
    const firstLine = content.lines[content.firstRow] ?? ""
    const target = content.target(0)

    expect(target?.kind).toBe("candidates")
    const opened = listCouncilParties(db, "582786").find(
      (p) => target !== null && target.kind === "candidates" && p.vstrana === target.vstrana,
    )
    expect(opened).toBeDefined()
    expect(firstLine).toContain([...(opened?.name ?? "")].slice(0, 10).join(""))
  })

  test("the same holds for a sorted district list", () => {
    const screen: Screen = { kind: "districts" }
    const sort: SortState = { column: 1, direction: "desc" }
    const content = compose(screen, sort)
    const target = content.target(0)
    expect(target?.kind).toBe("district")
    if (target !== null && target.kind === "district") {
      expect(content.lines[content.firstRow]).toContain(target.nuts)
    }
  })
})

describe("a tie keeps the published order (FR-029)", () => {
  test("parties on the same number of seats stay as published", () => {
    const published = listCouncilParties(db, "582786")
    const zeroSeats = published.filter((p) => p.seatsWon === 0).map((p) => p.name)
    expect(zeroSeats.length).toBeGreaterThan(1)

    const lines = dataLines(COUNCIL, { column: 4, direction: "desc" })
    const positions = zeroSeats.map((name) =>
      lines.findIndex((l) => l.includes([...name].slice(0, 10).join(""))),
    )
    // Ascending positions means the published relative order was preserved.
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })
})
