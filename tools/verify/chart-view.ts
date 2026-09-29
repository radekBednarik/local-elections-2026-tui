import { readFileSync } from "node:fs"
import { createTestRenderer } from "@opentui/core/testing"
import { ingestNational } from "../../src/sources/ingest.ts"
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
ingestNational(db, readFileSync("fixtures/2026/vysledky.xml", "utf8"))
const t = await createTestRenderer({ width: w, height: h })
const frame = new Frame(t.renderer)
frame.attach(t.renderer.root)
await t.renderOnce()
const theme = themeByName("tokyonight")
const nav = new Navigation()
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
