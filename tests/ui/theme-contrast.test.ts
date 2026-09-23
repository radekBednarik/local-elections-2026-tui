/**
 * Contrast of every theme (task T002, SC-003, FR-001a).
 *
 * Measured with the WCAG 2 relative-luminance ratio, over every pair of foreground and
 * background a theme actually draws together. The published palettes were adjusted where
 * they fell short (research R9); this test is what stops a later edit undoing that.
 */

import { describe, expect, test } from "bun:test"
import { SLOTS, type Slot, THEME_NAMES, themeByName } from "../../src/ui/theme/themes.ts"

/** Relative luminance of a `#rrggbb` colour, per WCAG 2. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05)
}

/** The backgrounds ordinary text is drawn on. */
const SURFACES: Slot[] = ["bg", "panel", "element", "zebra"]

/** A foreground, the floor it must reach, and the backgrounds it is drawn on. */
const PAIRS: [Slot, number, Slot[]][] = [
  ["text", 4.5, SURFACES],
  ["primary", 4.5, SURFACES],
  ["accent", 4.5, SURFACES],
  ["success", 4.5, SURFACES],
  ["error", 4.5, SURFACES],
  ["warning", 4.5, SURFACES],
  ["muted", 3, SURFACES],
  ["subtle", 3, SURFACES],
  ["onAccent", 4.5, ["accent", "primary", "warning", "success"]],
]

describe.each(THEME_NAMES.map((name) => [name]))("theme %s", (name) => {
  const theme = themeByName(name)
  const colour = (slot: Slot): string => {
    const value = theme.slots[slot]
    if (value === null) throw new Error(`${name}.${slot} is null`)
    return value
  }

  test("defines every slot as #rrggbb", () => {
    expect(Object.keys(theme.slots).sort()).toEqual([...SLOTS].sort())
    for (const slot of SLOTS) expect(`${slot}=${theme.slots[slot]}`).toMatch(/=#[0-9a-f]{6}$/)
  })

  test.each(PAIRS)("%s reaches %d:1 on every background it is drawn on", (fg, floor, backgrounds) => {
    for (const bg of backgrounds) {
      const ratio = contrast(colour(fg), colour(bg))
      expect(`${fg} on ${bg}: ${ratio >= floor ? "pass" : ratio.toFixed(2)}`).toBe(`${fg} on ${bg}: pass`)
    }
  })

  test("the selected row's text reaches 4.5:1 on the selection", () => {
    expect(contrast(colour(theme.selectionText), colour("sel"))).toBeGreaterThanOrEqual(4.5)
  })

  test("the bars and the content differ in background (SC-002)", () => {
    expect(colour("panel")).not.toBe(colour("bg"))
  })
})

describe("high contrast separates states by brightness (001 FR-062)", () => {
  test("rises, falls and muted text have three distinct luminances", () => {
    const { slots } = themeByName("high-contrast")
    const levels = (["success", "error", "muted"] as const).map((slot) => luminance(slots[slot] ?? "#000000"))
    expect(new Set(levels.map((l) => l.toFixed(3))).size).toBe(3)
  })
})
