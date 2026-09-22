/**
 * Czech number and text formatting for the interface (tasks T046-T048).
 *
 * Kept as pure functions so the formatting rules can be tested without a renderer,
 * which is what makes the view layer testable at all under Principle II.
 *
 * Czech convention, which differs from the English default in both separators:
 * a non-breaking space groups thousands, and a comma is the decimal mark.
 */

import { type ChangeKind, changeMarker } from "../domain/status.ts"

/** U+00A0. A normal space would let a number wrap across a line break. */
const GROUP_SEPARATOR = " "

/** `8255204` becomes `8 255 204`. */
export function formatInteger(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–"
  const sign = value < 0 ? "-" : ""
  const digits = Math.abs(Math.trunc(value)).toString()
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATOR)
  return `${sign}${grouped}`
}

/** `46.07` becomes `46,07 %`. Never recomputed, only formatted (FR-029). */
export function formatPercent(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–"
  return `${value.toFixed(decimals).replace(".", ",")}${GROUP_SEPARATOR}%`
}

/** `6 / 13` for count progress. */
export function formatProgress(counted: number, total: number): string {
  return `${formatInteger(counted)}${GROUP_SEPARATOR}/${GROUP_SEPARATOR}${formatInteger(total)}`
}

/** Pads to `width`, truncating with an ellipsis when the text is too long. */
export function pad(text: string, width: number, align: "left" | "right" = "left"): string {
  const chars = [...text]
  if (chars.length > width) {
    return width <= 1 ? chars.slice(0, width).join("") : `${chars.slice(0, width - 1).join("")}…`
  }
  const filler = " ".repeat(width - chars.length)
  return align === "right" ? filler + text : text + filler
}

/**
 * A value with its change marker.
 *
 * The marker is a symbol, never colour alone, so the information survives a monochrome
 * terminal and `NO_COLOR` (FR-040).
 */
export function withChange(text: string, change: ChangeKind): string {
  return `${changeMarker(change)}${text}`
}

/**
 * Czech plural agreement.
 *
 * Czech has three forms, not two: 1 takes the singular, 2-4 take a distinct plural, and
 * 5 and above take the genitive plural. Writing "1 mandátů" or "4 mandátů" is wrong in
 * a way every Czech reader notices immediately, so the rule is applied rather than
 * approximated with an English-style singular/plural pair.
 */
export function plural(count: number, one: string, few: string, many: string): string {
  const n = Math.abs(Math.trunc(count))
  if (n === 1) return one
  if (n >= 2 && n <= 4) return few
  return many
}

/** `9 mandátů`, `4 mandáty`, `1 mandát`. */
export function seatsLabel(count: number): string {
  return `${formatInteger(count)} ${plural(count, "mandát", "mandáty", "mandátů")}`
}

/** A horizontal rule of `width` characters. */
export function rule(width: number, char = "─"): string {
  return char.repeat(Math.max(0, width))
}

/**
 * Truncates every line to `width`, so no view can overflow the terminal.
 *
 * Applied at the end of each view rather than trusted line by line: summary lines are
 * assembled from template literals rather than the column system, and one of them did
 * overflow a narrow terminal before this existed. Clamping centrally means FR-041
 * cannot be broken by adding a line that forgets to measure itself.
 */
export function clampLines(lines: string[], width: number): string[] {
  return lines.map((line) => ([...line].length <= width ? line : pad(line, width)))
}

export interface Column {
  header: string
  width: number
  align?: "left" | "right"
}

/** Renders a header row and its underline. */
export function headerRow(columns: Column[], gap = 1): [string, string] {
  const sep = " ".repeat(gap)
  const header = columns.map((c) => pad(c.header, c.width, c.align)).join(sep)
  const underline = columns.map((c) => rule(c.width)).join(sep)
  return [header, underline]
}

/** Renders one data row, truncating each cell to its column width. */
export function dataRow(columns: Column[], cells: string[], gap = 1): string {
  const sep = " ".repeat(gap)
  return columns
    .map((column, index) => pad(cells[index] ?? "", column.width, column.align))
    .join(sep)
    .trimEnd()
}
