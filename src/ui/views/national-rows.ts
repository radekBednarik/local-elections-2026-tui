/**
 * National overview as semantic rows (task T114).
 *
 * The same screen as `national.ts`, expressed as rows that carry meaning rather than
 * pre-formatted text. `renderNationalView` now renders these to plain text, so the
 * existing assertions keep passing unchanged while the type beneath them changes.
 *
 * Roles here say what a value IS, never what colour it should be. The theme decides
 * that, and only when rendering to a terminal (FR-059, FR-063).
 */

import type { Database } from "bun:sqlite"
import { ageSeconds, formatAge, statusLabel } from "../../domain/status.ts"
import { readNationalParties, readNationalTotals } from "../../storage/queries/national.ts"
import { BAR_WIDTH, bar, barsFit } from "../bar.ts"
import { type Column, formatInteger, formatPercent, formatProgress, pad, withChange } from "../format.ts"
import { badge, blank, type Cell, cell, line, roleForChange, type SemanticRow, tableHeader } from "../row.ts"

const TYPE_LABELS: Record<string, string> = {
  OBEC: "Zastupitelstva obcí",
  MCMO: "Zastupitelstva městských částí a obvodů",
}

export interface NationalRowsOptions {
  oznacTypu?: string
  width?: number
  now?: Date
  /**
   * Rows the content area affords, when known. Decides whether the summary is drawn as
   * cards or collapsed to compact lines (002 FR-021); absent means there is room.
   */
  contentHeight?: number
}

/** Columns between two cards. */
const CARD_GAP = 2

/** Table rows the summary must leave in view before the cards give way (FR-021). */
const TABLE_ROWS_KEPT = 10

/** One summary card: a label, the figure, and the line beneath it. */
interface Card {
  label: string
  figure: string
  figureRole: Cell["role"]
  /** Builds the third row at the card's inner width. */
  foot: (inner: number) => Cell[]
}

/** A card's cell: its text padded to the card's width, on the card's surface. */
function onCard(text: string, width: number, role?: Cell["role"]): Cell {
  const cell: Cell = { text: pad(text, width), surface: "element" }
  if (role !== undefined) cell.role = role
  return cell
}

/** A bar across the card with a figure after it, both on the card's surface. */
function barFoot(fraction: number | null, figure: string): (inner: number) => Cell[] {
  return (inner) => {
    const tail = figure === "" ? " " : ` ${figure} `
    const width = Math.max(1, inner - 1 - [...tail].length)
    return [
      onCard(" ", 1),
      { text: bar(fraction, width), bar: true, fgSlot: "success", surface: "element" },
      onCard(tail, [...tail].length),
    ]
  }
}

/**
 * The cards as three rows (002 FR-020).
 *
 * Each card takes an equal share of the width with a gap between, so every row lines up.
 * Returns null when a card is too narrow for its figure: a figure is never cut, and the
 * compact lines are used instead.
 */
function cardRows(cards: Card[], width: number): SemanticRow[] | null {
  const inner = Math.floor((width - CARD_GAP * (cards.length - 1)) / cards.length)
  if (cards.some((c) => [...c.figure].length + 2 > inner || [...c.label].length + 2 > inner)) return null
  const gap = { text: " ".repeat(CARD_GAP) }
  const join = (parts: Cell[][]) => parts.flatMap((part, i) => (i === 0 ? part : [gap, ...part]))
  return [
    { cells: join(cards.map((c) => [onCard(` ${c.label}`, inner, "muted")])) },
    { cells: join(cards.map((c) => [onCard(` ${c.figure}`, inner, c.figureRole)])) },
    { cells: join(cards.map((c) => c.foot(inner))) },
  ]
}

// `roleForChange` moved to row.ts in T116, once the watchlist needed the same mapping.
export { roleForChange }

/**
 * Summary items joined on one line, or wrapped between items when that line would not
 * fit (006 FR-012).
 *
 * Beside the chart pane the table is narrow, and a summary line cut by the clamp would
 * lose a figure off its end. Wrapping happens only between items, so no figure is ever
 * split, and a line that fits is exactly the line it always was.
 */
function summaryLines(items: string[], separator: string, width: number, role?: Cell["role"]): SemanticRow[] {
  const whole = items.join(separator)
  if ([...whole].length <= width) return [line(whole, role)]
  const lines: string[] = []
  for (const item of items) {
    const last = lines[lines.length - 1]
    if (last !== undefined && [...`${last}${separator}${item}`].length <= width) {
      lines[lines.length - 1] = `${last}${separator}${item}`
    } else {
      lines.push(item)
    }
  }
  return lines.map((text) => line(text, role))
}

/** Builds the national overview as semantic rows. */
export function buildNationalRows(db: Database, options: NationalRowsOptions = {}): SemanticRow[] {
  const oznacTypu = options.oznacTypu ?? "OBEC"
  const width = Math.max(40, options.width ?? 100)
  const now = options.now ?? new Date()

  const totals = readNationalTotals(db, oznacTypu)
  if (totals === null) {
    return [
      line(TYPE_LABELS[oznacTypu] ?? oznacTypu, "heading"),
      blank(),
      line("Výsledky zatím nejsou zveřejněny."),
      line("Aplikace se pravidelně dotazuje a zobrazí je, jakmile budou k dispozici.", "muted"),
    ]
  }

  // The title with the status as a badge, and the publisher's own timestamp (FR-021).
  const age = ageSeconds(totals.publishedAt, now)
  const rows: SemanticRow[] = [
    {
      cells: [
        cell(TYPE_LABELS[oznacTypu] ?? oznacTypu, "heading"),
        cell("  "),
        badge(`${totals.isFinal ? "✓" : "◌"} ${statusLabel(totals)}`),
      ],
    },
    ...summaryLines([`Zveřejněno: ${totals.publishedAt}`, `(${formatAge(age)})`], " ", width, "muted"),
    blank(),
  ]

  const counted = withChange(
    formatProgress(totals.districtsCounted, totals.districtsTotal),
    totals.changes.districtsCounted,
  )
  const turnout = withChange(formatPercent(totals.turnoutPct), totals.changes.turnoutPct)
  const valid = withChange(formatInteger(totals.validVotes), totals.changes.validVotes)
  const detail = [
    `Voliči: ${formatInteger(totals.votersRegistered)}`,
    `Vydané obálky: ${formatInteger(totals.envelopesIssued)}`,
  ]

  // Cards cost their three rows, the detail line and a blank; collapse only when that
  // would leave fewer than ten table rows in view (FR-021).
  const cardCost = rows.length + 3 + 2 + 2
  const roomy = options.contentHeight === undefined || options.contentHeight - cardCost >= TABLE_ROWS_KEPT
  const cards = roomy
    ? cardRows(
        [
          {
            label: "SEČTENO OKRSKŮ",
            figure: counted,
            figureRole: roleForChange(totals.changes.districtsCounted) ?? "heading",
            foot: barFoot(
              totals.districtsPct === null ? null : totals.districtsPct / 100,
              formatPercent(totals.districtsPct),
            ),
          },
          {
            label: "ÚČAST",
            figure: turnout,
            figureRole: roleForChange(totals.changes.turnoutPct) ?? "heading",
            foot: barFoot(totals.turnoutPct === null ? null : totals.turnoutPct / 100, ""),
          },
          {
            label: "PLATNÉ HLASY",
            figure: valid,
            figureRole: roleForChange(totals.changes.validVotes) ?? "heading",
            foot: (inner) => [onCard(` ${formatInteger(totals.seatsTotal)} zvolených`, inner, "muted")],
          },
        ],
        width,
      )
    : null

  if (cards !== null) {
    rows.push(...cards, ...summaryLines(detail, "   ", width, "muted"), blank())
  } else {
    // The compact form: the same figures and labels on as few lines as stay readable.
    rows.push(
      ...summaryLines(
        [`Sečteno okrsků: ${counted}`, formatPercent(totals.districtsPct), `Účast: ${turnout}`],
        "   ",
        width,
      ),
      ...summaryLines(
        [`Platné hlasy: ${valid}`, `Zvolení zastupitelé: ${formatInteger(totals.seatsTotal)}`],
        "   ",
        width,
      ),
      ...summaryLines(detail, "   ", width, "muted"),
      blank(),
    )
  }

  const parties = readNationalParties(db, oznacTypu, 20)
  if (parties.length === 0) {
    rows.push(line("Zatím nejsou k dispozici výsledky volebních stran.", "muted"))
    return rows
  }

  const fixed = 12 + 11 + 11 + 9 + 4
  // The seat columns go before any figure is cut (006 FR-012, extending FR-074): they
  // stay while a name of twenty columns still fits beside them. Beside the chart pane,
  // or the watchlist on a narrow terminal, the table keeps the name, the votes and the
  // share, and the name takes whatever is left.
  const seats = width >= fixed + 20
  // The same budget the council table keeps: a name column below thirty columns stops
  // saying which party a row belongs to, and the name outranks the aid (FR-074).
  const bars = seats && barsFit(width, fixed + 30)
  const columns: Column[] = seats
    ? [
        { header: "Volební strana", width: Math.max(20, width - fixed - (bars ? BAR_WIDTH + 1 : 0)) },
        { header: "Hlasy", width: 12, align: "right" },
        { header: "Podíl", width: 11, align: "right" },
        ...(bars ? [{ header: "", width: BAR_WIDTH } satisfies Column] : []),
        { header: "Mandáty", width: 11, align: "right" },
        { header: "Podíl", width: 9, align: "right" },
      ]
    : [
        { header: "Volební strana", width: Math.max(14, width - 12 - 11 - 2) },
        { header: "Hlasy", width: 12, align: "right" },
        { header: "Podíl", width: 11, align: "right" },
      ]

  rows.push(...tableHeader(columns))

  for (const party of parties) {
    rows.push({
      kind: "data",
      columns,
      cells: [
        cell(party.name),
        cell(withChange(formatInteger(party.votes), party.votesChange), roleForChange(party.votesChange)),
        // The bar is a column of its own beside the published share, never a
        // replacement for it (FR-070, FR-071).
        cell(formatPercent(party.votesPct)),
        ...(bars ? [{ text: bar(party.votesPct === null ? null : party.votesPct / 100), bar: true }] : []),
        ...(seats
          ? [
              cell(
                withChange(formatInteger(party.seatsWon), party.seatsChange),
                roleForChange(party.seatsChange),
              ),
              cell(formatPercent(party.seatsPct)),
            ]
          : []),
      ],
    })
  }

  return rows
}
