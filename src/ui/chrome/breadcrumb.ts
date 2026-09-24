/**
 * Breadcrumb (task T120, FR-055).
 *
 * "ČR › Okres Brno-město › Brno-Bohunice".
 *
 * It truncates from the LEFT. That is the whole design: the breadcrumb exists to answer
 * "where am I", and the answer is the last segment, so the current location is the one
 * thing that may never be dropped. Truncating from the right would leave the user
 * looking at a trail that ends before it reaches them.
 */

import type { Database } from "bun:sqlite"
import { listCouncilParties, readCouncil, readDistrictName } from "../../storage/queries/areas.ts"
import { pad } from "../format.ts"
import type { Screen } from "../navigation.ts"

export const SEPARATOR = "›"
const ELLIPSIS = "…"

/**
 * Joins the segments, dropping leading ones until the result fits.
 *
 * When even the last segment alone is too long it is cut to the width, because showing
 * part of where the user is beats showing nothing.
 */
export function breadcrumbText(segments: string[], width: number): string {
  if (segments.length === 0 || width <= 0) return ""

  const join = (parts: string[]) => parts.join(` ${SEPARATOR} `)
  const fits = (text: string) => [...text].length <= width

  const whole = join(segments)
  if (fits(whole)) return whole

  // Drop from the front, one segment at a time, marking the gap.
  for (let start = 1; start < segments.length; start += 1) {
    const candidate = `${ELLIPSIS} ${SEPARATOR} ${join(segments.slice(start))}`
    if (fits(candidate)) return candidate
  }

  // Not even the last segment fits beside the ellipsis: cut it.
  const last = segments[segments.length - 1] ?? ""
  return pad(last, width).trimEnd()
}

/** What one styled segment costs beyond its text: a space either side and the `▌` join. */
const SEGMENT_COST = 3

/**
 * The segments the styled title bar can show in `width` columns (002 T033, FR-011).
 *
 * The same rule as the plain breadcrumb, for the segmented form: drop from the front,
 * mark the gap with a segment of its own, and never drop the current location. A
 * segment costs its text plus its padding and join rather than a separator, so the two
 * forms measure differently and each keeps its own width arithmetic.
 */
export function breadcrumbSegments(segments: string[], width: number): string[] {
  if (segments.length === 0 || width <= 0) return []
  const cost = (parts: string[]) => parts.reduce((sum, part) => sum + [...part].length + SEGMENT_COST, 0)

  if (cost(segments) <= width) return segments
  for (let start = 1; start < segments.length; start += 1) {
    const candidate = [ELLIPSIS, ...segments.slice(start)]
    if (cost(candidate) <= width) return candidate
  }
  // Not even the current location fits beside the ellipsis: cut it.
  const last = segments[segments.length - 1] ?? ""
  return [pad(last, Math.max(1, width - SEGMENT_COST)).trimEnd()]
}

/** The Czech label for one screen in the trail. */
export function segmentFor(db: Database, screen: Screen): string {
  switch (screen.kind) {
    case "national":
      return "ČR"
    case "districts":
      return "Okresy"
    case "district":
      return `Okres ${readDistrictName(db, screen.nuts) ?? screen.nuts}`
    case "council":
      return readCouncil(db, screen.kodzastup)?.name ?? screen.kodzastup
    case "candidates": {
      const party = listCouncilParties(db, screen.kodzastup).find(
        (p) =>
          p.vstrana === screen.vstrana &&
          (screen.ballotOrder === null || p.ballotOrder === screen.ballotOrder),
      )
      return party?.name ?? `Volební strana ${screen.vstrana}`
    }
    case "watchlist":
      return "Sledovaná"
    case "search":
      return "Hledání"
    case "help":
      return "Nápověda"
    case "logs":
      return "Záznamy"
    case "log-entry":
      return "Záznam"
    default:
      return ""
  }
}

/** The trail for a whole navigation stack, one label per level. */
export function segmentsFor(db: Database, stack: Screen[]): string[] {
  return stack.map((screen) => segmentFor(db, screen)).filter((s) => s !== "")
}

/** The breadcrumb for a whole navigation stack. */
export function breadcrumbFor(db: Database, stack: Screen[], width: number): string {
  return breadcrumbText(segmentsFor(db, stack), width)
}
