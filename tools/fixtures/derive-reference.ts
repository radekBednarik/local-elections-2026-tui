/**
 * Derives scoped reference fixtures from the real 2026 archives (task T014).
 *
 * The published archives are far too large to commit: kvrk.xml alone is 110 MB
 * uncompressed, because it holds every candidate in every municipality in the country.
 * The fixtures keep only the rows belonging to the councils used by the result
 * fixtures, which is enough to exercise every join the application performs.
 *
 * Code lists are kept whole where they are small, because trimming them would add a
 * filtering step for no benefit.
 *
 * Usage: bun run tools/fixtures/derive-reference.ts
 */

import { join } from "node:path"
import { unzipSync, zipSync } from "fflate"

const SOURCE = join(import.meta.dir, "../../fixtures/source-2026-reg")
const TARGET = join(import.meta.dir, "../../fixtures/2026")

/** The councils covered by the result fixtures, plus Prague and Brno themselves. */
const COUNCILS = new Set(["554782", "500054", "500224", "582786", "551082", "551325"])

const decoder = new TextDecoder("utf-8")
const encoder = new TextEncoder()

/**
 * Keeps only the `<X_ROW>` blocks whose `<KODZASTUP>` is in `COUNCILS`.
 *
 * A regex is adequate and fast here: these documents are machine-generated with one
 * row element per record and no nesting inside a row.
 */
function filterRows(xml: string, rowElement: string): string {
  const open = xml.indexOf(`<${rowElement}>`)
  if (open === -1) return xml

  const header = xml.slice(0, open)
  const footer = xml.slice(xml.lastIndexOf(`</${rowElement}>`) + rowElement.length + 3)

  const rows = xml.matchAll(new RegExp(`<${rowElement}>[\\s\\S]*?</${rowElement}>`, "g"))
  const kept: string[] = []
  for (const match of rows) {
    const code = match[0].match(/<KODZASTUP>(\d+)<\/KODZASTUP>/)?.[1]
    if (code !== undefined && COUNCILS.has(code)) kept.push(match[0])
  }

  return `${header}${kept.join("\n")}${footer}`
}

function report(name: string, before: number, after: number): void {
  const pct = ((after / before) * 100).toFixed(1)
  console.log(
    `  ${name.padEnd(18)} ${(before / 1024).toFixed(0).padStart(7)} KB -> ${(after / 1024).toFixed(0).padStart(6)} KB  (${pct}%)`,
  )
}

console.log("Deriving scoped reference fixtures from the real 2026 archives...")

// Registries: filtered to the fixture councils.
const regSource = unzipSync(
  new Uint8Array(await Bun.file(join(SOURCE, "KV2026reg20260915_xml.zip")).arrayBuffer()),
)
const regOut: Record<string, Uint8Array> = {}
for (const [file, rowElement] of [
  ["kvrzcoco.xml", "KV_RZCOCO_ROW"],
  ["kvros.xml", "KV_ROS_ROW"],
  ["kvrk.xml", "KV_REGKAND_ROW"],
] as const) {
  const raw = regSource[file]
  if (raw === undefined) throw new Error(`missing ${file} in the registry archive`)
  const filtered = encoder.encode(filterRows(decoder.decode(raw), rowElement))
  regOut[file] = filtered
  report(file, raw.length, filtered.length)
}
await Bun.write(join(TARGET, "reg.zip"), zipSync(regOut, { level: 9 }))

// Code lists: kvcoco is filtered (one row per council nationwide); the rest are kept
// whole, since they are small and every result document can reference any of them.
const cisSource = unzipSync(
  new Uint8Array(await Bun.file(join(SOURCE, "KV2026ciselniky20260915_xml.zip")).arrayBuffer()),
)
const cisOut: Record<string, Uint8Array> = {}
for (const [file, raw] of Object.entries(cisSource)) {
  if (file === "kvcoco.xml") {
    const filtered = encoder.encode(filterRows(decoder.decode(raw), "KV_COCO_ROW"))
    cisOut[file] = filtered
    report(file, raw.length, filtered.length)
  } else {
    cisOut[file] = raw
    report(file, raw.length, raw.length)
  }
}
await Bun.write(join(TARGET, "ciselniky.zip"), zipSync(cisOut, { level: 9 }))

const regSize = (await Bun.file(join(TARGET, "reg.zip")).arrayBuffer()).byteLength
const cisSize = (await Bun.file(join(TARGET, "ciselniky.zip")).arrayBuffer()).byteLength
console.log(`\n  reg.zip        ${(regSize / 1024).toFixed(0)} KB`)
console.log(`  ciselniky.zip  ${(cisSize / 1024).toFixed(0)} KB`)
console.log("Done.")
