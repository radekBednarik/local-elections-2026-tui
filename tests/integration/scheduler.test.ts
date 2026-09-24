import type { Database } from "bun:sqlite"
import { beforeEach, describe, expect, test } from "bun:test"
import { MIN_INTERVAL_SECONDS } from "../../src/config/args.ts"
import { backoffSeconds, MAX_BACKOFF_SECONDS } from "../../src/sources/backoff.ts"
import { Scheduler } from "../../src/sources/scheduler.ts"
import type { SourceKey } from "../../src/sources/urls.ts"
import { openMemoryDatabase } from "../../src/storage/db.ts"

let db: Database
const T0 = new Date("2026-10-09T20:00:00.000Z")

beforeEach(() => {
  db = openMemoryDatabase()
})

function at(seconds: number): Date {
  return new Date(T0.getTime() + seconds * 1000)
}

/** The live set: national plus every district. */
function liveSources(count: number): { key: SourceKey; areaKind: string; areaId: string }[] {
  const keys: { key: SourceKey; areaKind: string; areaId: string }[] = [
    { key: "national", areaKind: "national", areaId: "" },
  ]
  for (let i = 1; i < count; i++) {
    const nuts = `CZ0${String(i).padStart(3, "0")}`
    keys.push({ key: `district:${nuts}`, areaKind: "district", areaId: nuts })
  }
  return keys
}

describe("the 60-second floor (FR-016, FR-017)", () => {
  test("an interval below the floor is clamped", () => {
    expect(new Scheduler(db, { intervalSeconds: 1 }).intervalSeconds).toBe(MIN_INTERVAL_SECONDS)
    expect(new Scheduler(db, { intervalSeconds: 0 }).intervalSeconds).toBe(MIN_INTERVAL_SECONDS)
  })

  test("a larger interval is respected", () => {
    expect(new Scheduler(db, { intervalSeconds: 300 }).intervalSeconds).toBe(300)
  })

  test("no source becomes due twice within 60 seconds, over a simulated 5 minutes", () => {
    // The headline guarantee. Built with the smallest legal interval, which is the
    // worst case for the floor.
    const scheduler = new Scheduler(db, { intervalSeconds: 1 })
    scheduler.subscribeAll(liveSources(79), T0)

    const lastSeen = new Map<string, number>()
    const violations: string[] = []

    for (let second = 0; second <= 300; second++) {
      const now = at(second)
      for (const sub of scheduler.due(now, 100)) {
        const previous = lastSeen.get(sub.sourceKey)
        if (previous !== undefined && second - previous < MIN_INTERVAL_SECONDS) {
          violations.push(`${sub.sourceKey} at ${second}s, previous ${previous}s`)
        }
        lastSeen.set(sub.sourceKey, second)
        scheduler.recordSuccess(sub.sourceKey, {}, now)
      }
    }

    expect(violations).toEqual([])
    // And the run actually exercised the sources, rather than passing by doing nothing.
    expect(lastSeen.size).toBe(79)
  })
})

describe("spreading (research R8)", () => {
  test("subscriptions are staggered across the interval, not all due at once", () => {
    const scheduler = new Scheduler(db, { intervalSeconds: 60 })
    scheduler.subscribeAll(liveSources(79), T0)

    const dueImmediately = scheduler.due(T0, 200).length
    expect(dueImmediately).toBeLessThan(10)

    // Across a full interval every source comes due exactly once. The window runs to
    // 60 inclusive because the last source's offset lands just under 60 s, and sampling
    // only whole seconds 0..59 would miss it.
    const seen = new Set<string>()
    for (let second = 0; second <= 60; second++) {
      for (const sub of scheduler.due(at(second), 200)) {
        seen.add(sub.sourceKey)
        scheduler.recordSuccess(sub.sourceKey, {}, at(second))
      }
    }
    expect(seen.size).toBe(79)
  })

  test("adding a source later does not disturb existing schedules", () => {
    const scheduler = new Scheduler(db, { intervalSeconds: 60 })
    scheduler.subscribeAll(liveSources(5), T0)
    const before = scheduler.all().map((s) => s.nextDueAt)

    scheduler.subscribeAll([{ key: "council:551082", areaKind: "council", areaId: "551082" }], at(10))

    const after = scheduler
      .all()
      .filter((s) => s.sourceKey !== "council:551082")
      .map((s) => s.nextDueAt)
    expect(after).toEqual(before)
  })
})

describe("success and failure", () => {
  test("a success clears the error and stores validators", () => {
    const scheduler = new Scheduler(db, { intervalSeconds: 60 })
    scheduler.subscribeAll(liveSources(1), T0)
    scheduler.recordFailure("national", "Spojení odmítnuto", T0)
    scheduler.recordSuccess("national", { etag: 'W/"x"' }, at(120))

    const sub = scheduler.get("national")
    expect(sub?.consecutiveFailures).toBe(0)
    expect(sub?.lastError).toBeNull()
    expect(sub?.etag).toBe('W/"x"')
  })

  test("a 304 counts as success, so a quiet period does not trigger backoff", () => {
    const scheduler = new Scheduler(db, { intervalSeconds: 60 })
    scheduler.subscribeAll(liveSources(1), T0)
    // No new validators supplied, as with a 304.
    scheduler.recordSuccess("national", {}, T0)
    expect(scheduler.get("national")?.consecutiveFailures).toBe(0)
  })

  test("a success keeps previously stored validators when none are supplied", () => {
    const scheduler = new Scheduler(db, { intervalSeconds: 60 })
    scheduler.subscribeAll(liveSources(1), T0)
    scheduler.recordSuccess("national", { etag: 'W/"keep"' }, T0)
    scheduler.recordSuccess("national", {}, at(60))
    expect(scheduler.get("national")?.etag).toBe('W/"keep"')
  })

  test("failures accumulate and are recorded with their reason", () => {
    const scheduler = new Scheduler(db, { intervalSeconds: 60 })
    scheduler.subscribeAll(liveSources(1), T0)
    scheduler.recordFailure("national", "Server odpověděl 503", T0)
    scheduler.recordFailure("national", "Server odpověděl 503", at(120))
    const sub = scheduler.get("national")
    expect(sub?.consecutiveFailures).toBe(2)
    expect(sub?.lastError).toContain("503")
  })
})

describe("backoff (FR-043)", () => {
  test("grows with consecutive failures", () => {
    expect(backoffSeconds(60, 0)).toBe(60)
    expect(backoffSeconds(60, 1)).toBe(60)
    expect(backoffSeconds(60, 2)).toBe(120)
    expect(backoffSeconds(60, 3)).toBe(240)
  })

  test("never exceeds the ceiling", () => {
    for (const failures of [8, 20, 100]) {
      expect(backoffSeconds(60, failures)).toBe(MAX_BACKOFF_SECONDS)
    }
  })

  test("never drops below the 60-second floor, whatever the interval", () => {
    for (const failures of [0, 1, 5]) {
      expect(backoffSeconds(1, failures)).toBeGreaterThanOrEqual(MIN_INTERVAL_SECONDS)
    }
  })

  test("one success resets the wait to the normal interval", () => {
    const scheduler = new Scheduler(db, { intervalSeconds: 60 })
    scheduler.subscribeAll(liveSources(1), T0)
    for (let i = 0; i < 5; i++) scheduler.recordFailure("national", "down", at(i * 600))

    const backedOff = Date.parse(scheduler.get("national")?.nextDueAt ?? "")
    scheduler.recordSuccess("national", {}, at(3000))
    const recovered = Date.parse(scheduler.get("national")?.nextDueAt ?? "")

    expect(recovered - at(3000).getTime()).toBe(60_000)
    expect(backedOff - at(2400).getTime()).toBeGreaterThan(60_000)
  })
})

describe("manual refresh (FR-019)", () => {
  test("is allowed before a source has ever been attempted", () => {
    const scheduler = new Scheduler(db, { intervalSeconds: 60 })
    scheduler.subscribeAll(liveSources(1), T0)
    expect(scheduler.canRefreshNow("national", T0)).toBe(true)
  })

  test("is refused within 60 seconds of the last attempt", () => {
    const scheduler = new Scheduler(db, { intervalSeconds: 60 })
    scheduler.subscribeAll(liveSources(1), T0)
    scheduler.recordSuccess("national", {}, T0)

    expect(scheduler.canRefreshNow("national", at(30))).toBe(false)
    expect(scheduler.requestRefresh("national", at(30))).toBe(false)
  })

  test("is allowed once the floor has elapsed", () => {
    const scheduler = new Scheduler(db, { intervalSeconds: 300 })
    scheduler.subscribeAll(liveSources(1), T0)
    scheduler.recordSuccess("national", {}, T0)

    // The configured interval is 300 s, but a manual refresh only waits the 60 s floor.
    expect(scheduler.requestRefresh("national", at(60))).toBe(true)
    expect(scheduler.due(at(60), 10).map((s) => s.sourceKey)).toContain("national")
  })

  test("repeated refresh attempts cannot bypass the floor", () => {
    const scheduler = new Scheduler(db, { intervalSeconds: 60 })
    scheduler.subscribeAll(liveSources(1), T0)
    scheduler.recordSuccess("national", {}, T0)
    let allowed = 0
    for (let second = 1; second < 60; second++) {
      if (scheduler.requestRefresh("national", at(second))) allowed++
    }
    expect(allowed).toBe(0)
  })
})

describe("subscription lifecycle (FR-018a)", () => {
  test("a pinned source stays subscribed; unsubscribing stops the polling", () => {
    const scheduler = new Scheduler(db, { intervalSeconds: 60 })
    scheduler.subscribeAll([{ key: "council:551082", areaKind: "council", areaId: "551082" }], T0)

    scheduler.setPinned("council:551082", true)
    expect(scheduler.get("council:551082")?.pinned).toBe(true)

    scheduler.unsubscribe("council:551082")
    expect(scheduler.get("council:551082")).toBeNull()
    expect(scheduler.all()).toHaveLength(0)
  })

  test("a newly subscribed source is not final", () => {
    const scheduler = new Scheduler(db, { intervalSeconds: 60 })
    scheduler.subscribeAll(liveSources(1), T0)
    expect(scheduler.get("national")?.final).toBe(false)
  })

  test("an idle application polls only the live set, never every council", () => {
    const scheduler = new Scheduler(db, { intervalSeconds: 60 })
    scheduler.subscribeAll(liveSources(79), T0)
    // 1 national + the districts. Roughly 6,000 councils must NOT be here.
    expect(scheduler.all()).toHaveLength(79)
    expect(scheduler.all().filter((s) => s.areaKind === "council")).toHaveLength(0)
  })
})
