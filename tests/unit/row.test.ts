import { describe, expect, test } from "bun:test"
import { type RGBA, rgbToHex, type StyledText } from "@opentui/core"
import { type Column, dataRow, headerRow } from "../../src/ui/format.ts"
import {
  blank,
  cell,
  line,
  row,
  type SemanticRow,
  tableHeader,
  toChunks,
  toText,
  toTextLines,
} from "../../src/ui/row.ts"
import { markSorted, type SortState } from "../../src/ui/sort.ts"
import { styledRow } from "../../src/ui/theme/apply.ts"
import { MONOCHROME, themeByName } from "../../src/ui/theme/themes.ts"

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

describe("a bar is not a cell property", () => {
  // It was, briefly. A bar has to occupy its own column so that rows align and so that a
  // narrow table can drop it whole, which makes it ordinary text produced by the view -
  // see src/ui/bar.ts. Keeping the field would have left two ways to express one thing.
  // The optional `bar` flag a view may set (002 T009) carries no value: it only marks the
  // column so its unfilled part can show the track, and `cell()` never sets it.
  test("a cell carries text and a role, and nothing else", () => {
    expect(Object.keys(cell("ANO 2011", "heading")).sort()).toEqual(["role", "text"])
    expect(Object.keys(cell("ANO 2011"))).toEqual(["text"])
  })
})

describe("styled rows carry backgrounds (T004, research R1)", () => {
  const TOKYO = themeByName("tokyonight")
  const hex = (colour: RGBA | undefined) => (colour === undefined ? "none" : rgbToHex(colour))
  const cellsWide = (text: StyledText) => text.chunks.reduce((sum, c) => sum + [...c.text].length, 0)

  test("every chunk, the gutter included, takes the row's background", () => {
    const styled = styledRow(row("ANO 2011", "16752", "18,80 %"), TOKYO, 40, "  ", COLUMNS, "zebra")
    for (const chunk of styled.chunks) expect(`${chunk.text}|${hex(chunk.bg)}`).toBe(`${chunk.text}|#1e2030`)
  })

  test("the row is padded to its full width, because a text background covers glyphs only", () => {
    const styled = styledRow(row("ANO 2011", "16752", "18,80 %"), TOKYO, 60, "  ", COLUMNS, "bg")
    expect(cellsWide(styled)).toBe(62)
    expect(styled.chunks.at(-1)?.text.trim()).toBe("")
  })

  test("the plain-text form is not padded, since it is also the redraw key", () => {
    expect(toText(row("ANO 2011", "16752", "18,80 %"), COLUMNS)).toBe(
      dataRow(COLUMNS, ["ANO 2011", "16752", "18,80 %"]),
    )
  })

  test.each(["primary", "accent", "success", "warning"] as const)(
    "a %s surface reads onAccent on that slot",
    (surface) => {
      const styled = styledRow({ cells: [{ text: " Mandáty ", surface }] }, TOKYO, 20, "", undefined, "bg")
      const chunk = styled.chunks.find((c) => c.text.includes("Mandáty"))
      expect(hex(chunk?.bg)).toBe(TOKYO.slots[surface] ?? "")
      expect(hex(chunk?.fg)).toBe(TOKYO.slots.onAccent ?? "")
    },
  )

  test("an element surface keeps its role's own foreground", () => {
    const styled = styledRow(
      { cells: [{ text: "ÚČAST", role: "muted", surface: "element" }] },
      TOKYO,
      20,
      "",
      undefined,
      "bg",
    )
    const chunk = styled.chunks.find((c) => c.text.includes("ÚČAST"))
    expect(hex(chunk?.bg)).toBe(TOKYO.slots.element ?? "")
    expect(hex(chunk?.fg)).toBe(TOKYO.slots.muted ?? "")
  })

  test("a surface keeps its padding at the end of a row", () => {
    const styled = styledRow(
      { cells: [{ text: "x" }, { text: " 21 ", surface: "primary" }] },
      TOKYO,
      10,
      "",
      undefined,
      "bg",
    )
    expect(styled.chunks.some((c) => c.text === " 21 ")).toBe(true)
  })

  test("monochrome emits no colour at all", () => {
    const styled = styledRow(
      {
        cells: [
          { text: "a", role: "heading" },
          { text: " b ", surface: "primary" },
        ],
      },
      MONOCHROME,
      20,
      "▶ ",
      undefined,
      "sel",
    )
    for (const chunk of styled.chunks)
      expect(`${chunk.text}|${hex(chunk.fg)}|${hex(chunk.bg)}`).toBe(`${chunk.text}|none|none`)
  })
})

describe("table headers (T013, research R3)", () => {
  test("are a header row and a rule row, marked as such", () => {
    const [header, rule] = tableHeader(COLUMNS)
    expect(header?.kind).toBe("header")
    expect(rule?.kind).toBe("rule")
  })

  test("read exactly as headerRow did, so no plain-text assertion moves", () => {
    const [header, rule] = tableHeader(COLUMNS)
    const [text, underline] = headerRow(COLUMNS)
    expect(toText(header as SemanticRow)).toBe(text.trimEnd())
    expect(toText(rule as SemanticRow)).toBe(underline.trimEnd())
  })

  test("the header's cells are headings, the sorted one accented and still marked", () => {
    const sort: SortState = { column: 1, direction: "desc" }
    const [header] = tableHeader(COLUMNS, sort)
    expect(header?.cells.map((c) => c.role)).toEqual(["heading", "accent", "heading"])
    expect(toText(header as SemanticRow)).toBe(headerRow(markSorted(COLUMNS, sort))[0].trimEnd())
    expect(header?.cells[1]?.text).toContain("▾")
  })

  test("the rule row carries no role: the frame draws it in the border slot", () => {
    const [, rule] = tableHeader(COLUMNS)
    expect(rule?.cells.every((c) => c.role === undefined)).toBe(true)
  })
})
