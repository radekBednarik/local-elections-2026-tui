/**
 * HTTP client (task T040).
 *
 * Built on Bun's `fetch`; no dependency is needed (research R6). The contract is
 * contracts/data-sources.md.
 *
 * Every outcome is a value, never an exception. FR-046 forbids the application
 * terminating because of a network error, so a caller that handles the returned union
 * cannot be surprised by a throw from here.
 */

import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { isBatchPath } from "./urls.ts"

/** Sent so the publisher can attribute this traffic (FR-024). */
export const USER_AGENT = "volby-kv2026/0.2.0 (+https://github.com/radekBednarik/local-elections-2026-tui)"

const DEFAULT_TIMEOUT_MS = 20_000

/** Validators stored from a previous response, for conditional requests (FR-023). */
export interface Validators {
  etag?: string | null
  lastModified?: string | null
}

export type FetchOutcome =
  /** New content. */
  | { kind: "ok"; body: string; etag: string | null; lastModified: string | null }
  /** Unchanged since the stored validators: keep the current snapshot. */
  | { kind: "not-modified" }
  /** Expected before publication begins (FR-045). */
  | { kind: "not-found" }
  /** Server error, timeout, DNS failure - retry with backoff (FR-043). */
  | { kind: "failed"; reason: string; status?: number }

export interface FetchOptions {
  validators?: Validators
  timeoutMs?: number
  signal?: AbortSignal
}

/**
 * Retrieves one document.
 *
 * A `file://` base is supported so tests and the replay harness can run with no network
 * at all (FR-014a). Conditional-request handling is skipped for files, which have no
 * validators.
 */
export async function fetchDocument(url: string, options: FetchOptions = {}): Promise<FetchOutcome> {
  // A batch source must never be requested (FR-012). Nothing in urls.ts can build one,
  // so reaching here means a caller constructed a URL by hand; refuse rather than
  // quietly widen the scope the user explicitly excluded.
  if (isBatchPath(url)) {
    return { kind: "failed", reason: `Dávkový zdroj je mimo rozsah aplikace: ${url}` }
  }

  if (url.startsWith("file://")) return fetchFile(url)

  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort()
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  // An externally supplied signal (application shutdown) must also cancel the request.
  const onAbort = () => {
    controller.abort()
  }
  options.signal?.addEventListener("abort", onAbort, { once: true })

  try {
    const headers: Record<string, string> = { "user-agent": USER_AGENT, accept: "application/xml" }
    if (options.validators?.etag) headers["if-none-match"] = options.validators.etag
    if (options.validators?.lastModified) headers["if-modified-since"] = options.validators.lastModified

    const response = await fetch(url, { headers, signal: controller.signal, redirect: "follow" })

    if (response.status === 304) return { kind: "not-modified" }
    if (response.status === 404) return { kind: "not-found" }
    if (!response.ok) {
      return { kind: "failed", reason: `Server odpověděl ${response.status}`, status: response.status }
    }

    return {
      kind: "ok",
      body: await response.text(),
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
    }
  } catch (error) {
    return { kind: "failed", reason: describeError(error) }
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener("abort", onAbort)
  }
}

async function fetchFile(url: string): Promise<FetchOutcome> {
  try {
    const path = url.startsWith("file:///") ? fileURLToPath(url) : url.slice("file://".length)
    const body = await readFile(path, "utf8")
    return { kind: "ok", body, etag: null, lastModified: null }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT") return { kind: "not-found" }
    return { kind: "failed", reason: describeError(error) }
  }
}

/** Turns an unknown throw into a message a user can act on. */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.name === "TimeoutError") {
      return "Vypršel časový limit požadavku"
    }
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "Server se nepodařilo najít (DNS)"
    if (code === "ECONNREFUSED") return "Spojení odmítnuto"
    if (code === "ECONNRESET") return "Spojení přerušeno"
    return error.message
  }
  return String(error)
}

/** Retrieves a binary archive. Same outcome shape, with bytes instead of text. */
export async function fetchArchive(
  url: string,
  options: FetchOptions = {},
): Promise<{ kind: "ok"; bytes: Uint8Array } | Exclude<FetchOutcome, { kind: "ok" }>> {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => {
      controller.abort()
      // Archives are tens of megabytes; they get a longer allowance than a result file.
    },
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS * 6,
  )

  try {
    if (url.startsWith("file://")) {
      const path = url.startsWith("file:///") ? fileURLToPath(url) : url.slice("file://".length)
      return { kind: "ok", bytes: new Uint8Array(await Bun.file(path).arrayBuffer()) }
    }

    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT },
      signal: controller.signal,
    })
    if (response.status === 404) return { kind: "not-found" }
    if (!response.ok) {
      return { kind: "failed", reason: `Server odpověděl ${response.status}`, status: response.status }
    }
    return { kind: "ok", bytes: new Uint8Array(await response.arrayBuffer()) }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT") return { kind: "not-found" }
    return { kind: "failed", reason: describeError(error) }
  } finally {
    clearTimeout(timeout)
  }
}
