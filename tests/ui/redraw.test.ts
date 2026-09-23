/**
 * How much of the screen a keystroke rewrites (SC-010).
 *
 * Moving the selection one row changes two rows. The frame used to rewrite all
 * eighty-one, each costing a native text-buffer rebuild and a layout invalidation, and
 * holding an arrow key on the district list felt like wading.
 *
 * These assertions are about WORK, not about wall-clock: a timing test on a shared
 * machine measures the machine. Counting the renderables a redraw touches measures the
 * thing that was actually wrong, and it cannot pass by accident on a fast day.
 */

import type { Database } from "bun:sqlite"
import { beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createTestRenderer } from "@opentui/core/testing"
import { extractArchiveFile } from "../../src/reference/archive.ts"
import { loadReference, type ReferenceArchives } from "../../src/reference/loader.ts"
import { ingestDistrict, ingestNational } from "../../src/sources/ingest.ts"
import { openMemoryDatabase } from "../../src/storage/db.ts"
import { Frame } from "../../src/ui/chrome/frame.ts"
import { applyFrameState, frameState, viewWidthFor } from "../../src/ui/chrome/state.ts"
import { Navigation } from "../../src/ui/navigation.ts"
import { composeScreen, type ScreenContent } from "../../src/ui/screen.ts"
import { UNSORTED } from "../../src/ui/sort.ts"
import { MONOCHROME, type Theme, themeByName } from "../../src/ui/theme/themes.ts"

const FIXTURES = join(import.meta.dir, "../../fixtures/2026")
const read = (name: string) => readFileSync(join(FIXTURES, name), "utf8")

let archives: ReferenceArchives
beforeAll(async () => {
  const reg = await extractArchiveFile(join(FIXTURES, "reg.zip"))
  const cis = await extractArchiveFile(join(FIXTURES, "ciselniky.zip"))
  if (!reg.ok || !cis.ok) throw new Error("fixture archives could not be extracted")
  archives = { registry: reg.files, codelists: cis.files }
})

let db: Database
beforeEach(() => {
  db = openMemoryDatabase()
  loadReference(db, archives)
  ingestNational(db, read("vysledky.xml"))
  ingestDistrict(db, "CZ0642", read("vysledky_obce_okres_CZ0642.xml"))
})

const WIDTH = 110
const HEIGHT = 30

async function harness() {
  const setup = await createTestRenderer({ width: WIDTH, height: HEIGHT })
  const frame = new Frame(setup.renderer)
  frame.attach(setup.renderer.root)
  const nav = new Navigation()
  nav.push({ kind: "districts" })

  const contentWidth = () => (frame.contentWidth > 0 ? frame.contentWidth : WIDTH - 3)

  /**
   * `composed` is the screen the key handler composed and passes through, exactly as
   * App.onKey does for a movement key. Omitted, the draw composes its own, as a refresh
   * does.
   */
  const draw = async (theme: Theme = themeByName("dark"), composed?: ScreenContent) => {
    applyFrameState(
      frame,
      frameState({
        db,
        nav,
        councilType: "OBEC",
        query: "",
        theme,
        sort: UNSORTED,
        width: WIDTH,
        contentWidth: contentWidth(),
        contentHeight: frame.contentHeight > 0 ? frame.contentHeight : HEIGHT - 4,
        warning: null,
        notice: null,
        content: composed,
      }),
      theme,
    )
    await setup.renderOnce()
  }

  /** What App.currentContent composes: the screen at the view width. */
  const compose = () =>
    composeScreen(db, nav.screen, {
      width: viewWidthFor(contentWidth()),
      councilType: "OBEC",
      query: "",
      sort: UNSORTED,
    })

  /** The identity of each row's content, so a rewrite can be told from a skip. */
  const fingerprint = () => frame.rows.map((node) => node.content)

  const rewritten = (before: unknown[], after: unknown[]) =>
    after.filter((content, index) => content !== before[index]).length

  return { frame, nav, draw, compose, fingerprint, rewritten, destroy: () => setup.renderer.destroy() }
}

describe("a keystroke and a refresh draw the same layout", () => {
  test("a movement key, drawn with the screen it composed, touches two rows", async () => {
    const h = await harness()
    try {
      await h.draw()
      const before = h.fingerprint()
      const content = h.compose()
      h.nav.move(1, content.rowCount)
      await h.draw(undefined, content)
      // Composed two columns wider, every row's text changed and all 81 were rewritten.
      expect(h.rewritten(before, h.fingerprint())).toBe(2)
    } finally {
      h.destroy()
    }
  })

  test("the refresh after a keystroke touches nothing", async () => {
    const h = await harness()
    try {
      await h.draw()
      const content = h.compose()
      h.nav.move(1, content.rowCount)
      await h.draw(undefined, content)
      const before = h.fingerprint()
      // The refresh loop redraws about once a second. With nothing changed it must not
      // shift the table back, which is the jitter that was reported.
      await h.draw()
      expect(h.rewritten(before, h.fingerprint())).toBe(0)
    } finally {
      h.destroy()
    }
  })
})

describe("a keystroke rewrites only what changed", () => {
  test("moving the selection one row touches two rows, not the whole list", async () => {
    const h = await harness()
    try {
      await h.draw()
      expect(h.frame.rows.length).toBeGreaterThan(70)

      const before = h.fingerprint()
      h.nav.move(1, 77)
      await h.draw()

      // The row losing the marker and the row gaining it. Nothing else.
      expect(h.rewritten(before, h.fingerprint())).toBe(2)
    } finally {
      h.destroy()
    }
  })

  test("a redraw with nothing changed touches nothing at all", async () => {
    const h = await harness()
    try {
      await h.draw()
      const before = h.fingerprint()
      await h.draw()
      expect(h.rewritten(before, h.fingerprint())).toBe(0)
    } finally {
      h.destroy()
    }
  })

  test("a refresh that changes no figures rewrites nothing", async () => {
    const h = await harness()
    try {
      await h.draw()
      const before = h.fingerprint()
      // The same document arriving again: the publisher republishes unchanged data all
      // the time, and it must not cost a full repaint.
      ingestDistrict(db, "CZ0642", read("vysledky_obce_okres_CZ0642.xml"))
      await h.draw()
      expect(h.rewritten(before, h.fingerprint())).toBe(0)
    } finally {
      h.destroy()
    }
  })

  test("but a figure that really changes does get rewritten", async () => {
    const h = await harness()
    try {
      await h.draw()
      const before = h.fingerprint()
      // Drop one council's results, which changes the district's progress column.
      db.query("DELETE FROM result_snapshot WHERE area_kind = 'council' AND area_id = '551082'").run()
      await h.draw()
      expect(h.rewritten(before, h.fingerprint())).toBeGreaterThan(0)
    } finally {
      h.destroy()
    }
  })
})

describe("a change that alters no text still repaints", () => {
  test("switching the theme rewrites every row", async () => {
    // The row skip compares TEXT, and a theme changes none. Without the explicit
    // invalidation the screen would keep the old colours until something else moved.
    const h = await harness()
    try {
      await h.draw(themeByName("dark"))
      const before = h.fingerprint()
      await h.draw(MONOCHROME)
      expect(h.rewritten(before, h.fingerprint())).toBe(before.length)
    } finally {
      h.destroy()
    }
  })

  test("and the screen is still correct afterwards", async () => {
    const h = await harness()
    try {
      await h.draw(themeByName("dark"))
      await h.draw(MONOCHROME)
      await h.draw(themeByName("light"))
      // The skip must never leave a stale row behind: every district is still listed.
      const lines = h.frame.rows.map((node) => node.content.chunks.map((c) => c.text).join(""))
      expect(lines.some((l) => l.includes("Brno-město"))).toBe(true)
      expect(lines.some((l) => l.includes("Benešov"))).toBe(true)
    } finally {
      h.destroy()
    }
  })
})

describe("moving between screens", () => {
  test("a shorter screen hides the rows it no longer needs", async () => {
    const h = await harness()
    try {
      await h.draw()
      const districtRows = h.frame.rows.length
      expect(districtRows).toBeGreaterThan(70)

      h.nav.push({ kind: "district", nuts: "CZ0642" })
      await h.draw()
      // The pool is kept, but only the rows in use are shown.
      expect(h.frame.rows.length).toBeLessThan(districtRows)
    } finally {
      h.destroy()
    }
  })

  test("and going back shows them again", async () => {
    const h = await harness()
    try {
      await h.draw()
      const before = h.frame.rows.length
      h.nav.push({ kind: "district", nuts: "CZ0642" })
      await h.draw()
      h.nav.pop()
      await h.draw()
      expect(h.frame.rows.length).toBe(before)
      const lines = h.frame.rows.map((node) => node.content.chunks.map((c) => c.text).join(""))
      expect(lines.some((l) => l.includes("Benešov"))).toBe(true)
    } finally {
      h.destroy()
    }
  })
})
