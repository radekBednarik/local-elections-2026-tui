/**
 * Drill-down views: districts, one district, one council, the candidates of one party
 * (tasks T058-T060, T063-T065; migrated to semantic rows in T115, first-row index added
 * in T117).
 *
 * Each builder returns rows plus the index of the first SELECTABLE row. That index used
 * to be rediscovered in screen.ts by searching the rendered text for a box-drawing
 * character, which found the rule under the title rather than the column underline and
 * was two rows short whenever a loading note sat between them. The builder knows where
 * its table starts, so it says so.
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
  readDistrictName,
} from "../../storage/queries/areas.ts"
import {
  type Column,
  clampLines,
  formatInteger,
  formatPercent,
  formatProgress,
  headerRow,
  rule,
  withChange,
} from "../format.ts"
import { blank, type Cell, cell, line, roleForChange, type SemanticRow, toTextLines } from "../row.ts"

/**
 * A built view: its rows, and where the selectable ones begin.
 *
 * `firstRow` equals `rows.length` when nothing on the screen can be selected, which is
 * what the navigation layer already expects.
 */
export interface BuiltView {
  rows: SemanticRow[]
  firstRow: number
}

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

/** Renders a built view to plain text lines, clamped to the terminal width. */
function toLines(view: BuiltView, width: number): string[] {
  return clampLines(toTextLines(view.rows), width)
}

/** The list of districts, with how much of each has arrived. */
export function renderDistrictList(db: Database, width = 100): string[] {
  return toLines(buildDistrictListRows(db, width), width)
}

export function buildDistrictListRows(db: Database, width: number): BuiltView {
  const districts = listDistricts(db)
  const rows: SemanticRow[] = [line("Okresy", "heading"), line(rule(width), "muted")]

  if (districts.length === 0) {
    rows.push(line("Číselník okresů zatím není načten."))
    return { rows, firstRow: rows.length }
  }

  const columns: Column[] = [
    { header: "Okres", width: Math.max(24, width - 34) },
    { header: "NUTS", width: 8 },
    { header: "Zastupitelstva", width: 20, align: "right" },
  ]
  const [header, underline] = headerRow(columns)
  rows.push(line(header, "heading"), line(underline, "muted"))
  const firstRow = rows.length

  for (const district of districts) {
    rows.push({
      columns,
      cells: [
        cell(district.name),
        cell(district.nuts, "muted"),
        district.loaded
          ? cell(formatProgress(district.councilsWithResults, district.councilsKnown))
          : cell("načítá se…", "muted"),
      ],
    })
  }
  return { rows, firstRow }
}

/** Councils within one district, boroughs grouped under their municipality. */
export function renderDistrict(db: Database, nuts: string, width = 100): string[] {
  return toLines(buildDistrictRows(db, nuts, width), width)
}

export function buildDistrictRows(db: Database, nuts: string, width: number): BuiltView {
  const councils = listCouncilsInDistrict(db, nuts)
  // The name where one is known, the code only when the codelist has not loaded: a raw
  // NUTS code where a name exists is what FR-011 forbids, and the breadcrumb above this
  // heading was already showing the name.
  const title = `Okres ${readDistrictName(db, nuts) ?? nuts}`
  const rows: SemanticRow[] = [line(title, "heading"), line(rule(width), "muted")]

  if (councils.length === 0) {
    rows.push(line("Data tohoto okresu se zatím nenačetla."))
    rows.push(line("Aplikace je stahuje na pozadí; zobrazí se, jakmile dorazí.", "muted"))
    return { rows, firstRow: rows.length }
  }

  const note = loadingNote(councils.filter((c) => c.hasResult).length, councils.length)
  if (note !== null) rows.push(line(note, "muted"), blank())

  const columns: Column[] = [
    { header: "Zastupitelstvo", width: Math.max(24, width - 52) },
    { header: "Okrsky", width: 14, align: "right" },
    { header: "Účast", width: 11, align: "right" },
    { header: "Mandáty", width: 9, align: "right" },
    { header: "Stav", width: 14 },
  ]
  const [header, underline] = headerRow(columns)
  rows.push(line(header, "heading"), line(underline, "muted"))
  const firstRow = rows.length

  for (const council of councils) {
    // A borough is indented under its parent so the grouping is visible (FR-035).
    const indent = council.parentKodzastup === null ? "" : "  └ "
    rows.push({ columns, cells: [cell(indent + council.name), ...councilCells(council)] })
  }
  return { rows, firstRow }
}

/** The four right-hand cells shared by the district list and the watchlist. */
function councilCells(council: CouncilRow): Cell[] {
  if (!council.hasResult) {
    return [
      cell("–"),
      cell("–"),
      cell(formatInteger(council.seatsTotal)),
      cell(council.statusNote ?? "čeká se", "muted"),
    ]
  }
  return [
    cell(
      withChange(formatProgress(council.districtsCounted, council.districtsTotal), council.countedChange),
      roleForChange(council.countedChange),
    ),
    cell(withChange(formatPercent(council.turnoutPct), council.turnoutChange), {
      bar: council.turnoutPct === null ? undefined : council.turnoutPct / 100,
      role: roleForChange(council.turnoutChange),
    }),
    cell(formatInteger(council.seatsTotal)),
    cell(council.isFinal ? "konečné" : "průběžné"),
  ]
}

/** One council: its parties, seats and status. */
export function renderCouncil(db: Database, kodzastup: string, width = 100): string[] {
  return toLines(buildCouncilRows(db, kodzastup, width), width)
}

export function buildCouncilRows(db: Database, kodzastup: string, width: number): BuiltView {
  const council = readCouncil(db, kodzastup)
  if (council === null) {
    const rows = [
      line("Zastupitelstvo nebylo nalezeno.", "warning"),
      blank(),
      line(`Kód: ${kodzastup}`, "muted"),
    ]
    return { rows, firstRow: rows.length }
  }

  const title = council.parentName === null ? council.name : `${council.name} (${council.parentName})`
  const rows: SemanticRow[] = [line(title, "heading"), line(rule(width), "muted")]
  if (council.kindLabel !== "") rows.push(line(council.kindLabel, "muted"))

  if (!council.hasResult) {
    // An election that did not take place must show its status, never zero votes.
    rows.push(blank())
    rows.push(
      line(
        council.statusNote === null
          ? "Výsledky tohoto zastupitelstva zatím nejsou k dispozici."
          : `Volby se zde nekonaly nebo byly zrušeny (${council.statusNote}).`,
        "warning",
      ),
    )
    rows.push(blank())
    rows.push(line(OKRSKY_NOTE, "muted"))
    return { rows, firstRow: rows.length }
  }

  rows.push(
    line(
      `Stav: ${statusLabel({
        districtsTotal: council.districtsTotal,
        districtsCounted: council.districtsCounted,
        publishedPct: null,
        isFinal: council.isFinal,
      })}   Okrsky: ${formatProgress(council.districtsCounted, council.districtsTotal)}   ` +
        `Účast: ${formatPercent(council.turnoutPct)}   Mandáty: ${formatInteger(council.seatsTotal)}`,
    ),
  )
  rows.push(blank())

  const parties = listCouncilParties(db, kodzastup)
  if (parties.length === 0) {
    rows.push(line("Žádné volební strany nejsou evidovány."))
    rows.push(blank())
    rows.push(line(OKRSKY_NOTE, "muted"))
    return { rows, firstRow: rows.length }
  }

  const columns: Column[] = [
    { header: "Č.", width: 4, align: "right" },
    { header: "Volební strana", width: Math.max(20, width - 46) },
    { header: "Hlasy", width: 12, align: "right" },
    { header: "Podíl", width: 11, align: "right" },
    { header: "Mandáty", width: 10, align: "right" },
  ]
  const [header, underline] = headerRow(columns)
  rows.push(line(header, "heading"), line(underline, "muted"))
  const firstRow = rows.length

  for (const party of parties) {
    rows.push({
      columns,
      cells: [
        cell(party.ballotOrder === null ? "–" : String(party.ballotOrder), "muted"),
        cell(party.name),
        cell(withChange(formatInteger(party.votes), party.votesChange), roleForChange(party.votesChange)),
        // The bar rides with the published share and is drawn beside it, never instead
        // of it (FR-070, FR-071).
        cell(formatPercent(party.votesPct), {
          bar: party.votesPct === null ? undefined : party.votesPct / 100,
        }),
        cell(withChange(formatInteger(party.seatsWon), party.seatsChange), roleForChange(party.seatsChange)),
      ],
    })
  }

  const boroughs = listBoroughs(db, kodzastup)
  if (boroughs.length > 0) {
    rows.push(blank())
    rows.push(line(`Městské části a obvody (${boroughs.length})`))
    for (const borough of boroughs) {
      rows.push(line(`  ${borough.name}   ${formatPercent(borough.turnoutPct)}`))
    }
  }

  rows.push(blank())
  rows.push(line(OKRSKY_NOTE, "muted"))
  return { rows, firstRow }
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
  return toLines(buildCandidatesRows(db, kodzastup, vstrana, ballotOrder, width), width)
}

export function buildCandidatesRows(
  db: Database,
  kodzastup: string,
  vstrana: string,
  ballotOrder: number | null,
  width: number,
): BuiltView {
  const council = readCouncil(db, kodzastup)
  const parties = listCouncilParties(db, kodzastup)
  const party = parties.find(
    (p) => p.vstrana === vstrana && (ballotOrder === null || p.ballotOrder === ballotOrder),
  )

  const rows: SemanticRow[] = [
    line(`${party?.name ?? `Volební strana ${vstrana}`} — ${council?.name ?? kodzastup}`, "heading"),
    line(rule(width), "muted"),
  ]

  const registered = listRegisteredCandidates(db, kodzastup, vstrana)
  const columns: Column[] = [
    { header: "Poř.", width: 6, align: "right" },
    { header: "Kandidát", width: Math.max(24, width - 34) },
    { header: "Hlasy", width: 10, align: "right" },
    { header: "Mandát", width: 8 },
  ]
  const [header, underline] = headerRow(columns)

  if (registered.length > 0) {
    rows.push(line(`Kandidátní listina (${registered.length})`))
    // The published result lists only elected members, so a dash here means the figure
    // was never published, not that the candidate received nothing.
    rows.push(line("Přednostní hlasy se zveřejňují pouze u zvolených; „–“ znamená neuvedeno.", "muted"))
    rows.push(line(header, "heading"), line(underline, "muted"))
    for (const candidate of registered) {
      rows.push({
        columns,
        cells: [
          cell(String(candidate.ballotNumber), "muted"),
          cell(candidate.name),
          cell(formatInteger(candidate.votes)),
          cell(candidate.elected ? "ano" : ""),
        ],
      })
    }
    // The candidate list is the leaf of the drill-down: nothing opens from a row here,
    // so no row is selectable.
    return { rows, firstRow: rows.length }
  }

  const elected = listElected(db, kodzastup, vstrana, ballotOrder)
  if (elected.length === 0) {
    rows.push(line("Pro tuto volební stranu nejsou k dispozici žádní kandidáti."))
    return { rows, firstRow: rows.length }
  }

  rows.push(line("Zvolení zastupitelé (úplná kandidátní listina není načtena)"))
  rows.push(line(header, "heading"), line(underline, "muted"))
  for (const person of elected) {
    rows.push({
      columns,
      cells: [
        cell(String(person.ballotNumber), "muted"),
        cell(person.name),
        cell(formatInteger(person.votes)),
        cell("ano"),
      ],
    })
  }
  return { rows, firstRow: rows.length }
}
