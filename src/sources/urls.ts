/**
 * Source URL construction (task T039).
 *
 * The contract is contracts/data-sources.md. The single most important property of this
 * module is NEGATIVE: it must be impossible to construct a URL for a batch ("dávka")
 * source, because FR-012 excludes them. There is no function here that could build one,
 * and `isBatchPath` exists so a guard can assert that nothing else did either.
 */

export interface SourceLocation {
  /** Base location: the official portal, a replay harness, or a file:// directory. */
  baseUrl: string
  /** Election identifier, e.g. `kv2026`. */
  election: string
  /** Publication date directory, `YYYYMMDD`. */
  date: string
}

/** Identifies one polled source. Used as the `source_key` in storage. */
export type SourceKey = `national` | `district:${string}` | `council:${string}`

/** `{base}/appdata/{election}/{date}/odata` */
function odataRoot(loc: SourceLocation): string {
  return `${loc.baseUrl}/appdata/${loc.election}/${loc.date}/odata`
}

/** Nationwide aggregate results (FR-007). */
export function nationalUrl(loc: SourceLocation): string {
  return `${odataRoot(loc)}/vysledky.xml`
}

/**
 * What a district NUTS code looks like: CZ, three digits, one alphanumeric.
 *
 * THE ONE DEFINITION. The reference loader used to carry its own - "six characters long"
 * - and the two disagreed about exactly one code: `CZZZZZ`, the Eurostat extra-regio
 * entry, which the real 2026 codelist ships. The loader recorded it as a district, the
 * application subscribed to it, and building its URL threw inside the refresh loop.
 */
const DISTRICT_NUTS = /^CZ\d{3}[0-9A-Z]$/

/** True when this NUTS code names a district that has a per-district result file. */
export function isDistrictNuts(nuts: string): boolean {
  return DISTRICT_NUTS.test(nuts)
}

/** One district and all its councils (FR-008). `nuts` is a six-character code. */
export function districtUrl(loc: SourceLocation, nuts: string): string {
  if (!isDistrictNuts(nuts)) {
    throw new TypeError(`Neplatný kód okresu NUTS: ${JSON.stringify(nuts)}`)
  }
  return `${odataRoot(loc)}/okresy/vysledky_obce_okres_${nuts}.xml`
}

/** One council (FR-009). `kodzastup` is the registry code. */
export function councilUrl(loc: SourceLocation, kodzastup: string): string {
  if (!/^\d{5,6}$/.test(kodzastup)) {
    throw new TypeError(`Neplatný kód zastupitelstva: ${JSON.stringify(kodzastup)}`)
  }
  return `${odataRoot(loc)}/zastup/vysledky_obec_${kodzastup}.xml`
}

/** Registry archive, retrieved once on first run (FR-020). */
export function registryArchiveUrl(loc: SourceLocation, name: string): string {
  return `${loc.baseUrl}/opendata/${loc.election}/${name}`
}

/** Builds the URL for a source key. */
export function urlForKey(loc: SourceLocation, key: SourceKey): string {
  if (key === "national") return nationalUrl(loc)
  const [kind, id] = key.split(":", 2)
  if (kind === "district" && id !== undefined) return districtUrl(loc, id)
  if (kind === "council" && id !== undefined) return councilUrl(loc, id)
  throw new TypeError(`Neznámý zdroj: ${JSON.stringify(key)}`)
}

/**
 * True for a path belonging to a batch ("dávka") source, which FR-012 excludes.
 *
 * Covers the numbered batches and their latest-batch aliases. Nothing in this module
 * can produce such a path; this exists so a guard can prove that at runtime and in
 * tests, rather than relying on the absence of a builder.
 */
export function isBatchPath(url: string): boolean {
  return /\/(okrsky|obce_d)\//.test(url) || /vysledky_(okrsky|obce)(_\d+)?\.xml$/.test(url)
}
