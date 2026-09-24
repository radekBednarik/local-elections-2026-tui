/**
 * Builds a local mirror of a PREVIOUS election in the 2026 static-file layout, so the
 * shipped binary can be exercised at real scale before 9 October 2026.
 *
 * Why this is needed: 2022 published the same three result sets, but through
 * query-parameter endpoints (`/pls/kv2022/vysledky?datumvoleb=20220923`). The
 * application builds 2026-style static paths (`/appdata/kv2026/20261009/odata/...`), so
 * it cannot read the 2022 server directly. This downloads the former and writes the
 * latter.
 *
 * The payloads are copied verbatim. Only the file layout changes.
 *
 * Usage:
 *   bun run mirror                          # national + all districts + Brno councils
 *   bun run mirror -- --councils CZ0100,CZ0642
 *   bun run mirror -- --districts 5         # a quick subset
 *   bun run mirror -- --out D:/volby-mirror
 */

import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    out: { type: "string", default: "mirror" },
    election: { type: "string", default: "kv2022" },
    date: { type: "string", default: "20220923" },
    /** "all" or a count, for a faster partial mirror. */
    districts: { type: "string", default: "all" },
    /** Districts whose individual councils are also mirrored, comma separated. */
    councils: { type: "string", default: "CZ0642" },
  },
  strict: true,
})

const OUT = resolve(values.out)
const ELECTION = values.election
const DATE = values.date
const SOURCE = `https://volby.gov.cz/pls/${ELECTION}`
const ODATA = join(OUT, "appdata", ELECTION, DATE, "odata")
const OPENDATA = join(OUT, "opendata", ELECTION)

/** The publisher is a public service; this is a courteous rate, not a race. */
const DELAY_MS = 250

let downloaded = 0
let skipped = 0

async function fetchText(url: string): Promise<string | null> {
  const response = await fetch(url, {
    headers: { "user-agent": "volby-kv2026-mirror/0.1 (local testing)" },
  })
  if (!response.ok) return null
  return await response.text()
}

/** Writes one file, skipping the download when it is already mirrored. */
async function mirror(url: string, path: string): Promise<string | null> {
  if (existsSync(path)) {
    skipped++
    return await Bun.file(path).text()
  }
  const body = await fetchText(url)
  if (body === null) return null
  await writeFile(path, body, "utf8")
  downloaded++
  await Bun.sleep(DELAY_MS)
  return body
}

console.log(`Zrcadlím volby ${ELECTION} (${DATE}) do ${OUT}`)
await mkdir(join(ODATA, "okresy"), { recursive: true })
await mkdir(join(ODATA, "zastup"), { recursive: true })
await mkdir(OPENDATA, { recursive: true })

// --- national --------------------------------------------------------------
const national = await mirror(`${SOURCE}/vysledky?datumvoleb=${DATE}`, join(ODATA, "vysledky.xml"))
console.log(national === null ? "  CHYBA: celkové výsledky" : "  celkové výsledky za ČR")

// --- districts -------------------------------------------------------------
// The district list comes from the code list the application itself uses, so the
// mirror covers exactly the districts the application will ask for.
const { unzipSync } = await import("fflate")
const codelists = unzipSync(
  new Uint8Array(await Bun.file(join(import.meta.dir, "../../fixtures/2026/ciselniky.zip")).arrayBuffer()),
)
const nutsText = new TextDecoder().decode(codelists["cnumnuts.xml"] ?? new Uint8Array())
const allDistricts = [...nutsText.matchAll(/<NUTS>(CZ\d{3}[0-9A-Z])<\/NUTS>/g)]
  .map((m) => m[1] as string)
  .filter((n) => n.length === 6)

const wanted =
  values.districts === "all" ? allDistricts : allDistricts.slice(0, Number(values.districts) || 5)

console.log(`  okresy: ${wanted.length}`)
const districtBodies = new Map<string, string>()
for (const [index, nuts] of wanted.entries()) {
  const body = await mirror(
    `${SOURCE}/vysledky_obce_okres?datumvoleb=${DATE}&nuts=${nuts}`,
    join(ODATA, "okresy", `vysledky_obce_okres_${nuts}.xml`),
  )
  if (body !== null) districtBodies.set(nuts, body)
  if ((index + 1) % 10 === 0) console.log(`    ${index + 1}/${wanted.length}`)
}

// --- councils, for the districts asked for ---------------------------------
// Roughly 6,000 councils exist nationwide, far too many to mirror. The application
// fetches a council only when opened, so mirroring a district's worth makes the whole
// drill-down work for that district and leaves the rest returning "not yet published".
const councilDistricts = values.councils
  .split(",")
  .map((s) => s.trim())
  .filter((s) => s !== "")
let councilCount = 0
for (const nuts of councilDistricts) {
  const body = districtBodies.get(nuts)
  if (body === undefined) {
    console.log(`  zastupitelstva ${nuts}: okres nebyl stažen, přeskakuji`)
    continue
  }
  const codes = [...body.matchAll(/KODZASTUP="(\d+)"/g)].map((m) => m[1] as string)
  console.log(`  zastupitelstva ${nuts}: ${codes.length}`)
  for (const code of codes) {
    await mirror(
      `${SOURCE}/vysledky_obec?datumvoleb=${DATE}&cislo_obce=${code}`,
      join(ODATA, "zastup", `vysledky_obec_${code}.xml`),
    )
    councilCount++
  }
}

// --- reference data --------------------------------------------------------
// The application looks for the 2026 archive names, so the mirror uses them. The
// contents are the REAL 2026 registries, which are already published: council codes are
// stable between elections, so they resolve 2022 results correctly for the most part.
for (const name of ["KV2026reg20260915_xml.zip", "KV2026ciselniky20260915_xml.zip"]) {
  const target = join(OPENDATA, name)
  if (existsSync(target)) continue
  const local = join(import.meta.dir, "../../fixtures/source-2026-reg", name)
  if (existsSync(local)) {
    await writeFile(target, new Uint8Array(await Bun.file(local).arrayBuffer()))
  } else {
    const response = await fetch(`https://volby.gov.cz/opendata/kv2026/${name}`)
    if (response.ok) await writeFile(target, new Uint8Array(await response.arrayBuffer()))
  }
}
console.log("  registry a číselníky (skutečné z roku 2026)")

console.log(`\nHotovo: ${downloaded} staženo, ${skipped} už existovalo, ${councilCount} zastupitelstev`)
console.log(`\nSpusť binárku proti zrcadlu:`)
console.log(
  `  dist\\volby-kv2026.exe --base-url file://${OUT.replace(/\\/g, "/")} --election ${ELECTION} --date ${DATE}`,
)
