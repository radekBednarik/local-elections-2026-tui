/**
 * Compressed soak test for SC-008 (12-hour run) and SC-010 (100 ms keystroke budget).
 *
 * NOT a literal 12-hour run. It performs the number of refresh cycles a 12-hour count
 * would produce (720 per source at 60 s) against the whole live set, which is what would
 * actually accumulate state or leak. Wall-clock duration is not what SC-008 is about;
 * unbounded growth is.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ingestDistrict, ingestNational } from "../../src/sources/ingest.ts"
import { Scheduler } from "../../src/sources/scheduler.ts"
import { openDatabase } from "../../src/storage/db.ts"
import { composeScreen } from "../../src/ui/screen.ts"

const F = join(import.meta.dir, "../../fixtures/2026")
const NAT = readFileSync(join(F, "vysledky.xml"), "utf8")
const DIST = readFileSync(join(F, "vysledky_obce_okres_CZ0642.xml"), "utf8")

const db = openDatabase(":memory:")
const scheduler = new Scheduler(db, { intervalSeconds: 60 })
scheduler.subscribeAll([{ key: "national", areaKind: "national", areaId: "" }])

const CYCLES = 720 // 12 hours at one refresh per minute
const opts = { width: 110, councilType: "OBEC" }
const heap = () => Math.round(process.memoryUsage().heapUsed / 1024 / 1024)

const start = heap()
let maxKeyMs = 0

for (let cycle = 0; cycle < CYCLES; cycle++) {
  // Each cycle the count advances slightly, so snapshots genuinely rotate.
  const counted = 1000 + cycle * 19
  ingestNational(
    db,
    NAT.replace(/OKRSKY_ZPRAC="\d+"/, `OKRSKY_ZPRAC="${counted}"`).replace(
      /DATUM_CAS_GENEROVANI="[^"]*"/,
      `DATUM_CAS_GENEROVANI="2026-10-09T${String(6 + Math.floor(cycle / 60)).padStart(2, "0")}:${String(cycle % 60).padStart(2, "0")}:00"`,
    ),
  )
  ingestDistrict(
    db,
    "CZ0642",
    DIST.replace(
      /OKRSKY_ZPRAC="(\d+)"/g,
      (_m, v) => `OKRSKY_ZPRAC="${Math.min(Number(v), 1 + (cycle % 13))}"`,
    ),
  )
  scheduler.recordSuccess("national")

  // A keystroke, as the user would make it: recompose the screen.
  const t0 = performance.now()
  composeScreen(db, { kind: "district", nuts: "CZ0642" }, opts)
  maxKeyMs = Math.max(maxKeyMs, performance.now() - t0)

  if (cycle % 180 === 0) {
    const rows = db.query("SELECT COUNT(*) AS n FROM result_snapshot").get() as { n: number }
    console.log(
      `cyklus ${String(cycle).padStart(3)}  heap ${String(heap()).padStart(3)} MB  snapshotů ${rows.n}`,
    )
  }
}

const rows = db.query("SELECT COUNT(*) AS n FROM result_snapshot").get() as { n: number }
const parties = db.query("SELECT COUNT(*) AS n FROM party_result").get() as { n: number }
const end = heap()
console.log(`\npo ${CYCLES} cyklech:`)
console.log(`  heap ${start} MB -> ${end} MB`)
console.log(`  snapshotů: ${rows.n}  (musí zůstat <= 2 na oblast)`)
console.log(`  řádků stran: ${parties.n}`)
console.log(`  nejdelší překreslení: ${maxKeyMs.toFixed(1)} ms (limit 100 ms)`)

const areas = db
  .query(
    "SELECT area_kind, area_id, oznac_typu, COUNT(*) AS n FROM result_snapshot GROUP BY 1,2,3 HAVING n > 2",
  )
  .all()
for (const a of areas as unknown[]) console.log("  PŘEBÝVÁ:", JSON.stringify(a))
console.log(`  oblastí s více než 2 snapshoty: ${areas.length}`)
process.exit(areas.length === 0 && maxKeyMs < 100 ? 0 : 1)
