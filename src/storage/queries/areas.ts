/**
 * Read queries for the drill-down (tasks T055-T057).
 *
 * District and council queries live together because they share the council row shape
 * and the borough-grouping rule; splitting them would duplicate both.
 */

import type { Database } from "bun:sqlite"
import { type ChangeKind, compareValue } from "../../domain/status.ts"

export interface DistrictRow {
  nuts: string
  name: string
  /** Councils whose results have arrived, out of those known to be in this district. */
  councilsWithResults: number
  councilsKnown: number
  /** Null until this district's document has been retrieved (FR-018b). */
  loaded: boolean
}

export interface CouncilRow {
  kodzastup: string
  name: string
  /** OBEC = municipal assembly, MCMO = borough assembly. */
  oznacTypu: string
  parentKodzastup: string | null
  parentName: string | null
  /** Council kind, resolved to a name; falls back to the code (FR-011). */
  kindLabel: string
  seatsTotal: number | null
  districtsTotal: number
  districtsCounted: number
  turnoutPct: number | null
  isFinal: boolean
  /** Status when no election took place (edge case: councils with no result). */
  statusNote: string | null
  hasResult: boolean
  turnoutChange: ChangeKind
  countedChange: ChangeKind
}

export interface CouncilPartyRow {
  vstrana: string
  ballotOrder: number | null
  name: string
  votes: number
  votesPct: number | null
  seatsWon: number
  candidates: number | null
  votesChange: ChangeKind
  seatsChange: ChangeKind
}

export interface ElectedRow {
  vstrana: string
  ballotOrder: number | null
  ballotNumber: number
  name: string
  votes: number
  votesPct: number | null
}

/** Every district, with how much of it has arrived so far. */
export function listDistricts(db: Database): DistrictRow[] {
  const rows = db
    .query(
      `SELECT d.nuts, d.name,
              (SELECT COUNT(*) FROM council c WHERE c.district_nuts = d.nuts) AS known,
              (SELECT COUNT(*) FROM council c
                 JOIN result_snapshot s ON s.area_kind = 'council' AND s.area_id = c.kodzastup
                                       AND s.is_current = 1
                WHERE c.district_nuts = d.nuts) AS withResults
         FROM district d
        ORDER BY d.name`,
    )
    .all() as { nuts: string; name: string; known: number; withResults: number }[]

  return rows.map((row) => ({
    nuts: row.nuts,
    name: row.name,
    councilsKnown: row.known,
    councilsWithResults: row.withResults,
    // A district with no councils recorded has not had its document ingested yet.
    loaded: row.known > 0,
  }))
}

const COUNCIL_SELECT = `
  SELECT c.kodzastup, c.name, c.oznac_typu, c.parent_kodzastup, c.mandaty, c.stav_obce,
         p.name AS parent_name,
         COALESCE(t.name, c.druhzastup) AS kind_label,
         s.id AS snapshot_id, s.districts_total, s.districts_counted, s.turnout_pct, s.is_final,
         prev.turnout_pct AS prev_turnout, prev.districts_counted AS prev_counted
    FROM council c
    LEFT JOIN council p ON p.kodzastup = c.parent_kodzastup
    LEFT JOIN council_type t ON t.druhzastup = c.druhzastup
    LEFT JOIN result_snapshot s
           ON s.area_kind = 'council' AND s.area_id = c.kodzastup AND s.is_current = 1
    LEFT JOIN result_snapshot prev
           ON prev.area_kind = 'council' AND prev.area_id = c.kodzastup AND prev.is_current = 0
`

function toCouncilRow(row: Record<string, unknown>): CouncilRow {
  const num = (key: string): number | null => {
    const value = row[key]
    return typeof value === "number" ? value : null
  }
  const stav = row.stav_obce === null || row.stav_obce === undefined ? null : String(row.stav_obce)
  return {
    kodzastup: String(row.kodzastup),
    name: String(row.name),
    oznacTypu: String(row.oznac_typu),
    parentKodzastup: row.parent_kodzastup === null ? null : String(row.parent_kodzastup),
    parentName: row.parent_name === null || row.parent_name === undefined ? null : String(row.parent_name),
    // Falls back to the raw code when the code list is missing (FR-011).
    kindLabel: row.kind_label === null || row.kind_label === undefined ? "" : String(row.kind_label),
    seatsTotal: num("mandaty"),
    districtsTotal: num("districts_total") ?? 0,
    districtsCounted: num("districts_counted") ?? 0,
    turnoutPct: num("turnout_pct"),
    isFinal: num("is_final") === 1,
    statusNote: stav === null || stav === "0" ? null : `stav obce ${stav}`,
    hasResult: row.snapshot_id !== null && row.snapshot_id !== undefined,
    turnoutChange: compareValue(num("turnout_pct"), num("prev_turnout")),
    countedChange: compareValue(num("districts_counted"), num("prev_counted")),
  }
}

/**
 * Councils in one district.
 *
 * Municipal assemblies come first, each followed by its boroughs, so a subdivided
 * municipality reads as one group rather than scattering its parts alphabetically
 * (FR-035).
 */
export function listCouncilsInDistrict(db: Database, nuts: string): CouncilRow[] {
  const rows = db
    .query(
      `${COUNCIL_SELECT}
        WHERE c.district_nuts = $nuts
        ORDER BY COALESCE(c.parent_kodzastup, c.kodzastup),
                 CASE WHEN c.parent_kodzastup IS NULL THEN 0 ELSE 1 END,
                 c.name`,
    )
    .all({ nuts }) as Record<string, unknown>[]
  return rows.map(toCouncilRow)
}

/** One council. */
export function readCouncil(db: Database, kodzastup: string): CouncilRow | null {
  const row = db.query(`${COUNCIL_SELECT} WHERE c.kodzastup = $k`).get({ k: kodzastup }) as Record<
    string,
    unknown
  > | null
  return row === null ? null : toCouncilRow(row)
}

/** The boroughs of a municipality, if it has any (FR-035). */
export function listBoroughs(db: Database, parentKodzastup: string): CouncilRow[] {
  const rows = db
    .query(`${COUNCIL_SELECT} WHERE c.parent_kodzastup = $p ORDER BY c.name`)
    .all({ p: parentKodzastup }) as Record<string, unknown>[]
  return rows.map(toCouncilRow)
}

/** Electoral parties in one council, ordered by seats then votes. */
export function listCouncilParties(db: Database, kodzastup: string): CouncilPartyRow[] {
  const current = db
    .query("SELECT id FROM result_snapshot WHERE area_kind = 'council' AND area_id = $k AND is_current = 1")
    .get({ k: kodzastup }) as { id: number } | null
  if (current === null) return []

  const previous = db
    .query("SELECT id FROM result_snapshot WHERE area_kind = 'council' AND area_id = $k AND is_current = 0")
    .get({ k: kodzastup }) as { id: number } | null

  const rows = db
    .query(
      `SELECT vstrana, ballot_order, name, votes, votes_pct, seats_won, candidates
         FROM party_result WHERE snapshot_id = $id
        ORDER BY seats_won DESC, votes DESC, ballot_order ASC, rowid ASC`,
    )
    .all({ id: current.id }) as Record<string, unknown>[]

  // Keyed by party AND ballot position, because one party code can appear twice.
  const before = new Map<string, { votes: number; seats: number }>()
  if (previous !== null) {
    for (const row of db
      .query("SELECT vstrana, ballot_order, votes, seats_won FROM party_result WHERE snapshot_id = $id")
      .all({ id: previous.id }) as Record<string, unknown>[]) {
      before.set(`${String(row.vstrana)}#${String(row.ballot_order)}`, {
        votes: Number(row.votes ?? 0),
        seats: Number(row.seats_won ?? 0),
      })
    }
  }

  return rows.map((row) => {
    const key = `${String(row.vstrana)}#${String(row.ballot_order)}`
    const prev = before.get(key)
    const votes = Number(row.votes ?? 0)
    const seats = Number(row.seats_won ?? 0)
    return {
      vstrana: String(row.vstrana),
      ballotOrder: typeof row.ballot_order === "number" ? row.ballot_order : null,
      name: String(row.name),
      votes,
      votesPct: typeof row.votes_pct === "number" ? row.votes_pct : null,
      seatsWon: seats,
      candidates: typeof row.candidates === "number" ? row.candidates : null,
      votesChange: compareValue(votes, prev?.votes ?? null),
      seatsChange: compareValue(seats, prev?.seats ?? null),
    }
  })
}

/** Elected representatives of one party within a council (FR-034). */
export function listElected(
  db: Database,
  kodzastup: string,
  vstrana: string,
  ballotOrder: number | null,
): ElectedRow[] {
  const current = db
    .query("SELECT id FROM result_snapshot WHERE area_kind = 'council' AND area_id = $k AND is_current = 1")
    .get({ k: kodzastup }) as { id: number } | null
  if (current === null) return []

  const rows = db
    .query(
      `SELECT vstrana, ballot_order, ballot_number, given_name, family_name,
              title_before, title_after, votes, votes_pct
         FROM candidate_result
        WHERE snapshot_id = $id AND vstrana = $v
          AND COALESCE(ballot_order, -1) = COALESCE($b, -1)
        ORDER BY ballot_number`,
    )
    .all({ id: current.id, v: vstrana, b: ballotOrder }) as Record<string, unknown>[]

  return rows.map((row) => {
    const parts = [row.title_before, row.given_name, row.family_name, row.title_after]
      .map((p) => (p === null || p === undefined ? "" : String(p)))
      .filter((p) => p !== "")
    return {
      vstrana: String(row.vstrana),
      ballotOrder: typeof row.ballot_order === "number" ? row.ballot_order : null,
      ballotNumber: Number(row.ballot_number ?? 0),
      name: parts.join(" "),
      votes: Number(row.votes ?? 0),
      votesPct: typeof row.votes_pct === "number" ? row.votes_pct : null,
    }
  })
}

/**
 * The full candidate list for a party in a council, from the registry (FR-034).
 *
 * Reaches the candidates through `council_party`, which is the only thing carrying both
 * the result's VSTRANA and the registry's OSTRANA. Returns an empty list when reference
 * data was never loaded, in which case the caller falls back to the elected members the
 * result document carries.
 */
export function listRegisteredCandidates(
  db: Database,
  kodzastup: string,
  vstrana: string,
): { ballotNumber: number; name: string; votes: number | null; elected: boolean }[] {
  // The registry supplies the FULL list but is published before the election, so its
  // vote counts are all zero and nobody is marked elected. The live result document
  // supplies real votes, but only for those elected. Neither alone answers FR-034, so
  // the registry provides the roster and the result overlays what it knows.
  const rows = db
    .query(
      `SELECT k.por_str_hl AS ballot_number, k.name,
              k.votes AS registry_votes, k.elected AS registry_elected,
              r.votes AS result_votes, r.elected AS result_elected
         FROM council_party cp
         JOIN candidate k ON k.kodzastup = cp.kodzastup AND k.ostrana = cp.ostrana
         LEFT JOIN result_snapshot s
                ON s.area_kind = 'council' AND s.area_id = cp.kodzastup AND s.is_current = 1
         LEFT JOIN candidate_result r
                ON r.snapshot_id = s.id AND r.vstrana = cp.vstrana
               AND r.ballot_number = k.por_str_hl
        WHERE cp.kodzastup = $k AND cp.vstrana = $v
        ORDER BY k.por_str_hl`,
    )
    .all({ k: kodzastup, v: vstrana }) as Record<string, unknown>[]

  return rows.map((row) => {
    const resultVotes = typeof row.result_votes === "number" ? row.result_votes : null
    return {
      ballotNumber: Number(row.ballot_number ?? 0),
      name: String(row.name),
      // Only the live result is trusted. The registry's vote column is always zero,
      // because the archive is published before the election and never updated, and the
      // result document lists ONLY elected members. So a candidate with no result row
      // has an UNKNOWN vote count, not zero - and showing zero would state a figure the
      // source never published (FR-029). It renders as a dash.
      votes: resultVotes,
      elected: Number(row.result_elected ?? 0) === 1,
    }
  })
}
