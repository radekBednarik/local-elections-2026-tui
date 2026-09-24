/**
 * The logs screens (feature 004: FR-009 to FR-014, research R6).
 *
 * The list shows one line per entry, cut to the width like every other table row. A long
 * entry is read in full on its own screen rather than wrapped in the list: a selectable
 * row is one line throughout the application (`firstRow + selected` maps a selection to a
 * line), and wrapping here would break selection and scrolling everywhere that shares it.
 *
 * Everything the application decides about these screens is a function in this file,
 * over a real `Navigation`. Nothing constructs `App` in a test, so logic left in `App`
 * would be logic no test could reach (Principle II).
 */

import type { LogLevel } from "../../config/args.ts"
import type { LogEntry } from "../../logging/logger.ts"
import { type Column, rule } from "../format.ts"
import type { Navigation } from "../navigation.ts"
import { blank, cell, line, type Role, type SemanticRow, tableHeader } from "../row.ts"

/** The level as a Czech word, so severity reads without colour (FR-005). */
const LEVEL_LABEL: Record<LogLevel, string> = {
  error: "CHYBA",
  warn: "VAROVÁNÍ",
  info: "INFO",
  debug: "LADĚNÍ",
}

/** Failures stand out; debugging chatter recedes; information is plain text. */
const LEVEL_ROLE: Record<LogLevel, Role | undefined> = {
  error: "warning",
  warn: "warning",
  info: undefined,
  debug: "muted",
}

const LEVEL_WIDTH = Math.max(...Object.values(LEVEL_LABEL).map((label) => [...label].length))
/** Wide enough for `district:CZ0642` and `council:582786`, the longest source keys. */
const SOURCE_WIDTH = 16
const TIME_WIDTH = 8

/** `HH:MM:SS` in local time. */
function clock(iso: string): string {
  const date = new Date(iso)
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":")
}

/** The heading every logs screen opens with. */
function heading(title: string, width: number): SemanticRow[] {
  return [line(title, "heading"), line(rule(width), "muted"), blank()]
}

/** The list of entries, oldest first, and the index of the first selectable row. */
export function buildLogListRows(
  entries: readonly LogEntry[],
  width: number,
): { rows: SemanticRow[]; firstRow: number } {
  const rows = heading("Záznamy", width)
  if (entries.length === 0) {
    rows.push(line("Zatím nebyly zaznamenány žádné záznamy."))
    return { rows, firstRow: rows.length }
  }

  const columns: Column[] = [
    { header: "Čas", width: TIME_WIDTH },
    { header: "Úroveň", width: LEVEL_WIDTH },
    { header: "Zdroj", width: SOURCE_WIDTH },
    { header: "Zpráva", width: Math.max(10, width - TIME_WIDTH - LEVEL_WIDTH - SOURCE_WIDTH - 3) },
  ]
  rows.push(...tableHeader(columns))
  const firstRow = rows.length

  for (const entry of entries) {
    const role = LEVEL_ROLE[entry.level]
    const message = entry.detail === null ? entry.message : `${entry.message} | ${entry.detail}`
    rows.push({
      kind: "data",
      columns,
      cells: [clock(entry.at), LEVEL_LABEL[entry.level], entry.source ?? "", message].map((text) =>
        cell(text, role),
      ),
    })
  }
  return { rows, firstRow }
}

/**
 * One entry in full: its log-file line, wrapped to the width with nothing lost, so what
 * the user reads here is exactly what `c` copies and what the file holds (FR-011, FR-015).
 */
export function buildLogEntryRows(entries: readonly LogEntry[], seq: number, width: number): SemanticRow[] {
  const rows = heading("Záznam", width)
  const entry = entries.find((e) => e.seq === seq)
  if (entry === undefined) {
    rows.push(line("Záznam již není k dispozici."))
    return rows
  }
  const chars = [...entry.line]
  const room = Math.max(1, width)
  for (let start = 0; start < chars.length; start += room) {
    rows.push(line(chars.slice(start, start + room).join(""), LEVEL_ROLE[entry.level]))
  }
  return rows
}

/** Opens the list with the newest entry selected (FR-009). */
export function openLogs(nav: Navigation, count: number): void {
  nav.push({ kind: "logs" })
  nav.moveTo("last", count)
}

/**
 * Keeps the selection on the entry the user chose as older ones are evicted (FR-012).
 *
 * Appending changes no index, so only eviction can move the selection: each entry dropped
 * from the front shifts every other one up a row. `seen` is the dropped count when the
 * list was last corrected, and the one to remember is returned. Off the list nothing is
 * touched, so the correction is applied once the user is back on it.
 */
export function syncLogSelection(nav: Navigation, seen: number, dropped: number): number {
  if (nav.screen.kind !== "logs") return seen
  if (dropped !== seen) nav.current.selected = Math.max(0, nav.current.selected - (dropped - seen))
  return dropped
}
