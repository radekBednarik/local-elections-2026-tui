/**
 * Semantic rows (tasks T107-T109).
 *
 * A view says what a cell MEANS; this module decides how it looks. That split is what
 * the UX amendment forced: a plain string cannot carry a colour role or a bar value, so
 * FR-059 and FR-070 could not be expressed in the old `string[]` return type.
 *
 * A bar is NOT a cell property. It is a column of its own, produced by the view with
 * `bar()` and carried as ordinary text, so that the plain and styled renderings cannot
 * disagree about it and a narrow table can drop the column whole (FR-074, src/ui/bar.ts).
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

import type { ChangeKind } from "../domain/status.ts"
import { type Column, dataRow, pad, rule } from "./format.ts"
import { markSorted, type SortState, UNSORTED } from "./sort.ts"
import type { Role } from "./theme/roles.ts"
import type { Slot } from "./theme/themes.ts"

/** What a cell means. Resolved to a colour by the active theme (FR-059). */
export type { Role }

/**
 * A background a cell paints for itself, whatever row it sits on: cards, chips and
 * badges (research R4). Text on any of them but `element` is drawn in `onAccent`.
 */
export type Surface = "element" | "primary" | "accent" | "success" | "warning"

export interface Cell {
  text: string
  role?: Role
  surface?: Surface
  /** Marks a bar column, so the part of it the bar does not fill shows the track. */
  bar?: boolean
  /**
   * A foreground named by slot rather than by role, for the two places no role fits: the
   * `▌` joins between breadcrumb segments, whose foreground is the background of the
   * segment to their left, and the rule under a table header, drawn in `border`.
   */
  fgSlot?: Slot
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
  /**
   * What the row IS, for the frame to paint it (research R3). A header is tinted, a data
   * row is striped by its position, a rule is drawn in the border colour. Absent means
   * text: titles, summaries and notes, which are neither.
   */
  kind?: "header" | "rule" | "data"
}

/** A cell with an optional role. The common case. */
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

/**
 * A table's header and the rule under it, marked so the frame can tint them.
 *
 * Built on the same layout as `headerRow`, so the plain text is byte for byte what it
 * always was. The sorted column keeps the marker `markSorted` writes into its title and
 * takes the accent role, so it stands out in colour as well as by symbol.
 */
export function tableHeader(columns: Column[], sort: SortState = UNSORTED): SemanticRow[] {
  const layout = markSorted(columns, sort)
  return [
    {
      kind: "header",
      columns: layout,
      cells: layout.map((column, index) => cell(column.header, index === sort.column ? "accent" : "heading")),
    },
    {
      kind: "rule",
      columns: layout,
      cells: layout.map((column) => ({ text: rule(column.width), fgSlot: "border" })),
    },
  ]
}

/**
 * A status badge: its text on a coloured surface (002 FR-023). The text states the
 * status on its own, so the badge reads the same without colour.
 */
export function badge(text: string, surface: Surface = "success"): Cell {
  return { text: ` ${text} `, role: "heading", surface }
}

/** A label and value chip pair, for a figure shown on its own (002 FR-022). */
export function chip(label: string, value: string): Cell[] {
  return [
    { text: ` ${label} `, role: "subtle", surface: "element" },
    { text: ` ${value} `, role: "heading", surface: "primary" },
  ]
}

/**
 * Display cells a run of cells or chunks occupies, one per character. The one measure
 * the chrome, the chips and the row padding all lay themselves out by.
 */
export function cellsWide(parts: { text: string }[]): number {
  return parts.reduce((sum, part) => sum + [...part.text].length, 0)
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
    // A non-tabular row: its cells side by side, exactly as the styled form draws them.
    // Any space between two cells is written into the cells, so the plain and styled
    // forms cannot disagree about it (002: chips, badges and the seat strip).
    return r.cells
      .map((c) => c.text)
      .join("")
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
  surface?: Surface
  bar?: boolean
  fgSlot?: Slot
}

/**
 * Renders one row as styled chunks, padded to the same widths as the text form.
 *
 * Padding is applied here rather than left to the renderer so that a styled row and a
 * plain row occupy exactly the same columns. A layout that drifted between the two
 * would make the test assertions meaningless.
 *
 * Trailing blanks are trimmed, as `toText` trims them. Left in place, the padding of the
 * last column is what the clamp cut first: a row whose text fitted was still given an
 * ellipsis, because its invisible padding did not.
 */
export function toChunks(r: SemanticRow, columns?: Column[], gap = 1): StyledChunk[] {
  const layout = r.columns ?? columns
  if (layout === undefined || layout.length === 0) {
    return trimTrailing(r.cells.map((c) => chunkOf(c, c.text, r.role)))
  }

  const chunks: StyledChunk[] = []
  const separator = " ".repeat(gap)

  layout.forEach((column, index) => {
    if (index > 0) chunks.push({ text: separator })
    const source = r.cells[index]
    chunks.push(chunkOf(source ?? { text: "" }, pad(source?.text ?? "", column.width, column.align), r.role))
  })

  return trimTrailing(chunks)
}

/** A cell as a styled chunk, carrying everything that decides how it looks. */
function chunkOf(source: Cell, text: string, rowRole: Role | undefined): StyledChunk {
  const chunk: StyledChunk = { text }
  const role = source.role ?? rowRole
  if (role !== undefined) chunk.role = role
  if (source.surface !== undefined) chunk.surface = source.surface
  if (source.bar === true) chunk.bar = true
  if (source.fgSlot !== undefined) chunk.fgSlot = source.fgSlot
  return chunk
}

/**
 * Drops the blanks at the end of a row, across as many chunks as they span.
 *
 * Stops at a chunk that paints its own background: the padding inside a chip or a bar
 * track is part of what the user sees, not slack to be cut.
 */
function trimTrailing(chunks: StyledChunk[]): StyledChunk[] {
  const out = [...chunks]
  while (out.length > 0) {
    const last = out[out.length - 1] as StyledChunk
    if (last.surface !== undefined || last.bar === true) break
    const trimmed = last.text.trimEnd()
    if (trimmed !== "") {
      out[out.length - 1] = { ...last, text: trimmed }
      break
    }
    out.pop()
  }
  return out
}

/**
 * A change becomes a role, so a renderer can colour it without knowing what it means.
 *
 * Lives here rather than in one view because the national table, the watchlist and the
 * district list all mark the same three states, and one mapping is what keeps them
 * saying the same thing (Principle I).
 */
export function roleForChange(change: ChangeKind): Role | undefined {
  if (change === "increased") return "increase"
  if (change === "decreased") return "decrease"
  return undefined
}

/**
 * Truncates a chunk sequence to `width` display cells.
 *
 * The plain-text path clamps through `clampLines`; without the same clamp here a
 * summary line assembled from a template literal would overflow the terminal when
 * styled while fitting when plain. Both forms must be cut in the same place, or the
 * tests measure one thing and the user sees another.
 */
export function clampChunks(chunks: StyledChunk[], width: number): StyledChunk[] {
  const total = chunks.reduce((sum, c) => sum + [...c.text].length, 0)
  if (total <= width || width <= 0) return chunks

  const out: StyledChunk[] = []
  let used = 0
  for (const chunk of chunks) {
    const chars = [...chunk.text]
    if (used + chars.length <= width - 1) {
      out.push(chunk)
      used += chars.length
      continue
    }
    // This chunk is where the line runs out. Keep what fits, then the ellipsis that
    // `pad` would have written.
    const keep = Math.max(0, width - 1 - used)
    out.push({ ...chunk, text: `${chars.slice(0, keep).join("")}…` })
    return out
  }
  return out
}
