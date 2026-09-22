/**
 * Drill-down views: districts, one district, one council, one party's candidates
 * (tasks T058-T060, T063-T065).
 *
 * As with the national view, each returns text lines so the whole layer is testable as
 * data rather than only through a renderer.
 */

import type { Database } from "bun:sqlite"
import { statusLabel } from "../../domain/status.ts"
import {
  type CouncilRow,
  listBoroughs,
  listCouncilParties,
  listCouncilsInDistrict,
  listDistricts,
  listElected,
  listRegisteredCandidates,
  readCouncil,
} from "../../storage/queries/areas.ts"
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

/**
 * Stated wherever a user would reasonably expect per-polling-district figures.
 *
 * FR-013: that level is published only through the batch sources, which are out of
 * scope, so the boundary is stated rather than shown as an empty view.
 */
export const OKRSKY_NOTE =
  "Výsledky po jednotlivých okrscích nejsou k dispozici: zveřejňují se pouze dávkově, " +
  "což je mimo rozsah této aplikace."

/** How many councils are still waiting for data (FR-018b). */
function loadingNote(loaded: number, known: number): string | null {
  if (known === 0) return "Data okresu se načítají…"
  if (loaded < known) return `Načteno ${loaded} z ${known} zastupitelstev; zbytek se stahuje…`
  return null
}

/** The list of districts, with how much of each has arrived. */
export function renderDistrictList(db: Database, width = 100): string[] {
  return clampLines(buildDistrictList(db, width), width)
}

function buildDistrictList(db: Database, width: number): string[] {
  const districts = listDistricts(db)
  const lines = ["Okresy", rule(width)]

  if (districts.length === 0) {
    lines.push("Číselník okresů zatím není načten.")
    return lines
  }

  const columns: Column[] = [
    { header: "Okres", width: Math.max(24, width - 34) },
    { header: "NUTS", width: 8 },
    { header: "Zastupitelstva", width: 20, align: "right" },
  ]
  const [header, underline] = headerRow(columns)
  lines.push(header, underline)

  for (const district of districts) {
    lines.push(
      dataRow(columns, [
        district.name,
        district.nuts,
        district.loaded ? formatProgress(district.councilsWithResults, district.councilsKnown) : "načítá se…",
      ]),
    )
  }
  return lines
}

/** Councils within one district, boroughs grouped under their municipality. */
export function renderDistrict(db: Database, nuts: string, width = 100): string[] {
  return clampLines(buildDistrict(db, nuts, width), width)
}

function buildDistrict(db: Database, nuts: string, width: number): string[] {
  const councils = listCouncilsInDistrict(db, nuts)
  const lines = [`Okres ${nuts}`, rule(width)]

  if (councils.length === 0) {
    lines.push("Data tohoto okresu se zatím nenačetla.")
    lines.push("Aplikace je stahuje na pozadí; zobrazí se, jakmile dorazí.")
    return lines
  }

  const note = loadingNote(councils.filter((c) => c.hasResult).length, councils.length)
  if (note !== null) lines.push(note, "")

  const columns: Column[] = [
    { header: "Zastupitelstvo", width: Math.max(24, width - 52) },
    { header: "Okrsky", width: 14, align: "right" },
    { header: "Účast", width: 11, align: "right" },
    { header: "Mandáty", width: 9, align: "right" },
    { header: "Stav", width: 14 },
  ]
  const [header, underline] = headerRow(columns)
  lines.push(header, underline)

  for (const council of councils) {
    // A borough is indented under its parent so the grouping is visible (FR-035).
    const indent = council.parentKodzastup === null ? "" : "  └ "
    lines.push(dataRow(columns, [indent + council.name, ...councilCells(council)]))
  }
  return lines
}

/** The four right-hand cells shared by the district list and the council header. */
function councilCells(council: CouncilRow): string[] {
  if (!council.hasResult) {
    return ["–", "–", formatInteger(council.seatsTotal), council.statusNote ?? "čeká se"]
  }
  return [
    withChange(formatProgress(council.districtsCounted, council.districtsTotal), council.countedChange),
    withChange(formatPercent(council.turnoutPct), council.turnoutChange),
    formatInteger(council.seatsTotal),
    council.isFinal ? "konečné" : "průběžné",
  ]
}

/** One council: its parties, seats and status. */
export function renderCouncil(db: Database, kodzastup: string, width = 100): string[] {
  return clampLines(buildCouncil(db, kodzastup, width), width)
}

function buildCouncil(db: Database, kodzastup: string, width: number): string[] {
  const council = readCouncil(db, kodzastup)
  if (council === null) {
    return ["Zastupitelstvo nebylo nalezeno.", "", `Kód: ${kodzastup}`]
  }

  const title = council.parentName === null ? council.name : `${council.name} (${council.parentName})`
  const lines = [title, rule(width)]
  if (council.kindLabel !== "") lines.push(council.kindLabel)

  if (!council.hasResult) {
    // An election that did not take place must show its status, never zero votes.
    lines.push("")
    lines.push(
      council.statusNote === null
        ? "Výsledky tohoto zastupitelstva zatím nejsou k dispozici."
        : `Volby se zde nekonaly nebo byly zrušeny (${council.statusNote}).`,
    )
    lines.push("")
    lines.push(OKRSKY_NOTE)
    return lines
  }

  lines.push(
    `Stav: ${statusLabel({
      districtsTotal: council.districtsTotal,
      districtsCounted: council.districtsCounted,
      publishedPct: null,
      isFinal: council.isFinal,
    })}   Okrsky: ${formatProgress(council.districtsCounted, council.districtsTotal)}   ` +
      `Účast: ${formatPercent(council.turnoutPct)}   Mandáty: ${formatInteger(council.seatsTotal)}`,
  )
  lines.push("")

  const parties = listCouncilParties(db, kodzastup)
  if (parties.length === 0) {
    lines.push("Žádné volební strany nejsou evidovány.")
    lines.push("")
    lines.push(OKRSKY_NOTE)
    return lines
  }

  const columns: Column[] = [
    { header: "Č.", width: 4, align: "right" },
    { header: "Volební strana", width: Math.max(20, width - 46) },
    { header: "Hlasy", width: 12, align: "right" },
    { header: "Podíl", width: 11, align: "right" },
    { header: "Mandáty", width: 10, align: "right" },
  ]
  const [header, underline] = headerRow(columns)
  lines.push(header, underline)

  for (const party of parties) {
    lines.push(
      dataRow(columns, [
        party.ballotOrder === null ? "–" : String(party.ballotOrder),
        party.name,
        withChange(formatInteger(party.votes), party.votesChange),
        formatPercent(party.votesPct),
        withChange(formatInteger(party.seatsWon), party.seatsChange),
      ]),
    )
  }

  const boroughs = listBoroughs(db, kodzastup)
  if (boroughs.length > 0) {
    lines.push("")
    lines.push(`Městské části a obvody (${boroughs.length})`)
    for (const borough of boroughs) {
      lines.push(`  ${borough.name}   ${formatPercent(borough.turnoutPct)}`)
    }
  }

  lines.push("")
  lines.push(OKRSKY_NOTE)
  return lines
}

/**
 * Candidates of one party within a council (FR-034).
 *
 * Prefers the full registry list, which includes candidates who were not elected.
 * Falls back to the elected members carried in the result document when reference data
 * was never loaded, so the view degrades rather than emptying (FR-011).
 */
export function renderCandidates(
  db: Database,
  kodzastup: string,
  vstrana: string,
  ballotOrder: number | null,
  width = 100,
): string[] {
  return clampLines(buildCandidates(db, kodzastup, vstrana, ballotOrder, width), width)
}

function buildCandidates(
  db: Database,
  kodzastup: string,
  vstrana: string,
  ballotOrder: number | null,
  width: number,
): string[] {
  const council = readCouncil(db, kodzastup)
  const parties = listCouncilParties(db, kodzastup)
  const party = parties.find(
    (p) => p.vstrana === vstrana && (ballotOrder === null || p.ballotOrder === ballotOrder),
  )

  const lines = [`${party?.name ?? `Volební strana ${vstrana}`} — ${council?.name ?? kodzastup}`, rule(width)]

  const registered = listRegisteredCandidates(db, kodzastup, vstrana)
  const columns: Column[] = [
    { header: "Poř.", width: 6, align: "right" },
    { header: "Kandidát", width: Math.max(24, width - 34) },
    { header: "Hlasy", width: 10, align: "right" },
    { header: "Mandát", width: 8 },
  ]
  const [header, underline] = headerRow(columns)

  if (registered.length > 0) {
    lines.push(`Kandidátní listina (${registered.length})`)
    // The published result lists only elected members, so a dash here means the figure
    // was never published, not that the candidate received nothing.
    lines.push("Přednostní hlasy se zveřejňují pouze u zvolených; „–“ znamená neuvedeno.")
    lines.push(header, underline)
    for (const candidate of registered) {
      lines.push(
        dataRow(columns, [
          String(candidate.ballotNumber),
          candidate.name,
          formatInteger(candidate.votes),
          candidate.elected ? "ano" : "",
        ]),
      )
    }
    return lines
  }

  const elected = listElected(db, kodzastup, vstrana, ballotOrder)
  if (elected.length === 0) {
    lines.push("Pro tuto volební stranu nejsou k dispozici žádní kandidáti.")
    return lines
  }

  lines.push("Zvolení zastupitelé (úplná kandidátní listina není načtena)")
  lines.push(header, underline)
  for (const person of elected) {
    lines.push(
      dataRow(columns, [String(person.ballotNumber), person.name, formatInteger(person.votes), "ano"]),
    )
  }
  return lines
}
