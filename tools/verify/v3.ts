/**
 * Quickstart scenario V3: national -> district -> council -> candidates, driven through
 * the real fetch, ingest, routing and render path against the replay harness.
 */
import { join } from "node:path"
import { extractArchiveFile } from "../../src/reference/archive.ts"
import { loadReference } from "../../src/reference/loader.ts"
import { fetchDocument } from "../../src/sources/client.ts"
import { ingestCouncil, ingestDistrict, ingestNational } from "../../src/sources/ingest.ts"
import { type SourceLocation, urlForKey } from "../../src/sources/urls.ts"
import { openDatabase } from "../../src/storage/db.ts"
import { Navigation, type Screen } from "../../src/ui/navigation.ts"
import { composeScreen } from "../../src/ui/screen.ts"

const loc: SourceLocation = {
  baseUrl: process.argv[2] ?? "http://localhost:8795",
  election: "kv2026",
  date: "20261009",
}
const db = openDatabase(":memory:")

const F = join(import.meta.dir, "../../fixtures/2026")
const reg = await extractArchiveFile(join(F, "reg.zip"))
const cis = await extractArchiveFile(join(F, "ciselniky.zip"))
if (!reg.ok || !cis.ok) throw new Error("archives")
loadReference(db, { registry: reg.files, codelists: cis.files })

async function pull(key: string) {
  const out = await fetchDocument(urlForKey(loc, key as never))
  if (out.kind !== "ok") return `FAIL ${key}: ${out.kind}`
  const [kind, id] = key.split(":", 2)
  const r =
    kind === "national"
      ? ingestNational(db, out.body)
      : kind === "district"
        ? ingestDistrict(db, id!, out.body)
        : ingestCouncil(db, id!, out.body)
  return `${key}: ${r.ok ? "ok" : r.reason}`
}

console.log(await pull("national"))
console.log(await pull("district:CZ0642"))
console.log(await pull("council:551082"))

const nav = new Navigation()
const opts = { width: 96, councilType: "OBEC" }
const steps: Screen[] = [
  { kind: "districts" },
  { kind: "district", nuts: "CZ0642" },
  { kind: "council", kodzastup: "551082" },
]
for (const s of steps) nav.push(s)

for (const label of ["district", "council"] as const) {
  const screen = label === "district" ? steps[1]! : steps[2]!
  const c = composeScreen(db, screen, opts)
  console.log(`\n${"=".repeat(96)}`)
  console.log(`[${label}]  rows=${c.rowCount}  firstRow=${c.firstRow}  opens=${JSON.stringify(c.target(0))}`)
  console.log("-".repeat(96))
  for (const line of c.lines.slice(0, 14)) console.log(line)
}

const cand = composeScreen(
  db,
  { kind: "candidates", kodzastup: "551082", vstrana: "768", ballotOrder: null },
  opts,
)
console.log(`\n${"=".repeat(96)}`)
for (const line of cand.lines.slice(0, 10)) console.log(line)
console.log("=".repeat(96))
