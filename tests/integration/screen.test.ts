/**
 * Screen routing: what each screen shows, what a row opens, and which sources it needs.
 * Tested without a renderer, which is the point of keeping routing separate from it.
 */

import type { Database } from "bun:sqlite"
import { beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { extractArchiveFile } from "../../src/reference/archive.ts"
import { loadReference, type ReferenceArchives } from "../../src/reference/loader.ts"
import { ingestDistrict, ingestNational } from "../../src/sources/ingest.ts"
import { openMemoryDatabase } from "../../src/storage/db.ts"
import { Navigation } from "../../src/ui/navigation.ts"
import { composeScreen, sourcesForScreen } from "../../src/ui/screen.ts"

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

describe("routing (FR-032)", () => {
  test("the national overview leads to the district list", () => {
    const content = composeScreen(db, { kind: "national" }, opts)
    expect(content.target(0)).toEqual({ kind: "districts" })
  })

  test("a district row opens that district", () => {
    const content = composeScreen(db, { kind: "districts" }, opts)
    // 77, not 78: CZZZZZ is in the codelist but is not a district (czzzzz.test.ts).
    expect(content.rowCount).toBe(77)
    const target = content.target(0)
    expect(target?.kind).toBe("district")
  })

  test("a council row opens that council", () => {
    const content = composeScreen(db, { kind: "district", nuts: "CZ0642" }, opts)
    expect(content.rowCount).toBeGreaterThan(0)
    const target = content.target(0)
    expect(target?.kind).toBe("council")
  })

  test("a party row opens its candidates, carrying the ballot position", () => {
    const content = composeScreen(db, { kind: "council", kodzastup: "551082" }, opts)
    expect(content.rowCount).toBeGreaterThan(0)
    const target = content.target(0)
    expect(target?.kind).toBe("candidates")
    if (target?.kind !== "candidates") return
    // The ballot position must travel with the selection, or a council with two lists
    // under one party code would open the wrong one.
    expect(target.kodzastup).toBe("551082")
    expect(target.vstrana).not.toBe("")
  })

  test("the candidate list is a leaf: nothing opens from it", () => {
    const content = composeScreen(
      db,
      { kind: "candidates", kodzastup: "551082", vstrana: "768", ballotOrder: null },
      opts,
    )
    expect(content.rowCount).toBe(0)
    expect(content.target(0)).toBeNull()
  })

  test("selecting past the end yields nothing rather than throwing", () => {
    const content = composeScreen(db, { kind: "districts" }, opts)
    expect(content.target(9999)).toBeNull()
  })
})

describe("a full drill-down and back", () => {
  test("walks national → district → council → candidates and returns", () => {
    const nav = new Navigation()

    nav.push(composeScreen(db, nav.screen, opts).target(0) ?? { kind: "districts" })
    expect(nav.screen.kind).toBe("districts")

    nav.push({ kind: "district", nuts: "CZ0642" })
    const district = composeScreen(db, nav.screen, opts)
    expect(district.rowCount).toBeGreaterThan(0)

    const council = district.target(0)
    expect(council).not.toBeNull()
    if (council === null) return
    nav.push(council)

    const parties = composeScreen(db, nav.screen, opts)
    const candidates = parties.target(0)
    expect(candidates).not.toBeNull()
    if (candidates === null) return
    nav.push(candidates)
    expect(nav.screen.kind).toBe("candidates")

    // And all the way back out.
    expect(nav.pop()).toBe(true)
    expect(nav.screen.kind).toBe("council")
    expect(nav.pop()).toBe(true)
    expect(nav.screen.kind).toBe("district")
    expect(nav.pop()).toBe(true)
    expect(nav.pop()).toBe(true)
    expect(nav.screen.kind).toBe("national")
    expect(nav.pop()).toBe(false)
  })

  test("re-composing a screen does not move the selection (scenario 5)", () => {
    const nav = new Navigation()
    nav.push({ kind: "district", nuts: "CZ0642" })
    nav.move(2, composeScreen(db, nav.screen, opts).rowCount)

    // Simulate refreshes arriving.
    for (let i = 0; i < 5; i++) composeScreen(db, nav.screen, opts)
    expect(nav.current.selected).toBe(2)
  })
})

describe("subscriptions per screen (FR-018a)", () => {
  test("the national overview and district list need no extra source", () => {
    expect(sourcesForScreen({ kind: "national" })).toEqual([])
    expect(sourcesForScreen({ kind: "districts" })).toEqual([])
  })

  test("a district screen needs exactly its own district", () => {
    const sources = sourcesForScreen({ kind: "district", nuts: "CZ0642" })
    expect(sources).toHaveLength(1)
    expect(sources[0]?.key).toBe("district:CZ0642")
  })

  test("a council screen needs exactly that council, never all of them", () => {
    const sources = sourcesForScreen({ kind: "council", kodzastup: "551082" })
    expect(sources).toHaveLength(1)
    expect(sources[0]?.key).toBe("council:551082")
  })

  test("the candidate screen keeps its council subscribed while open", () => {
    const sources = sourcesForScreen({
      kind: "candidates",
      kodzastup: "551082",
      vstrana: "768",
      ballotOrder: 3,
    })
    expect(sources[0]?.key).toBe("council:551082")
  })
})

describe("first data row", () => {
  test.each([
    ["districts", { kind: "districts" as const }],
    ["district", { kind: "district" as const, nuts: "CZ0642" }],
    ["council", { kind: "council" as const, kodzastup: "551082" }],
  ])("%s points at a real row, not a header", (_label, screen) => {
    const content = composeScreen(db, screen, opts)
    const row = content.lines[content.firstRow]
    expect(row).toBeDefined()
    expect(row ?? "").not.toMatch(/^─+/)
    expect((row ?? "").trim()).not.toBe("")
  })
})
