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
import { statusBarLine, statusBarRow } from "../components/status.ts"
import { clampLines } from "../format.ts"
import type { Navigation } from "../navigation.ts"
import type { ActionContext } from "../palette/actions.ts"
import { type Cell, cellsWide, type SemanticRow, type Surface } from "../row.ts"
import { composeScreen, type ScreenContent } from "../screen.ts"
import type { SortState } from "../sort.ts"
import { readsOn, styledBlock, styledRow } from "../theme/apply.ts"
import type { Role } from "../theme/roles.ts"
import type { Slot, Theme } from "../theme/themes.ts"
import { breadcrumbFor, breadcrumbSegments, segmentsFor } from "./breadcrumb.ts"
import type { Frame } from "./frame.ts"
import { buildPanelRows, PANEL_WIDTH } from "./panel.ts"

/**
 * Columns reserved to the left of every row for the selection marker.
 *
 * Spent on every row, selected or not, so that selecting a row never shifts the table
 * sideways (FR-058).
 */
export const GUTTER = 2

/**
 * The width a view is composed at, given the columns inside the border.
 *
 * The ONE place the gutter is taken off. The key handler and the draw used to work this
 * out separately and got different answers: a movement key composed the screen two
 * columns wider than a background refresh did, so every keystroke shifted the table right
 * and the next refresh shifted it back, rewriting every row both times.
 */
export function viewWidthFor(contentWidth: number): number {
  return Math.max(20, contentWidth - GUTTER)
}

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
  /** Every source the screen shows is final, so the title bar says polling has stopped (FR-008). */
  final?: boolean
  /** A one-off confirmation, shown only when nothing is wrong. */
  notice: string | null
  /**
   * An already-composed screen, when the caller has one.
   *
   * The key handler composes the screen to learn how many rows the selection may move
   * over, and then the draw composed the very same screen a second time. Passing the
   * first one through halves that.
   */
  content?: ScreenContent
  /** When the most recent source last refreshed successfully, for the title bar clock. */
  lastSuccessAt?: string | null
  /** Whether the command palette is open, which renames the status bar's screen label. */
  paletteOpen?: boolean
}

export interface FrameState {
  breadcrumb: string
  warning: string | null
  /** What the warning row is showing: stale data, or a one-off confirmation. */
  warningKind: "stale" | "notice" | null
  /** The styled chrome, as rows to be drawn at the full terminal width. */
  titleRow: SemanticRow
  statusRow: SemanticRow
  warningRow: SemanticRow | null
  /** Full terminal width, which the chrome rows span. */
  width: number
  /** Plain text, one string per row, marker included. */
  lines: string[]
  /**
   * What each row is drawn with: its text plus its background slot. The frame redraws a
   * row only when this changes, so a row whose background moves while its text stays put
   * is still repainted, and a selection move still touches exactly two rows (T022).
   */
  keys: string[]
  /**
   * The same row, resolved against the theme, built on demand.
   *
   * A function rather than an array: the frame skips rows whose text is unchanged, and
   * styling a row it is about to skip is work thrown away. On a selection move that is
   * seventy-nine rows out of eighty-one.
   */
  styleRow: (index: number) => StyledText
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
  const viewWidth = viewWidthFor(inputs.contentWidth)

  const content =
    inputs.content ??
    composeScreen(db, nav.screen, {
      width: viewWidth,
      councilType: inputs.councilType,
      query: inputs.query,
      sort: inputs.sort,
      contentHeight: inputs.contentHeight,
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
  const lines = withSelection(content.lines, content.firstRow, selected)
  const backgrounds = rowBackgrounds(content.rows, selectedLine)

  // A real staleness warning always wins the row: it is the more important message.
  const warning = inputs.warning ?? inputs.notice
  const warningKind = inputs.warning !== null ? "stale" : inputs.notice !== null ? "notice" : null

  return {
    breadcrumb: breadcrumbFor(db, nav.screens, inputs.width),
    warning,
    warningKind,
    titleRow: titleBarRow(
      segmentsFor(db, nav.screens),
      // A failing source wins over finality: the stale badge stays global (contract § 2).
      inputs.warning !== null ? "stale" : inputs.final === true ? "final" : "live",
      inputs.lastSuccessAt ?? null,
      inputs.width,
    ),
    statusRow: statusBarRow(context, inputs.width, theme.label, inputs.paletteOpen === true),
    warningRow:
      warning === null
        ? null
        : { cells: [{ text: ` ${warning}`, ...WARNING_LOOK[warningKind ?? "notice"] }] },
    width: inputs.width,
    lines,
    keys: lines.map((line, index) => `${backgrounds[index] ?? "bg"}|${line}`),
    styleRow: (index: number) => {
      const row = content.rows[index]
      if (row === undefined) return styledRow({ cells: [] }, theme, viewWidth)
      return styledRow(
        index === selectedLine ? markSelected(row, theme) : row,
        theme,
        viewWidth,
        lead(index, content.firstRow, selected, content.rows.length),
        undefined,
        backgrounds[index],
        viewWidth + GUTTER,
      )
    },
    status: statusBarLine(context, inputs.width),
    offset: nav.ensureVisible(inputs.contentHeight, content.firstRow, content.lines.length),
    content,
  }
}

/** How the warning row reads: stale data on the warning colour, a notice on element. */
const WARNING_LOOK: Record<"stale" | "notice", { surface: Surface; role?: Cell["role"] }> = {
  stale: { surface: "warning", role: "warning" },
  notice: { surface: "element" },
}

/** The badge that opens the title bar. */
const APP_BADGE = " ◆ VOLBY "

/** `HH:MM:SS` in local time, or null when there is nothing to show. */
function clockOf(iso: string | null): string | null {
  if (iso === null) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((n) => String(n).padStart(2, "0"))
    .join(":")
}

/**
 * What the title bar says about the data on screen.
 *
 * `final` replaces the live claim once every source on screen is final and no longer
 * polled on its own (feature 003, FR-008). Its text carries the whole meaning, so it
 * reads the same without colour.
 */
export type LiveIndicator = "live" | "final" | "stale"

const INDICATOR_CELLS: Record<LiveIndicator, Cell> = {
  live: { text: " ● živě ", fgSlot: "success" },
  final: { text: " ■ konečné · obnova ručně ", role: "muted" },
  stale: { text: " ● ZASTARALÉ ", role: "warning", surface: "warning" },
}

/**
 * The title bar as styled cells (002 T034, FR-011, FR-012).
 *
 * The application badge, then the trail as joined segments: earlier levels on
 * `element`, the current one on `primary`. Each join is a `▌` in the colour of the
 * segment to its left over the background of the one to its right, so the segments read
 * as one shape with no special font. At the right end, the indicator (live, final, or
 * a warning badge while data is stale) and the time of the last successful refresh.
 * Nothing is fetched to show them (spec Assumptions).
 */
export function titleBarRow(
  trail: string[],
  indicator: LiveIndicator,
  lastSuccessAt: string | null,
  width: number,
): SemanticRow {
  const clock = clockOf(lastSuccessAt)
  const right: Cell[] = [
    INDICATOR_CELLS[indicator],
    ...(clock === null ? [] : [{ text: ` ${clock} `, role: "muted" } satisfies Cell]),
  ]

  const room = width - [...APP_BADGE].length - 1 - cellsWide(right)
  const kept = breadcrumbSegments(trail, Math.max(0, room))
  const left: Cell[] = [{ text: APP_BADGE, role: "accent", surface: "accent" }]
  let previous: Slot = "accent"
  kept.forEach((segment, index) => {
    const surface: Surface = index === kept.length - 1 ? "primary" : "element"
    left.push({ text: "▌", fgSlot: previous, surface })
    left.push(
      surface === "primary"
        ? { text: ` ${segment} `, role: "heading", surface }
        : { text: ` ${segment} `, surface },
    )
    previous = surface
  })
  left.push({ text: "▌", fgSlot: previous })

  const gap = Math.max(1, width - cellsWide(left) - cellsWide(right))
  return { cells: [...left, { text: " ".repeat(gap) }, ...right] }
}

/**
 * The background each row is painted with (FR-015 to FR-017, data-model.md § Row
 * background), in one pass so a long table costs one walk rather than one per row.
 *
 * In order: the selected row, a table header, then data rows striped by their position
 * since the most recent header, counting from 0 so the first sits on the base. Decided
 * here rather than in the views, so every table is striped by the same rule.
 */
export function rowBackgrounds(rows: SemanticRow[], selectedLine: number): Slot[] {
  let position = 0
  return rows.map((row, index) => {
    if (row.kind === "header") position = 0
    const stripe = row.kind === "data" && position++ % 2 === 1
    if (index === selectedLine) return "sel"
    if (row.kind === "header") return "element"
    return stripe ? "zebra" : "bg"
  })
}

/**
 * The selected row reads in the selection colour, which is chosen to contrast with the
 * selection background. A figure that rose or fell keeps its own colour only while that
 * colour still reads there (research R2); its ▲ or ▼ says it either way.
 */
function markSelected(row: SemanticRow, theme: Theme): SemanticRow {
  const keeps = (role: Role | undefined) =>
    (role === "increase" || role === "decrease") && readsOn(theme, role, "sel")
  return {
    ...row,
    role: "selection",
    cells: row.cells.map((c) => (keeps(c.role) ? c : { ...c, role: "selection" })),
  }
}

/**
 * The theme each frame was last drawn with.
 *
 * A theme switch changes how rows look without changing a character of their text, so
 * the row-level skip would keep the old colours. Tracked per frame rather than globally
 * because tests build several.
 */
const lastTheme = new WeakMap<Frame, Theme>()

/**
 * Puts the state on screen. Nothing here decides anything; it only applies.
 *
 * With a theme, the chrome is drawn styled and every surface repainted when the theme
 * changes, in the same frame as the rows (FR-027). Without one - tests that care only
 * about text - the chrome is drawn as plain text.
 */
export function applyFrameState(frame: Frame, state: FrameState, theme?: Theme): void {
  if (theme !== undefined) {
    if (lastTheme.get(frame) !== theme) {
      frame.invalidateRows()
      frame.applyTheme(theme)
      lastTheme.set(frame, theme)
    }
    const chrome = (row: SemanticRow, bg: Slot) => styledRow(row, theme, state.width, "", undefined, bg)
    frame.setBreadcrumb(chrome(state.titleRow, "panel"))
    frame.setStatus(chrome(state.statusRow, "panel"))
    frame.setWarning(
      state.warningRow === null
        ? null
        : chrome(state.warningRow, state.warningKind === "stale" ? "warning" : "element"),
      state.warningKind === "stale" ? "warning" : "element",
    )
  } else {
    frame.setBreadcrumb(state.breadcrumb)
    frame.setStatus(state.status)
    frame.setWarning(state.warning)
  }
  // The keys are the plain lines plus each row's background: the selection marker is part
  // of the text, so a selection move changes exactly the two rows it affects.
  frame.setRows(state.keys, state.styleRow)
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
