/**
 * End-to-end reproduction for bug "rendering-bugs", driving the REAL App.
 *
 * App creates its own renderer with createCliRenderer, so that one export is swapped for
 * OpenTUI's headless test renderer. Everything else - App.onKey, the refresh draw, the
 * Frame, the theme styling and the native text buffers - is the production code path.
 * The captured char frame is what a terminal would be sent.
 *
 * Run explicitly:  bun test ./.specify/bugs/rendering-bugs/repro/app-repro.test.ts
 */

import { afterAll, describe, expect, mock, test } from "bun:test"
import { readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as core from "@opentui/core"
import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing"

let current: TestRendererSetup | null = null
mock.module("@opentui/core", () => ({
  ...core,
  createCliRenderer: async () => {
    if (current === null) throw new Error("no test renderer prepared")
    return current.renderer
  },
}))

const ROOT = join(import.meta.dir, "../../../..")
const FIXTURES = join(ROOT, "fixtures/2026")
const read = (name: string) => readFileSync(join(FIXTURES, name), "utf8")

const { App } = await import(join(ROOT, "src/ui/app.ts"))
const { extractArchiveFile } = await import(join(ROOT, "src/reference/archive.ts"))
const { loadReference } = await import(join(ROOT, "src/reference/loader.ts"))
const { ingestDistrict, ingestNational } = await import(join(ROOT, "src/sources/ingest.ts"))
const { openMemoryDatabase } = await import(join(ROOT, "src/storage/db.ts"))
const { createLogger } = await import(join(ROOT, "src/logging/logger.ts"))
const { Scheduler } = await import(join(ROOT, "src/sources/scheduler.ts"))

const reg = await extractArchiveFile(join(FIXTURES, "reg.zip"))
const cis = await extractArchiveFile(join(FIXTURES, "ciselniky.zip"))

// biome-ignore lint/suspicious/noExplicitAny: reaching App's private state is the point
type AnyApp = any
const running: AnyApp[] = []
afterAll(() => {
  for (const app of running) app.stop()
})

async function start(width: number, height = 40) {
  const db = openMemoryDatabase()
  loadReference(db, { registry: reg.files, codelists: cis.files })
  ingestNational(db, read("vysledky.xml"))
  ingestDistrict(db, "CZ0642", read("vysledky_obce_okres_CZ0642.xml"))

  current = await createTestRenderer({ width, height })
  const setup = current
  const scheduler = new Scheduler(db, { intervalSeconds: 3600 })
  const app: AnyApp = new App({
    db,
    // An address that refuses at once: the loop runs and fails fast, never reaching out.
    options: {
      election: "kv2026",
      date: "20261003",
      baseUrl: "http://127.0.0.1:9",
      intervalSeconds: 3600,
      dataDir: null,
      exportDir: tmpdir(),
      refreshReference: false,
      reset: false,
      logLevel: "error",
      showHelp: false,
      showVersion: false,
      selfTest: false,
    },
    log: createLogger(join(tmpdir(), "rendering-bugs-repro.log"), "error"),
    scheduler,
  })
  running.push(app)
  await app.start()
  await setup.renderOnce()

  const frame = () => setup.captureCharFrame().split("\n")
  const refresh = async () => {
    app.draw()
    await setup.renderOnce()
  }
  const key = async (name: "ARROW_DOWN" | "RETURN") => {
    setup.mockInput.pressKey(name)
    await new Promise((r) => setTimeout(r, 5))
    await setup.renderOnce()
  }
  const goTo = async (screen: unknown) => {
    app.nav.push(screen)
    await refresh()
  }
  return { app, setup, frame, refresh, key, goTo }
}

const line = (lines: string[], needle: string) => lines.find((l) => l.includes(needle)) ?? ""
/** The content row, cut at the body's right border, less the scroll bar's column. */
const insideBorder = (l: string) => {
  const start = l.indexOf("│")
  const end = l.indexOf("│", start + 1)
  return end > start ? l.slice(start + 1, end - 1) : l
}

for (const width of [100, 120, 160]) {
  describe(`${width} columns`, () => {
    test("item 1: Down on Okresy does not move NUTS, and the refresh does not move it back", async () => {
      const h = await start(width)
      await h.goTo({ kind: "districts" })

      // Every draw's header row, as the frame was given it, so a layout that lasts only
      // until the next draw is still seen.
      const seen: number[] = []
      const original = h.app.draw.bind(h.app)
      h.app.draw = (...args: unknown[]) => {
        original(...args)
        const texts = h.app.frame.rows.map((n: { content: { chunks: { text: string }[] } }) =>
          n.content.chunks.map((c) => c.text).join(""),
        )
        seen.push(line(texts, "Zastupitelstva").indexOf("NUTS"))
      }

      const before = line(h.frame(), "Zastupitelstva").indexOf("NUTS")
      const rowsBefore = h.app.frame.rows.map((n: { content: unknown }) => n.content)

      await h.key("ARROW_DOWN")
      const afterKey = line(h.frame(), "Zastupitelstva").indexOf("NUTS")
      const rowsAfterKey = h.app.frame.rows.map((n: { content: unknown }) => n.content)
      const touched = rowsAfterKey.filter((c: unknown, i: number) => c !== rowsBefore[i]).length

      await h.refresh()
      const afterRefresh = line(h.frame(), "Zastupitelstva").indexOf("NUTS")
      const rowsAfterRefresh = h.app.frame.rows.map((n: { content: unknown }) => n.content)
      const touchedByRefresh = rowsAfterRefresh.filter(
        (c: unknown, i: number) => c !== rowsAfterKey[i],
      ).length

      console.log(
        `[${width}] NUTS col: before=${before} afterKey=${afterKey} afterRefresh=${afterRefresh}; ` +
          `rows touched: key=${touched} refresh=${touchedByRefresh}; NUTS per draw: ${JSON.stringify(seen)}`,
      )
      // Every draw, including one superseded before the capture, keeps NUTS where it was.
      expect(seen.length).toBeGreaterThan(0)
      expect(new Set(seen).size).toBe(1)
      expect(before).toBeGreaterThan(0)
      expect(afterKey).toBe(before)
      expect(afterRefresh).toBe(before)
      expect(touched).toBe(2)
      expect(touchedByRefresh).toBe(0)
    })

    test("item 2: the Okres council table has nothing after Stav", async () => {
      const h = await start(width)
      await h.goTo({ kind: "district", nuts: "CZ0642" })
      const lines = h.frame()
      const header = insideBorder(line(lines, "Okrsky"))
      console.log(`[${width}] district header: |${header}|`)
      expect(header.trimEnd().endsWith("Stav")).toBe(true)
      const body = lines.filter((l) => l.includes("průběžné") || l.includes("konečné"))
      expect(body.length).toBeGreaterThan(0)
      for (const l of body) expect(insideBorder(l).includes("…")).toBe(false)
    })

    test("item 3: the council table shows Mandáty and its figures whole", async () => {
      const h = await start(width)
      await h.goTo({ kind: "district", nuts: "CZ0642" })
      await h.goTo({ kind: "council", kodzastup: "551082" })
      const lines = h.frame()
      const header = insideBorder(line(lines, "Volební strana"))
      console.log(`[${width}] council header: |${header}|`)
      expect(header.trimEnd().endsWith("Mandáty")).toBe(true)
      const headerIndex = lines.findIndex((l) => l.includes("Volební strana"))
      const firstData = insideBorder(lines[headerIndex + 2] ?? "")
      console.log(`[${width}] council row 1: |${firstData}|`)
      expect(firstData.trimEnd()).toMatch(/\d$/)
    })
  })
}
