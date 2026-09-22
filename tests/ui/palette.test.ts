/**
 * The command palette (T128-T133, FR-065 to FR-069, SC-020).
 *
 * The governing rule is that the palette is COMPLETE: every action the application has
 * appears in it, whether or not it applies here. An action missing from the palette is
 * an action a user cannot discover, which is the failure this screen exists to prevent.
 */

import { describe, expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import type { Screen } from "../../src/ui/navigation.ts"
import { ACTIONS, type ActionContext } from "../../src/ui/palette/actions.ts"
import {
  entryDescription,
  entryLabel,
  filterEntries,
  Palette,
  paletteEntries,
} from "../../src/ui/palette/view.ts"

function ctx(screen: Screen, overrides: Partial<ActionContext> = {}): ActionContext {
  return { screen, depth: 1, rowCount: 0, councilTypes: 1, searchActive: false, ...overrides }
}

const COUNCIL = ctx({ kind: "council", kodzastup: "582786" }, { depth: 3, rowCount: 12 })

describe("completeness (SC-020, FR-065)", () => {
  test("lists every action in the registry", () => {
    expect(paletteEntries(COUNCIL)).toHaveLength(ACTIONS.length)
  })

  test("an action added to the registry cannot be unreachable", () => {
    // Asserted against the registry itself rather than a copied list, so a new action
    // appears here automatically and a palette that filtered one out would fail.
    const ids = paletteEntries(COUNCIL).map((e) => e.action.id)
    expect(ids).toEqual(ACTIONS.map((a) => a.id))
  })

  test("the same list appears from every screen", () => {
    const screens: Screen[] = [
      { kind: "national" },
      { kind: "districts" },
      { kind: "help" },
      { kind: "search" },
    ]
    for (const screen of screens) {
      expect(paletteEntries(ctx(screen))).toHaveLength(ACTIONS.length)
    }
  })
})

describe("shortcuts are taught, not hidden (FR-066)", () => {
  test("each entry shows its key beside it", () => {
    for (const entry of paletteEntries(COUNCIL)) {
      expect(entryLabel(entry)).toContain(entry.action.key)
      expect(entryLabel(entry)).toContain(entry.action.label)
    }
  })
})

describe("unavailable actions are shown with a reason, never hidden (FR-069)", () => {
  test("watching is listed on a district list, marked unavailable", () => {
    const entries = paletteEntries(ctx({ kind: "districts" }, { rowCount: 78 }))
    const watch = entries.find((e) => e.action.id === "watch")
    expect(watch).toBeDefined()
    expect(watch?.available).toBe(false)
    expect(entryDescription(watch as never)).toContain("zastupitelstvo")
  })

  test("an available action carries no reason", () => {
    const entries = paletteEntries(COUNCIL)
    const watch = entries.find((e) => e.action.id === "watch")
    expect(watch?.available).toBe(true)
    expect(entryDescription(watch as never)).toBe("")
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
      expect(palette.current?.action.id).toBe(ACTIONS[ACTIONS.length - 1]?.id)
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
