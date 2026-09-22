/**
 * National overview (task T046, User Story 1).
 *
 * Produces the screen as an array of text lines. Building lines rather than renderables
 * keeps the whole view testable as data, and lets the renderer layer stay trivial.
 */

import type { Database } from "bun:sqlite"
import { ageSeconds, formatAge, statusLabel } from "../../domain/status.ts"
import { readNationalParties, readNationalTotals } from "../../storage/queries/national.ts"
import {
  type Column,
  clampLines,
  dataRow,
  formatInteger,
  formatPercent,
  formatProgress,
  headerRow,
  rule,
  withChange,
} from "../format.ts"

/** Czech names for the two council types the national document reports. */
const TYPE_LABELS: Record<string, string> = {
  OBEC: "Zastupitelstva obcí",
  MCMO: "Zastupitelstva městských částí a obvodů",
}

export interface NationalViewOptions {
  oznacTypu?: string
  width?: number
  /** Injected so the staleness age is deterministic in tests. */
  now?: Date
}

/**
 * Renders the national overview.
 *
 * Returns the message explaining that publication has not begun, rather than an empty
 * screen, when there is no data yet (FR-045).
 */
export function renderNationalView(db: Database, options: NationalViewOptions = {}): string[] {
  const w = Math.max(40, options.width ?? 100)
  return clampLines(buildNationalView(db, options), w)
}

function buildNationalView(db: Database, options: NationalViewOptions): string[] {
  const oznacTypu = options.oznacTypu ?? "OBEC"
  const width = Math.max(40, options.width ?? 100)
  const now = options.now ?? new Date()

  const totals = readNationalTotals(db, oznacTypu)
  if (totals === null) {
    return [
      TYPE_LABELS[oznacTypu] ?? oznacTypu,
      "",
      "Výsledky zatím nejsou zveřejněny.",
      "Aplikace se pravidelně dotazuje a zobrazí je, jakmile budou k dispozici.",
    ]
  }

  const lines: string[] = []

  lines.push(TYPE_LABELS[oznacTypu] ?? oznacTypu)
  lines.push(rule(width))

  // Provisional or final, plus the publisher's own timestamp and its age (FR-021).
  const age = ageSeconds(totals.publishedAt, now)
  lines.push(`Stav: ${statusLabel(totals)}   Zveřejněno: ${totals.publishedAt} (${formatAge(age)})`)
  lines.push(
    `Sečteno okrsků: ${withChange(
      formatProgress(totals.districtsCounted, totals.districtsTotal),
      totals.changes.districtsCounted,
    )}   ${formatPercent(totals.districtsPct)}`,
  )
  lines.push(
    `Voliči: ${formatInteger(totals.votersRegistered)}   ` +
      `Vydané obálky: ${formatInteger(totals.envelopesIssued)}   ` +
      `Účast: ${withChange(formatPercent(totals.turnoutPct), totals.changes.turnoutPct)}`,
  )
  lines.push(
    `Platné hlasy: ${withChange(formatInteger(totals.validVotes), totals.changes.validVotes)}   ` +
      `Zvolení zastupitelé: ${formatInteger(totals.seatsTotal)}`,
  )
  lines.push("")

  const parties = readNationalParties(db, oznacTypu, 20)
  if (parties.length === 0) {
    lines.push("Zatím nejsou k dispozici výsledky volebních stran.")
    return lines
  }

  // Name column takes whatever is left, so long coalition names stay readable on a
  // wide terminal and are truncated rather than wrapped on a narrow one.
  const fixed = 12 + 11 + 11 + 9
  const columns: Column[] = [
    { header: "Volební strana", width: Math.max(20, width - fixed - 4) },
    { header: "Hlasy", width: 12, align: "right" },
    { header: "Podíl", width: 11, align: "right" },
    { header: "Mandáty", width: 11, align: "right" },
    { header: "Podíl", width: 9, align: "right" },
  ]

  const [header, underline] = headerRow(columns)
  lines.push(header)
  lines.push(underline)

  for (const party of parties) {
    lines.push(
      dataRow(columns, [
        party.name,
        withChange(formatInteger(party.votes), party.votesChange),
        formatPercent(party.votesPct),
        withChange(formatInteger(party.seatsWon), party.seatsChange),
        formatPercent(party.seatsPct),
      ]),
    )
  }

  return lines
}
