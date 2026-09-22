/**
 * Replay harness (task T016).
 *
 * Serves the fixtures in `fixtures/2026/` at the same paths the real publisher uses,
 * with the count advancing over a compressed clock so a full election night can be
 * rehearsed in minutes rather than twelve hours.
 *
 * This is a development and verification tool. It is never bundled into the shipped
 * binary; the application reaches it only through `--base-url` (FR-014a).
 *
 * Usage:
 *   bun run tools/replay/server.ts [--port 8787] [--duration 300] [--fail-after 120]
 *
 *   --port         port to listen on (default 8787)
 *   --duration     seconds for the count to go from 0% to 100% (default 300)
 *   --fail-after   seconds after which every request fails, to exercise FR-043/FR-044
 *   --election     election id in the path (default kv2026)
 *   --date         date directory in the path (default 20261009)
 */

import { join } from "node:path"
import { parseArgs } from "node:util"

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    port: { type: "string", default: "8787" },
    duration: { type: "string", default: "300" },
    "fail-after": { type: "string" },
    election: { type: "string", default: "kv2026" },
    date: { type: "string", default: "20261009" },
  },
  strict: true,
})

const PORT = Number(values.port)
const DURATION_MS = Number(values.duration) * 1000
const FAIL_AFTER_MS = values["fail-after"] ? Number(values["fail-after"]) * 1000 : null
const PREFIX = `/appdata/${values.election}/${values.date}/odata`
const FIXTURES = join(import.meta.dir, "../../fixtures/2026")

const startedAt = Date.now()

/** 0 at launch, 1 once the count is complete. */
function progress(): number {
  return Math.min(1, (Date.now() - startedAt) / DURATION_MS)
}

/**
 * Rewrites a fixture so it reflects a partially completed count.
 *
 * Districts counted, voters, envelopes and votes all scale with progress; percentages
 * are recomputed from the scaled values so the document stays internally consistent.
 * `JE_SPOCTENO` only becomes true at 100%, which is what drives the provisional/final
 * distinction in FR-022.
 */
function atProgress(xml: string, p: number): string {
  const scale = (value: number) => Math.floor(value * p)

  let out = xml.replace(
    /OKRSKY_CELKEM="(\d+)" OKRSKY_ZPRAC="(\d+)" OKRSKY_ZPRAC_PROC="[\d.]+"/g,
    (_match, total: string, counted: string) => {
      const totalN = Number(total)
      const countedN = Math.min(Number(counted), Math.max(0, scale(Number(counted))))
      const pct = totalN === 0 ? 0 : (countedN / totalN) * 100
      return `OKRSKY_CELKEM="${total}" OKRSKY_ZPRAC="${countedN}" OKRSKY_ZPRAC_PROC="${pct.toFixed(2)}"`
    },
  )

  out = out.replace(/VYDANE_OBALKY="(\d+)"/g, (_m, v: string) => `VYDANE_OBALKY="${scale(Number(v))}"`)
  out = out.replace(/ODEVZDANE_OBALKY="(\d+)"/g, (_m, v: string) => `ODEVZDANE_OBALKY="${scale(Number(v))}"`)
  out = out.replace(/PLATNE_HLASY="(\d+)"/g, (_m, v: string) => `PLATNE_HLASY="${scale(Number(v))}"`)
  out = out.replace(/ HLASY="(\d+)"/g, (_m, v: string) => ` HLASY="${scale(Number(v))}"`)

  if (p < 1) {
    out = out.replace(/JE_SPOCTENO="true"/g, 'JE_SPOCTENO="false"')
  }

  // The publisher's generation timestamp advances with the count. The application must
  // take "last updated" from here rather than from its own clock.
  const generated = new Date(startedAt + (Date.now() - startedAt)).toISOString().slice(0, 19)
  out = out.replace(/DATUM_CAS_GENEROVANI="[^"]*"/, `DATUM_CAS_GENEROVANI="${generated}"`)

  return out
}

/** Maps a request path to a fixture file, or null when the path is not served. */
function resolveFixture(pathname: string): string | null {
  if (!pathname.startsWith(PREFIX)) return null
  const rest = pathname.slice(PREFIX.length)

  const national = rest === "/vysledky.xml"
  const district = rest.match(/^\/okresy\/(vysledky_obce_okres_CZ\d{4}\.xml)$/)
  const council = rest.match(/^\/zastup\/(vysledky_obec_\d+\.xml)$/)

  if (national) return join(FIXTURES, "vysledky.xml")
  if (district?.[1]) return join(FIXTURES, district[1])
  if (council?.[1]) return join(FIXTURES, council[1])
  return null
}

const server = Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url)

    if (FAIL_AFTER_MS !== null && Date.now() - startedAt > FAIL_AFTER_MS) {
      console.log(`503 ${url.pathname}  (--fail-after elapsed)`)
      return new Response("replay harness: simulated outage", { status: 503 })
    }

    const path = resolveFixture(url.pathname)
    if (path === null) {
      console.log(`404 ${url.pathname}`)
      return new Response("not found", { status: 404 })
    }

    const file = Bun.file(path)
    if (!(await file.exists())) {
      // A genuine 404 is the expected state before publication begins (FR-045).
      console.log(`404 ${url.pathname}  (no fixture)`)
      return new Response("not found", { status: 404 })
    }

    const p = progress()
    const body = atProgress(await file.text(), p)

    // A weak validator derived from the content, so conditional requests (FR-023)
    // can be exercised: it changes only when the served bytes change.
    const etag = `W/"${Bun.hash(body).toString(16)}"`
    if (request.headers.get("if-none-match") === etag) {
      console.log(`304 ${url.pathname}  (${(p * 100).toFixed(0)}%)`)
      return new Response(null, { status: 304, headers: { etag } })
    }

    console.log(`200 ${url.pathname}  (${(p * 100).toFixed(0)}%)`)
    return new Response(body, {
      headers: { "content-type": "application/xml; charset=utf-8", etag },
    })
  },
})

console.log(`Replay harness on http://localhost:${server.port}${PREFIX}`)
console.log(`  count reaches 100% after ${values.duration}s`)
if (FAIL_AFTER_MS !== null) console.log(`  all requests fail after ${values["fail-after"]}s`)
console.log(`  point the app at:  --base-url http://localhost:${server.port}`)
