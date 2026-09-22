/**
 * Self-test (`--self-test`).
 *
 * Proves, from inside the shipped binary, that the two things which cannot be checked
 * any other way actually work:
 *
 *   1. `bun:sqlite` opens a real on-disk database. Bun's documentation does not state
 *      whether it works inside a `--compile` executable, so this was verified
 *      empirically in T006 and is re-verified on every build.
 *   2. OpenTUI's native Zig core loads and renders. Importing `@opentui/core` proves
 *      nothing: it captures a native-load failure instead of throwing, so the only
 *      honest check is to render a frame and read the output back.
 *
 * It exists because the obvious CI smoke test - running the binary with no arguments -
 * launches the interactive interface and hangs forever waiting for a keypress.
 */

import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { TextRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"

export interface CheckResult {
  name: string
  ok: boolean
  detail: string
}

/** Opens a real on-disk database, round-trips a row containing Czech diacritics. */
function checkSqlite(): CheckResult {
  const dir = mkdtempSync(join(tmpdir(), "volby-selftest-"))
  try {
    const db = new Database(join(dir, "selftest.sqlite"), { strict: true })
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
      return { name: "bun:sqlite", ok: false, detail: `přečteno ${JSON.stringify(row)}` }
    }
    if (journal?.journal_mode?.toLowerCase() !== "wal") {
      return { name: "bun:sqlite", ok: false, detail: `journal_mode=${journal?.journal_mode}` }
    }
    return {
      name: "bun:sqlite",
      ok: true,
      detail: "zápis a čtení na disku, WAL aktivní, diakritika v pořádku",
    }
  } catch (error) {
    return { name: "bun:sqlite", ok: false, detail: String(error) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Renders one frame through the native renderer and reads it back. */
async function checkRenderer(): Promise<CheckResult> {
  const setup = await createTestRenderer({ width: 20, height: 3 })
  try {
    setup.renderer.root.add(new TextRenderable(setup.renderer, { content: "Říčany" }))
    await setup.renderOnce()
    const frame = setup.captureCharFrame()
    if (!frame.includes("Říčany")) {
      return { name: "@opentui/core", ok: false, detail: `snímek neobsahuje text: ${frame}` }
    }
    return {
      name: "@opentui/core",
      ok: true,
      detail: "nativní renderer vykreslil snímek, diakritika v pořádku",
    }
  } catch (error) {
    return { name: "@opentui/core", ok: false, detail: String(error) }
  } finally {
    setup.renderer.destroy()
  }
}

/**
 * Runs every check and reports.
 *
 * Returns a process exit code: 0 when everything passed, 2 otherwise.
 */
export async function runSelfTest(version: string): Promise<number> {
  // A compiled binary reports its entry under Bun's virtual filesystem root.
  const compiled = Bun.main.includes("/$bunfs/") || Bun.main.includes("~BUN")

  process.stdout.write(`volby-kv2026 ${version}\n`)
  process.stdout.write(
    `bun ${Bun.version} | ${process.platform} ${process.arch} | zkompilováno=${compiled}\n\n`,
  )

  const results = [checkSqlite(), await checkRenderer()]
  for (const result of results) {
    process.stdout.write(`${result.ok ? "OK   " : "CHYBA"} ${result.name}: ${result.detail}\n`)
  }

  const failed = results.filter((r) => !r.ok)
  process.stdout.write("\n")
  if (failed.length > 0) {
    process.stdout.write(`Self-test NEPROŠEL (${failed.length} z ${results.length})\n`)
    return 2
  }
  process.stdout.write(`Self-test prošel (${results.length} z ${results.length})\n`)
  return 0
}
