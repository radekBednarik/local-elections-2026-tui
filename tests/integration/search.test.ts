/**
 * Search, against the real 2026 reference data and the real fixture results.
 */

import type { Database } from "bun:sqlite"
import { beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { extractArchiveFile } from "../../src/reference/archive.ts"
import { loadReference, type ReferenceArchives } from "../../src/reference/loader.ts"
import { ingestDistrict } from "../../src/sources/ingest.ts"
import { openMemoryDatabase } from "../../src/storage/db.ts"
import { search } from "../../src/storage/queries/search.ts"
import { renderSearch } from "../../src/ui/views/search.ts"

const FIXTURES = join(import.meta.dir, "../../fixtures/2026")

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
  ingestDistrict(db, "CZ0642", readFileSync(join(FIXTURES, "vysledky_obce_okres_CZ0642.xml"), "utf8"))
})

describe("diacritic and case insensitivity (FR-038)", () => {
  test("every spelling of a council name finds the same council", () => {
    const codes = ["Bohunice", "bohunice", "BOHUNICE"].map(
      (q) => search(db, q).find((h) => h.kind === "council")?.kodzastup,
    )
    expect(new Set(codes).size).toBe(1)
    expect(codes[0]).toBe("551082")
  })

  test("an accented query and its unaccented form agree", () => {
    // Brno-Bosonohy contains no diacritics, so use a party name that does.
    const withAccents = search(db, "Společně")
    const without = search(db, "Spolecne")
    expect(withAccents.length).toBeGreaterThan(0)
    expect(without.map((h) => h.label)).toEqual(withAccents.map((h) => h.label))
  })

  test("finds a candidate whose name carries diacritics, typed either way", () => {
    const accented = search(db, "Brzobohatý")
    const plain = search(db, "brzobohaty")
    expect(accented.length).toBeGreaterThan(0)
    expect(plain.length).toBe(accented.length)
  })
})

describe("ranking", () => {
  test("a name beginning with the query comes before one merely containing it", () => {
    const hits = search(db, "brno").filter((h) => h.kind === "council")
    expect(hits.length).toBeGreaterThan(1)
    expect(hits[0]?.label).toBe("Brno")
  })
})

describe("what can be found", () => {
  test("councils", () => {
    expect(search(db, "Bohunice").some((h) => h.kind === "council")).toBe(true)
  })

  test("electoral parties, with the council they stood in (scenario 2)", () => {
    const hits = search(db, "ANO 2011").filter((h) => h.kind === "party")
    expect(hits.length).toBeGreaterThan(0)
    const first = hits[0]
    expect(first?.councilName).not.toBe("")
    expect(first?.vstrana).not.toBeNull()
    // A party hit must be openable, which means knowing its council.
    expect(first?.kodzastup).toMatch(/^\d+$/)
  })

  test("candidates, with their party and council for context", () => {
    const hits = search(db, "Brzobohatý").filter((h) => h.kind === "candidate")
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]?.detail).toContain("—")
  })
})

describe("edge cases", () => {
  test("an empty query returns nothing rather than everything", () => {
    expect(search(db, "")).toEqual([])
    expect(search(db, "   ")).toEqual([])
  })

  test("no match returns an empty list, not an error", () => {
    expect(search(db, "xyzzynotathing")).toEqual([])
  })

  test("LIKE wildcards are searched for literally, not interpreted", () => {
    // A bare % would otherwise match every row in the database.
    expect(search(db, "%")).toEqual([])
    expect(search(db, "_")).toEqual([])
  })

  test("the result count is bounded", () => {
    expect(search(db, "a", 10).length).toBeLessThanOrEqual(10)
  })
})

describe("search view", () => {
  test("prompts before anything is typed", () => {
    const view = renderSearch(db, "")
    expect(view.lines.join("\n")).toContain("ricany")
    expect(view.hits).toEqual([])
  })

  test("lists hits with their kind, so a name shared by two things is distinguishable", () => {
    const view = renderSearch(db, "ANO")
    const body = view.lines.join("\n")
    expect(view.hits.length).toBeGreaterThan(0)
    expect(body).toContain("volební strana")
  })

  test("says so plainly when nothing matches", () => {
    expect(renderSearch(db, "xyzzynotathing").lines.join("\n")).toContain("Nic nenalezeno")
  })

  test("the first row index points at a real hit", () => {
    const view = renderSearch(db, "Brno")
    expect(view.hits.length).toBeGreaterThan(0)
    const row = view.lines[view.firstRow]
    expect(row).toBeDefined()
    expect((row ?? "").trim()).not.toBe("")
    expect(row ?? "").not.toMatch(/^─+/)
  })

  test("fits its width", () => {
    for (const line of renderSearch(db, "Brno", 80).lines) {
      expect([...line].length).toBeLessThanOrEqual(80)
    }
  })
})
