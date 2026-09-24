/**
 * File logger (task T019, FR-030).
 *
 * The one rule that matters here: while the TUI owns the terminal, nothing may be
 * written to stdout or stderr. A stray `console.log` corrupts the rendered frame, and
 * the damage is not obvious until someone sees a garbled screen. Everything goes to a
 * file the user can inspect instead.
 */

import { appendFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import type { LogLevel } from "../config/args.ts"

const SEVERITY: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 }

/**
 * How many recent entries the logger keeps in memory for the in-app logs view (004
 * research R4). A few hundred kilobytes at most; older entries stay in the file.
 */
export const LOG_VIEW_LIMIT = 1000

/** One entry the logger accepted, as held for the logs view (004 data-model.md). */
export interface LogEntry {
  /** Position in the session, from 0. Never reused, so it names one entry after evictions. */
  seq: number
  /** ISO timestamp, the same one written to the file. */
  at: string
  level: LogLevel
  /** The message passed to the logger. */
  message: string
  /** The serialised detail, exactly the text after ` | ` in `line`; null without one. */
  detail: string | null
  /** `detail.source` when the detail is an object carrying a string source. */
  source: string | null
  /** The exact line written to the file, without the trailing newline. */
  line: string
}

export interface Logger {
  error(message: string, detail?: unknown): void
  warn(message: string, detail?: unknown): void
  info(message: string, detail?: unknown): void
  debug(message: string, detail?: unknown): void
  /** The log file, for tests and for telling the user where the full history is. */
  readonly path: string
  /** The most recent entries, oldest first, at most LOG_VIEW_LIMIT of them. */
  entries(): readonly LogEntry[]
  /** How many entries have been evicted from the front so far; it only grows. */
  readonly dropped: number
}

/**
 * The detail as it appears after ` | `, or null when there is none.
 *
 * Errors carry their name and message, without the stack; anything else is JSON. Never
 * let the formatting of a detail throw and take down a caller that was only logging.
 */
function detailText(detail: unknown): string | null {
  if (detail === undefined) return null
  if (detail instanceof Error) return `${detail.name}: ${detail.message}`
  try {
    return JSON.stringify(detail)
  } catch {
    return "[detail could not be serialised]"
  }
}

/** The one formatter: the file line and the recorded entry both come from here. */
function format(stamp: string, level: LogLevel, message: string, detail: string | null): string {
  const base = `${stamp} ${level.toUpperCase().padEnd(5)} ${message}`
  return detail === null ? base : `${base} | ${detail}`
}

function sourceOf(detail: unknown): string | null {
  if (detail === null || typeof detail !== "object" || detail instanceof Error) return null
  const source = (detail as { source?: unknown }).source
  return typeof source === "string" ? source : null
}

/**
 * Creates a logger writing to `path`.
 *
 * Writes are synchronous appends. That is deliberate: logging happens rarely, and a
 * synchronous append means a crash still leaves the last entry on disk, which is the
 * entry most likely to explain the crash.
 */
export function createLogger(path: string, level: LogLevel = "info"): Logger {
  const threshold = SEVERITY[level]
  let writable = true
  const recent: LogEntry[] = []
  let dropped = 0
  let seq = 0

  mkdirSync(dirname(path), { recursive: true })

  const write = (entryLevel: LogLevel, message: string, detail?: unknown): void => {
    if (SEVERITY[entryLevel] > threshold) return
    const at = new Date().toISOString()
    const text = detailText(detail)
    const line = format(at, entryLevel, message, text)

    // Recorded before the file is tried, so the logs view keeps working when the file
    // does not (004 spec edge case).
    recent.push({ seq, at, level: entryLevel, message, detail: text, source: sourceOf(detail), line })
    seq += 1
    if (recent.length > LOG_VIEW_LIMIT) {
      recent.shift()
      dropped += 1
    }

    if (!writable) return
    try {
      appendFileSync(path, `${line}\n`, "utf8")
    } catch {
      // A failing log must never take down the application (FR-046). Stop trying, and
      // stay silent: writing the failure to stderr would corrupt the TUI.
      writable = false
    }
  }

  return {
    path,
    entries: () => recent,
    get dropped() {
      return dropped
    },
    error: (message, detail) => {
      write("error", message, detail)
    },
    warn: (message, detail) => {
      write("warn", message, detail)
    },
    info: (message, detail) => {
      write("info", message, detail)
    },
    debug: (message, detail) => {
      write("debug", message, detail)
    },
  }
}

/** A logger that discards everything, for tests that do not care about output. */
export function createNullLogger(): Logger {
  const noop = (): void => {}
  return { path: "", entries: () => [], dropped: 0, error: noop, warn: noop, info: noop, debug: noop }
}
