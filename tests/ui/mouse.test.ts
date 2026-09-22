/**
 * Mouse (T156-T160, FR-075 to FR-079).
 *
 * READ THE LIMIT OF THIS FILE FIRST. `createTestRenderer` uses a MOCK input, so nothing
 * here can tell you whether mouse reporting in a real terminal has taken the terminal's
 * own text selection away. FR-077 - Shift-drag still selects and copies - is checked by
 * hand on Windows Terminal and a Linux terminal, as quickstart V18 (T161) sets out. A
 * green run of this file is not evidence about FR-077.
 *
 * What IS asserted here: that a click reaches the right row, that chrome is not
 * clickable, and that everything the mouse can do a key can do too.
 */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createTestRenderer } from "@opentui/core/testing"
import { Frame } from "../../src/ui/chrome/frame.ts"
import { intentFor } from "../../src/ui/keymap.ts"
import { ACTIONS } from "../../src/ui/palette/actions.ts"
import type { KeyEvent } from "../../src/ui/search-input.ts"

interface Harness {
  frame: Frame
  clicks: number[]
  scrolls: string[]
  setup: Awaited<ReturnType<typeof createTestRenderer>>
}

async function harness(rows = 12): Promise<Harness> {
  const setup = await createTestRenderer({ width: 60, height: 20 })
  const frame = new Frame(setup.renderer)
  frame.attach(setup.renderer.root)

  const clicks: number[] = []
  const scrolls: string[] = []
  frame.setRowHandler((index) => {
    clicks.push(index)
  })
  frame.scroll.onMouseScroll = (event) => {
    if (event.scroll !== undefined) scrolls.push(event.scroll.direction)
  }

  frame.setBreadcrumb("ČR › Okresy")
  frame.setStatus("↑↓ výběr   q konec")
  frame.setRows(Array.from({ length: rows }, (_, i) => `  řádek ${i}`))
  await setup.renderOnce()
  return { frame, clicks, scrolls, setup }
}

/** The screen row a given content row is drawn on: breadcrumb, then the top border. */
const screenRowFor = (contentRow: number) => contentRow + 2

describe("clicking a row selects it (FR-075, T156)", () => {
  test("the click reaches the row that was clicked, not a neighbour", async () => {
    const h = await harness()
    try {
      await h.setup.mockMouse.click(5, screenRowFor(3))
      expect(h.clicks).toEqual([3])

      await h.setup.mockMouse.click(5, screenRowFor(7))
      expect(h.clicks).toEqual([3, 7])
    } finally {
      h.setup.renderer.destroy()
    }
  })

  test("a double click reaches the same row twice, which is what opens it (T157)", async () => {
    const h = await harness()
    try {
      await h.setup.mockMouse.doubleClick(5, screenRowFor(2))
      expect(h.clicks.length).toBeGreaterThanOrEqual(2)
      expect(new Set(h.clicks)).toEqual(new Set([2]))
    } finally {
      h.setup.renderer.destroy()
    }
  })
})

describe("the wheel scrolls the content area (FR-076, T158)", () => {
  test("a wheel event over the content is delivered with its direction", async () => {
    const h = await harness(80)
    try {
      await h.setup.mockMouse.scroll(5, screenRowFor(4), "down")
      expect(h.scrolls).toContain("down")
      await h.setup.mockMouse.scroll(5, screenRowFor(4), "up")
      expect(h.scrolls).toContain("up")
    } finally {
      h.setup.renderer.destroy()
    }
  })
})

describe("the chrome is NOT clickable (FR-079, T160)", () => {
  // No status-bar buttons, no clickable breadcrumb, no context menus, no draggable
  // dividers. A terminal interface that grows clickable chrome starts owing the user a
  // mouse, and FR-078 says it never may.
  test("clicking the breadcrumb does nothing", async () => {
    const h = await harness()
    try {
      await h.setup.mockMouse.click(5, 0)
      expect(h.clicks).toEqual([])
    } finally {
      h.setup.renderer.destroy()
    }
  })

  test("clicking the status bar does nothing", async () => {
    const h = await harness()
    try {
      await h.setup.mockMouse.click(5, 19)
      expect(h.clicks).toEqual([])
    } finally {
      h.setup.renderer.destroy()
    }
  })

  test("clicking the border does nothing", async () => {
    const h = await harness()
    try {
      await h.setup.mockMouse.click(0, 1)
      expect(h.clicks).toEqual([])
    } finally {
      h.setup.renderer.destroy()
    }
  })

  test("only content rows are given a mouse handler at all", () => {
    // Structural, and deliberately so. The three tests above prove today's chrome is
    // inert; this one says there is exactly one place in the frame where a mouse handler
    // is attached, so growing a clickable status bar would be a visible change rather
    // than a quiet one.
    const source = readFileSync(join(import.meta.dir, "../../src/ui/chrome/frame.ts"), "utf8")
    const handlers = source.match(/\.onMouse[A-Za-z]*\s*=/g) ?? []
    expect(handlers).toHaveLength(1)
    expect(source).toContain("node.onMouseDown")
  })
})

describe("the mouse is optional (FR-078, T159)", () => {
  const press = (name: string, modifiers: Partial<KeyEvent> = {}) => ({ name, ...modifiers }) as KeyEvent

  test("selecting a row is reachable by key", () => {
    expect(intentFor(press("down"))).toEqual({ kind: "move", delta: 1 })
    expect(intentFor(press("up"))).toEqual({ kind: "move", delta: -1 })
  })

  test("opening a row is reachable by key, and is the same action a double click runs", () => {
    const intent = intentFor(press("return"))
    expect(intent).toEqual({ kind: "action", id: "open" })
    // A double click calls the same `open`, so the two cannot diverge.
    expect(ACTIONS.some((a) => a.id === "open")).toBe(true)
  })

  test("scrolling is reachable by key", () => {
    expect(intentFor(press("pagedown"))).toEqual({ kind: "move", delta: 10 })
    expect(intentFor(press("home"))).toEqual({ kind: "jump", to: "first" })
    expect(intentFor(press("end"))).toEqual({ kind: "jump", to: "last" })
  })

  test("every action in the registry has a key, so nothing is mouse-only", () => {
    // The registry is the complete set of what the application does. If an action
    // existed that only the mouse could reach, it would have to be outside the registry,
    // and tests/ui/palette.test.ts already forbids that.
    for (const action of ACTIONS) {
      expect(action.key.length).toBeGreaterThan(0)
    }
  })
})
