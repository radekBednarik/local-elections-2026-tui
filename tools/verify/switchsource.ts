/**
 * The reported case, driven through the real startup path.
 *
 * Fills a data directory as a run against a mirror would, then adopts a different source
 * and checks what the screen shows. This exercises adoptDataset against a REAL on-disk
 * database rather than an in-memory one, because the bug was about what survives a
 * restart.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { extractArchiveFile } from "../../src/reference/archive.ts"
import { loadReference } from "../../src/reference/loader.ts"
import { ingestDistrict, ingestNational } from "../../src/sources/ingest.ts"
import { adoptDataset, readDataset, resetData } from "../../src/storage/dataset.ts"
import { openDatabase } from "../../src/storage/db.ts"
import { composeScreen } from "../../src/ui/screen.ts"

const F = join(import.meta.dir, "../../fixtures/2026")
const MIRROR = { baseUrl: "http://localhost:8787", election: "kv2026", date: "20261009" }
const LIVE = { baseUrl: "https://volby.gov.cz", election: "kv2026", date: "20261009" }

const dir = mkdtempSync(join(tmpdir(), "volby-switch-"))
const path = join(dir, "volby.sqlite")
const opts = { width: 100, councilType: "OBEC" }
const headline = (db: ReturnType<typeof openDatabase>) =>
  composeScreen(db, { kind: "national" }, opts).lines.slice(0, 5).join("\n")

try {
  // --- run one: against the mirror ---
  let db = openDatabase(path)
  adoptDataset(db, MIRROR)
  const reg = await extractArchiveFile(join(F, "reg.zip"))
  const cis = await extractArchiveFile(join(F, "ciselniky.zip"))
  if (!reg.ok || !cis.ok) throw new Error("fixtures")
  loadReference(db, { registry: reg.files, codelists: cis.files })
  ingestNational(db, readFileSync(join(F, "vysledky.xml"), "utf8"))
  ingestDistrict(db, "CZ0642", readFileSync(join(F, "vysledky_obce_okres_CZ0642.xml"), "utf8"))
  console.log("=== běh 1: proti zrcadlu ===")
  console.log(headline(db))
  console.log(`dataset: ${readDataset(db)}`)
  db.close()

  // --- run two: same database, different source ---
  db = openDatabase(path)
  const change = adoptDataset(db, LIVE)
  console.log("\n=== běh 2: stejná databáze, jiný zdroj ===")
  console.log(`smazáno: ${change.cleared}   předchozí: ${change.previous}`)
  console.log(headline(db))
  const empty = composeScreen(db, { kind: "national" }, opts).lines.join("\n")
  const ok = change.cleared && empty.includes("Výsledky zatím nejsou zveřejněny") && !/14\s722/u.test(empty)
  console.log(`\n${ok ? "OK" : "CHYBA"}: aplikace je prázdná a čeká na nová data`)
  db.close()

  // --- run three: --reset against the same source ---
  db = openDatabase(path)
  ingestNational(db, readFileSync(join(F, "vysledky.xml"), "utf8"))
  console.log("\n=== běh 3: --reset proti témuž zdroji ===")
  console.log(`před resetem má data: ${/14\s722/u.test(headline(db))}`)
  resetData(db, LIVE)
  const afterReset = composeScreen(db, { kind: "national" }, opts).lines.join("\n")
  const resetOk = afterReset.includes("Výsledky zatím nejsou zveřejněny")
  console.log(`po resetu prázdná: ${resetOk}`)
  db.close()

  process.exit(ok && resetOk ? 0 : 1)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
