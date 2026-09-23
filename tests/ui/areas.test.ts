/**
 * Drill-down views, rendered through a real OpenTUI renderer, seeded from the real
 * fixture documents and the real 2026 reference data.
 */

import type { Database } from "bun:sqlite"
import { beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { TextRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { extractArchiveFile } from "../../src/reference/archive.ts"
import { loadReference, type ReferenceArchives } from "../../src/reference/loader.ts"
import { ingestCouncil, ingestDistrict } from "../../src/sources/ingest.ts"
import { openMemoryDatabase } from "../../src/storage/db.ts"
import { type SemanticRow, toTextLines } from "../../src/ui/row.ts"
import {
  buildCouncilRows,
  OKRSKY_NOTE,
  renderCandidates,
  renderCouncil,
  renderDistrict,
  renderDistrictList,
  seatStrip,
} from "../../src/ui/views/areas.ts"

const FIXTURES = join(import.meta.dir, "../../fixtures/2026")
const EDGE = join(import.meta.dir, "../../fixtures/edge-cases")
const read = (dir: string, name: string) => readFileSync(join(dir, name), "utf8")

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
})

async function frameOf(lines: string[], width = 120, height = 40): Promise<string> {
  const setup = await createTestRenderer({ width, height })
  try {
    setup.renderer.root.add(new TextRenderable(setup.renderer, { content: lines.join("\n") }))
    await setup.renderOnce()
    return setup.captureCharFrame()
  } finally {
    setup.renderer.destroy()
  }
}

/** Reference data plus the Brno district, which is the richest fixture. */
function seedBrno(): void {
  loadReference(db, archives)
  ingestDistrict(db, "CZ0642", read(FIXTURES, "vysledky_obce_okres_CZ0642.xml"))
}

describe("district list", () => {
  test("lists all 77 districts once the code lists are loaded", () => {
    loadReference(db, archives)
    const lines = renderDistrictList(db)
    // Two header lines, a column header and an underline, then one row per district.
    expect(lines.length).toBeGreaterThanOrEqual(77 + 4)
  })

  test("says so plainly when nothing is loaded yet", async () => {
    const frame = await frameOf(renderDistrictList(db))
    expect(frame).toContain("Číselník okresů zatím není načten")
  })

  test("marks districts whose data has not arrived (FR-018b)", async () => {
    loadReference(db, archives)
    const frame = await frameOf(renderDistrictList(db))
    expect(frame).toContain("načítá se…")
  })
})

describe("one district (FR-032, FR-035)", () => {
  beforeEach(seedBrno)

  test("lists the councils with turnout and count progress", async () => {
    const frame = await frameOf(renderDistrict(db, "CZ0642"))
    expect(frame).toContain("Brno")
    expect(frame).toContain("Účast")
    expect(frame).toContain("Okrsky")
  })

  test("groups boroughs under their parent municipality, indented", () => {
    const lines = renderDistrict(db, "CZ0642")
    const parent = lines.findIndex((l) => l.startsWith("Brno "))
    const borough = lines.findIndex((l) => l.includes("└ Brno-Bohunice"))
    expect(parent).toBeGreaterThan(-1)
    expect(borough).toBeGreaterThan(parent)
  })

  test("a district with no data explains that it is still loading", async () => {
    const frame = await frameOf(renderDistrict(db, "CZ0100"))
    expect(frame).toContain("nenačetla")
  })
})

describe("one council (FR-033)", () => {
  beforeEach(seedBrno)

  test("shows each party's votes, share and seats", async () => {
    const frame = await frameOf(renderCouncil(db, "551082"))
    expect(frame).toContain("Brno-Bohunice")
    expect(frame).toContain("Volební strana")
    expect(frame).toContain("Mandáty")
    expect(frame).toContain("ANO 2011")
  })

  test("attributes a borough to its parent municipality (FR-035)", async () => {
    const frame = await frameOf(renderCouncil(db, "551082"))
    expect(frame).toContain("Brno-Bohunice (Brno)")
  })

  test("lists a municipality's boroughs", async () => {
    const frame = await frameOf(renderCouncil(db, "582786"))
    expect(frame).toContain("Městské části a obvody")
  })

  test("states the polling-district boundary rather than showing an empty view (FR-013)", async () => {
    const frame = await frameOf(renderCouncil(db, "551082"))
    expect(frame).toContain("okrscích nejsou k dispozici")
    expect(OKRSKY_NOTE).toContain("dávkově")
  })

  test("keeps both lists when one party code appears twice", () => {
    // Brno-Bosonohy fields VSTRANA 90 on two separate ballot positions.
    const lines = renderCouncil(db, "551325")
    const body = lines.join("\n")
    expect(body).toContain("Volební strana")
    const rows = lines.filter((l) => /^\s*\d+\s+\S/.test(l))
    expect(rows.length).toBeGreaterThanOrEqual(6)
  })

  test("a council where no election took place shows a status, never zero votes", async () => {
    const fresh = openMemoryDatabase()
    try {
      ingestCouncil(fresh, "599999", read(EDGE, "annulled.xml"))
      fresh.run(
        "INSERT OR REPLACE INTO council (kodzastup, name, name_folded, oznac_typu, stav_obce) VALUES ('599999','Obec bez voleb','obec bez voleb','OBEC','9')",
      )
      const frame = await frameOf(renderCouncil(fresh, "599999"))
      expect(frame).toContain("Obec bez voleb")
      expect(frame).not.toContain("0 hlasů")
    } finally {
      fresh.close()
    }
  })

  test("an unknown council is reported, not rendered as blank", async () => {
    const frame = await frameOf(renderCouncil(db, "000000"))
    expect(frame).toContain("nebylo nalezeno")
  })
})

describe("candidates (FR-034)", () => {
  beforeEach(seedBrno)

  test("shows the FULL registry list, including candidates not elected", async () => {
    const parties = renderCouncil(db, "551082")
    expect(parties.length).toBeGreaterThan(0)

    // ANO 2011 stands in Brno-Bohunice; VSTRANA 768 is its nationwide code.
    const lines = renderCandidates(db, "551082", "768", null)
    const body = lines.join("\n")
    expect(body).toContain("Kandidátní listina")

    const frame = await frameOf(lines)
    expect(frame).toContain("Poř.")
    expect(frame).toContain("Mandát")
  })

  test("degrades to elected members when reference data is absent (FR-011)", async () => {
    const bare = openMemoryDatabase()
    try {
      ingestCouncil(bare, "551082", read(FIXTURES, "vysledky_obec_551082.xml"))
      const frame = await frameOf(renderCandidates(bare, "551082", "768", 3))
      expect(frame).toContain("úplná kandidátní listina není načtena")
    } finally {
      bare.close()
    }
  })

  test("a party with no candidates says so rather than rendering an empty table", async () => {
    const frame = await frameOf(renderCandidates(db, "551082", "999999", null))
    expect(frame).toContain("nejsou k dispozici žádní kandidáti")
  })
})

describe("rendering hygiene", () => {
  beforeEach(seedBrno)

  test.each([
    ["district list", () => renderDistrictList(db, 100)],
    ["district", () => renderDistrict(db, "CZ0642", 100)],
    ["council", () => renderCouncil(db, "551082", 100)],
    ["candidates", () => renderCandidates(db, "551082", "768", null, 100)],
  ])("%s shows no placeholder artefacts and fits its width", async (_label, build) => {
    const lines = build()
    for (const line of lines) expect([...line].length).toBeLessThanOrEqual(100)

    const frame = await frameOf(lines, 100)
    expect(frame).not.toContain("undefined")
    expect(frame).not.toContain("NaN")
    expect(frame).not.toContain("[object")
  })
})

describe("the council summary and seat strip (002 T051, T052, FR-022, FR-023)", () => {
  beforeEach(seedBrno)

  const cellsOf = (rows: SemanticRow[]) => rows.flatMap((r) => r.cells)

  test("the status is a success badge, and precincts, turnout and seats are label and value chips", () => {
    const { rows } = buildCouncilRows(db, "551082", 100)
    const cells = cellsOf(rows)
    const badge = cells.find((c) => c.text.includes("✓ konečné"))
    expect(badge?.surface).toBe("success")

    for (const [label, value] of [
      ["Okrsky", "13 / 13"],
      ["Účast", "46,21 %"],
      ["Mandáty", "21"],
    ]) {
      const at = cells.findIndex((c) => c.text.trim() === label)
      expect(`${label} found: ${at >= 0}`).toBe(`${label} found: true`)
      expect(cells[at]).toMatchObject({ role: "subtle", surface: "element" })
      // The formatters write no-break spaces inside figures; compare them as spaces.
      expect(cells[at + 1]?.text.trim().replace(/\s/g, " ")).toBe(value)
      expect(cells[at + 1]).toMatchObject({ role: "heading", surface: "primary" })
    }
  })

  test("the seat strip shows one block per seat, a group per party that won any, and the total", () => {
    const { rows } = buildCouncilRows(db, "551082", 100)
    const strip = rows.find((r) => r.cells[0]?.text.startsWith("Rozdělení mandátů"))
    expect(strip).toBeDefined()
    expect(toTextLines([strip as SemanticRow])[0]).toBe("Rozdělení mandátů ■■■■■■■■■ ■■■■ ■■ ■■ ■■ ■ ■  21")
    const groups = (strip?.cells ?? []).filter((c) => c.text.trim().startsWith("■"))
    expect(groups.map((g) => g.role)).toEqual([
      "heading",
      "subtle",
      "heading",
      "subtle",
      "heading",
      "subtle",
      "heading",
    ])
  })

  test("follows the table's order when it is sorted", () => {
    const byName = { column: 1, direction: "asc" as const }
    const { rows, items } = buildCouncilRows(db, "551082", 100, byName)
    const strip = rows.find((r) => r.cells[0]?.text.startsWith("Rozdělení mandátů"))
    const expected = items.filter((p) => (p.seatsWon ?? 0) > 0).map((p) => "■".repeat(p.seatsWon ?? 0))
    const groups = (strip?.cells ?? []).filter((c) => c.text.trim().startsWith("■")).map((c) => c.text.trim())
    expect(groups).toEqual(expected)
  })

  test("is left out rather than wrapped or cut when it does not fit", () => {
    const strip = seatStrip([{ seatsWon: 60 }, { seatsWon: 5 }], 40)
    expect(strip).toBeNull()
    expect(seatStrip([{ seatsWon: 3 }, { seatsWon: 2 }], 40)).not.toBeNull()
  })
})
