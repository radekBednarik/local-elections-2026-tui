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

export interface Logger {
  error(message: string, detail?: unknown): void
  warn(message: string, detail?: unknown): void
  info(message: string, detail?: unknown): void
  debug(message: string, detail?: unknown): void
  /** Everything written so far, for tests and for the in-app log view. */
  readonly path: string
}

function format(level: LogLevel, message: string, detail?: unknown): string {
  const stamp = new Date().toISOString()
  const base = `${stamp} ${level.toUpperCase().padEnd(5)} ${message}`
  if (detail === undefined) return `${base}\n`

  // Errors carry their message and stack; anything else is JSON. Never let the
  // formatting of a detail throw and take down a caller that was only logging.
  if (detail instanceof Error) return `${base} | ${detail.name}: ${detail.message}\n`
  try {
    return `${base} | ${JSON.stringify(detail)}\n`
  } catch {
    return `${base} | [detail could not be serialised]\n`
  }
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

  mkdirSync(dirname(path), { recursive: true })

  const write = (entryLevel: LogLevel, message: string, detail?: unknown): void => {
    if (SEVERITY[entryLevel] > threshold || !writable) return
    try {
      appendFileSync(path, format(entryLevel, message, detail), "utf8")
    } catch {
      // A failing log must never take down the application (FR-046). Stop trying, and
      // stay silent: writing the failure to stderr would corrupt the TUI.
      writable = false
    }
  }

  return {
    path,
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
  return { path: "", error: noop, warn: noop, info: noop, debug: noop }
}
