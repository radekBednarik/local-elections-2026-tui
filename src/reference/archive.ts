/**
 * ZIP extraction (task T033).
 *
 * The registry and code list bundles are ZIP archives. Node's `zlib` handles gzip and
 * deflate streams but not the ZIP container, so a library is genuinely needed here -
 * `fflate`, chosen in research R5 for being small, dependency-free and pure TypeScript.
 */

import { unzipSync } from "fflate"

export type ArchiveResult = { ok: true; files: Map<string, string> } | { ok: false; message: string }

const decoder = new TextDecoder("utf-8")

/**
 * Extracts every entry as UTF-8 text, keyed by its lower-cased base name.
 *
 * Names are normalised because an archive may or may not nest its entries in a folder,
 * and callers should not have to care. Czech text must survive intact (FR-026), so the
 * decode is explicitly UTF-8 rather than platform default.
 */
export function extractArchive(data: Uint8Array): ArchiveResult {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(data)
  } catch (error) {
    return {
      ok: false,
      message: `Archiv se nepodařilo rozbalit: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  const files = new Map<string, string>()
  for (const [path, bytes] of Object.entries(entries)) {
    // Directory entries have no content and a trailing separator.
    if (path.endsWith("/") || bytes.length === 0) continue
    const base = path.split(/[\\/]/).pop()
    if (base === undefined || base === "") continue
    files.set(base.toLowerCase(), decoder.decode(bytes))
  }

  if (files.size === 0) {
    return { ok: false, message: "Archiv neobsahuje žádné soubory." }
  }
  return { ok: true, files }
}

/** Reads and extracts an archive from disk. */
export async function extractArchiveFile(path: string): Promise<ArchiveResult> {
  try {
    const data = new Uint8Array(await Bun.file(path).arrayBuffer())
    return extractArchive(data)
  } catch (error) {
    return {
      ok: false,
      message: `Archiv ${path} nelze načíst: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
