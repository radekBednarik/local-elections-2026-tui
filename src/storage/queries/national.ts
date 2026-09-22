/**
 * Read queries for the national overview (task T044).
 *
 * Every figure comes straight out of storage. Ordering is the only thing decided here,
 * and where the source reports a tie the source's own order is preserved (FR-029).
 */

import type { Database } from "bun:sqlite"
import { type ChangeKind, compareValue } from "../../domain/status.ts"

/** Extends CountStatus so it can be passed straight to statusLabel(). */
export interface NationalTotals {
  oznacTypu: string
  /** As published. Named to match CountStatus so the two are interchangeable. */
  publishedPct: number | null
  publishedAt: string
  fetchedAt: string
  districtsTotal: number
  districtsCounted: number
  districtsPct: number | null
  votersRegistered: number | null
  envelopesIssued: number | null
  validVotes: number | null
  turnoutPct: number | null
  seatsTotal: number | null
  isFinal: boolean
  /** How each headline figure moved since the previous refresh (FR-036). */
  changes: {
    districtsCounted: ChangeKind
    turnoutPct: ChangeKind
    validVotes: ChangeKind
  }
}

export interface PartyRow {
  vstrana: string
  name: string
  votes: number
  votesPct: number | null
  seatsWon: number
  seatsPct: number | null
  votesChange: ChangeKind
  seatsChange: ChangeKind
}

type SnapshotRow = Record<string, number | string | null>

function snapshot(db: Database, oznacTypu: string, current: boolean): SnapshotRow | null {
  return db
    .query(
      `SELECT * FROM result_snapshot
        WHERE area_kind = 'national' AND area_id = '' AND oznac_typu = $t AND is_current = $c`,
    )
    .get({ t: oznacTypu, c: current ? 1 : 0 }) as SnapshotRow | null
}

/** Headline national figures for one council type, with change markers. */
export function readNationalTotals(db: Database, oznacTypu = "OBEC"): NationalTotals | null {
  const now = snapshot(db, oznacTypu, true)
  if (now === null) return null
  const before = snapshot(db, oznacTypu, false)

  const num = (row: SnapshotRow | null, key: string): number | null => {
    const value = row?.[key]
    return typeof value === "number" ? value : null
  }

  return {
    oznacTypu,
    publishedAt: String(now.published_at),
    fetchedAt: String(now.fetched_at),
    districtsTotal: Number(now.districts_total ?? 0),
    districtsCounted: Number(now.districts_counted ?? 0),
    districtsPct: num(now, "districts_pct"),
    publishedPct: num(now, "districts_pct"),
    votersRegistered: num(now, "voters_registered"),
    envelopesIssued: num(now, "envelopes_issued"),
    validVotes: num(now, "valid_votes"),
    turnoutPct: num(now, "turnout_pct"),
    seatsTotal: num(now, "seats_total"),
    isFinal: Number(now.is_final ?? 0) === 1,
    changes: {
      districtsCounted: compareValue(num(now, "districts_counted"), num(before, "districts_counted")),
      turnoutPct: compareValue(num(now, "turnout_pct"), num(before, "turnout_pct")),
      validVotes: compareValue(num(now, "valid_votes"), num(before, "valid_votes")),
    },
  }
}

/**
 * Parties in the national result, ordered by seats then votes.
 *
 * Ordering is a display decision and is applied consistently; it does not alter any
 * figure, and equal values keep the order the source supplied them in.
 */
export function readNationalParties(db: Database, oznacTypu = "OBEC", limit = 100): PartyRow[] {
  const now = snapshot(db, oznacTypu, true)
  if (now === null) return []
  const before = snapshot(db, oznacTypu, false)

  const rows = db
    .query(
      `SELECT vstrana, name, votes, votes_pct, seats_won, seats_pct
         FROM party_result WHERE snapshot_id = $id
        ORDER BY seats_won DESC, votes DESC, rowid ASC
        LIMIT $limit`,
    )
    .all({ id: Number(now.id), limit }) as Record<string, number | string | null>[]

  const previous = new Map<string, { votes: number | null; seats: number | null }>()
  if (before !== null) {
    const prevRows = db
      .query("SELECT vstrana, votes, seats_won FROM party_result WHERE snapshot_id = $id")
      .all({ id: Number(before.id) }) as Record<string, number | string | null>[]
    for (const row of prevRows) {
      previous.set(String(row.vstrana), {
        votes: typeof row.votes === "number" ? row.votes : null,
        seats: typeof row.seats_won === "number" ? row.seats_won : null,
      })
    }
  }

  return rows.map((row) => {
    const prev = previous.get(String(row.vstrana))
    const votes = Number(row.votes ?? 0)
    const seats = Number(row.seats_won ?? 0)
    return {
      vstrana: String(row.vstrana),
      name: String(row.name),
      votes,
      votesPct: typeof row.votes_pct === "number" ? row.votes_pct : null,
      seatsWon: seats,
      seatsPct: typeof row.seats_pct === "number" ? row.seats_pct : null,
      votesChange: compareValue(votes, prev?.votes ?? null),
      seatsChange: compareValue(seats, prev?.seats ?? null),
    }
  })
}

/** Which council types the national document reported, e.g. OBEC and MCMO. */
export function availableCouncilTypes(db: Database): string[] {
  const rows = db
    .query(
      `SELECT DISTINCT oznac_typu FROM result_snapshot
        WHERE area_kind = 'national' AND is_current = 1 AND oznac_typu IS NOT NULL
        ORDER BY oznac_typu DESC`,
    )
    .all() as { oznac_typu: string }[]
  return rows.map((r) => r.oznac_typu)
}
