/**
 * What the frame should be showing (tasks T119-T123, T136).
 *
 * `App.draw` used to assemble this inline, which made FR-058 - regions, scroll and
 * selection unmoved by a refresh - untestable without driving a real terminal. Pulled
 * out here, the whole drawing decision is an ordinary function of the database and the
 * navigation state, so the stability guarantee can be asserted directly.
 *
 * Both renderings are produced from one set of rows: `lines` is plain text, for tests
 * and exports, and `styled` is the same content resolved against the theme. They are cut
 * at the same width in the same place, so what a test measures is what the user sees.
 */

import type { Database } from "bun:sqlite"
import type { StyledText } from "@opentui/core"
import { availableCouncilTypes } from "../../storage/queries/national.ts"
import { statusBarLine } from "../components/status.ts"
import { clampLines } from "../format.ts"
import type { Navigation } from "../navigation.ts"
import type { ActionContext } from "../palette/actions.ts"
import type { SemanticRow } from "../row.ts"
import { composeScreen, type ScreenContent } from "../screen.ts"
import type { SortState } from "../sort.ts"
import { styledBlock, styledRow } from "../theme/apply.ts"
import type { Theme } from "../theme/themes.ts"
import { breadcrumbFor } from "./breadcrumb.ts"
import type { Frame } from "./frame.ts"
import { buildPanelRows, PANEL_WIDTH } from "./panel.ts"

/**
 * Columns reserved to the left of every row for the selection marker.
 *
 * Spent on every row, selected or not, so that selecting a row never shifts the table
 * sideways (FR-058).
 */
export const GUTTER = 2

export interface FrameInputs {
  db: Database
  nav: Navigation
  councilType: string
  query: string
  theme: Theme
  /** The column the user has sorted by, if any (FR-037). */
  sort: SortState
  /** Full terminal width, which the breadcrumb and status bar span. */
  width: number
  /** Columns inside the border, less the side panel. */
  contentWidth: number
  /** Rows inside the border. */
  contentHeight: number
  /** The persistent staleness warning, when there is one (FR-044). */
  warning: string | null
  /** A one-off confirmation, shown only when nothing is wrong. */
  notice: string | null
}

export interface FrameState {
  breadcrumb: string
  warning: string | null
  /** Plain text, one string per row, marker included. */
  lines: string[]
  /** The same rows resolved against the theme. */
  styled: StyledText[]
  status: string
  /** Scroll position, in line coordinates. */
  offset: number
  /** The composed screen, so a caller can resolve a row to what it opens. */
  content: ScreenContent
}

/**
 * Marks the selected row.
 *
 * A leading marker rather than colour, so the selection is visible on a monochrome
 * terminal (FR-040). Colour, where there is any, is added on top of it and never
 * instead of it.
 */
export function withSelection(lines: string[], firstRow: number, selected: number): string[] {
  const index = firstRow + selected
  if (firstRow >= lines.length) return lines
  return lines.map((line, i) => (i === index ? `▶ ${line}` : `  ${line}`))
}

/** The gutter for one row: the marker when it is selected, blank otherwise. */
function lead(index: number, firstRow: number, selected: number, total: number): string {
  if (firstRow >= total) return ""
  return index === firstRow + selected ? "▶ " : "  "
}

export function frameState(inputs: FrameInputs): FrameState {
  const { db, nav, theme } = inputs

  // The gutter is not the view's to spend, so the view is composed narrower by exactly
  // that much and the marker is written beside it.
  const viewWidth = Math.max(20, inputs.contentWidth - GUTTER)

  const content = composeScreen(db, nav.screen, {
    width: viewWidth,
    councilType: inputs.councilType,
    query: inputs.query,
    sort: inputs.sort,
  })

  const context: ActionContext = {
    screen: nav.screen,
    depth: nav.depth,
    rowCount: content.rowCount,
    councilTypes: availableCouncilTypes(db).length,
    searchActive: nav.screen.kind === "search",
    sortableColumns: content.sortableColumns,
  }

  const selected = nav.current.selected
  const selectedLine = content.firstRow + selected

  return {
    breadcrumb: breadcrumbFor(db, nav.screens, inputs.width),
    // A real staleness warning always wins the row: it is the more important message.
    warning: inputs.warning ?? inputs.notice,
    lines: withSelection(content.lines, content.firstRow, selected),
    styled: content.rows.map((row, index) =>
      styledRow(
        // The selected row takes the selection role, while a cell that already says
        // something for itself - a figure that rose or fell - keeps saying it.
        index === selectedLine ? markSelected(row) : row,
        theme,
        viewWidth,
        lead(index, content.firstRow, selected, content.rows.length),
      ),
    ),
    status: statusBarLine(context, inputs.width),
    offset: nav.ensureVisible(inputs.contentHeight, content.firstRow, content.lines.length),
    content,
  }
}

function markSelected(row: SemanticRow): SemanticRow {
  return { ...row, role: "selection" }
}

/** Puts the state on screen. Nothing here decides anything; it only applies. */
export function applyFrameState(frame: Frame, state: FrameState): void {
  frame.setBreadcrumb(state.breadcrumb)
  frame.setWarning(state.warning)
  frame.setRows(state.styled)
  frame.setStatus(state.status)
  frame.scroll.scrollTo(state.offset)
}

/** Renders plain text into the frame, for the paths that have no rows (FR-041). */
export function applyPlainLines(frame: Frame, lines: string[], width: number): void {
  frame.setRows(clampLines(lines, width))
}

/** The side panel, rendered as one styled block (FR-056). */
export function applyPanel(frame: Frame, db: Database, theme: Theme, visible: boolean): void {
  frame.setPanelVisible(visible)
  if (visible) frame.setPanelContent(styledBlock(buildPanelRows(db), theme, PANEL_WIDTH))
}
