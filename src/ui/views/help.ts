/**
 * Help view (task T095, FR-005; rebuilt from the action registry in T163).
 *
 * The complete key reference. It is GENERATED from `ACTIONS` rather than kept as its own
 * list, because the two lists drifted the moment there were two of them: the help said
 * "Enter" where the status bar said "⏎", and an action added to the registry would not
 * have appeared here at all. Now adding an action adds its help line, and there is no
 * second place to forget.
 *
 * A short list of navigation keys is added on top. They are not registry actions - they
 * move within a screen rather than doing anything to it - so they have nowhere else to
 * live.
 */

import { MIN_COLUMNS, MIN_ROWS } from "../components/status.ts"
import { type Column, clampLines, rule } from "../format.ts"
import { ACTIONS } from "../palette/actions.ts"
import { blank, cell, line, type SemanticRow, tableHeader, toTextLines } from "../row.ts"

interface KeyRow {
  keys: string
  action: string
  where: string
}

/**
 * Keys that move within a screen rather than performing an action.
 *
 * Deliberately not registry entries: the registry answers "what can I do here", and a
 * page-down is not one of the answers.
 */
const NAVIGATION: KeyRow[] = [
  { keys: "PgUp PgDn", action: "Posun o deset řádků", where: "seznamy" },
  { keys: "Home End", action: "Na začátek / na konec", where: "seznamy" },
]

/** Keys the runtime answers unconditionally, outside the registry. */
const ALWAYS: KeyRow[] = [{ keys: "Ctrl+C", action: "Ukončit aplikaci vždy", where: "všude" }]

/** Every documented key, registry first. */
export function helpRows(): KeyRow[] {
  const fromRegistry = ACTIONS.map((action) => ({
    keys: action.key,
    action: action.label,
    where: action.where,
  }))
  // Inserted after the two movement actions so the navigation keys read together.
  return [...fromRegistry.slice(0, 2), ...NAVIGATION, ...fromRegistry.slice(2), ...ALWAYS]
}

export function buildHelpRows(width = 100): SemanticRow[] {
  const rows: SemanticRow[] = [line("Nápověda", "heading"), line(rule(width), "muted"), blank()]

  const columns: Column[] = [
    { header: "Klávesa", width: 12 },
    { header: "Akce", width: Math.max(28, width - 40) },
    { header: "Kde", width: 24 },
  ]
  rows.push(...tableHeader(columns))

  for (const key of helpRows()) {
    rows.push({ kind: "data", columns, cells: [cell(key.keys), cell(key.action), cell(key.where, "muted")] })
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
  rows.push(line("Myš je nepovinná: vše je dostupné z klávesnice."))
  rows.push(line(`Minimální velikost okna: ${MIN_COLUMNS} × ${MIN_ROWS}.`))

  return rows
}

export function renderHelp(width = 100): string[] {
  return clampLines(toTextLines(buildHelpRows(width)), width)
}

/** Key names the help screen documents, for a test that the two cannot drift apart. */
export function documentedKeys(): string[] {
  return helpRows().map((k) => k.keys)
}
