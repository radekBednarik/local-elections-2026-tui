/**
 * The command palette (T128-T133, FR-065 to FR-069, SC-020).
 *
 * The governing rule is that the palette is COMPLETE: every action the application has
 * appears in it, whether or not it applies here. An action missing from the palette is
 * an action a user cannot discover, which is the failure this screen exists to prevent.
 */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { type RGBA, rgbToHex } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { Frame } from "../../src/ui/chrome/frame.ts"
import type { Screen } from "../../src/ui/navigation.ts"
import { ACTIONS, type ActionContext } from "../../src/ui/palette/actions.ts"
import { entryRow, filterEntries, Palette, paletteEntries } from "../../src/ui/palette/view.ts"
import { line, toTextLines } from "../../src/ui/row.ts"
import { styledRow } from "../../src/ui/theme/apply.ts"
import { MONOCHROME, THEME_NAMES, themeByName, themeLabel } from "../../src/ui/theme/themes.ts"

function ctx(screen: Screen, overrides: Partial<ActionContext> = {}): ActionContext {
  return {
    screen,
    depth: 1,
    rowCount: 0,
    councilTypes: 1,
    searchActive: false,
    sortableColumns: 0,
    ...overrides,
  }
}

const COUNCIL = ctx({ kind: "council", kodzastup: "582786" }, { depth: 3, rowCount: 12 })

describe("completeness (SC-020, FR-065)", () => {
  test("lists every action in the registry", () => {
    expect(paletteEntries(COUNCIL)).toHaveLength(ACTIONS.length + THEME_NAMES.length)
  })

  test("an action added to the registry cannot be unreachable", () => {
    // Asserted against the registry itself rather than a copied list, so a new action
    // appears here automatically and a palette that filtered one out would fail.
    const ids = paletteEntries(COUNCIL).map((e) => e.action.id)
    expect(ids as string[]).toEqual([
      ...ACTIONS.map((a) => a.id),
      ...THEME_NAMES.map((name) => `theme:${name}`),
    ])
  })

  test("the same list appears from every screen", () => {
    const screens: Screen[] = [
      { kind: "national" },
      { kind: "districts" },
      { kind: "help" },
      { kind: "search" },
    ]
    for (const screen of screens) {
      expect(paletteEntries(ctx(screen))).toHaveLength(ACTIONS.length + THEME_NAMES.length)
    }
  })
})

describe("shortcuts are taught, not hidden (FR-066)", () => {
  test("each entry shows its key beside it", () => {
    for (const entry of paletteEntries(COUNCIL)) {
      const text = toTextLines([entryRow(entry, false, 80)])[0] ?? ""
      expect(text).toContain(entry.action.key)
      expect(text).toContain(entry.action.label)
    }
  })
})

describe("unavailable actions are shown with a reason, never hidden (FR-069)", () => {
  test("watching is listed on a district list, marked unavailable", () => {
    const entries = paletteEntries(ctx({ kind: "districts" }, { rowCount: 78 }))
    const watch = entries.find((e) => e.action.id === "watch")
    expect(watch).toBeDefined()
    expect(watch?.available).toBe(false)
    const text = toTextLines([entryRow(watch as never, false, 80)])[0] ?? ""
    expect(text).toContain(`(${watch?.reason})`)
    expect(text).toContain("zastupitelstvo")
  })

  test("an available action carries no reason", () => {
    const entries = paletteEntries(COUNCIL)
    const watch = entries.find((e) => e.action.id === "watch")
    expect(watch?.available).toBe(true)
    expect(toTextLines([entryRow(watch as never, false, 80)])[0]).not.toContain("(")
  })
})

describe("the logs actions (004 FR-007, FR-021, research R8)", () => {
  const LOGS = ctx({ kind: "logs" }, { depth: 2, rowCount: 3 })
  const ENTRY = ctx({ kind: "log-entry", seq: 1 }, { depth: 3 })
  const entry = (context: ActionContext, id: string) =>
    paletteEntries(context).find((e) => e.action.id === id)

  test("the logs view can be opened from any other screen", () => {
    for (const context of [ctx({ kind: "national" }), COUNCIL, ctx({ kind: "help" }, { depth: 2 })]) {
      expect(entry(context, "logs")?.available).toBe(true)
    }
  })

  test("it is listed but unavailable, with the reason, while the logs are open", () => {
    for (const context of [LOGS, ENTRY]) {
      const logs = entry(context, "logs")
      expect(logs?.available).toBe(false)
      expect(logs?.reason).toBe("záznamy jsou právě otevřené")
    }
  })

  test("the list opens an entry; the detail has nothing to open", () => {
    expect(entry(LOGS, "open")?.available).toBe(true)
    expect(entry(ENTRY, "open")?.available).toBe(false)
  })
})

describe("filtering folds case and diacritics (FR-067)", () => {
  const all = paletteEntries(COUNCIL)

  test("finds an action written without diacritics", () => {
    const hits = filterEntries(all, "napoveda")
    expect(hits.map((e) => e.action.id)).toContain("help")
  })

  test("finds it written with them", () => {
    expect(filterEntries(all, "nápověda").map((e) => e.action.id)).toContain("help")
  })

  test("ignores case", () => {
    expect(filterEntries(all, "NÁPOVĚDA").map((e) => e.action.id)).toContain("help")
  })

  test("matches on the key too, for someone who remembers the shortcut", () => {
    expect(filterEntries(all, "ctrl+b").map((e) => e.action.id)).toContain("side-panel")
  })

  test("an empty query narrows nothing", () => {
    expect(filterEntries(all, "   ")).toHaveLength(all.length)
  })

  test("a query that matches nothing returns nothing rather than everything", () => {
    expect(filterEntries(all, "zzzzz")).toHaveLength(0)
  })

  test("narrowing keeps unavailable actions, so they stay discoverable", () => {
    const districts = paletteEntries(ctx({ kind: "districts" }, { rowCount: 78 }))
    const hits = filterEntries(districts, "sledovan")
    expect(hits.some((e) => !e.available)).toBe(true)
  })
})

describe("the rendered palette", () => {
  async function open(context: ActionContext) {
    const setup = await createTestRenderer({ width: 90, height: 24 })
    const palette = new Palette(setup.renderer)
    setup.renderer.root.add(palette.root)
    palette.show(context)
    await setup.renderOnce()
    return { setup, palette }
  }

  test("shows the actions with their keys", async () => {
    const { setup, palette } = await open(COUNCIL)
    try {
      const frame = setup.captureCharFrame()
      expect(frame).toContain("Příkazy")
      expect(frame).toContain("Ctrl+P")
      expect(frame).toContain("Hledat")
    } finally {
      palette.destroy()
      setup.renderer.destroy()
    }
  })

  test("the highlighted entry is the one that runs", async () => {
    const { setup, palette } = await open(COUNCIL)
    try {
      expect(palette.current?.action.id).toBe(ACTIONS[0]?.id)
      palette.move(2)
      expect(palette.current?.action.id).toBe(ACTIONS[2]?.id)
      // Movement is clamped, not wrapped: the list has ends and the user should feel them.
      palette.move(-99)
      expect(palette.current?.action.id).toBe(ACTIONS[0]?.id)
      palette.move(999)
      // The list ends with the per-theme entries, after the registry (002 FR-005).
      expect(palette.current?.action.id).toBe("theme:high-contrast")
    } finally {
      palette.destroy()
      setup.renderer.destroy()
    }
  })

  test("an unavailable entry is highlighted but does not run (FR-069)", async () => {
    const districts = ctx({ kind: "districts" }, { rowCount: 78 })
    const { setup, palette } = await open(districts)
    try {
      const watchIndex = paletteEntries(districts).findIndex((e) => e.action.id === "watch")
      palette.move(watchIndex)
      expect(palette.current?.action.id).toBe("watch")
      expect(palette.current?.available).toBe(false)
      expect(palette.chosen()).toBeNull()
    } finally {
      palette.destroy()
      setup.renderer.destroy()
    }
  })

  test("closing hides it entirely, leaving the screen to the content", async () => {
    const { setup, palette } = await open(COUNCIL)
    try {
      palette.hide()
      await setup.renderOnce()
      expect(palette.open).toBe(false)
      expect(setup.captureCharFrame()).not.toContain("Příkazy")
    } finally {
      palette.destroy()
      setup.renderer.destroy()
    }
  })
})

describe("choosing performs the action, and Esc changes nothing (FR-068)", () => {
  test("the chosen action is the same one its key performs", () => {
    // The palette does not carry its own implementation of anything. It yields an
    // action id, and the key for that action yields the same id, so both arrive at the
    // same branch of App.perform.
    for (const action of ACTIONS) {
      const entry = paletteEntries(COUNCIL).find((e) => e.action.id === action.id)
      expect(entry?.action.id).toBe(action.id)
    }
  })

  test("a key and a palette entry reach one implementation, not two", () => {
    // Structural: App routes both through perform(), and there is no second place where
    // an action is carried out.
    const source = readFileSync(join(import.meta.dir, "../../src/ui/app.ts"), "utf8")
    const definitions = source.match(/private async perform\(/g) ?? []
    expect(definitions).toHaveLength(1)
    // Called from the key handler and from the palette handler, and nowhere else.
    const calls = source.match(/this\.perform\(/g) ?? []
    expect(calls).toHaveLength(2)
  })

  test("the palette cannot move the user, so Esc returns to exactly where they were", () => {
    // It holds no navigation state at all: closing it can only reveal what was behind.
    const source = readFileSync(join(import.meta.dir, "../../src/ui/palette/view.ts"), "utf8")
    expect(source).not.toContain("Navigation")
    expect(source).not.toContain("nav.")
  })

  test("an unavailable entry yields nothing to perform", () => {
    const districts = ctx({ kind: "districts" }, { rowCount: 78 })
    const watch = paletteEntries(districts).find((e) => e.action.id === "watch")
    expect(watch?.available).toBe(false)
  })
})

describe("the palette over dimmed content (002 T031, FR-024, research R7)", () => {
  const TOKYO = themeByName("tokyonight")
  const hexOf = (colour: RGBA) => (colour.a === 0 ? "none" : rgbToHex(colour))
  const channels = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))

  async function openOver(context: ActionContext) {
    const setup = await createTestRenderer({ width: 100, height: 30 })
    const frame = new Frame(setup.renderer)
    frame.attach(setup.renderer.root)
    frame.applyTheme(TOKYO)
    const rows = Array.from({ length: 40 }, (_, i) => `obsah řádek ${i}`)
    frame.setRows(rows, (i) => styledRow(line(rows[i] ?? ""), TOKYO, 90, "  ", undefined, "zebra", 97))
    const palette = new Palette(setup.renderer)
    frame.attachOverlay(palette.root)
    palette.applyTheme(TOKYO)
    // Twice: the scroll bar thumb settles by half a cell after the first frame, which has
    // nothing to do with the palette and would otherwise read as a difference.
    await setup.renderOnce()
    await setup.renderOnce()
    const beforeGrid = cellsOf(setup)
    palette.show(context)
    await setup.renderOnce()
    return { setup, frame, palette, beforeGrid }
  }

  /** The column, in display cells, at which `text` starts in `line`. */
  function column(line: string | undefined, text: string, last = false): number {
    const source = line ?? ""
    const at = last ? source.lastIndexOf(text) : source.indexOf(text)
    return at < 0 ? -1 : [...source.slice(0, at)].length
  }

  function cellsOf(setup: Awaited<ReturnType<typeof createTestRenderer>>) {
    return setup
      .captureSpans()
      .lines.map((line) =>
        line.spans.flatMap((span) =>
          [...span.text].map((ch) => ({ ch, fg: hexOf(span.fg), bg: hexOf(span.bg) })),
        ),
      )
  }

  test("the content stays visible beneath, blended toward the panel tone", async () => {
    const { setup, frame, palette, beforeGrid } = await openOver(COUNCIL)
    try {
      const grid = cellsOf(setup)
      const text = setup.captureCharFrame()
      expect(text).toContain("obsah řádek")
      // A content cell left of the palette box, on a zebra row.
      const row = frame.rows[2]
      const x = (row?.x ?? 0) + 2
      const y = row?.y ?? 0
      const before = channels(beforeGrid[y]?.[x]?.bg ?? "#000000")
      const after = channels(grid[y]?.[x]?.bg ?? "#000000")
      const panel = channels(TOKYO.slots.panel ?? "#000000")
      expect(before).toEqual(channels(TOKYO.slots.zebra ?? ""))
      after.forEach((value, i) => {
        const lo = Math.min(before[i] ?? 0, panel[i] ?? 0)
        const hi = Math.max(before[i] ?? 0, panel[i] ?? 0)
        expect(value).toBeGreaterThanOrEqual(lo)
        expect(value).toBeLessThanOrEqual(hi)
      })
      expect(after).not.toEqual(before)
    } finally {
      palette.destroy()
      setup.renderer.destroy()
    }
  })

  test("sits in a rounded frame in the active border colour, on element", async () => {
    const { setup, palette } = await openOver(COUNCIL)
    try {
      const text = setup.captureCharFrame()
      expect(text).toContain("╭")
      expect(text).toContain("Příkazy")
      const grid = cellsOf(setup)
      const y = text.split("\n").findIndex((l) => l.includes("╭"))
      const x = [...(text.split("\n")[y] ?? "")].indexOf("╭")
      expect(grid[y]?.[x]?.fg).toBe(TOKYO.slots.borderActive ?? "")
      // The row under the search field is the box itself, clear of the field and the entries.
      expect(grid[y + 2]?.[x + 1]?.bg).toBe(TOKYO.slots.element ?? "")
    } finally {
      palette.destroy()
      setup.renderer.destroy()
    }
  })

  test("the search line is › in accent, and the highlighted entry is sel with its key as a chip", async () => {
    const { setup, palette } = await openOver(COUNCIL)
    try {
      const text = setup.captureCharFrame().split("\n")
      const grid = cellsOf(setup)
      const search = text.findIndex((l) => l.includes("›"))
      expect(search).toBeGreaterThan(0)
      const at = [...(text[search] ?? "")].indexOf("›")
      expect(grid[search]?.[at]?.fg).toBe(TOKYO.slots.accent ?? "")

      const label = palette.current?.action.label ?? ""
      const y = text.findIndex((l) => l.includes(label))
      const x = column(text[y], label)
      expect(grid[y]?.[x]?.bg).toBe(TOKYO.slots.sel ?? "")
      const key = palette.current?.action.key ?? ""
      const kx = column(text[y], key, true)
      expect(grid[y]?.[kx]?.bg).toBe(TOKYO.slots.accent ?? "")
      expect(grid[y]?.[kx]?.fg).toBe(TOKYO.slots.onAccent ?? "")
    } finally {
      palette.destroy()
      setup.renderer.destroy()
    }
  })

  test("an unavailable entry shows its reason in muted", async () => {
    const districts = ctx({ kind: "districts" }, { rowCount: 78 })
    const { setup, palette } = await openOver(districts)
    try {
      const watch = paletteEntries(districts).find((e) => e.action.id === "watch")
      const reason = `(${watch?.reason ?? ""})`
      const text = setup.captureCharFrame().split("\n")
      const y = text.findIndex((l) => l.includes(reason))
      expect(y).toBeGreaterThan(0)
      const x = column(text[y], reason)
      expect(cellsOf(setup)[y]?.[x + 1]?.fg).toBe(TOKYO.slots.muted ?? "")
    } finally {
      palette.destroy()
      setup.renderer.destroy()
    }
  })

  test("closing it leaves the content exactly as it was", async () => {
    const { setup, frame, palette, beforeGrid } = await openOver(COUNCIL)
    try {
      palette.hide()
      await setup.renderOnce()
      expect(cellsOf(setup)).toEqual(beforeGrid)
      expect(frame.body.visible).toBe(true)
    } finally {
      palette.destroy()
      setup.renderer.destroy()
    }
  })
})

describe("the palette in monochrome (FR-008)", () => {
  // Nothing may be painted, and a space drawn with no background does not clear the
  // character beneath it, so a dimming layer cannot hide the content. The content is
  // withheld while the palette is open instead, as it was before the refresh.
  test("no content shows through the palette, and all of it returns on close", async () => {
    const setup = await createTestRenderer({ width: 100, height: 30 })
    const frame = new Frame(setup.renderer)
    frame.attach(setup.renderer.root)
    frame.applyTheme(MONOCHROME)
    frame.setRows(Array.from({ length: 40 }, () => "X".repeat(96)))
    const palette = new Palette(setup.renderer)
    frame.attachOverlay(palette.root)
    palette.applyTheme(MONOCHROME)
    try {
      await setup.renderOnce()
      frame.setContentHidden(true)
      palette.show(COUNCIL)
      await setup.renderOnce()
      expect(setup.captureCharFrame()).not.toContain("X")

      palette.hide()
      frame.setContentHidden(false)
      await setup.renderOnce()
      expect(setup.captureCharFrame()).toContain("X".repeat(90))
    } finally {
      palette.destroy()
      setup.renderer.destroy()
    }
  })
})

describe("choosing a theme by name (002 T042, FR-005)", () => {
  const withTheme = ctx({ kind: "districts" }, { rowCount: 78, activeTheme: "tokyonight" })

  test("offers one entry per theme, labelled with its name and reached by Ctrl+T", () => {
    const themes = paletteEntries(withTheme).filter((e) => e.action.id.startsWith("theme:"))
    expect(themes.map((e) => e.action.label)).toEqual(THEME_NAMES.map((name) => `Motiv: ${themeLabel(name)}`))
    for (const entry of themes) expect(entry.action.key).toBe("Ctrl+T")
  })

  test("the active theme is listed but unavailable, with the reason", () => {
    const active = paletteEntries(withTheme).find((e) => e.action.id === "theme:tokyonight")
    expect(active?.available).toBe(false)
    expect(active?.reason).toBe("tento motiv je aktivní")
    const other = paletteEntries(withTheme).find((e) => e.action.id === "theme:nord")
    expect(other?.available).toBe(true)
  })

  test("typing the theme name narrows the list to it, diacritics and case folded", () => {
    const found = filterEntries(paletteEntries(withTheme), "motiv nord")
    expect(found.map((e) => e.action.id)).toEqual(["theme:nord"])
  })

  test("the themes do not crowd the status bar or the help screen: they live in the palette", () => {
    expect(ACTIONS.some((a) => a.id.startsWith("theme:"))).toBe(false)
  })
})
