/**
 * Help view (task T095, FR-005; migrated to semantic rows in T117).
 *
 * Every key the application responds to is listed here. The status bar shows the ones
 * that apply where the user is standing; this is the complete reference, so no function
 * is reachable only by someone who happened to read the source.
 */

import { MIN_COLUMNS, MIN_ROWS } from "../components/status.ts"
import { type Column, clampLines, headerRow, rule } from "../format.ts"
import { blank, cell, line, type SemanticRow, toTextLines } from "../row.ts"

interface KeyRow {
  keys: string
  action: string
  where: string
}

const KEYS: KeyRow[] = [
  { keys: "↑ ↓", action: "Posun výběru o řádek", where: "seznamy" },
  { keys: "PgUp PgDn", action: "Posun o deset řádků", where: "seznamy" },
  { keys: "Home End", action: "Na začátek / na konec", where: "seznamy" },
  { keys: "Enter", action: "Otevřít vybranou položku", where: "seznamy" },
  { keys: "Esc", action: "Zpět o úroveň výš", where: "všude" },
  { keys: "/", action: "Hledat obec, stranu nebo kandidáta", where: "všude" },
  { keys: "t", action: "Přepnout typ zastupitelstva (obce / městské části)", where: "přehled ČR" },
  { keys: "w", action: "Přidat nebo odebrat ze sledovaných", where: "zastupitelstvo" },
  { keys: "Shift+W", action: "Zobrazit sledovaná zastupitelstva", where: "všude" },
  { keys: "e", action: "Exportovat zobrazenou tabulku do CSV", where: "tabulky" },
  { keys: "Shift+E", action: "Uložit souhrnnou zprávu do textového souboru", where: "okres, zastupitelstvo" },
  { keys: "r", action: "Vyžádat okamžité obnovení (nejdříve po 60 s)", where: "všude" },
  { keys: "Ctrl+P", action: "Otevřít paletu příkazů", where: "všude" },
  { keys: "Ctrl+B", action: "Zobrazit nebo skrýt postranní panel", where: "všude" },
  { keys: "Ctrl+T", action: "Přepnout motiv (tmavý, světlý, vysoký kontrast)", where: "všude" },
  { keys: "?", action: "Tato nápověda", where: "všude" },
  { keys: "q", action: "Ukončit aplikaci", where: "mimo hledání" },
  { keys: "Ctrl+C", action: "Ukončit aplikaci vždy", where: "všude" },
]

export function buildHelpRows(width = 100): SemanticRow[] {
  const rows: SemanticRow[] = [line("Nápověda", "heading"), line(rule(width), "muted"), blank()]

  const columns: Column[] = [
    { header: "Klávesa", width: 12 },
    { header: "Akce", width: Math.max(28, width - 40) },
    { header: "Kde", width: 24 },
  ]
  const [header, underline] = headerRow(columns)
  rows.push(line(header, "heading"), line(underline, "muted"))

  for (const key of KEYS) {
    rows.push({ columns, cells: [cell(key.keys), cell(key.action), cell(key.where, "muted")] })
  }

  rows.push(blank())
  rows.push(line("Poznámky", "heading"))
  rows.push(line(rule(Math.min(width, 8)), "muted"))
  rows.push(
    line(
      `Aplikace se dotazuje zdroje nejvýše jednou za 60 sekund; rychlejší dotazování ` +
        `vrací stejná data a jen zatěžuje server.`,
    ),
  )
  rows.push(
    line("Výsledky po jednotlivých okrscích se zveřejňují pouze dávkově a jsou mimo rozsah aplikace."),
  )
  rows.push(line("Zobrazené údaje pocházejí přímo ze zdroje; aplikace nic nedopočítává ani neodhaduje."))
  rows.push(line(`Minimální velikost okna: ${MIN_COLUMNS} × ${MIN_ROWS}.`))

  return rows
}

export function renderHelp(width = 100): string[] {
  return clampLines(toTextLines(buildHelpRows(width)), width)
}

/** Key names the help screen documents, for a test that the two cannot drift apart. */
export function documentedKeys(): string[] {
  return KEYS.map((k) => k.keys)
}
