/**
 * Keys to intents (task T131, T137, T151, T156).
 *
 * A pure mapping, so the key map can be tested without a terminal and - more
 * importantly - so a key and the command palette reach the SAME code. Choosing an
 * action from the palette produces the intent the key would have produced; there is one
 * implementation of "export this table", not two that can drift (FR-068, Principle I).
 */

import type { ActionId } from "./palette/actions.ts"
import type { KeyEvent } from "./search-input.ts"

export type Intent =
  | { kind: "action"; id: ActionId }
  /** Selection movement, which has no registry entry of its own beyond "move". */
  | { kind: "move"; delta: number }
  | { kind: "jump"; to: "first" | "last" }
  /** Quit unconditionally, whatever has focus. Only Ctrl+C. */
  | { kind: "force-quit" }

/**
 * What a key press means, or null when the application ignores it.
 *
 * Shift is read from the sequence as well as the flag: the key name arrives lower-cased
 * either way, so "w" and "W" are otherwise indistinguishable.
 */
export function intentFor(key: KeyEvent): Intent | null {
  const name = key.name ?? ""
  const shift = key.shift === true || (key.sequence !== undefined && /^[A-Z]$/.test(key.sequence))

  if (key.ctrl === true) {
    switch (name) {
      case "c":
        return { kind: "force-quit" }
      case "p":
        return { kind: "action", id: "palette" }
      case "b":
        return { kind: "action", id: "side-panel" }
      case "t":
        return { kind: "action", id: "theme" }
      default:
        return null
    }
  }

  switch (name) {
    case "up":
      return { kind: "move", delta: -1 }
    case "down":
      return { kind: "move", delta: 1 }
    case "pageup":
      return { kind: "move", delta: -10 }
    case "pagedown":
      return { kind: "move", delta: 10 }
    case "home":
      return { kind: "jump", to: "first" }
    case "end":
      return { kind: "jump", to: "last" }
    case "return":
    case "enter":
      return { kind: "action", id: "open" }
    case "escape":
    case "backspace":
      return { kind: "action", id: "back" }
    case "/":
    case "slash":
      return { kind: "action", id: "search" }
    // Shift distinguishes the pairs: "w" toggles watching, "W" opens the list; "e"
    // exports the table, "E" writes the summary; "c" copies the selected log entry, "C"
    // copies them all.
    case "w":
      return { kind: "action", id: shift ? "watchlist" : "watch" }
    case "e":
      return { kind: "action", id: shift ? "export-report" : "export-csv" }
    case "t":
      return { kind: "action", id: "council-type" }
    case "s":
      return { kind: "action", id: "sort" }
    case "l":
      return { kind: "action", id: "logs" }
    case "c":
      return { kind: "action", id: shift ? "copy-all" : "copy-entry" }
    case "r":
      return { kind: "action", id: "refresh" }
    case "?":
    case "questionmark":
      return { kind: "action", id: "help" }
    case "q":
      return { kind: "action", id: "quit" }
    default:
      return null
  }
}
