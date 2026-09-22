/**
 * Column sorting (task T062).
 *
 * The rule that matters: WHERE THE SOURCE REPORTS A TIE, THE SOURCE'S ORDER IS KEPT.
 * FR-029 forbids inventing information, and an ordering imposed on equal values is
 * exactly that - it would tell a reader one party finished ahead of another when the
 * published data says they did not.
 *
 * JavaScript's `Array.prototype.sort` is specified as stable, so sorting by a key that
 * compares equal leaves the original relative order untouched. That is what makes this
 * correct, and it is the reason the comparator never falls back to a tiebreak.
 */

export type SortDirection = "asc" | "desc"

export interface SortState {
  /** Index into the column list, or null for the source's own order. */
  column: number | null
  direction: SortDirection
}

export const UNSORTED: SortState = { column: null, direction: "desc" }

/**
 * Advances the sort as the user presses the sort key.
 *
 * Cycles descending, ascending, then back to the source's own order, so a user can
 * always get back to the published ordering without hunting for a reset.
 */
export function cycleSort(state: SortState, column: number): SortState {
  if (state.column !== column) return { column, direction: "desc" }
  if (state.direction === "desc") return { column, direction: "asc" }
  return { ...UNSORTED }
}

/** Extracts the comparable value for a row and column. */
export type SortKey<T> = (row: T, column: number) => number | string | null

/**
 * Sorts a copy of `rows`, preserving source order among equal values.
 *
 * Nulls always sort last regardless of direction: an absent figure is not a small one,
 * and floating it to the top of an ascending sort would misrepresent it.
 */
export function applySort<T>(rows: T[], state: SortState, key: SortKey<T>): T[] {
  if (state.column === null) return rows

  const column = state.column
  const factor = state.direction === "asc" ? 1 : -1

  return [...rows].sort((a, b) => {
    const left = key(a, column)
    const right = key(b, column)

    if (left === null && right === null) return 0
    if (left === null) return 1
    if (right === null) return -1

    if (typeof left === "number" && typeof right === "number") {
      // Equal values return 0, and a stable sort then keeps the published order.
      return (left - right) * factor
    }
    return String(left).localeCompare(String(right), "cs") * factor
  })
}

/** A marker for the sorted column header, readable without colour (FR-040). */
export function sortMarker(state: SortState, column: number): string {
  if (state.column !== column) return ""
  return state.direction === "asc" ? " ▴" : " ▾"
}
