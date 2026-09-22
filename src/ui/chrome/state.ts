/**
 * What the frame should be showing (tasks T119-T123).
 *
 * `App.draw` used to assemble this inline, which made FR-058 - regions, scroll and
 * selection unmoved by a refresh - untestable without driving a real terminal. Pulled
 * out here, the whole drawing decision is an ordinary function of the database and the
 * navigation state, so the stability guarantee can be asserted directly.
 */

import type { Database } from "bun:sqlite"
import { availableCouncilTypes } from "../../storage/queries/national.ts"
import { statusBarLine } from "../components/status.ts"
import type { Navigation } from "../navigation.ts"
import type { ActionContext } from "../palette/actions.ts"
import { composeScreen, type ScreenContent } from "../screen.ts"
import { breadcrumbFor } from "./breadcrumb.ts"
import type { Frame } from "./frame.ts"

export interface FrameInputs {
  db: Database
  nav: Navigation
  councilType: string
  query: string
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
  lines: string[]
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
 * terminal (FR-040).
 */
export function withSelection(lines: string[], firstRow: number, selected: number): string[] {
  const index = firstRow + selected
  if (firstRow >= lines.length) return lines
  return lines.map((line, i) => (i === index ? `▶ ${line}` : `  ${line}`))
}

export function frameState(inputs: FrameInputs): FrameState {
  const { db, nav } = inputs

  const content = composeScreen(db, nav.screen, {
    width: inputs.contentWidth,
    councilType: inputs.councilType,
    query: inputs.query,
  })

  const context: ActionContext = {
    screen: nav.screen,
    depth: nav.depth,
    rowCount: content.rowCount,
    councilTypes: availableCouncilTypes(db).length,
    searchActive: nav.screen.kind === "search",
  }

  return {
    breadcrumb: breadcrumbFor(db, nav.screens, inputs.width),
    // A real staleness warning always wins the row: it is the more important message.
    warning: inputs.warning ?? inputs.notice,
    lines: withSelection(content.lines, content.firstRow, nav.current.selected),
    status: statusBarLine(context, inputs.width),
    offset: nav.ensureVisible(inputs.contentHeight, content.firstRow, content.lines.length),
    content,
  }
}

/** Puts the state on screen. Nothing here decides anything; it only applies. */
export function applyFrameState(frame: Frame, state: FrameState): void {
  frame.setBreadcrumb(state.breadcrumb)
  frame.setWarning(state.warning)
  frame.setLines(state.lines)
  frame.setStatus(state.status)
  frame.scroll.scrollTo(state.offset)
}
