/**
 * Retry backoff (task T068).
 *
 * After consecutive failures the interval grows, up to a ceiling, and one success
 * resets it (FR-043). The growth exists so that an outage does not turn into sustained
 * hammering of a server that is already struggling - which on election night is exactly
 * when this application would be running.
 */

import { MIN_INTERVAL_SECONDS } from "../config/args.ts"

/** Beyond this, waiting longer serves no one: the user wants data as soon as it returns. */
export const MAX_BACKOFF_SECONDS = 15 * 60

/**
 * Seconds to wait before the next attempt.
 *
 * Doubles per consecutive failure from the configured interval, capped at the ceiling.
 * The result can never fall below the 60-second floor, because backoff only ever makes
 * the wait longer - but it is clamped explicitly so a future change to the formula
 * cannot breach FR-016 by accident.
 */
export function backoffSeconds(intervalSeconds: number, consecutiveFailures: number): number {
  const base = Math.max(MIN_INTERVAL_SECONDS, intervalSeconds)
  if (consecutiveFailures <= 0) return base

  // 2^(n-1) grows quickly; the cap is reached after a handful of failures.
  const multiplier = 2 ** Math.min(consecutiveFailures - 1, 20)
  const grown = base * multiplier
  return Math.min(Math.max(grown, MIN_INTERVAL_SECONDS), MAX_BACKOFF_SECONDS)
}

/** The next due time after an attempt. */
export function nextDueAt(now: Date, intervalSeconds: number, consecutiveFailures: number): Date {
  return new Date(now.getTime() + backoffSeconds(intervalSeconds, consecutiveFailures) * 1000)
}
