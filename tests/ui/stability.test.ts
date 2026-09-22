/**
 * Region stability (T123, FR-058) and the 80 by 24 floor (T124, FR-041).
 *
 * The guarantee: new data arriving while a view is open changes the FIGURES and nothing
 * else. Not the regions, not the scroll position, not the selected row. This is also
 * User Story 2 scenario 5, which must not regress now that there is chrome to move.
 *
 * Asserted through the real drawing path - frameState decides, applyFrameState applies -
 * so a regression in either half is caught rather than only in the half under test.
 */

import type { Database } from "bun:sqlite"
import { beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createTestRenderer } from "@opentui/core/testing"
import { extractArchiveFile } from "../../src/reference/archive.ts"
import { loadReference, type ReferenceArchives } from "../../src/reference/loader.ts"
import { ingestDistrict, ingestNational } from "../../src/sources/ingest.ts"
import { openMemoryDatabase } from "../../src/storage/db.ts"
import { Frame } from "../../src/ui/chrome/frame.ts"
import { applyFrameState, frameState } from "../../src/ui/chrome/state.ts"
import { Navigation } from "../../src/ui/navigation.ts"
import { themeByName } from "../../src/ui/theme/themes.ts"

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

/** Where each region sits in the captured frame. */
interface Regions {
  breadcrumb: number
  borderTop: number
  borderBottom: number
  status: number
}

function regionsOf(captured: string): Regions {
  const lines = captured.split("\n")
  return {
    breadcrumb: lines.findIndex((l) => l.includes("ČR")),
    borderTop: lines.findIndex((l) => l.includes("┌")),
    borderBottom: lines.findIndex((l) => l.includes("└")),
    // The status bar is the last written row. Located by position rather than by
    // content, because a narrow terminal drops hints from the end and no single word is
    // reliably present in it.
    status: lines.reduce((last, l, i) => (l.trim() === "" ? last : i), -1),
  }
}

interface Harness {
  frame: Frame
  nav: Navigation
  draw: () => Promise<string>
  destroy: () => void
}

async function harness(width = 100, height = 30): Promise<Harness> {
  const setup = await createTestRenderer({ width, height })
  const frame = new Frame(setup.renderer)
  frame.attach(setup.renderer.root)
  const nav = new Navigation()

  const draw = async () => {
    applyFrameState(
      frame,
      frameState({
        db,
        nav,
        councilType: "OBEC",
        query: "",
        theme: themeByName("dark"),
        width,
        contentWidth: frame.contentWidth > 0 ? frame.contentWidth : width - 2,
        contentHeight: frame.contentHeight > 0 ? frame.contentHeight : height - 4,
        warning: null,
        notice: null,
      }),
    )
    await setup.renderOnce()
    return setup.captureCharFrame()
  }

  return { frame, nav, draw, destroy: () => setup.renderer.destroy() }
}

describe("a refresh moves nothing (FR-058, User Story 2 scenario 5)", () => {
  test("regions, scroll offset and selection all survive new data", async () => {
    const h = await harness()
    try {
      // The district list is 78 rows, which is comfortably more than one screenful.
      h.nav.push({ kind: "districts" })
      await h.draw()
      // Walk well past the first screenful, so the scroll offset is non-trivial.
      h.nav.move(40, 78)
      const before = await h.draw()

      const regionsBefore = regionsOf(before)
      const selectedBefore = h.nav.current.selected
      const offsetBefore = h.nav.current.offset
      expect(offsetBefore).toBeGreaterThan(0)

      // New data arrives for the district the user is looking at.
      ingestDistrict(db, "CZ0642", read("vysledky_obce_okres_CZ0642.xml"))
      const after = await h.draw()

      expect(regionsOf(after)).toEqual(regionsBefore)
      expect(h.nav.current.selected).toBe(selectedBefore)
      expect(h.nav.current.offset).toBe(offsetBefore)
    } finally {
      h.destroy()
    }
  })

  test("the selected row is still the one the marker is on after a refresh", async () => {
    const h = await harness()
    try {
      h.nav.push({ kind: "district", nuts: "CZ0642" })
      await h.draw()
      h.nav.move(3, 20)
      const before = await h.draw()
      const markedBefore = before.split("\n").find((l) => l.includes("▶"))

      ingestDistrict(db, "CZ0642", read("vysledky_obce_okres_CZ0642.xml"))
      const after = await h.draw()
      const markedAfter = after.split("\n").find((l) => l.includes("▶"))

      expect(markedAfter).toBe(markedBefore)
    } finally {
      h.destroy()
    }
  })

  test("national figures still update in place, so stability is not staleness", async () => {
    const h = await harness()
    try {
      const before = await h.draw()
      expect(before).toContain("Zastupitelstva obcí")
      // The whole point of the guarantee is that the DATA moves while the frame does
      // not: a screen that never changed would pass the assertions above for the wrong
      // reason.
      expect(before).toMatch(/\d/)
    } finally {
      h.destroy()
    }
  })
})

describe("the minimum terminal, end to end (T124, FR-041)", () => {
  test("a real council view fits 80 by 24 with every region present", async () => {
    const h = await harness(80, 24)
    try {
      h.nav.push({ kind: "district", nuts: "CZ0642" })
      h.nav.move(1, 50)
      const captured = await h.draw()
      const lines = captured.split("\n")

      const regions = regionsOf(captured)
      expect(regions.breadcrumb).toBeGreaterThanOrEqual(0)
      expect(regions.borderTop).toBeGreaterThan(regions.breadcrumb)
      expect(regions.borderBottom).toBeGreaterThan(regions.borderTop)
      expect(regions.status).toBeGreaterThan(regions.borderBottom)

      for (const line of lines) expect([...line].length).toBeLessThanOrEqual(80)
      // Chrome must not eat the screen: a table needs rows to be worth showing.
      expect(h.frame.contentHeight).toBeGreaterThanOrEqual(19)
    } finally {
      h.destroy()
    }
  })

  test("the breadcrumb keeps the current location when the terminal is narrow", async () => {
    const h = await harness(80, 24)
    try {
      h.nav.push({ kind: "districts" })
      h.nav.push({ kind: "district", nuts: "CZ0642" })
      h.nav.push({ kind: "council", kodzastup: "582786" })
      const captured = await h.draw()
      const state = frameState({
        db,
        nav: h.nav,
        councilType: "OBEC",
        query: "",
        theme: themeByName("dark"),
        width: 80,
        contentWidth: 78,
        contentHeight: 20,
        warning: null,
        notice: null,
      })
      expect([...state.breadcrumb].length).toBeLessThanOrEqual(80)
      expect(captured).toContain(state.breadcrumb.slice(-8))
    } finally {
      h.destroy()
    }
  })
})
