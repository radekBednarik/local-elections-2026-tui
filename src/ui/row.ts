/**
 * Semantic rows (tasks T107-T109).
 *
 * A view says what a cell MEANS; this module decides how it looks. That split is what
 * the UX amendment forced: a plain string cannot carry a colour role or a bar value, so
 * FR-059 and FR-070 could not be expressed in the old `string[]` return type.
 *
 * Rendering happens two ways from one source of truth:
 *
 *   toText()   plain text, for exports and for the existing test assertions
 *   toChunks() styled text, for the terminal
 *
 * Colour therefore lives HERE and nowhere else, which is what makes FR-063's monochrome
 * guarantee real rather than aspirational: rendering to text simply never consults a
 * theme, so there is no path by which colour could become load-bearing.
 */

import { type Column, dataRow, pad } from "./format.ts"

/** What a cell means. Resolved to a colour by the active theme (FR-059). */
export type Role = "heading" | "selection" | "warning" | "increase" | "decrease" | "muted"

export interface Cell {
  text: string
  role?: Role
  /**
   * A proportion from 0 to 1, drawn as a bar after the text (FR-070).
   *
   * The bar is an aid beside the published figure, never a value in itself: nothing
   * reads a figure back out of a bar length (FR-071).
   */
  bar?: number
}

export interface SemanticRow {
  cells: Cell[]
  /** Marks the whole row, e.g. a header row or the selected row. */
  role?: Role
  /**
   * Column layout for this row.
   *
   * Carried per row rather than per view because a single screen mixes forms: summary
   * lines run the full width while the table below them is columnar. Keeping the view
   * as one flat list of rows is what lets the renderer, the exporter and the tests all
   * walk it the same way.
   */
  columns?: Column[]
}

/** A cell with no styling. The common case. */
export function cell(text: string, role?: Role): Cell {
  return role === undefined ? { text } : { text, role }
}

/** A row of plain cells. */
export function row(...cells: (Cell | string)[]): SemanticRow {
  return { cells: cells.map((c) => (typeof c === "string" ? { text: c } : c)) }
}

/** A row that is not tabular: one cell spanning the width. */
export function line(text: string, role?: Role): SemanticRow {
  return { cells: [cell(text, role)] }
}

/** A blank separator row. */
export function blank(): SemanticRow {
  return { cells: [{ text: "" }] }
}

/**
 * Renders one row as plain text.
 *
 * Delegates to the existing column machinery so the output is identical to what
 * `dataRow` produced before the migration. That identity is what lets roughly 120
 * existing assertions keep passing while the type beneath them changes (research R14).
 */
export function toText(r: SemanticRow, columns?: Column[], gap = 1): string {
  const layout = r.columns ?? columns
  if (layout === undefined || layout.length === 0) {
    // A non-tabular row: join the cells with a single space and leave the text alone.
    return r.cells
      .map((c) => c.text)
      .join(" ")
      .trimEnd()
  }
  return dataRow(
    layout,
    r.cells.map((c) => c.text),
    gap,
  )
}

/** Renders a whole view as plain text lines, the form exports and tests consume. */
export function toTextLines(rows: SemanticRow[], columns?: Column[], gap = 1): string[] {
  return rows.map((r) => toText(r, columns, gap))
}

/** A styled fragment: text plus the role that decides its colour. */
export interface StyledChunk {
  text: string
  role?: Role
}

/**
 * Renders one row as styled chunks, padded to the same widths as the text form.
 *
 * Padding is applied here rather than left to the renderer so that a styled row and a
 * plain row occupy exactly the same columns. A layout that drifted between the two
 * would make the test assertions meaningless.
 */
export function toChunks(r: SemanticRow, columns?: Column[], gap = 1): StyledChunk[] {
  const layout = r.columns ?? columns
  if (layout === undefined || layout.length === 0) {
    return r.cells.map((c) => ({ text: c.text, role: c.role ?? r.role }))
  }

  const chunks: StyledChunk[] = []
  const separator = " ".repeat(gap)

  layout.forEach((column, index) => {
    if (index > 0) chunks.push({ text: separator })
    const source = r.cells[index]
    chunks.push({
      text: pad(source?.text ?? "", column.width, column.align),
      role: source?.role ?? r.role,
    })
  })

  return chunks
}

/** True when any cell in the view carries a bar, so callers can reserve width. */
export function hasBars(rows: SemanticRow[]): boolean {
  return rows.some((r) => r.cells.some((c) => c.bar !== undefined))
}
