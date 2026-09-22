/**
 * Search view (task T077).
 *
 * Results update as the user types. The view shows what kind each hit is, because a
 * council, a party and a candidate can all share a name and the user needs to know
 * which one they are about to open.
 */

import type { Database } from "bun:sqlite"
import { type SearchHit, search } from "../../storage/queries/search.ts"
import { type Column, clampLines, dataRow, headerRow, rule } from "../format.ts"

const KIND_LABEL: Record<SearchHit["kind"], string> = {
  council: "zastupitelstvo",
  party: "volební strana",
  candidate: "kandidát",
}

export interface SearchViewResult {
  lines: string[]
  hits: SearchHit[]
  firstRow: number
}

/** Renders the search screen for the current query. */
export function renderSearch(db: Database, query: string, width = 100): SearchViewResult {
  const lines = [`Hledání: ${query}${query === "" ? "_" : ""}`, rule(width)]

  if (query.trim() === "") {
    lines.push("")
    lines.push("Zadejte část názvu obce, volební strany nebo jméno kandidáta.")
    lines.push("Diakritika ani velikost písmen nerozhodují: „ricany“ najde Říčany.")
    return { lines: clampLines(lines, width), hits: [], firstRow: lines.length }
  }

  const hits = search(db, query)
  if (hits.length === 0) {
    lines.push("")
    lines.push("Nic nenalezeno.")
    return { lines: clampLines(lines, width), hits, firstRow: lines.length }
  }

  const columns: Column[] = [
    { header: "Název", width: Math.max(20, width - 52) },
    { header: "Typ", width: 16 },
    { header: "Kde", width: 32 },
  ]
  const [header, underline] = headerRow(columns)
  const firstRow = lines.length + 2
  lines.push(header, underline)

  for (const hit of hits) {
    lines.push(dataRow(columns, [hit.label, KIND_LABEL[hit.kind], hit.detail]))
  }

  return { lines: clampLines(lines, width), hits, firstRow }
}
