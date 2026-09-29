/**
 * The results chart (feature 006): ranking, the aggregate slice and the pie geometry.
 *
 * Everything here is pure, so the chart is asserted as data and as plain text, never
 * through a terminal. That is also what makes it hold without colour: the textures are
 * the plain text (research R1).
 */

import { describe, expect, test } from "bun:test"
import {
  type ChartContext,
  type ChartEntry,
  chartLayout,
  pieCells,
  rankSlices,
} from "../../src/ui/views/chart.ts"

function entry(
  name: string,
  votes: number,
  sharePct: number | null = null,
  previousVotes: number | null = null,
) {
  return { name, votes, sharePct, previousVotes } satisfies ChartEntry
}

function parties(entries: ChartEntry[]): ChartContext {
  return {
    kind: "national",
    title: "Graf · ČR",
    subtitle: "podíl platných hlasů · průběžné",
    entries,
    whole: entries.reduce((sum, e) => sum + e.votes, 0),
    total: entries.length,
    unit: "stran",
    aggregate: "sum",
    previousWhole: null,
  }
}

/** `n` entries with strictly falling votes, each with a share and a previous figure. */
function falling(n: number): ChartEntry[] {
  return Array.from({ length: n }, (_, i) =>
    entry(`Strana ${i + 1}`, (n - i) * 100, (n - i) * 1.25, (n - i) * 100),
  )
}

describe("rankSlices (research R9)", () => {
  test("ten entries give six ranked slices and one aggregate of the other four", () => {
    const slices = rankSlices(parties(falling(10)))
    expect(slices.map((s) => s.rank)).toEqual([0, 1, 2, 3, 4, 5, "other"])
    expect(slices.slice(0, 6).map((s) => s.name)).toEqual(falling(6).map((e) => e.name))
    const other = slices[6]
    expect(other?.count).toBe(4)
    expect(other?.name).toBe("Ostatní (4 strany)")
  })

  test("exactly seven entries aggregate the seventh alone", () => {
    const slices = rankSlices(parties(falling(7)))
    expect(slices).toHaveLength(7)
    expect(slices[6]?.count).toBe(1)
    expect(slices[6]?.name).toBe("Ostatní (1 strana)")
  })

  test("six entries or fewer draw no aggregate", () => {
    expect(rankSlices(parties(falling(6))).map((s) => s.rank)).toEqual([0, 1, 2, 3, 4, 5])
    expect(rankSlices(parties(falling(3))).map((s) => s.rank)).toEqual([0, 1, 2])
  })

  test("ranking is by votes, whatever order the entries arrive in", () => {
    const slices = rankSlices(parties([entry("Malá", 10), entry("Velká", 90), entry("Střední", 50)]))
    expect(slices.map((s) => s.name)).toEqual(["Velká", "Střední", "Malá"])
  })

  test("a tie across the cutoff keeps the table's order: the earlier entry is ranked", () => {
    const tied = [...falling(5), entry("První ze shodných", 50), entry("Druhá ze shodných", 50)]
    const slices = rankSlices(parties(tied))
    expect(slices[5]?.name).toBe("První ze shodných")
    expect(slices[6]?.rank).toBe("other")
    expect(slices[6]?.votes).toBe(50)
  })

  test("the aggregate's figures are the exact sums of its members' published figures", () => {
    const entries = [...falling(6), entry("A", 30, 0.37), entry("B", 20, 0.25), entry("C", 7, 0.09)]
    const other = rankSlices(parties(entries))[6]
    expect(other?.votes).toBe(57)
    expect(other?.sharePct).toBeCloseTo(0.37 + 0.25 + 0.09, 10)
  })

  test("fractions are each slice's votes over the whole, and add up to one", () => {
    const context = parties(falling(10))
    const slices = rankSlices(context)
    for (const slice of slices) expect(slice.fraction).toBeCloseTo(slice.votes / context.whole, 12)
    expect(slices.reduce((sum, s) => sum + s.fraction, 0)).toBeCloseTo(1, 10)
  })

  test("a ranked slice compares its votes with its own previous votes", () => {
    const slices = rankSlices(
      parties([
        entry("Roste", 300, null, 200),
        entry("Klesá", 200, null, 250),
        entry("Stojí", 100, null, 100),
      ]),
    )
    expect(slices.map((s) => s.change)).toEqual(["increased", "decreased", "unchanged"])
  })

  test("the aggregate compares sums, and is new when any member is new", () => {
    const grown = [...falling(6), entry("A", 30, null, 20), entry("B", 20, null, 20)]
    expect(rankSlices(parties(grown))[6]?.change).toBe("increased")
    const fresh = [...falling(6), entry("A", 30, null, 20), entry("B", 20, null, null)]
    expect(rankSlices(parties(fresh))[6]?.change).toBe("new")
  })

  test("aggregate labels follow Czech plurals", () => {
    expect(rankSlices(parties(falling(11)))[6]?.name).toBe("Ostatní (5 stran)")
    const candidates = { ...parties(falling(18)), unit: "kand." as const }
    expect(rankSlices(candidates)[6]?.name).toBe("Ostatní (12 kand.)")
  })
})

describe("pie geometry (research R1, R3)", () => {
  test("the radius follows the pane's width and height, capped at 16 and floored at 4", () => {
    expect(chartLayout(47, 28, 7).radius).toBe(16)
    expect(chartLayout(47, 27, 7).radius).toBe(15)
    expect(chartLayout(40, 21, 7).radius).toBe(9)
    expect(chartLayout(40, 20, 7).radius).toBe(8)
    expect(chartLayout(40, 12, 7).radius).toBe(4)
    expect(chartLayout(40, 21, 7).pieRows).toBe(10)
  })

  test("the grid is 2R + 1 columns by 2⌊R/2⌋ + 1 rows, and a circle on screen", () => {
    const grid = pieCells([1], 16)
    expect(grid).toHaveLength(17)
    for (const row of grid) expect(row).toHaveLength(33)
    // Terminal cells are about twice as tall as wide, so the disc spans the full width on
    // its middle row but only the centre column on its top row.
    expect(grid[8]?.every((c) => c === 0)).toBe(true)
    expect(grid[0]?.[16]).toBe(0)
    expect(grid[0]?.[0]).toBeNull()
  })

  test("slices run clockwise from twelve o'clock", () => {
    const grid = pieCells([0.75, 0.25], 16)
    const centreRow = 8
    // Twelve o'clock: straight above the centre.
    expect(grid[1]?.[16]).toBe(0)
    // Three o'clock is 25 % of the way round: still the first slice.
    expect(grid[centreRow]?.[30]).toBe(0)
    // Ten o'clock is past 75 % of the way round: the second slice.
    expect(grid[4]?.[4]).toBe(1)
    // Six o'clock is 50 %: still the first.
    expect(grid[16]?.[16]).toBe(0)
  })

  test("each slice's area is proportional to its share", () => {
    const cells = pieCells([0.75, 0.25], 16).flat()
    const inside = cells.filter((c) => c !== null)
    const first = inside.filter((c) => c === 0).length / inside.length
    // Within the cells along the slice boundaries: rows are two units apart, so a radius
    // of 16 has about 420 cells and a boundary of about 16 of them.
    expect(Math.abs(first - 0.75)).toBeLessThanOrEqual(0.04)
  })

  test("every slice of at least two percent owns a cell", () => {
    const fractions = [0.4, 0.2, 0.15, 0.1, 0.07, 0.05, 0.03]
    const cells = new Set(pieCells(fractions, 16).flat())
    for (let i = 0; i < fractions.length; i += 1) expect(cells.has(i)).toBe(true)
  })
})
