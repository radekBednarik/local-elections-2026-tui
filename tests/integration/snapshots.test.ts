import type { Database } from "bun:sqlite"
import { beforeEach, describe, expect, test } from "bun:test"
import { openMemoryDatabase } from "../../src/storage/db.ts"
import { readCurrent, readPrevious, type SnapshotInput, writeSnapshot } from "../../src/storage/snapshots.ts"

let db: Database

beforeEach(() => {
  db = openMemoryDatabase()
})

function snapshot(overrides: Partial<SnapshotInput> = {}): SnapshotInput {
  return {
    areaKind: "council",
    areaId: "551082",
    oznacTypu: null,
    publishedAt: "2026-10-09T20:00:00",
    fetchedAt: "2026-10-09T20:00:05",
    districtsTotal: 13,
    districtsCounted: 6,
    districtsPct: 46.15,
    votersRegistered: 10177,
    envelopesIssued: 2000,
    envelopesReturned: 1995,
    validVotes: 40000,
    turnoutPct: 19.65,
    seatsTotal: 21,
    isFinal: false,
    parties: [
      {
        vstrana: "768",
        ballotOrder: 3,
        name: "ANO 2011",
        votes: 8000,
        votesPct: 20.0,
        candidates: 21,
        seatsWon: 4,
        seatsPct: 19.05,
      },
    ],
    ...overrides,
  }
}

function countRows(): number {
  const row = db.query("SELECT COUNT(*) AS n FROM result_snapshot").get() as { n: number }
  return row.n
}

describe("first write", () => {
  test("inserts and becomes current", () => {
    const outcome = writeSnapshot(db, snapshot())
    expect(outcome.kind).toBe("inserted")
    expect(readCurrent(db, "council", "551082")).not.toBeNull()
    expect(readPrevious(db, "council", "551082")).toBeNull()
  })

  test("stores figures exactly as given, without recomputation (FR-029)", () => {
    writeSnapshot(db, snapshot({ turnoutPct: 46.21 }))
    const current = readCurrent(db, "council", "551082")
    expect(current?.turnout_pct).toBe(46.21)
    expect(current?.voters_registered).toBe(10177)
  })
})

describe("changed figures rotate", () => {
  test("the old snapshot becomes the prior one", () => {
    writeSnapshot(db, snapshot())
    const outcome = writeSnapshot(
      db,
      snapshot({ publishedAt: "2026-10-09T20:01:00", districtsCounted: 9, validVotes: 60000 }),
    )

    expect(outcome.kind).toBe("rotated")
    expect(countRows()).toBe(2)
    expect(readCurrent(db, "council", "551082")?.districts_counted).toBe(9)
    expect(readPrevious(db, "council", "551082")?.districts_counted).toBe(6)
  })

  test("never accumulates more than two rows per area (FR-036a)", () => {
    for (let i = 0; i < 10; i++) {
      writeSnapshot(
        db,
        snapshot({
          publishedAt: `2026-10-09T20:${String(i).padStart(2, "0")}:00`,
          districtsCounted: i,
          validVotes: 1000 * i,
        }),
      )
    }
    expect(countRows()).toBe(2)
  })
})

describe("identical re-fetch is discarded", () => {
  // This is the rule most likely to be broken by a well-meaning refactor: sources are
  // polled every 60 s and usually return unchanged figures, so if an identical re-fetch
  // rotated the rows, every change highlight would vanish within a minute.
  test("does not rotate, and preserves the genuine prior snapshot", () => {
    writeSnapshot(db, snapshot({ districtsCounted: 6 }))
    writeSnapshot(db, snapshot({ publishedAt: "2026-10-09T20:01:00", districtsCounted: 9 }))
    expect(readPrevious(db, "council", "551082")?.districts_counted).toBe(6)

    // Same figures arrive again, only the publisher's timestamp has moved on.
    const outcome = writeSnapshot(db, snapshot({ publishedAt: "2026-10-09T20:02:00", districtsCounted: 9 }))

    expect(outcome.kind).toBe("unchanged")
    expect(countRows()).toBe(2)
    // The prior snapshot must still be the real one, not a copy of the current.
    expect(readPrevious(db, "council", "551082")?.districts_counted).toBe(6)
  })

  test("still refreshes the retrieval time, so staleness stays accurate", () => {
    writeSnapshot(db, snapshot({ fetchedAt: "2026-10-09T20:00:05" }))
    writeSnapshot(db, snapshot({ fetchedAt: "2026-10-09T20:01:05" }))
    expect(readCurrent(db, "council", "551082")?.fetched_at).toBe("2026-10-09T20:01:05")
  })

  test("a changed vote count alone counts as a change", () => {
    writeSnapshot(db, snapshot())
    const outcome = writeSnapshot(
      db,
      snapshot({
        publishedAt: "2026-10-09T20:01:00",
        parties: [
          {
            vstrana: "768",
            ballotOrder: 3,
            name: "ANO 2011",
            votes: 8500,
            votesPct: 21.0,
            candidates: 21,
            seatsWon: 4,
            seatsPct: 19.05,
          },
        ],
      }),
    )
    expect(outcome.kind).toBe("rotated")
  })
})

describe("older data never overwrites newer (FR-028)", () => {
  test("a snapshot published earlier than the current one is ignored", () => {
    writeSnapshot(db, snapshot({ publishedAt: "2026-10-09T21:00:00", districtsCounted: 13 }))
    const outcome = writeSnapshot(db, snapshot({ publishedAt: "2026-10-09T20:00:00", districtsCounted: 2 }))

    expect(outcome.kind).toBe("unchanged")
    expect(readCurrent(db, "council", "551082")?.districts_counted).toBe(13)
  })
})

describe("areas are independent", () => {
  test("writing one council does not disturb another", () => {
    writeSnapshot(db, snapshot({ areaId: "551082" }))
    writeSnapshot(db, snapshot({ areaId: "582786" }))
    expect(countRows()).toBe(2)
    expect(readCurrent(db, "council", "551082")).not.toBeNull()
    expect(readCurrent(db, "council", "582786")).not.toBeNull()
  })

  test("the national area keeps OBEC and MCMO separate (FR-035)", () => {
    writeSnapshot(db, snapshot({ areaKind: "national", areaId: "", oznacTypu: "OBEC" }))
    writeSnapshot(db, snapshot({ areaKind: "national", areaId: "", oznacTypu: "MCMO" }))
    expect(countRows()).toBe(2)
    expect(readCurrent(db, "national", "", "OBEC")).not.toBeNull()
    expect(readCurrent(db, "national", "", "MCMO")).not.toBeNull()
  })
})

describe("child rows", () => {
  test("party results are stored with folded names for search", () => {
    writeSnapshot(
      db,
      snapshot({
        parties: [
          {
            vstrana: "480",
            ballotOrder: 1,
            name: "SPOLEČNĚ TOP 09 a nezávislí",
            votes: 6916,
            votesPct: 7.76,
            candidates: 21,
            seatsWon: 2,
            seatsPct: 9.52,
          },
        ],
      }),
    )
    const row = db.query("SELECT name, name_folded FROM party_result").get() as {
      name: string
      name_folded: string
    }
    expect(row.name).toBe("SPOLEČNĚ TOP 09 a nezávislí")
    expect(row.name_folded).toBe("spolecne top 09 a nezavisli")
  })

  test("elected candidates are stored against the snapshot", () => {
    writeSnapshot(
      db,
      snapshot({
        candidates: [
          {
            vstrana: "768",
            ballotOrder: 3,
            ballotNumber: 1,
            givenName: "Antonín",
            familyName: "Brzobohatý",
            titleBefore: "Ing.",
            titleAfter: null,
            votes: 868,
            votesPct: 5.18,
          },
        ],
      }),
    )
    const row = db.query("SELECT family_name, name_folded, elected FROM candidate_result").get() as {
      family_name: string
      name_folded: string
      elected: number
    }
    expect(row.family_name).toBe("Brzobohatý")
    expect(row.name_folded).toBe("antonin brzobohaty")
    expect(row.elected).toBe(1)
  })

  test("rotating out a snapshot removes its child rows", () => {
    writeSnapshot(db, snapshot())
    writeSnapshot(db, snapshot({ publishedAt: "2026-10-09T20:01:00", districtsCounted: 9 }))
    writeSnapshot(db, snapshot({ publishedAt: "2026-10-09T20:02:00", districtsCounted: 11 }))

    const rows = db.query("SELECT COUNT(*) AS n FROM party_result").get() as { n: number }
    // Two snapshots survive, so two sets of party rows, never more.
    expect(rows.n).toBe(2)
  })
})
