/**
 * Ingest exercised against the real fixture documents, end to end: parse, validate,
 * store, then read back what the national overview will display.
 */

import type { Database } from "bun:sqlite"
import { beforeEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ingestCouncil, ingestDistrict, ingestNational } from "../../src/sources/ingest.ts"
import { openMemoryDatabase } from "../../src/storage/db.ts"
import {
  availableCouncilTypes,
  readNationalParties,
  readNationalTotals,
} from "../../src/storage/queries/national.ts"

const FIXTURES = join(import.meta.dir, "../../fixtures/2026")
const EDGE = join(import.meta.dir, "../../fixtures/edge-cases")
const read = (dir: string, name: string) => readFileSync(join(dir, name), "utf8")

let db: Database
beforeEach(() => {
  db = openMemoryDatabase()
})

describe("national ingest (FR-007)", () => {
  test("stores both council types separately (FR-035)", () => {
    const result = ingestNational(db, read(FIXTURES, "vysledky.xml"))
    expect(result.ok).toBe(true)
    expect(availableCouncilTypes(db)).toEqual(["OBEC", "MCMO"])
  })

  test("carries the publisher timestamp through to storage (FR-021)", () => {
    ingestNational(db, read(FIXTURES, "vysledky.xml"))
    expect(readNationalTotals(db)?.publishedAt).toBe("2026-10-09T21:15:00")
  })

  test("stores turnout exactly as published, without recomputing (FR-029)", () => {
    ingestNational(db, read(FIXTURES, "vysledky.xml"))
    const totals = readNationalTotals(db)
    expect(totals).not.toBeNull()
    if (totals === null) return

    // Recomputing would give envelopes/voters; we must report the published figure.
    expect(totals.turnoutPct).toBe(46.07)
    expect(totals.votersRegistered).toBe(8255204)
    expect(totals.districtsTotal).toBe(14722)
  })

  test("reports parties ordered by seats then votes, with names intact", () => {
    ingestNational(db, read(FIXTURES, "vysledky.xml"))
    const parties = readNationalParties(db)
    expect(parties.length).toBeGreaterThan(5)

    for (let i = 1; i < parties.length; i++) {
      const prev = parties[i - 1]
      const cur = parties[i]
      if (prev === undefined || cur === undefined) continue
      expect(prev.seatsWon).toBeGreaterThanOrEqual(cur.seatsWon)
    }
    expect(parties.some((p) => /[ěščřžýáíéúůďťňó]/i.test(p.name))).toBe(true)
  })

  test("a malformed document is rejected and stores nothing (FR-025)", () => {
    const result = ingestNational(db, read(EDGE, "malformed.xml"))
    expect(result.ok).toBe(false)
    expect(readNationalTotals(db)).toBeNull()
  })

  test("a rejected refresh leaves the previous data intact (FR-027)", () => {
    ingestNational(db, read(FIXTURES, "vysledky.xml"))
    const before = readNationalTotals(db)

    const bad = ingestNational(db, read(EDGE, "wrong-shape.xml"))
    expect(bad.ok).toBe(false)

    expect(readNationalTotals(db)?.turnoutPct).toBe(before?.turnoutPct ?? -1)
  })
})

describe("change detection (FR-036)", () => {
  test("the first ingest marks figures as new, not as increases", () => {
    ingestNational(db, read(FIXTURES, "vysledky.xml"))
    expect(readNationalTotals(db)?.changes.districtsCounted).toBe("new")
  })

  test("an increased count is marked as increased", () => {
    // Ingest a reduced count first, then the full fixture.
    const full = read(FIXTURES, "vysledky.xml")
    const partial = full
      .replace(/OKRSKY_ZPRAC="14722"/, 'OKRSKY_ZPRAC="7000"')
      .replace(/DATUM_CAS_GENEROVANI="[^"]*"/, 'DATUM_CAS_GENEROVANI="2026-10-09T20:00:00"')
    ingestNational(db, partial)
    ingestNational(db, full)

    expect(readNationalTotals(db)?.changes.districtsCounted).toBe("increased")
  })

  test("an unchanged re-ingest keeps the genuine previous snapshot", () => {
    const full = read(FIXTURES, "vysledky.xml")
    const partial = full
      .replace(/OKRSKY_ZPRAC="14722"/, 'OKRSKY_ZPRAC="7000"')
      .replace(/DATUM_CAS_GENEROVANI="[^"]*"/, 'DATUM_CAS_GENEROVANI="2026-10-09T20:00:00"')
    ingestNational(db, partial)
    ingestNational(db, full)
    // Same content again, only the timestamp moved on.
    ingestNational(
      db,
      full.replace(/DATUM_CAS_GENEROVANI="[^"]*"/, 'DATUM_CAS_GENEROVANI="2026-10-09T22:00:00"'),
    )

    // Still comparing against the 7000 snapshot, not against a copy of itself.
    expect(readNationalTotals(db)?.changes.districtsCounted).toBe("increased")
  })
})

describe("district ingest (FR-008)", () => {
  test("stores every council and records its district membership", () => {
    const body = read(FIXTURES, "vysledky_obce_okres_CZ0642.xml")
    // Councils must exist before membership can be recorded against them.
    db.run(
      "INSERT INTO council (kodzastup, name, name_folded, oznac_typu) VALUES ('582786','Brno','brno','OBEC')",
    )
    const result = ingestDistrict(db, "CZ0642", body)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.outcomes.length).toBeGreaterThan(1)

    const row = db.query("SELECT district_nuts FROM council WHERE kodzastup = '582786'").get() as {
      district_nuts: string | null
    }
    expect(row.district_nuts).toBe("CZ0642")
  })

  test("keeps both lists when one party code appears twice in a council", () => {
    // Brno-Bosonohy fields VSTRANA 90 twice, as two separate candidate lists
    // distinguished only by ballot position. Keying party results on the party code
    // silently dropped one of them until this case appeared in a real district file.
    const result = ingestDistrict(db, "CZ0642", read(FIXTURES, "vysledky_obce_okres_CZ0642.xml"))
    expect(result.ok).toBe(true)

    const snapshotId = db
      .query("SELECT id FROM result_snapshot WHERE area_id = '551325' AND is_current = 1")
      .get() as { id: number } | null
    expect(snapshotId).not.toBeNull()
    if (snapshotId === null) return

    const rows = db
      .query("SELECT vstrana, ballot_order FROM party_result WHERE snapshot_id = $id AND vstrana = '90'")
      .all({ id: snapshotId.id }) as { vstrana: string; ballot_order: number | null }[]

    expect(rows).toHaveLength(2)
    expect(rows[0]?.ballot_order).not.toBe(rows[1]?.ballot_order)
  })
})

describe("council ingest (FR-009)", () => {
  test("stores the council with its parties and elected representatives", () => {
    const result = ingestCouncil(db, "551082", read(FIXTURES, "vysledky_obec_551082.xml"))
    expect(result.ok).toBe(true)

    const parties = db.query("SELECT COUNT(*) AS n FROM party_result").get() as { n: number }
    const elected = db.query("SELECT COUNT(*) AS n FROM candidate_result").get() as { n: number }
    expect(parties.n).toBeGreaterThan(0)
    expect(elected.n).toBeGreaterThan(0)
  })

  test("a council with no election stores a status, not zero votes", () => {
    const result = ingestCouncil(db, "599999", read(EDGE, "annulled.xml"))
    expect(result.ok).toBe(true)

    const parties = db.query("SELECT COUNT(*) AS n FROM party_result").get() as { n: number }
    expect(parties.n).toBe(0)

    const snap = db
      .query("SELECT districts_counted, is_final FROM result_snapshot WHERE area_id = '599999'")
      .get() as { districts_counted: number; is_final: number }
    expect(snap.districts_counted).toBe(0)
    expect(snap.is_final).toBe(0)
  })

  test("a tie is stored as published, with no ordering invented (FR-029)", () => {
    ingestCouncil(db, "598888", read(EDGE, "unfilled-seats.xml"))
    const rows = db.query("SELECT votes, seats_won FROM party_result ORDER BY rowid").all() as {
      votes: number
      seats_won: number
    }[]
    expect(rows).toHaveLength(2)
    expect(rows[0]?.votes).toBe(rows[1]?.votes)

    const snap = db.query("SELECT seats_total FROM result_snapshot").get() as { seats_total: number }
    const allocated = rows.reduce((sum, r) => sum + r.seats_won, 0)
    // Nine seats, eight allocated: reported as published, not corrected.
    expect(snap.seats_total).toBe(9)
    expect(allocated).toBe(8)
  })

  test("provisional and final are distinguished (FR-022)", () => {
    ingestCouncil(db, "551082", read(EDGE, "provisional.xml"))
    const provisional = db.query("SELECT is_final FROM result_snapshot WHERE is_current = 1").get() as {
      is_final: number
    }
    expect(provisional.is_final).toBe(0)

    ingestCouncil(db, "551082", read(EDGE, "final.xml"))
    const final = db.query("SELECT is_final FROM result_snapshot WHERE is_current = 1").get() as {
      is_final: number
    }
    expect(final.is_final).toBe(1)
  })

  test("a republished area with changed figures replaces the older one (FR-028)", () => {
    ingestCouncil(db, "551082", read(EDGE, "final.xml"))
    ingestCouncil(db, "551082", read(EDGE, "republished-changed.xml"))

    const snap = db.query("SELECT voters_registered FROM result_snapshot WHERE is_current = 1").get() as {
      voters_registered: number
    }
    expect(snap.voters_registered).toBe(10180)
  })
})
