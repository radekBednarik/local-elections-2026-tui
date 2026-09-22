/**
 * Search box key handling (task T077).
 *
 * A pure function over (query, key) so the typing rules can be tested without a
 * terminal. The rules are fiddly enough to be worth pinning:
 *
 *   - Ordinary letters are TEXT, not shortcuts. While the box has focus, "q" must type
 *     a q rather than quitting, or no one could search for Quido.
 *   - Arrows and Enter are NOT consumed, so the same navigation keys still move through
 *     and open the results.
 *   - Esc clears a non-empty query first and only leaves search when already empty, so
 *     a mistyped query is corrected without losing the screen.
 */

export interface KeyEvent {
  name?: string
  ctrl?: boolean
  meta?: boolean
  sequence?: string
}

export type SearchInputResult =
  /** The key was text: use the new query. */
  | { handled: true; query: string }
  /** The key belongs to navigation: let the caller deal with it. */
  | { handled: false }

/** Keys that must reach navigation rather than the text box. */
const NAVIGATION = new Set(["up", "down", "pageup", "pagedown", "home", "end", "return", "enter", "tab"])

export function applySearchKey(query: string, key: KeyEvent): SearchInputResult {
  const name = key.name ?? ""

  if (key.ctrl === true || key.meta === true) return { handled: false }
  if (NAVIGATION.has(name)) return { handled: false }

  if (name === "backspace") {
    // Splitting by code point, so deleting a character with diacritics removes the
    // whole character rather than half of a surrogate pair.
    return { handled: true, query: [...query].slice(0, -1).join("") }
  }

  if (name === "escape") {
    // Clear first; leaving search is the caller's job once the box is empty.
    return query === "" ? { handled: false } : { handled: true, query: "" }
  }

  const char = key.sequence ?? ""
  const points = [...char]
  // Exactly one printable character. Control sequences are either longer or below
  // space, and must never land in the query.
  if (points.length === 1 && char >= " " && char !== "\u007f") {
    return { handled: true, query: query + char }
  }

  return { handled: false }
}
