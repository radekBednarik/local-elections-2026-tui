/**
 * FR-011: nowhere may a raw numeric code stand in for a name that is available.
 *
 * Checked by rendering every view with reference data loaded and asserting that the
 * resolved names appear while the codes they replace do not. A generic "no digits"
 * rule would be useless, since votes, percentages and ballot positions are all legitimate
 * numbers - so each code is checked against the specific label it should have become.
 */

import type { Database } from "bun:sqlite"
import { beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { extractArchiveFile } from "../../src/reference/archive.ts"
import { loadReference, type ReferenceArchives } from "../../src/reference/loader.ts"
import { ingestDistrict, ingestNational } from "../../src/sources/ingest.ts"
import { openMemoryDatabase } from "../../src/storage/db.ts"
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
const opts = { width: 110, councilType: "OBEC" }

beforeEach(() => {
  db = openMemoryDatabase()
  loadReference(db, archives)
  ingestNational(db, read("vysledky.xml"))
  ingestDistrict(db, "CZ0642", read("vysledky_obce_okres_CZ0642.xml"))
})

function render(screen: Parameters<typeof composeScreen>[1]): string {
  return composeScreen(db, screen, opts).lines.join("\n")
}

describe("codes are resolved to names", () => {
  test("a council shows its kind by name, not by its DRUHZASTUP code", () => {
    const row = db.query("SELECT druhzastup FROM council WHERE kodzastup = '551082'").get() as {
      druhzastup: string
    }
    const name = db
      .query("SELECT name FROM council_type WHERE druhzastup = $d")
      .get({ d: row.druhzastup }) as { name: string }

    const body = render({ kind: "council", kodzastup: "551082" })
    expect(body).toContain(name.name)
    // The bare code must not be presented as the kind.
    expect(body).not.toMatch(new RegExp(`^${row.druhzastup}$`, "m"))
  })

  test("districts are named, not shown as NUTS codes alone", () => {
    const body = render({ kind: "districts" })
    const district = db.query("SELECT name FROM district WHERE nuts = 'CZ0642'").get() as {
      name: string
    }
    expect(body).toContain(district.name)
  })

  test("parties are named, never shown as their VSTRANA code", () => {
    const body = render({ kind: "council", kodzastup: "551082" })
    const party = db
      .query(
        `SELECT vstrana, name FROM party_result
          WHERE snapshot_id = (SELECT id FROM result_snapshot
                                WHERE area_id = '551082' AND is_current = 1)
          LIMIT 1`,
      )
      .get() as { vstrana: string; name: string }

    expect(body).toContain(party.name)
    // The party column must carry the name, not the code.
    const partyLines = body.split("\n").filter((l) => l.includes(party.name))
    expect(partyLines.length).toBeGreaterThan(0)
    for (const line of partyLines) {
      expect(line).not.toMatch(new RegExp(`\\s${party.vstrana}\\s+${party.name}`))
    }
  })

  test("a borough names its parent municipality rather than referencing a code", () => {
    const body = render({ kind: "council", kodzastup: "551082" })
    expect(body).toContain("(Brno)")
    expect(body).not.toContain("(582786)")
  })

  test("candidates are named, not shown as ballot codes alone", () => {
    const parties = composeScreen(db, { kind: "council", kodzastup: "551082" }, opts)
    const target = parties.target(0)
    expect(target?.kind).toBe("candidates")
    if (target?.kind !== "candidates") return

    const body = render(target)
    // Real Czech surnames must be present.
    expect(body).toMatch(/[A-ZĚŠČŘŽÝÁÍÉÚŮĎŤŇÓ][a-zěščřžýáíéúůďťňó]+/)
  })
})

describe("degraded mode still works (FR-011)", () => {
  test("without reference data, codes appear rather than the view breaking", () => {
    const bare = openMemoryDatabase()
    try {
      ingestDistrict(bare, "CZ0642", read("vysledky_obce_okres_CZ0642.xml"))
      const body = composeScreen(bare, { kind: "council", kodzastup: "551082" }, opts).lines.join("\n")

      // The council is not in the registry, so it cannot be found by name - but the
      // application must say so rather than rendering a broken screen.
      expect(body).not.toContain("undefined")
      expect(body).not.toContain("NaN")
      expect(body.trim()).not.toBe("")
    } finally {
      bare.close()
    }
  })

  test("party names survive without reference data, since results carry them inline", () => {
    const bare = openMemoryDatabase()
    try {
      ingestNational(bare, read("vysledky.xml"))
      const body = composeScreen(bare, { kind: "national" }, opts).lines.join("\n")
      expect(body).toContain("ANO 2011")
    } finally {
      bare.close()
    }
  })
})

describe("no placeholder artefacts in any view", () => {
  test.each([
    ["national", { kind: "national" as const }],
    ["districts", { kind: "districts" as const }],
    ["district", { kind: "district" as const, nuts: "CZ0642" }],
    ["council", { kind: "council" as const, kodzastup: "551082" }],
    ["council with boroughs", { kind: "council" as const, kodzastup: "582786" }],
  ])("%s", (_label, screen) => {
    const body = render(screen)
    expect(body).not.toContain("undefined")
    expect(body).not.toContain("NaN")
    expect(body).not.toContain("null")
    expect(body).not.toContain("[object Object]")
  })
})
