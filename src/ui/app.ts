/**
 * Application shell (tasks T045, T049, T050, T053, T054, T061; reframed in T119-T122).
 *
 * Owns the renderer, the key map, navigation, and the background refresh loop.
 *
 * Four rules shape the design:
 *   - The renderer must be destroyed on EVERY exit path, or the terminal is left in raw
 *     mode with the alternate screen active (FR-006).
 *   - Fetching must never block input (SC-010), so refresh work runs as async tasks and
 *     one document is processed at a time with a yield between documents (research R8).
 *   - Councils are fetched ON DEMAND and unsubscribed when left (FR-018a). Roughly 6,000
 *     exist; subscribing to them all would breach the polling budget immediately.
 *   - The frame is built ONCE and only its contents change, so a refresh cannot move the
 *     regions, the scroll position or the selection (FR-058).
 */

import type { Database } from "bun:sqlite"
import { join } from "node:path"
import { type CliRenderer, createCliRenderer } from "@opentui/core"
import type { CliOptions } from "../config/args.ts"
import { reportForScreen } from "../export/report.ts"
import { csvForScreen } from "../export/tables.ts"
import { suggestFilename, writeExport } from "../export/writer.ts"
import type { Logger } from "../logging/logger.ts"
import { type FetchOutcome, fetchDocument } from "../sources/client.ts"
import { ingestCouncil, ingestDistrict, ingestNational } from "../sources/ingest.ts"
import type { Scheduler } from "../sources/scheduler.ts"
import { type SourceKey, type SourceLocation, urlForKey } from "../sources/urls.ts"
import { availableCouncilTypes } from "../storage/queries/national.ts"
import {
  readSidePanelOpen,
  readTheme,
  writeSidePanelOpen,
  writeTheme,
} from "../storage/queries/preferences.ts"
import { toggleWatchlist, watchedCodes } from "../storage/queries/watchlist.ts"
import { Frame } from "./chrome/frame.ts"
import { panelFits } from "./chrome/panel.ts"
import { applyFrameState, applyPanel, applyPlainLines, frameState, viewWidthFor } from "./chrome/state.ts"
import { allFinal, isTooSmall, staleWarning, tooSmallMessage } from "./components/status.ts"
import { type Intent, intentFor } from "./keymap.ts"
import { Navigation } from "./navigation.ts"
import { type ActionContext, type ActionId, themeOfAction } from "./palette/actions.ts"
import { Palette } from "./palette/view.ts"
import { composeScreen, type ScreenContent, shownSources, sourcesForScreen } from "./screen.ts"
import { applySearchKey, type KeyEvent } from "./search-input.ts"
import { nextSort, type SortState, UNSORTED } from "./sort.ts"
import { canDim } from "./theme/apply.ts"
import {
  type ColorEnvironment,
  isMonochrome,
  readColorEnvironment,
  resolveTheme,
  withCapabilities,
} from "./theme/detect.ts"
import { nextTheme, type Theme, type ThemeName, themeLabel } from "./theme/themes.ts"

/** How close two clicks on one row must be to count as a double click. */
const DOUBLE_CLICK_MS = 400

/** Rows the wheel moves per notch. */
const WHEEL_ROWS = 3

export interface AppDependencies {
  db: Database
  options: CliOptions
  log: Logger
  scheduler: Scheduler
}

export class App {
  private renderer: CliRenderer | null = null
  private frame: Frame | null = null
  private palette: Palette | null = null
  /** The theme the palette was last painted with, so a switch repaints it once. */
  private paletteTheme: Theme | null = null
  /** Whether the user WANTS the panel. Whether it fits is decided every draw (FR-057). */
  private sidePanelOpen = true
  /** The last row clicked and when, so a second click on it counts as a double (T157). */
  private lastClick: { row: number; at: number } | null = null
  private loop: ReturnType<typeof setInterval> | null = null
  private readonly abort = new AbortController()
  private readonly nav = new Navigation()
  private query = ""
  /** One-off confirmation line, cleared on the next key press. */
  private notice: string | null = null
  private councilType = "OBEC"
  /**
   * The sort the user has applied, reset when they move to another screen.
   *
   * Per screen rather than global: a column index means a different column on every
   * table, so carrying one across a navigation would sort by something arbitrary.
   */
  private sort: SortState = UNSORTED
  /** Every district code, loaded once at start, for what the district list shows. */
  private districts: string[] = []
  private stopped = false
  /**
   * The chosen theme, or null when none was stored and detection should decide.
   *
   * Held separately from the resolved theme because "no colour available" outranks a
   * stored preference: the name is what the user picked, the theme is what the terminal
   * can actually show (FR-061, FR-063).
   */
  private themeName: ThemeName | null = null
  private colorEnvironment: ColorEnvironment = readColorEnvironment()

  constructor(private readonly deps: AppDependencies) {}

  private get location(): SourceLocation {
    return {
      baseUrl: this.deps.options.baseUrl,
      election: this.deps.options.election,
      date: this.deps.options.date,
    }
  }

  async start(): Promise<void> {
    const renderer = await createCliRenderer({
      exitOnCtrlC: false,
      // OpenTUI opens and FOCUSES a console overlay on an unhandled error by default,
      // and that overlay attaches stdin - so an error the user cannot even see the cause
      // of leaves them unable to close it or to quit. Everything this application has to
      // say already goes to the log file (src/logging/logger.ts), so the overlay can only
      // cost the user their terminal.
      consoleMode: "disabled",
      openConsoleOnError: false,
      // 30 is the default, and 30 frames means up to 33 ms between a key press and the
      // cursor moving - enough to feel like lag when a key is held down. Rendering is on
      // demand, so a higher ceiling costs nothing on a still screen.
      targetFps: 60,
    })
    this.renderer = renderer

    const frame = new Frame(renderer)
    frame.attach(renderer.root)
    this.frame = frame

    const palette = new Palette(renderer)
    frame.attachOverlay(palette.root)
    this.palette = palette
    // Typing narrows the list. Driven from the input's own event, so the palette and
    // the key handler never both try to own a keystroke.
    palette.input.on("input", () => {
      palette.refresh(this.actionContext(this.currentContent()))
      this.draw()
    })

    renderer.keyInput.on("keypress", (key: KeyEvent) => {
      void this.onKey(key)
    })
    renderer.on("resize", () => {
      this.draw()
    })

    // Mouse is optional throughout: everything below has a key, and the application is
    // fully usable in a terminal with no mouse support at all (FR-078).
    frame.setRowHandler((index) => {
      this.onRowClick(index)
    })
    frame.scroll.onMouseScroll = (event) => {
      this.onWheel(event)
    }

    // Nothing should reach here now that the refresh loop guards itself, but an
    // unhandled rejection must leave a trace in the log rather than vanishing, since the
    // console overlay that used to show it is deliberately gone.
    process.on("unhandledRejection", (reason) => {
      this.deps.log.error("Neošetřené odmítnutí příslibu", reason)
    })
    process.on("uncaughtException", (error) => {
      this.deps.log.error("Neošetřená výjimka", error)
    })

    const shutdown = () => {
      this.stop()
    }
    process.once("SIGINT", shutdown)
    process.once("SIGTERM", shutdown)

    this.themeName = readTheme(this.deps.db)
    this.sidePanelOpen = readSidePanelOpen(this.deps.db)
    // The renderer knows what the terminal reported about itself; without colour support
    // the monochrome path is taken whatever the stored preference says.
    this.colorEnvironment = {
      ...this.colorEnvironment,
      ansi256: renderer.capabilities?.ansi256 ?? null,
      rgb: renderer.capabilities?.rgb ?? null,
      reportedScheme: renderer.themeMode ?? null,
    }
    // The terminal's report settles over the first few seconds (research R8). When it
    // changes what the terminal can show, the theme is resolved again and every region
    // repainted with it, in one draw (T064).
    renderer.on("capabilities", () => {
      this.colorEnvironment = withCapabilities(this.colorEnvironment, renderer.capabilities)
      this.draw()
    })

    this.subscribeDistricts()
    this.syncSubscriptions()
    this.draw()
    void this.tick()
    this.loop = setInterval(() => {
      void this.tick()
    }, 1000)
  }

  /** Destroys the renderer and stops the loop. Safe to call more than once. */
  stop(): void {
    if (this.stopped) return
    this.stopped = true
    if (this.loop !== null) clearInterval(this.loop)
    this.abort.abort()
    this.renderer?.destroy()
    this.renderer = null
    this.frame = null
    this.palette = null
  }

  /**
   * Subscribes to every district at startup (FR-018, T053).
   *
   * The whole set is retrieved in the background so drilling into any district shows
   * data immediately. The scheduler spreads them, so this is a steady trickle rather
   * than 78 simultaneous requests.
   */
  private subscribeDistricts(): void {
    const districts = this.deps.db.query("SELECT nuts FROM district ORDER BY nuts").all() as {
      nuts: string
    }[]
    this.districts = districts.map((d) => d.nuts)
    if (districts.length === 0) return
    this.deps.scheduler.subscribeAll(
      this.districts.map((nuts) => ({
        key: `district:${nuts}` as SourceKey,
        areaKind: "district",
        areaId: nuts,
      })),
    )
    this.deps.log.info("Okresy přihlášeny k odběru", { count: districts.length })
  }

  /**
   * Subscribes to what the current screen needs and drops what it no longer does.
   *
   * A council left behind is unsubscribed unless it is pinned to the watchlist or final,
   * which is what keeps the polling set bounded (FR-018a, research R5).
   */
  private syncSubscriptions(): void {
    const { scheduler, db } = this.deps
    const needed = new Set(sourcesForScreen(this.nav.screen).map((s) => s.key as SourceKey))

    for (const source of sourcesForScreen(this.nav.screen)) {
      scheduler.subscribeAll([
        { key: source.key as SourceKey, areaKind: source.areaKind, areaId: source.areaId },
      ])
    }

    // A watched council keeps polling even when it is nowhere on screen, which is the
    // whole point of the watchlist (FR-039 with FR-018a).
    for (const code of watchedCodes(db)) {
      const key = `council:${code}` as SourceKey
      needed.add(key)
      scheduler.subscribeAll([{ key, areaKind: "council", areaId: code }])
      scheduler.setPinned(key, true)
    }

    scheduler.releaseCouncils(needed)
  }

  private async onKey(key: KeyEvent): Promise<void> {
    // A confirmation only survives until the next keystroke.
    this.notice = null

    const intent = intentFor(key)
    if (intent?.kind === "force-quit") {
      this.stop()
      return
    }

    if (this.palette?.open === true) {
      await this.onPaletteKey(this.palette, key, intent)
      return
    }

    // The search box owns letter keys while it has focus, or the user could never type
    // a name containing "q".
    if (this.nav.screen.kind === "search" && this.handleSearchKey(key)) {
      this.draw()
      return
    }

    if (intent === null) return

    const content = this.currentContent()

    if (intent.kind === "move") {
      this.nav.move(intent.delta, content.rowCount)
      // Moving the selection changes no data, so the screen just composed is still
      // current and is drawn rather than composed again.
      this.draw(content)
      return
    }

    if (intent.kind === "jump") {
      this.nav.moveTo(intent.to, content.rowCount)
      this.draw(content)
      return
    }

    await this.perform(intent.id, content)
    this.draw()
  }

  /**
   * Keys while the palette is open.
   *
   * Esc, Enter and the arrows are the palette's; everything else falls through to the
   * focused input, which is doing the typing. Returning early rather than handling the
   * rest here is what stops two key handlers fighting over the same keystroke.
   */
  private async onPaletteKey(palette: Palette, key: KeyEvent, intent: Intent | null): Promise<void> {
    const name = key.name ?? ""

    if (name === "escape") {
      // Esc returns to exactly the screen and selection the user left (FR-068).
      this.closePalette(palette)
      this.draw()
      return
    }

    if (name === "return" || name === "enter") {
      const action = palette.chosen()
      this.closePalette(palette)
      if (action === null) {
        // The highlighted entry does nothing here. Say so rather than closing silently.
        this.notice = "Tento příkaz zde není dostupný."
      } else {
        await this.perform(action.id, this.currentContent())
      }
      this.draw()
      return
    }

    if (intent?.kind === "move") {
      palette.move(intent.delta < 0 ? -1 : 1)
      this.draw()
      return
    }

    // Anything else is typing. The input has focus and will take it; the palette
    // re-filters from its INPUT event.
  }

  /**
   * Performs one action, whatever asked for it.
   *
   * The key map and the command palette both arrive here, so an action behaves the same
   * way however it was reached (FR-068).
   */
  private async perform(id: ActionId, content: ScreenContent): Promise<void> {
    switch (id) {
      case "move":
        // Movement comes from the arrows, not from the registry entry that describes it.
        break
      case "open":
        this.open(content)
        break
      case "back":
        if (this.nav.pop()) {
          this.sort = UNSORTED
          this.syncSubscriptions()
        }
        break
      case "search":
        this.query = ""
        this.sort = UNSORTED
        this.nav.push({ kind: "search" })
        break
      case "watch":
        this.toggleWatch()
        break
      case "watchlist":
        this.sort = UNSORTED
        this.nav.push({ kind: "watchlist" })
        this.syncSubscriptions()
        break
      case "export-csv":
        await this.exportCurrent(false)
        break
      case "export-report":
        await this.exportCurrent(true)
        break
      case "council-type":
        this.cycleCouncilType()
        break
      case "sort":
        this.sort = nextSort(this.sort, content.sortableColumns)
        break
      case "refresh":
        await this.refreshNow()
        break
      case "palette":
        this.openPalette(content)
        break
      case "side-panel":
        this.toggleSidePanel()
        break
      case "theme":
        this.cycleTheme()
        break
      case "help":
        if (this.nav.screen.kind !== "help") {
          this.sort = UNSORTED
          this.nav.push({ kind: "help" })
        }
        break
      case "quit":
        this.stop()
        break
      default: {
        // One palette entry per theme (002 FR-005), all performing the same thing.
        const theme = themeOfAction(id)
        if (theme !== null) this.setTheme(theme)
      }
    }
  }

  private openPalette(content: ScreenContent): void {
    if (this.palette === null) return
    this.palette.show(this.actionContext(content))
    // Where the content cannot be dimmed - no colour, or only 256 - it is withheld instead.
    if (!canDim(this.theme)) this.frame?.setContentHidden(true)
  }

  private closePalette(palette: Palette): void {
    palette.hide()
    this.frame?.setContentHidden(false)
  }

  /**
   * Shows or hides the side panel, remembering the choice (FR-056).
   *
   * Only the user's intent is stored. Whether it is actually on screen also depends on
   * whether it fits, which is decided every draw and is not a preference.
   */
  private toggleSidePanel(): void {
    this.sidePanelOpen = !this.sidePanelOpen
    writeSidePanelOpen(this.deps.db, this.sidePanelOpen)
    if (this.sidePanelOpen && this.frame !== null && !panelFits(this.frame.rawContentWidth)) {
      this.notice = "Panel se zobrazí, až bude okno širší."
    }
  }

  /** What the action registry needs to judge which actions apply here (FR-064). */
  private actionContext(content: ScreenContent): ActionContext {
    return {
      screen: this.nav.screen,
      depth: this.nav.depth,
      rowCount: content.rowCount,
      councilTypes: availableCouncilTypes(this.deps.db).length,
      searchActive: this.nav.screen.kind === "search",
      sortableColumns: content.sortableColumns,
      activeTheme: this.themeName ?? this.theme.name,
    }
  }

  /**
   * A click on a content row (T156, T157, FR-075).
   *
   * The first click selects; a second on the same row within the double-click window
   * opens it, which is exactly what Enter does. Nothing is reachable this way that a key
   * cannot reach.
   */
  private onRowClick(index: number): void {
    const content = this.currentContent()
    const row = index - content.firstRow
    if (row < 0 || row >= content.rowCount) return

    const now = Date.now()
    const isDouble =
      this.lastClick !== null && this.lastClick.row === row && now - this.lastClick.at <= DOUBLE_CLICK_MS

    this.notice = null
    this.nav.current.selected = row
    this.lastClick = isDouble ? null : { row, at: now }
    if (isDouble) this.open(content)
    this.draw()
  }

  /**
   * The wheel scrolls the content area (T158, FR-076).
   *
   * Handled here rather than left to the scroll box, because the scroll position lives
   * on the navigation entry - that is what makes it survive a refresh (FR-058) - and a
   * position the viewport changed behind our back would be overwritten on the next draw.
   */
  private onWheel(event: { scroll?: { direction: string } }): void {
    const frame = this.frame
    if (frame === null) return
    const direction = event.scroll?.direction
    if (direction !== "up" && direction !== "down") return

    const content = this.currentContent()
    const entry = this.nav.current
    const height = Math.max(1, frame.contentHeight)
    const limit = Math.max(0, content.lines.length - height)
    entry.offset = Math.min(
      limit,
      Math.max(0, entry.offset + (direction === "up" ? -WHEEL_ROWS : WHEEL_ROWS)),
    )

    // The selection travels with the viewport rather than being left behind it. The
    // alternative is worse in both directions: leave the selection where it was and the
    // next draw drags the view back to it, or stop redrawing and the next refresh does
    // the same. Carrying it keeps Enter meaning "open the row you can see".
    if (content.rowCount > 0) {
      const lowest = Math.max(0, entry.offset - content.firstRow)
      const highest = Math.min(content.rowCount - 1, entry.offset + height - 1 - content.firstRow)
      entry.selected = Math.min(Math.max(highest, 0), Math.max(lowest, entry.selected))
    }

    this.draw()
  }

  /** Opens whatever the selected row leads to. */
  private open(content: ScreenContent): void {
    const target = content.target(this.nav.current.selected)
    if (target === null) return
    this.nav.push(target)
    this.sort = UNSORTED
    this.syncSubscriptions()
    // Fetch what the new screen needs straight away rather than waiting for the next
    // tick, so opening a council is not followed by a blank pause.
    void this.tick()
  }

  private toggleWatch(): void {
    // Only a council can be watched, and it is the screen the user is on.
    const screen = this.nav.screen
    if (screen.kind !== "council") {
      this.notice = "Sledovat lze pouze otevřené zastupitelstvo."
      return
    }
    const watched = toggleWatchlist(this.deps.db, screen.kodzastup)
    // Pinning is what keeps a watched council polling once the user navigates away
    // from it (FR-018a).
    this.deps.scheduler.setPinned(`council:${screen.kodzastup}` as SourceKey, watched)
    if (!watched) this.syncSubscriptions()
    this.notice = watched
      ? "Přidáno mezi sledovaná zastupitelstva."
      : "Odebráno ze sledovaných zastupitelstev."
  }

  /** The theme to render with, after the environment has had its say (FR-063). */
  private get theme(): Theme {
    return resolveTheme(this.themeName, this.colorEnvironment)
  }

  /**
   * Cycles dark, light, high contrast, and remembers the choice (FR-061).
   *
   * The preference is stored even when the terminal cannot show colour, so that a user
   * who sets a theme over SSH still has it when they come back on a terminal that can.
   */
  private cycleTheme(): void {
    this.setTheme(nextTheme(this.themeName ?? this.theme.name))
  }

  /** Applies a theme, remembers it, and says so (FR-005, FR-006). */
  private setTheme(name: ThemeName): void {
    this.themeName = name
    writeTheme(this.deps.db, name)
    this.notice = isMonochrome(this.theme)
      ? `Motiv: ${themeLabel(name)} (terminál nezobrazuje barvy)`
      : `Motiv: ${themeLabel(name)}`
  }

  private cycleCouncilType(): void {
    const types = availableCouncilTypes(this.deps.db)
    if (types.length <= 1) return
    const index = types.indexOf(this.councilType)
    this.councilType = types[(index + 1) % types.length] ?? "OBEC"
  }

  private async refreshNow(): Promise<void> {
    for (const source of sourcesForScreen(this.nav.screen)) {
      this.deps.scheduler.requestRefresh(source.key as SourceKey)
    }
    this.deps.scheduler.requestRefresh("national")
    await this.tick()
  }

  /** Delegates to the pure rules in search-input.ts. */
  private handleSearchKey(key: KeyEvent): boolean {
    const result = applySearchKey(this.query, key)
    if (!result.handled) return false
    this.query = result.query
    return true
  }

  /**
   * Exports the current screen (FR-049, FR-051).
   *
   * Runs off the key handler as an async task, so a large district never blocks the
   * interface while it is written (FR-052). Every failure becomes a notice rather than
   * an exception.
   */
  private async exportCurrent(asReport: boolean): Promise<void> {
    const screen = this.nav.screen
    const built = asReport
      ? reportForScreen(this.deps.db, screen)
      : csvForScreen(this.deps.db, screen, { councilType: this.councilType })

    if (built === null) {
      this.notice = asReport
        ? "Tuto obrazovku nelze exportovat jako souhrn."
        : "Na této obrazovce není tabulka k exportu."
      this.draw()
      return
    }

    const name = suggestFilename(built.areaLabel, asReport ? "txt" : "csv")
    const path = join(this.deps.options.exportDir, name)
    const result = await writeExport(path, built.content)

    this.notice = result.ok
      ? `Uloženo: ${result.path} (${result.bytes} B)`
      : `Export selhal: ${result.reason}`
    if (!result.ok) this.deps.log.warn("Export selhal", { reason: result.reason, path })
    this.draw()
  }

  private currentContent(): ScreenContent {
    return composeScreen(this.deps.db, this.nav.screen, {
      // The width frameState composes at. A screen composed here and drawn there used to
      // be laid out two columns wider than one a refresh composed, so the table jumped.
      width: viewWidthFor(this.contentWidth()),
      councilType: this.councilType,
      query: this.query,
      sort: this.sort,
      // The same height the draw passes, for the same reason: the national summary
      // chooses its form by it, and the two must never disagree.
      contentHeight: this.frame?.contentHeight,
    })
  }

  /** Columns the content area has, which is the terminal less the frame's chrome. */
  private contentWidth(): number {
    const measured = this.frame?.contentWidth ?? 0
    return measured > 0 ? measured : Math.max(40, (this.renderer?.width ?? 100) - 2)
  }

  /**
   * One pass of the refresh loop.
   *
   * Processes due sources one at a time, redrawing after each, so the interface fills
   * in progressively rather than freezing until everything has arrived (FR-018b).
   */
  private async tick(): Promise<void> {
    if (this.stopped) return
    const { scheduler, db, log } = this.deps

    for (const sub of scheduler.due(new Date(), 3)) {
      if (this.stopped) return

      // One source cannot take the loop down with it. A throw here used to escape into
      // an unhandled rejection - the loop is driven by `void this.tick()` - and an
      // unhandled rejection opened OpenTUI's console overlay over the interface, which
      // then held the keyboard. Every failure becomes a recorded failure on that one
      // subscription (FR-046).
      let outcome: FetchOutcome
      try {
        outcome = await fetchDocument(urlForKey(this.location, sub.sourceKey), {
          validators: { etag: sub.etag, lastModified: sub.lastModified },
          signal: this.abort.signal,
        })
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        scheduler.recordFailure(sub.sourceKey, reason)
        log.warn("Zdroj nelze načíst", { source: sub.sourceKey, reason })
        // A source whose address cannot even be built will never succeed, so it is
        // dropped rather than retried until the end of the night.
        if (error instanceof TypeError) {
          scheduler.unsubscribe(sub.sourceKey)
          log.warn("Zdroj odhlášen, nelze sestavit adresu", { source: sub.sourceKey })
        }
        this.draw()
        continue
      }

      recordFetch(db, scheduler, sub.sourceKey, outcome, log)
      this.draw()
      // Yield, so a burst of due sources cannot monopolise the event loop and delay a
      // keystroke past the 100 ms budget in SC-010.
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  private draw(content?: ScreenContent): void {
    const renderer = this.renderer
    const frame = this.frame
    if (renderer === null || frame === null) return

    const width = renderer.width
    const height = renderer.height

    if (isTooSmall(width, height)) {
      frame.setBreadcrumb("")
      frame.setWarning(null)
      applyPlainLines(frame, tooSmallMessage(width, height), width)
      frame.setStatus("")
      return
    }

    // The panel is shown only when the user wants it AND it fits beside a readable
    // content area. The content area never loses columns to keep it open (FR-057).
    applyPanel(frame, this.deps.db, this.theme, this.sidePanelOpen && panelFits(frame.rawContentWidth))

    const theme = this.theme
    // The palette is painted separately from the frame; both follow a theme switch in the
    // same draw, so no region is left in the old colours (FR-027).
    if (this.palette !== null && this.paletteTheme !== theme) {
      this.palette.applyTheme(theme)
      this.paletteTheme = theme
    }
    const subscriptions = this.deps.scheduler.all()
    applyFrameState(
      frame,
      frameState({
        db: this.deps.db,
        nav: this.nav,
        councilType: this.councilType,
        query: this.query,
        theme,
        sort: this.sort,
        width,
        contentWidth: this.contentWidth(),
        contentHeight: frame.contentHeight,
        warning: staleWarning(subscriptions),
        final: allFinal(
          subscriptions,
          shownSources(this.nav.screen, watchedCodes(this.deps.db), this.districts),
        ),
        notice: this.notice,
        // Reuses the screen the key handler already composed, rather than composing the
        // identical screen a second time on every keystroke.
        content,
        lastSuccessAt: latestSuccess(subscriptions),
        paletteOpen: this.palette?.open === true,
      }),
      theme,
    )
  }
}

/** When any source last refreshed successfully, for the title bar clock. */
function latestSuccess(subscriptions: { lastSuccessAt: string | null }[]): string | null {
  let latest: string | null = null
  for (const { lastSuccessAt } of subscriptions) {
    if (lastSuccessAt !== null && (latest === null || lastSuccessAt > latest)) latest = lastSuccessAt
  }
  return latest
}

/**
 * Stores one fetch's outcome and records it against the source's subscription.
 *
 * A successful ingest passes the document's finality on, which is what takes a final
 * source out of automatic polling (feature 003, FR-001).
 */
export function recordFetch(
  db: Database,
  scheduler: Scheduler,
  key: SourceKey,
  outcome: FetchOutcome,
  log: Logger,
): void {
  if (outcome.kind === "ok") {
    const result = ingestFor(db, key, outcome.body)
    if (result.ok) {
      scheduler.recordSuccess(
        key,
        { etag: outcome.etag, lastModified: outcome.lastModified },
        undefined,
        result.final,
      )
    } else {
      // A document failing validation is a failure of the source, not of the
      // application: the previous snapshot stays on screen (FR-025, FR-027).
      scheduler.recordFailure(key, result.reason)
      log.warn("Dokument odmítnut", { source: key, reason: result.reason })
    }
  } else if (outcome.kind === "not-modified") {
    scheduler.recordSuccess(key)
  } else if (outcome.kind === "not-found") {
    scheduler.recordFailure(key, "Data zatím nejsou zveřejněna")
  } else {
    scheduler.recordFailure(key, outcome.reason)
    log.warn("Stahování selhalo", { source: key, reason: outcome.reason })
  }
}

/** Routes a fetched body to the right ingest function. */
function ingestFor(db: Database, key: string, body: string) {
  if (key === "national") return ingestNational(db, body)
  const [kind, id] = key.split(":", 2)
  if (kind === "district" && id !== undefined) return ingestDistrict(db, id, body)
  if (kind === "council" && id !== undefined) return ingestCouncil(db, id, body)
  return { ok: false as const, reason: `Neznámý zdroj: ${key}` }
}
