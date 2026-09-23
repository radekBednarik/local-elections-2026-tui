/**
 * Turning roles and slots into colour (tasks T136, T008, FR-059, FR-063).
 *
 * The ONLY module that produces a colour value. Views name roles and surfaces; this
 * resolves them against the active theme. That is what makes the monochrome guarantee
 * structural rather than a promise: the plain-text path never calls in here, so there is
 * no route by which colour could become load-bearing.
 */

import { RGBA, StyledText, type TextChunk } from "@opentui/core"
import type { Column } from "../format.ts"
import { cellsWide, clampChunks, type SemanticRow, type StyledChunk, toChunks } from "../row.ts"
import { nearest256 } from "./depth.ts"
import { ROLE_SLOT, type Role } from "./roles.ts"
import type { Slot, Theme } from "./themes.ts"

/** Bold, as OpenTUI's attribute bitmask expects it. */
const ATTR_BOLD = 1

/** Nothing at all: what a surface is painted with when the theme asks for no colour. */
export const TRANSPARENT = RGBA.fromInts(0, 0, 0, 0)

/**
 * A slot's colour at partial opacity, blended over whatever is drawn beneath it. Used to
 * dim the content behind the command palette (research R7). Transparent in monochrome.
 */
export function translucent(theme: Theme, slot: Slot, alpha: number): RGBA {
  const value = theme.slots[slot]
  if (value === null || !canDim(theme)) return TRANSPARENT
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => Number.parseInt(value.slice(i, i + 2), 16))
  return RGBA.fromInts(r, g, b, alpha)
}

/**
 * Whether content can be dimmed by blending over it (research R7).
 *
 * Not in monochrome, which paints nothing, and not in 256 colours: a blend produces a
 * colour between palette entries, which only a true-colour terminal can show. Where it
 * cannot, the content is withheld under an overlay instead.
 */
export function canDim(theme: Theme): boolean {
  return !theme.palette256 && theme.slots.bg !== null
}

/**
 * The colour a slot holds, or undefined when the theme asks for none (monochrome).
 *
 * On a 256-colour terminal it is the nearest xterm-256 index (research R8).
 */
export function slotColor(theme: Theme, slot: Slot | undefined): RGBA | undefined {
  if (slot === undefined) return undefined
  const value = theme.slots[slot]
  if (value === null) return undefined
  return theme.palette256 ? RGBA.fromIndex(nearest256(value)) : RGBA.fromHex(value)
}

/** The slot a role resolves to in this theme. */
function roleSlot(theme: Theme, role: Role): Slot {
  const { slot } = ROLE_SLOT[role]
  return slot === "selectionText" ? theme.selectionText : slot
}

/** The colour for a role, or undefined when the theme asks for none. */
export function colorFor(theme: Theme, role: Role | undefined): RGBA | undefined {
  return role === undefined ? undefined : slotColor(theme, roleSlot(theme, role))
}

/** WCAG 2 relative luminance of a `#rrggbb` value. */
function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5]
    .map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/**
 * Whether a role's colour still reads on a background, by the WCAG ratio.
 *
 * Used for the one case where colour competes with the selection: a figure that rose or
 * fell keeps its own colour on the selected row only while that colour stays legible
 * there (research R2). In monochrome nothing has a colour, so nothing "reads".
 */
export function readsOn(theme: Theme, role: Role, background: Slot, floor = 4.5): boolean {
  const fg = theme.slots[roleSlot(theme, role)]
  const bg = theme.slots[background]
  if (fg === null || bg === null) return false
  const [light = 0, dark = 0] = [luminance(fg), luminance(bg)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05) >= floor
}

/** Whether a role is emphasised. Survives a terminal with no colour at all (FR-063). */
export function boldFor(role: Role | undefined): boolean {
  return role === undefined ? false : ROLE_SLOT[role].bold
}

/**
 * One styled chunk as OpenTUI wants it.
 *
 * A chunk with a surface paints that surface and, on anything but `element`, reads in
 * `onAccent`: text on a coloured chip needs the one colour guaranteed to contrast with
 * every accent. Everything else sits on the row's own background.
 *
 * Text with no role of its own is drawn in the theme's `text` colour, never left to the
 * terminal's default. Once the theme paints the background, the terminal's default
 * foreground is a guess about a background it can no longer see: a dark terminal's light
 * text on Catppuccin Latte would all but vanish.
 */
function toTextChunk(chunk: StyledChunk, theme: Theme, rowBg: Slot | undefined): TextChunk {
  const onColour = chunk.surface !== undefined && chunk.surface !== "element"
  const fg =
    chunk.fgSlot !== undefined
      ? slotColor(theme, chunk.fgSlot)
      : onColour
        ? slotColor(theme, "onAccent")
        : (colorFor(theme, chunk.role) ?? slotColor(theme, "text"))
  const bg = slotColor(theme, chunk.surface ?? rowBg)

  const result: TextChunk = { __isChunk: true, text: chunk.text }
  if (fg !== undefined) result.fg = fg
  if (bg !== undefined) result.bg = bg
  if (boldFor(chunk.role)) result.attributes = ATTR_BOLD
  return result
}

/**
 * A bar cell as two chunks: its glyphs in the bar colour, and the part of its column the
 * bar does not fill on the track, so the whole scale is visible (002 FR-018). The bar's
 * length is untouched: it is still the published share, drawn by `bar()`.
 */
function barChunks(chunk: StyledChunk, theme: Theme, rowBg: Slot | undefined): TextChunk[] {
  const filled = chunk.text.trimEnd()
  const rest = chunk.text.slice(filled.length)
  const glyphs: StyledChunk = { text: filled, fgSlot: chunk.fgSlot ?? "bar" }
  if (chunk.surface !== undefined) glyphs.surface = chunk.surface
  const out: TextChunk[] = []
  if (filled !== "") out.push(toTextChunk(glyphs, theme, rowBg))
  if (rest !== "") out.push(toTextChunk({ text: rest }, theme, "track"))
  return out
}

/**
 * Renders one row for the terminal, clamped to `width` exactly as the text form is.
 *
 * `width` is the width of the BODY, the width the row was laid out for, not of the whole
 * line. `lead` is the selection gutter, written as its own chunk BESIDE the body so it
 * occupies the same two columns whether or not the row is selected.
 *
 * The caller takes the gutter off before composing the view. Taking it off a second time
 * here cut every full-width table two columns short, and the last column lost its final
 * characters to an ellipsis: "Mand…" in the council table, a lone "…" after Stav.
 *
 * With a `rowBg`, the row is padded out in that background to `fill` cells, gutter
 * included, which defaults to the gutter plus the body. OpenTUI paints a text background
 * under glyphs only (research R1), so without the padding a stripe would stop where the
 * row's text does. A screen with no selection has no gutter, and passes the full width
 * as `fill` so its rows still reach the edge. The plain form is never padded: it is also
 * the key that decides whether a row is redrawn.
 */
export function styledRow(
  row: SemanticRow,
  theme: Theme,
  width: number,
  lead = "",
  columns?: Column[],
  rowBg?: Slot,
  fill = [...lead].length + Math.max(0, width),
): StyledText {
  const body = clampChunks(toChunks(row, columns), Math.max(0, width))
  const chunks: TextChunk[] = []
  if (lead !== "") chunks.push(toTextChunk({ text: lead }, theme, rowBg))
  for (const chunk of body) {
    if (chunk.bar === true) chunks.push(...barChunks(chunk, theme, rowBg))
    else chunks.push(toTextChunk(chunk, theme, rowBg))
  }
  const slack = fill - [...lead].length - cellsWide(body)
  if (rowBg !== undefined && slack > 0) chunks.push(toTextChunk({ text: " ".repeat(slack) }, theme, rowBg))
  return new StyledText(chunks)
}

/**
 * Several rows as one styled block, for a region that is a single renderable.
 *
 * Rows are joined by newline chunks rather than rendered separately, because the side
 * panel is one text object: giving it a renderable per row would cost layout work for a
 * region that never scrolls. Each line is padded like a row, for the same reason.
 */
export function styledBlock(rows: SemanticRow[], theme: Theme, width: number, rowBg?: Slot): StyledText {
  const chunks: TextChunk[] = []
  rows.forEach((row, index) => {
    if (index > 0) chunks.push({ __isChunk: true, text: "\n" })
    chunks.push(...styledRow(row, theme, width, "", undefined, rowBg).chunks)
  })
  return new StyledText(chunks)
}
