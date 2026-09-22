/**
 * What a background refresh costs the main thread.
 *
 * Parsing and ingesting a district document is synchronous, and so is every keystroke.
 * If one refresh costs more than a frame, the interface stops answering for that long,
 * and the user experiences it as the CURSOR being slow - which is where they notice it,
 * not where it happens.
 *
 * Measured against the REAL 2022 district documents, which are an order of magnitude
 * larger than the derived fixtures: 238 KB for Prague against 28 KB.
 *
 * Run: bun run tools/verify/ingestcost.ts
 */

import { readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { extractArchiveFile } from "../../src/reference/archive.ts"
import { loadReference } from "../../src/reference/loader.ts"
import { ingestDistrict, ingestNational } from "../../src/sources/ingest.ts"
import { openMemoryDatabase } from "../../src/storage/db.ts"
import { composeScreen } from "../../src/ui/screen.ts"
import { UNSORTED } from "../../src/ui/sort.ts"

const FIXTURES = join(import.meta.dir, "../../fixtures/2026")
const SOURCE = join(import.meta.dir, "../../fixtures/source-2022")

const db = openMemoryDatabase()
const reg = await extractArchiveFile(join(FIXTURES, "reg.zip"))
const cis = await extractArchiveFile(join(FIXTURES, "ciselniky.zip"))
if (!reg.ok || !cis.ok) throw new Error("fixture archives could not be extracted")
loadReference(db, { registry: reg.files, codelists: cis.files })
ingestNational(db, readFileSync(join(FIXTURES, "vysledky.xml"), "utf8"))

function bench(label: string, runs: number, fn: () => void): void {
  for (let i = 0; i < 3; i += 1) fn()
  const samples: number[] = []
  for (let i = 0; i < runs; i += 1) {
    const t = performance.now()
    fn()
    samples.push(performance.now() - t)
  }
  samples.sort((a, b) => a - b)
  console.log(
    `  ${label.padEnd(46)} medián ${(samples[Math.floor(samples.length / 2)] ?? 0)
      .toFixed(1)
      .padStart(7)} ms   nejhorší ${(samples[samples.length - 1] ?? 0).toFixed(1).padStart(7)} ms`,
  )
}

console.log("--- jedno načtení dokumentu okresu, hlavní vlákno ---")

for (const [label, file] of [
  ["derived fixture CZ0642 (19 KB)", join(FIXTURES, "vysledky_obce_okres_CZ0642.xml")],
  ["derived fixture CZ0100 (28 KB)", join(FIXTURES, "vysledky_obce_okres_CZ0100.xml")],
] as const) {
  const xml = readFileSync(file, "utf8")
  const nuts = file.includes("CZ0100") ? "CZ0100" : "CZ0642"
  bench(label, 10, () => {
    ingestDistrict(db, nuts, xml)
  })
}

// The real documents, which is what the application meets against mirrored data and will
// meet on the night.
for (const [nuts, name] of [
  ["CZ0100", "okres_CZ0100.xml"],
  ["CZ0642", "okres_CZ0642.xml"],
] as const) {
  let xml: string
  try {
    xml = readFileSync(join(SOURCE, name), "utf8")
  } catch {
    continue
  }
  const kb = Math.round(statSync(join(SOURCE, name)).size / 1024)
  console.log(`  (skutečný dokument ${name}, ${kb} KB - jiný tvar, jen pro měření velikosti)`)
  bench(`parse only, ${name} (${kb} KB)`, 5, () => {
    // The 2022 shape differs from 2026, so this measures the PARSE and validate cost at a
    // realistic size rather than a successful ingest.
    ingestDistrict(db, nuts, xml)
  })
}

console.log("\n--- pro srovnání: složení obrazovky se seznamem okresů ---")
bench("composeScreen(districts)", 30, () => {
  composeScreen(db, { kind: "districts" }, { width: 105, councilType: "OBEC", sort: UNSORTED })
})

console.log("\nPozn.: aplikace zpracuje až 3 zdroje za tick, tick je každou sekundu.")
