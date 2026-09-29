import { readFileSync } from "node:fs"
import { createTestRenderer } from "@opentui/core/testing"
import { extractArchiveFile } from "../../src/reference/archive.ts"
import { loadReference } from "../../src/reference/loader.ts"
import { ingestCouncil, ingestDistrict, ingestNational } from "../../src/sources/ingest.ts"
import { openMemoryDatabase } from "../../src/storage/db.ts"
import { Frame } from "../../src/ui/chrome/frame.ts"
import { chartPaneWidth } from "../../src/ui/chrome/panel.ts"
import { applyFrameState, applyPanel, frameState } from "../../src/ui/chrome/state.ts"
import { Navigation } from "../../src/ui/navigation.ts"
import { UNSORTED } from "../../src/ui/sort.ts"
import { themeByName } from "../../src/ui/theme/themes.ts"
import { chartContext } from "../../src/ui/views/chart.ts"

const [w = 100, h = 30] = process.argv.slice(2).map(Number)
const db = openMemoryDatabase()
const reg = await extractArchiveFile("fixtures/2026/reg.zip")
const cis = await extractArchiveFile("fixtures/2026/ciselniky.zip")
if (reg.ok && cis.ok) loadReference(db, { registry: reg.files, codelists: cis.files })
ingestNational(db, readFileSync("fixtures/2026/vysledky.xml", "utf8"))
ingestDistrict(db, "CZ0642", readFileSync("fixtures/2026/vysledky_obce_okres_CZ0642.xml", "utf8"))
for (const code of ["551082", "582786"])
  ingestCouncil(db, code, readFileSync(`fixtures/2026/vysledky_obec_${code}.xml`, "utf8"))
const t = await createTestRenderer({ width: w, height: h })
const frame = new Frame(t.renderer)
frame.attach(t.renderer.root)
await t.renderOnce()
const theme = themeByName("tokyonight")
const nav = new Navigation()
// SCREEN=council:582786 or SCREEN=candidates:551082:768
const [kind, code, party] = (process.env.SCREEN ?? "national").split(":")
if (kind === "council" && code) nav.push({ kind: "council", kodzastup: code })
if (kind === "candidates" && code && party)
  nav.push({ kind: "candidates", kodzastup: code, vstrana: party, ballotOrder: null })
for (let i = 0; i < 2; i++) {
  const context = chartContext(db, nav.screen, "OBEC")!
  applyPanel(
    frame,
    db,
    theme,
    process.env.NOCHART
      ? null
      : { kind: "chart", context, width: chartPaneWidth(frame.rawContentWidth), height: frame.contentHeight },
  )
  applyFrameState(
    frame,
    frameState({
      db,
      nav,
      councilType: "OBEC",
      query: "",
      theme,
      sort: UNSORTED,
      width: w,
      contentWidth: frame.contentWidth,
      contentHeight: frame.contentHeight,
      sourceStatus: null,
      notice: null,
      chartShown: true,
      chartFits: true,
    }),
    theme,
  )
  await t.renderOnce()
}
console.log(t.captureCharFrame())
t.renderer.destroy()
