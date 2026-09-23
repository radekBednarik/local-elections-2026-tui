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
 * A terminal that reports nothing gets Tokyo Night, and one that reports a light scheme
 * gets Catppuccin Latte (FR-004), rather than a guess dressed up as detection.
 */

import { MONOCHROME, type Theme, type ThemeName, themeByName } from "./themes.ts"

export interface ColorEnvironment {
  /** `NO_COLOR` set to anything disables colour, by the informal standard. */
  noColor: boolean
  /** From `renderer.capabilities.ansi256`. Null when not yet known. */
  ansi256: boolean | null
  /** From `renderer.capabilities.rgb`: true colour. Null when not yet known. */
  rgb: boolean | null
  /** The terminal's own light/dark report, when it makes one. */
  reportedScheme: "light" | "dark" | null
}

/** Reads the environment. Kept separate so the decision itself stays testable. */
export function readColorEnvironment(
  env: Record<string, string | undefined> = process.env,
): ColorEnvironment {
  const noColor = env.NO_COLOR !== undefined && env.NO_COLOR !== ""
  return { noColor, ansi256: null, rgb: null, reportedScheme: null }
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

  const theme =
    stored !== null
      ? themeByName(stored)
      : // No stored choice: follow the terminal's own report when it makes one.
        themeByName(environment.reportedScheme === "light" ? "catppuccin-latte" : "tokyonight")

  // 256 colours but not true colour: the same theme, drawn in the nearest indices.
  return environment.rgb === false && environment.ansi256 === true ? limited(theme) : theme
}

/**
 * The 256-colour variant of each theme, made once.
 *
 * The frame repaints everything when the theme OBJECT changes, so handing back a fresh
 * copy on every draw would repaint every row every second.
 */
const LIMITED = new Map<ThemeName, Theme>()

function limited(theme: Theme): Theme {
  const known = LIMITED.get(theme.name)
  if (known !== undefined) return known
  const variant = { ...theme, palette256: true }
  LIMITED.set(theme.name, variant)
  return variant
}

/** What the terminal says about itself, as reported on `renderer.capabilities`. */
export interface ReportedCapabilities {
  rgb?: boolean
  ansi256?: boolean
}

/**
 * The environment after a capabilities report (task T064).
 *
 * The report is settled natively over the first few seconds after start (research R8),
 * so it can arrive after the first draw; the caller re-resolves the theme with this.
 * Anything the report leaves out stays as it was.
 */
export function withCapabilities(
  environment: ColorEnvironment,
  capabilities: ReportedCapabilities | null | undefined,
): ColorEnvironment {
  return {
    ...environment,
    ansi256: capabilities?.ansi256 ?? environment.ansi256,
    rgb: capabilities?.rgb ?? environment.rgb,
  }
}

/** True when the application is rendering without colour, for the status line. */
export function isMonochrome(theme: Theme): boolean {
  return Object.values(theme.slots).every((value) => value === null)
}
