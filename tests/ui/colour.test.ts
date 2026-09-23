/**
 * Colour applied (T136, T138-T140, FR-059 to FR-063, SC-023, SC-024).
 *
 * Asserted against the COLOURS ACTUALLY WRITTEN to the frame, read back through
 * `captureSpans`, not against the theme table. A theme that is correct and never reaches
 * the screen would pass a test of the table and fail the user.
 */

import type { Database } from "bun:sqlite"
import { beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { type CapturedSpan, type RGBA, rgbToHex } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { extractArchiveFile } from "../../src/reference/archive.ts"
import { loadReference, type ReferenceArchives } from "../../src/reference/loader.ts"
import { ingestDistrict, ingestNational } from "../../src/sources/ingest.ts"
import { openMemoryDatabase } from "../../src/storage/db.ts"
import { addToWatchlist } from "../../src/storage/queries/watchlist.ts"
import { Frame } from "../../src/ui/chrome/frame.ts"
import { applyFrameState, type FrameState, frameState } from "../../src/ui/chrome/state.ts"
import type { Column } from "../../src/ui/format.ts"
import type { Screen } from "../../src/ui/navigation.ts"
import { Navigation } from "../../src/ui/navigation.ts"
import { cell, type SemanticRow, toTextLines } from "../../src/ui/row.ts"
import { composeScreen, type ScreenContent } from "../../src/ui/screen.ts"
import { nextSort, type SortState, UNSORTED } from "../../src/ui/sort.ts"
import { MONOCHROME, THEME_NAMES, type Theme, themeByName } from "../../src/ui/theme/themes.ts"

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

interface Painted {
  text: string
  spans: CapturedSpan[]
}

/** Renders one screen and returns both its text and the colours actually written. */
async function paint(screen: Screen, theme: Theme, width = 110, height = 34): Promise<Painted> {
  const setup = await createTestRenderer({ width, height })
  try {
    const frame = new Frame(setup.renderer)
    frame.attach(setup.renderer.root)
    const nav = new Navigation()
    if (screen.kind !== "national") nav.push(screen)

    applyFrameState(
      frame,
      frameState({
        db,
        nav,
        councilType: "OBEC",
        query: "",
        theme,
        sort: UNSORTED,
        width,
        contentWidth: frame.contentWidth > 0 ? frame.contentWidth : width - 2,
        contentHeight: frame.contentHeight > 0 ? frame.contentHeight : height - 3,
        warning: null,
        notice: null,
      }),
    )
    await setup.renderOnce()
    return {
      text: setup.captureCharFrame(),
      spans: setup.captureSpans().lines.flatMap((line) => line.spans),
    }
  } finally {
    setup.renderer.destroy()
  }
}

const key = (span: CapturedSpan) => `${span.fg.r},${span.fg.g},${span.fg.b},${span.attributes}`

describe("no electoral party is coloured (FR-060, T138)", () => {
  // With thousands of local candidate lists there is no authoritative colour per party,
  // and assigning one would imply a political affiliation the source never published.
  test("every party name in a council table is painted identically", async () => {
    const { spans } = await paint({ kind: "council", kodzastup: "582786" }, themeByName("tokyonight"))

    const parties = ["ANO 2011", "Česká pirátská strana", "Fakt Brno", "RESTART PRO BRNO"]
    const found = parties
      .map((name) => spans.find((s) => s.text.includes(name)))
      .filter((s): s is CapturedSpan => s !== undefined)

    expect(found.length).toBeGreaterThanOrEqual(3)
    const distinct = new Set(found.map(key))
    expect(distinct.size).toBe(1)
  })

  test("the same holds in the national table, across every theme", async () => {
    for (const name of THEME_NAMES) {
      const { spans } = await paint({ kind: "national" }, themeByName(name))
      const found = ["ANO 2011", "KDU-ČSL", "Nezávislý kandidát"]
        .map((party) => spans.find((s) => s.text.includes(party)))
        .filter((s): s is CapturedSpan => s !== undefined)
      expect(found.length).toBeGreaterThanOrEqual(2)
      expect(new Set(found.map(key)).size).toBe(1)
    }
  })
})

describe("the monochrome guarantee (FR-063, SC-023, T139)", () => {
  test("removing colour removes nothing but decoration", async () => {
    const coloured = await paint({ kind: "council", kodzastup: "582786" }, themeByName("tokyonight"))
    const plain = await paint({ kind: "council", kodzastup: "582786" }, MONOCHROME)

    // Character for character, the two screens are the same. Colour was never carrying
    // anything the text was not already carrying.
    expect(plain.text).toBe(coloured.text)
  })

  test("every status is still readable as words", async () => {
    const { text } = await paint({ kind: "district", nuts: "CZ0642" }, MONOCHROME)
    expect(text).toContain("konečné")
    expect(text).toMatch(/Účast|Okrsky/)
  })

  test("the selection is marked by a symbol, not by colour", async () => {
    const { text } = await paint({ kind: "district", nuts: "CZ0642" }, MONOCHROME)
    expect(text).toContain("▶")
  })

  test("nothing in a monochrome frame carries a foreground colour of its own", async () => {
    const { spans } = await paint({ kind: "council", kodzastup: "582786" }, MONOCHROME)
    const party = spans.find((s) => s.text.includes("ANO 2011"))
    const heading = spans.find((s) => s.text.includes("Volební strana"))
    expect(party).toBeDefined()
    expect(heading).toBeDefined()
    // Both fall back to the terminal's default foreground, so neither is coloured.
    expect(`${party?.fg.r},${party?.fg.g},${party?.fg.b}`).toBe(
      `${heading?.fg.r},${heading?.fg.g},${heading?.fg.b}`,
    )
  })
})

describe("high contrast (FR-062, SC-024, T140)", () => {
  const luminance = (span: CapturedSpan) => 0.299 * span.fg.r + 0.587 * span.fg.g + 0.114 * span.fg.b

  test("roles are separated by brightness, so hue is never load-bearing", async () => {
    const { spans } = await paint({ kind: "council", kodzastup: "582786" }, themeByName("high-contrast"))

    const heading = spans.find((s) => s.text.includes("Volební strana"))
    const muted = spans.find((s) => s.text.includes("zveřejňují se pouze dávkově"))
    expect(heading).toBeDefined()
    expect(muted).toBeDefined()

    expect(Math.abs(luminance(heading as CapturedSpan) - luminance(muted as CapturedSpan))).toBeGreaterThan(
      0.2,
    )
  })

  test("and the text is identical to every other theme, so nothing is lost either way", async () => {
    const high = await paint({ kind: "council", kodzastup: "582786" }, themeByName("high-contrast"))
    const light = await paint({ kind: "council", kodzastup: "582786" }, themeByName("catppuccin-latte"))
    expect(high.text).toBe(light.text)
  })
})

describe("colour is applied at all (T136)", () => {
  test("a themed frame paints more than one colour", async () => {
    const { spans } = await paint({ kind: "council", kodzastup: "582786" }, themeByName("tokyonight"))
    // The counterpart to the monochrome test: if this ever collapsed to one colour the
    // theme would have stopped reaching the screen and the tests above would still pass.
    expect(new Set(spans.map(key)).size).toBeGreaterThan(1)
  })
})

// ---------------------------------------------------------------------------------------
// Striped tables (User Story 1, T014-T017a). Asserted cell by cell against what the
// renderer actually wrote, across the full width of each row renderable.
// ---------------------------------------------------------------------------------------

interface PaintedCell {
  ch: string
  fg: string
  /** "none" when nothing was painted, so the terminal's own background shows. */
  bg: string
  bold: boolean
}

interface PaintedRows {
  state: FrameState
  /** Every cell of the terminal, by line. */
  grid: PaintedCell[][]
  /** The scroll bar's cells, top to bottom. */
  scrollbar: PaintedCell[]
  /** Cells of each row renderable, by row index; null for a row scrolled out of view. */
  rows: (PaintedCell[] | null)[]
  text: string
}

interface PaintOptions {
  width?: number
  height?: number
  query?: string
  sort?: SortState
  selected?: number
  content?: ScreenContent
  warning?: string | null
  lastSuccessAt?: string | null
}

const hexOf = (colour: RGBA): string => (colour.a === 0 ? "none" : rgbToHex(colour))

async function paintRows(screen: Screen, theme: Theme, options: PaintOptions = {}): Promise<PaintedRows> {
  const width = options.width ?? 110
  const height = options.height ?? 34
  const setup = await createTestRenderer({ width, height })
  try {
    const frame = new Frame(setup.renderer)
    frame.attach(setup.renderer.root)
    // Lay out once so the frame reports its real metrics before anything is composed.
    await setup.renderOnce()
    const nav = new Navigation()
    if (screen.kind !== "national") nav.push(screen)
    if (options.selected !== undefined) nav.current.selected = options.selected

    const state = frameState({
      db,
      nav,
      councilType: "OBEC",
      query: options.query ?? "",
      theme,
      sort: options.sort ?? UNSORTED,
      width,
      contentWidth: frame.contentWidth,
      contentHeight: frame.contentHeight,
      warning: options.warning ?? null,
      notice: null,
      content: options.content,
      lastSuccessAt: options.lastSuccessAt ?? null,
    })
    applyFrameState(frame, state, theme)
    await setup.renderOnce()
    // A warning row takes a line from the content; draw again after the layout, as the
    // application does on its next tick.
    if (options.warning) {
      applyFrameState(frame, state, theme)
      await setup.renderOnce()
    }

    const grid = setup.captureSpans().lines.map((line) =>
      line.spans.flatMap((span) =>
        [...span.text].map((ch) => ({
          ch,
          fg: hexOf(span.fg),
          bg: hexOf(span.bg),
          bold: (span.attributes & 1) === 1,
        })),
      ),
    )
    const top = frame.scroll.y
    const bottom = top + frame.scroll.height
    const rows = frame.rows.map((node) => {
      if (node.y < top || node.y >= bottom) return null
      return (grid[node.y] ?? []).slice(node.x, node.x + frame.contentWidth)
    })
    const bar = frame.scroll.verticalScrollBar
    const scrollbar = Array.from({ length: bar.height }, (_, i) => grid[bar.y + i]?.[bar.x]).filter(
      (c): c is PaintedCell => c !== undefined,
    )
    return { state, grid, scrollbar, rows, text: setup.captureCharFrame() }
  } finally {
    setup.renderer.destroy()
  }
}

const TOKYO = themeByName("tokyonight")
const slot = (theme: Theme, name: keyof Theme["slots"]) => theme.slots[name] ?? "none"

/**
 * Every cell of a painted row has this background, but for a bar's track, which is a
 * second tone within the row by design (002 FR-018).
 */
function expectRowBg(painted: PaintedCell[] | null | undefined, bg: string, label: string): void {
  expect(painted).toBeDefined()
  if (painted === null || painted === undefined) return
  const track = new Set(THEME_NAMES.map((name) => themeByName(name).slots.track))
  const wrong = painted.findIndex((c) => c.bg !== bg && !(track.has(c.bg) && c.ch === " "))
  expect(`${label}: ${wrong === -1 ? "ok" : `column ${wrong} is ${painted[wrong]?.bg}`}`).toBe(`${label}: ok`)
}

/** Index of the header row, and the data rows that follow it in display order. */
function tableRows(state: FrameState): { header: number; data: number[] } {
  const header = state.content.rows.findIndex((r) => r.kind === "header")
  const data: number[] = []
  for (let i = header + 1; i < state.content.rows.length; i++) {
    const kind = state.content.rows[i]?.kind
    if (kind === "header") break
    if (kind === "data") data.push(i)
  }
  return { header, data }
}

describe("striped tables (US1, FR-015 to FR-017)", () => {
  test("the district list alternates bg and zebra, under a header on element", async () => {
    const { state, rows } = await paintRows({ kind: "districts" }, TOKYO, { selected: 3 })
    const { header, data } = tableRows(state)
    expect(header).toBeGreaterThanOrEqual(0)
    expectRowBg(rows[header], slot(TOKYO, "element"), "header")
    expectRowBg(rows[header + 1], slot(TOKYO, "bg"), "rule")

    const selectedLine = state.content.firstRow + 3
    data.forEach((index, position) => {
      if (rows[index] === null) return
      const expected = index === selectedLine ? "sel" : position % 2 === 1 ? "zebra" : "bg"
      expectRowBg(rows[index], slot(TOKYO, expected), `data ${position}`)
    })
  })

  test("the selected row is sel across its full width, whatever its stripe, with text on it", async () => {
    for (const selected of [2, 3]) {
      const { state, rows } = await paintRows({ kind: "districts" }, TOKYO, { selected })
      const painted = rows[state.content.firstRow + selected]
      expectRowBg(painted, slot(TOKYO, "sel"), `selected ${selected}`)
      expect(painted?.[0]?.ch).toBe("▶")
      const glyphs = (painted ?? []).filter((c) => c.ch.trim() !== "" && c.ch !== "▶")
      expect(glyphs.length).toBeGreaterThan(0)
      for (const c of glyphs) expect(`${c.ch}:${c.fg}:${c.bold}`).toBe(`${c.ch}:${slot(TOKYO, "text")}:true`)
    }
  })

  test("the row the selection left returns to its stripe", async () => {
    const before = await paintRows({ kind: "districts" }, TOKYO, { selected: 1 })
    const after = await paintRows({ kind: "districts" }, TOKYO, { selected: 2 })
    const index = before.state.content.firstRow + 1
    expectRowBg(before.rows[index], slot(TOKYO, "sel"), "while selected")
    expectRowBg(after.rows[index], slot(TOKYO, "zebra"), "after leaving")
  })

  test("sorting keeps the stripes starting from bg (acceptance 1.3)", async () => {
    const screen: Screen = { kind: "council", kodzastup: "582786" }
    const plain = await paintRows(screen, TOKYO)
    const sort = nextSort(UNSORTED, plain.state.content.sortableColumns)
    const { state, rows } = await paintRows(screen, TOKYO, { sort, selected: 1 })
    const { data } = tableRows(state)
    expect(data.length).toBeGreaterThan(2)
    expectRowBg(rows[data[0] as number], slot(TOKYO, "bg"), "first row after sorting")
    expectRowBg(rows[data[2] as number], slot(TOKYO, "bg"), "third row after sorting")
  })
})

describe("changes keep their colour and marker (FR-019)", () => {
  const columns: Column[] = [
    { header: "Strana", width: 30 },
    { header: "Hlasy", width: 12, align: "right" },
  ]
  const rows: SemanticRow[] = [
    { kind: "header", columns, cells: [cell("Strana", "heading"), cell("Hlasy", "heading")] },
    { kind: "data", columns, cells: [cell("ANO 2011"), cell("▲ 16 752", "increase")] },
    { kind: "data", columns, cells: [cell("KDU-ČSL"), cell("▼ 32 584", "decrease")] },
  ]
  const content: ScreenContent = {
    rows,
    lines: toTextLines(rows),
    firstRow: 1,
    rowCount: 2,
    target: () => null,
    sortableColumns: 0,
  }
  const glyph = (painted: PaintedCell[] | null | undefined, ch: string) => painted?.find((c) => c.ch === ch)

  test("a rise is success and a fall is error, each with its marker", async () => {
    const { rows: painted } = await paintRows({ kind: "search" }, TOKYO, { content, selected: 1 })
    expect(glyph(painted[1], "▲")?.fg).toBe(slot(TOKYO, "success"))
    expect(glyph(painted[2], "▼")).toBeDefined()
  })

  test("on the selected row a change keeps its colour where it still reads, else takes the text colour", async () => {
    const tokyo = await paintRows({ kind: "search" }, TOKYO, { content, selected: 0 })
    expect(glyph(tokyo.rows[1], "▲")?.fg).toBe(slot(TOKYO, "success"))

    // High contrast's selection is white, on which its light-grey rise would vanish.
    const high = themeByName("high-contrast")
    const reversed = await paintRows({ kind: "search" }, high, { content, selected: 0 })
    expect(glyph(reversed.rows[1], "▲")?.fg).toBe(slot(high, "bg"))
  })
})

describe("monochrome paints nothing (FR-008, acceptance 1.4)", () => {
  test("the district list has no background anywhere, and the selection is ▶", async () => {
    const { state, rows } = await paintRows({ kind: "districts" }, MONOCHROME, { selected: 2 })
    rows.forEach((painted, index) => {
      if (painted !== null) expectRowBg(painted, "none", `row ${index}`)
    })
    expect(rows[state.content.firstRow + 2]?.[0]?.ch).toBe("▶")
  })
})

describe("every table screen is striped (T017a, SC-001, SC-005)", () => {
  function screens(): [string, Screen, PaintOptions][] {
    const district: Screen = { kind: "district", nuts: "CZ0642" }
    const districtContent = composeScreen(db, district, { width: 100, councilType: "OBEC" })
    const council: Screen = { kind: "council", kodzastup: "582786" }
    const councilContent = composeScreen(db, council, { width: 100, councilType: "OBEC" })
    const candidates = councilContent.target(0)
    addToWatchlist(db, "582786")
    const borough = districtContent.target(1)
    if (borough?.kind === "council") addToWatchlist(db, borough.kodzastup)
    return [
      ["national", { kind: "national" }, {}],
      ["districts", { kind: "districts" }, {}],
      ["district", district, {}],
      ["council", council, {}],
      ["candidates", candidates ?? council, {}],
      ["watchlist", { kind: "watchlist" }, {}],
      ["search", { kind: "search" }, { query: "brno" }],
      ["help", { kind: "help" }, {}],
    ]
  }

  test("each has a header on element and data rows alternating from bg", async () => {
    for (const [name, screen, options] of screens()) {
      const { state, rows } = await paintRows(screen, TOKYO, options)
      const { header, data } = tableRows(state)
      expect(`${name} header ${header >= 0}`).toBe(`${name} header true`)
      expectRowBg(rows[header], slot(TOKYO, "element"), `${name} header`)
      // The first data row is selected wherever the screen has a selection; skip it.
      const selectedLine = state.content.rowCount > 0 ? state.content.firstRow : -1
      data.slice(0, 6).forEach((index, position) => {
        if (rows[index] === null || index === selectedLine) return
        expectRowBg(rows[index], slot(TOKYO, position % 2 === 1 ? "zebra" : "bg"), `${name} data ${position}`)
      })
    }
  })

  test("and none of them paints any colour under monochrome", async () => {
    for (const [name, screen, options] of screens()) {
      const { rows } = await paintRows(screen, MONOCHROME, options)
      rows.forEach((painted, index) => {
        if (painted === null) return
        const coloured = painted.find((c) => c.bg !== "none")
        expect(`${name} row ${index}: ${coloured === undefined ? "plain" : coloured.bg}`).toBe(
          `${name} row ${index}: plain`,
        )
      })
    }
  })
})

// ---------------------------------------------------------------------------------------
// Chrome (User Story 2, T027-T030).
// ---------------------------------------------------------------------------------------

/** The cells of a line from the first occurrence of `text`, one per character. */
/**
 * A painted line as text. No-break spaces inside figures read as plain spaces, so a test
 * can name a figure as it prints; each is still one cell, so positions are unchanged.
 */
function plainText(line: PaintedCell[]): string {
  return line.map((c) => (c.ch === " " || c.ch === " " ? " " : c.ch)).join("")
}

function cellsAt(line: PaintedCell[] | undefined, text: string): PaintedCell[] {
  const chars = plainText(line ?? [])
  const at = chars.indexOf(text)
  expect(`"${text}" ${at >= 0 ? "found" : `missing from "${chars}"`}`).toBe(`"${text}" found`)
  return (line ?? []).slice(at, at + [...text].length)
}

/** Every cell of a run has these colours; a null foreground is not checked. */
function expectRun(cells: PaintedCell[], fg: string | null, bg: string, bold?: boolean): void {
  for (const c of cells) {
    const shown = (f: string, b: boolean) =>
      `${c.ch}: fg ${fg === null ? "-" : f} bg ${c.bg === bg ? bg : c.bg}${bold === undefined ? "" : ` bold ${b}`}`
    expect(shown(c.fg, c.bold)).toBe(
      `${c.ch}: fg ${fg === null ? "-" : fg} bg ${bg}${bold === undefined ? "" : ` bold ${bold}`}`,
    )
  }
}

const LAST_SUCCESS = "2026-10-09T21:15:03"
const clock = (iso: string) => {
  const d = new Date(iso)
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":")
}

describe("the title bar (T027, FR-011, FR-012)", () => {
  const council: Screen = { kind: "council", kodzastup: "582786" }

  test("reads as joined segments: badge, earlier levels on element, the current level on primary", async () => {
    const { grid } = await paintRows(council, TOKYO, { lastSuccessAt: LAST_SUCCESS })
    const title = grid[0]
    expectRun(cellsAt(title, "◆ VOLBY"), slot(TOKYO, "onAccent"), slot(TOKYO, "accent"), true)
    expectRun(cellsAt(title, "ČR"), slot(TOKYO, "text"), slot(TOKYO, "element"))

    const chars = (title ?? []).map((c) => c.ch).join("")
    const joins = [...chars].map((ch, i) => (ch === "▌" ? i : -1)).filter((i) => i >= 0)
    expect(joins.length).toBeGreaterThanOrEqual(3)
    // The current level is the segment between the last two joins, less its padding.
    const current = (title ?? []).slice((joins.at(-2) as number) + 2, (joins.at(-1) as number) - 1)
    expect(current.length).toBeGreaterThan(0)
    expectRun(current, slot(TOKYO, "onAccent"), slot(TOKYO, "primary"), true)

    // Each join is the left segment's colour drawn over the right segment's background.
    for (const i of joins) {
      const want = `join ${i}: fg ${title?.[i - 1]?.bg} bg ${title?.[i + 1]?.bg}`
      expect(`join ${i}: fg ${title?.[i]?.fg} bg ${title?.[i]?.bg}`).toBe(want)
    }
  })

  test("shows the live indicator and the time of the last successful refresh", async () => {
    const { grid } = await paintRows(council, TOKYO, { lastSuccessAt: LAST_SUCCESS })
    expectRun(cellsAt(grid[0], "● živě"), slot(TOKYO, "success"), slot(TOKYO, "panel"))
    expectRun(cellsAt(grid[0], clock(LAST_SUCCESS)), slot(TOKYO, "muted"), slot(TOKYO, "panel"))
  })

  test("turns the indicator into a warning badge while data is stale (acceptance 2.5)", async () => {
    const { grid } = await paintRows(council, TOKYO, {
      lastSuccessAt: LAST_SUCCESS,
      warning: "! ZASTARALÁ DATA (CZ0642): spojení selhalo.",
    })
    const text = (grid[0] ?? []).map((c) => c.ch).join("")
    expect(text).not.toContain("živě")
    expectRun(cellsAt(grid[0], "● ZASTARALÉ"), slot(TOKYO, "onAccent"), slot(TOKYO, "warning"), true)
  })
})

describe("the status bar (T028, FR-013)", () => {
  test("starts with the screen label, then key chips with their labels, then the theme", async () => {
    const { grid } = await paintRows({ kind: "districts" }, TOKYO)
    const status = grid.at(-1)
    expectRun(cellsAt(status, "OKRESY"), slot(TOKYO, "onAccent"), slot(TOKYO, "primary"), true)
    expectRun(cellsAt(status, "⏎"), slot(TOKYO, "onAccent"), slot(TOKYO, "accent"), true)
    expectRun(cellsAt(status, "otevřít"), slot(TOKYO, "subtle"), slot(TOKYO, "panel"))
    const chars = (status ?? []).map((c) => c.ch).join("")
    expect(chars.trimEnd().endsWith("Tokyo Night")).toBe(true)
    expectRun(cellsAt(status, "Tokyo Night"), slot(TOKYO, "muted"), slot(TOKYO, "panel"))
  })
})

describe("the warning row (T029, FR-014)", () => {
  test("is the warning colour across the full width, its text in onAccent", async () => {
    const warning = "! ZASTARALÁ DATA (CZ0642): spojení selhalo."
    const { grid } = await paintRows({ kind: "districts" }, TOKYO, { warning })
    const row = grid.find((line) =>
      line
        .map((c) => c.ch)
        .join("")
        .includes("ZASTARALÁ DATA"),
    )
    expect(row).toBeDefined()
    expectRun(row ?? [], null, slot(TOKYO, "warning"))
    expectRun(cellsAt(row, "ZASTARALÁ DATA"), slot(TOKYO, "onAccent"), slot(TOKYO, "warning"), true)
  })
})

describe("the scroll bar (T030, research R6)", () => {
  test("its track is the track colour and its thumb the muted colour", async () => {
    const { scrollbar } = await paintRows({ kind: "districts" }, TOKYO)
    expect(scrollbar.length).toBeGreaterThan(0)
    const colours = new Set(scrollbar.flatMap((c) => [c.bg, c.fg]))
    expect(colours.has(slot(TOKYO, "track"))).toBe(true)
    expect(colours.has(slot(TOKYO, "muted"))).toBe(true)
  })
})

describe("bars sit on a track (T053, FR-018, acceptance 4.4)", () => {
  const BLOCKS = new Set(["█", "▉", "▊", "▋", "▌", "▍", "▎", "▏"])

  test("a bar is drawn in the bar colour, and the rest of its column shows the track", async () => {
    const { state, rows } = await paintRows({ kind: "council", kodzastup: "582786" }, TOKYO)
    const { data } = tableRows(state)
    // Row 1 rather than row 0, which is selected.
    const painted = rows[data[1] as number] ?? []
    const filled = painted.map((c, i) => (BLOCKS.has(c.ch) ? i : -1)).filter((i) => i >= 0)
    expect(filled.length).toBeGreaterThan(0)
    for (const i of filled) expect(painted[i]?.fg).toBe(slot(TOKYO, "bar"))
    const after = painted[(filled.at(-1) as number) + 1]
    expect(after?.ch).toBe(" ")
    expect(after?.bg).toBe(slot(TOKYO, "track"))
  })

  test("in monochrome the bar is the same characters and paints nothing", async () => {
    const coloured = await paintRows({ kind: "council", kodzastup: "582786" }, TOKYO)
    const plain = await paintRows({ kind: "council", kodzastup: "582786" }, MONOCHROME)
    // The content rows, not the chrome: the status bar names the theme, and "bez barev"
    // is a different width from "Tokyo Night", so it fits a different number of hints.
    const text = (painted: PaintedRows) => painted.rows.map((r) => (r ?? []).map((c) => c.ch).join(""))
    expect(text(plain)).toEqual(text(coloured))
    expect(plain.rows.flat().some((c) => c !== null && c.bg !== "none")).toBe(false)
  })
})

describe("the national cards (T050, FR-020)", () => {
  test("labels are muted and figures bold on element, with bars in success over the track", async () => {
    const { grid } = await paintRows({ kind: "national" }, TOKYO)
    const line = (text: string) => grid.find((l) => plainText(l).includes(text))
    expectRun(cellsAt(line("SEČTENO OKRSKŮ"), "SEČTENO OKRSKŮ"), slot(TOKYO, "muted"), slot(TOKYO, "element"))
    expectRun(cellsAt(line("14 722 / 14 722"), "14 722 / 14 722"), null, slot(TOKYO, "element"), true)
    // A card's bar block sits on the card; the scroll bar's thumb, on the same line, does not.
    const onCard = (c: PaintedCell) => c.ch === "█" && c.bg === slot(TOKYO, "element")
    const barLine = grid.find((l) => l.some(onCard))
    const block = barLine?.find(onCard)
    expect(block?.fg).toBe(slot(TOKYO, "success"))
    expect(barLine?.some((c) => c.ch === " " && c.bg === slot(TOKYO, "track"))).toBe(true)
  })
})

describe("a theme switch repaints everything at once (T043, FR-027, acceptance 3.3)", () => {
  test("no cell keeps a colour of the theme it left, and the status bar names the new one", async () => {
    const width = 110
    const height = 34
    const setup = await createTestRenderer({ width, height })
    try {
      const frame = new Frame(setup.renderer)
      frame.attach(setup.renderer.root)
      await setup.renderOnce()
      const nav = new Navigation()
      nav.push({ kind: "districts" })
      const draw = async (theme: Theme) => {
        const inputs = {
          db,
          nav,
          councilType: "OBEC",
          query: "",
          theme,
          sort: UNSORTED,
          width,
          contentWidth: frame.contentWidth,
          contentHeight: frame.contentHeight,
          warning: null,
          notice: null,
        }
        applyFrameState(frame, frameState(inputs), theme)
        await setup.renderOnce()
      }

      const tokyo = themeByName("tokyonight")
      const nord = themeByName("nord")
      await draw(tokyo)
      await draw(nord)

      const old = new Set(Object.values(tokyo.slots))
      for (const value of Object.values(nord.slots)) old.delete(value)
      const stale = setup
        .captureSpans()
        .lines.flatMap((line, row) =>
          line.spans
            .filter((s) => old.has(hexOf(s.bg)) || (s.text.trim() !== "" && old.has(hexOf(s.fg))))
            .map((s) => `${row}:"${s.text.trim()}"`),
        )
      expect(stale).toEqual([])
      const status = setup.captureCharFrame().split("\n").at(-2) ?? ""
      expect(status.trimEnd().endsWith("Nord")).toBe(true)
    } finally {
      setup.renderer.destroy()
    }
  })
})
