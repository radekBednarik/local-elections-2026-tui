/**
 * The results chart (feature 006): a pie of one vote breakdown, drawn as text.
 *
 * The pie is ordinary rows of texture characters, one character per terminal cell, so it
 * renders through the same path as every other region and its plain-text form is the
 * picture itself (research R1). That is what keeps it readable without colour: each slice
 * has a texture of its own, and colour is only added on top of it (FR-007).
 *
 * COLOUR BELONGS TO THE RANK, NEVER TO THE PARTY. The largest slice is always `slice1`,
 * the next `slice2`, and so on (research R9). A colour per party would imply a political
 * affiliation the source never published (001 FR-060); a colour per rank says only
 * "largest", "second largest". The price is that a party's colour can change between a
 * refresh and the next, and between contexts, so the legend is always the mapping.
 */

import { type ChangeKind, compareValue } from "../../domain/status.ts"
import { plural } from "../format.ts"
import type { Screen } from "../navigation.ts"
import type { Slot } from "../theme/themes.ts"

/** One entry of a vote breakdown, before ranking (data-model.md § ChartEntry). */
export interface ChartEntry {
  name: string
  votes: number
  /** The published share, as a percentage. */
  sharePct: number | null
  /** The same entry in the previous snapshot, or null when there is none. */
  previousVotes: number | null
}

/** What one chart is drawn for (data-model.md § ChartContext). */
export interface ChartContext {
  kind: "national" | "council" | "candidates"
  title: string
  subtitle: string
  /** In the table's unsorted order, which breaks ties (FR-005). */
  entries: ChartEntry[]
  /** The denominator every slice's angle is taken against. */
  whole: number
  /** How many entries the context has, charted or not. */
  total: number
  unit: "stran" | "kand."
  /**
   * How the "Ostatní" slice is formed. `sum`: the exact sum of the entries it stands
   * for. `remainder`: the whole less the ranked slices, for candidates, whose votes are
   * published only for those elected (research R8).
   */
  aggregate: "sum" | "remainder"
  /** The whole in the previous snapshot, for the remainder's change marker. */
  previousWhole: number | null
}

/** One charted wedge (data-model.md § Slice). */
export interface Slice {
  rank: 0 | 1 | 2 | 3 | 4 | 5 | "other"
  name: string
  votes: number
  sharePct: number | null
  /** `votes / whole`, the slice's part of the full turn. */
  fraction: number
  change: ChangeKind
  /** For the aggregate only: how many entries it stands for. */
  count?: number
}

/** The screens that show a vote breakdown and so offer the chart. */
export const CHART_SCREENS: readonly Screen["kind"][] = ["national"]

export function isChartScreen(screen: Screen): boolean {
  return CHART_SCREENS.includes(screen.kind)
}

/** How many entries get a slice of their own. */
const RANKED = 6

/** One fill per rank, distinct without colour (FR-007). */
export const TEXTURES = ["█", "▓", "▚", "▒", "▞", "░"] as const

/** The aggregate's fill: a sparse field that reads as "the rest". */
export const OTHER_TEXTURE = "·"

/** One slot per rank; the aggregate takes the theme's muted tone. */
export const SLICE_SLOTS: readonly Slot[] = ["slice1", "slice2", "slice3", "slice4", "slice5", "slice6"]

/** Sum of a list, or null when any member is unknown. */
function sumKnown(values: (number | null)[]): number | null {
  let total = 0
  for (const value of values) {
    if (value === null) return null
    total += value
  }
  return total
}

/** The aggregate's label, with Czech plural agreement for parties. */
function otherName(count: number, unit: ChartContext["unit"]): string {
  const noun = unit === "stran" ? plural(count, "strana", "strany", "stran") : "kand."
  return `Ostatní (${count} ${noun})`
}

/**
 * The slices to draw: the six largest entries, then one aggregate of the rest.
 *
 * The sort is stable, so entries tied on votes keep the order they arrived in, which is
 * the table's own: chart and table never disagree about who is sixth.
 */
export function rankSlices(context: ChartContext): Slice[] {
  const { whole } = context
  const fraction = (votes: number) => (whole > 0 ? votes / whole : 0)
  const sorted = [...context.entries].sort((a, b) => b.votes - a.votes)
  const ranked = sorted.slice(0, RANKED)
  const rest = sorted.slice(RANKED)

  const slices: Slice[] = ranked.map((entry, index) => ({
    rank: index as Slice["rank"],
    name: entry.name,
    votes: entry.votes,
    sharePct: entry.sharePct,
    fraction: fraction(entry.votes),
    change: compareValue(entry.votes, entry.previousVotes),
  }))

  if (context.aggregate === "sum") {
    if (rest.length === 0) return slices
    const votes = rest.reduce((sum, e) => sum + e.votes, 0)
    slices.push({
      rank: "other",
      name: otherName(rest.length, context.unit),
      votes,
      sharePct: sumKnown(rest.map((e) => e.sharePct)),
      fraction: fraction(votes),
      change: compareValue(votes, sumKnown(rest.map((e) => e.previousVotes))),
      count: rest.length,
    })
    return slices
  }

  return slices
}

/**
 * How big the pie can be in a pane of this size (research R3).
 *
 * Four rows are fixed: title, subtitle, and a blank above and below the pie. The rest
 * that the legend leaves is the pie's. Capped at the approved size, and floored so the
 * pie never vanishes; the floor is out of reach at every supported terminal size.
 */
export function chartLayout(
  paneWidth: number,
  contentHeight: number,
  legendRows: number,
): { radius: number; pieRows: number } {
  const pieRows = contentHeight - 4 - legendRows
  const radius = Math.max(4, Math.min(16, Math.floor((paneWidth - 3) / 2), pieRows - 1))
  return { radius, pieRows }
}

/**
 * Which slice each cell of the pie belongs to, or null outside the disc.
 *
 * A terminal cell is about twice as tall as it is wide, so a row counts double: the disc
 * is an ellipse in cells and a circle on screen. Angles run clockwise from twelve
 * o'clock, and a cell belongs to the first slice whose running total reaches its angle.
 */
export function pieCells(fractions: number[], radius: number): (number | null)[][] {
  const half = Math.floor(radius / 2)
  const cumulative: number[] = []
  let running = 0
  for (const f of fractions) {
    running += f
    cumulative.push(running)
  }

  const grid: (number | null)[][] = []
  for (let row = 0; row <= 2 * half; row += 1) {
    const cells: (number | null)[] = []
    for (let column = 0; column <= 2 * radius; column += 1) {
      const sx = column - radius
      const sy = row - half
      if (sx * sx + (2 * sy) ** 2 > radius * radius) {
        cells.push(null)
        continue
      }
      let angle = Math.atan2(sx, -2 * sy)
      if (angle < 0) angle += 2 * Math.PI
      const at = angle / (2 * Math.PI)
      const index = cumulative.findIndex((total) => at <= total)
      cells.push(index === -1 ? fractions.length - 1 : index)
    }
    grid.push(cells)
  }
  return grid
}
