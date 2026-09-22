/**
 * Quickstart V-accuracy (T104, SC-006): every displayed figure must equal the source.
 *
 * Deliberately re-derives the expected values from the RAW XML with plain regex, not
 * through the application's own parser. Using the parser to check the parser would only
 * confirm it is self-consistent.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ingestCouncil, ingestDistrict, ingestNational } from "../../src/sources/ingest.ts"
import { openDatabase } from "../../src/storage/db.ts"
import { listCouncilParties, readCouncil } from "../../src/storage/queries/areas.ts"
import { readNationalParties, readNationalTotals } from "../../src/storage/queries/national.ts"

const F = join(import.meta.dir, "../../fixtures/2026")
const db = openDatabase(":memory:")
let checks = 0
let bad = 0

function check(label: string, actual: unknown, expected: unknown) {
  checks++
  // Compare numerically when both sides are numbers: the source writes "41.90" and the
  // stored value is 41.9, which are the same figure. A string comparison would report
  // 71 false mismatches and hide any real one among them.
  const a = Number(actual)
  const b = Number(expected)
  const same =
    Number.isFinite(a) && Number.isFinite(b) && actual !== null && expected !== null
      ? a === b
      : String(actual) === String(expected)
  if (!same) {
    bad++
    console.log(`  MISMATCH ${label}: zobrazeno ${actual}, ve zdroji ${expected}`)
  }
}

// --- national -------------------------------------------------------------
const nat = readFileSync(join(F, "vysledky.xml"), "utf8")
ingestNational(db, nat)

const obecBlock = nat.slice(nat.indexOf('OZNAC_TYPU="OBEC"'), nat.indexOf('OZNAC_TYPU="MCMO"'))
const ucast = obecBlock.match(/<UCAST ([^/]*)\/>/)![1]!
const attr = (s: string, k: string) => s.match(new RegExp(`${k}="([^"]*)"`))![1]!

const totals = readNationalTotals(db, "OBEC")!
check("national OKRSKY_CELKEM", totals.districtsTotal, attr(ucast, "OKRSKY_CELKEM"))
check("national OKRSKY_ZPRAC", totals.districtsCounted, attr(ucast, "OKRSKY_ZPRAC"))
check("national ZAPSANI_VOLICI", totals.votersRegistered, attr(ucast, "ZAPSANI_VOLICI"))
check("national VYDANE_OBALKY", totals.envelopesIssued, attr(ucast, "VYDANE_OBALKY"))
check("national PLATNE_HLASY", totals.validVotes, attr(ucast, "PLATNE_HLASY"))
check("national UCAST_PROC", totals.turnoutPct, attr(ucast, "UCAST_PROC"))

const natParties = readNationalParties(db, "OBEC", 1000)
for (const m of obecBlock.matchAll(/<VOLEBNI_STRANA ([^/]*)\/>/g)) {
  const a = m[1]!
  const code = attr(a, "VSTRANA")
  const shown = natParties.find((p) => p.vstrana === code)
  if (!shown) {
    checks++
    bad++
    console.log(`  MISSING national party ${code}`)
    continue
  }
  check(`national party ${code} HLASY`, shown.votes, attr(a, "HLASY"))
  check(`national party ${code} HLASY_PROC`, shown.votesPct, attr(a, "HLASY_PROC"))
  check(`national party ${code} ZASTUPITELE_POCET`, shown.seatsWon, attr(a, "ZASTUPITELE_POCET"))
}

// --- councils, via the district document -----------------------------------
const dist = readFileSync(join(F, "vysledky_obce_okres_CZ0642.xml"), "utf8")
ingestDistrict(db, "CZ0642", dist)

for (const block of dist.split(/(?=<OBEC )/).slice(1)) {
  const kod = block.match(/KODZASTUP="(\d+)"/)![1]!
  const council = readCouncil(db, kod)
  if (!council) {
    checks++
    bad++
    console.log(`  MISSING council ${kod}`)
    continue
  }

  const u = block.match(/<UCAST ([\s\S]*?)\/>/)?.[1]
  if (u) {
    check(`${kod} OKRSKY_CELKEM`, council.districtsTotal, attr(u, "OKRSKY_CELKEM"))
    check(`${kod} OKRSKY_ZPRAC`, council.districtsCounted, attr(u, "OKRSKY_ZPRAC"))
    check(`${kod} UCAST_PROC`, council.turnoutPct, attr(u, "UCAST_PROC"))
  }
  check(`${kod} VOLENO_ZASTUP`, council.seatsTotal, attr(block, "VOLENO_ZASTUP"))

  const shownParties = listCouncilParties(db, kod)
  const sourceParties = [...block.matchAll(/<VOLEBNI_STRANA ([^>]*)>/g)].map((m) => m[1]!)
  checks++
  if (shownParties.length !== sourceParties.length) {
    bad++
    console.log(
      `  MISMATCH ${kod} počet stran: zobrazeno ${shownParties.length}, ve zdroji ${sourceParties.length}`,
    )
  }
  for (const a of sourceParties) {
    const order = Number(attr(a, "POR_STR_HLAS_LIST"))
    const shown = shownParties.find((p) => p.ballotOrder === order)
    if (!shown) {
      checks++
      bad++
      console.log(`  MISSING ${kod} strana č. ${order}`)
      continue
    }
    check(`${kod}#${order} HLASY`, shown.votes, attr(a, "HLASY"))
    check(`${kod}#${order} HLASY_PROC`, shown.votesPct, attr(a, "HLASY_PROC"))
    check(`${kod}#${order} ZASTUPITELE_POCET`, shown.seatsWon, attr(a, "ZASTUPITELE_POCET"))
  }
}

// --- the same council from its own document must agree ---------------------
ingestCouncil(db, "551082", readFileSync(join(F, "vysledky_obec_551082.xml"), "utf8"))
const again = readCouncil(db, "551082")!
check("551082 consistent turnout", again.turnoutPct, 46.21)

console.log(`\n${checks} kontrol, ${bad} neshod`)
process.exit(bad === 0 ? 0 : 1)
