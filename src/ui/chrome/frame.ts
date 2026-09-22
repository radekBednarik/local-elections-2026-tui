/**
 * The framed regions (task T119, FR-054).
 *
 * Three regions the user can always find: a title bar carrying the breadcrumb, a
 * bordered content area, and a status bar listing the actions available here. A fourth,
 * the watchlist side panel, sits beside the content area when it is open and there is
 * room (FR-056, FR-057).
 *
 * The regions are created ONCE and only their contents change. That is what FR-058
 * requires: a refresh may change the figures inside a region but must never move the
 * regions, the scroll position or the selection. Rebuilding the tree on every draw would
 * break that guarantee in a way no amount of care elsewhere could restore.
 *
 * Chrome costs four rows at 80 by 24 - breadcrumb, two borders, status bar - which
 * leaves twenty for content. The warning row is created with zero height and grows only
 * when there is something to warn about, so a healthy run does not pay for it (FR-041).
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
import { PANEL_COST, PANEL_WIDTH } from "./panel.ts"

/** The vertical scroll bar overlays the last column of the viewport. */
const SCROLLBAR_WIDTH = 1

export class Frame {
  readonly root: BoxRenderable
  readonly titleBar: TextRenderable
  readonly warningBar: TextRenderable
  readonly body: BoxRenderable
  readonly scroll: ScrollBoxRenderable
  readonly panel: BoxRenderable
  readonly statusBar: TextRenderable

  private readonly panelText: TextRenderable
  /** One renderable per content row, reused between draws rather than rebuilt. */
  private rowNodes: TextRenderable[] = []
  /** How many pooled rows currently carry content. */
  private visibleRows = 0
  /** What each pooled row was last drawn with, so an unchanged row can be skipped. */
  private rowKeys: (string | undefined)[] = []
  private panelVisible = false
  private rowHandler: ((index: number, event: MouseEvent) => void) | null = null
  private overlay: (Renderable & { visible: boolean }) | null = null

  constructor(private readonly renderer: CliRenderer) {
    this.root = new BoxRenderable(renderer, { flexDirection: "column", flexGrow: 1 })

    this.titleBar = new TextRenderable(renderer, { content: "", height: 1, flexShrink: 0 })
    // Height zero until there is a warning: an empty row would cost the content area a
    // line for nothing, and at 24 rows every line is spent.
    this.warningBar = new TextRenderable(renderer, { content: "", height: 0, flexShrink: 0 })

    this.body = new BoxRenderable(renderer, {
      flexDirection: "row",
      flexGrow: 1,
      border: true,
      borderStyle: "single",
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
      borderStyle: "single",
    })
    this.panelText = new TextRenderable(renderer, { content: "" })
    this.panel.add(this.panelText)

    this.statusBar = new TextRenderable(renderer, { content: "", height: 1, flexShrink: 0 })

    // Pinned visible rather than left to appear when content overflows, for two
    // reasons. It toggles the content width, which moves the table under the user as
    // rows arrive (FR-058). And the bar lays itself out on the WRONG EDGE when it is
    // hidden and shown again - going from the district list into one district and then
    // into a council drew it down the left of the content. A bar that is always there
    // is both steadier and correct.
    this.scroll.verticalScrollBar.visible = true

    this.body.add(this.scroll)
    this.root.add(this.titleBar)
    this.root.add(this.warningBar)
    this.root.add(this.body)
    this.root.add(this.statusBar)
  }

  /**
   * Adds a region that takes the whole content area when shown, such as the command
   * palette. Added once and toggled, never added and removed: swapping children of the
   * body is what put the scroll bar on the wrong edge.
   */
  attachOverlay(node: Renderable & { visible: boolean }): void {
    this.overlay = node
    this.root.add(node)
  }

  /**
   * Shows either the content area or the overlay.
   *
   * The regions above and below are untouched, so the breadcrumb and the status bar stay
   * exactly where they were while the palette is open (FR-054).
   */
  setContentVisible(visible: boolean): void {
    this.body.visible = visible
    this.body.flexGrow = visible ? 1 : 0
    // "auto" hands the row back to flex; a fixed 0 is what collapses it.
    this.body.height = visible ? "auto" : 0
    if (this.overlay === null) return
    this.overlay.visible = !visible
  }

  /** Adds the frame to a parent, usually `renderer.root`. */
  attach(parent: { add: (child: Renderable) => number }): void {
    parent.add(this.root)
  }

  setBreadcrumb(text: string): void {
    this.titleBar.content = text
  }

  setStatus(text: string): void {
    this.statusBar.content = text
  }

  /**
   * Colours the borders from the theme (T136).
   *
   * The borders are the one part of the frame the role system did not reach: they were
   * drawn in the layout engine's own default grey whatever theme was chosen. They take
   * the `muted` role, which is what they are.
   *
   * A theme that asks for no colour leaves them to the default rather than pinning a
   * value. Pinning one would mean guessing whether the user's terminal is light or dark,
   * and a border guessed wrong is invisible - worse than a border that is merely not
   * themed.
   */
  setBorderColor(color: RGBA | undefined): void {
    if (color === undefined) return
    this.body.borderColor = color
    this.panel.borderColor = color
  }

  /** Shows a warning, or hides the row entirely when there is none. */
  setWarning(text: string | null): void {
    this.warningBar.content = text ?? ""
    this.warningBar.height = text === null || text === "" ? 0 : 1
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
    // Two of the body's rows are its own border.
    return Math.max(0, this.body.height - 2)
  }

  /**
   * Columns a content row may use.
   *
   * The body's own border costs two, the side panel its width, and the scroll bar one:
   * the bar draws over the last column of the viewport rather than beside it, so a row
   * written to the full width loses its final character underneath it.
   */
  get contentWidth(): number {
    return Math.max(0, this.rawContentWidth - (this.panelVisible ? PANEL_COST : 0))
  }

  /** What the content area would have if the panel were closed, for the fit rule. */
  get rawContentWidth(): number {
    return Math.max(0, this.body.width - 2 - SCROLLBAR_WIDTH)
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
