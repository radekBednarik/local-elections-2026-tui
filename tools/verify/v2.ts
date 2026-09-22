/**
 * Quickstart scenario V2, driven headlessly: the real fetch, ingest and render path
 * against the replay harness. The interactive terminal is covered separately by the
 * createTestRenderer tests in tests/ui/.
 */
import { fetchDocument } from "../../src/sources/client.ts"
import { ingestNational } from "../../src/sources/ingest.ts"
import { Scheduler } from "../../src/sources/scheduler.ts"
import { nationalUrl, type SourceLocation } from "../../src/sources/urls.ts"
import { openDatabase } from "../../src/storage/db.ts"
import { renderNationalView } from "../../src/ui/views/national.ts"

const loc: SourceLocation = {
  baseUrl: process.argv[2] ?? "http://localhost:8790",
  election: "kv2026",
  date: "20261009",
}
const db = openDatabase(":memory:")
const scheduler = new Scheduler(db, { intervalSeconds: 60 })
scheduler.subscribeAll([{ key: "national", areaKind: "national", areaId: "" }])

for (let pass = 1; pass <= 3; pass++) {
  const sub = scheduler.get("national")
  const out = await fetchDocument(nationalUrl(loc), {
    validators: { etag: sub?.etag, lastModified: sub?.lastModified },
  })
  if (out.kind === "ok") {
    const r = ingestNational(db, out.body)
    scheduler.recordSuccess("national", { etag: out.etag, lastModified: out.lastModified })
    console.log(`pass ${pass}: ${out.kind}  ingest=${r.ok ? "ok" : r.reason}`)
  } else {
    console.log(`pass ${pass}: ${out.kind}`)
    scheduler.recordSuccess("national")
  }
  if (pass < 3) await new Promise((r) => setTimeout(r, 2500))
}

console.log("\n" + "=".repeat(78))
for (const line of renderNationalView(db, { width: 78 }).slice(0, 18)) console.log(line)
console.log("=".repeat(78))
