/**
 * Header status bar and footer key hints (tasks T047, T050).
 *
 * Everything here is text. FR-040 requires that any status signalled by colour is also
 * signalled by text or symbol, and the simplest way to guarantee that is to make the
 * text carry the whole meaning and treat colour as decoration only.
 */

import { formatAge } from "../../domain/status.ts"
import type { Subscription } from "../../sources/scheduler.ts"
import type { SourceKey } from "../../sources/urls.ts"
import { pad } from "../format.ts"
import type { Screen } from "../navigation.ts"
import { type ActionContext, availableActions } from "../palette/actions.ts"
import { type Cell, cellsWide, type SemanticRow } from "../row.ts"

export const MIN_COLUMNS = 80
export const MIN_ROWS = 24

/** Longest failure reason shown inline; the full text goes to the log. */
const MAX_REASON = 60

/** The persistent staleness warning, or null when everything is current (FR-044). */
export function staleWarning(subscriptions: Subscription[], now = new Date()): string | null {
  // Final figures are not stale, and a failed manual refresh of one would never clear,
  // since nothing retries it automatically (FR-009, research R6). The log has it.
  const failing = subscriptions.filter((s) => s.consecutiveFailures > 0 && !s.final)
  if (failing.length === 0) return null

  // Report the longest-standing failure: it is the one the user most needs to know
  // about, and listing every source would bury it.
  const worst = failing.reduce((a, b) => (a.consecutiveFailures >= b.consecutiveFailures ? a : b))
  const since = worst.lastSuccessAt
  // Clamped at zero: a success timestamp ahead of the local clock is possible under
  // clock skew, and "před -900 s" is worse than useless to a reader.
  const age = since === null ? null : Math.max(0, Math.floor((now.getTime() - Date.parse(since)) / 1000))

  const scope = failing.length === 1 ? worst.sourceKey : `${failing.length} zdrojů`
  // A schema rejection can carry a paragraph of parser detail. The warning is one line
  // on a shared screen, so it gets the gist; the log keeps the whole message.
  const full = worst.lastError ?? "neznámá chyba"
  const reason = full.length > MAX_REASON ? `${full.slice(0, MAX_REASON - 1)}…` : full
  const staleness = age === null ? "bez úspěšného načtení" : `data ${formatAge(age)}`

  return `! ZASTARALÁ DATA (${scope}): ${reason} Zobrazena poslední známá ${staleness}.`
}

/**
 * Whether every source a screen shows is final, so the title bar can say that automatic
 * refresh has stopped (FR-008). A source not subscribed yet counts as not final, and so
 * does a screen that shows none.
 */
export function allFinal(subscriptions: Subscription[], keys: SourceKey[]): boolean {
  if (keys.length === 0) return false
  const final = new Set(subscriptions.filter((s) => s.final).map((s) => s.sourceKey))
  return keys.every((key) => final.has(key))
}

/** One-line summary of the terminal being too small (FR-041). */
export function tooSmallMessage(width: number, height: number): string[] {
  return [
    "Okno terminálu je příliš malé.",
    "",
    `Potřebná velikost: ${MIN_COLUMNS} × ${MIN_ROWS}`,
    `Aktuální velikost: ${width} × ${height}`,
    "",
    "Zvětšete okno; aplikace pokračuje v běhu.",
  ]
}

export function isTooSmall(width: number, height: number): boolean {
  return width < MIN_COLUMNS || height < MIN_ROWS
}

export interface KeyHint {
  key: string
  label: string
}

/** Footer hints, so the available keys are discoverable (FR-005). */
export function keyHintLine(hints: KeyHint[], width: number): string {
  return pad(hintText(hints), Math.max(0, width))
}

/** Joins hints into one line. One joiner, so every bar reads the same way. */
export function hintText(hints: KeyHint[]): string {
  return hints.map((h) => `${h.key} ${h.label}`).join("   ")
}

export const NATIONAL_HINTS: KeyHint[] = [
  { key: "t", label: "typ zastupitelstva" },
  { key: "r", label: "obnovit" },
  { key: "?", label: "nápověda" },
  { key: "q", label: "konec" },
]

/**
 * The context-sensitive status bar (task T122, FR-064).
 *
 * Built from the action registry rather than a list of its own, so the bar and the
 * command palette cannot disagree about what this screen can do. An advertised key that
 * does nothing teaches the user to distrust the whole bar, which is why the registry
 * decides and this function only renders.
 */
export function contextHints(context: ActionContext): KeyHint[] {
  return availableActions(context).map((action) => ({
    key: action.shortKey ?? action.key,
    label: action.hint,
  }))
}

/**
 * Renders the bar, dropping trailing hints until it fits.
 *
 * The registry is ordered by usefulness, so dropping from the end loses the most
 * specialised action rather than the one the user most likely wants.
 */
export function statusBarLine(context: ActionContext, width: number): string {
  const hints = contextHints(context)
  for (let count = hints.length; count > 0; count -= 1) {
    const text = hintText(hints.slice(0, count))
    if ([...text].length <= width) return pad(text, Math.max(0, width))
  }
  return pad("", Math.max(0, width))
}

/** The label that opens the status bar, naming where the user is (002 FR-013). */
export function screenLabel(screen: Screen, paletteOpen: boolean): string {
  if (paletteOpen) return "PŘÍKAZY"
  switch (screen.kind) {
    case "national":
      return "PŘEHLED"
    case "districts":
      return "OKRESY"
    case "district":
      return "OKRES"
    case "council":
      return "ZASTUPITELSTVO"
    case "candidates":
      return "KANDIDÁTI"
    case "watchlist":
      return "SLEDOVANÉ"
    case "search":
      return "HLEDÁNÍ"
    case "help":
      return "NÁPOVĚDA"
  }
}

/**
 * The status bar as styled cells (002 T035, FR-013).
 *
 * The screen label as a chip, joined to the bar; each available key as a chip with its
 * label after it; the theme's name at the right end. The keys are exactly those the
 * plain bar offers, from the same registry (001 FR-064). A chip costs two columns more
 * than a plain key, so when they do not all fit, whole hints are dropped from the right
 * and none is ever cut. The row fills exactly `width`.
 */
export function statusBarRow(
  context: ActionContext,
  width: number,
  themeName: string,
  paletteOpen: boolean,
): SemanticRow {
  const lead: Cell[] = [
    { text: ` ${screenLabel(context.screen, paletteOpen)} `, role: "heading", surface: "primary" },
    { text: "▌", fgSlot: "primary" },
    { text: " " },
  ]
  const tail: Cell = { text: ` ${themeName} `, role: "muted" }
  const hint = (h: KeyHint): Cell[] => [
    { text: ` ${h.key} `, role: "accent", surface: "accent" },
    { text: ` ${h.label}  `, role: "subtle" },
  ]

  const room = width - cellsWide(lead) - cellsWide([tail])
  const hints: Cell[] = []
  for (const h of contextHints(context)) {
    const cells = hint(h)
    if (cellsWide(hints) + cellsWide(cells) > room) break
    hints.push(...cells)
  }
  const gap = Math.max(0, width - cellsWide(lead) - cellsWide(hints) - cellsWide([tail]))
  return { cells: [...lead, ...hints, { text: " ".repeat(gap) }, tail] }
}
