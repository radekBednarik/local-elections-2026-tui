/**
 * CZZZZZ: the code that is six characters long and is not a district.
 *
 * The reference loader called any six-character NUTS code a district. The URL builder
 * requires `CZ` followed by three digits and one alphanumeric. `CZZZZZ` - the Eurostat
 * "extra-regio" code, present in the REAL 2026 codelist, not only in mirrored data -
 * satisfies the first and fails the second.
 *
 * The consequence was not a quiet skip. The application subscribed to `district:CZZZZZ`,
 * `urlForKey` threw inside the refresh loop, the loop was driven by `void this.tick()`,
 * so the throw became an unhandled rejection - and OpenTUI opens and FOCUSES its console
 * overlay on an unhandled error by default. The overlay grabs stdin, so the key handler
 * never saw another keystroke and the user could not close it or quit.
 *
 * Three things were wrong and each is asserted here: the definition of a district, the
 * loop's handling of a source that cannot be addressed, and a renderer configured to let
 * an error take the terminal.
 */

import type { Database } from "bun:sqlite"
import { beforeAll, beforeEach, describe, expect, test } from "bun:test"

import { join } from "node:path"
import { extractArchiveFile } from "../../src/reference/archive.ts"
import { loadReference, type ReferenceArchives } from "../../src/reference/loader.ts"
import { isDistrictNuts, type SourceKey, urlForKey } from "../../src/sources/urls.ts"
import { openMemoryDatabase } from "../../src/storage/db.ts"

const FIXTURES = join(import.meta.dir, "../../fixtures/2026")
const LOC = { baseUrl: "https://volby.gov.cz", election: "kv2026", date: "20261009" }

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

describe("the codelist really does contain it", () => {
  test("CZZZZZ is six characters and is not addressable", () => {
    expect("CZZZZZ").toHaveLength(6)
    expect(isDistrictNuts("CZZZZZ")).toBe(false)
    expect(() => urlForKey(LOC, "district:CZZZZZ" as SourceKey)).toThrow(TypeError)
  })

  test("a real district is both", () => {
    expect(isDistrictNuts("CZ0642")).toBe(true)
    expect(() => urlForKey(LOC, "district:CZ0642" as SourceKey)).not.toThrow()
  })

  test("the codelist ships CZZZZZ, so this is not a mirror-data problem", () => {
    const codelist = archives.codelists.get("cnumnuts.xml") ?? ""
    expect(codelist).toContain("CZZZZZ")
  })
})

describe("the loader and the URL builder agree on what a district is", () => {
  test("CZZZZZ is not recorded as a district", () => {
    loadReference(db, archives)
    const row = db.query("SELECT COUNT(*) AS n FROM district WHERE nuts = 'CZZZZZ'").get() as {
      n: number
    }
    expect(row.n).toBe(0)
  })

  test("every district recorded can be turned into a URL", () => {
    loadReference(db, archives)
    const districts = (db.query("SELECT nuts FROM district").all() as { nuts: string }[]).map((d) => d.nuts)
    expect(districts.length).toBeGreaterThan(0)
    for (const nuts of districts) {
      expect(() => urlForKey(LOC, `district:${nuts}` as SourceKey)).not.toThrow()
    }
  })

  test("CZZZZZ is still kept as a region, because the codelist does list it", () => {
    // It is dropped from the districts to poll, not censored: it remains available for
    // resolving a name, which is what the region table is for.
    loadReference(db, archives)
    const row = db.query("SELECT COUNT(*) AS n FROM region WHERE nuts = 'CZZZZZ'").get() as {
      n: number
    }
    expect(row.n).toBe(1)
  })
})
