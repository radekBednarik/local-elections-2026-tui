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

export const MIN_COLUMNS = 80
export const MIN_ROWS = 24

/** The persistent staleness warning, or null when everything is current (FR-044). */
export function staleWarning(subscriptions: Subscription[], now = new Date()): string | null {
  const failing = subscriptions.filter((s) => s.consecutiveFailures > 0)
  if (failing.length === 0) return null

  // Report the longest-standing failure: it is the one the user most needs to know
  // about, and listing every source would bury it.
  const worst = failing.reduce((a, b) => (a.consecutiveFailures >= b.consecutiveFailures ? a : b))
  const since = worst.lastSuccessAt
  const age = since === null ? null : Math.floor((now.getTime() - Date.parse(since)) / 1000)

  const scope = failing.length === 1 ? worst.sourceKey : `${failing.length} zdrojů`
  const reason = worst.lastError ?? "neznámá chyba"
  const staleness = age === null ? "bez úspěšného načtení" : `data ${formatAge(age)}`

  return `! ZASTARALÁ DATA (${scope}): ${reason}. Zobrazena poslední známá ${staleness}.`
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
  const text = hints.map((h) => `${h.key} ${h.label}`).join("   ")
  return pad(text, Math.max(0, width))
}

export const NATIONAL_HINTS: KeyHint[] = [
  { key: "t", label: "typ zastupitelstva" },
  { key: "r", label: "obnovit" },
  { key: "?", label: "nápověda" },
  { key: "q", label: "konec" },
]
