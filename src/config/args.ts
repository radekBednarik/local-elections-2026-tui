/**
 * Command-line parsing (task T017).
 *
 * The contract is specs/001-election-results-tui/contracts/cli.md. Two rules there are
 * easy to get subtly wrong and are enforced here:
 *
 *   - An interval below the floor is CLAMPED and reported, never rejected (FR-017).
 *     A careless value must not stop the application from starting.
 *   - An unknown option is an error, never silently ignored.
 */

import { parseArgs } from "node:util"

/**
 * The publisher's cache has 60-second granularity, so polling faster returns identical
 * bytes while adding load. This is a hard floor (FR-016), not a default.
 */
export const MIN_INTERVAL_SECONDS = 60

export const DEFAULT_BASE_URL = "https://volby.gov.cz"
export const DEFAULT_ELECTION = "kv2026"
export const DEFAULT_DATE = "20261009"

export type LogLevel = "error" | "warn" | "info" | "debug"
const LOG_LEVELS: readonly LogLevel[] = ["error", "warn", "info", "debug"]

export interface CliOptions {
  election: string
  date: string
  baseUrl: string
  intervalSeconds: number
  dataDir: string | null
  /** Where exports are written. Defaults to the working directory. */
  exportDir: string
  refreshReference: boolean
  logLevel: LogLevel
  showHelp: boolean
  showVersion: boolean
}

export type ParseResult =
  | { ok: true; options: CliOptions; warnings: string[] }
  | { ok: false; message: string; exitCode: 1 }

function fail(message: string): ParseResult {
  return { ok: false, message, exitCode: 1 }
}

/** True for a real calendar date written as YYYYMMDD. */
export function isValidDateString(value: string): boolean {
  if (!/^\d{8}$/.test(value)) return false
  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(4, 6))
  const day = Number(value.slice(6, 8))
  if (month < 1 || month > 12 || day < 1) return false

  // Round-tripping through Date catches month lengths and leap years without a table.
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function normaliseBaseUrl(value: string): string | null {
  if (!/^(https?|file):\/\//.test(value)) return null
  return value.endsWith("/") ? value.slice(0, -1) : value
}

export function parseCliArgs(argv: string[]): ParseResult {
  let raw: ReturnType<typeof parseArgs<{ options: typeof OPTION_SPEC; args: string[] }>>
  try {
    raw = parseArgs({
      args: argv,
      options: OPTION_SPEC,
      strict: true,
      allowPositionals: false,
    })
  } catch (error) {
    // node:util throws on unknown options and missing values. Surfacing the message
    // keeps the wording accurate rather than paraphrasing it.
    return fail(error instanceof Error ? error.message : String(error))
  }

  const values = raw.values
  const warnings: string[] = []

  const date = values.date ?? DEFAULT_DATE
  if (!isValidDateString(date)) {
    return fail(`--date must be a real date in YYYYMMDD form, got ${JSON.stringify(date)}`)
  }

  const baseUrlRaw = values["base-url"] ?? DEFAULT_BASE_URL
  const baseUrl = normaliseBaseUrl(baseUrlRaw)
  if (baseUrl === null) {
    return fail(`--base-url must start with http://, https:// or file://, got ${JSON.stringify(baseUrlRaw)}`)
  }

  let intervalSeconds = MIN_INTERVAL_SECONDS
  if (values.interval !== undefined) {
    const parsed = Number(values.interval)
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
      return fail(
        `--interval must be a positive whole number of seconds, got ${JSON.stringify(values.interval)}`,
      )
    }
    if (parsed < MIN_INTERVAL_SECONDS) {
      intervalSeconds = MIN_INTERVAL_SECONDS
      warnings.push(
        `--interval ${parsed} s je pod minimem ${MIN_INTERVAL_SECONDS} s; použije se ${MIN_INTERVAL_SECONDS} s.`,
      )
    } else {
      intervalSeconds = parsed
    }
  }

  const logLevel = (values["log-level"] ?? "info") as LogLevel
  if (!LOG_LEVELS.includes(logLevel)) {
    return fail(`--log-level must be one of ${LOG_LEVELS.join(", ")}, got ${JSON.stringify(logLevel)}`)
  }

  return {
    ok: true,
    warnings,
    options: {
      election: values.election ?? DEFAULT_ELECTION,
      date,
      baseUrl,
      intervalSeconds,
      dataDir: values["data-dir"] ?? null,
      exportDir: values["export-dir"] ?? process.cwd(),
      refreshReference: values["refresh-reference"] === true,
      logLevel,
      showHelp: values.help === true,
      showVersion: values.version === true,
    },
  }
}

const OPTION_SPEC = {
  election: { type: "string" },
  date: { type: "string" },
  "base-url": { type: "string" },
  interval: { type: "string" },
  "data-dir": { type: "string" },
  "export-dir": { type: "string" },
  "refresh-reference": { type: "boolean" },
  "log-level": { type: "string" },
  help: { type: "boolean" },
  version: { type: "boolean" },
} as const

export const USAGE = `Použití: volby-kv2026 [přepínače]

  --election <id>        Volby, výchozí ${DEFAULT_ELECTION}
  --date <RRRRMMDD>      Datum zveřejnění, výchozí ${DEFAULT_DATE}
  --base-url <url>       Jiné umístění dat (http://, https:// nebo file://)
  --interval <sekundy>   Interval stahování, minimum ${MIN_INTERVAL_SECONDS}
  --data-dir <cesta>     Jiný adresář pro data aplikace
  --export-dir <cesta>   Adresář pro exporty, výchozí aktuální adresář
  --refresh-reference    Znovu stáhnout registry a číselníky
  --log-level <úroveň>   error | warn | info | debug, výchozí info
  --version              Vypsat verzi a skončit
  --help                 Vypsat tuto nápovědu a skončit
`
