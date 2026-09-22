import { describe, expect, test } from "bun:test"
import {
  type Column,
  dataRow,
  formatInteger,
  formatPercent,
  formatProgress,
  headerRow,
  pad,
  plural,
  seatsLabel,
  withChange,
} from "../../src/ui/format.ts"

const NBSP = " "

describe("formatInteger (Czech grouping)", () => {
  test.each([
    [0, "0"],
    [999, "999"],
    [1000, `1${NBSP}000`],
    [8255204, `8${NBSP}255${NBSP}204`],
    [-1234, `-1${NBSP}234`],
  ])("formats %i", (value, expected) => {
    expect(formatInteger(value)).toBe(expected)
  })

  test("groups with a non-breaking space, so a number cannot wrap mid-value", () => {
    expect(formatInteger(1000)).not.toContain(" ")
    expect(formatInteger(1000)).toContain(NBSP)
  })

  test("a missing value is shown as a dash, never as zero", () => {
    // Zero is a real result; absent data is not. Conflating them would misreport.
    expect(formatInteger(null)).toBe("–")
    expect(formatInteger(undefined)).toBe("–")
    expect(formatInteger(0)).toBe("0")
  })
})

describe("formatPercent (Czech decimal comma)", () => {
  test("uses a comma and keeps the published precision", () => {
    expect(formatPercent(46.07)).toBe(`46,07${NBSP}%`)
    expect(formatPercent(100)).toBe(`100,00${NBSP}%`)
  })

  test("a missing value is a dash", () => {
    expect(formatPercent(null)).toBe("–")
  })
})

describe("formatProgress", () => {
  test("shows counted out of total", () => {
    expect(formatProgress(6, 13)).toBe(`6${NBSP}/${NBSP}13`)
  })
})

describe("pad", () => {
  test("pads left and right", () => {
    expect(pad("ab", 5)).toBe("ab   ")
    expect(pad("ab", 5, "right")).toBe("   ab")
  })

  test("truncates with an ellipsis rather than overflowing the column", () => {
    expect(pad("Sdružení nezávislých kandidátů", 10)).toHaveLength(10)
    expect(pad("Sdružení nezávislých kandidátů", 10).endsWith("…")).toBe(true)
  })

  test("counts characters, not code units, so diacritics do not skew widths", () => {
    expect(pad("Říčany", 10)).toHaveLength(10)
    expect(pad("Žďár", 4)).toBe("Žďár")
  })
})

describe("withChange (FR-040)", () => {
  test("prefixes a symbol, so the change is visible without colour", () => {
    const up = withChange("100", "increased")
    const down = withChange("100", "decreased")
    expect(up).not.toBe(down)
    expect(up).not.toBe("100")
  })

  test("an unchanged value gains no visual noise beyond alignment", () => {
    expect(withChange("100", "unchanged").trim()).toBe("100")
  })
})

describe("table rows", () => {
  const columns: Column[] = [
    { header: "Strana", width: 12 },
    { header: "Hlasy", width: 8, align: "right" },
  ]

  test("header and underline line up", () => {
    const [header, underline] = headerRow(columns)
    expect(header).toHaveLength(underline.length)
    expect(underline).toMatch(/^─+ ─+$/)
  })

  test("a data row aligns to the header", () => {
    const [header] = headerRow(columns)
    const row = dataRow(columns, ["ANO 2011", "16752"])
    expect(row.length).toBeLessThanOrEqual(header.length)
    expect(row).toContain("ANO 2011")
    expect(row).toContain("16752")
  })

  test("a missing cell renders as blank rather than throwing", () => {
    expect(() => dataRow(columns, ["jen jeden"])).not.toThrow()
  })
})

describe("Czech plural agreement", () => {
  test("uses all three forms, not an English singular/plural pair", () => {
    // 1 takes the singular, 2-4 a distinct plural, 5+ the genitive plural. "1 mandátů"
    // or "4 mandátů" is wrong in a way every Czech reader notices at once.
    expect(seatsLabel(1)).toBe("1 mandát")
    expect(seatsLabel(2)).toBe("2 mandáty")
    expect(seatsLabel(4)).toBe("4 mandáty")
    expect(seatsLabel(5)).toBe("5 mandátů")
    expect(seatsLabel(9)).toBe("9 mandátů")
  })

  test("zero takes the genitive plural", () => {
    expect(seatsLabel(0)).toBe("0 mandátů")
  })

  test("larger numbers keep the genitive plural and stay grouped", () => {
    expect(seatsLabel(1234)).toBe("1\u00a0234 mandátů")
  })

  test("the rule is reusable for other nouns", () => {
    expect(plural(1, "hlas", "hlasy", "hlasů")).toBe("hlas")
    expect(plural(3, "hlas", "hlasy", "hlasů")).toBe("hlasy")
    expect(plural(11, "hlas", "hlasy", "hlasů")).toBe("hlasů")
  })
})
