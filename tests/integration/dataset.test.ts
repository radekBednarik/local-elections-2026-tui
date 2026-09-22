/**
 * Stored data belongs to the source it came from (FR-029, FR-045).
 *
 * Reported: run the binary against a mirror, then run it again WITHOUT the mirror, and
 * the mirrored figures are still there and are drawn as though they were current. A 2022
 * result presented as a 2026 one is the worst thing this application can do.
 *
 * After the switch the application must be EMPTY and waiting, which is the state FR-045
 * already describes for "results not yet published".
 */

import type { Database } from "bun:sqlite"
import { beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { extractArchiveFile } from "../../src/reference/archive.ts"
import { isReferenceLoaded, loadReference, type ReferenceArchives } from "../../src/reference/loader.ts"
import { ingestDistrict, ingestNational } from "../../src/sources/ingest.ts"
import {
  adoptDataset,
  type DatasetIdentity,
  datasetKey,
  readDataset,
  resetData,
  writeDataset,
} from "../../src/storage/dataset.ts"
import { openDatabase, openMemoryDatabase } from "../../src/storage/db.ts"
import { toggleWatchlist } from "../../src/storage/queries/watchlist.ts"
import { composeScreen } from "../../src/ui/screen.ts"
import { withTempDataDir } from "../helpers/tmpdir.ts"

const FIXTURES = join(import.meta.dir, "../../fixtures/2026")
const read = (name: string) => readFileSync(join(FIXTURES, name), "utf8")

const MIRROR: DatasetIdentity = {
  baseUrl: "http://localhost:8787",
  election: "kv2026",
  date: "20261009",
}
const LIVE: DatasetIdentity = {
  baseUrl: "https://volby.gov.cz",
  election: "kv2026",
  date: "20261009",
}
const OTHER_ELECTION: DatasetIdentity = { ...LIVE, election: "kv2022" }

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
})

/** Fills the database as a run against one source would. */
function populate(identity: DatasetIdentity): void {
  adoptDataset(db, identity)
  loadReference(db, archives)
  ingestNational(db, read("vysledky.xml"))
  ingestDistrict(db, "CZ0642", read("vysledky_obce_okres_CZ0642.xml"))
}

const resultCount = () => (db.query("SELECT COUNT(*) AS n FROM result_snapshot").get() as { n: number }).n

describe("identity", () => {
  test("a dataset is where it came from, what it is, and when", () => {
    expect(datasetKey(MIRROR)).not.toBe(datasetKey(LIVE))
    expect(datasetKey(LIVE)).not.toBe(datasetKey({ ...LIVE, date: "20261010" }))
    expect(datasetKey(LIVE)).toBe(datasetKey({ ...LIVE }))
  })

  test("a fresh database claims nothing", () => {
    expect(readDataset(db)).toBeNull()
  })

  test("adopting records it", () => {
    adoptDataset(db, LIVE)
    expect(readDataset(db)).toBe(datasetKey(LIVE))
  })
})

describe("switching source clears what belonged to the old one", () => {
  test("the reported case: mirror, then no mirror, leaves nothing behind", () => {
    populate(MIRROR)
    expect(resultCount()).toBeGreaterThan(0)

    const change = adoptDataset(db, LIVE)

    expect(change.cleared).toBe(true)
    expect(resultCount()).toBe(0)
    expect(readDataset(db)).toBe(datasetKey(LIVE))
  })

  test("and the screen says results are not published yet, rather than showing old ones", () => {
    populate(MIRROR)
    const before = composeScreen(db, { kind: "national" }, { width: 100, councilType: "OBEC" })
    // Czech figures group with U+00A0, so the separator is matched as whitespace.
    expect(before.lines.join("\n")).toMatch(/14\s722/u)

    adoptDataset(db, LIVE)

    const after = composeScreen(db, { kind: "national" }, { width: 100, councilType: "OBEC" })
    expect(after.lines.join("\n")).toContain("Výsledky zatím nejsou zveřejněny")
    expect(after.lines.join("\n")).not.toContain("14 722")
  })

  test("reference data goes too, because a mirror serves its own registries", () => {
    populate(MIRROR)
    expect(isReferenceLoaded(db)).toBe(true)

    adoptDataset(db, LIVE)

    expect(isReferenceLoaded(db)).toBe(false)
    const councils = db.query("SELECT COUNT(*) AS n FROM council").get() as { n: number }
    expect(councils.n).toBe(0)
  })

  test("subscriptions go too, so a stale ETag cannot suppress the first fetch", () => {
    populate(MIRROR)
    db.run(
      "INSERT OR REPLACE INTO source_subscription (source_key, area_kind, area_id, next_due_at, consecutive_failures, pinned) VALUES ('national','national','','2026-10-09T00:00:00Z',0,0)",
    )
    adoptDataset(db, LIVE)
    const subs = db.query("SELECT COUNT(*) AS n FROM source_subscription").get() as { n: number }
    expect(subs.n).toBe(0)
  })

  test("a changed date is a different dataset", () => {
    populate(LIVE)
    expect(adoptDataset(db, { ...LIVE, date: "20261010" }).cleared).toBe(true)
    expect(resultCount()).toBe(0)
  })
})

describe("what survives", () => {
  test("the same source twice clears nothing", () => {
    populate(LIVE)
    const before = resultCount()
    const change = adoptDataset(db, LIVE)
    expect(change.cleared).toBe(false)
    expect(resultCount()).toBe(before)
  })

  test("the watchlist survives a change of mirror, because the codes still mean the same", () => {
    populate(MIRROR)
    toggleWatchlist(db, "582786")

    const change = adoptDataset(db, LIVE)

    expect(change.watchlistCleared).toBe(false)
    const watched = db.query("SELECT COUNT(*) AS n FROM watchlist_entry").get() as { n: number }
    expect(watched.n).toBe(1)
  })

  test("but not a change of election, where a code means something else", () => {
    populate(LIVE)
    toggleWatchlist(db, "582786")

    const change = adoptDataset(db, OTHER_ELECTION)

    expect(change.watchlistCleared).toBe(true)
    const watched = db.query("SELECT COUNT(*) AS n FROM watchlist_entry").get() as { n: number }
    expect(watched.n).toBe(0)
  })

  test("preferences are the user's and are never touched", () => {
    populate(MIRROR)
    db.run("INSERT OR REPLACE INTO app_config (key, value) VALUES ('theme', 'high-contrast')")
    db.run("INSERT OR REPLACE INTO app_config (key, value) VALUES ('side_panel_open', '0')")

    adoptDataset(db, OTHER_ELECTION)

    const theme = db.query("SELECT value FROM app_config WHERE key = 'theme'").get() as {
      value: string
    } | null
    const panel = db.query("SELECT value FROM app_config WHERE key = 'side_panel_open'").get() as {
      value: string
    } | null
    expect(theme?.value).toBe("high-contrast")
    expect(panel?.value).toBe("0")
  })
})

describe("a database written before any of this existed", () => {
  test("its data has no recorded origin, so it is not trusted", () => {
    // Exactly the state the reported bug leaves behind: results present, no dataset key.
    loadReference(db, archives)
    ingestNational(db, read("vysledky.xml"))
    expect(readDataset(db)).toBeNull()
    expect(resultCount()).toBeGreaterThan(0)

    const change = adoptDataset(db, LIVE)

    expect(change.cleared).toBe(true)
    expect(resultCount()).toBe(0)
  })

  test("an genuinely empty one is simply adopted, with nothing to clear", () => {
    const change = adoptDataset(db, LIVE)
    expect(change.cleared).toBe(false)
    expect(readDataset(db)).toBe(datasetKey(LIVE))
  })
})

describe("--reset clears the same source deliberately", () => {
  test("drops results and reference, keeping the dataset", () => {
    populate(LIVE)
    resetData(db, LIVE)
    expect(resultCount()).toBe(0)
    expect(isReferenceLoaded(db)).toBe(false)
    expect(readDataset(db)).toBe(datasetKey(LIVE))
  })

  test("and keeps the watchlist, which the user curated", () => {
    populate(LIVE)
    toggleWatchlist(db, "582786")
    resetData(db, LIVE)
    const watched = db.query("SELECT COUNT(*) AS n FROM watchlist_entry").get() as { n: number }
    expect(watched.n).toBe(1)
  })
})

describe("across a real restart", () => {
  test("the dataset is remembered on disk", async () => {
    await withTempDataDir((dir) => {
      const path = dir.file("volby.sqlite")

      const first = openDatabase(path)
      writeDataset(first, MIRROR)
      first.close()

      const second = openDatabase(path)
      try {
        expect(readDataset(second)).toBe(datasetKey(MIRROR))
        expect(adoptDataset(second, LIVE).previous).toBe(datasetKey(MIRROR))
      } finally {
        second.close()
      }
    })
  })
})
