/**
 * National overview (task T046, User Story 1).
 *
 * Thin wrapper since T114: the screen is built as semantic rows in national-rows.ts and
 * rendered to plain text here. Callers that want colour or bars read the rows directly.
 */

import type { Database } from "bun:sqlite"
import { clampLines } from "../format.ts"
import { toTextLines } from "../row.ts"
import { buildNationalRows } from "./national-rows.ts"

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
  // Rendered from semantic rows since T114. The plain-text form is byte-identical to
  // what the old string builder produced, which is what lets the existing assertions,
  // the exporter and the renderer all read the same view (research R14).
  return clampLines(toTextLines(buildNationalRows(db, options)), w)
}
