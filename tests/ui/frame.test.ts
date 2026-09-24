/**
 * The framed regions (T119, FR-054; 002 T024, FR-009, FR-010) rendered through a real
 * renderer.
 *
 * Asserting on a captured frame is the only honest way to test chrome: a unit test of
 * the layout objects would pass while the terminal showed nothing.
 *
 * Since the visual refresh the content area is no longer boxed on four sides. Each
 * region sits on its own surface, and the content carries a heavy rail down its left
 * edge (002 research R5). The regions are told apart by surface and rail, which is what
 * these tests measure.
 */

import { describe, expect, test } from "bun:test"
import { type RGBA, rgbToHex } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { Frame } from "../../src/ui/chrome/frame.ts"
import { titleBarRow } from "../../src/ui/chrome/state.ts"
import { cellsWide } from "../../src/ui/row.ts"
import { MONOCHROME, type Theme, themeByName } from "../../src/ui/theme/themes.ts"

interface Rendered {
  frame: string
  lines: string[]
  /** Background of every cell, by line, as "#rrggbb" or "none". */
  bgs: string[][]
  /** Foreground of every cell, by line. */
  fgs: string[][]
  contentHeight: number
  contentWidth: number
  rawContentWidth: number
  bodyHeight: number
  bodyWidth: number
}

const hexOf = (colour: RGBA): string => (colour.a === 0 ? "none" : rgbToHex(colour))

async function render(
  width: number,
  height: number,
  setup: (frame: Frame) => void,
  theme?: Theme,
): Promise<Rendered> {
  const test = await createTestRenderer({ width, height })
  try {
    const frame = new Frame(test.renderer)
    frame.attach(test.renderer.root)
    if (theme !== undefined) frame.applyTheme(theme)
    setup(frame)
    await test.renderOnce()
    const captured = test.captureCharFrame()
    const spans = test.captureSpans().lines
    const cells = (pick: (colour: { fg: RGBA; bg: RGBA }) => RGBA) =>
      spans.map((line) => line.spans.flatMap((span) => [...span.text].map(() => hexOf(pick(span)))))
    return {
      frame: captured,
      lines: captured.split("\n"),
      bgs: cells((s) => s.bg),
      fgs: cells((s) => s.fg),
      contentHeight: frame.contentHeight,
      contentWidth: frame.contentWidth,
      rawContentWidth: frame.rawContentWidth,
      bodyHeight: frame.body.height,
      bodyWidth: frame.body.width,
    }
  } finally {
    test.renderer.destroy()
  }
}

const BODY_LINES = ["Stav: průběžné výsledky", "ANO 2011   16 752"]
const RAIL = "┃"

/** Lines whose first character is the content rail. */
const railLines = (lines: string[]) =>
  lines.map((l, i) => ([...l][0] === RAIL ? i : -1)).filter((i) => i >= 0)

describe("three regions (FR-054)", () => {
  test("the title bar, the content area and the status bar are all present", async () => {
    const { frame } = await render(80, 24, (f) => {
      f.setBreadcrumb("ČR › Okres Brno-město › Brno-Bohunice")
      f.setRows(BODY_LINES)
      f.setStatus("↑↓ výběr   ⏎ otevřít   esc zpět")
    })

    expect(frame).toContain("Brno-Bohunice")
    expect(frame).toContain("Stav: průběžné výsledky")
    expect(frame).toContain("otevřít")
  })

  test("the content area carries a rail, and the bars sit above and below it", async () => {
    const { lines } = await render(80, 24, (f) => {
      f.setBreadcrumb("ČR")
      f.setRows(BODY_LINES)
      f.setStatus("q konec")
    })

    const rail = railLines(lines)
    expect(rail.length).toBeGreaterThan(0)
    // The rail is unbroken from the first content row to the last.
    expect((rail.at(-1) ?? -1) - (rail[0] ?? -1) + 1).toBe(rail.length)

    // The breadcrumb sits ABOVE the content and the status bar BELOW it, so the three
    // regions occupy disjoint rows rather than merely being different objects.
    const crumb = lines.findIndex((l) => l.includes("ČR"))
    const status = lines.findIndex((l) => l.includes("konec"))
    expect(crumb).toBeLessThan(rail[0] ?? -1)
    expect(status).toBeGreaterThan(rail.at(-1) ?? -1)
  })

  test("the body content sits beside the rail, inside the content area", async () => {
    const { lines } = await render(80, 24, (f) => {
      f.setBreadcrumb("ČR")
      f.setRows(["ANO 2011"])
      f.setStatus("q konec")
    })
    const rail = railLines(lines)
    const body = lines.findIndex((l) => l.includes("ANO 2011"))
    expect(body).toBeGreaterThan(rail[0] ?? -1)
    expect(body).toBeLessThanOrEqual(rail.at(-1) ?? -1)
    expect([...(lines[body] ?? "")][0]).toBe(RAIL)
  })
})

describe("surfaces (002 T024, FR-009, FR-010)", () => {
  const TOKYO = themeByName("tokyonight")

  test("at 80 by 24 the title bar and status bar are panel, the content bg", async () => {
    const { bgs } = await render(
      80,
      24,
      (f) => {
        f.setBreadcrumb("ČR")
        f.setRows(BODY_LINES)
        f.setStatus("q konec")
      },
      TOKYO,
    )
    for (const row of [0, 23]) {
      const wrong = (bgs[row] ?? []).findIndex((bg) => bg !== TOKYO.slots.panel)
      expect(`row ${row}: ${wrong === -1 ? "panel" : `column ${wrong} is ${(bgs[row] ?? [])[wrong]}`}`).toBe(
        `row ${row}: panel`,
      )
    }
    for (let row = 1; row < 23; row++) {
      for (let column = 0; column < 79; column++) {
        const bg = (bgs[row] ?? [])[column]
        expect(`${row},${column}: ${bg === TOKYO.slots.bg ? "bg" : bg}`).toBe(`${row},${column}: bg`)
      }
    }
  })

  test("the rail runs down column 0 in the primary colour", async () => {
    const { lines, fgs } = await render(
      80,
      24,
      (f) => {
        f.setBreadcrumb("ČR")
        f.setRows(BODY_LINES)
        f.setStatus("q konec")
      },
      TOKYO,
    )
    for (let row = 1; row < 23; row++) {
      expect(`${row}: ${[...(lines[row] ?? "")][0]} ${(fgs[row] ?? [])[0]}`).toBe(
        `${row}: ${RAIL} ${TOKYO.slots.primary}`,
      )
    }
  })

  test("the side panel sits on panel behind an accent rail, apart from the content (SC-002)", async () => {
    const { lines, bgs, fgs } = await render(
      120,
      30,
      (f) => {
        f.setBreadcrumb("ČR")
        f.setRows(BODY_LINES)
        f.setStatus("q konec")
        f.setPanelVisible(true)
        f.setPanelContent("SLEDOVANÉ")
      },
      TOKYO,
    )
    const row = 5
    const panelRail = [...(lines[row] ?? "")].lastIndexOf(RAIL)
    expect(panelRail).toBeGreaterThan(0)
    expect((fgs[row] ?? [])[panelRail]).toBe(TOKYO.slots.accent ?? "")
    expect((bgs[row] ?? [])[panelRail + 1]).toBe(TOKYO.slots.panel ?? "")
    expect(TOKYO.slots.panel).not.toBe(TOKYO.slots.bg)
  })

  test("no cell of the terminal is left unpainted", async () => {
    const { bgs } = await render(
      100,
      30,
      (f) => {
        f.setBreadcrumb("ČR")
        f.setRows(BODY_LINES)
        f.setStatus("q konec")
      },
      TOKYO,
    )
    const unpainted = bgs.flatMap((line, row) =>
      line.map((bg, column) => (bg === "none" ? `${row},${column}` : "")),
    )
    expect(unpainted.filter((c) => c !== "")).toEqual([])
  })

  test("monochrome paints no surface at all", async () => {
    const { bgs } = await render(
      80,
      24,
      (f) => {
        f.setBreadcrumb("ČR")
        f.setRows(BODY_LINES)
        f.setStatus("q konec")
      },
      MONOCHROME,
    )
    // Column 79 is the scroll bar. Its thumb has to be drawn in some colour to be seen at
    // all, so it keeps OpenTUI's own grey, as it always has; everything else is unpainted.
    const painted = bgs.flatMap((line, row) =>
      line
        .map((bg, column) => (bg !== "none" && column !== 79 ? `${row},${column}` : ""))
        .filter((c) => c !== ""),
    )
    expect(painted).toEqual([])
  })

  test("the content metrics account for the rail, the scroll bar and the top padding", async () => {
    const r = await render(80, 24, (f) => {
      f.setBreadcrumb("ČR")
      f.setRows(BODY_LINES)
      f.setStatus("q konec")
    })
    expect(r.contentHeight).toBe(r.bodyHeight - 1)
    expect(r.rawContentWidth).toBe(r.bodyWidth - 2)
  })
})

describe("the warning row (FR-044)", () => {
  test("appears only when there is a warning", async () => {
    const without = await render(80, 24, (f) => {
      f.setBreadcrumb("ČR")
      f.setRows(BODY_LINES)
      f.setStatus("q konec")
      f.setWarning(null)
    })
    expect(without.frame).not.toContain("ZASTARALÁ")

    const with_ = await render(80, 24, (f) => {
      f.setBreadcrumb("ČR")
      f.setRows(BODY_LINES)
      f.setStatus("q konec")
      f.setWarning("! ZASTARALÁ DATA: zobrazena data před 4 min. Obnovení se nedaří. · l záznamy")
    })
    expect(with_.frame).toContain("ZASTARALÁ DATA")
  })

  test("costs no row when absent, so the content keeps it", async () => {
    const without = await render(80, 24, (f) => {
      f.setBreadcrumb("ČR")
      f.setRows(BODY_LINES)
      f.setStatus("q konec")
    })
    const with_ = await render(80, 24, (f) => {
      f.setBreadcrumb("ČR")
      f.setRows(BODY_LINES)
      f.setStatus("q konec")
      f.setWarning("! ZASTARALÁ DATA")
    })
    expect(railLines(without.lines)[0] ?? -1).toBeLessThan(railLines(with_.lines)[0] ?? -1)
  })
})

describe("the minimum terminal (FR-041, T124)", () => {
  test("every region still fits at 80 by 24", async () => {
    const { lines } = await render(80, 24, (f) => {
      f.setBreadcrumb("ČR › Okresy › Okres Brno-město › Brno-Bohunice")
      f.setRows(Array.from({ length: 60 }, (_, i) => `řádek ${i}`))
      f.setStatus("↑↓ výběr   ⏎ otevřít   esc zpět   q konec")
    })

    expect(lines.some((l) => l.includes("Brno-Bohunice"))).toBe(true)
    expect(railLines(lines).length).toBeGreaterThan(0)
    expect(lines.some((l) => l.includes("konec"))).toBe(true)
    // And nothing overflows the width.
    for (const line of lines) expect([...line].length).toBeLessThanOrEqual(80)
  })

  test("the content area keeps a usable number of rows at the minimum height", async () => {
    const test = await createTestRenderer({ width: 80, height: 24 })
    try {
      const frame = new Frame(test.renderer)
      frame.attach(test.renderer.root)
      frame.setBreadcrumb("ČR")
      frame.setStatus("q konec")
      frame.setRows(["a"])
      await test.renderOnce()
      // Chrome costs three rows: breadcrumb, the padding above the content, status bar.
      // One fewer than the four-sided box it replaced cost.
      expect(frame.contentHeight).toBeGreaterThanOrEqual(21)
    } finally {
      test.renderer.destroy()
    }
  })
})

describe("the scroll bar stays on the right edge", () => {
  // It did not. Going from a long list to a short screen and back again - the district
  // list, then one district, then a council - hid the bar and showed it again, and it
  // came back laid out down the LEFT of the content, over the first character of every
  // row. Pinning it visible keeps it on one edge and keeps the content width steady.
  test("through a long screen, a short one, and a long one again", async () => {
    const test = await createTestRenderer({ width: 40, height: 12 })
    try {
      const frame = new Frame(test.renderer)
      frame.attach(test.renderer.root)
      frame.setBreadcrumb("ČR")
      frame.setStatus("q konec")

      for (const count of [82, 7, 27, 3, 40]) {
        frame.setRows(Array.from({ length: count }, (_, i) => `  řádek ${i}`))
        await test.renderOnce()
        const body = test
          .captureCharFrame()
          .split("\n")
          .filter((l) => l.startsWith(RAIL))
        expect(body.length).toBeGreaterThan(0)
        for (const line of body) {
          // Column 1 is the first content column. Nothing but the row text belongs there.
          expect([...line][1]).not.toBe("▀")
          expect([...line][1]).not.toBe("█")
        }
      }
    } finally {
      test.renderer.destroy()
    }
  })
})

describe("title bar indicator (contract § 2)", () => {
  const trail = ["ČR", "Okres Brno-město", "Brno", "Kandidáti"]
  const text = (indicator: "live" | "final" | "stale" | "awaiting") =>
    titleBarRow(trail, indicator, "2026-10-09T21:15:00.000Z", 120)
      .cells.map((c) => c.text)
      .join("")

  test("says the results are final and refresh is manual, without the live claim", () => {
    expect(text("final")).toContain(" ■ konečné · obnova ručně ")
    expect(text("final")).not.toContain("živě")
  })

  test("still says live while counting, and stale while failing", () => {
    expect(text("live")).toContain(" ● živě ")
    expect(text("stale")).toContain(" ● ZASTARALÉ ")
  })

  test("says it is waiting for results before anything has loaded, in muted text (004 FR-001)", () => {
    expect(text("awaiting")).toContain(" ○ čeká na výsledky ")
    expect(text("awaiting")).not.toContain("ZASTARALÉ")
    expect(text("awaiting")).not.toContain("živě")
    const cell = titleBarRow(trail, "awaiting", null, 120).cells.find((c) => c.text.includes("čeká"))
    expect(cell?.role).toBe("muted")
    expect(cell?.surface).toBeUndefined()
  })

  test("fits 80 columns exactly with the final indicator intact", () => {
    const row = titleBarRow(trail, "final", "2026-10-09T21:15:00.000Z", 80)
    expect(cellsWide(row.cells)).toBe(80)
    expect(row.cells.map((c) => c.text).join("")).toContain(" ■ konečné · obnova ručně ")
  })

  test("draws the final indicator as muted text on no surface of its own", () => {
    const cell = titleBarRow(trail, "final", null, 120).cells.find((c) => c.text.includes("konečné"))
    expect(cell?.role).toBe("muted")
    expect(cell?.surface).toBeUndefined()
  })
})
