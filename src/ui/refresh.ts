/**
 * What a manual refresh tells the user (FR-019, bug manual-refresh-no-feedback).
 *
 * Automatic polling stays silent on success, or the logs view would fill during a live
 * count (004 research R5). A refresh the user asked for is different: pressing `r` used
 * to change nothing but the title-bar clock, so a refresh that found no change, one the
 * 60-second floor refused, and one that failed all looked alike. Every manual refresh
 * now ends in one status-row notice and one log entry.
 *
 * Kept apart from the application shell so it can be tested without a renderer.
 */

import type { Logger } from "../logging/logger.ts"
import type { SourceKey } from "../sources/urls.ts"

/** What one fetch did: new figures, identical figures, a `304`, or any kind of failure. */
export type FetchResult = "changed" | "unchanged" | "not-modified" | "failed"

/** How a manual refresh ended, taken over every source it asked for. */
export type RefreshSummary = "changed" | "unchanged" | "failed" | "partial"

/** Status-row notice while a manual refresh is being fetched. */
export const REFRESHING_NOTICE = "Obnovuji…"

/** Status-row notice for a manual refresh the 60-second floor refused. */
export function refreshTooSoonNotice(seconds: number): string {
  return `Obnovení bude možné za ${seconds} s.`
}

/**
 * Sums up a manual refresh from each source's result.
 *
 * Any failure wins over a success, since that is what the user must go and read about;
 * "partial" says some sources did load. New figures anywhere count as new figures.
 */
export function summariseRefresh(results: FetchResult[]): RefreshSummary {
  const failed = results.filter((r) => r === "failed").length
  if (failed > 0) return failed === results.length ? "failed" : "partial"
  return results.includes("changed") ? "changed" : "unchanged"
}

/** Status-row notice for a finished manual refresh. Fits 80 columns with the row's leading space. */
export function refreshNotice(summary: RefreshSummary): string {
  switch (summary) {
    case "changed":
      return "Obnoveno: nová data."
    case "unchanged":
      return "Obnoveno: beze změny."
    case "partial":
      return "Obnoveno jen zčásti, některé zdroje selhaly. · l záznamy"
    case "failed":
      return "Obnovení selhalo. · l záznamy"
  }
}

/**
 * The manual refresh in progress, if any, and what each of its sources has done.
 *
 * Settled by whichever tick fetches each source, not only the one the refresh starts:
 * the one-second loop runs ticks concurrently, and may pick a requested source first.
 * A new refresh replaces an unfinished one.
 */
export class ManualRefresh {
  private pending: Map<SourceKey, FetchResult | null> | null = null

  constructor(private readonly log: Logger) {}

  /** Starts waiting for these sources, returning the notice to show meanwhile. */
  start(keys: SourceKey[]): string {
    this.pending = new Map(keys.map((key) => [key, null]))
    return REFRESHING_NOTICE
  }

  /** Records a refresh the floor refused, returning the notice to show. */
  refused(seconds: number): string {
    this.log.info("Ruční obnovení odloženo", { waitSeconds: seconds })
    return refreshTooSoonNotice(seconds)
  }

  /**
   * Records one fetch. Returns the closing notice once every source is in, and null
   * while some are still outstanding or when the fetch belongs to no manual refresh.
   */
  settle(key: SourceKey, result: FetchResult): string | null {
    const pending = this.pending
    if (pending === null || !pending.has(key)) return null
    pending.set(key, result)

    const results = [...pending.values()]
    if (results.some((r) => r === null)) return null
    this.pending = null

    const summary = summariseRefresh(results as FetchResult[])
    this.log.info("Ruční obnovení", { result: summary, sources: Object.fromEntries(pending) })
    return refreshNotice(summary)
  }
}
