/**
 * Snapshot storage (task T025).
 *
 * Holds the rule that FR-036a and FR-036 depend on, and that is easy to get wrong:
 *
 *   At most two rows exist per area - the current one and the one before it. Writing a
 *   NEW snapshot rotates the current row into the prior slot. But a snapshot whose
 *   figures are IDENTICAL to the current one must be discarded entirely, not rotated.
 *
 * Why that second half matters: sources are polled every 60 seconds, and most polls
 * return unchanged figures. If an identical re-fetch rotated the rows, the genuine
 * prior snapshot would be overwritten by a copy of the current one, every change
 * highlight would vanish within a minute, and FR-036 would appear to work in tests but
 * never in practice.
 */

import type { Database } from "bun:sqlite"
import { fold } from "../domain/folding.ts"

export type AreaKind = "national" | "district" | "council"

export interface PartyResultInput {
  vstrana: string
  ballotOrder: number | null
  name: string
  votes: number
  votesPct: number | null
  candidates: number | null
  seatsWon: number
  seatsPct: number | null
}

export interface CandidateResultInput {
  vstrana: string
  ballotNumber: number
  givenName: string
  familyName: string
  titleBefore: string | null
  titleAfter: string | null
  votes: number
  votesPct: number | null
}

export interface SnapshotInput {
  areaKind: AreaKind
  areaId: string
  /** Only the national document splits results by council type. */
  oznacTypu: string | null
  /** The publisher's DATUM_CAS_GENEROVANI. */
  publishedAt: string
  /** Local retrieval time, used only for staleness age. */
  fetchedAt: string
  districtsTotal: number
  districtsCounted: number
  districtsPct: number | null
  votersRegistered: number | null
  envelopesIssued: number | null
  envelopesReturned: number | null
  validVotes: number | null
  turnoutPct: number | null
  seatsTotal: number | null
  isFinal: boolean
  parties: PartyResultInput[]
  candidates?: CandidateResultInput[]
}

export type WriteOutcome =
  /** First data for this area. */
  | { kind: "inserted"; snapshotId: number }
  /** Figures changed: the previous snapshot became the prior one. */
  | { kind: "rotated"; snapshotId: number; previousId: number }
  /** Figures identical: nothing written, the prior snapshot is preserved. */
  | { kind: "unchanged"; snapshotId: number }

/**
 * A digest of everything a user can see.
 *
 * Deliberately excludes `fetchedAt` and `publishedAt`: the publisher restamps documents
 * on every generation cycle, so including the timestamp would make every poll look like
 * a change and defeat the whole purpose of this comparison.
 */
function digest(input: SnapshotInput): string {
  const parties = [...input.parties]
    .sort((a, b) => a.vstrana.localeCompare(b.vstrana))
    .map((p) => `${p.vstrana}:${p.votes}:${p.votesPct}:${p.seatsWon}`)
    .join("|")
  return [
    input.areaKind,
    input.areaId,
    input.oznacTypu ?? "",
    input.districtsTotal,
    input.districtsCounted,
    input.votersRegistered,
    input.envelopesIssued,
    input.envelopesReturned,
    input.validVotes,
    input.turnoutPct,
    input.seatsTotal,
    input.isFinal ? 1 : 0,
    parties,
  ].join("~")
}

interface CurrentRow {
  id: number
  digest: string
  published_at: string
}

function findCurrent(db: Database, input: SnapshotInput): CurrentRow | null {
  return db
    .query(
      `SELECT id, digest, published_at FROM result_snapshot
        WHERE area_kind = $kind AND area_id = $id
          AND COALESCE(oznac_typu, '') = COALESCE($typ, '')
          AND is_current = 1`,
    )
    .get({ kind: input.areaKind, id: input.areaId, typ: input.oznacTypu }) as CurrentRow | null
}

/**
 * Writes a snapshot, applying the rotation rule above.
 *
 * Everything happens in one transaction: a district document carries hundreds of
 * municipalities, and committing per row would be visibly slow during a live count.
 */
export function writeSnapshot(db: Database, input: SnapshotInput): WriteOutcome {
  const run = db.transaction((snapshot: SnapshotInput): WriteOutcome => {
    const incoming = digest(snapshot)
    const current = findCurrent(db, snapshot)

    if (current !== null) {
      if (current.digest === incoming) {
        // Identical figures. Refresh nothing but the retrieval time, so staleness is
        // still accurate, and leave the prior snapshot untouched.
        db.query("UPDATE result_snapshot SET fetched_at = $f WHERE id = $id").run({
          f: snapshot.fetchedAt,
          id: current.id,
        })
        return { kind: "unchanged", snapshotId: current.id }
      }

      // Figures changed. Older published data must not overwrite newer (FR-028).
      if (snapshot.publishedAt < current.published_at) {
        return { kind: "unchanged", snapshotId: current.id }
      }

      // Drop any existing prior row, then demote the current one into that slot.
      db.query(
        `DELETE FROM result_snapshot
          WHERE area_kind = $kind AND area_id = $id
            AND COALESCE(oznac_typu, '') = COALESCE($typ, '')
            AND is_current = 0`,
      ).run({ kind: snapshot.areaKind, id: snapshot.areaId, typ: snapshot.oznacTypu })
      db.query("UPDATE result_snapshot SET is_current = 0 WHERE id = $id").run({ id: current.id })

      const inserted = insertSnapshot(db, snapshot, incoming)
      return { kind: "rotated", snapshotId: inserted, previousId: current.id }
    }

    return { kind: "inserted", snapshotId: insertSnapshot(db, snapshot, incoming) }
  })

  return run(input)
}

function insertSnapshot(db: Database, input: SnapshotInput, contentDigest: string): number {
  db.query(
    `INSERT INTO result_snapshot (
       area_kind, area_id, oznac_typu, published_at, fetched_at,
       districts_total, districts_counted, districts_pct,
       voters_registered, envelopes_issued, envelopes_returned, valid_votes,
       turnout_pct, seats_total, is_final, is_current, digest
     ) VALUES (
       $kind, $id, $typ, $published, $fetched,
       $dTotal, $dCounted, $dPct,
       $voters, $issued, $returned, $valid,
       $turnout, $seats, $final, 1, $digest
     )`,
  ).run({
    kind: input.areaKind,
    id: input.areaId,
    typ: input.oznacTypu,
    published: input.publishedAt,
    fetched: input.fetchedAt,
    dTotal: input.districtsTotal,
    dCounted: input.districtsCounted,
    dPct: input.districtsPct,
    voters: input.votersRegistered,
    issued: input.envelopesIssued,
    returned: input.envelopesReturned,
    valid: input.validVotes,
    turnout: input.turnoutPct,
    seats: input.seatsTotal,
    final: input.isFinal ? 1 : 0,
    digest: contentDigest,
  })

  const row = db.query("SELECT last_insert_rowid() AS id").get() as { id: number }
  const snapshotId = row.id

  const insertParty = db.query(
    `INSERT INTO party_result (
       snapshot_id, vstrana, ballot_order, name, name_folded,
       votes, votes_pct, candidates, seats_won, seats_pct
     ) VALUES ($s, $v, $order, $name, $folded, $votes, $pct, $cand, $seats, $seatsPct)`,
  )
  for (const party of input.parties) {
    insertParty.run({
      s: snapshotId,
      v: party.vstrana,
      order: party.ballotOrder,
      name: party.name,
      folded: fold(party.name),
      votes: party.votes,
      pct: party.votesPct,
      cand: party.candidates,
      seats: party.seatsWon,
      seatsPct: party.seatsPct,
    })
  }

  const insertCandidate = db.query(
    `INSERT INTO candidate_result (
       snapshot_id, vstrana, ballot_number, given_name, family_name, name_folded,
       title_before, title_after, votes, votes_pct, elected
     ) VALUES ($s, $v, $n, $given, $family, $folded, $tb, $ta, $votes, $pct, 1)`,
  )
  for (const candidate of input.candidates ?? []) {
    insertCandidate.run({
      s: snapshotId,
      v: candidate.vstrana,
      n: candidate.ballotNumber,
      given: candidate.givenName,
      family: candidate.familyName,
      folded: fold(`${candidate.givenName} ${candidate.familyName}`),
      tb: candidate.titleBefore,
      ta: candidate.titleAfter,
      votes: candidate.votes,
      pct: candidate.votesPct,
    })
  }

  return snapshotId
}

/** The current snapshot row for an area, or null. */
export function readCurrent(
  db: Database,
  areaKind: AreaKind,
  areaId: string,
  oznacTypu: string | null = null,
): Record<string, unknown> | null {
  return db
    .query(
      `SELECT * FROM result_snapshot
        WHERE area_kind = $kind AND area_id = $id
          AND COALESCE(oznac_typu, '') = COALESCE($typ, '')
          AND is_current = 1`,
    )
    .get({ kind: areaKind, id: areaId, typ: oznacTypu }) as Record<string, unknown> | null
}

/** The prior snapshot row for an area, used to highlight what changed. */
export function readPrevious(
  db: Database,
  areaKind: AreaKind,
  areaId: string,
  oznacTypu: string | null = null,
): Record<string, unknown> | null {
  return db
    .query(
      `SELECT * FROM result_snapshot
        WHERE area_kind = $kind AND area_id = $id
          AND COALESCE(oznac_typu, '') = COALESCE($typ, '')
          AND is_current = 0`,
    )
    .get({ kind: areaKind, id: areaId, typ: oznacTypu }) as Record<string, unknown> | null
}
