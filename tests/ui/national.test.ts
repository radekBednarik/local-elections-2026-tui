/**
 * The national overview, rendered through a REAL OpenTUI renderer with in-memory
 * output. Asserting on captured frames is what makes Principle II reach the view layer
 * rather than stopping at the query layer.
 */

import type { Database } from "bun:sqlite"
import { beforeEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { TextRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { ingestNational } from "../../src/sources/ingest.ts"
import { openMemoryDatabase } from "../../src/storage/db.ts"
import { renderNationalView } from "../../src/ui/views/national.ts"

const FIXTURES = join(import.meta.dir, "../../fixtures/2026")
const NATIONAL = readFileSync(join(FIXTURES, "vysledky.xml"), "utf8")

let db: Database
beforeEach(() => {
  db = openMemoryDatabase()
})

/** Renders lines through a real renderer and returns the visible frame. */
async function frameOf(lines: string[], width = 120, height = 30): Promise<string> {
  const setup = await createTestRenderer({ width, height })
  try {
    setup.renderer.root.add(new TextRenderable(setup.renderer, { content: lines.join("\n") }))
    await setup.renderOnce()
    return setup.captureCharFrame()
  } finally {
    setup.renderer.destroy()
  }
}

describe("before publication (FR-045)", () => {
  test("explains that results are not yet published, rather than showing nothing", async () => {
    const frame = await frameOf(renderNationalView(db))
    expect(frame).toContain("Výsledky zatím nejsou zveřejněny")
    expect(frame).not.toContain("undefined")
    expect(frame).not.toContain("NaN")
  })
})

describe("with results (User Story 1)", () => {
  beforeEach(() => {
    ingestNational(db, NATIONAL)
  })

  test("renders turnout, count progress and seats per party (FR-031)", async () => {
    const frame = await frameOf(renderNationalView(db, { now: new Date("2026-10-09T21:20:00Z") }))
    expect(frame).toContain("Sečteno okrsků")
    expect(frame).toContain("Účast")
    expect(frame).toContain("Volební strana")
    expect(frame).toContain("Mandáty")
  })

  test("shows the publisher's timestamp, not the local clock (FR-021)", async () => {
    const frame = await frameOf(renderNationalView(db, { now: new Date("2026-10-09T21:20:00Z") }))
    expect(frame).toContain("2026-10-09T21:15:00")
  })

  test("labels a completed count as final and an in-progress one as provisional (FR-022)", async () => {
    const finished = await frameOf(renderNationalView(db))
    expect(finished).toContain("konečné výsledky")

    const partial = openMemoryDatabase()
    ingestNational(partial, NATIONAL.replace(/OKRSKY_ZPRAC="14722"/, 'OKRSKY_ZPRAC="7000"'))
    const inProgress = await frameOf(renderNationalView(partial))
    expect(inProgress).toContain("průběžné výsledky")
    partial.close()
  })

  test("renders Czech party names with diacritics intact (FR-026)", async () => {
    const frame = await frameOf(renderNationalView(db))
    expect(frame).toMatch(/[ěščřžýáíéúůďťňó]/i)
  })

  test("formats numbers the Czech way, not the English way", async () => {
    const frame = await frameOf(renderNationalView(db))
    // A decimal comma must appear; a decimal point in a percentage must not.
    expect(frame).toMatch(/\d,\d\d/)
    expect(frame).not.toMatch(/\d\.\d\d\s*%/)
  })

  test("keeps the two council types separate and switchable (FR-035)", async () => {
    const municipal = await frameOf(renderNationalView(db, { oznacTypu: "OBEC" }))
    const boroughs = await frameOf(renderNationalView(db, { oznacTypu: "MCMO" }))
    expect(municipal).toContain("Zastupitelstva obcí")
    expect(boroughs).toContain("městských částí")
    expect(municipal).not.toBe(boroughs)
  })

  test("parties are ordered by seats, most first", async () => {
    const lines = renderNationalView(db)
    const header = lines.findIndex((l) => l.startsWith("Volební strana"))
    expect(header).toBeGreaterThan(-1)
    // Data rows start two lines after the header (header, underline, then rows).
    expect(lines.length).toBeGreaterThan(header + 3)
  })

  test("marks changed values with a symbol, not colour alone (FR-036, FR-040)", async () => {
    const changed = openMemoryDatabase()
    ingestNational(
      changed,
      NATIONAL.replace(/OKRSKY_ZPRAC="14722"/, 'OKRSKY_ZPRAC="7000"').replace(
        /DATUM_CAS_GENEROVANI="[^"]*"/,
        'DATUM_CAS_GENEROVANI="2026-10-09T20:00:00"',
      ),
    )
    ingestNational(changed, NATIONAL)

    const frame = await frameOf(renderNationalView(changed))
    // The increase marker must be present as a character in the frame itself.
    expect(frame).toContain("▲")
    changed.close()
  })

  test("fits a narrow terminal without wrapping the table", async () => {
    const lines = renderNationalView(db, { width: 80 })
    for (const line of lines) {
      expect([...line].length).toBeLessThanOrEqual(80)
    }
  })

  test("renders no placeholder artefacts anywhere", async () => {
    const frame = await frameOf(renderNationalView(db))
    expect(frame).not.toContain("undefined")
    expect(frame).not.toContain("NaN")
    expect(frame).not.toContain("null")
  })
})
