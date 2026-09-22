/**
 * Header status bar and footer key hints (tasks T047, T050).
 *
 * Everything here is text. FR-040 requires that any status signalled by colour is also
 * signalled by text or symbol, and the simplest way to guarantee that is to make the
 * text carry the whole meaning and treat colour as decoration only.
 */

import { formatAge } from "../../domain/status.ts"
import type { Subscription } from "../../sources/scheduler.ts"
import { pad } from "../format.ts"
import { type ActionContext, availableActions } from "../palette/actions.ts"

export const MIN_COLUMNS = 80
export const MIN_ROWS = 24

/** Longest failure reason shown inline; the full text goes to the log. */
const MAX_REASON = 60

/** The persistent staleness warning, or null when everything is current (FR-044). */
export function staleWarning(subscriptions: Subscription[], now = new Date()): string | null {
  const failing = subscriptions.filter((s) => s.consecutiveFailures > 0)
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
