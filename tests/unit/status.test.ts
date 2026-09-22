import { describe, expect, test } from "bun:test"
import {
  ageSeconds,
  changeMarker,
  compareValue,
  determineStatus,
  formatAge,
  statusLabel,
} from "../../src/domain/status.ts"

describe("determineStatus (FR-022)", () => {
  test("a count in progress is not final", () => {
    const s = determineStatus({ districtsTotal: 13, districtsCounted: 6, sourceSaysCounted: false })
    expect(s.isFinal).toBe(false)
    expect(statusLabel(s)).toBe("průběžné výsledky")
  })

  test("a completed count is final", () => {
    const s = determineStatus({ districtsTotal: 13, districtsCounted: 13, sourceSaysCounted: true })
    expect(s.isFinal).toBe(true)
    expect(statusLabel(s)).toBe("konečné výsledky")
  })

  test("all districts counted is NOT enough on its own", () => {
    // A document can report every district counted a moment before its own flag flips.
    // Labelling that final one refresh early is precisely what FR-022 guards against.
    const s = determineStatus({ districtsTotal: 13, districtsCounted: 13, sourceSaysCounted: false })
    expect(s.isFinal).toBe(false)
  })

  test("the source flag is NOT enough on its own either", () => {
    const s = determineStatus({ districtsTotal: 13, districtsCounted: 6, sourceSaysCounted: true })
    expect(s.isFinal).toBe(false)
  })

  test("an area with no polling districts is never final", () => {
    const s = determineStatus({ districtsTotal: 0, districtsCounted: 0, sourceSaysCounted: true })
    expect(s.isFinal).toBe(false)
  })

  test("the published percentage is passed through, never recomputed (FR-029)", () => {
    // 6 of 13 is 46.15%, but the source said 46.21. We report the source.
    const s = determineStatus({
      districtsTotal: 13,
      districtsCounted: 6,
      publishedPct: 46.21,
      sourceSaysCounted: false,
    })
    expect(s.publishedPct).toBe(46.21)
  })
})

describe("compareValue (FR-036)", () => {
  test("no previous snapshot is new, not an increase from zero", () => {
    expect(compareValue(100, null)).toBe("new")
    expect(compareValue(100, undefined)).toBe("new")
  })

  test("detects increases, decreases and no change", () => {
    expect(compareValue(120, 100)).toBe("increased")
    expect(compareValue(80, 100)).toBe("decreased")
    expect(compareValue(100, 100)).toBe("unchanged")
  })

  test("a decrease is reported, because corrections do happen (FR-028)", () => {
    expect(compareValue(4700, 4703)).toBe("decreased")
  })

  test("a missing current value is not a change", () => {
    expect(compareValue(null, 100)).toBe("unchanged")
  })
})

describe("changeMarker (FR-040)", () => {
  test("every change kind has a distinct non-colour marker", () => {
    const markers = (["new", "increased", "decreased", "unchanged"] as const).map(changeMarker)
    expect(new Set(markers).size).toBe(markers.length)
  })

  test("increase and decrease are distinguishable without colour", () => {
    expect(changeMarker("increased")).not.toBe(changeMarker("decreased"))
    expect(changeMarker("increased").trim()).not.toBe("")
    expect(changeMarker("decreased").trim()).not.toBe("")
  })
})

describe("ageSeconds (clock skew)", () => {
  test("measures from the publisher timestamp", () => {
    const now = new Date("2026-10-09T21:20:00Z")
    expect(ageSeconds("2026-10-09T21:15:00Z", now)).toBe(300)
  })

  test("a publisher timestamp ahead of the local clock reports zero, not a negative", () => {
    const now = new Date("2026-10-09T21:00:00Z")
    expect(ageSeconds("2026-10-09T21:15:00Z", now)).toBe(0)
  })

  test("an unparseable timestamp yields null rather than throwing", () => {
    expect(ageSeconds("nesmysl")).toBeNull()
  })
})

describe("formatAge", () => {
  test.each([
    [5, "před 5 s"],
    [59, "před 59 s"],
    [60, "před 1 min"],
    [3599, "před 59 min"],
    [3600, "před 1 h 0 min"],
    [7860, "před 2 h 11 min"],
  ])("formats %i seconds", (seconds, expected) => {
    expect(formatAge(seconds)).toBe(expected)
  })

  test("unknown age is stated rather than guessed", () => {
    expect(formatAge(null)).toBe("neznámé stáří")
  })
})
