/**
 * Search (tasks T076, T078).
 *
 * Matching runs entirely against the pre-folded `name_folded` columns, and the query is
 * folded through the SAME function that produced them. That is what makes FR-038 hold:
 * the two sides can only ever agree or disagree for the same reason, so "Říčany",
 * "ricany" and "RICANY" cannot drift apart.
 */

import type { Database } from "bun:sqlite"
import { fold } from "../../domain/folding.ts"

export type SearchKind = "council" | "party" | "candidate"

export interface SearchHit {
  kind: SearchKind
  /** What opening this hit needs: a council code. */
  kodzastup: string
  /** Council name, for context on a party or candidate hit. */
  councilName: string
  /** The matched text. */
  label: string
  /** Extra context, e.g. the district or the party stood for. */
  detail: string
  /** Party code, present on a party hit so the candidates can be opened. */
  vstrana: string | null
}

/** Escapes LIKE wildcards so a user typing % or _ searches for those characters. */
function likePattern(folded: string): string {
  return `%${folded.replace(/[%_\\]/g, "\\$&")}%`
}

/**
 * Searches councils, electoral parties and candidates.
 *
 * Results are ranked so that a name beginning with the query comes before one merely
 * containing it, because a user typing "brno" wants Brno before Brno-Bohunice's
 * neighbours. Ranking never changes which rows match, only their order.
 */
export function search(db: Database, query: string, limit = 50): SearchHit[] {
  const folded = fold(query)
  if (folded === "") return []

  const pattern = likePattern(folded)
  const prefix = `${folded.replace(/[%_\\]/g, "\\$&")}%`

  const councils = db
    .query(
      `SELECT c.kodzastup, c.name, c.oznac_typu, p.name AS parent_name, d.name AS district_name,
              CASE WHEN c.name_folded LIKE $prefix ESCAPE '\\' THEN 0 ELSE 1 END AS rank
         FROM council c
         LEFT JOIN council p ON p.kodzastup = c.parent_kodzastup
         LEFT JOIN district d ON d.nuts = c.district_nuts
        WHERE c.name_folded LIKE $pattern ESCAPE '\\'
        ORDER BY rank, LENGTH(c.name), c.name
        LIMIT $limit`,
    )
    .all({ pattern, prefix, limit }) as Record<string, unknown>[]

  const hits: SearchHit[] = councils.map((row) => ({
    kind: "council" as const,
    kodzastup: String(row.kodzastup),
    councilName: String(row.name),
    label: String(row.name),
    detail: [row.parent_name, row.district_name].filter((v) => v !== null && v !== undefined).join(", "),
    vstrana: null,
  }))

  if (hits.length >= limit) return hits

  // Electoral parties, reached through the council_party bridge so a hit knows which
  // council it belongs to (US4 acceptance scenario 2).
  const parties = db
    .query(
      `SELECT cp.kodzastup, cp.vstrana, cp.name, c.name AS council_name,
              CASE WHEN cp.name_folded LIKE $prefix ESCAPE '\\' THEN 0 ELSE 1 END AS rank
         FROM council_party cp
         JOIN council c ON c.kodzastup = cp.kodzastup
        WHERE cp.name_folded LIKE $pattern ESCAPE '\\'
        ORDER BY rank, c.name
        LIMIT $limit`,
    )
    .all({ pattern, prefix, limit: limit - hits.length }) as Record<string, unknown>[]

  for (const row of parties) {
    hits.push({
      kind: "party",
      kodzastup: String(row.kodzastup),
      councilName: String(row.council_name),
      label: String(row.name),
      detail: String(row.council_name),
      vstrana: String(row.vstrana),
    })
  }

  if (hits.length >= limit) return hits

  const candidates = db
    .query(
      `SELECT k.kodzastup, k.name, c.name AS council_name, cp.vstrana, cp.name AS party_name
         FROM candidate k
         JOIN council c ON c.kodzastup = k.kodzastup
         LEFT JOIN council_party cp ON cp.kodzastup = k.kodzastup AND cp.ostrana = k.ostrana
        WHERE k.name_folded LIKE $pattern ESCAPE '\\'
        ORDER BY k.name
        LIMIT $limit`,
    )
    .all({ pattern, limit: limit - hits.length }) as Record<string, unknown>[]

  for (const row of candidates) {
    hits.push({
      kind: "candidate",
      kodzastup: String(row.kodzastup),
      councilName: String(row.council_name),
      label: String(row.name),
      detail: [row.party_name, row.council_name].filter((v) => v !== null && v !== undefined).join(" — "),
      vstrana: row.vstrana === null || row.vstrana === undefined ? null : String(row.vstrana),
    })
  }

  return hits
}
