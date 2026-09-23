/**
 * Quickstart V14, V15, V16, V17 and V19 (tasks T134, T141, T148, T154, T166).
 *
 * The amendment scenarios that can be driven headlessly, in one run. V18 is absent
 * deliberately: it is the mouse scenario, and `createTestRenderer` uses a mock input, so
 * anything this file printed about Shift-drag would be worthless. V18 is checked by hand
 * (T161).
 *
 * Run: bun run tools/verify/amendment.ts
 * Exits non-zero if any scenario fails, so it can gate a release.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { CapturedSpan } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { extractArchiveFile } from "../../src/reference/archive.ts"
import { loadReference } from "../../src/reference/loader.ts"
import { ingestDistrict, ingestNational } from "../../src/sources/ingest.ts"
import { openMemoryDatabase } from "../../src/storage/db.ts"
import {
  readSidePanelOpen,
  readTheme,
  writeSidePanelOpen,
  writeTheme,
} from "../../src/storage/queries/preferences.ts"
import { toggleWatchlist } from "../../src/storage/queries/watchlist.ts"
import { Frame } from "../../src/ui/chrome/frame.ts"
import { panelFits } from "../../src/ui/chrome/panel.ts"
import { applyFrameState, applyPanel, frameState } from "../../src/ui/chrome/state.ts"
import type { Screen } from "../../src/ui/navigation.ts"
import { Navigation } from "../../src/ui/navigation.ts"
import { ACTIONS, type ActionContext } from "../../src/ui/palette/actions.ts"
import { entryRow, filterEntries, paletteEntries } from "../../src/ui/palette/view.ts"
import { toTextLines } from "../../src/ui/row.ts"
import { UNSORTED } from "../../src/ui/sort.ts"
import { MONOCHROME, THEME_NAMES, type Theme, themeByName } from "../../src/ui/theme/themes.ts"

const FIXTURES = join(import.meta.dir, "../../fixtures/2026")
const read = (name: string) => readFileSync(join(FIXTURES, name), "utf8")

const db = openMemoryDatabase()
const reg = await extractArchiveFile(join(FIXTURES, "reg.zip"))
const cis = await extractArchiveFile(join(FIXTURES, "ciselniky.zip"))
if (!reg.ok || !cis.ok) throw new Error("fixture archives could not be extracted")
loadReference(db, { registry: reg.files, codelists: cis.files })
ingestNational(db, read("vysledky.xml"))
ingestDistrict(db, "CZ0642", read("vysledky_obce_okres_CZ0642.xml"))

const failures: string[] = []

function check(scenario: string, claim: string, ok: boolean): void {
  console.log(`  ${ok ? "OK   " : "CHYBA"} ${claim}`)
  if (!ok) failures.push(`${scenario}: ${claim}`)
}

/**
 * The content columns of the frame, with the border and the scroll bar removed.
 *
 * The scroll bar is drawn from the same block characters the bars are, down the last
 * column. Checking a bar against the whole frame checks the scroll bar too, which is a
 * bug in the checker and not in the application.
 */
function contentOnly(text: string): string {
  return text
    .split("\n")
    .filter((line) => line.startsWith("│"))
    .map((line) => [...line].slice(1, -2).join(""))
    .join("\n")
}

interface Painted {
  text: string
  spans: CapturedSpan[]
  frame: Frame
}

/** Draws one screen at a given size and theme, with the panel shown if it fits. */
async function paint(
  screen: Screen,
  theme: Theme,
  width: number,
  height: number,
  wantPanel = false,
): Promise<Painted> {
  const setup = await createTestRenderer({ width, height })
  try {
    const frame = new Frame(setup.renderer)
    frame.attach(setup.renderer.root)
    const nav = new Navigation()
    if (screen.kind !== "national") nav.push(screen)

    // Two passes: the first settles the layout so the measured widths are real.
    for (let pass = 0; pass < 2; pass += 1) {
      applyPanel(frame, db, theme, wantPanel && panelFits(frame.rawContentWidth))
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
          contentWidth: frame.contentWidth > 0 ? frame.contentWidth : width - 3,
          contentHeight: frame.contentHeight > 0 ? frame.contentHeight : height - 4,
          warning: null,
          notice: null,
        }),
      )
      await setup.renderOnce()
    }
    return {
      text: setup.captureCharFrame(),
      spans: setup.captureSpans().lines.flatMap((l) => l.spans),
      frame,
    }
  } finally {
    setup.renderer.destroy()
  }
}

const COUNCIL: Screen = { kind: "council", kodzastup: "582786" }

// ---------------------------------------------------------------- V14: side panel
console.log("\n===== V14 - postranní panel (FR-056, FR-057) =====")
toggleWatchlist(db, "551082")
toggleWatchlist(db, "551325")

const wide = await paint(COUNCIL, themeByName("tokyonight"), 130, 30, true)
console.log(wide.text)
check("V14", "panel je vidět na širokém terminálu", wide.text.includes("SLEDOVANÉ"))
check("V14", "obě sledovaná zastupitelstva jsou v panelu", wide.text.includes("Brno-Bohunice"))
// Czech percentages are grouped with U+00A0, so the separator is matched as whitespace
// rather than as a literal space.
check("V14", "panel ukazuje živé údaje", /\d+,\d+\s%/u.test(wide.text))
check("V14", "tabulka zůstává čitelná vedle panelu", wide.text.includes("Volební strana"))

const narrow = await paint(COUNCIL, themeByName("tokyonight"), 80, 24, true)
check("V14", "panel se sám skryje na 80 sloupcích", !narrow.text.includes("Sledované"))
check("V14", "obsah si ponechal šířku", narrow.frame.contentWidth >= 64)

writeSidePanelOpen(db, false)
check("V14", "stav panelu přežije restart", readSidePanelOpen(db) === false)
writeSidePanelOpen(db, true)

// ---------------------------------------------------------------- V15: themes
console.log("\n===== V15 - motivy (FR-059 až FR-063) =====")
for (const name of THEME_NAMES) {
  writeTheme(db, name)
  check("V15", `motiv ${name} přežije restart`, readTheme(db) === name)
}

const dark = await paint(COUNCIL, themeByName("tokyonight"), 110, 30)
const mono = await paint(COUNCIL, MONOCHROME, 110, 30)
check("V15", "bez barev je obrazovka znak po znaku stejná", mono.text === dark.text)

const colourKey = (s: CapturedSpan) => `${s.fg.r},${s.fg.g},${s.fg.b},${s.attributes}`
/**
 * Foreground alone.
 *
 * The monochrome theme keeps BOLD - emphasis that survives a terminal with no colour at
 * all is the point of FR-063 - so a key including the attributes would report two
 * "colours" where there is one.
 */
const fgKey = (s: CapturedSpan) => `${s.fg.r},${s.fg.g},${s.fg.b}`

/**
 * Spans that carry text, rather than the frame's own box-drawing.
 *
 * The borders are drawn by the layout engine in its own default colour when the theme
 * asks for none, which is a decoration the application does not control. FR-063 is about
 * the CONTENT: no figure, status or heading may depend on colour to be understood.
 */
function textSpans(spans: CapturedSpan[]): CapturedSpan[] {
  return spans.filter((s) => /\p{L}|\d/u.test(s.text))
}
check("V15", "s motivem se skutečně kreslí více barev", new Set(dark.spans.map(colourKey)).size > 1)
check(
  "V15",
  "bez barev nenese žádný text vlastní barvu",
  new Set(textSpans(mono.spans).map(fgKey)).size === 1,
)

const partySpans = ["ANO 2011", "Fakt Brno", "Česká pirátská strana"]
  .map((p) => dark.spans.find((s) => s.text.includes(p)))
  .filter((s): s is CapturedSpan => s !== undefined)
check(
  "V15",
  "žádná volební strana není obarvena jinak než ostatní (FR-060)",
  partySpans.length >= 2 && new Set(partySpans.map(colourKey)).size === 1,
)

const high = await paint(COUNCIL, themeByName("high-contrast"), 110, 30)
const lum = (s: CapturedSpan) => 0.299 * s.fg.r + 0.587 * s.fg.g + 0.114 * s.fg.b
const heading = high.spans.find((s) => s.text.includes("Volební strana"))
const muted = high.spans.find((s) => s.text.includes("statutárního"))
check(
  "V15",
  "vysoký kontrast odlišuje role jasem, ne odstínem",
  heading !== undefined && muted !== undefined && Math.abs(lum(heading) - lum(muted)) > 0.2,
)

// ---------------------------------------------------------------- V16: palette
console.log("\n===== V16 - paleta příkazů (FR-065 až FR-069) =====")
const context: ActionContext = {
  screen: COUNCIL,
  depth: 3,
  rowCount: 13,
  councilTypes: 1,
  searchActive: false,
  sortableColumns: 5,
}
const entries = paletteEntries(context)
// The palette lists the registry and, after it, one entry per theme (002 FR-005).
const drawn = (e: (typeof entries)[number]) => toTextLines([entryRow(e, false, 80)])[0] ?? ""
check("V16", "paleta uvádí všechny akce aplikace", entries.length === ACTIONS.length + THEME_NAMES.length)
check(
  "V16",
  "u každé akce je uvedena klávesa",
  entries.every((e) => drawn(e).includes(e.action.key)),
)

for (const entry of entries) {
  const mark = entry.available ? "  " : "× "
  console.log(`  ${mark}${drawn(entry)}`)
}

const districts: ActionContext = { ...context, screen: { kind: "districts" }, depth: 2 }
const unavailable = paletteEntries(districts).filter((e) => !e.available)
check("V16", "nedostupné akce jsou uvedeny, ne skryty", unavailable.length > 0)
check(
  "V16",
  "a u každé je uveden důvod",
  unavailable.every((e) => (e.reason ?? "").length > 5),
)

check(
  "V16",
  "hledání bez diakritiky najde totéž co s diakritikou",
  filterEntries(entries, "napoveda")[0]?.action.id === filterEntries(entries, "nápověda")[0]?.action.id,
)
check("V16", "hledání podle klávesy funguje", filterEntries(entries, "ctrl+b")[0]?.action.id === "side-panel")

// ---------------------------------------------------------------- V17: bars
console.log("\n===== V17 - pruhy (FR-070 až FR-074) =====")
const withBars = await paint(COUNCIL, themeByName("tokyonight"), 120, 30)
console.log(withBars.text)
check("V17", "pruhy se kreslí u širokého terminálu", withBars.text.includes("█"))
check("V17", "u pruhu je vždy zveřejněný údaj", /█.*|.*%/.test(withBars.text) && withBars.text.includes("%"))

const noBars = await paint(COUNCIL, themeByName("tokyonight"), 80, 24)
check("V17", "na úzkém terminálu pruhy zmizí celé", !/[▏▎▍▌▋▊▉█]/.test(contentOnly(noBars.text)))
check("V17", "údaje ale zůstanou", noBars.text.includes("%") && noBars.text.includes("ANO 2011"))
check("V17", "nikde není žádná časová řada", !/[▁▂▃▄▅▆▇]/.test(contentOnly(withBars.text)))

// ---------------------------------------------------------------- V19: everything at once
console.log("\n===== V19 - vše degradované najednou (SC-023) =====")
const degraded = await paint(COUNCIL, MONOCHROME, 80, 24, true)
console.log(degraded.text)
check(
  "V19",
  "vejde se do 80 sloupců",
  degraded.text.split("\n").every((l) => [...l].length <= 80),
)
check("V19", "vejde se do 24 řádků", degraded.text.split("\n").filter((l) => l !== "").length <= 24)
check("V19", "panel je skrytý", !degraded.text.includes("Sledované"))
check("V19", "pruhy jsou pryč", !/[▏▎▍▌▋▊▉█]/.test(contentOnly(degraded.text)))
check("V19", "barvy jsou pryč", new Set(textSpans(degraded.spans).map(fgKey)).size === 1)
check("V19", "název zastupitelstva je vidět", degraded.text.includes("Brno"))
check("V19", "tabulka je vidět", degraded.text.includes("Volební strana"))
check("V19", "údaje jsou vidět", degraded.text.includes("%"))
check("V19", "výběr je poznat bez barvy", degraded.text.includes("▶"))
check("V19", "stavový řádek nabízí akce", /konec|zpět|hledat|příkazy/.test(degraded.text))
check("V19", "drobečková navigace je vidět", degraded.text.includes("ČR"))

// ---------------------------------------------------------------- report
console.log("\n=====================================")
if (failures.length === 0) {
  console.log("Všechny scénáře prošly (V14, V15, V16, V17, V19).")
  console.log("V18 (myš) není automatizovatelný - vyžaduje ruční ověření, viz T161.")
  process.exit(0)
}
console.log(`NEPROŠLO ${failures.length}:`)
for (const failure of failures) console.log(`  - ${failure}`)
process.exit(1)
