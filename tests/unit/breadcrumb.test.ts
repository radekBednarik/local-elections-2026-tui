/**
 * The breadcrumb (T120, FR-055).
 *
 * The one rule that matters: it truncates from the LEFT. "Where am I" is the question
 * it exists to answer, so the current location is the last thing that may be dropped.
 */

import { describe, expect, test } from "bun:test"
import { breadcrumbSegments, breadcrumbText, SEPARATOR } from "../../src/ui/chrome/breadcrumb.ts"

describe("assembly", () => {
  test("joins segments with a chevron", () => {
    expect(breadcrumbText(["ČR", "Okres Brno-město", "Brno-Bohunice"], 100)).toBe(
      `ČR ${SEPARATOR} Okres Brno-město ${SEPARATOR} Brno-Bohunice`,
    )
  })

  test("a single segment stands alone", () => {
    expect(breadcrumbText(["ČR"], 100)).toBe("ČR")
  })

  test("no segments gives an empty crumb rather than a stray separator", () => {
    expect(breadcrumbText([], 100)).toBe("")
  })
})

describe("truncation (FR-055)", () => {
  const deep = ["ČR", "Okresy", "Okres Brno-město", "Brno-Bohunice", "ANO 2011"]

  test("keeps the current location when it cannot show everything", () => {
    const text = breadcrumbText(deep, 30)
    expect([...text].length).toBeLessThanOrEqual(30)
    expect(text).toContain("ANO 2011")
  })

  test("drops from the left, marking what was dropped", () => {
    const text = breadcrumbText(deep, 30)
    expect(text.startsWith("…")).toBe(true)
    expect(text).not.toContain("Okresy")
  })

  test("keeps as many trailing segments as fit", () => {
    const text = breadcrumbText(deep, 40)
    expect(text).toContain("Brno-Bohunice")
    expect(text).toContain("ANO 2011")
  })

  test("a single segment longer than the width is cut rather than lost entirely", () => {
    const text = breadcrumbText(["ČR", "Zastupitelstvo s velmi dlouhým názvem obce"], 20)
    expect([...text].length).toBeLessThanOrEqual(20)
    expect(text.length).toBeGreaterThan(0)
  })

  test("never exceeds the width, at any depth", () => {
    for (let width = 8; width <= 60; width += 1) {
      expect([...breadcrumbText(deep, width)].length).toBeLessThanOrEqual(width)
    }
  })
})

describe("segments for the styled title bar (002 T026, FR-011)", () => {
  const deep = ["ČR", "Okresy", "Okres Brno-město", "Brno-Bohunice", "ANO 2011"]
  /** A styled segment costs its text plus a space either side and the ▌ join. */
  const cost = (segments: string[]) => segments.reduce((sum, s) => sum + [...s].length + 3, 0)

  test("keeps every segment when they fit", () => {
    expect(breadcrumbSegments(["ČR", "Okres Brno-město"], 80)).toEqual(["ČR", "Okres Brno-město"])
  })

  test("drops from the left, marking the gap with its own segment, never the current level", () => {
    const kept = breadcrumbSegments(deep, 40)
    expect(kept[0]).toBe("…")
    expect(kept.at(-1)).toBe("ANO 2011")
    expect(kept).not.toContain("Okresy")
    expect(cost(kept)).toBeLessThanOrEqual(40)
  })

  test("cuts the current level itself only when even it alone does not fit", () => {
    const kept = breadcrumbSegments(["ČR", "Zastupitelstvo s velmi dlouhým názvem obce"], 20)
    expect(kept).toHaveLength(1)
    expect(cost(kept)).toBeLessThanOrEqual(20)
    expect(kept[0]?.length).toBeGreaterThan(0)
  })

  test("never exceeds the width, at any depth", () => {
    for (let width = 8; width <= 60; width += 1)
      expect(cost(breadcrumbSegments(deep, width))).toBeLessThanOrEqual(width)
  })

  test("leaves the plain breadcrumb exactly as it was", () => {
    expect(breadcrumbText(deep, 30)).toBe(`… ${SEPARATOR} Brno-Bohunice ${SEPARATOR} ANO 2011`)
  })
})
