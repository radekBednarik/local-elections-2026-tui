/** Quickstart scenario V8: search by partial name, with and without diacritics. */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { extractArchiveFile } from "../../src/reference/archive.ts"
import { loadReference } from "../../src/reference/loader.ts"
import { ingestDistrict } from "../../src/sources/ingest.ts"
import { openDatabase } from "../../src/storage/db.ts"
import { applySearchKey } from "../../src/ui/search-input.ts"
import { renderSearch } from "../../src/ui/views/search.ts"

const F = join(import.meta.dir, "../../fixtures/2026")
const db = openDatabase(":memory:")
const reg = await extractArchiveFile(join(F, "reg.zip"))
const cis = await extractArchiveFile(join(F, "ciselniky.zip"))
if (!reg.ok || !cis.ok) throw new Error("archives")
loadReference(db, { registry: reg.files, codelists: cis.files })
ingestDistrict(db, "CZ0642", readFileSync(join(F, "vysledky_obce_okres_CZ0642.xml"), "utf8"))

for (const typed of ["bohunice", "BOHUNICE", "Brzobohatý", "brzobohaty", "spolecne"]) {
  // Type it character by character, through the real key handler.
  let q = ""
  for (const c of typed) {
    const r = applySearchKey(q, { name: c, sequence: c })
    if (r.handled) q = r.query
  }
  const v = renderSearch(db, q, 92)
  console.log(`\n=== typed "${q}" -> ${v.hits.length} výsledků ===`)
  for (const line of v.lines.slice(2, 8)) console.log(line)
}
