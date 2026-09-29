/**
 * The chart pane (feature 006), drawn headlessly from the fixtures, for a look at the
 * real layout without a terminal: the reduced table, the pie and the legend.
 *
 * Usage:
 *   bun run tools/verify/chart-view.ts [width] [height]
 *
 *   SCREEN=national (default), SCREEN=council:582786, SCREEN=candidates:551082:768
 *   THEME=<theme name> or THEME=mono     NOCHART=1 draws the same screen without the pane
 */

import { readFileSync } from "node:fs"
import { createTestRenderer } from "@opentui/core/testing"
import { extractArchiveFile } from "../../src/reference/archive.ts"
import { loadReference } from "../../src/reference/loader.ts"
import { ingestCouncil, ingestDistrict, ingestNational } from "../../src/sources/ingest.ts"
import { openMemoryDatabase } from "../../src/storage/db.ts"
import { Frame } from "../../src/ui/chrome/frame.ts"
import { chartFits } from "../../src/ui/chrome/panel.ts"
import { applyFrameState, applyPanel, frameState, panelFor } from "../../src/ui/chrome/state.ts"
import { Navigation } from "../../src/ui/navigation.ts"
import { UNSORTED } from "../../src/ui/sort.ts"
import { isThemeName, MONOCHROME, themeByName } from "../../src/ui/theme/themes.ts"

const [width = 100, height = 30] = process.argv.slice(2).map(Number)
const themeName = process.env.THEME ?? "tokyonight"
const theme =
  themeName === "mono" ? MONOCHROME : themeByName(isThemeName(themeName) ? themeName : "tokyonight")

const db = openMemoryDatabase()
const reg = await extractArchiveFile("fixtures/2026/reg.zip")
const cis = await extractArchiveFile("fixtures/2026/ciselniky.zip")
if (reg.ok && cis.ok) loadReference(db, { registry: reg.files, codelists: cis.files })
ingestNational(db, readFileSync("fixtures/2026/vysledky.xml", "utf8"))
ingestDistrict(db, "CZ0642", readFileSync("fixtures/2026/vysledky_obce_okres_CZ0642.xml", "utf8"))
for (const code of ["551082", "582786"]) {
  ingestCouncil(db, code, readFileSync(`fixtures/2026/vysledky_obec_${code}.xml`, "utf8"))
}

const nav = new Navigation()
const [kind, code, party] = (process.env.SCREEN ?? "national").split(":")
if (kind === "council" && code) nav.push({ kind: "council", kodzastup: code })
if (kind === "candidates" && code && party) {
  nav.push({ kind: "candidates", kodzastup: code, vstrana: party, ballotOrder: null })
}

const setup = await createTestRenderer({ width, height })
const frame = new Frame(setup.renderer)
frame.attach(setup.renderer.root)
await setup.renderOnce()

// Twice: the first pass settles the layout so the second is composed at the real widths.
for (let pass = 0; pass < 2; pass += 1) {
  const panel = panelFor(db, {
    chartOpen: process.env.NOCHART === undefined,
    sidePanelOpen: false,
    screen: nav.screen,
    councilType: "OBEC",
    contentAreaWidth: frame.rawContentWidth,
    contentHeight: frame.contentHeight,
  })
  applyPanel(frame, db, theme, panel)
  applyFrameState(
    frame,
    frameState({
      db,
      nav,
      councilType: "OBEC",
      query: "",
      theme,
      sort: UNSORTED,
      width,
      contentWidth: frame.contentWidth,
      contentHeight: frame.contentHeight,
      sourceStatus: null,
      notice: null,
      chartShown: panel?.kind === "chart",
      chartFits: chartFits(frame.rawContentWidth),
    }),
    theme,
  )
  await setup.renderOnce()
}

console.log(setup.captureCharFrame())
setup.renderer.destroy()
