/**
 * The framed regions (tasks T119, T032, FR-054, 002 FR-009, FR-010).
 *
 * Four regions the user can always find: a title bar carrying the breadcrumb, the
 * content area, and a status bar listing the actions available here, plus the watchlist
 * side panel beside the content when it is open and there is room (FR-056, FR-057).
 *
 * The regions are told apart by SURFACE rather than by a box drawn round the content
 * (002 research R5): the title and status bars sit on the panel tone, the content on the
 * base tone with a heavy rail down its left edge, and the side panel on the panel tone
 * behind a rail of its own. Each bar is a box painted in its tone with its text inside,
 * because a text background covers only the cells that hold glyphs (research R1).
 *
 * The regions are created ONCE and only their contents change. That is what FR-058
 * requires: a refresh may change the figures inside a region but must never move the
 * regions, the scroll position or the selection. Rebuilding the tree on every draw would
 * break that guarantee in a way no amount of care elsewhere could restore.
 *
 * Chrome costs three rows at 80 by 24 - breadcrumb, a padding row above the content,
 * status bar - which leaves twenty-one for content. The warning row is created with zero
 * height and grows only when there is something to warn about, so a healthy run does not
 * pay for it (FR-041).
 */

import {
  BoxRenderable,
  type CliRenderer,
  type MouseEvent,
  type Renderable,
  type RGBA,
  ScrollBoxRenderable,
  type StyledText,
  TextRenderable,
} from "@opentui/core"
import { slotColor, TRANSPARENT } from "../theme/apply.ts"
import type { Slot, Theme } from "../theme/themes.ts"
import { PANEL_COST, PANEL_WIDTH } from "./panel.ts"

/** The vertical scroll bar overlays the last column of the viewport. */
const SCROLLBAR_WIDTH = 1

/** The rail down the content's left edge. */
const RAIL_WIDTH = 1

/** The empty row between the title bar and the first content row, as in the mock. */
const TOP_PADDING = 1

/** A bar painted in its own tone, holding its text. */
function bar(renderer: CliRenderer, height: number): { box: BoxRenderable; text: TextRenderable } {
  const box = new BoxRenderable(renderer, { height, flexShrink: 0, flexDirection: "row" })
  const text = new TextRenderable(renderer, { content: "", flexGrow: 1 })
  box.add(text)
  return { box, text }
}

export class Frame {
  readonly root: BoxRenderable
  readonly titleBar: TextRenderable
  readonly warningBar: TextRenderable
  readonly body: BoxRenderable
  readonly scroll: ScrollBoxRenderable
  readonly panel: BoxRenderable
  readonly statusBar: TextRenderable

  private readonly titleBox: BoxRenderable
  private readonly warningBox: BoxRenderable
  private readonly statusBox: BoxRenderable
  private readonly panelText: TextRenderable
  /** What OpenTUI draws before any theme is applied, restored when colour goes away. */
  private readonly defaults: { rail: RGBA; panelRail: RGBA; thumb: RGBA }
  /** One renderable per content row, reused between draws rather than rebuilt. */
  private rowNodes: TextRenderable[] = []
  /** How many pooled rows currently carry content. */
  private visibleRows = 0
  /** What each pooled row was last drawn with, so an unchanged row can be skipped. */
  private rowKeys: (string | undefined)[] = []
  private panelVisible = false
  /** The theme the surfaces were last painted with, for the warning row's tone. */
  private theme: Theme | null = null
  private rowHandler: ((index: number, event: MouseEvent) => void) | null = null

  constructor(private readonly renderer: CliRenderer) {
    this.root = new BoxRenderable(renderer, { flexDirection: "column", flexGrow: 1 })

    const title = bar(renderer, 1)
    this.titleBox = title.box
    this.titleBar = title.text
    // Height zero until there is a warning: an empty row would cost the content area a
    // line for nothing, and at 24 rows every line is spent.
    const warning = bar(renderer, 0)
    this.warningBox = warning.box
    this.warningBar = warning.text

    this.body = new BoxRenderable(renderer, {
      flexDirection: "row",
      flexGrow: 1,
      border: ["left"],
      borderStyle: "heavy",
      paddingTop: TOP_PADDING,
    })

    this.scroll = new ScrollBoxRenderable(renderer, {
      flexGrow: 1,
      scrollY: true,
      scrollX: false,
      // The district list runs to hundreds of councils. A real viewport culls what is
      // off screen rather than the application slicing an array by hand (research R11).
      viewportCulling: true,
      contentOptions: { flexDirection: "column" },
    })

    this.panel = new BoxRenderable(renderer, {
      flexDirection: "column",
      width: PANEL_WIDTH,
      flexShrink: 0,
      border: ["left"],
      borderStyle: "heavy",
    })
    this.panelText = new TextRenderable(renderer, { content: "" })
    this.panel.add(this.panelText)

    const status = bar(renderer, 1)
    this.statusBox = status.box
    this.statusBar = status.text

    // Pinned visible rather than left to appear when content overflows, for two
    // reasons. It toggles the content width, which moves the table under the user as
    // rows arrive (FR-058). And the bar lays itself out on the WRONG EDGE when it is
    // hidden and shown again - going from the district list into one district and then
    // into a council drew it down the left of the content. A bar that is always there
    // is both steadier and correct.
    this.scroll.verticalScrollBar.visible = true

    this.defaults = {
      rail: this.body.borderColor,
      panelRail: this.panel.borderColor,
      thumb: this.scroll.verticalScrollBar.slider.foregroundColor,
    }

    this.body.add(this.scroll)
    this.root.add(this.titleBox)
    this.root.add(this.warningBox)
    this.root.add(this.body)
    this.root.add(this.statusBox)
  }

  /**
   * Adds a region drawn OVER the content area when shown, such as the command palette.
   *
   * Placed inside the body and positioned absolutely by the caller, so it covers the
   * content without taking any of its layout: the content stays exactly where it was,
   * visible beneath (002 research R7). Added once and toggled, never added and removed:
   * swapping children of the body is what put the scroll bar on the wrong edge.
   */
  attachOverlay(node: Renderable): void {
    this.body.add(node)
  }

  /**
   * Withholds the content rows while an overlay covers them, for monochrome only.
   *
   * With colour, the overlay dims the content and the palette's own surface covers it.
   * Without colour nothing can be painted, and a space written with no background does
   * not clear the character beneath it, so the content would read through the palette.
   * Hiding the rows' container leaves the rail, the scroll bar and every region where they
   * were; the next draw restores the scroll position.
   */
  setContentHidden(hidden: boolean): void {
    this.scroll.content.visible = !hidden
  }

  /** Adds the frame to a parent, usually `renderer.root`. */
  attach(parent: { add: (child: Renderable) => number }): void {
    parent.add(this.root)
  }

  setBreadcrumb(content: string | StyledText): void {
    this.titleBar.content = content
  }

  setStatus(content: string | StyledText): void {
    this.statusBar.content = content
  }

  /**
   * Paints every surface from the theme (002 T032, FR-009, FR-010).
   *
   * The content rail takes `primary` and the side panel's rail `accent`; the scroll bar
   * track takes `track` and its thumb `muted`. A theme that asks for no colour paints no
   * surface, and hands the rails and the thumb back to OpenTUI's own colours rather than
   * guessing at the terminal's: a colour guessed wrong can be invisible.
   *
   * Border colours are set only on boxes that HAVE a border. Setting one on a borderless
   * box switches on a border on all four sides (research R5).
   */
  applyTheme(theme: Theme): void {
    this.theme = theme
    const paint = (slot: Slot) => slotColor(theme, slot) ?? TRANSPARENT
    this.root.backgroundColor = paint("bg")
    this.titleBox.backgroundColor = paint("panel")
    this.statusBox.backgroundColor = paint("panel")
    this.warningBox.backgroundColor = paint("warning")
    this.body.backgroundColor = paint("bg")
    this.panel.backgroundColor = paint("panel")
    this.body.borderColor = slotColor(theme, "primary") ?? this.defaults.rail
    this.panel.borderColor = slotColor(theme, "accent") ?? this.defaults.panelRail
    const slider = this.scroll.verticalScrollBar.slider
    slider.backgroundColor = paint("track")
    slider.foregroundColor = slotColor(theme, "muted") ?? this.defaults.thumb
  }

  /**
   * Shows a warning, or hides the row entirely when there is none.
   *
   * `tone` is the surface the row sits on: `warning` for stale data, `element` for a
   * one-off confirmation, which is news rather than a problem.
   */
  setWarning(content: string | StyledText | null, tone: Slot = "warning"): void {
    const empty = content === null || content === ""
    this.warningBar.content = content ?? ""
    this.warningBox.height = empty ? 0 : 1
    if (this.theme !== null) this.warningBox.backgroundColor = slotColor(this.theme, tone) ?? TRANSPARENT
  }

  /** Shows or hides the side panel (FR-056). */
  setPanelVisible(visible: boolean): void {
    if (visible === this.panelVisible) return
    this.panelVisible = visible
    if (visible) this.body.add(this.panel)
    else this.body.remove(this.panel)
  }

  get panelIsVisible(): boolean {
    return this.panelVisible
  }

  /** The panel is one text object, so it takes one block rather than a row each. */
  setPanelContent(content: string | StyledText): void {
    this.panelText.content = content
  }

  /**
   * Replaces the content rows, TOUCHING ONLY THE ONES THAT CHANGED.
   *
   * Moving the selection one row changes two rows out of eighty. Rewriting all eighty
   * cost a native text-buffer rebuild and a layout invalidation each, on every single
   * keystroke, which is what made holding an arrow key feel like wading. Each row keeps
   * the key it was last drawn with and is left alone when the key is unchanged.
   *
   * The key must capture everything that can change a row's APPEARANCE, not only its
   * text. The selection marker is part of the text, so moving the selection changes the
   * keys of exactly the two affected rows. A theme switch changes no text at all, so
   * `invalidateRows` exists for it.
   *
   * The pool of row renderables only ever GROWS. Rows beyond the current view are hidden
   * rather than destroyed, for two reasons:
   *
   *   - Removing children and adding them back again leaves the scroll bar laid out on
   *     the wrong edge. Shrinking below the viewport and growing past it again - going
   *     from the district list to one district and then into a council does exactly
   *     that - drew the bar down the LEFT of the content.
   *   - Creating and destroying several hundred renderables on every tick would cost
   *     more than the whole recomposition budget (SC-010).
   *
   * `content` is a function rather than an array so that the caller need not build the
   * styled form of a row it is not going to use.
   */
  setRows(keys: string[], content?: (index: number) => string | StyledText): void {
    const render = content ?? ((index: number) => keys[index] ?? "")
    this.growRows(keys.length)

    for (let index = 0; index < this.rowNodes.length; index += 1) {
      const node = this.rowNodes[index]
      if (node === undefined) continue
      const key = keys[index]

      if (key === undefined) {
        // Past the end of the view. Hide it once, then leave it alone.
        if (this.rowKeys[index] === undefined) continue
        node.content = ""
        node.height = 0
        node.visible = false
        this.rowKeys[index] = undefined
        continue
      }

      if (this.rowKeys[index] === key) continue

      node.content = render(index)
      if (!node.visible) {
        node.height = 1
        node.visible = true
      }
      this.rowKeys[index] = key
    }

    this.visibleRows = keys.length
  }

  /**
   * Forces every row to be redrawn on the next update.
   *
   * For a change that alters how rows LOOK without altering their text, which in practice
   * means switching the theme.
   */
  invalidateRows(): void {
    this.rowKeys = []
  }

  /**
   * Routes clicks on any content row to one handler, by row index (T156).
   *
   * Set once and applied to every row the pool ever grows, so the handler is not
   * reassigned to several hundred renderables on every refresh. OpenTUI routes a click
   * through the rendered cell bounds, so there is no hit-testing to do here (research
   * R15).
   */
  setRowHandler(handler: (index: number, event: MouseEvent) => void): void {
    this.rowHandler = handler
    this.rowNodes.forEach((node, index) => {
      this.bindRow(node, index)
    })
  }

  private bindRow(node: TextRenderable, index: number): void {
    node.onMouseDown = (event: MouseEvent) => this.rowHandler?.(index, event)
  }

  /** The row renderables currently showing content, in display order. */
  get rows(): TextRenderable[] {
    return this.rowNodes.slice(0, this.visibleRows)
  }

  /** How many rows of content the terminal currently affords. */
  get contentHeight(): number {
    // The body's first row is the padding under the title bar.
    return Math.max(0, this.body.height - TOP_PADDING)
  }

  /**
   * Columns a content row may use.
   *
   * The rail costs one column, the side panel its width, and the scroll bar one:
   * the bar draws over the last column of the viewport rather than beside it, so a row
   * written to the full width loses its final character underneath it.
   */
  get contentWidth(): number {
    return Math.max(0, this.rawContentWidth - (this.panelVisible ? PANEL_COST : 0))
  }

  /** What the content area would have if the panel were closed, for the fit rule. */
  get rawContentWidth(): number {
    return Math.max(0, this.body.width - RAIL_WIDTH - SCROLLBAR_WIDTH)
  }

  private growRows(count: number): void {
    while (this.rowNodes.length < count) {
      const node = new TextRenderable(this.renderer, { content: "", height: 1, flexShrink: 0 })
      this.bindRow(node, this.rowNodes.length)
      this.rowNodes.push(node)
      this.scroll.add(node)
    }
  }

  destroy(): void {
    this.root.destroy()
  }
}
