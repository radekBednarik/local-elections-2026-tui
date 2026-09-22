import { describe, expect, test } from "bun:test"
import { fold, foldedIncludes, foldedStartsWith } from "../../src/domain/folding.ts"

describe("fold (FR-038)", () => {
  test("all spellings of a place name fold to the same value", () => {
    const expected = "ricany"
    expect(fold("Říčany")).toBe(expected)
    expect(fold("ŘÍČANY")).toBe(expected)
    expect(fold("ricany")).toBe(expected)
    expect(fold("Ricany")).toBe(expected)
  })

  test("covers the whole Czech diacritic set", () => {
    expect(fold("ěščřžýáíéúůďťňó")).toBe("escrzyaieuudtno")
    expect(fold("ĚŠČŘŽÝÁÍÉÚŮĎŤŇÓ")).toBe("escrzyaieuudtno")
  })

  test("keeps real place and party names intact apart from accents", () => {
    expect(fold("Žďár nad Sázavou")).toBe("zdar nad sazavou")
    expect(fold("Brno-Bohunice")).toBe("brno-bohunice")
    expect(fold("SPOLEČNĚ TOP 09 a nezávislí")).toBe("spolecne top 09 a nezavisli")
    expect(fold("Praha hl.m.")).toBe("praha hl.m.")
  })

  test("collapses whitespace and trims", () => {
    expect(fold("  Ústí   nad    Labem  ")).toBe("usti nad labem")
  })

  test("is idempotent, so folding stored text twice is harmless", () => {
    const once = fold("Říčany u Prahy")
    expect(fold(once)).toBe(once)
  })

  test("handles an empty string", () => {
    expect(fold("")).toBe("")
  })
})

describe("foldedIncludes", () => {
  test("matches a substring regardless of accents or case", () => {
    expect(foldedIncludes("Žďár nad Sázavou", "sazavou")).toBe(true)
    expect(foldedIncludes("Žďár nad Sázavou", "SÁZAV")).toBe(true)
    expect(foldedIncludes("Žďár nad Sázavou", "Brno")).toBe(false)
  })

  test("an empty query matches everything, so a cleared search box lists all", () => {
    expect(foldedIncludes("cokoliv", "")).toBe(true)
  })
})

describe("foldedStartsWith", () => {
  test("matches a prefix regardless of accents or case", () => {
    expect(foldedStartsWith("Říčany", "ric")).toBe(true)
    expect(foldedStartsWith("Říčany", "cany")).toBe(false)
  })
})
