/**
 * Turning roles into colour (task T136, FR-059, FR-063).
 *
 * The ONLY module that produces a colour value. Views name roles; this resolves them
 * against the active theme. That is what makes the monochrome guarantee structural
 * rather than a promise: the plain-text path never calls in here, so there is no route
 * by which colour could become load-bearing.
 */

import { RGBA, StyledText, type TextChunk } from "@opentui/core"
import type { Column } from "../format.ts"
import { clampChunks, type SemanticRow, type StyledChunk, toChunks } from "../row.ts"
import type { Role } from "./roles.ts"
import type { Theme } from "./themes.ts"

/** Bold, as OpenTUI's attribute bitmask expects it. */
const ATTR_BOLD = 1

/** The colour for a role, or undefined when the theme asks for none. */
export function colorFor(theme: Theme, role: Role | undefined): RGBA | undefined {
  if (role === undefined) return undefined
  const spec = theme.roles[role]
  if (spec.kind === "none") return undefined
  // An indexed colour targets the terminal's own palette, so the interface inherits the
  // scheme the user already configured instead of fighting it (research R13).
  return spec.kind === "indexed" ? RGBA.fromIndex(spec.index) : RGBA.fromHex(spec.value)
}

/** Whether a role is emphasised. Survives a terminal with no colour at all (FR-063). */
export function boldFor(theme: Theme, role: Role | undefined): boolean {
  return role === undefined ? false : theme.roles[role].bold === true
}

/** One styled chunk as OpenTUI wants it. */
function toTextChunk(chunk: StyledChunk, theme: Theme): TextChunk {
  const fg = colorFor(theme, chunk.role)
  const result: TextChunk = { __isChunk: true, text: chunk.text }
  if (fg !== undefined) result.fg = fg
  if (boldFor(theme, chunk.role)) result.attributes = ATTR_BOLD
  return result
}

/**
 * Renders one row for the terminal, clamped to `width` exactly as the text form is.
 *
 * `lead` is the selection gutter, written as its own unstyled chunk so it occupies the
 * same two columns whether or not the row is selected.
 */
export function styledRow(
  row: SemanticRow,
  theme: Theme,
  width: number,
  lead = "",
  columns?: Column[],
): StyledText {
  const body = clampChunks(toChunks(row, columns), Math.max(0, width - [...lead].length))
  const chunks: TextChunk[] = []
  if (lead !== "") chunks.push({ __isChunk: true, text: lead })
  for (const chunk of body) chunks.push(toTextChunk(chunk, theme))
  return new StyledText(chunks)
}

/**
 * Several rows as one styled block, for a region that is a single renderable.
 *
 * Rows are joined by newline chunks rather than rendered separately, because the side
 * panel is one text object: giving it a renderable per row would cost layout work for a
 * region that never scrolls.
 */
export function styledBlock(rows: SemanticRow[], theme: Theme, width: number): StyledText {
  const chunks: TextChunk[] = []
  rows.forEach((row, index) => {
    if (index > 0) chunks.push({ __isChunk: true, text: "\n" })
    for (const chunk of clampChunks(toChunks(row), width)) chunks.push(toTextChunk(chunk, theme))
  })
  return new StyledText(chunks)
}
