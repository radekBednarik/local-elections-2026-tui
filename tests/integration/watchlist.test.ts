/**
 * Watchlist persistence and its effect on polling (User Story 5).
 */

import type { Database } from "bun:sqlite"
import { beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { extractArchiveFile } from "../../src/reference/archive.ts"
import { loadReference, type ReferenceArchives } from "../../src/reference/loader.ts"
import { ingestDistrict } from "../../src/sources/ingest.ts"
import { Scheduler } from "../../src/sources/scheduler.ts"
import { openDatabase, openMemoryDatabase } from "../../src/storage/db.ts"
import {
  addToWatchlist,
  isWatched,
  listWatchlist,
  removeFromWatchlist,
  toggleWatchlist,
  watchedCodes,
} from "../../src/storage/queries/watchlist.ts"
import { renderWatchlist } from "../../src/ui/views/watchlist.ts"
import { withTempDataDir } from "../helpers/tmpdir.ts"

const FIXTURES = join(import.meta.dir, "../../fixtures/2026")
const DISTRICT = readFileSync(join(FIXTURES, "vysledky_obce_okres_CZ0642.xml"), "utf8")

let archives: ReferenceArchives
beforeAll(async () => {
  const reg = await extractArchiveFile(join(FIXTURES, "reg.zip"))
  const cis = await extractArchiveFile(join(FIXTURES, "ciselniky.zip"))
  if (!reg.ok || !cis.ok) throw new Error("fixture archives could not be extracted")
  archives = { registry: reg.files, codelists: cis.files }
})

let db: Database
beforeEach(() => {
  db = openMemoryDatabase()
  loadReference(db, archives)
  ingestDistrict(db, "CZ0642", DISTRICT)
})

describe("adding and removing (FR-039)", () => {
  test("a council can be added, is then watched, and can be removed", () => {
    expect(isWatched(db, "551082")).toBe(false)
    addToWatchlist(db, "551082")
    expect(isWatched(db, "551082")).toBe(true)
    removeFromWatchlist(db, "551082")
    expect(isWatched(db, "551082")).toBe(false)
  })

  test("adding twice is harmless, as a double keypress would cause", () => {
    addToWatchlist(db, "551082")
    expect(() => {
      addToWatchlist(db, "551082")
    }).not.toThrow()
    expect(listWatchlist(db)).toHaveLength(1)
  })

  test("removing something not watched is harmless", () => {
    expect(() => {
      removeFromWatchlist(db, "999999")
    }).not.toThrow()
  })

  test("toggle reports the state afterwards", () => {
    expect(toggleWatchlist(db, "551082")).toBe(true)
    expect(toggleWatchlist(db, "551082")).toBe(false)
  })
})

describe("ordering", () => {
  test("entries keep the order they were added, not alphabetical order", () => {
    // Deliberately reverse-alphabetical, so an accidental name sort would be visible.
    addToWatchlist(db, "582786")
    addToWatchlist(db, "551325")
    addToWatchlist(db, "551082")

    expect(watchedCodes(db)).toEqual(["582786", "551325", "551082"])
  })

  test("removing from the middle does not disturb the rest", () => {
    addToWatchlist(db, "582786")
    addToWatchlist(db, "551325")
    addToWatchlist(db, "551082")
    removeFromWatchlist(db, "551325")
    expect(watchedCodes(db)).toEqual(["582786", "551082"])
  })
})

describe("persistence across restarts (FR-039)", () => {
  test("the watchlist is still there after closing and reopening", async () => {
    await withTempDataDir((dir) => {
      const path = dir.file("volby.sqlite")

      const first = openDatabase(path)
      addToWatchlist(first, "551082")
      addToWatchlist(first, "582786")
      first.close()

      const second = openDatabase(path)
      try {
        expect(watchedCodes(second)).toEqual(["551082", "582786"])
        expect(isWatched(second, "551082")).toBe(true)
      } finally {
        second.close()
      }
    })
  })
})

describe("polling (FR-018a with FR-039)", () => {
  test("a watched council stays subscribed while off screen", () => {
    const scheduler = new Scheduler(db, { intervalSeconds: 60 })
    scheduler.subscribeAll([{ key: "council:551082", areaKind: "council", areaId: "551082" }])
    scheduler.setPinned("council:551082", true)

    // Simulate the sync that runs when the user navigates away: nothing on screen
    // needs this council any more.
    for (const sub of scheduler.all()) {
      if (sub.areaKind === "council" && !sub.pinned) scheduler.unsubscribe(sub.sourceKey)
    }

    expect(scheduler.get("council:551082")).not.toBeNull()
  })

  test("unwatching stops the polling, so the subscription does not leak", () => {
    const scheduler = new Scheduler(db, { intervalSeconds: 60 })
    scheduler.subscribeAll([{ key: "council:551082", areaKind: "council", areaId: "551082" }])
    scheduler.setPinned("council:551082", true)

    // Unwatch: the pin is cleared, then the same sweep runs.
    scheduler.setPinned("council:551082", false)
    for (const sub of scheduler.all()) {
      if (sub.areaKind === "council" && !sub.pinned) scheduler.unsubscribe(sub.sourceKey)
    }

    expect(scheduler.get("council:551082")).toBeNull()
    expect(scheduler.all().filter((s) => s.areaKind === "council")).toHaveLength(0)
  })
})

describe("watchlist view", () => {
  test("explains how to add one when the list is empty", () => {
    const view = renderWatchlist(db)
    expect(view.lines.join("\n")).toContain("nesledujete")
    expect(view.codes).toEqual([])
  })

  test("shows each watched council with its figures", () => {
    addToWatchlist(db, "551082")
    addToWatchlist(db, "582786")
    const view = renderWatchlist(db)
    const body = view.lines.join("\n")

    expect(view.codes).toEqual(["551082", "582786"])
    expect(body).toContain("Brno-Bohunice")
    expect(body).toContain("Účast")
  })

  test("attributes a borough to its parent", () => {
    addToWatchlist(db, "551082")
    expect(renderWatchlist(db).lines.join("\n")).toContain("Brno-Bohunice (Brno)")
  })

  test("a watched council with no data yet is listed as waiting, not dropped", () => {
    const bare = openMemoryDatabase()
    try {
      loadReference(bare, archives)
      addToWatchlist(bare, "551082")
      const view = renderWatchlist(bare)
      expect(view.codes).toEqual(["551082"])
      expect(view.lines.join("\n")).toContain("čeká se")
    } finally {
      bare.close()
    }
  })

  test("survives reference data being absent, showing the code", () => {
    const bare = openMemoryDatabase()
    try {
      addToWatchlist(bare, "551082")
      const view = renderWatchlist(bare)
      expect(view.codes).toEqual(["551082"])
      expect(view.lines.join("\n")).toContain("551082")
    } finally {
      bare.close()
    }
  })

  test("the first row index points at a real entry, and lines fit", () => {
    addToWatchlist(db, "551082")
    const view = renderWatchlist(db, 90)
    const row = view.lines[view.firstRow]
    expect(row).toBeDefined()
    expect(row ?? "").toContain("Brno-Bohunice")
    for (const line of view.lines) expect([...line].length).toBeLessThanOrEqual(90)
  })
})
