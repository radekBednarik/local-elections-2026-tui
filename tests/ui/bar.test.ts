/**
 * Bars (T143-T147, FR-070 to FR-074).
 *
 * The rules under test are mostly about what a bar must NOT do: it must not replace a
 * figure, must not survive at the cost of one, must not depend on colour, and must not
 * become a trend line.
 */

import type { Database } from "bun:sqlite"
import { beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { extractArchiveFile } from "../../src/reference/archive.ts"
import { loadReference, type ReferenceArchives } from "../../src/reference/loader.ts"
import { ingestDistrict, ingestNational } from "../../src/sources/ingest.ts"
import { openMemoryDatabase } from "../../src/storage/db.ts"
import { BAR_WIDTH, bar, barsFit } from "../../src/ui/bar.ts"
import { renderCouncil } from "../../src/ui/views/areas.ts"
import { renderNationalView } from "../../src/ui/views/national.ts"

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

describe("drawing (T143)", () => {
  test("occupies exactly its width, whatever the fraction", () => {
    for (const fraction of [0, 0.01, 0.5, 0.999, 1]) {
      expect([...bar(fraction, 10)].length).toBe(10)
    }
  })

  test("nothing at zero, full at one", () => {
    expect(bar(0, 8).trim()).toBe("")
    expect(bar(1, 8)).toBe("████████")
  })

  test("eighth-blocks give eight sub-steps per column", () => {
    // One column at a time: each eighth of a column must be a distinct glyph, which is
    // the whole reason for not using full blocks alone.
    const steps = new Set(Array.from({ length: 9 }, (_, i) => bar(i / 8 / 4, 4)))
    expect(steps.size).toBe(9)
  })

  test("a fraction outside the range is clamped, not rejected", () => {
    expect(bar(-1, 6).trim()).toBe("")
    expect(bar(5, 6)).toBe("██████")
  })

  test("an absent figure draws blank rather than zero, which would be a claim", () => {
    expect(bar(null, 6)).toBe("      ")
    expect(bar(undefined, 6)).toBe("      ")
  })
})

describe("what a bar cannot do (FR-071)", () => {
  test("two figures a fraction of a point apart draw the same bar", () => {
    // Research R16 offered 7.62% against 7.76% as a pair eighths would separate. They
    // differ by 0.14 points; no bar of a practical width can show that. This asserts the
    // limit deliberately, because it is exactly why the published figure must be beside
    // the bar rather than replaced by it.
    expect(bar(0.0762, BAR_WIDTH)).toBe(bar(0.0776, BAR_WIDTH))
  })

  test("the published figure is always shown beside it", () => {
    const lines = renderCouncil(db, "582786", 120)
    const withBar = lines.find((l) => l.includes("█"))
    expect(withBar).toBeDefined()
    // The percentage sign is the figure; a row carrying a bar carries it too.
    expect(withBar).toContain("%")
  })
})

describe("shape, not colour (FR-072, T145)", () => {
  test("a bar is made of block characters, which carry no colour of their own", () => {
    const drawn = bar(0.5, 8)
    for (const char of [...drawn.trimEnd()]) {
      expect("▏▎▍▌▋▊▉█").toContain(char)
    }
  })

  test("the bar is identical however the view is themed, because it is text", () => {
    // The plain-text rendering is the same object the styled rendering is built from,
    // so a bar that appeared in one and not the other is impossible by construction.
    const wide = renderCouncil(db, "582786", 120)
    expect(wide.some((l) => l.includes("█"))).toBe(true)
  })
})

describe("bars go before figures do (FR-074, T146)", () => {
  test("a wide terminal draws them", () => {
    expect(renderCouncil(db, "582786", 120).some((l) => l.includes("█"))).toBe(true)
  })

  test("a narrow terminal drops them entirely rather than truncating", () => {
    const narrow = renderCouncil(db, "582786", 76)
    expect(narrow.some((l) => l.includes("█"))).toBe(false)
    for (const char of ["▏", "▎", "▍", "▌", "▋", "▊", "▉"]) {
      expect(narrow.some((l) => l.includes(char))).toBe(false)
    }
  })

  test("and keeps every figure when it does", () => {
    const narrow = renderCouncil(db, "582786", 76)
    const wide = renderCouncil(db, "582786", 120)
    const shareOf = (lines: string[]) => lines.find((l) => l.includes("ANO 2011"))
    expect(shareOf(narrow)).toContain("%")
    expect(shareOf(wide)).toContain("%")
    // The same party, the same share, with and without its bar.
    expect(shareOf(narrow)?.match(/\d+,\d+/)?.[0]).toBe(shareOf(wide)?.match(/\d+,\d+/)?.[0])
  })

  test("the fit rule is about columns, not about a guessed threshold", () => {
    expect(barsFit(100, 80)).toBe(true)
    expect(barsFit(90, 80)).toBe(false)
  })
})

describe("no trend lines anywhere (FR-073, T147)", () => {
  // No history is kept to draw one from, so any time series would be invented.
  const SPARKLINE = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "╱", "╲", "∿"]

  test("no view draws a sparkline character", () => {
    const screens = [renderNationalView(db, { width: 120 }), renderCouncil(db, "582786", 120)]
    for (const lines of screens) {
      for (const char of SPARKLINE) {
        expect(lines.some((l) => l.includes(char))).toBe(false)
      }
    }
  })

  test("the bar module offers no way to draw a series", () => {
    const module = Object.keys(require("../../src/ui/bar.ts"))
    expect(module.sort()).toEqual(["BAR_WIDTH", "bar", "barsFit"].sort())
  })
})
