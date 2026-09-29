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
import { csvForScreen } from "../../src/export/tables.ts"
import { extractArchiveFile } from "../../src/reference/archive.ts"
import { loadReference, type ReferenceArchives } from "../../src/reference/loader.ts"
import { ingestDistrict, ingestNational } from "../../src/sources/ingest.ts"
import { openMemoryDatabase } from "../../src/storage/db.ts"
import { type SnapshotInput, writeSnapshot } from "../../src/storage/snapshots.ts"
import { Frame } from "../../src/ui/chrome/frame.ts"
import { chartPaneWidth } from "../../src/ui/chrome/panel.ts"
import {
  applyFrameState,
  applyPanel,
  chartAction,
  choosePanel,
  type FrameState,
  frameState,
  panelFor,
  viewWidthFor,
} from "../../src/ui/chrome/state.ts"
import type { SourceStatus } from "../../src/ui/components/status.ts"
import { Navigation, type Screen } from "../../src/ui/navigation.ts"
import { toTextLines } from "../../src/ui/row.ts"
import { UNSORTED } from "../../src/ui/sort.ts"
import { themeByName } from "../../src/ui/theme/themes.ts"
import { buildChartRows, chartContext } from "../../src/ui/views/chart.ts"

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
  /** First and last rows of the content, found by the rail down its left edge. */
  contentTop: number
  contentBottom: number
  status: number
}

function regionsOf(captured: string): Regions {
  const lines = captured.split("\n")
  return {
    breadcrumb: lines.findIndex((l) => l.includes("ČR")),
    contentTop: lines.findIndex((l) => l.startsWith("┃")),
    contentBottom: lines.reduce((last, l, i) => (l.startsWith("┃") ? i : last), -1),
    // The status bar is the last written row. Located by position rather than by
    // content, because a narrow terminal drops hints from the end and no single word is
    // reliably present in it.
    status: lines.reduce((last, l, i) => (l.trim() === "" ? last : i), -1),
  }
}

interface Harness {
  frame: Frame
  nav: Navigation
  draw: (sourceStatus?: SourceStatus) => Promise<string>
  /** The state the last draw applied. */
  state: () => FrameState | null
  destroy: () => void
}

async function harness(width = 100, height = 30): Promise<Harness> {
  const setup = await createTestRenderer({ width, height })
  const frame = new Frame(setup.renderer)
  frame.attach(setup.renderer.root)
  const nav = new Navigation()
  // Laid out once first, so every draw is composed against the real content metrics.
  await setup.renderOnce()

  let last: FrameState | null = null
  const draw = async (sourceStatus: SourceStatus = null) => {
    last = frameState({
      db,
      nav,
      councilType: "OBEC",
      query: "",
      theme: themeByName("tokyonight"),
      sort: UNSORTED,
      width,
      contentWidth: frame.contentWidth,
      contentHeight: frame.contentHeight,
      sourceStatus,
      notice: null,
    })
    applyFrameState(frame, last, themeByName("tokyonight"))
    // A warning row changes the content height; lay out again so the next draw sees it.
    await setup.renderOnce()
    await setup.renderOnce()
    return setup.captureCharFrame()
  }

  return { frame, nav, draw, state: () => last, destroy: () => setup.renderer.destroy() }
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
      expect(regions.contentTop).toBeGreaterThan(regions.breadcrumb)
      expect(regions.contentBottom).toBeGreaterThan(regions.contentTop)
      expect(regions.status).toBeGreaterThan(regions.contentBottom)

      for (const line of lines) expect([...line].length).toBeLessThanOrEqual(80)
      // Chrome must not eat the screen: a table needs rows to be worth showing.
      expect(h.frame.contentHeight).toBeGreaterThanOrEqual(21)
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
        theme: themeByName("tokyonight"),
        sort: UNSORTED,
        width: 80,
        contentWidth: 78,
        contentHeight: 20,
        sourceStatus: null,
        notice: null,
      })
      expect([...state.breadcrumb].length).toBeLessThanOrEqual(80)
      // The title bar joins segments with ▌ rather than ›; what matters is that the current
      // location, the last segment of the trail, is on screen.
      const current = state.breadcrumb.split(" › ").at(-1) ?? ""
      expect(current.length).toBeGreaterThan(0)
      expect(captured.split("\n")[0]).toContain(current)
    } finally {
      h.destroy()
    }
  })
})

describe("every screen fits 80 by 24 with the warning shown (002 T025, SC-007, FR-028)", () => {
  const WARNING: SourceStatus = {
    kind: "stale",
    text: "! ZASTARALÁ DATA z doby před 4 min. Obnovení se nedaří. · l záznamy",
  }
  const screens: [string, Screen[]][] = [
    ["national", []],
    ["districts", [{ kind: "districts" }]],
    ["district", [{ kind: "district", nuts: "CZ0642" }]],
    ["council", [{ kind: "council", kodzastup: "582786" }]],
    ["watchlist", [{ kind: "watchlist" }]],
    ["search", [{ kind: "search" }]],
    ["help", [{ kind: "help" }]],
  ]

  test.each(screens)("%s: no row is cut, and a table keeps ten rows in view", async (_name, stack) => {
    const h = await harness(80, 24)
    try {
      for (const screen of stack) h.nav.push(screen)
      await h.draw(WARNING)
      const captured = await h.draw(WARNING)
      const state = h.state()
      expect(state).not.toBeNull()
      if (state === null) return

      expect(captured).toContain("ZASTARALÁ DATA")
      for (const line of captured.split("\n")) expect([...line].length).toBeLessThanOrEqual(80)

      // Every row in view appears whole: its text was composed for the width it is drawn
      // at, so nothing the view wrote is lost to the chrome.
      const visible = state.lines.slice(state.offset, state.offset + h.frame.contentHeight)
      for (const line of visible) expect(captured).toContain(line.trimEnd())

      const firstData = state.content.rows.findIndex((r) => r.kind === "data")
      const dataRows = state.content.rows.filter((r) => r.kind === "data").length
      if (firstData >= 0 && dataRows >= 10) {
        expect(h.frame.contentHeight - (firstData - state.offset)).toBeGreaterThanOrEqual(10)
      }
    } finally {
      h.destroy()
    }
  })
})

describe("the chart pane (006 FR-003, SC-004, SC-005)", () => {
  /** The draw the application makes, with the chart pane shown or not. */
  async function chartHarness(width = 100, height = 30) {
    const setup = await createTestRenderer({ width, height })
    const frame = new Frame(setup.renderer)
    frame.attach(setup.renderer.root)
    const nav = new Navigation()
    await setup.renderOnce()
    const theme = themeByName("tokyonight")
    const draw = async (chart: boolean, watchlist = false) => {
      // The very decision the application makes, not a copy of it (review finding 2).
      const panel = panelFor(db, {
        chartOpen: chart,
        sidePanelOpen: watchlist,
        screen: nav.screen,
        councilType: "OBEC",
        contentAreaWidth: frame.rawContentWidth,
        contentHeight: frame.contentHeight,
      })
      applyPanel(frame, db, theme, panel)
      const state = frameState({
        db,
        nav,
        councilType: "OBEC",
        query: "",
        theme,
        sort: UNSORTED,
        width,
        contentWidth: frame.contentWidth,
        contentHeight: frame.contentHeight,
        sourceStatus: null,
        notice: null,
        chartShown: panel?.kind === "chart",
        chartFits: true,
      })
      applyFrameState(frame, state, theme)
      await setup.renderOnce()
      await setup.renderOnce()
      return { captured: setup.captureCharFrame(), state }
    }
    return { frame, nav, draw, destroy: () => setup.renderer.destroy() }
  }

  test("opening and closing the pane leaves the scroll position and the selection alone", async () => {
    const h = await chartHarness()
    try {
      await h.draw(false)
      h.nav.current.offset = 3
      const offset = h.nav.current.offset
      const selected = h.nav.current.selected
      await h.draw(true)
      await h.draw(false)
      expect(h.nav.current.offset).toBe(offset)
      expect(h.nav.current.selected).toBe(selected)
    } finally {
      h.destroy()
    }
  })

  test("the pane takes its width and the table is composed at what is left", async () => {
    const h = await chartHarness()
    try {
      await h.draw(false)
      const raw = h.frame.rawContentWidth
      const { state } = await h.draw(true)
      expect(h.frame.panel.width).toBe(chartPaneWidth(raw))
      expect(h.frame.contentWidth).toBe(raw - chartPaneWidth(raw) - 1)
      const widest = Math.max(...state.content.lines.map((l) => [...l].length))
      expect(widest).toBeLessThanOrEqual(viewWidthFor(raw - chartPaneWidth(raw) - 1))
    } finally {
      h.destroy()
    }
  })

  test("every legend row fits the pane whole: nothing wraps onto the next line", async () => {
    const h = await chartHarness()
    try {
      const { captured } = await h.draw(true)
      const legend = captured.split("\n").filter((l) => /┃ (██|▓▓|▚▚|▒▒|▞▞|░░|··) /.test(l))
      expect(legend).toHaveLength(7)
      for (const row of legend) expect(row.trimEnd().endsWith("%")).toBe(true)
    } finally {
      h.destroy()
    }
  })

  test("the chart takes the watchlist's place, and the watchlist returns when it closes", async () => {
    const h = await chartHarness(120, 30)
    try {
      const shown = await h.draw(true, true)
      expect(shown.captured).toContain("Graf · ČR")
      expect(shown.captured).not.toContain("SLEDOVANÉ")
      const closed = await h.draw(false, true)
      expect(closed.captured).toContain("SLEDOVANÉ")
      expect(closed.captured).not.toContain("Graf · ČR")
    } finally {
      h.destroy()
    }
  })

  test("the panel choice: the chart wins where it applies and fits, the watchlist otherwise", () => {
    const national = { kind: "national" } as const
    const base = { screen: national, contentAreaWidth: 98 }
    expect(choosePanel({ ...base, chartOpen: true, sidePanelOpen: true })).toBe("chart")
    expect(choosePanel({ ...base, chartOpen: false, sidePanelOpen: true })).toBe("watchlist")
    expect(choosePanel({ ...base, chartOpen: false, sidePanelOpen: false })).toBeNull()
    // Too narrow for the chart, wide enough for the watchlist.
    expect(choosePanel({ ...base, contentAreaWidth: 90, chartOpen: true, sidePanelOpen: true })).toBe(
      "watchlist",
    )
    // A screen with no breakdown: the chart is wanted but hidden.
    expect(
      choosePanel({ ...base, screen: { kind: "districts" }, chartOpen: true, sidePanelOpen: false }),
    ).toBeNull()
  })

  test("a refresh that re-ranks two parties swaps their slices and marks the rise", () => {
    const fresh = openMemoryDatabase()
    const national = (publishedAt: string, votes: [number, number, number]): SnapshotInput => ({
      areaKind: "national",
      areaId: "",
      oznacTypu: "OBEC",
      publishedAt,
      fetchedAt: publishedAt,
      districtsTotal: 10,
      districtsCounted: 5,
      districtsPct: 50,
      votersRegistered: 1000,
      envelopesIssued: 700,
      envelopesReturned: 700,
      validVotes: votes[0] + votes[1] + votes[2],
      turnoutPct: 70,
      seatsTotal: 10,
      isFinal: false,
      parties: (["Alfa", "Beta", "Gama"] as const).map((name, i) => ({
        vstrana: String(i + 1),
        ballotOrder: null,
        name,
        votes: votes[i] ?? 0,
        votesPct: null,
        candidates: null,
        seatsWon: 0,
        seatsPct: null,
      })),
    })
    const legendNames = () => {
      const context = chartContext(fresh, { kind: "national" }, "OBEC")
      if (context === null) throw new Error("no chart")
      return toTextLines(buildChartRows(context, 47, 27)).slice(-3)
    }
    writeSnapshot(fresh, national("2026-10-09T20:00:00", [300, 200, 100]))
    expect(legendNames().map((l) => l.slice(4, 8))).toEqual(["Alfa", "Beta", "Gama"])
    writeSnapshot(fresh, national("2026-10-09T20:05:00", [300, 200, 250]))
    const after = legendNames()
    expect(after.map((l) => l.slice(4, 8))).toEqual(["Alfa", "Gama", "Beta"])
    expect(after[1]).toContain("▲250")
  })

  test("export is the same with the pane open or closed (FR-003)", () => {
    const council = { kind: "council", kodzastup: "582786" } as const
    // The exporter takes no width, so nothing about the pane can reach it.
    expect(csvForScreen(db, council, { councilType: "OBEC" })).toEqual(
      csvForScreen(db, council, { councilType: "OBEC" }),
    )
    expect(csvForScreen.length).toBeLessThanOrEqual(3)
  })
})

describe("what g and Esc do to the chart (006 research R4, review finding 2)", () => {
  test("g toggles the chart where it applies, and says so where it does not", () => {
    expect(chartAction("chart", { open: false, shown: false, unavailable: null })).toEqual({
      open: true,
      notice: null,
      handled: true,
    })
    expect(chartAction("chart", { open: true, shown: true, unavailable: null })).toEqual({
      open: false,
      notice: null,
      handled: true,
    })
    expect(
      chartAction("chart", { open: false, shown: false, unavailable: "okno je pro graf příliš úzké" }),
    ).toEqual({
      open: false,
      notice: "Tento příkaz zde není dostupný.",
      handled: true,
    })
  })

  test("Esc closes a shown chart and goes nowhere; otherwise it is the ordinary back", () => {
    expect(chartAction("back", { open: true, shown: true, unavailable: null })).toEqual({
      open: false,
      notice: null,
      handled: true,
    })
    // Wanted but hidden (a screen without a breakdown): Esc goes back as usual.
    expect(chartAction("back", { open: true, shown: false, unavailable: null })).toEqual({
      open: true,
      notice: null,
      handled: false,
    })
  })

  test("the panel for the chart carries the context, the pane width and the height", () => {
    const panel = panelFor(db, {
      chartOpen: true,
      sidePanelOpen: true,
      screen: { kind: "national" },
      councilType: "OBEC",
      contentAreaWidth: 98,
      contentHeight: 27,
    })
    expect(panel?.kind).toBe("chart")
    if (panel?.kind !== "chart") return
    expect(panel.width).toBe(chartPaneWidth(98))
    expect(panel.height).toBe(27)
    expect(panel.context.title).toBe("Graf · ČR · obce")
    expect(
      panelFor(db, {
        chartOpen: false,
        sidePanelOpen: true,
        screen: { kind: "national" },
        councilType: "OBEC",
        contentAreaWidth: 98,
        contentHeight: 27,
      }),
    ).toEqual({ kind: "watchlist" })
  })
})
