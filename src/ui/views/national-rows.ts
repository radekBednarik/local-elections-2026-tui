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
import {
  type Column,
  formatInteger,
  formatPercent,
  formatProgress,
  headerRow,
  rule,
  withChange,
} from "../format.ts"
import { blank, cell, line, roleForChange, type SemanticRow } from "../row.ts"

const TYPE_LABELS: Record<string, string> = {
  OBEC: "Zastupitelstva obcí",
  MCMO: "Zastupitelstva městských částí a obvodů",
}

export interface NationalRowsOptions {
  oznacTypu?: string
  width?: number
  now?: Date
}

// `roleForChange` moved to row.ts in T116, once the watchlist needed the same mapping.
export { roleForChange }

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

  const rows: SemanticRow[] = [
    line(TYPE_LABELS[oznacTypu] ?? oznacTypu, "heading"),
    line(rule(width), "muted"),
  ]

  const age = ageSeconds(totals.publishedAt, now)
  rows.push(line(`Stav: ${statusLabel(totals)}   Zveřejněno: ${totals.publishedAt} (${formatAge(age)})`))
  rows.push(
    line(
      `Sečteno okrsků: ${withChange(
        formatProgress(totals.districtsCounted, totals.districtsTotal),
        totals.changes.districtsCounted,
      )}   ${formatPercent(totals.districtsPct)}`,
      roleForChange(totals.changes.districtsCounted),
    ),
  )
  rows.push(
    line(
      `Voliči: ${formatInteger(totals.votersRegistered)}   ` +
        `Vydané obálky: ${formatInteger(totals.envelopesIssued)}   ` +
        `Účast: ${withChange(formatPercent(totals.turnoutPct), totals.changes.turnoutPct)}`,
    ),
  )
  rows.push(
    line(
      `Platné hlasy: ${withChange(formatInteger(totals.validVotes), totals.changes.validVotes)}   ` +
        `Zvolení zastupitelé: ${formatInteger(totals.seatsTotal)}`,
    ),
  )
  rows.push(blank())

  const parties = readNationalParties(db, oznacTypu, 20)
  if (parties.length === 0) {
    rows.push(line("Zatím nejsou k dispozici výsledky volebních stran.", "muted"))
    return rows
  }

  const fixed = 12 + 11 + 11 + 9 + 4
  // The same budget the council table keeps: a name column below thirty columns stops
  // saying which party a row belongs to, and the name outranks the aid (FR-074).
  const bars = barsFit(width, fixed + 30)
  const columns: Column[] = [
    { header: "Volební strana", width: Math.max(20, width - fixed - (bars ? BAR_WIDTH + 1 : 0)) },
    { header: "Hlasy", width: 12, align: "right" },
    { header: "Podíl", width: 11, align: "right" },
    ...(bars ? [{ header: "", width: BAR_WIDTH } satisfies Column] : []),
    { header: "Mandáty", width: 11, align: "right" },
    { header: "Podíl", width: 9, align: "right" },
  ]

  const [header, underline] = headerRow(columns)
  rows.push(line(header, "heading"))
  rows.push(line(underline, "muted"))

  for (const party of parties) {
    rows.push({
      columns,
      cells: [
        cell(party.name),
        cell(withChange(formatInteger(party.votes), party.votesChange), roleForChange(party.votesChange)),
        // The bar is a column of its own beside the published share, never a
        // replacement for it (FR-070, FR-071).
        cell(formatPercent(party.votesPct)),
        ...(bars ? [cell(bar(party.votesPct === null ? null : party.votesPct / 100), "muted")] : []),
        cell(withChange(formatInteger(party.seatsWon), party.seatsChange), roleForChange(party.seatsChange)),
        cell(formatPercent(party.seatsPct)),
      ],
    })
  }

  return rows
}
