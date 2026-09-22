/**
 * Writing exported files (task T092).
 *
 * Two rules from contracts/exports.md:
 *   - Write to a temporary file and rename, so an interrupted export cannot leave a
 *     half-written file that looks complete.
 *   - Never throw. A failure is reported with its reason and the application keeps
 *     running (FR-052 with FR-046).
 */

import { existsSync } from "node:fs"
import { mkdir, rename, unlink, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

export type WriteResult = { ok: true; path: string; bytes: number } | { ok: false; reason: string }

export interface WriteOptions {
  /** Refuse rather than replace an existing file, unless explicitly allowed. */
  overwrite?: boolean
}

/**
 * Writes `content` to `path` atomically.
 *
 * The rename is the atomic step: readers see either the old file or the complete new
 * one, never a partial write.
 */
export async function writeExport(
  path: string,
  content: string,
  options: WriteOptions = {},
): Promise<WriteResult> {
  if (!options.overwrite && existsSync(path)) {
    return { ok: false, reason: `Soubor ${path} již existuje.` }
  }

  const temporary = `${path}.part`
  try {
    await mkdir(dirname(path), { recursive: true })
    // Encoded explicitly as UTF-8: the content already carries a BOM, and a platform
    // default encoding would undo the very thing the BOM is there to guarantee.
    await writeFile(temporary, content, { encoding: "utf8" })
    await rename(temporary, path)
    return { ok: true, path, bytes: Buffer.byteLength(content, "utf8") }
  } catch (error) {
    // Leave nothing behind on failure.
    try {
      await unlink(temporary)
    } catch {
      // The temporary file may never have been created; that is not an error.
    }
    return { ok: false, reason: describeWriteError(error, path) }
  }
}

function describeWriteError(error: unknown, path: string): string {
  const code = (error as NodeJS.ErrnoException).code
  switch (code) {
    case "EACCES":
    case "EPERM":
      return `Do ${path} nelze zapisovat: chybí oprávnění.`
    case "ENOSPC":
      return "Na disku není dost místa."
    case "ENOENT":
      return `Cesta ${path} neexistuje.`
    case "EROFS":
      return `Do ${path} nelze zapisovat: disk je jen pro čtení.`
    default:
      return `Zápis do ${path} selhal: ${error instanceof Error ? error.message : String(error)}`
  }
}

/** A filename-safe version of an area name, for suggesting a default path. */
export function suggestFilename(area: string, extension: string, now = new Date()): string {
  const stamp = now.toISOString().slice(0, 16).replace(/[:T]/g, "-")
  const safe = area
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    // Anything a filesystem might object to becomes a hyphen.
    .replace(/[^\w-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
  return `volby-kv2026-${safe || "export"}-${stamp}.${extension}`
}
