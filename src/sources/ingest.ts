/**
 * Turning fetched documents into stored snapshots (task T043).
 *
 * Every figure is carried across exactly as published. Nothing is recomputed, and no
 * value is derived that the source did not state (FR-029) - the one exception being
 * `isFinal`, which combines two published signals and is itself defined in
 * domain/status.ts rather than here.
 */

import type { Database } from "bun:sqlite"
import { fold } from "../domain/folding.ts"
import { determineStatus } from "../domain/status.ts"
import { parseAndValidate } from "../parsing/pipeline.ts"
import type { Obec, VolebniStrana } from "../parsing/schemas/common.ts"
import { councilSchema, districtSchema, nationalSchema } from "../parsing/schemas/results.ts"
import {
  type CandidateResultInput,
  type PartyResultInput,
  type SnapshotInput,
  type WriteOutcome,
  writeSnapshot,
} from "../storage/snapshots.ts"

export type IngestResult =
  | { ok: true; outcomes: WriteOutcome[]; publishedAt: string }
  | { ok: false; reason: string }

/** Maps the published party block onto stored party results, unchanged. */
function toPartyResults(parties: VolebniStrana[]): PartyResultInput[] {
  return parties.map((party) => ({
    vstrana: party.VSTRANA,
    ballotOrder: party.POR_STR_HLAS_LIST ?? null,
    name: party.NAZEV_STRANY,
    votes: party.HLASY,
    votesPct: party.HLASY_PROC,
    candidates: party.KANDIDATU_POCET ?? null,
    seatsWon: party.ZASTUPITELE_POCET,
    seatsPct: party.ZASTUPITELE_PROC ?? null,
  }))
}

/** Elected representatives, as reported in the result document. */
function toCandidateResults(parties: VolebniStrana[]): CandidateResultInput[] {
  const out: CandidateResultInput[] = []
  for (const party of parties) {
    for (const person of party.ZASTUPITEL) {
      out.push({
        vstrana: party.VSTRANA,
        ballotOrder: party.POR_STR_HLAS_LIST ?? null,
        ballotNumber: person.PORADOVE_CISLO,
        givenName: person.JMENO,
        familyName: person.PRIJMENI,
        titleBefore: person.TITULPRED === "" ? null : person.TITULPRED,
        titleAfter: person.TITULZA === "" ? null : person.TITULZA,
        votes: person.HLASY,
        votesPct: person.HLASY_PROC,
      })
    }
  }
  return out
}

/**
 * Converts one council block into a snapshot.
 *
 * Shared by the district and council documents, whose `OBEC` blocks are identical.
 */
function obecToSnapshot(obec: Obec, publishedAt: string, fetchedAt: string): SnapshotInput {
  const vysledek = obec.VYSLEDEK[0]
  const ucast = vysledek?.UCAST
  const parties = vysledek?.VOLEBNI_STRANA ?? []

  const status = determineStatus({
    districtsTotal: ucast?.OKRSKY_CELKEM ?? 0,
    districtsCounted: ucast?.OKRSKY_ZPRAC ?? 0,
    publishedPct: ucast?.OKRSKY_ZPRAC_PROC ?? null,
    sourceSaysCounted: obec.JE_SPOCTENO,
  })

  return {
    areaKind: "council",
    areaId: obec.KODZASTUP,
    oznacTypu: null,
    publishedAt,
    fetchedAt,
    districtsTotal: status.districtsTotal,
    districtsCounted: status.districtsCounted,
    districtsPct: status.publishedPct,
    votersRegistered: ucast?.ZAPSANI_VOLICI ?? null,
    envelopesIssued: ucast?.VYDANE_OBALKY ?? null,
    envelopesReturned: ucast?.ODEVZDANE_OBALKY ?? null,
    validVotes: ucast?.PLATNE_HLASY ?? null,
    turnoutPct: ucast?.UCAST_PROC ?? null,
    seatsTotal: obec.VOLENO_ZASTUP,
    isFinal: status.isFinal,
    parties: toPartyResults(parties),
    candidates: toCandidateResults(parties),
  }
}

/**
 * Ingests the nationwide document (FR-007).
 *
 * It reports municipal assemblies (OBEC) and borough assemblies (MCMO) separately, and
 * FR-035 requires them kept apart, so each becomes its own snapshot under the national
 * area rather than being summed together.
 */
export function ingestNational(db: Database, body: string, fetchedAt = new Date()): IngestResult {
  const parsed = parseAndValidate(body, nationalSchema, "vysledky.xml")
  if (!parsed.ok) return { ok: false, reason: parsed.message }

  const doc = parsed.value.VYSLEDKY
  const publishedAt = doc.DATUM_CAS_GENEROVANI
  const stamp = fetchedAt.toISOString()

  const outcomes = doc.TYP_ZASTUP.map((block) => {
    const status = determineStatus({
      districtsTotal: block.UCAST.OKRSKY_CELKEM,
      districtsCounted: block.UCAST.OKRSKY_ZPRAC,
      publishedPct: block.UCAST.OKRSKY_ZPRAC_PROC,
      // The national document has no JE_SPOCTENO; completeness is the district count.
      sourceSaysCounted: block.UCAST.OKRSKY_ZPRAC >= block.UCAST.OKRSKY_CELKEM,
    })

    return writeSnapshot(db, {
      areaKind: "national",
      areaId: "",
      oznacTypu: block.OZNAC_TYPU,
      publishedAt,
      fetchedAt: stamp,
      districtsTotal: status.districtsTotal,
      districtsCounted: status.districtsCounted,
      districtsPct: status.publishedPct,
      votersRegistered: block.UCAST.ZAPSANI_VOLICI,
      envelopesIssued: block.UCAST.VYDANE_OBALKY,
      envelopesReturned: block.UCAST.ODEVZDANE_OBALKY,
      validVotes: block.UCAST.PLATNE_HLASY,
      turnoutPct: block.UCAST.UCAST_PROC,
      seatsTotal: block.ZASTUPIT_INFO.ZASTUPITELE_ZVOLENI,
      isFinal: status.isFinal,
      parties: toPartyResults(block.VOLEBNI_STRANA),
    })
  })

  return { ok: true, outcomes, publishedAt }
}

/**
 * Ingests a district document (FR-008).
 *
 * Also records which district each council belongs to. That membership is only reliable
 * from the document itself: a council's registry OKRES code does not always identify
 * the district file containing it (Prague's councils carry the region code).
 */
export function ingestDistrict(
  db: Database,
  nuts: string,
  body: string,
  fetchedAt = new Date(),
): IngestResult {
  const parsed = parseAndValidate(body, districtSchema, `vysledky_obce_okres_${nuts}.xml`)
  if (!parsed.ok) return { ok: false, reason: parsed.message }

  const doc = parsed.value.VYSLEDKY_OBCE_OKRES
  const publishedAt = doc.DATUM_CAS_GENEROVANI
  const stamp = fetchedAt.toISOString()

  const outcomes: WriteOutcome[] = []
  for (const obec of doc.OBEC) {
    upsertCouncil(db, obec, nuts)
    outcomes.push(writeSnapshot(db, obecToSnapshot(obec, publishedAt, stamp)))
  }

  return { ok: true, outcomes, publishedAt }
}

/**
 * Records the council itself from the result document.
 *
 * The result carries `KODZASTUP`, `NAZEVZAST`, `OZNAC_TYPU` and `VOLENO_ZASTUP`, which
 * is everything needed for a usable council row. Creating it here is what makes FR-011's
 * degraded mode actually work: with no registry at all, results are still browsable and
 * still show real names, rather than the application reporting that a council it holds
 * results for cannot be found.
 *
 * Registry-only fields are left alone, so a later reference load enriches the row
 * instead of the two fighting over it.
 */
function upsertCouncil(db: Database, obec: Obec, districtNuts: string | null): void {
  db.query(
    `INSERT INTO council (kodzastup, name, name_folded, oznac_typu, district_nuts, mandaty)
     VALUES ($k, $n, $f, $typ, $d, $m)
     ON CONFLICT(kodzastup) DO UPDATE SET
       name = excluded.name,
       name_folded = excluded.name_folded,
       oznac_typu = excluded.oznac_typu,
       mandaty = COALESCE(council.mandaty, excluded.mandaty),
       district_nuts = COALESCE(excluded.district_nuts, council.district_nuts)`,
  ).run({
    k: obec.KODZASTUP,
    n: obec.NAZEVZAST,
    f: fold(obec.NAZEVZAST),
    typ: obec.OZNAC_TYPU,
    d: districtNuts,
    m: obec.VOLENO_ZASTUP,
  })
}

/** Ingests a single council document (FR-009). */
export function ingestCouncil(
  db: Database,
  kodzastup: string,
  body: string,
  fetchedAt = new Date(),
): IngestResult {
  const parsed = parseAndValidate(body, councilSchema, `vysledky_obec_${kodzastup}.xml`)
  if (!parsed.ok) return { ok: false, reason: parsed.message }

  const doc = parsed.value.VYSLEDKY_OBEC
  const publishedAt = doc.DATUM_CAS_GENEROVANI
  const stamp = fetchedAt.toISOString()

  const outcomes = doc.OBEC.map((obec) => {
    upsertCouncil(db, obec, null)
    return writeSnapshot(db, obecToSnapshot(obec, publishedAt, stamp))
  })
  return { ok: true, outcomes, publishedAt }
}
