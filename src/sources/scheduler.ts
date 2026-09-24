/**
 * Polling scheduler (task T042).
 *
 * Holds the hardest constraint in the application: NO SOURCE IS REQUESTED MORE THAN
 * ONCE PER 60 SECONDS (FR-016). That is not a default to be tuned - the publisher's
 * cache has 60-second granularity, so a faster poll returns identical bytes while
 * adding load on the busiest night of the year.
 *
 * The second job is spreading. With 79 live sources on one interval, firing them
 * together produces a burst every minute; spreading their due times across the window
 * turns that into roughly one request per second (research R8).
 */

import type { Database } from "bun:sqlite"
import { MIN_INTERVAL_SECONDS } from "../config/args.ts"
import { nextDueAt } from "./backoff.ts"
import type { SourceKey } from "./urls.ts"

export interface Subscription {
  sourceKey: SourceKey
  areaKind: string
  areaId: string
  nextDueAt: string | null
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  lastError: string | null
  consecutiveFailures: number
  etag: string | null
  lastModified: string | null
  /** A watched council stays subscribed while off screen (FR-018a). */
  pinned: boolean
  /** The most recent successfully read copy was final; such a source is not polled automatically. */
  final: boolean
}

export interface SchedulerOptions {
  intervalSeconds: number
}

/**
 * Owns the set of sources being polled and decides what is due.
 *
 * State lives in the database so a restart resumes rather than re-requesting
 * everything at once.
 */
export class Scheduler {
  private readonly interval: number

  constructor(
    private readonly db: Database,
    options: SchedulerOptions,
  ) {
    // Belt and braces: the CLI already clamps, but the scheduler must be safe even if
    // constructed directly, since it is the single place FR-016 is enforced.
    this.interval = Math.max(MIN_INTERVAL_SECONDS, options.intervalSeconds)
  }

  /** The effective interval after clamping. */
  get intervalSeconds(): number {
    return this.interval
  }

  /**
   * Registers sources to poll, spreading their first due times across one interval.
   *
   * Existing subscriptions keep their schedule, so adding a council does not disturb
   * the sources already running.
   */
  subscribeAll(keys: { key: SourceKey; areaKind: string; areaId: string }[], now = new Date()): void {
    const existing = new Set(
      (this.db.query("SELECT source_key FROM source_subscription").all() as { source_key: string }[]).map(
        (r) => r.source_key,
      ),
    )
    const fresh = keys.filter((k) => !existing.has(k.key))
    if (fresh.length === 0) return

    const insert = this.db.query(
      `INSERT INTO source_subscription (source_key, area_kind, area_id, next_due_at)
       VALUES ($k, $kind, $id, $due)`,
    )
    const run = this.db.transaction(() => {
      fresh.forEach((entry, index) => {
        // Spread evenly across the window so the whole set never fires at once.
        const offsetMs = Math.floor((index / fresh.length) * this.interval * 1000)
        insert.run({
          k: entry.key,
          kind: entry.areaKind,
          id: entry.areaId,
          due: new Date(now.getTime() + offsetMs).toISOString(),
        })
      })
    })
    run()
  }

  /** Marks a source as pinned, so it keeps polling while off screen (FR-018a). */
  setPinned(key: SourceKey, pinned: boolean): void {
    this.db
      .query("UPDATE source_subscription SET pinned = $p WHERE source_key = $k")
      .run({ p: pinned ? 1 : 0, k: key })
  }

  /** Removes a subscription entirely, so it stops being polled. */
  unsubscribe(key: SourceKey): void {
    this.db.query("DELETE FROM source_subscription WHERE source_key = $k").run({ k: key })
  }

  /** Sources whose next due time has arrived, oldest first. */
  due(now = new Date(), limit = 10): Subscription[] {
    const rows = this.db
      .query(
        `SELECT * FROM source_subscription
          WHERE next_due_at IS NULL OR next_due_at <= $now
          ORDER BY next_due_at IS NULL DESC, next_due_at ASC
          LIMIT $limit`,
      )
      .all({ now: now.toISOString(), limit }) as Record<string, unknown>[]
    return rows.map(toSubscription)
  }

  /** One subscription by key, or null. */
  get(key: SourceKey): Subscription | null {
    const row = this.db
      .query("SELECT * FROM source_subscription WHERE source_key = $k")
      .get({ k: key }) as Record<string, unknown> | null
    return row === null ? null : toSubscription(row)
  }

  /**
   * Records a successful attempt, resetting the failure count and storing validators.
   *
   * Used for a `304` as well as a `200`: unchanged content still proves the source is
   * reachable, so it must not count as a failure or the backoff would grow during a
   * perfectly healthy quiet period.
   */
  recordSuccess(
    key: SourceKey,
    validators: { etag?: string | null; lastModified?: string | null } = {},
    now = new Date(),
  ): void {
    this.db
      .query(
        `UPDATE source_subscription
            SET last_success_at = $now, last_attempt_at = $now, last_error = NULL,
                consecutive_failures = 0, next_due_at = $due,
                etag = COALESCE($etag, etag), last_modified = COALESCE($lm, last_modified)
          WHERE source_key = $k`,
      )
      .run({
        now: now.toISOString(),
        due: nextDueAt(now, this.interval, 0).toISOString(),
        etag: validators.etag ?? null,
        lm: validators.lastModified ?? null,
        k: key,
      })
  }

  /** Records a failed attempt and applies backoff (FR-043). */
  recordFailure(key: SourceKey, reason: string, now = new Date()): void {
    const current = this.get(key)
    const failures = (current?.consecutiveFailures ?? 0) + 1
    this.db
      .query(
        `UPDATE source_subscription
            SET last_attempt_at = $now, last_error = $reason,
                consecutive_failures = $failures, next_due_at = $due
          WHERE source_key = $k`,
      )
      .run({
        now: now.toISOString(),
        reason,
        failures,
        due: nextDueAt(now, this.interval, failures).toISOString(),
        k: key,
      })
  }

  /**
   * Whether a manual refresh is allowed yet (FR-019).
   *
   * The user-facing refresh key is subject to the same floor as automatic polling,
   * otherwise holding it down would bypass FR-016 entirely.
   */
  canRefreshNow(key: SourceKey, now = new Date()): boolean {
    const sub = this.get(key)
    if (sub?.lastAttemptAt == null) return true
    const elapsed = (now.getTime() - Date.parse(sub.lastAttemptAt)) / 1000
    return elapsed >= MIN_INTERVAL_SECONDS
  }

  /** Brings a source forward to now, if the floor permits (FR-019). */
  requestRefresh(key: SourceKey, now = new Date()): boolean {
    if (!this.canRefreshNow(key, now)) return false
    this.db
      .query("UPDATE source_subscription SET next_due_at = $now WHERE source_key = $k")
      .run({ now: now.toISOString(), k: key })
    return true
  }

  /** Every subscription, for diagnostics and the status bar. */
  all(): Subscription[] {
    const rows = this.db.query("SELECT * FROM source_subscription ORDER BY source_key").all() as Record<
      string,
      unknown
    >[]
    return rows.map(toSubscription)
  }
}

function toSubscription(row: Record<string, unknown>): Subscription {
  return {
    sourceKey: row.source_key as SourceKey,
    areaKind: row.area_kind as string,
    areaId: row.area_id as string,
    nextDueAt: (row.next_due_at as string | null) ?? null,
    lastAttemptAt: (row.last_attempt_at as string | null) ?? null,
    lastSuccessAt: (row.last_success_at as string | null) ?? null,
    lastError: (row.last_error as string | null) ?? null,
    consecutiveFailures: Number(row.consecutive_failures ?? 0),
    etag: (row.etag as string | null) ?? null,
    lastModified: (row.last_modified as string | null) ?? null,
    pinned: Number(row.pinned ?? 0) === 1,
    final: Number(row.final ?? 0) === 1,
  }
}
