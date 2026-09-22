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
import { fetchDocument } from "../sources/client.ts"
import { ingestCouncil, ingestDistrict, ingestNational } from "../sources/ingest.ts"
import type { Scheduler } from "../sources/scheduler.ts"
import { type SourceKey, type SourceLocation, urlForKey } from "../sources/urls.ts"
import { availableCouncilTypes } from "../storage/queries/national.ts"
import { toggleWatchlist, watchedCodes } from "../storage/queries/watchlist.ts"
import { Frame } from "./chrome/frame.ts"
import { applyFrameState, frameState } from "./chrome/state.ts"
import { isTooSmall, staleWarning, tooSmallMessage } from "./components/status.ts"
import { Navigation } from "./navigation.ts"
import { composeScreen, type ScreenContent, sourcesForScreen } from "./screen.ts"
import { applySearchKey, type KeyEvent } from "./search-input.ts"

export interface AppDependencies {
  db: Database
  options: CliOptions
  log: Logger
  scheduler: Scheduler
}

export class App {
  private renderer: CliRenderer | null = null
  private frame: Frame | null = null
  private loop: ReturnType<typeof setInterval> | null = null
  private readonly abort = new AbortController()
  private readonly nav = new Navigation()
  private query = ""
  /** One-off confirmation line, cleared on the next key press. */
  private notice: string | null = null
  private councilType = "OBEC"
  private stopped = false

  constructor(private readonly deps: AppDependencies) {}

  private get location(): SourceLocation {
    return {
      baseUrl: this.deps.options.baseUrl,
      election: this.deps.options.election,
      date: this.deps.options.date,
    }
  }

  async start(): Promise<void> {
    const renderer = await createCliRenderer({ exitOnCtrlC: false })
    this.renderer = renderer

    const frame = new Frame(renderer)
    frame.attach(renderer.root)
    this.frame = frame

    renderer.keyInput.on("keypress", (key: KeyEvent) => {
      void this.onKey(key)
    })
    renderer.on("resize", () => {
      this.draw()
    })

    const shutdown = () => {
      this.stop()
    }
    process.once("SIGINT", shutdown)
    process.once("SIGTERM", shutdown)

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
    if (districts.length === 0) return
    this.deps.scheduler.subscribeAll(
      districts.map((d) => ({
        key: `district:${d.nuts}` as SourceKey,
        areaKind: "district",
        areaId: d.nuts,
      })),
    )
    this.deps.log.info("Okresy přihlášeny k odběru", { count: districts.length })
  }

  /**
   * Subscribes to what the current screen needs and drops what it no longer does.
   *
   * A council left behind is unsubscribed unless it is pinned to the watchlist, which
   * is what keeps the polling set bounded (FR-018a).
   */
  private syncSubscriptions(): void {
    const { scheduler, db } = this.deps
    const needed = new Set(sourcesForScreen(this.nav.screen).map((s) => s.key))

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

    for (const sub of scheduler.all()) {
      if (sub.areaKind !== "council") continue
      if (!needed.has(sub.sourceKey) && !sub.pinned) scheduler.unsubscribe(sub.sourceKey)
    }
  }

  private async onKey(key: KeyEvent): Promise<void> {
    const name = key.name ?? ""
    // A confirmation only survives until the next keystroke.
    this.notice = null

    // Ctrl+C always quits. A bare "q" must NOT, while the search box has focus, or the
    // user could never type a name containing the letter.
    if (key.ctrl === true && name === "c") {
      this.stop()
      return
    }

    if (this.nav.screen.kind === "search" && this.handleSearchKey(key)) {
      this.draw()
      return
    }

    if (name === "q") {
      this.stop()
      return
    }

    const content = this.currentContent()

    switch (name) {
      case "up":
        this.nav.move(-1, content.rowCount)
        break
      case "down":
        this.nav.move(1, content.rowCount)
        break
      case "pageup":
        this.nav.move(-10, content.rowCount)
        break
      case "pagedown":
        this.nav.move(10, content.rowCount)
        break
      case "home":
        this.nav.moveTo("first", content.rowCount)
        break
      case "end":
        this.nav.moveTo("last", content.rowCount)
        break
      case "return":
      case "enter": {
        this.open(content)
        break
      }
      case "escape":
      case "backspace":
        if (this.nav.pop()) this.syncSubscriptions()
        break
      case "/":
      case "slash":
        this.query = ""
        this.nav.push({ kind: "search" })
        break
      case "w": {
        // Shift distinguishes the two: "w" toggles, "W" opens the list. The key name
        // arrives lower-cased either way, so the sequence is what tells them apart.
        if (key.shift === true || key.sequence === "W") {
          this.nav.push({ kind: "watchlist" })
          this.syncSubscriptions()
          break
        }
        this.toggleWatch()
        break
      }
      case "?":
      case "questionmark":
        if (this.nav.screen.kind !== "help") this.nav.push({ kind: "help" })
        break
      case "e": {
        // "e" exports the displayed table, "E" produces the summary report.
        await this.exportCurrent(key.shift === true || key.sequence === "E")
        break
      }
      case "t": {
        this.cycleCouncilType()
        break
      }
      case "r": {
        await this.refreshNow()
        break
      }
      default:
        return
    }

    this.draw()
  }

  /** Opens whatever the selected row leads to. */
  private open(content: ScreenContent): void {
    const target = content.target(this.nav.current.selected)
    if (target === null) return
    this.nav.push(target)
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
      width: this.contentWidth(),
      councilType: this.councilType,
      query: this.query,
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

      const outcome = await fetchDocument(urlForKey(this.location, sub.sourceKey), {
        validators: { etag: sub.etag, lastModified: sub.lastModified },
        signal: this.abort.signal,
      })

      if (outcome.kind === "ok") {
        const result = ingestFor(db, sub.sourceKey, outcome.body)
        if (result.ok) {
          scheduler.recordSuccess(sub.sourceKey, {
            etag: outcome.etag,
            lastModified: outcome.lastModified,
          })
        } else {
          // A document failing validation is a failure of the source, not of the
          // application: the previous snapshot stays on screen (FR-025, FR-027).
          scheduler.recordFailure(sub.sourceKey, result.reason)
          log.warn("Dokument odmítnut", { source: sub.sourceKey, reason: result.reason })
        }
      } else if (outcome.kind === "not-modified") {
        scheduler.recordSuccess(sub.sourceKey)
      } else if (outcome.kind === "not-found") {
        scheduler.recordFailure(sub.sourceKey, "Data zatím nejsou zveřejněna")
      } else {
        scheduler.recordFailure(sub.sourceKey, outcome.reason)
        log.warn("Stahování selhalo", { source: sub.sourceKey, reason: outcome.reason })
      }

      this.draw()
      // Yield, so a burst of due sources cannot monopolise the event loop and delay a
      // keystroke past the 100 ms budget in SC-010.
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  }

  private draw(): void {
    const renderer = this.renderer
    const frame = this.frame
    if (renderer === null || frame === null) return

    const width = renderer.width
    const height = renderer.height

    if (isTooSmall(width, height)) {
      frame.setBreadcrumb("")
      frame.setWarning(null)
      frame.setLines(tooSmallMessage(width, height))
      frame.setStatus("")
      return
    }

    applyFrameState(
      frame,
      frameState({
        db: this.deps.db,
        nav: this.nav,
        councilType: this.councilType,
        query: this.query,
        width,
        contentWidth: this.contentWidth(),
        contentHeight: frame.contentHeight,
        warning: staleWarning(this.deps.scheduler.all()),
        notice: this.notice,
      }),
    )
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
