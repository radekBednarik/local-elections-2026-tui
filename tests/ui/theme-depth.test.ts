/**
 * Colour depth (tasks T062, T064, research R8).
 *
 * A terminal that reports 256 colours but not true colour is given each theme colour as
 * its nearest xterm-256 index. Whether OpenTUI approximates on its own could not be shown
 * (R8), so the application does it and this is what proves it.
 */

import { describe, expect, test } from "bun:test"
import { nearest256 } from "../../src/ui/theme/depth.ts"
import { type ColorEnvironment, resolveTheme, withCapabilities } from "../../src/ui/theme/detect.ts"
import { MONOCHROME, themeByName } from "../../src/ui/theme/themes.ts"

/** The xterm-256 colour an index stands for, from the standard cube and grey ramp. */
function xterm(index: number): [number, number, number] {
  if (index >= 232) {
    const v = 8 + (index - 232) * 10
    return [v, v, v]
  }
  const levels = [0, 95, 135, 175, 215, 255]
  const i = index - 16
  return [levels[Math.floor(i / 36)] ?? 0, levels[Math.floor(i / 6) % 6] ?? 0, levels[i % 6] ?? 0]
}

const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
const distance = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + (v - (b[i] ?? 0)) ** 2, 0)

describe("the nearest xterm-256 colour (T062)", () => {
  test("an exact cube colour maps to itself", () => {
    expect(nearest256("#5f87af")).toBe(67)
    expect(nearest256("#000000")).toBe(16)
    expect(nearest256("#ffffff")).toBe(231)
  })

  test("a grey maps to the grey ramp when that is nearer than the cube", () => {
    expect(nearest256("#808080")).toBe(244)
  })

  test("every theme colour maps to the index at the smallest distance, over 16 to 255", () => {
    for (const name of ["tokyonight", "catppuccin-mocha", "gruvbox", "nord", "catppuccin-latte"] as const) {
      for (const value of Object.values(themeByName(name).slots)) {
        if (value === null) continue
        const chosen = nearest256(value)
        expect(chosen).toBeGreaterThanOrEqual(16)
        const best = Math.min(...Array.from({ length: 240 }, (_, i) => distance(rgb(value), xterm(i + 16))))
        expect(`${value}: ${distance(rgb(value), xterm(chosen))}`).toBe(`${value}: ${best}`)
      }
    }
  })

  test("asking twice gives the same answer", () => {
    expect(nearest256("#1a1b26")).toBe(nearest256("#1a1b26"))
  })
})

describe("the theme follows what the terminal reports (T064)", () => {
  const env = (overrides: Partial<ColorEnvironment> = {}): ColorEnvironment => ({
    noColor: false,
    ansi256: true,
    rgb: true,
    reportedScheme: null,
    ...overrides,
  })

  test("true colour draws the theme's exact values", () => {
    expect(resolveTheme("nord", env()).palette256).toBe(false)
  })

  test("256 colours without true colour draws the nearest indices, as the same object every time", () => {
    const limited = resolveTheme("nord", env({ rgb: false }))
    expect(limited.palette256).toBe(true)
    expect(limited.name).toBe("nord")
    // The frame repaints when the theme object changes, so it must not change per draw.
    expect(resolveTheme("nord", env({ rgb: false }))).toBe(limited)
  })

  test("a capabilities report updates the environment, and the theme with it", () => {
    const start = env({ rgb: null, ansi256: null })
    const after256 = withCapabilities(start, { rgb: false, ansi256: true })
    expect(resolveTheme("gruvbox", after256).palette256).toBe(true)
    const afterNone = withCapabilities(start, { rgb: false, ansi256: false })
    expect(resolveTheme("gruvbox", afterNone)).toBe(MONOCHROME)
    const afterTrue = withCapabilities(start, { rgb: true, ansi256: true })
    expect(resolveTheme("gruvbox", afterTrue)).toBe(themeByName("gruvbox"))
  })

  test("a terminal that has not reported yet keeps true colour, as today", () => {
    expect(resolveTheme("nord", env({ rgb: null, ansi256: null }))).toBe(themeByName("nord"))
  })
})
