/**
 * Where the time goes when a user presses Down on the district list.
 *
 * The soak (tools/verify/soak.ts) reported 8.9 ms for a full redraw and was measuring
 * the wrong screen: a district with three councils, against a database with no reference
 * data loaded, so `listDistricts` returned nothing at all. The district list is 77 rows
 * and is the screen the user actually complained about.
 *
 * Run: bun run tools/verify/keylatency.ts
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createTestRenderer } from "@opentui/core/testing"
import { extractArchiveFile } from "../../src/reference/archive.ts"
import { loadReference } from "../../src/reference/loader.ts"
import { ingestDistrict, ingestNational } from "../../src/sources/ingest.ts"
import { openMemoryDatabase } from "../../src/storage/db.ts"
import { listDistricts } from "../../src/storage/queries/areas.ts"
import { Frame } from "../../src/ui/chrome/frame.ts"
import { applyFrameState, frameState } from "../../src/ui/chrome/state.ts"
import { Navigation } from "../../src/ui/navigation.ts"
import { composeScreen } from "../../src/ui/screen.ts"
import { UNSORTED } from "../../src/ui/sort.ts"
import { themeByName } from "../../src/ui/theme/themes.ts"
import { buildDistrictListRows } from "../../src/ui/views/areas.ts"

const FIXTURES = join(import.meta.dir, "../../fixtures/2026")
const read = (name: string) => readFileSync(join(FIXTURES, name), "utf8")

const db = openMemoryDatabase()
const reg = await extractArchiveFile(join(FIXTURES, "reg.zip"))
const cis = await extractArchiveFile(join(FIXTURES, "ciselniky.zip"))
if (!reg.ok || !cis.ok) throw new Error("fixture archives could not be extracted")
loadReference(db, { registry: reg.files, codelists: cis.files })
ingestNational(db, read("vysledky.xml"))
ingestDistrict(db, "CZ0642", read("vysledky_obce_okres_CZ0642.xml"))

console.log(`okresů v databázi: ${listDistricts(db).length}`)

const WIDTH = 110
const HEIGHT = 30
const theme = themeByName("tokyonight")
const setup = await createTestRenderer({ width: WIDTH, height: HEIGHT })
const frame = new Frame(setup.renderer)
frame.attach(setup.renderer.root)
const nav = new Navigation()
nav.push({ kind: "districts" })

const inputs = () => ({
  db,
  nav,
  councilType: "OBEC",
  query: "",
  theme,
  sort: UNSORTED,
  width: WIDTH,
  contentWidth: frame.contentWidth > 0 ? frame.contentWidth : WIDTH - 3,
  contentHeight: frame.contentHeight > 0 ? frame.contentHeight : HEIGHT - 4,
  warning: null,
  notice: null,
})

/** Runs `fn` `runs` times and reports the median and the worst. */
function measure(label: string, runs: number, fn: () => void): number {
  // A warm-up pass, so the first-call cost of a query plan is not charged to everyone.
  for (let i = 0; i < 5; i += 1) fn()
  const samples: number[] = []
  for (let i = 0; i < runs; i += 1) {
    const t = performance.now()
    fn()
    samples.push(performance.now() - t)
  }
  samples.sort((a, b) => a - b)
  const median = samples[Math.floor(samples.length / 2)] ?? 0
  const worst = samples[samples.length - 1] ?? 0
  console.log(
    `  ${label.padEnd(44)} medián ${median.toFixed(2).padStart(7)} ms   nejhorší ${worst.toFixed(2).padStart(7)} ms`,
  )
  return median
}

console.log("\n--- části jednoho stisku klávesy ---")
measure("listDistricts (dotaz do databáze)", 50, () => {
  listDistricts(db)
})
measure("buildDistrictListRows (sestavení řádků)", 50, () => {
  buildDistrictListRows(db, 105, UNSORTED)
})
measure("composeScreen (jedno složení obrazovky)", 50, () => {
  composeScreen(db, { kind: "districts" }, { width: 105, councilType: "OBEC", sort: UNSORTED })
})
measure("frameState (složení obrazovky + klíče řádků)", 50, () => {
  frameState(inputs())
})
// Warm the frame once, so what follows measures a STEADY-STATE redraw rather than the
// first one, which necessarily writes every row.
applyFrameState(frame, frameState(inputs()), theme)
measure("applyFrameState (překreslení beze změny)", 50, () => {
  applyFrameState(frame, frameState(inputs()), theme)
})
measure("applyFrameState (po posunu výběru o řádek)", 50, () => {
  nav.move(1, 77)
  applyFrameState(frame, frameState(inputs()), theme)
})

console.log("\n--- celý stisk klávesy, jak jej dělá App.onKey ---")
await setup.renderOnce()
const total = await (async () => {
  const samples: number[] = []
  for (let i = 0; i < 30; i += 1) {
    const t = performance.now()
    // Exactly what App.onKey does for a movement key: compose once, move, draw with the
    // screen already composed.
    const content = composeScreen(db, nav.screen, {
      width: 105,
      councilType: "OBEC",
      sort: UNSORTED,
    })
    nav.move(1, content.rowCount)
    applyFrameState(frame, { ...frameState({ ...inputs(), content }) }, theme)
    await setup.renderOnce()
    samples.push(performance.now() - t)
  }
  samples.sort((a, b) => a - b)
  const median = samples[Math.floor(samples.length / 2)] ?? 0
  console.log(
    `  ${"stisk klávesy celkem".padEnd(44)} medián ${median.toFixed(2).padStart(7)} ms   nejhorší ${(samples[samples.length - 1] ?? 0).toFixed(2).padStart(7)} ms`,
  )
  return median
})()

console.log(`\nrozpočet na stisk klávesy: 100 ms (SC-010)`)
console.log(total > 100 ? "PŘEKROČENO" : "v rozpočtu, ale viz rozpad výše")
setup.renderer.destroy()
