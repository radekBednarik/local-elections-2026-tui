/**
 * The watchlist side panel (tasks T150-T153, FR-056, FR-057).
 *
 * A handful of councils kept in view while the user works elsewhere. Narrow by design:
 * enough for a name and a turnout, and nothing more, because anything wider starts
 * competing with the content for the same columns.
 *
 * THE CONTENT AREA ALWAYS WINS. The panel is an aid; the table is the reason the
 * application exists. So the panel hides itself when the terminal cannot show it beside
 * a readable content area, and returns when there is room again - rather than squeezing
 * the table to stay open (FR-057).
 */

import type { Database } from "bun:sqlite"
import { readCouncil } from "../../storage/queries/areas.ts"
import { listWatchlist } from "../../storage/queries/watchlist.ts"
import { bar } from "../bar.ts"
import { formatPercent, pad } from "../format.ts"
import { line, type SemanticRow } from "../row.ts"

/** Width of the side panel when it is shown. Enough for a council name and a turnout. */
export const PANEL_WIDTH = 22

/**
 * The narrowest content area worth showing.
 *
 * A council table is a name column plus votes, share and seats. Below this the name
 * column is cut so hard that the table stops telling the user which party is which,
 * which is the point at which keeping the panel open costs more than it gives.
 */
export const MIN_CONTENT_COLUMNS = 64

/** The panel's own cost: its width plus the border that separates it. */
export const PANEL_COST = PANEL_WIDTH + 1

/**
 * Whether the panel fits beside a readable content area (FR-057).
 *
 * `contentAreaWidth` is what the content area would have WITHOUT the panel.
 */
export function panelFits(contentAreaWidth: number): boolean {
  return contentAreaWidth - PANEL_COST >= MIN_CONTENT_COLUMNS
}

/**
 * The panel's rows.
 *
 * An empty watchlist says how to fill it rather than showing an empty box: a blank
 * panel looks broken, and the user has no way to learn the key from it.
 */
export function buildPanelRows(db: Database, width = PANEL_WIDTH): SemanticRow[] {
  const watched = listWatchlist(db)
  const rows: SemanticRow[] = [line(pad("SLEDOVANÉ", width), "accent")]

  if (watched.length === 0) {
    rows.push(line("", "muted"))
    rows.push(line("Zatím nic", "muted"))
    rows.push(line("nesledujete.", "muted"))
    rows.push(line("", "muted"))
    rows.push(line("Otevřete", "muted"))
    rows.push(line("zastupitelstvo", "muted"))
    rows.push(line("a stiskněte w.", "muted"))
    return rows
  }

  for (const entry of watched) {
    const council = readCouncil(db, entry.kodzastup)
    rows.push(line(pad(entry.name, width)))
    rows.push(
      council === null || !council.hasResult
        ? line(pad("  čeká se", width), "muted")
        : {
            // The turnout, then its bar as a cell of its own, so the part the bar does
            // not fill shows the track (002 FR-018).
            cells: [
              { text: `  ${formatPercent(council.turnoutPct)} ` },
              { text: bar(council.turnoutPct === null ? null : council.turnoutPct / 100, 6), bar: true },
            ],
          },
    )
  }

  return rows
}
