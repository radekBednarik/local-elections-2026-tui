/**
 * Formatted summary report (task T090, FR-051).
 *
 * Plain UTF-8 text, readable as written, wrapped at 80 columns so it survives being
 * pasted into mail or a chat window without reflowing into a mess.
 *
 * No BOM here, unlike the CSV: this is prose for a human reader, not a file a
 * spreadsheet has to sniff the encoding of, and a stray U+FEFF at the top of a pasted
 * message is just noise.
 */

import type { Database } from "bun:sqlite"
import {
  listCouncilParties,
  listCouncilsInDistrict,
  listElected,
  readCouncil,
} from "../storage/queries/areas.ts"
import { formatInteger, formatPercent, formatProgress, plural, seatsLabel } from "../ui/format.ts"
import type { Screen } from "../ui/navigation.ts"

const WIDTH = 80

function heading(text: string): string[] {
  return [text, "=".repeat(Math.min(WIDTH, text.length))]
}

function subheading(text: string): string[] {
  return ["", text, "-".repeat(Math.min(WIDTH, text.length))]
}

/**
 * Builds the report for a screen, or null when it has nothing to report.
 *
 * A district report omits the elected-candidate section, which exists only per council.
 */
export function reportForScreen(
  db: Database,
  screen: Screen,
  options: { now?: Date } = {},
): { content: string; areaLabel: string } | null {
  const exportedAt = (options.now ?? new Date()).toISOString().slice(0, 19)

  if (screen.kind === "council" || screen.kind === "candidates") {
    return councilReport(db, screen.kodzastup, exportedAt)
  }
  if (screen.kind === "district") {
    return districtReport(db, screen.nuts, exportedAt)
  }
  return null
}

function councilReport(
  db: Database,
  kodzastup: string,
  exportedAt: string,
): { content: string; areaLabel: string } | null {
  const council = readCouncil(db, kodzastup)
  if (council === null) return null

  const title = council.parentName === null ? council.name : `${council.name} (${council.parentName})`
  const lines = [
    ...heading(`Volby do zastupitelstev obcí 2026 — ${title}`),
    "",
    `Kód zastupitelstva: ${kodzastup}`,
    council.kindLabel === "" ? "" : `Typ: ${council.kindLabel}`,
    `Stav: ${council.isFinal ? "konečné výsledky" : "průběžné výsledky"}`,
    `Sečtené okrsky: ${formatProgress(council.districtsCounted, council.districtsTotal)}`,
    `Účast: ${formatPercent(council.turnoutPct)}`,
    `Mandáty celkem: ${formatInteger(council.seatsTotal)}`,
    `Exportováno: ${exportedAt}`,
  ].filter((line) => line !== "")

  const parties = listCouncilParties(db, kodzastup)
  if (parties.length === 0) {
    lines.push("", "Pro toto zastupitelstvo nejsou k dispozici výsledky volebních stran.")
    return { content: `${lines.join("\n")}\n`, areaLabel: council.name }
  }

  lines.push(...subheading("Mandáty podle volebních stran"))
  for (const party of parties) {
    lines.push(
      `${seatsLabel(party.seatsWon).padStart(12)}  ${formatPercent(party.votesPct).padStart(9)}  ${party.name}`,
    )
  }

  lines.push(...subheading("Zvolení zastupitelé"))
  let any = false
  for (const party of parties) {
    const elected = listElected(db, kodzastup, party.vstrana, party.ballotOrder)
    if (elected.length === 0) continue
    any = true
    lines.push("", party.name)
    for (const person of elected) {
      lines.push(
        `  ${String(person.ballotNumber).padStart(3)}. ${person.name}  (${formatInteger(person.votes)} ${plural(person.votes, "hlas", "hlasy", "hlasů")})`,
      )
    }
  }
  if (!any) lines.push("", "Zatím nebyli zvoleni žádní zastupitelé.")

  return { content: `${lines.join("\n")}\n`, areaLabel: council.name }
}

function districtReport(
  db: Database,
  nuts: string,
  exportedAt: string,
): { content: string; areaLabel: string } | null {
  const councils = listCouncilsInDistrict(db, nuts)
  if (councils.length === 0) return null

  const counted = councils.filter((c) => c.hasResult).length
  const lines = [
    ...heading(`Volby do zastupitelstev obcí 2026 — okres ${nuts}`),
    "",
    `Zastupitelstev: ${councils.length}, s výsledky: ${counted}`,
    `Stav: ${councils.every((c) => c.isFinal) ? "konečné výsledky" : "průběžné výsledky"}`,
    `Exportováno: ${exportedAt}`,
    ...subheading("Zastupitelstva"),
  ]

  for (const council of councils) {
    const indent = council.parentKodzastup === null ? "" : "  "
    const status = council.hasResult
      ? `${formatProgress(council.districtsCounted, council.districtsTotal)} okrsků, účast ${formatPercent(council.turnoutPct)}`
      : "bez výsledku"
    lines.push(`${indent}${council.name} — ${status}`)
  }

  // A district report deliberately stops here: elected candidates belong to a council,
  // and listing every one in a district would run to thousands of names.
  return { content: `${lines.join("\n")}\n`, areaLabel: `okres-${nuts}` }
}
