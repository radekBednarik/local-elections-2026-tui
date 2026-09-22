/**
 * Derives the 2026 test fixtures from the real 2022 election data (task T011-T013).
 *
 * Why a script rather than hand-edited XML: the derivation is then reproducible and
 * auditable. Anyone can re-run it against a fresh download and see exactly what was
 * changed, which matters because these fixtures stand in for a data source that does
 * not exist yet.
 *
 * What changes from the 2022 source:
 *   - the generation timestamp becomes an election-night time on 2026-10-09
 *   - district files are trimmed to a handful of municipalities, so fixtures stay
 *     readable and tests stay fast
 *   - nothing else. Element and attribute shapes are carried over untouched, because
 *     2022 and 2026 reference the same schema names (kv_vysledky.xsd,
 *     kv_vysledky_obce_okres.xsd, kv_vysledky_obec.xsd).
 *
 * Usage: bun run tools/fixtures/derive.ts
 */

import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const SOURCE = join(import.meta.dir, "../../fixtures/source-2022")
const TARGET = join(import.meta.dir, "../../fixtures/2026")

/** Election-night timestamp used across the derived fixtures. */
const GENERATED_AT = "2026-10-09T21:15:00"

function read(name: string): string {
  return readFileSync(join(SOURCE, name), "utf8")
}

function write(name: string, content: string): void {
  writeFileSync(join(TARGET, name), content, "utf8")
  console.log(`  ${name}  ${content.length.toLocaleString()} bytes`)
}

/** Replaces the publisher's generation timestamp. */
function restamp(xml: string, at = GENERATED_AT): string {
  return xml.replace(/DATUM_CAS_GENEROVANI="[^"]*"/, `DATUM_CAS_GENEROVANI="${at}"`)
}

/** Keeps only the named councils in a district document, preserving everything else. */
function keepCouncils(xml: string, kodzastup: string[]): string {
  const wanted = new Set(kodzastup)
  // Split on OBEC blocks; keep the prologue, the wanted blocks, and the epilogue.
  const blocks = xml.split(/(?=<OBEC )/)
  const kept = blocks.filter((block, index) => {
    if (index === 0) return true // prologue
    const match = block.match(/^<OBEC KODZASTUP="(\d+)"/)
    return match?.[1] !== undefined && wanted.has(match[1])
  })

  // The final kept block must still carry the closing root tag.
  const closing = xml.match(/<\/VYSLEDKY_OBCE_OKRES>\s*$/)?.[0] ?? "</VYSLEDKY_OBCE_OKRES>\n"
  const body = kept
    .map((block) => block.replace(/<\/VYSLEDKY_OBCE_OKRES>\s*$/, ""))
    .join("")
    .trimEnd()
  return `${body}\n${closing}`
}

console.log("Deriving 2026 fixtures from 2022 source data...")

// National aggregate - carried over whole, it is already compact.
write("vysledky.xml", restamp(read("national.xml")))

// Prague: the city council (OBEC) plus two of its boroughs (MCMO), which is what
// exercises the separate-presentation rule in FR-035.
write(
  "vysledky_obce_okres_CZ0100.xml",
  keepCouncils(restamp(read("okres_CZ0100.xml")), ["554782", "500054", "500224"]),
)

// Brno-mesto: a statutory city plus two boroughs.
write(
  "vysledky_obce_okres_CZ0642.xml",
  keepCouncils(restamp(read("okres_CZ0642.xml")), ["582786", "551082", "551325"]),
)

// Individual councils - carried over whole.
write("vysledky_obec_551082.xml", restamp(read("obec_551082.xml")))
write("vysledky_obec_582786.xml", restamp(read("obec_582786.xml")))
write("vysledky_obec_554782.xml", restamp(read("obec_554782.xml")))

console.log("Done.")
