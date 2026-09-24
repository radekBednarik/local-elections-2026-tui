/**
 * Screen composition (tasks T058-T065, migrated to semantic rows in T117).
 *
 * Turns the current navigation state into the rows to display and the list the
 * selection moves over. Kept separate from the renderer so the whole routing layer is
 * testable without a terminal.
 *
 * `rows` is the source of truth and `lines` is its plain-text rendering, produced here
 * so that every caller - the renderer, the exporter and the tests - is looking at the
 * same view rather than at two independently assembled ones.
 */

import type { Database } from "bun:sqlite"
import type { SourceKey } from "../sources/urls.ts"
import { availableCouncilTypes } from "../storage/queries/national.ts"
import { clampLines } from "./format.ts"
import type { Screen } from "./navigation.ts"
import { type SemanticRow, toTextLines } from "./row.ts"
import { type SortState, UNSORTED } from "./sort.ts"
import {
  buildCandidatesRows,
  buildCouncilRows,
  buildDistrictListRows,
  buildDistrictRows,
} from "./views/areas.ts"
import { buildHelpRows } from "./views/help.ts"
import { buildNationalRows } from "./views/national-rows.ts"
import { buildSearchRows } from "./views/search.ts"
import { buildWatchlistRows } from "./views/watchlist.ts"

/** What pressing Enter on the selected row opens, if anything. */
export type SelectableTarget = Screen | null

export interface ScreenContent {
  /** The view as semantic rows: what each cell means, before any styling. */
  rows: SemanticRow[]
  /** The same view as plain text, one string per row. */
  lines: string[]
  /** Index of the first data row, so the selection can be drawn against it. */
  firstRow: number
  /** How many rows the selection may move over. */
  rowCount: number
  /** Resolves the selected row to the screen it opens. */
  target: (index: number) => SelectableTarget
  /** How many columns this screen offers to sort by; zero when it has no table. */
  sortableColumns: number
}

export interface ScreenOptions {
  width: number
  councilType: string
  now?: Date
  /** Current text in the search box, when the search screen is open. */
  query?: string
  /** The column the user has sorted by, if any (FR-037). */
  sort?: SortState
  /** Rows the content area affords, for a view that adapts its summary to it (FR-021). */
  contentHeight?: number
}

/** Completes a screen, deriving the plain-text rendering from the rows. */
function content(
  rows: SemanticRow[],
  width: number,
  firstRow: number,
  rowCount: number,
  target: (index: number) => SelectableTarget,
  sortableColumns = 0,
): ScreenContent {
  return {
    rows,
    lines: clampLines(toTextLines(rows), width),
    firstRow,
    rowCount,
    target,
    sortableColumns,
  }
}

/** Builds everything needed to draw one screen. */
export function composeScreen(db: Database, screen: Screen, options: ScreenOptions): ScreenContent {
  const width = options.width
  const sort = options.sort ?? UNSORTED

  switch (screen.kind) {
    case "national": {
      const rows = buildNationalRows(db, {
        oznacTypu: options.councilType,
        width,
        now: options.now,
        contentHeight: options.contentHeight,
      })
      // The national overview is a summary, not a list to walk; Enter moves on to the
      // district list rather than selecting a row.
      return content(rows, width, rows.length, 0, () => ({ kind: "districts" }))
    }

    case "districts": {
      // The builder hands back the rows it drew, in the order it drew them, so a sorted
      // table opens the district the user is actually pointing at.
      const view = buildDistrictListRows(db, width, sort)
      return content(
        view.rows,
        width,
        view.firstRow,
        view.items.length,
        (index) => {
          const district = view.items[index]
          return district === undefined ? null : { kind: "district", nuts: district.nuts }
        },
        3,
      )
    }

    case "district": {
      const view = buildDistrictRows(db, screen.nuts, width, sort)
      return content(
        view.rows,
        width,
        view.firstRow,
        view.items.length,
        (index) => {
          const council = view.items[index]
          return council === undefined ? null : { kind: "council", kodzastup: council.kodzastup }
        },
        5,
      )
    }

    case "council": {
      const view = buildCouncilRows(db, screen.kodzastup, width, sort)
      return content(
        view.rows,
        width,
        view.firstRow,
        view.items.length,
        (index) => {
          const party = view.items[index]
          return party === undefined
            ? null
            : {
                kind: "candidates",
                kodzastup: screen.kodzastup,
                vstrana: party.vstrana,
                ballotOrder: party.ballotOrder,
              }
        },
        5,
      )
    }

    case "candidates": {
      const view = buildCandidatesRows(db, screen.kodzastup, screen.vstrana, screen.ballotOrder, width)
      // The candidate list is the leaf of the drill-down; nothing opens from it.
      return content(view.rows, width, view.firstRow, 0, () => null)
    }

    case "help": {
      const rows = buildHelpRows(width)
      return content(rows, width, 0, 0, () => null)
    }

    case "watchlist": {
      const view = buildWatchlistRows(db, width, sort)
      return content(
        view.rows,
        width,
        view.firstRow,
        view.codes.length,
        (index) => {
          const code = view.codes[index]
          return code === undefined ? null : { kind: "council", kodzastup: code }
        },
        1,
      )
    }

    case "search": {
      const view = buildSearchRows(db, options.query ?? "", width, sort)
      return content(
        view.rows,
        width,
        view.firstRow,
        view.hits.length,
        (index) => {
          const hit = view.hits[index]
          if (hit === undefined) return null
          // A party hit opens its candidate list directly; anything else opens the
          // council, which is the most useful landing place for a name.
          return hit.kind === "party" && hit.vstrana !== null
            ? { kind: "candidates", kodzastup: hit.kodzastup, vstrana: hit.vstrana, ballotOrder: null }
            : { kind: "council", kodzastup: hit.kodzastup }
        },
        3,
      )
    }

    default: {
      // Every screen kind is handled above, so TypeScript narrows this to `never`.
      // Assigning it proves exhaustiveness at compile time: adding a screen without
      // composing it becomes a type error rather than a blank display at runtime.
      const unreachable: never = screen
      return content(
        [{ cells: [{ text: `Neznámá obrazovka: ${JSON.stringify(unreachable)}` }] }],
        width,
        1,
        0,
        () => null,
      )
    }
  }
}

/** Czech title for the current screen, shown in the header. */
export function screenTitle(db: Database, screen: Screen): string {
  switch (screen.kind) {
    case "national": {
      const types = availableCouncilTypes(db)
      return types.length > 1 ? "Celkové výsledky za ČR" : "Celkové výsledky"
    }
    case "districts":
      return "Okresy"
    case "district":
      return `Okres ${screen.nuts}`
    case "council":
      return "Zastupitelstvo"
    case "candidates":
      return "Kandidáti"
    default:
      return screen.kind
  }
}

/** Which sources a screen needs, so the scheduler fetches only what is in view. */
export function sourcesForScreen(screen: Screen): { key: string; areaKind: string; areaId: string }[] {
  switch (screen.kind) {
    case "district":
      return [{ key: `district:${screen.nuts}`, areaKind: "district", areaId: screen.nuts }]
    case "council":
    case "candidates":
      return [{ key: `council:${screen.kodzastup}`, areaKind: "council", areaId: screen.kodzastup }]
    default:
      return []
  }
}

/**
 * Which sources a screen's figures come from, to say whether they are all final
 * (feature 003, contract § 2).
 *
 * Wider than `sourcesForScreen`, which lists only what a screen must subscribe to: the
 * national and district list screens show sources that are always subscribed anyway.
 */
export function shownSources(screen: Screen, watched: string[], districts: string[]): SourceKey[] {
  switch (screen.kind) {
    case "districts":
      return districts.map((nuts) => `district:${nuts}` as const)
    case "district":
    case "council":
    case "candidates":
      return sourcesForScreen(screen).map((s) => s.key as SourceKey)
    case "watchlist":
      return watched.length === 0 ? ["national"] : watched.map((code) => `council:${code}` as const)
    default:
      return ["national"]
  }
}
