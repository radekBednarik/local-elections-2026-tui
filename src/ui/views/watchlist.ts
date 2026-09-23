/**
 * Watchlist view (task T084, migrated to semantic rows in T116).
 *
 * Several councils side by side, each refreshing in place. The point of the screen is
 * to watch a handful of places at once without navigating between them, so it shows the
 * same headline figures the district list does, for a hand-picked set.
 */

import type { Database } from "bun:sqlite"
import { readCouncil } from "../../storage/queries/areas.ts"
import { listWatchlist } from "../../storage/queries/watchlist.ts"
import {
  type Column,
  clampLines,
  formatInteger,
  formatPercent,
  formatProgress,
  rule,
  withChange,
} from "../format.ts"
import { blank, cell, line, roleForChange, type SemanticRow, tableHeader, toTextLines } from "../row.ts"
import { applySort, type SortState, UNSORTED } from "../sort.ts"

/**
 * Sortable value per displayed column.
 *
 * Only the name is known without a second query; the figures live on the council the
 * panel reads separately, so the remaining columns fall back to the name. Sorting a
 * watchlist by turnout would mean reading every watched council to compare them, which
 * is work the user did not ask for on a list they curated by hand.
 */
function watchKey(entry: { name: string }, _column: number): string {
  return entry.name
}

export interface WatchlistRows {
  rows: SemanticRow[]
  /** Council codes in display order, so a row can be opened. */
  codes: string[]
  firstRow: number
}

export interface WatchlistView extends WatchlistRows {
  lines: string[]
}

export function buildWatchlistRows(db: Database, width = 100, sort: SortState = UNSORTED): WatchlistRows {
  const watched = applySort(listWatchlist(db), sort, watchKey)
  const rows: SemanticRow[] = [line("Sledovaná zastupitelstva", "heading"), line(rule(width), "muted")]

  if (watched.length === 0) {
    rows.push(blank())
    rows.push(line("Zatím nesledujete žádné zastupitelstvo."))
    rows.push(line("Otevřete zastupitelstvo a klávesou „w“ je přidejte do sledovaných.", "muted"))
    return { rows, codes: [], firstRow: rows.length }
  }

  const columns: Column[] = [
    { header: "Zastupitelstvo", width: Math.max(24, width - 52) },
    { header: "Okrsky", width: 14, align: "right" },
    { header: "Účast", width: 11, align: "right" },
    { header: "Mandáty", width: 9, align: "right" },
    { header: "Stav", width: 14 },
  ]
  const firstRow = rows.length + 2
  rows.push(...tableHeader(columns, sort))

  for (const entry of watched) {
    const council = readCouncil(db, entry.kodzastup)
    const label = entry.parentName === null ? entry.name : `${entry.name} (${entry.parentName})`

    if (council === null || !council.hasResult) {
      // A watched council with no data yet says so, rather than vanishing from a list
      // the user deliberately curated.
      rows.push({
        kind: "data",
        columns,
        cells: [cell(label), cell("–"), cell("–"), cell("–"), cell("čeká se", "muted")],
      })
      continue
    }

    rows.push({
      kind: "data",
      columns,
      cells: [
        cell(label),
        cell(
          withChange(formatProgress(council.districtsCounted, council.districtsTotal), council.countedChange),
          roleForChange(council.countedChange),
        ),
        cell(
          withChange(formatPercent(council.turnoutPct), council.turnoutChange),
          roleForChange(council.turnoutChange),
        ),
        cell(formatInteger(council.seatsTotal)),
        cell(council.isFinal ? "konečné" : "průběžné"),
      ],
    })
  }

  return { rows, codes: watched.map((w) => w.kodzastup), firstRow }
}

export function renderWatchlist(db: Database, width = 100, sort: SortState = UNSORTED): WatchlistView {
  const built = buildWatchlistRows(db, width, sort)
  return { ...built, lines: clampLines(toTextLines(built.rows), width) }
}
