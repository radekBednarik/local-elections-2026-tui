/**
 * CSV export (tasks T088-T089).
 *
 * The contract is contracts/exports.md. Three encoding choices carry the whole risk of
 * this feature, and all three are Czech-locale specific:
 *
 *   1. UTF-8 WITH A BOM. Without it, Excel on a Czech Windows system decodes using the
 *      system code page and corrupts every accented character. This is the single most
 *      likely way FR-053 fails in the field.
 *   2. SEMICOLON delimiter. Excel under a Czech locale splits on ";" - a comma-delimited
 *      file lands entirely in column A.
 *   3. DECIMAL COMMA, which is why the delimiter cannot also be a comma.
 *
 * None of this is guesswork about style; it is what makes the file open correctly for
 * the people who will actually use it.
 */

/** U+FEFF, written first so spreadsheet software detects UTF-8. */
export const BOM = "﻿"
export const DELIMITER = ";"
const LINE_ENDING = "\r\n"

export interface ExportMeta {
  /** Area name, e.g. "Brno-Bohunice". */
  area: string
  /** Area code, so a row can be traced back to its source. */
  areaCode: string
  /** The publisher's generation timestamp. */
  publishedAt: string
  /** Whether the count was complete when exported. */
  isFinal: boolean
  /** Local time of export. */
  exportedAt: string
}

/**
 * Quotes a field per RFC 4180 where it needs it.
 *
 * Party names run to 2000 characters and routinely contain punctuation, so quoting is
 * exercised in normal use here rather than only in edge cases.
 */
export function quoteField(value: string): string {
  const needsQuotes =
    value.includes(DELIMITER) || value.includes('"') || value.includes("\n") || value.includes("\r")
  if (!needsQuotes) return value
  return `"${value.replace(/"/g, '""')}"`
}

/** Formats a number with a decimal comma, or an empty cell when absent. */
export function numberCell(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return ""
  return value.toFixed(decimals).replace(".", ",")
}

/** One row of already-stringified cells. */
function csvRow(cells: string[]): string {
  return cells.map(quoteField).join(DELIMITER)
}

/**
 * The provenance header.
 *
 * FR-050 and SC-017: no exported figure may be untraceable. Comment lines begin with
 * "#", which spreadsheet software imports as ordinary text rows - acceptable, and it
 * keeps the provenance attached to the data rather than in a separate file.
 */
function provenanceHeader(meta: ExportMeta): string[] {
  return [
    "# Volby do zastupitelstev obcí 2026",
    `# Oblast: ${meta.area} (${meta.areaCode})`,
    `# Data zveřejněna: ${meta.publishedAt}`,
    `# Stav: ${meta.isFinal ? "konečné výsledky" : "předběžné výsledky"}`,
    `# Exportováno: ${meta.exportedAt}`,
    "",
  ]
}

/** Assembles a complete CSV document, ready to write as bytes. */
export function buildCsv(meta: ExportMeta, headers: string[], rows: string[][]): string {
  const lines = [...provenanceHeader(meta), csvRow(headers), ...rows.map(csvRow)]
  return BOM + lines.join(LINE_ENDING) + LINE_ENDING
}
