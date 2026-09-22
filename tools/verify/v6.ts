/** Quickstart V6: reference data is fetched once, and never again (FR-020a, SC-014). */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { extractArchive } from "../../src/reference/archive.ts"
import { isReferenceLoaded, loadReference } from "../../src/reference/loader.ts"
import { openDatabase } from "../../src/storage/db.ts"

const F = join(import.meta.dir, "../../fixtures/2026")
const path = process.argv[2] ?? "./v6.sqlite"
let fetches = 0

function archives() {
  fetches += 2
  const reg = extractArchive(new Uint8Array(readFileSync(join(F, "reg.zip"))))
  const cis = extractArchive(new Uint8Array(readFileSync(join(F, "ciselniky.zip"))))
  if (!reg.ok || !cis.ok) throw new Error("archives")
  return { registry: reg.files, codelists: cis.files }
}

for (const run of [1, 2, 3]) {
  const db = openDatabase(path)
  if (!isReferenceLoaded(db)) {
    const report = loadReference(db, archives())
    console.log(
      `run ${run}: STAHUJI  (${report.counts.council} zastupitelstev, ${report.counts.district} okresů)`,
    )
  } else {
    console.log(`run ${run}: používám uložená data, nestahuji nic`)
  }
  db.close()
}
console.log(`\ncelkem stažení archivů: ${fetches}  (očekáváno 2 = jen první spuštění)`)
