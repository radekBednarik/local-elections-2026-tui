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
import { BoxRenderable as Box, InputRenderable, SelectRenderable } from "@opentui/core"
import { fold } from "../../domain/folding.ts"
import { ACTIONS, type Action, type ActionContext } from "./actions.ts"

/** One row of the palette: an action, and whether it can be run from here. */
export interface PaletteEntry {
  action: Action
  available: boolean
  /** Why not, when it is unavailable. Shown beside the entry (FR-069). */
  reason: string | null
}

/** Every action, in registry order, judged against the current screen. */
export function paletteEntries(context: ActionContext): PaletteEntry[] {
  return ACTIONS.map((action) => {
    const reason = action.unavailable(context)
    return { action, available: reason === null, reason }
  })
}

/**
 * Narrows the list as the user types.
 *
 * Matches the label and the key, so someone who remembers "Ctrl+B" but not what it does
 * finds it, and someone who remembers the opposite finds it too.
 */
export function filterEntries(entries: PaletteEntry[], query: string): PaletteEntry[] {
  const needle = fold(query.trim())
  if (needle === "") return entries
  return entries.filter(
    (entry) => fold(entry.action.label).includes(needle) || fold(entry.action.key).includes(needle),
  )
}

/** The text shown for an entry: what it does, then how to do it next time (FR-066). */
export function entryLabel(entry: PaletteEntry): string {
  return `${entry.action.label}   [${entry.action.key}]`
}

/** The second line: the reason it cannot be run here, or nothing (FR-069). */
export function entryDescription(entry: PaletteEntry): string {
  return entry.available ? "" : `nedostupné zde — ${entry.reason ?? ""}`
}

/**
 * The palette as a renderable region.
 *
 * Built from `InputRenderable` and `SelectRenderable`, which bring their own cursor and
 * list scrolling. The input takes focus while the palette is open, so typing goes to it;
 * the application's own key handler keeps only Esc, Enter and the arrows, and lets every
 * other key fall through. Two key handlers fighting over the same keystroke was the one
 * thing worth designing around here.
 */
export class Palette {
  readonly root: BoxRenderable
  readonly input: InputRenderable
  readonly select: SelectRenderable

  private entries: PaletteEntry[] = []
  private isOpen = false
  /**
   * The highlighted row.
   *
   * Kept here rather than read back from the select, so the palette's state is the
   * application's own and cannot drift from what the component happens to expose.
   */
  private index = 0

  constructor(renderer: CliRenderer) {
    this.root = new Box(renderer, {
      flexDirection: "column",
      border: true,
      borderStyle: "single",
      title: "Příkazy",
      visible: false,
      height: 0,
    })

    this.input = new InputRenderable(renderer, {
      placeholder: "Napište část názvu příkazu…",
      flexShrink: 0,
    })
    this.select = new SelectRenderable(renderer, {
      options: [],
      flexGrow: 1,
      showDescription: true,
      showSelectionIndicator: true,
      wrapSelection: false,
    })

    this.root.add(this.input)
    this.root.add(this.select)
  }

  get open(): boolean {
    return this.isOpen
  }

  /** Shows the palette, listing every action judged against the current screen. */
  show(context: ActionContext): void {
    this.isOpen = true
    this.root.visible = true
    this.root.height = undefined as unknown as number
    this.root.flexGrow = 1
    this.input.value = ""
    this.index = 0
    this.refresh(context)
    this.input.focus()
  }

  hide(): void {
    this.isOpen = false
    this.input.blur()
    this.root.visible = false
    this.root.flexGrow = 0
    this.root.height = 0
  }

  /** Rebuilds the list for the current query. */
  refresh(context: ActionContext): void {
    this.entries = filterEntries(paletteEntries(context), this.input.value)
    this.select.options = this.entries.map((entry) => ({
      name: entryLabel(entry),
      description: entryDescription(entry),
      value: entry.action.id,
    }))
    // Typing narrows the list under the cursor, so the highlight is clamped rather
    // than left pointing past the end.
    this.index = Math.min(this.index, Math.max(0, this.entries.length - 1))
    this.select.selectedIndex = this.index
  }

  move(delta: number): void {
    if (this.entries.length === 0) return
    this.index = Math.min(this.entries.length - 1, Math.max(0, this.index + delta))
    this.select.selectedIndex = this.index
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

  destroy(): void {
    this.root.destroy()
  }
}
