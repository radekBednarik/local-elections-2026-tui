/**
 * The breadcrumb (T120, FR-055).
 *
 * The one rule that matters: it truncates from the LEFT. "Where am I" is the question
 * it exists to answer, so the current location is the last thing that may be dropped.
 */

import { describe, expect, test } from "bun:test"
import { breadcrumbText, SEPARATOR } from "../../src/ui/chrome/breadcrumb.ts"

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
