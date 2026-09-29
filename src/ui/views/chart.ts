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

import type { Database } from "bun:sqlite"
import { type ChangeKind, compareValue } from "../../domain/status.ts"
import { listCouncilParties, listElected, readCouncil } from "../../storage/queries/areas.ts"
import {
  availableCouncilTypes,
  readNationalParties,
  readNationalTotals,
} from "../../storage/queries/national.ts"
import { formatInteger, formatPercent, pad, plural, withChange } from "../format.ts"
import type { Screen } from "../navigation.ts"
import { blank, type Cell, line, roleForChange, type SemanticRow } from "../row.ts"
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
export const CHART_SCREENS: readonly Screen["kind"][] = ["national", "council", "candidates"]

export function isChartScreen(screen: Screen): boolean {
  return CHART_SCREENS.includes(screen.kind)
}

/** What the status row says when a shrinking window closes the chart (research R4). */
export const CHART_CLOSED_NOTICE = "Graf zavřen: okno je pro něj příliš úzké."

/**
 * Whether the chart survives a resize.
 *
 * A chart that was on screen and no longer fits CLOSES, rather than hiding until the
 * window widens again (FR-013), and the user is told why. One that was never on screen
 * - wanted on a screen without a breakdown - is left alone and nothing is said.
 */
export function chartAfterResize(
  state: { open: boolean; shownLastDraw: boolean; onChartScreen: boolean },
  fits: boolean,
): { open: boolean; notice: string | null } {
  if (state.open && state.shownLastDraw && state.onChartScreen && !fits) {
    return { open: false, notice: CHART_CLOSED_NOTICE }
  }
  return { open: state.open, notice: null }
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

  // Candidates: only the elected have published votes, so the rest of the party's votes
  // is the only honest figure for everyone else (research R8). It stands for every
  // candidate without a slice of their own, elected beyond the sixth included.
  const charted = slices.reduce((sum, s) => sum + s.votes, 0)
  const votes = whole - charted
  const count = context.total - slices.length
  if (votes <= 0 || count <= 0) return slices
  const chartedBefore = sumKnown(ranked.map((e) => e.previousVotes))
  slices.push({
    rank: "other",
    name: otherName(count, context.unit),
    votes,
    sharePct: whole > 0 ? (votes / whole) * 100 : null,
    fraction: fraction(votes),
    change: compareValue(
      votes,
      context.previousWhole === null || chartedBefore === null ? null : context.previousWhole - chartedBefore,
    ),
    count,
  })
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

/** The council type, as the national chart's title names it when there is a choice. */
const TYPE_SUFFIX: Record<string, string> = { OBEC: " · obce", MCMO: " · MČ a MO" }

/** `průběžné` or `konečné`, the same distinction every view's badge makes (FR-015). */
function countState(isFinal: boolean): string {
  return isFinal ? "konečné" : "průběžné"
}

/**
 * What the chart for this screen shows, or null for a screen that offers none.
 *
 * Entries come in the table's own order, which is what breaks ties (research R9), and
 * straight from the queries the tables use, so a legend figure is the table's figure.
 */
export function chartContext(db: Database, screen: Screen, councilType: string): ChartContext | null {
  if (screen.kind === "council") return councilChart(db, screen.kodzastup)
  if (screen.kind === "candidates")
    return candidatesChart(db, screen.kodzastup, screen.vstrana, screen.ballotOrder)
  if (screen.kind !== "national") return null
  const totals = readNationalTotals(db, councilType)
  // Every party, not the table's twenty: the aggregate sums all of them (research R8).
  const entries: ChartEntry[] =
    totals === null
      ? []
      : readNationalParties(db, councilType, -1).map((party) => ({
          name: party.name,
          votes: party.votes,
          sharePct: party.votesPct,
          previousVotes: party.previousVotes,
        }))
  const suffix = availableCouncilTypes(db).length > 1 ? (TYPE_SUFFIX[councilType] ?? "") : ""
  return partyChart(
    "national",
    `Graf · ČR${suffix}`,
    `podíl platných hlasů · ${countState(totals?.isFinal === true)}`,
    entries,
  )
}

/** A context for parties: the whole is their votes, and the aggregate their sum. */
function partyChart(
  kind: ChartContext["kind"],
  title: string,
  subtitle: string,
  entries: ChartEntry[],
): ChartContext {
  return {
    kind,
    title,
    subtitle,
    entries,
    whole: entries.reduce((sum, e) => sum + e.votes, 0),
    total: entries.length,
    unit: "stran",
    aggregate: "sum",
    previousWhole: null,
  }
}

/** One council's parties, straight from the query its table uses (US2). */
function councilChart(db: Database, kodzastup: string): ChartContext {
  const council = readCouncil(db, kodzastup)
  const entries: ChartEntry[] =
    council === null || !council.hasResult
      ? []
      : listCouncilParties(db, kodzastup).map((party) => ({
          name: party.name,
          votes: party.votes,
          sharePct: party.votesPct,
          previousVotes: party.previousVotes,
        }))
  return partyChart(
    "council",
    `Graf · ${council?.name ?? kodzastup}`,
    `podíl platných hlasů · ${countState(council?.isFinal === true)}`,
    entries,
  )
}

/**
 * One party's candidates (US3): the elected, whose votes are published, against the
 * party's own votes. The party is found as the candidate table finds it, so a list
 * reached from search charts the same candidates as one reached from the council.
 */
function candidatesChart(
  db: Database,
  kodzastup: string,
  vstrana: string,
  ballotOrder: number | null,
): ChartContext {
  const council = readCouncil(db, kodzastup)
  const party = listCouncilParties(db, kodzastup).find(
    (p) => p.vstrana === vstrana && (ballotOrder === null || p.ballotOrder === ballotOrder),
  )
  const entries: ChartEntry[] =
    party === undefined
      ? []
      : listElected(db, kodzastup, vstrana, party.ballotOrder).map((person) => ({
          name: person.name,
          votes: person.votes,
          sharePct: person.votesPct,
          previousVotes: person.previousVotes,
        }))
  return {
    kind: "candidates",
    title: `Graf · ${party?.name ?? `Volební strana ${vstrana}`}`,
    subtitle: `podíl hlasů strany · ${countState(council?.isFinal === true)}`,
    entries,
    whole: party?.votes ?? 0,
    total: party?.candidates ?? entries.length,
    unit: "kand.",
    aggregate: "remainder",
    previousWhole: party?.previousVotes ?? null,
  }
}

/** The texture and slot a slice is drawn in: both belong to its rank. */
function sliceLook(slice: Slice): { texture: string; slot: Slot } {
  if (slice.rank === "other") return { texture: OTHER_TEXTURE, slot: "muted" }
  return { texture: TEXTURES[slice.rank], slot: SLICE_SLOTS[slice.rank] ?? "muted" }
}

/** Columns a legend row spends on everything but the name (contract § 3). */
const LEGEND_FIXED = 26

/**
 * One pie row as cells: a run of cells per stretch of one slice, so a row costs a
 * handful of chunks rather than one per character.
 */
function pieRow(cells: (number | null)[], slices: Slice[], lead: number): SemanticRow {
  const out: Cell[] = [{ text: " ".repeat(lead) }]
  let index = 0
  while (index < cells.length) {
    const value = cells[index] ?? null
    let end = index
    while (end < cells.length && (cells[end] ?? null) === value) end += 1
    const slice = value === null ? undefined : slices[value]
    if (slice === undefined) {
      out.push({ text: " ".repeat(end - index) })
    } else {
      const { texture, slot } = sliceLook(slice)
      out.push({ text: texture.repeat(end - index), fgSlot: slot })
    }
    index = end
  }
  return { cells: out }
}

/** One legend row: swatch, name, votes with their change marker, share. */
function legendRow(slice: Slice, width: number): SemanticRow {
  const { texture, slot } = sliceLook(slice)
  const name: Cell = { text: pad(slice.name, Math.max(1, width - LEGEND_FIXED)) }
  if (slice.rank === "other") name.role = "muted"
  const votes: Cell = { text: ` ${pad(withChange(formatInteger(slice.votes), slice.change), 12, "right")}` }
  const role = roleForChange(slice.change)
  if (role !== undefined) votes.role = role
  return {
    cells: [
      { text: " " },
      { text: texture.repeat(2), fgSlot: slot },
      { text: " " },
      name,
      votes,
      { text: ` ${pad(formatPercent(slice.sharePct), 8, "right")}`, role: "subtle" },
    ],
  }
}

/**
 * The chart pane's rows: title, subtitle, the pie, the legend (contract § 3).
 *
 * The exact figures are never replaced by the picture: every slice has a legend row with
 * its votes and share (FR-008). With nothing published yet, the pane says so rather than
 * drawing an empty or misleading pie (FR-011).
 */
export function buildChartRows(context: ChartContext, width: number, contentHeight: number): SemanticRow[] {
  const rows: SemanticRow[] = [
    line(pad(context.title, width), "accent"),
    line(pad(context.subtitle, width), "muted"),
    blank(),
  ]
  if (context.entries.length === 0 || context.whole <= 0) {
    // Two short lines rather than one long one, so the message fits the narrowest pane.
    rows.push(
      line("Zatím není co zobrazit."),
      line("Graf se vykreslí, jakmile", "muted"),
      line("budou zveřejněny výsledky.", "muted"),
    )
    return rows
  }

  const slices = rankSlices(context)
  const { radius } = chartLayout(width, contentHeight, slices.length)
  const lead = Math.max(0, Math.floor((width - (2 * radius + 1)) / 2))
  for (const cells of pieCells(
    slices.map((s) => s.fraction),
    radius,
  )) {
    rows.push(pieRow(cells, slices, lead))
  }
  rows.push(blank())
  for (const slice of slices) rows.push(legendRow(slice, width))
  return rows
}
