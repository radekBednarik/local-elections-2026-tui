import { describe, expect, test } from "bun:test"
import { type Column, dataRow } from "../../src/ui/format.ts"
import { blank, cell, hasBars, line, row, toChunks, toText, toTextLines } from "../../src/ui/row.ts"

const COLUMNS: Column[] = [
  { header: "Strana", width: 20 },
  { header: "Hlasy", width: 10, align: "right" },
  { header: "Podíl", width: 8, align: "right" },
]

describe("plain-text rendering is identical to the old output", () => {
  // This is the property the whole migration rests on: roughly 120 existing assertions
  // compare against what dataRow produced. If the two ever diverge, the suite stops
  // testing what it claims to.
  test.each([
    [["ANO 2011", "16752", "18,80 %"]],
    [["SPOLEČNĚ TOP 09 a nezávislí", "6916", "7,76 %"]],
    [["Žďár nad Sázavou", "–", ""]],
    [[""]],
  ])("row %j matches dataRow exactly", (cells) => {
    expect(toText(row(...cells), COLUMNS)).toBe(dataRow(COLUMNS, cells))
  })

  test("a role does not change the text form", () => {
    const plain = row("ANO 2011", "16752", "18,80 %")
    const styled = row(cell("ANO 2011", "heading"), cell("16752", "increase"), "18,80 %")
    expect(toText(styled, COLUMNS)).toBe(toText(plain, COLUMNS))
  })

  test("a bar does not change the text form", () => {
    const withBar = { cells: [{ text: "ANO 2011" }, { text: "16752", bar: 0.188 }, { text: "18,80 %" }] }
    expect(toText(withBar, COLUMNS)).toBe(dataRow(COLUMNS, ["ANO 2011", "16752", "18,80 %"]))
  })

  test("a missing cell renders blank, as before", () => {
    expect(toText(row("jen jeden"), COLUMNS)).toBe(dataRow(COLUMNS, ["jen jeden"]))
  })
})

describe("non-tabular rows", () => {
  test("a line renders its text unchanged", () => {
    expect(toText(line("Stav: průběžné výsledky"))).toBe("Stav: průběžné výsledky")
  })

  test("a blank row renders as an empty string", () => {
    expect(toText(blank())).toBe("")
  })

  test("Czech diacritics survive", () => {
    expect(toText(line("Říčany u Prahy, Žďár nad Sázavou"))).toContain("Žďár")
  })
})

describe("toTextLines", () => {
  test("renders a whole view", () => {
    const lines = toTextLines([line("Nadpis"), blank(), row("A", "1", "2 %")], undefined)
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe("Nadpis")
    expect(lines[1]).toBe("")
  })
})

describe("styled chunks", () => {
  test("carry the role of each cell", () => {
    const chunks = toChunks(row(cell("Strana", "heading"), cell("100", "increase")), COLUMNS)
    const roles = chunks.map((c) => c.role).filter((r) => r !== undefined)
    expect(roles).toContain("heading")
    expect(roles).toContain("increase")
  })

  test("a row-level role applies to cells that have none of their own", () => {
    const chunks = toChunks(
      { cells: [{ text: "a" }, { text: "b", role: "warning" }], role: "selection" },
      COLUMNS,
    )
    // Located by content rather than by prefix: a right-aligned column pads before its
    // text, so the chunk for "b" does not start with it.
    expect(chunks.find((c) => c.text.includes("a"))?.role).toBe("selection")
    expect(chunks.find((c) => c.text.includes("b"))?.role).toBe("warning")
  })

  test("occupy exactly the same columns as the text form", () => {
    // A styled row that drifted from the plain row would make every layout assertion
    // meaningless, since the tests measure one and the user sees the other.
    const r = row("ANO 2011", "16752", "18,80 %")
    const joined = toChunks(r, COLUMNS)
      .map((c) => c.text)
      .join("")
    expect(joined.trimEnd()).toBe(toText(r, COLUMNS))
  })

  test("a long cell is truncated the same way in both forms", () => {
    const long = row("Sdružení nezávislých kandidátů pro lepší obec", "1", "2 %")
    const joined = toChunks(long, COLUMNS)
      .map((c) => c.text)
      .join("")
    expect(joined.trimEnd()).toBe(toText(long, COLUMNS))
    expect(joined).toContain("…")
  })
})

describe("hasBars", () => {
  test("detects a bar anywhere in the view", () => {
    expect(hasBars([row("a"), { cells: [{ text: "b", bar: 0.5 }] }])).toBe(true)
  })

  test("is false when no cell carries one", () => {
    expect(hasBars([row("a"), line("b")])).toBe(false)
  })
})
