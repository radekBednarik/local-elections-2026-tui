/**
 * The command palette (tasks T128-T132, FR-065 to FR-069).
 *
 * Every action the application has, in one searchable list, with its key beside it. The
 * key is shown so that reaching an action through the palette TEACHES the shortcut: a
 * palette that hid the keys would make itself permanent rather than a way in.
 *
 * Inapplicable actions are shown marked unavailable WITH THE REASON rather than hidden
 * (FR-069). Hiding them would teach the user the application is smaller than it is;
 * showing them greyed teaches its shape.
 *
 * Filtering folds case and Czech diacritics with the same `fold` the search screen uses.
 * Reusing the function rather than reimplementing it is what keeps "ricany" and "Říčany"
 * behaving identically in both places (FR-067, FR-038, Principle I).
 */

import type { BoxRenderable, CliRenderer } from "@opentui/core"
import { BoxRenderable as Box, InputRenderable, TextRenderable } from "@opentui/core"
import { fold } from "../../domain/folding.ts"
import { pad } from "../format.ts"
import type { Cell, SemanticRow } from "../row.ts"
import { slotColor, styledRow, TRANSPARENT, translucent } from "../theme/apply.ts"
import { MONOCHROME, type Theme } from "../theme/themes.ts"
import { ACTIONS, type Action, type ActionContext, THEME_ACTIONS } from "./actions.ts"

/** One row of the palette: an action, and whether it can be run from here. */
export interface PaletteEntry {
  action: Action
  available: boolean
  /** Why not, when it is unavailable. Shown beside the entry (FR-069). */
  reason: string | null
}

/** Every action, in registry order, then every theme, judged against the current screen. */
export function paletteEntries(context: ActionContext): PaletteEntry[] {
  return [...ACTIONS, ...THEME_ACTIONS].map((action) => {
    const reason = action.unavailable(context)
    return { action, available: reason === null, reason }
  })
}

/**
 * Narrows the list as the user types.
 *
 * Matches the label and the key, so someone who remembers "Ctrl+B" but not what it does
 * finds it, and someone who remembers the opposite finds it too. Each word typed must
 * appear somewhere, in any order, so "motiv nord" finds "Motiv: Nord" past the colon.
 */
export function filterEntries(entries: PaletteEntry[], query: string): PaletteEntry[] {
  const words = fold(query.trim())
    .split(/\s+/)
    .filter((w) => w !== "")
  if (words.length === 0) return entries
  return entries.filter((entry) => {
    const haystack = `${fold(entry.action.label)} ${fold(entry.action.key)}`
    return words.every((word) => haystack.includes(word))
  })
}

/** Columns the palette box takes, borders included. Fits beside the rail at 80 columns. */
const PALETTE_WIDTH = 64

/** Entry rows kept ready. More than any terminal the palette is drawn in has lines. */
const ENTRY_POOL = 60

/** How far the content beneath is dimmed toward the panel tone (research R7). */
const DIM_ALPHA = 0xb3

/**
 * One entry as styled cells (002 FR-024).
 *
 * The label; the reason, in muted, when it cannot run here (FR-069); and the key as a
 * chip at the right, so reaching an action through the palette still teaches its key
 * (FR-066). The highlighted entry reads in the selection colour and its chip is filled.
 */
export function entryRow(entry: PaletteEntry, highlighted: boolean, width: number): SemanticRow {
  const key: Cell = { text: ` ${entry.action.key} `, role: "accent" }
  if (highlighted) key.surface = "accent"
  const reason = entry.available ? "" : `  (${entry.reason ?? ""})`
  const room = Math.max(1, width - [...key.text].length - 2 - [...reason].length)
  const label = pad(entry.action.label, room).trimEnd()
  const cells: Cell[] = [
    { text: ` ${label}`, role: entry.available ? (highlighted ? "selection" : undefined) : "muted" },
  ]
  if (reason !== "") cells.push({ text: reason, role: "muted" })
  const used = cells.reduce((sum, c) => sum + [...c.text].length, 0) + [...key.text].length + 1
  cells.push({ text: " ".repeat(Math.max(1, width - used)) }, key, { text: " " })
  return { cells }
}

/**
 * The palette as a region drawn OVER the content (002 T037, FR-024, research R7).
 *
 * The root is a layer covering the content area, painted in the panel tone at partial
 * alpha: the content stays where it was, visible but dimmed. On it sits the palette
 * itself, a rounded box holding the search field and the entries. The entries are rows
 * drawn through the same styled-row path as every table, which is what lets a key be a
 * chip; the list component this replaced could draw a string in one colour only.
 *
 * The input takes focus while the palette is open, so typing goes to it; the
 * application's own key handler keeps only Esc, Enter and the arrows, and lets every
 * other key fall through. Two key handlers fighting over the same keystroke was the one
 * thing worth designing around here.
 */
export class Palette {
  readonly root: BoxRenderable
  readonly box: BoxRenderable
  readonly input: InputRenderable

  private readonly prompt: TextRenderable
  private readonly list: BoxRenderable
  private readonly pool: TextRenderable[] = []
  private theme: Theme = MONOCHROME
  private entries: PaletteEntry[] = []
  private isOpen = false
  /**
   * The highlighted row.
   *
   * Kept here rather than read back from a component, so the palette's state is the
   * application's own and cannot drift from what a component happens to expose.
   */
  private index = 0
  /** The first entry in view, when there are more entries than lines. */
  private offset = 0

  constructor(renderer: CliRenderer) {
    this.root = new Box(renderer, {
      position: "absolute",
      top: 0,
      left: 0,
      width: "100%",
      height: "100%",
      zIndex: 50,
      visible: false,
      flexDirection: "column",
      alignItems: "center",
      paddingTop: 1,
    })

    this.box = new Box(renderer, {
      width: PALETTE_WIDTH,
      flexGrow: 1,
      marginBottom: 1,
      flexDirection: "column",
      border: true,
      borderStyle: "rounded",
      title: " Příkazy ",
      bottomTitle: " Enter spustit · Esc zavřít ",
      bottomTitleAlignment: "right",
    })

    const search = new Box(renderer, { flexDirection: "row", height: 1, flexShrink: 0 })
    this.prompt = new TextRenderable(renderer, { content: " › ", flexShrink: 0 })
    this.input = new InputRenderable(renderer, {
      placeholder: "Napište část názvu příkazu…",
      flexGrow: 1,
    })
    search.add(this.prompt)
    search.add(this.input)

    this.list = new Box(renderer, { flexDirection: "column", flexGrow: 1, overflow: "hidden", marginTop: 1 })
    for (let i = 0; i < ENTRY_POOL; i += 1) {
      const node = new TextRenderable(renderer, { content: "", height: 1, flexShrink: 0 })
      this.pool.push(node)
      this.list.add(node)
    }

    this.box.add(search)
    this.box.add(this.list)
    this.root.add(this.box)
  }

  get open(): boolean {
    return this.isOpen
  }

  /**
   * Paints the palette from the theme.
   *
   * In monochrome nothing is dimmed and nothing painted, and every row is still written
   * out to its full width in spaces, so no character of the content shows through the
   * box (FR-008).
   */
  applyTheme(theme: Theme): void {
    this.theme = theme
    this.root.backgroundColor = translucent(theme, "panel", DIM_ALPHA)
    this.box.backgroundColor = slotColor(theme, "element") ?? TRANSPARENT
    const border = slotColor(theme, "borderActive")
    if (border !== undefined) this.box.borderColor = border
    const accent = slotColor(theme, "accent")
    if (accent !== undefined) this.box.titleColor = accent
    const bg = slotColor(theme, "bg") ?? TRANSPARENT
    const text = slotColor(theme, "text")
    this.input.backgroundColor = bg
    this.input.focusedBackgroundColor = bg
    if (text !== undefined) {
      this.input.textColor = text
      this.input.focusedTextColor = text
    }
    const muted = slotColor(theme, "muted")
    if (muted !== undefined) this.input.placeholderColor = muted
    this.prompt.content = styledRow(
      { cells: [{ text: " › ", role: "accent" }] },
      theme,
      3,
      "",
      undefined,
      "bg",
    )
    if (this.isOpen) this.draw()
  }

  /** Shows the palette, listing every action judged against the current screen. */
  show(context: ActionContext): void {
    this.isOpen = true
    this.root.visible = true
    this.input.value = ""
    this.index = 0
    this.offset = 0
    this.refresh(context)
    this.input.focus()
  }

  hide(): void {
    this.isOpen = false
    this.input.blur()
    this.root.visible = false
  }

  /** Rebuilds the list for the current query. */
  refresh(context: ActionContext): void {
    this.entries = filterEntries(paletteEntries(context), this.input.value)
    // Typing narrows the list under the cursor, so the highlight is clamped rather
    // than left pointing past the end.
    this.index = Math.min(this.index, Math.max(0, this.entries.length - 1))
    this.draw()
  }

  move(delta: number): void {
    if (this.entries.length === 0) return
    this.index = Math.min(this.entries.length - 1, Math.max(0, this.index + delta))
    this.draw()
  }

  /** The highlighted entry, or null when the query matched nothing. */
  get current(): PaletteEntry | null {
    return this.entries[this.index] ?? null
  }

  /** The action to perform, or null when the highlighted one does nothing here. */
  chosen(): Action | null {
    const entry = this.current
    return entry?.available === true ? entry.action : null
  }

  /** Draws the entries in view, keeping the highlighted one among them. */
  private draw(): void {
    const width = Math.max(10, this.list.width > 0 ? this.list.width : PALETTE_WIDTH - 2)
    const lines = this.list.height > 0 ? Math.min(this.list.height, ENTRY_POOL) : ENTRY_POOL
    if (this.index < this.offset) this.offset = this.index
    if (this.index >= this.offset + lines) this.offset = this.index - lines + 1

    this.pool.forEach((node, line) => {
      const position = this.offset + line
      const entry = this.entries[position]
      if (entry === undefined) {
        // Written as spaces rather than left empty, so a monochrome box still covers what
        // is beneath it.
        node.content = line < lines ? " ".repeat(width) : ""
        return
      }
      const highlighted = position === this.index
      node.content = styledRow(
        entryRow(entry, highlighted, width),
        this.theme,
        width,
        "",
        undefined,
        highlighted ? "sel" : "element",
      )
    })
  }

  destroy(): void {
    this.root.destroy()
  }
}
