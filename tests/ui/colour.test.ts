/**
 * Colour applied (T136, T138-T140, FR-059 to FR-063, SC-023, SC-024).
 *
 * Asserted against the COLOURS ACTUALLY WRITTEN to the frame, read back through
 * `captureSpans`, not against the theme table. A theme that is correct and never reaches
 * the screen would pass a test of the table and fail the user.
 */

import type { Database } from "bun:sqlite"
import { beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { CapturedSpan } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { extractArchiveFile } from "../../src/reference/archive.ts"
import { loadReference, type ReferenceArchives } from "../../src/reference/loader.ts"
import { ingestDistrict, ingestNational } from "../../src/sources/ingest.ts"
import { openMemoryDatabase } from "../../src/storage/db.ts"
import { Frame } from "../../src/ui/chrome/frame.ts"
import { applyFrameState, frameState } from "../../src/ui/chrome/state.ts"
import type { Screen } from "../../src/ui/navigation.ts"
import { Navigation } from "../../src/ui/navigation.ts"
import { MONOCHROME, type Theme, themeByName } from "../../src/ui/theme/themes.ts"

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

interface Painted {
  text: string
  spans: CapturedSpan[]
}

/** Renders one screen and returns both its text and the colours actually written. */
async function paint(screen: Screen, theme: Theme, width = 110, height = 34): Promise<Painted> {
  const setup = await createTestRenderer({ width, height })
  try {
    const frame = new Frame(setup.renderer)
    frame.attach(setup.renderer.root)
    const nav = new Navigation()
    if (screen.kind !== "national") nav.push(screen)

    applyFrameState(
      frame,
      frameState({
        db,
        nav,
        councilType: "OBEC",
        query: "",
        theme,
        width,
        contentWidth: frame.contentWidth > 0 ? frame.contentWidth : width - 3,
        contentHeight: frame.contentHeight > 0 ? frame.contentHeight : height - 4,
        warning: null,
        notice: null,
      }),
    )
    await setup.renderOnce()
    return {
      text: setup.captureCharFrame(),
      spans: setup.captureSpans().lines.flatMap((line) => line.spans),
    }
  } finally {
    setup.renderer.destroy()
  }
}

const key = (span: CapturedSpan) => `${span.fg.r},${span.fg.g},${span.fg.b},${span.attributes}`

describe("no electoral party is coloured (FR-060, T138)", () => {
  // With thousands of local candidate lists there is no authoritative colour per party,
  // and assigning one would imply a political affiliation the source never published.
  test("every party name in a council table is painted identically", async () => {
    const { spans } = await paint({ kind: "council", kodzastup: "582786" }, themeByName("dark"))

    const parties = ["ANO 2011", "Česká pirátská strana", "Fakt Brno", "RESTART PRO BRNO"]
    const found = parties
      .map((name) => spans.find((s) => s.text.includes(name)))
      .filter((s): s is CapturedSpan => s !== undefined)

    expect(found.length).toBeGreaterThanOrEqual(3)
    const distinct = new Set(found.map(key))
    expect(distinct.size).toBe(1)
  })

  test("the same holds in the national table, across every theme", async () => {
    for (const name of ["dark", "light", "high-contrast"] as const) {
      const { spans } = await paint({ kind: "national" }, themeByName(name))
      const found = ["ANO 2011", "KDU-ČSL", "Nezávislý kandidát"]
        .map((party) => spans.find((s) => s.text.includes(party)))
        .filter((s): s is CapturedSpan => s !== undefined)
      expect(found.length).toBeGreaterThanOrEqual(2)
      expect(new Set(found.map(key)).size).toBe(1)
    }
  })
})

describe("the monochrome guarantee (FR-063, SC-023, T139)", () => {
  test("removing colour removes nothing but decoration", async () => {
    const coloured = await paint({ kind: "council", kodzastup: "582786" }, themeByName("dark"))
    const plain = await paint({ kind: "council", kodzastup: "582786" }, MONOCHROME)

    // Character for character, the two screens are the same. Colour was never carrying
    // anything the text was not already carrying.
    expect(plain.text).toBe(coloured.text)
  })

  test("every status is still readable as words", async () => {
    const { text } = await paint({ kind: "district", nuts: "CZ0642" }, MONOCHROME)
    expect(text).toContain("konečné")
    expect(text).toMatch(/Účast|Okrsky/)
  })

  test("the selection is marked by a symbol, not by colour", async () => {
    const { text } = await paint({ kind: "district", nuts: "CZ0642" }, MONOCHROME)
    expect(text).toContain("▶")
  })

  test("nothing in a monochrome frame carries a foreground colour of its own", async () => {
    const { spans } = await paint({ kind: "council", kodzastup: "582786" }, MONOCHROME)
    const party = spans.find((s) => s.text.includes("ANO 2011"))
    const heading = spans.find((s) => s.text.includes("Volební strana"))
    expect(party).toBeDefined()
    expect(heading).toBeDefined()
    // Both fall back to the terminal's default foreground, so neither is coloured.
    expect(`${party?.fg.r},${party?.fg.g},${party?.fg.b}`).toBe(
      `${heading?.fg.r},${heading?.fg.g},${heading?.fg.b}`,
    )
  })
})

describe("high contrast (FR-062, SC-024, T140)", () => {
  const luminance = (span: CapturedSpan) => 0.299 * span.fg.r + 0.587 * span.fg.g + 0.114 * span.fg.b

  test("roles are separated by brightness, so hue is never load-bearing", async () => {
    const { spans } = await paint({ kind: "council", kodzastup: "582786" }, themeByName("high-contrast"))

    const heading = spans.find((s) => s.text.includes("Volební strana"))
    const muted = spans.find((s) => s.text.includes("zveřejňují se pouze dávkově"))
    expect(heading).toBeDefined()
    expect(muted).toBeDefined()

    expect(Math.abs(luminance(heading as CapturedSpan) - luminance(muted as CapturedSpan))).toBeGreaterThan(
      0.2,
    )
  })

  test("and the text is identical to every other theme, so nothing is lost either way", async () => {
    const high = await paint({ kind: "council", kodzastup: "582786" }, themeByName("high-contrast"))
    const light = await paint({ kind: "council", kodzastup: "582786" }, themeByName("light"))
    expect(high.text).toBe(light.text)
  })
})

describe("colour is applied at all (T136)", () => {
  test("a themed frame paints more than one colour", async () => {
    const { spans } = await paint({ kind: "council", kodzastup: "582786" }, themeByName("dark"))
    // The counterpart to the monochrome test: if this ever collapsed to one colour the
    // theme would have stopped reaching the screen and the tests above would still pass.
    expect(new Set(spans.map(key)).size).toBeGreaterThan(1)
  })
})
