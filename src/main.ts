/**
 * Entry point.
 *
 * Currently a smoke test for task T006: it proves that `bun:sqlite` and the
 * OpenTUI native core both work *inside a compiled single-file binary*, which
 * research.md R3 flags as verified for OpenTUI but unverified for SQLite.
 *
 * Everything the real application needs depends on both facts, so this runs
 * before any feature work.
 */

import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TextRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"

const VERSION = "0.1.0"

interface SmokeResult {
  name: string
  ok: boolean
  detail: string
}

/** Opens a real on-disk database, writes a row with Czech diacritics, reads it back. */
function checkSqlite(): SmokeResult {
  const dir = mkdtempSync(join(tmpdir(), "volby-smoke-"))
  const path = join(dir, "smoke.sqlite")
  try {
    const db = new Database(path, { strict: true })
    db.run("PRAGMA journal_mode = WAL")
    db.run("CREATE TABLE obec (kod INTEGER PRIMARY KEY, nazev TEXT NOT NULL)")
    db.query("INSERT INTO obec (kod, nazev) VALUES ($kod, $nazev)").run({
      kod: 554782,
      nazev: "Říčany u Prahy",
    })
    const row = db.query("SELECT nazev FROM obec WHERE kod = $kod").get({ kod: 554782 }) as {
      nazev: string
    } | null
    const journal = db.query("PRAGMA journal_mode").get() as { journal_mode: string } | null
    db.close()

    if (row?.nazev !== "Říčany u Prahy") {
      return { name: "bun:sqlite", ok: false, detail: `read back ${JSON.stringify(row)}` }
    }
    if (journal?.journal_mode?.toLowerCase() !== "wal") {
      return { name: "bun:sqlite", ok: false, detail: `journal_mode=${journal?.journal_mode}` }
    }
    return { name: "bun:sqlite", ok: true, detail: "write+read on disk, WAL active, diacritics intact" }
  } catch (error) {
    return { name: "bun:sqlite", ok: false, detail: String(error) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Renders one frame through a real native renderer. Importing `@opentui/core` alone
 * proves nothing: the library captures a native-load failure instead of throwing, so
 * the only honest check is to render and read the output back.
 */
async function checkOpenTui(): Promise<SmokeResult> {
  const setup = await createTestRenderer({ width: 20, height: 3 })
  try {
    setup.renderer.root.add(new TextRenderable(setup.renderer, { content: "Říčany" }))
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    if (!frame.includes("Říčany")) {
      return { name: "@opentui/core", ok: false, detail: `frame did not contain the text: ${frame}` }
    }
    return { name: "@opentui/core", ok: true, detail: "native renderer produced a frame, diacritics intact" }
  } catch (error) {
    return { name: "@opentui/core", ok: false, detail: String(error) }
  } finally {
    setup.renderer.destroy()
  }
}

async function main(): Promise<number> {
  // A compiled binary reports its entry under Bun's virtual filesystem root:
  // "B:/~BUN/root/..." on Windows, "/$bunfs/..." elsewhere.
  const compiled = Bun.main.includes("/$bunfs/") || Bun.main.includes("~BUN")

  console.log(`volby-kv2026 ${VERSION}`)
  console.log(`bun ${Bun.version} | ${process.platform} ${process.arch} | compiled=${compiled}`)
  console.log("")

  const results = [checkSqlite(), await checkOpenTui()]
  for (const result of results) {
    console.log(`${result.ok ? "PASS" : "FAIL"}  ${result.name}: ${result.detail}`)
  }

  const failed = results.filter((r) => !r.ok)
  console.log("")
  if (failed.length > 0) {
    console.log(`T006 smoke test FAILED (${failed.length} of ${results.length})`)
    return 2
  }
  console.log(`T006 smoke test passed (${results.length} of ${results.length})`)
  return 0
}

main().then((code) => {
  process.exit(code)
})
