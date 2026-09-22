/**
 * The schemas are validated against the REAL published documents, not against
 * hand-written samples that could only ever confirm what we already assumed.
 */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { parseAndValidate } from "../../src/parsing/pipeline.ts"
import { councilSchema, districtSchema, nationalSchema } from "../../src/parsing/schemas/results.ts"

const FIXTURES = join(import.meta.dir, "../../fixtures/2026")
const EDGE = join(import.meta.dir, "../../fixtures/edge-cases")

const read = (dir: string, name: string) => readFileSync(join(dir, name), "utf8")

describe("national document", () => {
  const result = parseAndValidate(read(FIXTURES, "vysledky.xml"), nationalSchema, "vysledky.xml")

  test("validates against the real published document", () => {
    expect(result.ok).toBe(true)
  })

  test("carries the publisher timestamp", () => {
    if (!result.ok) throw new Error(result.message)
    expect(result.value.VYSLEDKY.DATUM_CAS_GENEROVANI).toBe("2026-10-09T21:15:00")
  })

  test("keeps municipal and borough assemblies apart (FR-035)", () => {
    if (!result.ok) throw new Error(result.message)
    const types = result.value.VYSLEDKY.TYP_ZASTUP.map((t) => t.OZNAC_TYPU)
    expect(types).toContain("OBEC")
    expect(types).toContain("MCMO")
  })

  test("coerces numbers, leaving no strings in numeric fields", () => {
    if (!result.ok) throw new Error(result.message)
    const first = result.value.VYSLEDKY.TYP_ZASTUP[0]
    if (first === undefined) throw new Error("expected at least one council type")
    expect(typeof first.UCAST.OKRSKY_CELKEM).toBe("number")
    expect(typeof first.UCAST.UCAST_PROC).toBe("number")
    expect(first.UCAST.OKRSKY_CELKEM).toBeGreaterThan(0)
  })

  test("preserves Czech diacritics in party names (FR-026)", () => {
    if (!result.ok) throw new Error(result.message)
    const names = result.value.VYSLEDKY.TYP_ZASTUP.flatMap((t) => t.VOLEBNI_STRANA.map((p) => p.NAZEV_STRANY))
    expect(names.some((n) => /[ěščřžýáíéúůďťňó]/i.test(n))).toBe(true)
  })
})

describe("district document", () => {
  const result = parseAndValidate(read(FIXTURES, "vysledky_obce_okres_CZ0100.xml"), districtSchema, "CZ0100")

  test("validates against the real published document", () => {
    expect(result.ok).toBe(true)
  })

  test("contains a city council and its boroughs", () => {
    if (!result.ok) throw new Error(result.message)
    const councils = result.value.VYSLEDKY_OBCE_OKRES.OBEC
    expect(councils.length).toBeGreaterThan(1)
    expect(councils.some((c) => c.OZNAC_TYPU === "OBEC")).toBe(true)
    expect(councils.some((c) => c.OZNAC_TYPU === "MCMO")).toBe(true)
  })

  test("exposes elected representatives per party (FR-034)", () => {
    if (!result.ok) throw new Error(result.message)
    const elected = result.value.VYSLEDKY_OBCE_OKRES.OBEC.flatMap((c) =>
      c.VYSLEDEK.flatMap((v) => v.VOLEBNI_STRANA.flatMap((p) => p.ZASTUPITEL)),
    )
    expect(elected.length).toBeGreaterThan(0)
    const first = elected[0]
    if (first === undefined) throw new Error("expected an elected representative")
    expect(typeof first.HLASY).toBe("number")
    expect(first.PRIJMENI.length).toBeGreaterThan(0)
  })
})

describe("council document", () => {
  test("validates, and reuses the same OBEC shape as the district document", () => {
    const result = parseAndValidate(read(FIXTURES, "vysledky_obec_551082.xml"), councilSchema, "551082")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const council = result.value.VYSLEDKY_OBEC.OBEC[0]
    if (council === undefined) throw new Error("expected one council")
    expect(council.KODZASTUP).toBe("551082")
    expect(council.NAZEVZAST).toBe("Brno-Bohunice")
    expect(council.VOLENO_ZASTUP).toBe(21)
  })
})

describe("rejection (FR-025)", () => {
  test.each([
    ["malformed markup", "malformed.xml", "not-well-formed"],
    ["a truncated document", "truncated.xml", "not-well-formed"],
    ["a well-formed document of the wrong shape", "wrong-shape.xml", "schema-mismatch"],
    ["a non-numeric value in a numeric field", "bad-number.xml", "schema-mismatch"],
  ])("rejects %s", (_label, file, expectedReason) => {
    const result = parseAndValidate(read(EDGE, file), councilSchema, file)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe(expectedReason as typeof result.reason)
    // The message must name the document, so a log entry identifies the source.
    expect(result.message).toContain(file)
  })

  test("rejects an empty body", () => {
    const result = parseAndValidate("", councilSchema, "prazdny.xml")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("empty")
  })

  test("a rejected document yields no value at all, never a partial one", () => {
    const result = parseAndValidate(read(EDGE, "bad-number.xml"), councilSchema, "bad-number.xml")
    expect(result.ok).toBe(false)
    expect("value" in result).toBe(false)
  })
})

describe("edge-case states", () => {
  test("a provisional count is not marked as counted", () => {
    const result = parseAndValidate(read(EDGE, "provisional.xml"), councilSchema, "provisional")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const council = result.value.VYSLEDKY_OBEC.OBEC[0]
    expect(council?.JE_SPOCTENO).toBe(false)
  })

  test("a completed count is marked as counted", () => {
    const result = parseAndValidate(read(EDGE, "final.xml"), councilSchema, "final")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.VYSLEDKY_OBEC.OBEC[0]?.JE_SPOCTENO).toBe(true)
  })

  test("a council where no election took place validates with no result body", () => {
    const result = parseAndValidate(read(EDGE, "annulled.xml"), councilSchema, "annulled")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const council = result.value.VYSLEDKY_OBEC.OBEC[0]
    // No parties at all. The view must show a status, never zero votes.
    expect(council?.VYSLEDEK[0]?.VOLEBNI_STRANA ?? []).toHaveLength(0)
  })

  test("a tie is preserved exactly as published, with no ordering invented", () => {
    const result = parseAndValidate(read(EDGE, "unfilled-seats.xml"), councilSchema, "tie")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const parties = result.value.VYSLEDKY_OBEC.OBEC[0]?.VYSLEDEK[0]?.VOLEBNI_STRANA ?? []
    expect(parties).toHaveLength(2)
    expect(parties[0]?.HLASY).toBe(parties[1]?.HLASY)
    // Nine seats to fill, eight allocated: the source reports it, we do not fix it.
    const allocated = parties.reduce((sum, p) => sum + p.ZASTUPITELE_POCET, 0)
    expect(result.value.VYSLEDKY_OBEC.OBEC[0]?.VOLENO_ZASTUP).toBe(9)
    expect(allocated).toBe(8)
  })
})
