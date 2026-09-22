/**
 * The framed regions (T119, FR-054) rendered through a real renderer.
 *
 * Asserting on a captured frame is the only honest way to test chrome: a unit test of
 * the layout objects would pass while the terminal showed nothing.
 */

import { describe, expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { Frame } from "../../src/ui/chrome/frame.ts"

interface Rendered {
  frame: string
  lines: string[]
}

async function render(width: number, height: number, setup: (frame: Frame) => void): Promise<Rendered> {
  const test = await createTestRenderer({ width, height })
  try {
    const frame = new Frame(test.renderer)
    frame.attach(test.renderer.root)
    setup(frame)
    await test.renderOnce()
    const captured = test.captureCharFrame()
    return { frame: captured, lines: captured.split("\n") }
  } finally {
    test.renderer.destroy()
  }
}

const BODY_LINES = ["Stav: průběžné výsledky", "ANO 2011   16 752"]

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

  test("the content area is bordered, which is what separates it from the other two", async () => {
    const { lines } = await render(80, 24, (f) => {
      f.setBreadcrumb("ČR")
      f.setRows(BODY_LINES)
      f.setStatus("q konec")
    })

    const top = lines.findIndex((l) => l.includes("┌"))
    const bottom = lines.findIndex((l) => l.includes("└"))
    expect(top).toBeGreaterThanOrEqual(0)
    expect(bottom).toBeGreaterThan(top)

    // The breadcrumb sits ABOVE the border and the status bar BELOW it, so the three
    // regions occupy disjoint rows rather than merely being different objects.
    const crumb = lines.findIndex((l) => l.includes("ČR"))
    const status = lines.findIndex((l) => l.includes("konec"))
    expect(crumb).toBeLessThan(top)
    expect(status).toBeGreaterThan(bottom)
  })

  test("the body content sits inside the border", async () => {
    const { lines } = await render(80, 24, (f) => {
      f.setBreadcrumb("ČR")
      f.setRows(["ANO 2011"])
      f.setStatus("q konec")
    })
    const top = lines.findIndex((l) => l.includes("┌"))
    const bottom = lines.findIndex((l) => l.includes("└"))
    const body = lines.findIndex((l) => l.includes("ANO 2011"))
    expect(body).toBeGreaterThan(top)
    expect(body).toBeLessThan(bottom)
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
      f.setWarning("! ZASTARALÁ DATA (national): spojení selhalo.")
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
    expect(without.frame.split("\n").findIndex((l) => l.includes("┌"))).toBeLessThan(
      with_.frame.split("\n").findIndex((l) => l.includes("┌")),
    )
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
    expect(lines.some((l) => l.includes("┌"))).toBe(true)
    expect(lines.some((l) => l.includes("└"))).toBe(true)
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
      // Chrome costs four rows: breadcrumb, two borders, status bar. Anything more and
      // a council table stops being readable at the documented minimum.
      expect(frame.contentHeight).toBeGreaterThanOrEqual(19)
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
          .filter((l) => l.startsWith("│"))
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
