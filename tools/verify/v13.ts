/**
 * Quickstart V13 - framed regions and breadcrumb (T125, FR-054, FR-055, FR-058).
 *
 * Drills from the national overview to a council against the committed fixtures,
 * printing each captured frame, then proves that a refresh arriving mid-view moves
 * nothing.
 *
 * Run: bun run tools/verify/v13.ts
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createTestRenderer } from "@opentui/core/testing"
import { extractArchiveFile } from "../../src/reference/archive.ts"
import { loadReference } from "../../src/reference/loader.ts"
import { ingestDistrict, ingestNational } from "../../src/sources/ingest.ts"
import { openMemoryDatabase } from "../../src/storage/db.ts"
import { listCouncilsInDistrict } from "../../src/storage/queries/areas.ts"
import { Frame } from "../../src/ui/chrome/frame.ts"
import { applyFrameState, frameState } from "../../src/ui/chrome/state.ts"
import { Navigation } from "../../src/ui/navigation.ts"
import { UNSORTED } from "../../src/ui/sort.ts"
import { themeByName } from "../../src/ui/theme/themes.ts"

const FIXTURES = join(import.meta.dir, "../../fixtures/2026")
const read = (name: string) => readFileSync(join(FIXTURES, name), "utf8")

const WIDTH = 100
const HEIGHT = 28

const db = openMemoryDatabase()
const reg = await extractArchiveFile(join(FIXTURES, "reg.zip"))
const cis = await extractArchiveFile(join(FIXTURES, "ciselniky.zip"))
if (!reg.ok || !cis.ok) throw new Error("fixture archives could not be extracted")
loadReference(db, { registry: reg.files, codelists: cis.files })
ingestNational(db, read("vysledky.xml"))
ingestDistrict(db, "CZ0642", read("vysledky_obce_okres_CZ0642.xml"))

const setup = await createTestRenderer({ width: WIDTH, height: HEIGHT })
const frame = new Frame(setup.renderer)
frame.attach(setup.renderer.root)
const nav = new Navigation()

async function draw(): Promise<string> {
  applyFrameState(
    frame,
    frameState({
      db,
      nav,
      councilType: "OBEC",
      theme: themeByName("tokyonight"),
      sort: UNSORTED,
      query: "",
      width: WIDTH,
      contentWidth: frame.contentWidth > 0 ? frame.contentWidth : WIDTH - 2,
      contentHeight: frame.contentHeight > 0 ? frame.contentHeight : HEIGHT - 4,
      sourceStatus: null,
      notice: null,
    }),
  )
  await setup.renderOnce()
  return setup.captureCharFrame()
}

function report(label: string, captured: string): void {
  console.log(`\n===== ${label} =====`)
  console.log(captured)
  const lines = captured.split("\n")
  const top = lines.findIndex((l) => l.includes("┌"))
  const bottom = lines.findIndex((l) => l.includes("└"))
  const status = lines.reduce((last, l, i) => (l.trim() === "" ? last : i), -1)
  console.log(
    `regions: breadcrumb=0 border=${top}..${bottom} status=${status}  ` +
      `breadcrumb text: ${JSON.stringify(lines[0]?.trim())}`,
  )
}

report("ČR", await draw())

nav.push({ kind: "districts" })
report("Okresy", await draw())

nav.push({ kind: "district", nuts: "CZ0642" })
nav.move(2, 40)
report("Okres", await draw())

const council = listCouncilsInDistrict(db, "CZ0642")[0]
if (council !== undefined) {
  nav.push({ kind: "council", kodzastup: council.kodzastup })
  report("Zastupitelstvo", await draw())
}

// Back up, proving the breadcrumb shortens.
nav.pop()
report("Zpět na okres", await draw())

// FR-058: a refresh arrives while the view is open.
console.log("\n===== refresh mid-view =====")
nav.move(6, 40)
const before = await draw()
const stateBefore = { selected: nav.current.selected, offset: nav.current.offset }
ingestDistrict(db, "CZ0642", read("vysledky_obce_okres_CZ0642.xml"))
const after = await draw()

const regionsOf = (captured: string) => {
  const lines = captured.split("\n")
  return [
    lines.findIndex((l) => l.includes("┌")),
    lines.findIndex((l) => l.includes("└")),
    lines.reduce((last, l, i) => (l.trim() === "" ? last : i), -1),
  ].join(",")
}

const moved =
  regionsOf(before) !== regionsOf(after) ||
  stateBefore.selected !== nav.current.selected ||
  stateBefore.offset !== nav.current.offset

console.log(`regions before: ${regionsOf(before)}   after: ${regionsOf(after)}`)
console.log(`selection before: ${JSON.stringify(stateBefore)}   after:`, {
  selected: nav.current.selected,
  offset: nav.current.offset,
})
console.log(moved ? "V13 FAILED: something moved on refresh" : "V13: nothing moved on refresh")

setup.renderer.destroy()
process.exit(moved ? 1 : 0)
