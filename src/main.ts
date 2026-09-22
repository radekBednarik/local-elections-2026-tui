/**
 * Entry point.
 *
 * Responsibilities: parse arguments, open storage, ensure reference data, start the
 * interface. Everything that can fail before the terminal is taken over reports on
 * stderr and exits; once the interface is running, nothing may terminate the process
 * except the user (FR-046).
 */

import { mkdirSync } from "node:fs"
import { parseCliArgs, USAGE } from "./config/args.ts"
import { resolvePaths } from "./config/paths.ts"
import { createLogger } from "./logging/logger.ts"
import { extractArchive } from "./reference/archive.ts"
import { invalidateReference, isReferenceLoaded, loadReference } from "./reference/loader.ts"
import { fetchArchive } from "./sources/client.ts"
import { Scheduler } from "./sources/scheduler.ts"
import { registryArchiveUrl, type SourceLocation } from "./sources/urls.ts"
import { openDatabase } from "./storage/db.ts"
import { App } from "./ui/app.ts"

const VERSION = "0.1.0"

/** Dated names of the published reference archives. */
const REGISTRY_ARCHIVE = "KV2026reg20260915_xml.zip"
const CODELIST_ARCHIVE = "KV2026ciselniky20260915_xml.zip"

async function main(): Promise<number> {
  const parsed = parseCliArgs(Bun.argv.slice(2))
  if (!parsed.ok) {
    process.stderr.write(`${parsed.message}\n\n${USAGE}`)
    return parsed.exitCode
  }

  const { options, warnings } = parsed
  for (const warning of warnings) process.stderr.write(`${warning}\n`)

  if (options.showVersion) {
    process.stdout.write(`volby-kv2026 ${VERSION}\n`)
    return 0
  }
  if (options.showHelp) {
    process.stdout.write(USAGE)
    return 0
  }

  const paths = resolvePaths({ platform: process.platform, env: process.env, override: options.dataDir })
  try {
    mkdirSync(paths.dataDir, { recursive: true })
  } catch (error) {
    process.stderr.write(`Nelze vytvořit adresář ${paths.dataDir}: ${String(error)}\n`)
    return 2
  }

  const log = createLogger(paths.log, options.logLevel)
  log.info("Start", { version: VERSION, dataDir: paths.dataDir, election: options.election })

  let db: ReturnType<typeof openDatabase>
  try {
    db = openDatabase(paths.database)
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 2
  }

  const location: SourceLocation = {
    baseUrl: options.baseUrl,
    election: options.election,
    date: options.date,
  }

  if (options.refreshReference) invalidateReference(db)
  // Reference data is retrieved once, ever. A failure here is not fatal: results still
  // display, degraded to numeric codes where a name cannot be resolved (FR-011).
  if (!isReferenceLoaded(db)) {
    await loadReferenceData(db, location, log)
  }

  const scheduler = new Scheduler(db, { intervalSeconds: options.intervalSeconds })
  scheduler.subscribeAll([{ key: "national", areaKind: "national", areaId: "" }])

  const app = new App({ db, options, log, scheduler })
  try {
    await app.start()
  } catch (error) {
    app.stop()
    process.stderr.write(`Rozhraní se nepodařilo spustit: ${String(error)}\n`)
    log.error("Spuštění rozhraní selhalo", error)
    return 2
  }

  // The renderer owns the process from here; App.stop() releases it.
  return 0
}

async function loadReferenceData(
  db: ReturnType<typeof openDatabase>,
  location: SourceLocation,
  log: ReturnType<typeof createLogger>,
): Promise<void> {
  process.stderr.write("Stahuji registry a číselníky (jen při prvním spuštění)…\n")

  const [registry, codelists] = await Promise.all([
    fetchArchive(registryArchiveUrl(location, REGISTRY_ARCHIVE)),
    fetchArchive(registryArchiveUrl(location, CODELIST_ARCHIVE)),
  ])

  if (registry.kind !== "ok" || codelists.kind !== "ok") {
    const reason = registry.kind !== "ok" ? registry : codelists
    const detail = "reason" in reason ? reason.reason : reason.kind
    log.warn("Referenční data se nepodařilo stáhnout", { detail })
    process.stderr.write(`Registry se nepodařilo stáhnout (${detail}). Pokračuji bez názvů.\n`)
    return
  }

  const registryFiles = extractArchive(registry.bytes)
  const codelistFiles = extractArchive(codelists.bytes)
  if (!registryFiles.ok || !codelistFiles.ok) {
    log.warn("Referenční archiv nelze rozbalit")
    return
  }

  const report = loadReference(db, { registry: registryFiles.files, codelists: codelistFiles.files }, log)
  log.info("Referenční data", report.counts)
}

main()
  .then((code) => {
    // Exit only on a pre-interface failure or an immediate command such as --help.
    // Once the renderer is running the process stays alive until the user quits.
    if (code !== 0) process.exit(code)
  })
  .catch((error: unknown) => {
    process.stderr.write(`Neočekávaná chyba: ${String(error)}\n`)
    process.exit(2)
  })
