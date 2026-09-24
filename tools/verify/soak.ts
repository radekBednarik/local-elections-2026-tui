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
import { createTestRenderer } from "@opentui/core/testing"
import { extractArchiveFile } from "../../src/reference/archive.ts"
import { loadReference } from "../../src/reference/loader.ts"
import { ingestDistrict, ingestNational } from "../../src/sources/ingest.ts"
import { Scheduler } from "../../src/sources/scheduler.ts"
import { openDatabase } from "../../src/storage/db.ts"
import { Frame } from "../../src/ui/chrome/frame.ts"
import { panelFits } from "../../src/ui/chrome/panel.ts"
import { applyFrameState, applyPanel, frameState } from "../../src/ui/chrome/state.ts"
import { Navigation } from "../../src/ui/navigation.ts"
import { composeScreen } from "../../src/ui/screen.ts"
import { UNSORTED } from "../../src/ui/sort.ts"
import { themeByName } from "../../src/ui/theme/themes.ts"

const F = join(import.meta.dir, "../../fixtures/2026")
const NAT = readFileSync(join(F, "vysledky.xml"), "utf8")
const DIST = readFileSync(join(F, "vysledky_obce_okres_CZ0642.xml"), "utf8")

const db = openDatabase(":memory:")

// Reference data loaded, which the soak used to skip. Without it `listDistricts`
// returned NOTHING, so the run measured an empty screen and reported a comfortable
// number for a list that was not there. The district list is 77 rows and is the screen a
// user sits on while the count comes in.
const reg = await extractArchiveFile(join(F, "reg.zip"))
const cis = await extractArchiveFile(join(F, "ciselniky.zip"))
if (!reg.ok || !cis.ok) throw new Error("fixture archives could not be extracted")
loadReference(db, { registry: reg.files, codelists: cis.files })
const scheduler = new Scheduler(db, { intervalSeconds: 60 })
scheduler.subscribeAll([{ key: "national", areaKind: "national", areaId: "" }])

const CYCLES = 720 // 12 hours at one refresh per minute
const opts = { width: 110, councilType: "OBEC" }
const heap = () => Math.round(process.memoryUsage().heapUsed / 1024 / 1024)

const start = heap()
let maxKeyMs = 0
let maxDrawMs = 0

/**
 * The real drawing path, through a real renderer (T167).
 *
 * The redesign added a renderable per row, a frame, a scroll bar and a side panel. The
 * old soak measured composeScreen alone, which no longer accounts for most of the work,
 * so this measures what the user actually waits for.
 */
const setup = await createTestRenderer({ width: 120, height: 34 })
const frame = new Frame(setup.renderer)
frame.attach(setup.renderer.root)
const nav = new Navigation()
// The district LIST, not one district: 77 rows rather than three.
nav.push({ kind: "districts" })
const theme = themeByName("tokyonight")

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
  composeScreen(db, { kind: "districts" }, opts)
  maxKeyMs = Math.max(maxKeyMs, performance.now() - t0)

  // The selection moves, as a user walking the list moves it. This is what makes the
  // redraw representative: a still screen would never exercise the row updates.
  nav.move(cycle % 2 === 0 ? 1 : -1, 77)

  // And the whole redraw, renderables included.
  const t1 = performance.now()
  applyPanel(frame, db, theme, panelFits(frame.rawContentWidth))
  applyFrameState(
    frame,
    frameState({
      db,
      nav,
      councilType: "OBEC",
      query: "",
      theme,
      sort: UNSORTED,
      width: 120,
      contentWidth: frame.contentWidth > 0 ? frame.contentWidth : 117,
      contentHeight: frame.contentHeight > 0 ? frame.contentHeight : 30,
      sourceStatus: null,
      notice: null,
    }),
    theme,
  )
  await setup.renderOnce()
  maxDrawMs = Math.max(maxDrawMs, performance.now() - t1)

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
console.log(`  nejdelší složení obrazovky: ${maxKeyMs.toFixed(1)} ms (limit 100 ms)`)
console.log(`  nejdelší celé překreslení včetně rámu: ${maxDrawMs.toFixed(1)} ms (limit 100 ms)`)
console.log(`  řádkových renderable objektů v poolu: ${frame.rows.length}`)

const areas = db
  .query(
    "SELECT area_kind, area_id, oznac_typu, COUNT(*) AS n FROM result_snapshot GROUP BY 1,2,3 HAVING n > 2",
  )
  .all()
for (const a of areas as unknown[]) console.log("  PŘEBÝVÁ:", JSON.stringify(a))
console.log(`  oblastí s více než 2 snapshoty: ${areas.length}`)
setup.renderer.destroy()
process.exit(areas.length === 0 && maxKeyMs < 100 && maxDrawMs < 100 ? 0 : 1)
