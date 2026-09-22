/**
 * Count status and change detection (task T038).
 *
 * The rule this module exists to protect is FR-029: the application reports what the
 * source published and nothing else. No turnout is recomputed, no seat total is
 * projected, no winner is inferred before the source says the count is complete.
 * Everything here either reads a published figure or compares two published figures.
 */

/** Whether an area's count is complete, and how far along it is. */
export interface CountStatus {
  districtsTotal: number
  districtsCounted: number
  /** As published. Null when the source did not report it. */
  publishedPct: number | null
  isFinal: boolean
}

/**
 * Determines whether a count is complete.
 *
 * Two independent signals exist: the source's own `JE_SPOCTENO` flag, and counted
 * versus total polling districts. Both must agree, because a document can report all
 * districts counted moments before the flag flips, and labelling a result final one
 * refresh early is exactly the mistake FR-022 guards against.
 */
export function determineStatus(input: {
  districtsTotal: number
  districtsCounted: number
  publishedPct?: number | null
  sourceSaysCounted: boolean
}): CountStatus {
  const { districtsTotal, districtsCounted, sourceSaysCounted } = input
  const allCounted = districtsTotal > 0 && districtsCounted >= districtsTotal
  return {
    districtsTotal,
    districtsCounted,
    publishedPct: input.publishedPct ?? null,
    isFinal: sourceSaysCounted && allCounted,
  }
}

/** How a displayed value relates to the previous refresh (FR-036). */
export type ChangeKind = "new" | "increased" | "decreased" | "unchanged"

/**
 * Compares a value with the same value at the previous refresh.
 *
 * `null` for `previous` means there was no previous snapshot, which is "new" rather
 * than "increased from zero" - the distinction matters because the first render of an
 * area should not show every figure as having just jumped.
 */
export function compareValue(current: number | null, previous: number | null | undefined): ChangeKind {
  if (current === null) return "unchanged"
  if (previous === null || previous === undefined) return "new"
  if (current > previous) return "increased"
  if (current < previous) return "decreased"
  return "unchanged"
}

/**
 * A symbol for a change, so the information survives a monochrome terminal.
 *
 * FR-040 requires every status signalled by colour to be signalled by text or symbol as
 * well. Colour may be added on top of this, never instead of it.
 */
export function changeMarker(kind: ChangeKind): string {
  switch (kind) {
    case "increased":
      return "▲"
    case "decreased":
      return "▼"
    case "new":
      return "·"
    case "unchanged":
      return " "
  }
}

/** Czech label for the provisional/final distinction (FR-022, FR-004a). */
export function statusLabel(status: CountStatus): string {
  return status.isFinal ? "konečné výsledky" : "průběžné výsledky"
}

/**
 * Age of data in whole seconds, from the publisher's timestamp.
 *
 * Deliberately takes the published time, not the local retrieval time: if the local
 * clock disagrees with the publisher's, "last updated" must still reflect the data
 * (data-model, clock-skew edge case). A negative age means the local clock is behind
 * the publisher's and is reported as zero rather than as a nonsensical future value.
 *
 * TIMEZONE: `DATUM_CAS_GENEROVANI` carries no zone suffix - the publisher writes Czech
 * local time, e.g. "2026-10-09T21:15:00". JavaScript parses such a string as LOCAL
 * time, which is the behaviour we want for a Czech user and is why no zone is applied
 * here. A user running in another zone will see an age offset by their difference from
 * Prague; that is a known and accepted limitation, not a bug to work around by guessing
 * a zone the source never stated.
 */
export function ageSeconds(publishedAt: string, now: Date = new Date()): number | null {
  const published = Date.parse(publishedAt)
  if (Number.isNaN(published)) return null
  return Math.max(0, Math.floor((now.getTime() - published) / 1000))
}

/** Human-readable age in Czech, for the staleness indicator (FR-044). */
export function formatAge(seconds: number | null): string {
  if (seconds === null) return "neznámé stáří"
  if (seconds < 60) return `před ${seconds} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `před ${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `před ${hours} h ${minutes % 60} min`
}
