/**
 * Help view (task T095, FR-005).
 *
 * Every key the application responds to is listed here. The footer shows the common
 * ones; this is the complete reference, so no function is reachable only by someone who
 * happened to read the source.
 */

import { MIN_COLUMNS, MIN_ROWS } from "../components/status.ts"
import { type Column, clampLines, dataRow, headerRow, rule } from "../format.ts"

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
  { keys: "?", action: "Tato nápověda", where: "všude" },
  { keys: "q", action: "Ukončit aplikaci", where: "mimo hledání" },
  { keys: "Ctrl+C", action: "Ukončit aplikaci vždy", where: "všude" },
]

export function renderHelp(width = 100): string[] {
  const lines = ["Nápověda", rule(width), ""]

  const columns: Column[] = [
    { header: "Klávesa", width: 12 },
    { header: "Akce", width: Math.max(28, width - 40) },
    { header: "Kde", width: 24 },
  ]
  const [header, underline] = headerRow(columns)
  lines.push(header, underline)

  for (const key of KEYS) {
    lines.push(dataRow(columns, [key.keys, key.action, key.where]))
  }

  lines.push("")
  lines.push("Poznámky")
  lines.push(rule(Math.min(width, 8)))
  lines.push(
    `Aplikace se dotazuje zdroje nejvýše jednou za 60 sekund; rychlejší dotazování ` +
      `vrací stejná data a jen zatěžuje server.`,
  )
  lines.push("Výsledky po jednotlivých okrscích se zveřejňují pouze dávkově a jsou mimo rozsah aplikace.")
  lines.push("Zobrazené údaje pocházejí přímo ze zdroje; aplikace nic nedopočítává ani neodhaduje.")
  lines.push(`Minimální velikost okna: ${MIN_COLUMNS} × ${MIN_ROWS}.`)

  return clampLines(lines, width)
}

/** Key names the help screen documents, for a test that the two cannot drift apart. */
export function documentedKeys(): string[] {
  return KEYS.map((k) => k.keys)
}
