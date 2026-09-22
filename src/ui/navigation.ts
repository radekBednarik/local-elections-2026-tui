/**
 * Navigation state (task T061).
 *
 * A stack of screens. The important property is that a REFRESH MUST NOT MOVE THE USER:
 * the stack is only ever changed by a key press, and redrawing reads it without
 * touching it (User Story 2, acceptance scenario 5). Selection indices live on the
 * stack entries for the same reason - a refresh that reset them would jump the cursor
 * back to the top of a list the user had scrolled.
 */

export type Screen =
  | { kind: "national" }
  | { kind: "districts" }
  | { kind: "district"; nuts: string }
  | { kind: "council"; kodzastup: string }
  | { kind: "candidates"; kodzastup: string; vstrana: string; ballotOrder: number | null }
  | { kind: "watchlist" }
  | { kind: "search" }
  | { kind: "help" }

export interface StackEntry {
  screen: Screen
  /** Highlighted row, preserved across refreshes. */
  selected: number
  /** First visible row, so scrolling survives a refresh too. */
  offset: number
}

export class Navigation {
  private stack: StackEntry[]

  constructor(root: Screen = { kind: "national" }) {
    this.stack = [{ screen: root, selected: 0, offset: 0 }]
  }

  get current(): StackEntry {
    const top = this.stack[this.stack.length - 1]
    // The stack can never be empty: pop() refuses to remove the root.
    if (top === undefined) throw new Error("navigation stack is empty")
    return top
  }

  get screen(): Screen {
    return this.current.screen
  }

  get depth(): number {
    return this.stack.length
  }

  /** Opens a screen, remembering where the user was. */
  push(screen: Screen): void {
    this.stack.push({ screen, selected: 0, offset: 0 })
  }

  /**
   * Returns to the previous screen, restoring its selection.
   *
   * Refuses to pop the root, so Esc at the top level is harmless rather than leaving
   * the application with nothing to display.
   */
  pop(): boolean {
    if (this.stack.length <= 1) return false
    this.stack.pop()
    return true
  }

  /** Replaces the whole stack, for a jump from search. */
  reset(screen: Screen): void {
    this.stack = [{ screen, selected: 0, offset: 0 }]
  }

  /** Moves the selection within `count` rows, clamped at both ends. */
  move(delta: number, count: number): void {
    const entry = this.current
    if (count <= 0) {
      entry.selected = 0
      return
    }
    entry.selected = Math.min(count - 1, Math.max(0, entry.selected + delta))
  }

  /** Jumps to the first or last row. */
  moveTo(position: "first" | "last", count: number): void {
    this.current.selected = position === "first" ? 0 : Math.max(0, count - 1)
  }

  /** Keeps the selected row visible within a window of `height` rows. */
  ensureVisible(height: number): void {
    const entry = this.current
    if (height <= 0) return
    if (entry.selected < entry.offset) entry.offset = entry.selected
    else if (entry.selected >= entry.offset + height) entry.offset = entry.selected - height + 1
  }
}
