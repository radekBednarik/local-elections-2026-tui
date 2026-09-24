/**
 * Quickstart scenarios V4 (hostile network) and V5 (malformed input), showing the
 * user-visible output at each stage. Drives a controllable server in-process so the
 * outage and the recovery are deterministic.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fetchDocument } from "../../src/sources/client.ts"
import { ingestNational } from "../../src/sources/ingest.ts"
import { Scheduler } from "../../src/sources/scheduler.ts"
import { openDatabase } from "../../src/storage/db.ts"
import { sourceStatus } from "../../src/ui/components/status.ts"
import { renderNationalView } from "../../src/ui/views/national.ts"

const F = join(import.meta.dir, "../../fixtures")
const NATIONAL = readFileSync(join(F, "2026/vysledky.xml"), "utf8")
const MALFORMED = readFileSync(join(F, "edge-cases/malformed.xml"), "utf8")

let mode: "ok" | "down" | "garbage" = "ok"
const server = Bun.serve({
  port: 0,
  fetch() {
    if (mode === "down") return new Response("unavailable", { status: 503 })
    if (mode === "garbage") return new Response(MALFORMED)
    return new Response(NATIONAL)
  },
})
const url = `http://localhost:${server.port}/vysledky.xml`

const db = openDatabase(":memory:")
const scheduler = new Scheduler(db, { intervalSeconds: 60 })
scheduler.subscribeAll([{ key: "national", areaKind: "national", areaId: "" }])

async function pass(label: string, at = new Date()) {
  const sub = scheduler.get("national")
  const out = await fetchDocument(url, { validators: { etag: sub?.etag } })
  let what: string
  if (out.kind === "ok") {
    const r = ingestNational(db, out.body)
    if (r.ok) {
      scheduler.recordSuccess("national", { etag: out.etag }, at)
      what = "ok"
    } else {
      scheduler.recordFailure("national", r.reason, at)
      what = "ODMÍTNUTO"
    }
  } else if (out.kind === "not-modified") {
    scheduler.recordSuccess("national", {}, at)
    what = "304"
  } else {
    scheduler.recordFailure("national", out.kind === "failed" ? out.reason : "404", at)
    what = "SELHALO"
  }

  const s = scheduler.get("national")
  const warn = sourceStatus(scheduler.all())?.text
  const head = renderNationalView(db, { width: 92 })[4] ?? "(žádná data)"
  console.log(`\n--- ${label} -> ${what} (selhání: ${s?.consecutiveFailures}) ---`)
  console.log(`  ${head.trim()}`)
  console.log(`  ${warn ?? "(bez varování)"}`)
}

console.log("V4: hostile network")
await pass("1. server běží")
mode = "down"
await pass("2. server vypadl")
await pass("3. stále vypadlý")
mode = "ok"
await pass("4. server se vrátil", new Date(Date.now() + 900_000))

console.log("\n\nV5: malformed input")
mode = "garbage"
await pass("5. poškozený dokument")
mode = "ok"
await pass("6. opět v pořádku", new Date(Date.now() + 1_800_000))

server.stop(true)
