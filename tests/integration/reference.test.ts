/**
 * Reference loading against the REAL published 2026 archives (scoped to the fixture
 * councils). These are the actual registries the application will read on election day.
 */

import type { Database } from "bun:sqlite"
import { beforeAll, describe, expect, test } from "bun:test"
import { join } from "node:path"
import { extractArchiveFile } from "../../src/reference/archive.ts"
import {
  invalidateReference,
  isReferenceLoaded,
  loadReference,
  type ReferenceArchives,
} from "../../src/reference/loader.ts"
import { openMemoryDatabase } from "../../src/storage/db.ts"

const FIXTURES = join(import.meta.dir, "../../fixtures/2026")

let archives: ReferenceArchives

beforeAll(async () => {
  const reg = await extractArchiveFile(join(FIXTURES, "reg.zip"))
  const cis = await extractArchiveFile(join(FIXTURES, "ciselniky.zip"))
  if (!reg.ok) throw new Error(reg.message)
  if (!cis.ok) throw new Error(cis.message)
  archives = { registry: reg.files, codelists: cis.files }
})

function loadInto(db: Database) {
  return loadReference(db, archives)
}

describe("archive extraction", () => {
  test("extracts every expected registry file", () => {
    expect([...archives.registry.keys()].sort()).toEqual(["kvrk.xml", "kvros.xml", "kvrzcoco.xml"])
  })

  test("kvros_slozeni.xml is genuinely absent, as the real archive shows", () => {
    // The published description lists it; the archive does not contain it. Composition
    // comes from cvs_slozeni.xml instead.
    expect(archives.registry.has("kvros_slozeni.xml")).toBe(false)
    expect(archives.codelists.has("cvs_slozeni.xml")).toBe(true)
  })

  test("rejects a file that is not an archive", async () => {
    const result = await extractArchiveFile(join(FIXTURES, "vysledky.xml"))
    expect(result.ok).toBe(false)
  })
})

describe("loading", () => {
  test("loads every code list and registry without problems", () => {
    const db = openMemoryDatabase()
    try {
      const report = loadInto(db)
      expect(report.problems).toEqual([])
      expect(report.ok).toBe(true)
    } finally {
      db.close()
    }
  })

  test("records exactly 77 districts, the number of per-district result files", () => {
    // It said 78, and 78 was wrong. The codelist holds 78 six-character NUTS codes, but
    // one of them is CZZZZZ - the Eurostat extra-regio entry - which has no result file.
    // Counting by length made the application poll it and throw. See
    // tests/integration/czzzzz.test.ts.
    const db = openMemoryDatabase()
    try {
      loadInto(db)
      const row = db.query("SELECT COUNT(*) AS n FROM district").get() as { n: number }
      expect(row.n).toBe(77)
    } finally {
      db.close()
    }
  })

  test("resolves council type names rather than leaving codes (FR-011)", () => {
    const db = openMemoryDatabase()
    try {
      loadInto(db)
      const row = db
        .query(
          `SELECT c.name AS council, t.name AS kind
             FROM council c JOIN council_type t ON t.druhzastup = c.druhzastup
            WHERE c.kodzastup = '582786'`,
        )
        .get() as { council: string; kind: string } | null
      expect(row?.council).toBe("Brno")
      expect(row?.kind).toBeTruthy()
      expect(row?.kind).not.toMatch(/^\d+$/)
    } finally {
      db.close()
    }
  })

  test("links a borough to its parent council from NADRZASTUP (FR-035)", () => {
    const db = openMemoryDatabase()
    try {
      loadInto(db)
      const row = db
        .query("SELECT parent_kodzastup, oznac_typu FROM council WHERE kodzastup = '551082'")
        .get() as { parent_kodzastup: string | null; oznac_typu: string } | null
      expect(row?.oznac_typu).toBe("MCMO")
      expect(row?.parent_kodzastup).toBe("582786")
    } finally {
      db.close()
    }
  })

  test("bridges a result's VSTRANA to a candidate list's OSTRANA (FR-034)", () => {
    const db = openMemoryDatabase()
    try {
      loadInto(db)
      // Pick a party that actually stood in Brno-Bohunice, then walk the bridge the
      // way the candidate view will: VSTRANA from the result, OSTRANA for the list.
      const bridge = db
        .query("SELECT ostrana, vstrana FROM council_party WHERE kodzastup = '551082' LIMIT 1")
        .get() as { ostrana: string; vstrana: string } | null
      expect(bridge).not.toBeNull()
      if (bridge === null) return

      const candidates = db
        .query("SELECT COUNT(*) AS n FROM candidate WHERE kodzastup = '551082' AND ostrana = $o")
        .get({ o: bridge.ostrana }) as { n: number }
      expect(candidates.n).toBeGreaterThan(0)
    } finally {
      db.close()
    }
  })

  test("loads full candidate lists, not only elected members", () => {
    const db = openMemoryDatabase()
    try {
      loadInto(db)
      const all = db.query("SELECT COUNT(*) AS n FROM candidate").get() as { n: number }
      const elected = db.query("SELECT COUNT(*) AS n FROM candidate WHERE elected = 1").get() as {
        n: number
      }
      expect(all.n).toBeGreaterThan(2000)
      // Far more candidates stand than are elected; if these matched, only the elected
      // ones were loaded and FR-034's full list would be wrong.
      expect(elected.n).toBeLessThan(all.n)
    } finally {
      db.close()
    }
  })

  test("preserves Czech diacritics through extraction and storage (FR-026)", () => {
    const db = openMemoryDatabase()
    try {
      loadInto(db)
      const row = db.query("SELECT name FROM region WHERE nuts = 'CZ010'").get() as {
        name: string
      } | null
      expect(row?.name).toBe("Hlavní město Praha")
    } finally {
      db.close()
    }
  })

  test("folds names for diacritic-insensitive search (FR-038)", () => {
    const db = openMemoryDatabase()
    try {
      loadInto(db)
      const row = db.query("SELECT name, name_folded FROM council WHERE kodzastup = '551082'").get() as {
        name: string
        name_folded: string
      }
      expect(row.name).toBe("Brno-Bohunice")
      expect(row.name_folded).toBe("brno-bohunice")
    } finally {
      db.close()
    }
  })
})

describe("reuse (FR-020a, SC-014)", () => {
  test("an unloaded database reports as not loaded", () => {
    const db = openMemoryDatabase()
    try {
      expect(isReferenceLoaded(db)).toBe(false)
    } finally {
      db.close()
    }
  })

  test("after loading, the marker says it need not be fetched again", () => {
    const db = openMemoryDatabase()
    try {
      loadInto(db)
      expect(isReferenceLoaded(db)).toBe(true)
    } finally {
      db.close()
    }
  })

  test("invalidating forces a reload, which is what --refresh-reference does", () => {
    const db = openMemoryDatabase()
    try {
      loadInto(db)
      invalidateReference(db)
      expect(isReferenceLoaded(db)).toBe(false)
    } finally {
      db.close()
    }
  })

  test("loading twice is idempotent and does not duplicate rows", () => {
    const db = openMemoryDatabase()
    try {
      const first = loadInto(db)
      const second = loadInto(db)
      expect(second.counts.council).toBe(first.counts.council ?? 0)
      const row = db.query("SELECT COUNT(*) AS n FROM council").get() as { n: number }
      expect(row.n).toBe(first.counts.council ?? 0)
    } finally {
      db.close()
    }
  })
})

describe("degraded mode (FR-011)", () => {
  test("a missing code list is reported but does not abort the load", () => {
    const db = openMemoryDatabase()
    try {
      const partial: ReferenceArchives = {
        registry: archives.registry,
        codelists: new Map(archives.codelists),
      }
      partial.codelists.delete("kvdruhz.xml")

      const report = loadReference(db, partial)
      expect(report.ok).toBe(false)
      expect(report.problems.some((p) => p.includes("kvdruhz.xml"))).toBe(true)
      // Councils still loaded, so results remain browsable with a degraded label.
      expect(report.counts.council ?? 0).toBeGreaterThan(0)
    } finally {
      db.close()
    }
  })
})
