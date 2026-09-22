/**
 * The watchlist side panel (T150-T153, FR-056, FR-057).
 *
 * The rule that matters is a precedence rule: the content area never loses columns to
 * keep the panel open. The panel is an aid; the table is why the application exists.
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
import { toggleWatchlist } from "../../src/storage/queries/watchlist.ts"
import { Frame } from "../../src/ui/chrome/frame.ts"
import { buildPanelRows, MIN_CONTENT_COLUMNS, PANEL_COST, panelFits } from "../../src/ui/chrome/panel.ts"
import { applyFrameState, applyPanel, frameState } from "../../src/ui/chrome/state.ts"
import { Navigation } from "../../src/ui/navigation.ts"
import { toTextLines } from "../../src/ui/row.ts"
import { UNSORTED } from "../../src/ui/sort.ts"
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

const lines = () => toTextLines(buildPanelRows(db))

describe("contents (FR-056, T150)", () => {
  test("shows each watched council with its figures", () => {
    toggleWatchlist(db, "582786")
    const text = lines().join("\n")
    expect(text).toContain("Brno")
    expect(text).toContain("%")
  })

  test("a watched council with no data yet says so rather than vanishing", () => {
    toggleWatchlist(db, "999999")
    expect(lines().join("\n")).toMatch(/čeká se|Sledované/)
  })

  test("two watched councils both appear", () => {
    toggleWatchlist(db, "551082")
    toggleWatchlist(db, "551325")
    const text = lines().join("\n")
    expect(text).toContain("Brno-Bohunice")
    expect(text).toContain("Brno-Bosonohy")
  })
})

describe("an empty watchlist teaches rather than shows a blank box (T153)", () => {
  test("says how to add a council", () => {
    const text = lines().join("\n")
    expect(text).toContain("nesledujete")
    expect(text).toContain("w")
  })

  test("and does not pretend to be a list", () => {
    expect(lines().join("\n")).not.toContain("%")
  })
})

describe("the content area always wins (FR-057, T152)", () => {
  test("the panel fits only when a readable content area remains beside it", () => {
    expect(panelFits(MIN_CONTENT_COLUMNS + PANEL_COST)).toBe(true)
    expect(panelFits(MIN_CONTENT_COLUMNS + PANEL_COST - 1)).toBe(false)
  })

  test("the threshold is derived from the content, not a guessed number", () => {
    // If the constants ever drift apart this fails, which is the point: the rule is
    // "enough columns for a readable table", not "hide below 100".
    expect(panelFits(MIN_CONTENT_COLUMNS + PANEL_COST)).toBe(true)
    expect(MIN_CONTENT_COLUMNS).toBeGreaterThan(40)
  })

  test("at 80 columns the panel is hidden, and the table keeps its width", async () => {
    toggleWatchlist(db, "582786")
    const setup = await createTestRenderer({ width: 80, height: 24 })
    try {
      const frame = new Frame(setup.renderer)
      frame.attach(setup.renderer.root)
      const nav = new Navigation()
      nav.push({ kind: "council", kodzastup: "582786" })

      applyPanel(frame, db, themeByName("dark"), panelFits(frame.rawContentWidth))
      applyFrameState(
        frame,
        frameState({
          db,
          nav,
          councilType: "OBEC",
          query: "",
          theme: themeByName("dark"),
          sort: UNSORTED,
          width: 80,
          contentWidth: frame.contentWidth,
          contentHeight: frame.contentHeight,
          warning: null,
          notice: null,
        }),
      )
      await setup.renderOnce()

      expect(frame.panelIsVisible).toBe(false)
      expect(frame.contentWidth).toBeGreaterThanOrEqual(MIN_CONTENT_COLUMNS)
      expect(setup.captureCharFrame()).not.toContain("Sledované")
    } finally {
      setup.renderer.destroy()
    }
  })

  test("at a wide terminal it appears, and the table is still readable", async () => {
    toggleWatchlist(db, "582786")
    const setup = await createTestRenderer({ width: 130, height: 30 })
    try {
      const frame = new Frame(setup.renderer)
      frame.attach(setup.renderer.root)
      const nav = new Navigation()
      nav.push({ kind: "council", kodzastup: "582786" })

      // Two passes: the first lets the layout settle so the measured width is real.
      for (let pass = 0; pass < 2; pass += 1) {
        applyPanel(frame, db, themeByName("dark"), panelFits(frame.rawContentWidth))
        applyFrameState(
          frame,
          frameState({
            db,
            nav,
            councilType: "OBEC",
            query: "",
            theme: themeByName("dark"),
            sort: UNSORTED,
            width: 130,
            contentWidth: frame.contentWidth > 0 ? frame.contentWidth : 120,
            contentHeight: frame.contentHeight > 0 ? frame.contentHeight : 26,
            warning: null,
            notice: null,
          }),
        )
        await setup.renderOnce()
      }

      expect(frame.panelIsVisible).toBe(true)
      expect(frame.contentWidth).toBeGreaterThanOrEqual(MIN_CONTENT_COLUMNS)
      const captured = setup.captureCharFrame()
      expect(captured).toContain("Sledované")
      // The table is still there beside it, not squeezed away.
      expect(captured).toContain("Volební strana")
    } finally {
      setup.renderer.destroy()
    }
  })

  test("showing and hiding the panel leaves the scroll bar on the right", async () => {
    // The same failure mode the frame test guards: toggling a child of the body used to
    // move the bar to the wrong edge.
    toggleWatchlist(db, "582786")
    const setup = await createTestRenderer({ width: 130, height: 20 })
    try {
      const frame = new Frame(setup.renderer)
      frame.attach(setup.renderer.root)
      for (const visible of [true, false, true]) {
        applyPanel(frame, db, themeByName("dark"), visible)
        frame.setRows(Array.from({ length: 40 }, (_, i) => `  řádek ${i}`))
        await setup.renderOnce()
        for (const line of setup
          .captureCharFrame()
          .split("\n")
          .filter((l) => l.startsWith("│"))) {
          expect([...line][1]).not.toBe("▀")
          expect([...line][1]).not.toBe("█")
        }
      }
    } finally {
      setup.renderer.destroy()
    }
  })
})
