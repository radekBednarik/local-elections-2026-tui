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
import { listCouncilParties, listCouncilsInDistrict, listDistricts } from "../storage/queries/areas.ts"
import { availableCouncilTypes } from "../storage/queries/national.ts"
import { clampLines } from "./format.ts"
import type { Screen } from "./navigation.ts"
import { type SemanticRow, toTextLines } from "./row.ts"
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
}

export interface ScreenOptions {
  width: number
  councilType: string
  now?: Date
  /** Current text in the search box, when the search screen is open. */
  query?: string
}

/** Completes a screen, deriving the plain-text rendering from the rows. */
function content(
  rows: SemanticRow[],
  width: number,
  firstRow: number,
  rowCount: number,
  target: (index: number) => SelectableTarget,
): ScreenContent {
  return { rows, lines: clampLines(toTextLines(rows), width), firstRow, rowCount, target }
}

/** Builds everything needed to draw one screen. */
export function composeScreen(db: Database, screen: Screen, options: ScreenOptions): ScreenContent {
  const width = options.width

  switch (screen.kind) {
    case "national": {
      const rows = buildNationalRows(db, {
        oznacTypu: options.councilType,
        width,
        now: options.now,
      })
      // The national overview is a summary, not a list to walk; Enter moves on to the
      // district list rather than selecting a row.
      return content(rows, width, rows.length, 0, () => ({ kind: "districts" }))
    }

    case "districts": {
      const districts = listDistricts(db)
      const view = buildDistrictListRows(db, width)
      return content(view.rows, width, view.firstRow, districts.length, (index) => {
        const district = districts[index]
        return district === undefined ? null : { kind: "district", nuts: district.nuts }
      })
    }

    case "district": {
      const councils = listCouncilsInDistrict(db, screen.nuts)
      const view = buildDistrictRows(db, screen.nuts, width)
      return content(view.rows, width, view.firstRow, councils.length, (index) => {
        const council = councils[index]
        return council === undefined ? null : { kind: "council", kodzastup: council.kodzastup }
      })
    }

    case "council": {
      const parties = listCouncilParties(db, screen.kodzastup)
      const view = buildCouncilRows(db, screen.kodzastup, width)
      return content(view.rows, width, view.firstRow, parties.length, (index) => {
        const party = parties[index]
        return party === undefined
          ? null
          : {
              kind: "candidates",
              kodzastup: screen.kodzastup,
              vstrana: party.vstrana,
              ballotOrder: party.ballotOrder,
            }
      })
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
      const view = buildWatchlistRows(db, width)
      return content(view.rows, width, view.firstRow, view.codes.length, (index) => {
        const code = view.codes[index]
        return code === undefined ? null : { kind: "council", kodzastup: code }
      })
    }

    case "search": {
      const view = buildSearchRows(db, options.query ?? "", width)
      return content(view.rows, width, view.firstRow, view.hits.length, (index) => {
        const hit = view.hits[index]
        if (hit === undefined) return null
        // A party hit opens its candidate list directly; anything else opens the
        // council, which is the most useful landing place for a name.
        return hit.kind === "party" && hit.vstrana !== null
          ? { kind: "candidates", kodzastup: hit.kodzastup, vstrana: hit.vstrana, ballotOrder: null }
          : { kind: "council", kodzastup: hit.kodzastup }
      })
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
