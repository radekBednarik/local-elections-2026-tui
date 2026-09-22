/**
 * Turning the displayed tables into exportable rows (tasks T088-T091).
 *
 * Exports carry the same figures shown on screen, taken from the same queries, so the
 * two can never disagree. Nothing is recomputed on the way out (FR-029).
 */

import type { Database } from "bun:sqlite"
import { listCouncilParties, listCouncilsInDistrict, readCouncil } from "../storage/queries/areas.ts"
import { readNationalParties, readNationalTotals } from "../storage/queries/national.ts"
import type { Screen } from "../ui/navigation.ts"
import { buildCsv, type ExportMeta, numberCell } from "./csv.ts"

export interface ExportableTable {
  meta: ExportMeta
  headers: string[]
  rows: string[][]
  /** Suggested file stem, before the timestamp and extension. */
  areaLabel: string
}

/** Builds the exportable table for a screen, or null when it has no table. */
export function tableForScreen(
  db: Database,
  screen: Screen,
  options: { councilType?: string; now?: Date } = {},
): ExportableTable | null {
  const exportedAt = (options.now ?? new Date()).toISOString().slice(0, 19)

  if (screen.kind === "national") {
    const totals = readNationalTotals(db, options.councilType ?? "OBEC")
    if (totals === null) return null
    const parties = readNationalParties(db, options.councilType ?? "OBEC", 1000)
    return {
      areaLabel: "cr",
      meta: {
        area: "Česká republika",
        areaCode: totals.oznacTypu,
        publishedAt: totals.publishedAt,
        isFinal: totals.isFinal,
        exportedAt,
      },
      headers: ["Volební strana", "Kód strany", "Hlasy", "Podíl hlasů %", "Mandáty", "Podíl mandátů %"],
      rows: parties.map((p) => [
        p.name,
        p.vstrana,
        numberCell(p.votes),
        numberCell(p.votesPct, 2),
        numberCell(p.seatsWon),
        numberCell(p.seatsPct, 2),
      ]),
    }
  }

  if (screen.kind === "district") {
    const councils = listCouncilsInDistrict(db, screen.nuts)
    if (councils.length === 0) return null
    return {
      areaLabel: screen.nuts,
      meta: {
        area: `Okres ${screen.nuts}`,
        areaCode: screen.nuts,
        // A district file stamps every council it contains with the same generation
        // time, so any of them speaks for the document.
        publishedAt: councils.find((c) => c.publishedAt !== null)?.publishedAt ?? "neuvedeno",
        // A district is final only when every council in it is.
        isFinal: councils.every((c) => c.isFinal),
        exportedAt,
      },
      headers: [
        "Zastupitelstvo",
        "Kód",
        "Typ",
        "Nadřazená obec",
        "Okrsky sečteno",
        "Okrsky celkem",
        "Účast %",
        "Mandáty",
        "Stav",
      ],
      rows: councils.map((c) => [
        c.name,
        c.kodzastup,
        c.oznacTypu,
        c.parentName ?? "",
        numberCell(c.districtsCounted),
        numberCell(c.districtsTotal),
        numberCell(c.turnoutPct, 2),
        numberCell(c.seatsTotal),
        c.hasResult ? (c.isFinal ? "konečné" : "průběžné") : "bez výsledku",
      ]),
    }
  }

  if (screen.kind === "council" || screen.kind === "candidates") {
    const kodzastup = screen.kodzastup
    const council = readCouncil(db, kodzastup)
    if (council === null) return null
    const parties = listCouncilParties(db, kodzastup)
    return {
      areaLabel: council.name,
      meta: {
        area: council.parentName === null ? council.name : `${council.name} (${council.parentName})`,
        areaCode: kodzastup,
        // SC-017: no exported figure may be untraceable, so the publisher timestamp
        // travels with the data rather than being left as a placeholder.
        publishedAt: council.publishedAt ?? "neuvedeno",
        isFinal: council.isFinal,
        exportedAt,
      },
      headers: ["Č.", "Volební strana", "Kód strany", "Hlasy", "Podíl hlasů %", "Mandáty", "Kandidátů"],
      rows: parties.map((p) => [
        p.ballotOrder === null ? "" : String(p.ballotOrder),
        p.name,
        p.vstrana,
        numberCell(p.votes),
        numberCell(p.votesPct, 2),
        numberCell(p.seatsWon),
        numberCell(p.candidates),
      ]),
    }
  }

  return null
}

/** Renders an exportable table as a complete CSV document. */
export function csvForScreen(
  db: Database,
  screen: Screen,
  options: { councilType?: string; now?: Date } = {},
): { content: string; areaLabel: string } | null {
  const table = tableForScreen(db, screen, options)
  if (table === null) return null
  return { content: buildCsv(table.meta, table.headers, table.rows), areaLabel: table.areaLabel }
}
