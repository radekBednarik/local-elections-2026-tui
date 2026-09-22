/**
 * Watchlist view (task T084).
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
  dataRow,
  formatInteger,
  formatPercent,
  formatProgress,
  headerRow,
  rule,
  withChange,
} from "../format.ts"

export interface WatchlistView {
  lines: string[]
  /** Council codes in display order, so a row can be opened. */
  codes: string[]
  firstRow: number
}

export function renderWatchlist(db: Database, width = 100): WatchlistView {
  const watched = listWatchlist(db)
  const lines = ["Sledovaná zastupitelstva", rule(width)]

  if (watched.length === 0) {
    lines.push("")
    lines.push("Zatím nesledujete žádné zastupitelstvo.")
    lines.push("Otevřete zastupitelstvo a klávesou „w“ je přidejte do sledovaných.")
    return { lines: clampLines(lines, width), codes: [], firstRow: lines.length }
  }

  const columns: Column[] = [
    { header: "Zastupitelstvo", width: Math.max(24, width - 52) },
    { header: "Okrsky", width: 14, align: "right" },
    { header: "Účast", width: 11, align: "right" },
    { header: "Mandáty", width: 9, align: "right" },
    { header: "Stav", width: 14 },
  ]
  const [header, underline] = headerRow(columns)
  const firstRow = lines.length + 2
  lines.push(header, underline)

  for (const entry of watched) {
    const council = readCouncil(db, entry.kodzastup)
    const label = entry.parentName === null ? entry.name : `${entry.name} (${entry.parentName})`

    if (council === null || !council.hasResult) {
      // A watched council with no data yet says so, rather than vanishing from a list
      // the user deliberately curated.
      lines.push(dataRow(columns, [label, "–", "–", "–", "čeká se"]))
      continue
    }

    lines.push(
      dataRow(columns, [
        label,
        withChange(formatProgress(council.districtsCounted, council.districtsTotal), council.countedChange),
        withChange(formatPercent(council.turnoutPct), council.turnoutChange),
        formatInteger(council.seatsTotal),
        council.isFinal ? "konečné" : "průběžné",
      ]),
    )
  }

  return { lines: clampLines(lines, width), codes: watched.map((w) => w.kodzastup), firstRow }
}
