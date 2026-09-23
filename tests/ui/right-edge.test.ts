/**
 * Nothing is cut off at the right edge (bug: rendering-bugs).
 *
 * The selection gutter used to be taken off twice: once before the view was composed and
 * again when each row was styled. Every table that uses its full width was therefore
 * clamped two columns short, and the terminal showed "Mand…" where the council table's
 * last column should be, and a column of lone "…" after Stav on the district screen.
 *
 * The plain lines were always right, which is why the text-based tests never noticed:
 * the fault was only in the styled form. So the styled form is what is asserted here,
 * and it is asserted against the plain form, which is the promise state.ts makes.
 */

import type { Database } from "bun:sqlite"
import { beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { extractArchiveFile } from "../../src/reference/archive.ts"
import { loadReference, type ReferenceArchives } from "../../src/reference/loader.ts"
import { ingestDistrict, ingestNational } from "../../src/sources/ingest.ts"
import { openMemoryDatabase } from "../../src/storage/db.ts"
import { frameState, viewWidthFor } from "../../src/ui/chrome/state.ts"
import { Navigation, type Screen } from "../../src/ui/navigation.ts"
import { composeScreen } from "../../src/ui/screen.ts"
import { UNSORTED } from "../../src/ui/sort.ts"
import { themeByName } from "../../src/ui/theme/themes.ts"

const FIXTURES = join(import.meta.dir, "../../fixtures/2026")
const read = (name: string) => readFileSync(join(FIXTURES, name), "utf8")

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
  ingestNational(db, read("vysledky.xml"))
  ingestDistrict(db, "CZ0642", read("vysledky_obce_okres_CZ0642.xml"))
})

const SCREENS: { name: string; screen: Screen }[] = [
  { name: "the district list", screen: { kind: "districts" } },
  { name: "one district", screen: { kind: "district", nuts: "CZ0642" } },
  { name: "one council", screen: { kind: "council", kodzastup: "551082" } },
]

// 80 is the minimum supported terminal; 160 is wide enough for the council table's bars.
const CONTENT_WIDTHS = [77, 97, 117, 157]

/** Frame state for one screen, with the selection on its first row. */
function stateFor(screen: Screen, contentWidth: number) {
  const nav = new Navigation()
  nav.push(screen)
  return frameState({
    db,
    nav,
    councilType: "OBEC",
    query: "",
    theme: themeByName("tokyonight"),
    sort: UNSORTED,
    width: contentWidth + 3,
    contentWidth,
    contentHeight: 40,
    warning: null,
    notice: null,
  })
}

/** What the terminal is actually given for one row. */
function styledText(state: ReturnType<typeof stateFor>, index: number): string {
  return state
    .styleRow(index)
    .chunks.map((c) => c.text)
    .join("")
}

describe("a styled row is cut where its plain form is, and nowhere else", () => {
  for (const { name, screen } of SCREENS) {
    for (const contentWidth of CONTENT_WIDTHS) {
      test(`${name} at ${contentWidth} columns`, () => {
        const state = stateFor(screen, contentWidth)
        state.lines.forEach((plain, index) => {
          expect(styledText(state, index).trimEnd()).toBe(plain.trimEnd())
        })
      })
    }
  }

  test("no styled row ends in an ellipsis its plain form does not have", () => {
    for (const { screen } of SCREENS) {
      for (const contentWidth of CONTENT_WIDTHS) {
        const state = stateFor(screen, contentWidth)
        state.lines.forEach((plain, index) => {
          if (plain.trimEnd().endsWith("…")) return
          expect(styledText(state, index).trimEnd().endsWith("…")).toBe(false)
        })
      }
    }
  })

  test("a styled row never runs past the content area", () => {
    for (const { screen } of SCREENS) {
      for (const contentWidth of CONTENT_WIDTHS) {
        const state = stateFor(screen, contentWidth)
        state.lines.forEach((_, index) => {
          expect([...styledText(state, index)].length).toBeLessThanOrEqual(contentWidth)
        })
      }
    }
  })
})

describe("the columns reported cut off are shown whole", () => {
  test("the council table's Mandáty header, even with the bars shown", () => {
    for (const contentWidth of CONTENT_WIDTHS) {
      const state = stateFor({ kind: "council", kodzastup: "551082" }, contentWidth)
      const header = state.lines.findIndex((l) => l.includes("Volební strana"))
      expect(header).toBeGreaterThan(0)
      expect(styledText(state, header).trimEnd().endsWith("Mandáty")).toBe(true)
    }
  })

  test("the council table's seat counts end in a digit, not an ellipsis", () => {
    const state = stateFor({ kind: "council", kodzastup: "551082" }, 157)
    const first = state.content.firstRow
    expect(state.content.rowCount).toBeGreaterThan(0)
    for (let i = 0; i < state.content.rowCount; i += 1) {
      expect(styledText(state, first + i).trimEnd()).toMatch(/\d$/)
    }
  })

  test("the district screen has nothing after Stav", () => {
    for (const contentWidth of CONTENT_WIDTHS) {
      const state = stateFor({ kind: "district", nuts: "CZ0642" }, contentWidth)
      const header = state.lines.findIndex((l) => l.includes("Okrsky"))
      expect(header).toBeGreaterThan(0)
      expect(styledText(state, header).trimEnd().endsWith("Stav")).toBe(true)
    }
  })
})

describe("one width for every draw", () => {
  test("a screen composed for a keystroke is laid out as a refresh lays it out", () => {
    // App.onKey composes the screen itself and hands it to the draw. It used to compose
    // two columns wider, so the table jumped right on every key and back on the next
    // refresh. Both paths must now agree to the character.
    for (const contentWidth of CONTENT_WIDTHS) {
      for (const { screen } of SCREENS) {
        const refreshed = stateFor(screen, contentWidth)
        const keyed = composeScreen(db, screen, {
          width: viewWidthFor(contentWidth),
          councilType: "OBEC",
          query: "",
          sort: UNSORTED,
        })
        expect(keyed.lines).toEqual(refreshed.content.lines)
      }
    }
  })
})
