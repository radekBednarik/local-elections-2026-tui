/**
 * Search view (task T077, migrated to semantic rows in T116).
 *
 * Results update as the user types. The view shows what kind each hit is, because a
 * council, a party and a candidate can all share a name and the user needs to know
 * which one they are about to open.
 */

import type { Database } from "bun:sqlite"
import { type SearchHit, search } from "../../storage/queries/search.ts"
import { type Column, clampLines, headerRow, rule } from "../format.ts"
import { blank, cell, line, type SemanticRow, toTextLines } from "../row.ts"

const KIND_LABEL: Record<SearchHit["kind"], string> = {
  council: "zastupitelstvo",
  party: "volební strana",
  candidate: "kandidát",
}

export interface SearchRows {
  rows: SemanticRow[]
  hits: SearchHit[]
  firstRow: number
}

export interface SearchViewResult extends SearchRows {
  lines: string[]
}

/** Builds the search screen as semantic rows. */
export function buildSearchRows(db: Database, query: string, width = 100): SearchRows {
  const rows: SemanticRow[] = [
    line(`Hledání: ${query}${query === "" ? "_" : ""}`, "heading"),
    line(rule(width), "muted"),
  ]

  if (query.trim() === "") {
    rows.push(blank())
    rows.push(line("Zadejte část názvu obce, volební strany nebo jméno kandidáta."))
    rows.push(line("Diakritika ani velikost písmen nerozhodují: „ricany“ najde Říčany.", "muted"))
    return { rows, hits: [], firstRow: rows.length }
  }

  const hits = search(db, query)
  if (hits.length === 0) {
    rows.push(blank())
    rows.push(line("Nic nenalezeno."))
    return { rows, hits, firstRow: rows.length }
  }

  const columns: Column[] = [
    { header: "Název", width: Math.max(20, width - 52) },
    { header: "Typ", width: 16 },
    { header: "Kde", width: 32 },
  ]
  const [header, underline] = headerRow(columns)
  const firstRow = rows.length + 2
  rows.push(line(header, "heading"), line(underline, "muted"))

  for (const hit of hits) {
    rows.push({
      columns,
      cells: [cell(hit.label), cell(KIND_LABEL[hit.kind], "muted"), cell(hit.detail, "muted")],
    })
  }

  return { rows, hits, firstRow }
}

/** Renders the search screen for the current query. */
export function renderSearch(db: Database, query: string, width = 100): SearchViewResult {
  const built = buildSearchRows(db, query, width)
  return { ...built, lines: clampLines(toTextLines(built.rows), width) }
}
