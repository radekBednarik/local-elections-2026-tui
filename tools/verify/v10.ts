/** Quickstart scenario V10: export a real table and inspect the bytes written. */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { reportForScreen } from "../../src/export/report.ts"
import { csvForScreen } from "../../src/export/tables.ts"
import { suggestFilename, writeExport } from "../../src/export/writer.ts"
import { extractArchiveFile } from "../../src/reference/archive.ts"
import { loadReference } from "../../src/reference/loader.ts"
import { ingestDistrict } from "../../src/sources/ingest.ts"
import { openDatabase } from "../../src/storage/db.ts"

const F = join(import.meta.dir, "../../fixtures/2026")
const out = process.argv[2] ?? "."
const db = openDatabase(":memory:")
const reg = await extractArchiveFile(join(F, "reg.zip"))
const cis = await extractArchiveFile(join(F, "ciselniky.zip"))
if (!reg.ok || !cis.ok) throw new Error("archives")
loadReference(db, { registry: reg.files, codelists: cis.files })
ingestDistrict(db, "CZ0642", readFileSync(join(F, "vysledky_obce_okres_CZ0642.xml"), "utf8"))

const csv = csvForScreen(db, { kind: "council", kodzastup: "551082" })!
const csvPath = join(out, suggestFilename(csv.areaLabel, "csv"))
console.log(JSON.stringify(await writeExport(csvPath, csv.content, { overwrite: true })))

const bytes = readFileSync(csvPath)
console.log(
  `\nfirst 3 bytes: ${[...bytes.slice(0, 3)].map((b) => b.toString(16).padStart(2, "0")).join(" ")}  (ef bb bf = UTF-8 BOM)`,
)
console.log("--- file contents ---")
console.log(readFileSync(csvPath, "utf8").split("\r\n").slice(0, 12).join("\n"))

const rep = reportForScreen(db, { kind: "council", kodzastup: "551082" })!
const repPath = join(out, suggestFilename(rep.areaLabel, "txt"))
await writeExport(repPath, rep.content, { overwrite: true })
console.log("\n--- report ---")
console.log(readFileSync(repPath, "utf8").split("\n").slice(0, 18).join("\n"))
