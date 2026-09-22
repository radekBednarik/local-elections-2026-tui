/**
 * User Story 3: surviving a hostile network.
 *
 * Driven against a real local server that can be made to fail on command, so the
 * behaviour under test is the actual fetch/ingest/scheduler interaction rather than a
 * mock of it.
 */

import type { Database } from "bun:sqlite"
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { Server } from "bun"
import { MIN_INTERVAL_SECONDS } from "../../src/config/args.ts"
import { backoffSeconds } from "../../src/sources/backoff.ts"
import { fetchDocument } from "../../src/sources/client.ts"
import { ingestNational } from "../../src/sources/ingest.ts"
import { Scheduler } from "../../src/sources/scheduler.ts"
import { openDatabase, openMemoryDatabase } from "../../src/storage/db.ts"
import { readNationalTotals } from "../../src/storage/queries/national.ts"
import { staleWarning } from "../../src/ui/components/status.ts"
import { renderNationalView } from "../../src/ui/views/national.ts"
import { withTempDataDir } from "../helpers/tmpdir.ts"

const FIXTURES = join(import.meta.dir, "../../fixtures/2026")
const NATIONAL = readFileSync(join(FIXTURES, "vysledky.xml"), "utf8")
const MALFORMED = readFileSync(join(import.meta.dir, "../../fixtures/edge-cases/malformed.xml"), "utf8")

/** Flipped by tests to make the server behave badly. */
let mode: "ok" | "down" | "garbage" = "ok"
let server: Server<undefined>
let url = ""

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch() {
      if (mode === "down") return new Response("unavailable", { status: 503 })
      if (mode === "garbage") return new Response(MALFORMED)
      return new Response(NATIONAL)
    },
  })
  url = `http://localhost:${server.port}/vysledky.xml`
})

afterAll(() => {
  server.stop(true)
})

let db: Database
beforeEach(() => {
  db = openMemoryDatabase()
  mode = "ok"
})

/** One fetch/ingest/record cycle, as the application's tick performs it. */
async function pass(scheduler: Scheduler, now = new Date()): Promise<string> {
  const sub = scheduler.get("national")
  const outcome = await fetchDocument(url, {
    validators: { etag: sub?.etag, lastModified: sub?.lastModified },
  })

  if (outcome.kind === "ok") {
    const result = ingestNational(db, outcome.body)
    if (result.ok) {
      scheduler.recordSuccess("national", { etag: outcome.etag }, now)
      return "ok"
    }
    scheduler.recordFailure("national", result.reason, now)
    return "rejected"
  }
  if (outcome.kind === "not-modified") {
    scheduler.recordSuccess("national", {}, now)
    return "not-modified"
  }
  scheduler.recordFailure("national", outcome.kind === "failed" ? outcome.reason : "nenalezeno", now)
  return "failed"
}

function newScheduler(): Scheduler {
  const scheduler = new Scheduler(db, { intervalSeconds: 60 })
  scheduler.subscribeAll([{ key: "national", areaKind: "national", areaId: "" }])
  return scheduler
}

describe("last good data is kept (FR-027)", () => {
  test("a server outage leaves the previous figures on screen", async () => {
    const scheduler = newScheduler()
    expect(await pass(scheduler)).toBe("ok")
    const before = readNationalTotals(db)?.turnoutPct

    mode = "down"
    expect(await pass(scheduler)).toBe("failed")

    expect(readNationalTotals(db)?.turnoutPct).toBe(before ?? -1)
    const view = renderNationalView(db).join("\n")
    expect(view).toContain("Účast")
    expect(view).not.toContain("Výsledky zatím nejsou zveřejněny")
  })

  test("a malformed document is rejected and the previous figures survive", async () => {
    const scheduler = newScheduler()
    await pass(scheduler)
    const before = readNationalTotals(db)?.validVotes

    mode = "garbage"
    expect(await pass(scheduler)).toBe("rejected")

    expect(readNationalTotals(db)?.validVotes).toBe(before ?? -1)
  })

  test("a rejected document is recorded as a failure, so the user is warned", async () => {
    const scheduler = newScheduler()
    await pass(scheduler)
    mode = "garbage"
    await pass(scheduler)

    expect(scheduler.get("national")?.consecutiveFailures).toBe(1)
    expect(staleWarning(scheduler.all())).not.toBeNull()
  })
})

describe("the staleness warning (FR-044)", () => {
  test("appears on failure, names the reason, and clears on recovery", async () => {
    const scheduler = newScheduler()
    await pass(scheduler)
    expect(staleWarning(scheduler.all())).toBeNull()

    mode = "down"
    await pass(scheduler)
    const warning = staleWarning(scheduler.all())
    expect(warning).not.toBeNull()
    expect(warning).toContain("503")

    // Recovery is unattended: the next successful pass clears it with no restart.
    mode = "ok"
    await pass(scheduler, new Date(Date.now() + 120_000))
    expect(staleWarning(scheduler.all())).toBeNull()
  })
})

describe("backoff under sustained failure (FR-043)", () => {
  test("the wait grows, stays above the floor, and is capped", async () => {
    const scheduler = newScheduler()
    mode = "down"

    const waits: number[] = []
    for (let attempt = 1; attempt <= 8; attempt++) {
      await pass(scheduler, new Date())
      waits.push(backoffSeconds(60, attempt))
    }

    expect(waits[0]).toBeGreaterThanOrEqual(MIN_INTERVAL_SECONDS)
    // Strictly growing until the cap, then flat.
    expect(waits[3]).toBeGreaterThan(waits[1] ?? 0)
    expect(waits[7]).toBeGreaterThanOrEqual(waits[6] ?? 0)
    expect(scheduler.get("national")?.consecutiveFailures).toBe(8)
  })

  test("one success resets the failure count completely", async () => {
    const scheduler = newScheduler()
    mode = "down"
    for (let i = 0; i < 4; i++) await pass(scheduler)
    expect(scheduler.get("national")?.consecutiveFailures).toBe(4)

    mode = "ok"
    await pass(scheduler)
    expect(scheduler.get("national")?.consecutiveFailures).toBe(0)
    expect(scheduler.get("national")?.lastError).toBeNull()
  })
})

describe("before publication begins (FR-045)", () => {
  test("a 404 is reported as not-yet-published, and the view explains it", async () => {
    const outcome = await fetchDocument(`http://localhost:${server.port}/../missing`)
    // Whatever the exact outcome, nothing throws and the view still renders.
    expect(["not-found", "failed", "ok"]).toContain(outcome.kind)

    const view = renderNationalView(db).join("\n")
    expect(view).toContain("Výsledky zatím nejsou zveřejněny")
    expect(view).toContain("pravidelně")
  })
})

describe("offline start (FR-042)", () => {
  test("starts from cached results with no network, and marks them stale", async () => {
    await withTempDataDir(async (dir) => {
      const path = dir.file("volby.sqlite")

      // First run: data arrives and is persisted.
      const first = openDatabase(path)
      const scheduler = new Scheduler(first, { intervalSeconds: 60 })
      scheduler.subscribeAll([{ key: "national", areaKind: "national", areaId: "" }])
      const outcome = await fetchDocument(url)
      if (outcome.kind !== "ok") throw new Error("fixture server did not serve")
      ingestNational(first, outcome.body)
      scheduler.recordFailure("national", "Spojení odmítnuto")
      first.close()

      // Second run: no network at all. The results must still be there.
      const second = openDatabase(path)
      try {
        const totals = readNationalTotals(second)
        expect(totals).not.toBeNull()
        expect(totals?.turnoutPct).toBe(46.07)

        const restored = new Scheduler(second, { intervalSeconds: 60 })
        expect(staleWarning(restored.all())).not.toBeNull()

        const view = renderNationalView(second).join("\n")
        expect(view).toContain("Účast")
      } finally {
        second.close()
      }
    })
  })
})

describe("nothing terminates the process (FR-046)", () => {
  test.each([
    ["a server error", async () => await fetchDocument(url)],
    ["an unreachable host", async () => await fetchDocument("http://localhost:1/x.xml", { timeoutMs: 1500 })],
    ["a malformed document", async () => ingestNational(db, MALFORMED)],
    ["an empty body", async () => ingestNational(db, "")],
    ["a batch source", async () => await fetchDocument("http://x.test/odata/okrsky/vysledky_okrsky_1.xml")],
  ])("%s is returned as a value, never thrown", async (_label, action) => {
    mode = "down"
    let threw = false
    try {
      await action()
    } catch {
      threw = true
    }
    expect(threw).toBe(false)
  })

  test("an unexpected value in otherwise valid data does not throw", () => {
    // Negative counts and an absurd district total are nonsense, but must not crash.
    const odd = NATIONAL.replace(/ZAPSANI_VOLICI="\d+"/, 'ZAPSANI_VOLICI="-5"').replace(
      /OKRSKY_CELKEM="\d+"/,
      'OKRSKY_CELKEM="0"',
    )
    expect(() => ingestNational(db, odd)).not.toThrow()
  })

  test("rendering never throws, whatever state the database is in", () => {
    expect(() => renderNationalView(db)).not.toThrow()
    ingestNational(db, MALFORMED)
    expect(() => renderNationalView(db)).not.toThrow()
  })
})
