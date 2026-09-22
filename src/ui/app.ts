/**
 * Application shell (tasks T045, T049, T050).
 *
 * Owns the renderer, the key map, and the background refresh loop.
 *
 * Two rules shape the design:
 *   - The renderer must be destroyed on EVERY exit path, or the terminal is left in raw
 *     mode with the alternate screen active (FR-006).
 *   - Fetching must never block input (SC-010), so refresh work runs as async tasks and
 *     one document is processed at a time with a yield between documents (research R8).
 */

import type { Database } from "bun:sqlite"
import { BoxRenderable, type CliRenderer, createCliRenderer, TextRenderable } from "@opentui/core"
import type { CliOptions } from "../config/args.ts"
import type { Logger } from "../logging/logger.ts"
import { fetchDocument } from "../sources/client.ts"
import { ingestCouncil, ingestDistrict, ingestNational } from "../sources/ingest.ts"
import type { Scheduler } from "../sources/scheduler.ts"
import { type SourceLocation, urlForKey } from "../sources/urls.ts"
import { availableCouncilTypes } from "../storage/queries/national.ts"
import {
  isTooSmall,
  keyHintLine,
  NATIONAL_HINTS,
  staleWarning,
  tooSmallMessage,
} from "./components/status.ts"
import { renderNationalView } from "./views/national.ts"

export interface AppDependencies {
  db: Database
  options: CliOptions
  log: Logger
  scheduler: Scheduler
}

export class App {
  private renderer: CliRenderer | null = null
  private body: TextRenderable | null = null
  private footer: TextRenderable | null = null
  private warning: TextRenderable | null = null
  private loop: ReturnType<typeof setInterval> | null = null
  private readonly abort = new AbortController()
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

    const panel = new BoxRenderable(renderer, { flexDirection: "column", padding: 0, flexGrow: 1 })
    this.warning = new TextRenderable(renderer, { content: "" })
    this.body = new TextRenderable(renderer, { content: "Načítám…" })
    this.footer = new TextRenderable(renderer, { content: "" })
    panel.add(this.warning)
    panel.add(this.body)
    panel.add(this.footer)
    renderer.root.add(panel)

    renderer.keyInput.on("keypress", (key: { name?: string; ctrl?: boolean }) => {
      void this.onKey(key)
    })
    renderer.on("resize", () => {
      this.draw()
    })

    // Every shutdown path must restore the terminal, including a signal (FR-006).
    const shutdown = () => {
      this.stop()
    }
    process.once("SIGINT", shutdown)
    process.once("SIGTERM", shutdown)

    this.draw()
    // Fire one pass immediately so the first screen is not an empty wait, then settle
    // into the polling rhythm. The interval is short because the scheduler, not this
    // timer, decides what is actually due.
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
  }

  private async onKey(key: { name?: string; ctrl?: boolean }): Promise<void> {
    if (key.name === "q" || (key.ctrl === true && key.name === "c")) {
      this.stop()
      return
    }
    if (key.name === "t") {
      const types = availableCouncilTypes(this.deps.db)
      if (types.length > 1) {
        const index = types.indexOf(this.councilType)
        this.councilType = types[(index + 1) % types.length] ?? "OBEC"
        this.draw()
      }
      return
    }
    if (key.name === "r") {
      // Subject to the same 60-second floor as automatic polling (FR-019).
      const allowed = this.deps.scheduler.requestRefresh("national")
      this.deps.log.debug("Ruční obnovení", { allowed })
      await this.tick()
    }
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
      const url = urlForKey(this.location, sub.sourceKey)
      const outcome = await fetchDocument(url, {
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
          log.debug("Načteno", { source: sub.sourceKey, publishedAt: result.publishedAt })
        } else {
          // A document that fails validation is a failure of the source, not of the
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
    if (renderer === null || this.body === null) return

    const width = renderer.width
    const height = renderer.height

    if (isTooSmall(width, height)) {
      this.warning && (this.warning.content = "")
      this.body.content = tooSmallMessage(width, height).join("\n")
      this.footer && (this.footer.content = "")
      return
    }

    const warning = staleWarning(this.deps.scheduler.all())
    if (this.warning !== null) this.warning.content = warning ?? ""

    const lines = renderNationalView(this.deps.db, { oznacTypu: this.councilType, width })
    // Leave room for the warning line and the footer.
    const available = Math.max(1, height - (warning === null ? 1 : 2) - 1)
    this.body.content = lines.slice(0, available).join("\n")

    if (this.footer !== null) this.footer.content = keyHintLine(NATIONAL_HINTS, width)
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
