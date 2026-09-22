/**
 * Choosing a theme honestly (task T112).
 *
 * Three inputs, in order of authority:
 *
 *   1. What the user chose and we stored. Their decision outranks anything detected.
 *   2. Whether colour is available at all. `NO_COLOR` or a terminal without colour
 *      support means monochrome, regardless of any stored preference (FR-063).
 *   3. What the terminal reports about its own scheme, via the mode-2031 colour-scheme
 *      report exposed on `renderer.capabilities`.
 *
 * A terminal that reports nothing gets a dark default rather than a guess dressed up as
 * detection.
 */

import { MONOCHROME, type Theme, type ThemeName, themeByName } from "./themes.ts"

export interface ColorEnvironment {
  /** `NO_COLOR` set to anything disables colour, by the informal standard. */
  noColor: boolean
  /** From `renderer.capabilities.ansi256`. Null when not yet known. */
  ansi256: boolean | null
  /** The terminal's own light/dark report, when it makes one. */
  reportedScheme: "light" | "dark" | null
}

/** Reads the environment. Kept separate so the decision itself stays testable. */
export function readColorEnvironment(
  env: Record<string, string | undefined> = process.env,
): ColorEnvironment {
  const noColor = env.NO_COLOR !== undefined && env.NO_COLOR !== ""
  return { noColor, ansi256: null, reportedScheme: null }
}

/**
 * Picks the theme to render with.
 *
 * Returns the monochrome theme rather than a colourless variant of the chosen one, so
 * that "no colour" is a single well-tested path instead of a state each theme has to
 * handle for itself.
 */
export function resolveTheme(stored: ThemeName | null, environment: ColorEnvironment): Theme {
  // Colour unavailable outranks everything: honouring a stored preference here would
  // emit escape sequences into a terminal that asked not to receive them.
  if (environment.noColor) return MONOCHROME
  if (environment.ansi256 === false) return MONOCHROME

  if (stored !== null) return themeByName(stored)

  // No stored choice: follow the terminal's own report when it makes one.
  if (environment.reportedScheme === "light") return themeByName("light")
  return themeByName("dark")
}

/** True when the application is rendering without colour, for the status line. */
export function isMonochrome(theme: Theme): boolean {
  return Object.values(theme.roles).every((spec) => spec.kind === "none")
}
