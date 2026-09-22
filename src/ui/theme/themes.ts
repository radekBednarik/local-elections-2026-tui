/**
 * Themes (task T111, FR-061, FR-062).
 *
 * Dark and light resolve each role to an ANSI PALETTE INDEX rather than a hex value.
 * `RGBA.fromIndex` targets the terminal's own palette, so the interface inherits
 * whatever scheme the user has already configured and looks at home in their terminal
 * instead of fighting it. Hardcoded hex would clash with every solarized or gruvbox
 * setup (research R13).
 *
 * High contrast is the exception and pins explicit values, because an unknown user
 * palette cannot promise the brightness separation FR-062 requires.
 */

import type { Role } from "./roles.ts"

export const THEME_NAMES = ["dark", "light", "high-contrast"] as const
export type ThemeName = (typeof THEME_NAMES)[number]

export function isThemeName(value: string): value is ThemeName {
  return (THEME_NAMES as readonly string[]).includes(value)
}

/**
 * How a role is expressed.
 *
 * `indexed` defers to the terminal's palette; `hex` pins a value. `none` is what the
 * monochrome path returns, and is what keeps FR-063 honest: a theme can legitimately
 * say "no colour at all" and everything must still work.
 */
export type ColorSpec =
  | { kind: "indexed"; index: number; bold?: boolean }
  | { kind: "hex"; value: string; bold?: boolean }
  | { kind: "none"; bold?: boolean }

export interface Theme {
  name: ThemeName
  /** True when this theme relies on brightness rather than hue (FR-062). */
  contrastByBrightness: boolean
  roles: Record<Role, ColorSpec>
}

/**
 * Standard ANSI slots 0-15. Using the bright variants for emphasis means the contrast
 * follows the user's own palette rather than a value guessed here.
 */
const DARK: Theme = {
  name: "dark",
  contrastByBrightness: false,
  roles: {
    heading: { kind: "indexed", index: 14, bold: true }, // bright cyan
    selection: { kind: "indexed", index: 15, bold: true }, // bright white
    warning: { kind: "indexed", index: 11, bold: true }, // bright yellow
    increase: { kind: "indexed", index: 10 }, // bright green
    decrease: { kind: "indexed", index: 9 }, // bright red
    muted: { kind: "indexed", index: 8 }, // bright black / grey
  },
}

const LIGHT: Theme = {
  name: "light",
  contrastByBrightness: false,
  roles: {
    heading: { kind: "indexed", index: 4, bold: true }, // blue
    selection: { kind: "indexed", index: 0, bold: true }, // black
    warning: { kind: "indexed", index: 1, bold: true }, // red
    increase: { kind: "indexed", index: 2 }, // green
    decrease: { kind: "indexed", index: 1 }, // red
    muted: { kind: "indexed", index: 8 }, // grey
  },
}

/**
 * High contrast.
 *
 * Every role is separated by BRIGHTNESS, not hue, so it remains legible to a user who
 * cannot distinguish the palette's colours (FR-062). Emphasis is carried by bold as
 * well, so even a terminal rendering all of these identically still shows the
 * difference.
 */
const HIGH_CONTRAST: Theme = {
  name: "high-contrast",
  contrastByBrightness: true,
  roles: {
    heading: { kind: "hex", value: "#ffffff", bold: true },
    selection: { kind: "hex", value: "#ffffff", bold: true },
    warning: { kind: "hex", value: "#ffff00", bold: true },
    increase: { kind: "hex", value: "#e0e0e0", bold: true },
    decrease: { kind: "hex", value: "#a0a0a0", bold: true },
    muted: { kind: "hex", value: "#707070" },
  },
}

/**
 * The monochrome fallback (FR-063).
 *
 * Not user-selectable: it is what a terminal without colour, or `NO_COLOR`, resolves
 * to. Every role returns no colour, which is the strongest possible test that meaning
 * is carried by text, symbol and position rather than by hue.
 */
export const MONOCHROME: Theme = {
  name: "dark",
  contrastByBrightness: true,
  roles: {
    heading: { kind: "none", bold: true },
    selection: { kind: "none", bold: true },
    warning: { kind: "none", bold: true },
    increase: { kind: "none" },
    decrease: { kind: "none" },
    muted: { kind: "none" },
  },
}

const THEMES: Record<ThemeName, Theme> = {
  dark: DARK,
  light: LIGHT,
  "high-contrast": HIGH_CONTRAST,
}

export function themeByName(name: ThemeName): Theme {
  return THEMES[name]
}

/** The next theme in the cycle, for the theme-switch key. */
export function nextTheme(current: ThemeName): ThemeName {
  const index = THEME_NAMES.indexOf(current)
  return THEME_NAMES[(index + 1) % THEME_NAMES.length] ?? "dark"
}

/** Czech label for the theme, for the status line and the command palette. */
export function themeLabel(name: ThemeName): string {
  switch (name) {
    case "dark":
      return "tmavé"
    case "light":
      return "světlé"
    case "high-contrast":
      return "vysoký kontrast"
  }
}
