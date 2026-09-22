import { describe, expect, test } from "bun:test"
import {
  councilUrl,
  districtUrl,
  isBatchPath,
  nationalUrl,
  type SourceLocation,
  urlForKey,
} from "../../src/sources/urls.ts"

const LIVE: SourceLocation = {
  baseUrl: "https://volby.gov.cz",
  election: "kv2026",
  date: "20261009",
}

describe("URL construction", () => {
  test("national matches the published path", () => {
    expect(nationalUrl(LIVE)).toBe("https://volby.gov.cz/appdata/kv2026/20261009/odata/vysledky.xml")
  })

  test("district matches the published path", () => {
    expect(districtUrl(LIVE, "CZ0100")).toBe(
      "https://volby.gov.cz/appdata/kv2026/20261009/odata/okresy/vysledky_obce_okres_CZ0100.xml",
    )
  })

  test("council matches the published path", () => {
    expect(councilUrl(LIVE, "551082")).toBe(
      "https://volby.gov.cz/appdata/kv2026/20261009/odata/zastup/vysledky_obec_551082.xml",
    )
  })

  test("accepts the alphanumeric district codes that really exist", () => {
    // CZ020A (Praha-zapad) is real: the last character is not always a digit.
    expect(() => districtUrl(LIVE, "CZ020A")).not.toThrow()
  })

  test("works against a replay harness and a local directory (FR-014a)", () => {
    const replay: SourceLocation = { ...LIVE, baseUrl: "http://localhost:8787" }
    expect(nationalUrl(replay)).toBe("http://localhost:8787/appdata/kv2026/20261009/odata/vysledky.xml")

    const local: SourceLocation = { ...LIVE, baseUrl: "file://./fixtures" }
    expect(nationalUrl(local)).toContain("file://./fixtures/appdata")
  })

  test("a different date changes the path without a rebuild (FR-014)", () => {
    expect(nationalUrl({ ...LIVE, date: "20221023" })).toContain("/20221023/")
  })
})

describe("rejecting bad identifiers", () => {
  test.each([
    ["lower case", "cz0100"],
    ["too short", "CZ010"],
    ["not a NUTS code", "PRAHA"],
  ])("district rejects %s", (_label, nuts) => {
    expect(() => districtUrl(LIVE, nuts)).toThrow(TypeError)
  })

  test.each([
    ["too short", "123"],
    ["not numeric", "abc123"],
    ["empty", ""],
  ])("council rejects %s", (_label, code) => {
    expect(() => councilUrl(LIVE, code)).toThrow(TypeError)
  })
})

describe("batch sources are unreachable (FR-012, FR-013)", () => {
  test("no source key can produce a batch URL", () => {
    const urls = [
      urlForKey(LIVE, "national"),
      urlForKey(LIVE, "district:CZ0100"),
      urlForKey(LIVE, "council:551082"),
    ]
    for (const url of urls) expect(isBatchPath(url)).toBe(false)
  })

  test("recognises every batch path the publisher offers", () => {
    const root = "https://volby.gov.cz/appdata/kv2026/20261009/odata"
    // Numbered batches, and the aliases that return the latest batch.
    expect(isBatchPath(`${root}/okrsky/vysledky_okrsky_00001.xml`)).toBe(true)
    expect(isBatchPath(`${root}/obce_d/vysledky_obce_00001.xml`)).toBe(true)
    expect(isBatchPath(`${root}/vysledky_okrsky.xml`)).toBe(true)
    expect(isBatchPath(`${root}/vysledky_obce.xml`)).toBe(true)
  })

  test("does not mistake a real district file for a batch", () => {
    // vysledky_obce_okres_*.xml is NOT the batch vysledky_obce_*.xml, despite the
    // similar name. Confusing them would exclude a source that is in scope.
    expect(isBatchPath(urlForKey(LIVE, "district:CZ0642"))).toBe(false)
  })

  test("an unknown source key is rejected", () => {
    expect(() => urlForKey(LIVE, "okrsek:1" as never)).toThrow(TypeError)
  })
})
