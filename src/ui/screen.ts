/**
 * Screen composition (tasks T058-T065).
 *
 * Turns the current navigation state into the lines to display and the list the
 * selection moves over. Kept separate from the renderer so the whole routing layer is
 * testable without a terminal.
 */

import type { Database } from "bun:sqlite"
import { listCouncilParties, listCouncilsInDistrict, listDistricts } from "../storage/queries/areas.ts"
import { availableCouncilTypes } from "../storage/queries/national.ts"
import type { Screen } from "./navigation.ts"
import { renderCandidates, renderCouncil, renderDistrict, renderDistrictList } from "./views/areas.ts"
import { renderNationalView } from "./views/national.ts"
import { renderSearch } from "./views/search.ts"
import { renderWatchlist } from "./views/watchlist.ts"

/** What pressing Enter on the selected row opens, if anything. */
export type SelectableTarget = Screen | null

export interface ScreenContent {
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

/** Builds everything needed to draw one screen. */
export function composeScreen(db: Database, screen: Screen, options: ScreenOptions): ScreenContent {
  switch (screen.kind) {
    case "national": {
      const lines = renderNationalView(db, {
        oznacTypu: options.councilType,
        width: options.width,
        now: options.now,
      })
      // The national overview is a summary, not a list to walk; Enter moves on to the
      // district list rather than selecting a row.
      return { lines, firstRow: lines.length, rowCount: 0, target: () => ({ kind: "districts" }) }
    }

    case "districts": {
      const districts = listDistricts(db)
      const lines = renderDistrictList(db, options.width)
      return {
        lines,
        firstRow: 4,
        rowCount: districts.length,
        target: (index) => {
          const district = districts[index]
          return district === undefined ? null : { kind: "district", nuts: district.nuts }
        },
      }
    }

    case "district": {
      const councils = listCouncilsInDistrict(db, screen.nuts)
      const lines = renderDistrict(db, screen.nuts, options.width)
      // Header rows vary with whether a loading note is present, so the first data row
      // is found rather than assumed.
      const firstRow = lines.findIndex((l) => l.startsWith("─")) + 3
      return {
        lines,
        firstRow,
        rowCount: councils.length,
        target: (index) => {
          const council = councils[index]
          return council === undefined ? null : { kind: "council", kodzastup: council.kodzastup }
        },
      }
    }

    case "council": {
      const parties = listCouncilParties(db, screen.kodzastup)
      const lines = renderCouncil(db, screen.kodzastup, options.width)
      // Matched on content rather than a leading string: the first column is
      // right-aligned, so its header line begins with padding spaces.
      const headerIndex = lines.findIndex((l) => l.includes("Volební strana"))
      return {
        lines,
        firstRow: headerIndex < 0 ? lines.length : headerIndex + 2,
        rowCount: parties.length,
        target: (index) => {
          const party = parties[index]
          return party === undefined
            ? null
            : {
                kind: "candidates",
                kodzastup: screen.kodzastup,
                vstrana: party.vstrana,
                ballotOrder: party.ballotOrder,
              }
        },
      }
    }

    case "candidates": {
      const lines = renderCandidates(db, screen.kodzastup, screen.vstrana, screen.ballotOrder, options.width)
      // The candidate list is the leaf of the drill-down; nothing opens from it.
      return { lines, firstRow: lines.length, rowCount: 0, target: () => null }
    }

    case "watchlist": {
      const view = renderWatchlist(db, options.width)
      return {
        lines: view.lines,
        firstRow: view.firstRow,
        rowCount: view.codes.length,
        target: (index) => {
          const code = view.codes[index]
          return code === undefined ? null : { kind: "council", kodzastup: code }
        },
      }
    }

    case "search": {
      const view = renderSearch(db, options.query ?? "", options.width)
      return {
        lines: view.lines,
        firstRow: view.firstRow,
        rowCount: view.hits.length,
        target: (index) => {
          const hit = view.hits[index]
          if (hit === undefined) return null
          // A party hit opens its candidate list directly; anything else opens the
          // council, which is the most useful landing place for a name.
          return hit.kind === "party" && hit.vstrana !== null
            ? { kind: "candidates", kodzastup: hit.kodzastup, vstrana: hit.vstrana, ballotOrder: null }
            : { kind: "council", kodzastup: hit.kodzastup }
        },
      }
    }

    default: {
      return {
        lines: [`Obrazovka ${screen.kind} zatím není k dispozici.`],
        firstRow: 1,
        rowCount: 0,
        target: () => null,
      }
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
