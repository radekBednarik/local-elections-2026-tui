/**
 * Fetch client, exercised against a real local HTTP server rather than a mock, so the
 * behaviour under test is the actual request/response handling.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { join } from "node:path"
import type { Server } from "bun"
import { fetchArchive, fetchDocument, USER_AGENT } from "../../src/sources/client.ts"

let server: Server<undefined>
let base: string
/** Headers of the most recent request, so we can assert on what was sent. */
let lastHeaders: Headers

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(request) {
      lastHeaders = request.headers
      const path = new URL(request.url).pathname

      if (path === "/ok.xml") {
        const etag = 'W/"abc123"'
        if (request.headers.get("if-none-match") === etag) {
          return new Response(null, { status: 304, headers: { etag } })
        }
        return new Response("<VYSLEDKY/>", {
          headers: { etag, "last-modified": "Fri, 09 Oct 2026 21:15:00 GMT" },
        })
      }
      if (path === "/missing.xml") return new Response("nope", { status: 404 })
      if (path === "/boom.xml") return new Response("oops", { status: 503 })
      if (path === "/slow.xml") return new Promise(() => {}) as never
      if (path === "/archive.zip") return new Response(new Uint8Array([80, 75, 3, 4]))
      return new Response("not found", { status: 404 })
    },
  })
  base = `http://localhost:${server.port}`
})

afterAll(() => {
  server.stop(true)
})

describe("successful retrieval", () => {
  test("returns the body and both validators", async () => {
    const result = await fetchDocument(`${base}/ok.xml`)
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.body).toBe("<VYSLEDKY/>")
    expect(result.etag).toBe('W/"abc123"')
    expect(result.lastModified).toBe("Fri, 09 Oct 2026 21:15:00 GMT")
  })

  test("identifies itself to the publisher (FR-024)", async () => {
    await fetchDocument(`${base}/ok.xml`)
    expect(lastHeaders.get("user-agent")).toBe(USER_AGENT)
    expect(USER_AGENT).toContain("volby-kv2026")
  })
})

describe("conditional requests (FR-023)", () => {
  test("sends the stored ETag and gets 304 back", async () => {
    const result = await fetchDocument(`${base}/ok.xml`, { validators: { etag: 'W/"abc123"' } })
    expect(result.kind).toBe("not-modified")
    expect(lastHeaders.get("if-none-match")).toBe('W/"abc123"')
  })

  test("sends If-Modified-Since when a last-modified value is stored", async () => {
    await fetchDocument(`${base}/ok.xml`, {
      validators: { lastModified: "Fri, 09 Oct 2026 21:15:00 GMT" },
    })
    expect(lastHeaders.get("if-modified-since")).toBe("Fri, 09 Oct 2026 21:15:00 GMT")
  })

  test("a stale ETag still returns content", async () => {
    const result = await fetchDocument(`${base}/ok.xml`, { validators: { etag: 'W/"old"' } })
    expect(result.kind).toBe("ok")
  })
})

describe("failure outcomes are values, never throws (FR-046)", () => {
  test("404 is its own outcome, since it is expected before publication (FR-045)", async () => {
    const result = await fetchDocument(`${base}/missing.xml`)
    expect(result.kind).toBe("not-found")
  })

  test("a server error is reported with its status", async () => {
    const result = await fetchDocument(`${base}/boom.xml`)
    expect(result.kind).toBe("failed")
    if (result.kind !== "failed") return
    expect(result.status).toBe(503)
  })

  test("a timeout is reported, not thrown", async () => {
    const result = await fetchDocument(`${base}/slow.xml`, { timeoutMs: 150 })
    expect(result.kind).toBe("failed")
    if (result.kind !== "failed") return
    expect(result.reason).toContain("časový limit")
  })

  test("an unreachable host is reported, not thrown", async () => {
    const result = await fetchDocument("http://localhost:1/nothing.xml", { timeoutMs: 2000 })
    expect(result.kind).toBe("failed")
  })

  test("an external abort signal cancels the request", async () => {
    const controller = new AbortController()
    const pending = fetchDocument(`${base}/slow.xml`, { signal: controller.signal })
    controller.abort()
    const result = await pending
    expect(result.kind).toBe("failed")
  })
})

describe("batch sources are refused (FR-012)", () => {
  test.each([
    "okrsky/vysledky_okrsky_00001.xml",
    "obce_d/vysledky_obce_00001.xml",
    "vysledky_okrsky.xml",
    "vysledky_obce.xml",
  ])("refuses %s without issuing a request", async (path) => {
    const result = await fetchDocument(`${base}/${path}`)
    expect(result.kind).toBe("failed")
    if (result.kind !== "failed") return
    expect(result.reason).toContain("Dávkový")
    // No status, because no request was made at all.
    expect(result.status).toBeUndefined()
  })
})

describe("file:// sources (FR-014a)", () => {
  const fixture = join(import.meta.dir, "../../fixtures/2026/vysledky.xml")

  test("reads a local document with no network", async () => {
    const result = await fetchDocument(`file://${fixture}`)
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.body).toContain("VYSLEDKY")
  })

  test("a missing local file is not-found, matching the HTTP case", async () => {
    const result = await fetchDocument(`file://${join(import.meta.dir, "nope.xml")}`)
    expect(result.kind).toBe("not-found")
  })

  test("preserves Czech diacritics from a local file (FR-026)", async () => {
    const council = join(import.meta.dir, "../../fixtures/2026/vysledky_obec_551082.xml")
    const result = await fetchDocument(`file://${council}`)
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.body).toContain("Brno-Bohunice")
    expect(result.body).toMatch(/[ěščřžýáíéúůďťňó]/i)
  })
})

describe("archives", () => {
  test("retrieves bytes over HTTP", async () => {
    const result = await fetchArchive(`${base}/archive.zip`)
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    // PK\x03\x04 - the ZIP magic number.
    expect([...result.bytes.slice(0, 4)]).toEqual([80, 75, 3, 4])
  })

  test("reads a local archive", async () => {
    const zip = join(import.meta.dir, "../../fixtures/2026/ciselniky.zip")
    const result = await fetchArchive(`file://${zip}`)
    expect(result.kind).toBe("ok")
    if (result.kind !== "ok") return
    expect(result.bytes.length).toBeGreaterThan(1000)
  })

  test("a missing archive is not-found", async () => {
    const result = await fetchArchive(`${base}/nothing.zip`)
    expect(result.kind).toBe("not-found")
  })
})
