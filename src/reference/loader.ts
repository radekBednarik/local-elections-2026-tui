/**
 * Reference data loading (tasks T034-T035).
 *
 * The registries and code lists are published as dated archives ahead of the election
 * and do not change during it. They are therefore retrieved ONCE, on first run, and
 * every later run reads them straight out of the database (FR-020, FR-020a, SC-014).
 *
 * This is the most expensive thing the application ever does: the full candidate
 * registry is 110 MB uncompressed. Doing it once rather than per run is the difference
 * between a slow first launch and a slow every launch.
 */

import type { Database } from "bun:sqlite"
import { fold } from "../domain/folding.ts"
import type { Logger } from "../logging/logger.ts"
import { parseAndValidate } from "../parsing/pipeline.ts"
import {
  cnsSchema,
  cnumnutsSchema,
  cppSchema,
  cvsSchema,
  cvsSlozeniSchema,
  kvCocoSchema,
  kvdruhzSchema,
  kvRegkandSchema,
  kvRosSchema,
  kvtypzasSchema,
} from "../parsing/schemas/reference.ts"
import { isDistrictNuts } from "../sources/urls.ts"

/** Marker recorded once the load has succeeded. */
const LOADED_KEY = "reference_loaded_at"

export interface ReferenceArchives {
  /** Contents of the registry archive, keyed by lower-cased file name. */
  registry: Map<string, string>
  /** Contents of the code list archive. */
  codelists: Map<string, string>
}

export interface LoadReport {
  ok: boolean
  /** Rows written per table, for the log and for tests. */
  counts: Record<string, number>
  /** Files that could not be parsed. The load continues without them. */
  problems: string[]
}

/**
 * Normalises an optional code to a string or null.
 *
 * Written out because `String(undefined)` yields the literal `"undefined"`, which is
 * exactly the bug this replaced: absent parents were stored as the text "undefined" and
 * then failed a foreign key check against a council that could never exist.
 */
function codeOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  // "0" is the publisher's way of saying "no parent", not a council code.
  return text === "" || text === "0" ? null : text
}

/** True when reference data has already been loaded and can simply be reused. */
export function isReferenceLoaded(db: Database): boolean {
  const row = db.query("SELECT value FROM app_config WHERE key = $k").get({ k: LOADED_KEY }) as {
    value: string
  } | null
  return row !== null
}

/**
 * Loads every registry and code list into the database in one transaction.
 *
 * A file that fails to parse is reported and skipped rather than aborting the whole
 * load: missing one code list degrades a label to a numeric code (FR-011), whereas
 * aborting would leave the user with nothing at all.
 */
export function loadReference(db: Database, archives: ReferenceArchives, log?: Logger): LoadReport {
  const counts: Record<string, number> = {}
  const problems: string[] = []

  const run = db.transaction(() => {
    // Rows arrive in whatever order the publisher wrote them, so a borough can appear
    // before the council it belongs to. Deferring the checks to commit keeps the
    // integrity guarantee while allowing any insertion order.
    db.run("PRAGMA defer_foreign_keys = ON")
    loadCodelists(db, archives.codelists, counts, problems)
    loadRegistries(db, archives.registry, counts, problems)
    db.query("INSERT OR REPLACE INTO app_config (key, value) VALUES ($k, $v)").run({
      k: LOADED_KEY,
      v: new Date().toISOString(),
    })
  })
  run()

  for (const problem of problems) log?.warn("Referenční data", { problem })
  log?.info("Referenční data načtena", counts)

  return { ok: problems.length === 0, counts, problems }
}

/** Clears the loaded marker so the next run fetches again (`--refresh-reference`). */
export function invalidateReference(db: Database): void {
  db.query("DELETE FROM app_config WHERE key = $k").run({ k: LOADED_KEY })
}

// ---------------------------------------------------------------------------

type Rows = Record<string, unknown>[]

/** Parses one file and hands its rows to `write`, recording any problem. */
function ingest<T>(
  files: Map<string, string>,
  name: string,
  schema: Parameters<typeof parseAndValidate<T>>[1],
  root: string,
  rowKey: string,
  problems: string[],
  write: (rows: Rows) => number,
  counts: Record<string, number>,
  countKey: string,
): void {
  const text = files.get(name)
  if (text === undefined) {
    problems.push(`${name}: v archivu chybí`)
    return
  }

  const parsed = parseAndValidate(text, schema, name)
  if (!parsed.ok) {
    problems.push(parsed.message)
    return
  }

  const container = (parsed.value as Record<string, Record<string, Rows>>)[root]
  const rows = container?.[rowKey] ?? []
  counts[countKey] = write(rows)
}

function loadCodelists(
  db: Database,
  files: Map<string, string>,
  counts: Record<string, number>,
  problems: string[],
): void {
  const region = db.query(
    "INSERT OR REPLACE INTO region (numnuts, nuts, name, name_folded) VALUES ($n, $nuts, $name, $folded)",
  )
  const district = db.query(
    "INSERT OR REPLACE INTO district (nuts, numnuts, name, name_folded) VALUES ($nuts, $n, $name, $folded)",
  )
  ingest(
    files,
    "cnumnuts.xml",
    cnumnutsSchema,
    "CNUMNUTS",
    "CNUMNUTS_ROW",
    problems,
    (rows) => {
      let n = 0
      let districts = 0
      for (const row of rows as { NUMNUTS: string; NUTS: string; NAZEVNUTS: string }[]) {
        region.run({ n: row.NUMNUTS, nuts: row.NUTS, name: row.NAZEVNUTS, folded: fold(row.NAZEVNUTS) })
        n++
        // A district is a code the publisher has a per-district result file for, which
        // is what `isDistrictNuts` defines and the URL builder enforces. Testing the
        // LENGTH instead was wrong by exactly one entry: CZZZZZ, the Eurostat
        // extra-regio code, which the real codelist ships. It is six characters long and
        // has no result file, so polling it threw. Every other code here - the country,
        // its areas and its regions - is shorter.
        if (isDistrictNuts(row.NUTS)) {
          district.run({ nuts: row.NUTS, n: row.NUMNUTS, name: row.NAZEVNUTS, folded: fold(row.NAZEVNUTS) })
          districts++
        }
      }
      counts.district = districts
      return n
    },
    counts,
    "region",
  )

  const party = db.query(
    "INSERT OR REPLACE INTO political_party (nstrana, name, abbrev_30, abbrev_8) VALUES ($c, $n, $a30, $a8)",
  )
  ingest(
    files,
    "cns.xml",
    cnsSchema,
    "CNS",
    "CNS_ROW",
    problems,
    (rows) => {
      let n = 0
      for (const row of rows as {
        NSTRANA: string
        NAZEV_STRN: string
        ZKRATKAN30: string
        ZKRATKAN8: string
      }[]) {
        party.run({ c: row.NSTRANA, n: row.NAZEV_STRN, a30: row.ZKRATKAN30, a8: row.ZKRATKAN8 })
        n++
      }
      return n
    },
    counts,
    "political_party",
  )

  const affiliation = db.query(
    "INSERT OR REPLACE INTO political_affiliation (pstrana, name, abbrev_30, abbrev_8) VALUES ($c, $n, $a30, $a8)",
  )
  ingest(
    files,
    "cpp.xml",
    cppSchema,
    "CPP",
    "CPP_ROW",
    problems,
    (rows) => {
      let n = 0
      for (const row of rows as {
        PSTRANA: string
        NAZEV_STRP: string
        ZKRATKAP30: string
        ZKRATKAP8: string
      }[]) {
        affiliation.run({ c: row.PSTRANA, n: row.NAZEV_STRP, a30: row.ZKRATKAP30, a8: row.ZKRATKAP8 })
        n++
      }
      return n
    },
    counts,
    "political_affiliation",
  )

  const electoral = db.query(
    "INSERT OR REPLACE INTO electoral_party (vstrana, name, name_folded, typvs) VALUES ($c, $n, $f, $t)",
  )
  ingest(
    files,
    "cvs.xml",
    cvsSchema,
    "CVS",
    "CVS_ROW",
    problems,
    (rows) => {
      let n = 0
      for (const row of rows as { VSTRANA: string; NAZEVCELK: string; TYPVS: string | null }[]) {
        electoral.run({ c: row.VSTRANA, n: row.NAZEVCELK, f: fold(row.NAZEVCELK), t: row.TYPVS ?? null })
        n++
      }
      return n
    },
    counts,
    "electoral_party",
  )

  const composition = db.query(
    "INSERT OR IGNORE INTO electoral_party_composition (vstrana, nstrana) VALUES ($v, $n)",
  )
  ingest(
    files,
    "cvs_slozeni.xml",
    cvsSlozeniSchema,
    "CVS_SLOZENI",
    "CVS_SLOZENI_ROW",
    problems,
    (rows) => {
      let n = 0
      for (const row of rows as { VSTRANA: string; NSTRANA: string }[]) {
        composition.run({ v: row.VSTRANA, n: row.NSTRANA })
        n++
      }
      return n
    },
    counts,
    "electoral_party_composition",
  )

  const kind = db.query("INSERT OR REPLACE INTO council_type (druhzastup, name) VALUES ($c, $n)")
  ingest(
    files,
    "kvdruhz.xml",
    kvdruhzSchema,
    "KVDRUHZ",
    "KVDRUHZ_ROW",
    problems,
    (rows) => {
      let n = 0
      for (const row of rows as { DRUHZASTUP: string; NAZDRUHZAS: string }[]) {
        kind.run({ c: row.DRUHZASTUP, n: row.NAZDRUHZAS })
        n++
      }
      return n
    },
    counts,
    "council_type",
  )

  const klass = db.query("INSERT OR REPLACE INTO council_class (typzastup, name) VALUES ($c, $n)")
  ingest(
    files,
    "kvtypzas.xml",
    kvtypzasSchema,
    "KVTYPZAS",
    "KVTYPZAS_ROW",
    problems,
    (rows) => {
      let n = 0
      for (const row of rows as { TYPZASTUP: string; NAZTYPUZAS: string }[]) {
        klass.run({ c: row.TYPZASTUP, n: row.NAZTYPUZAS })
        n++
      }
      return n
    },
    counts,
    "council_class",
  )

  // KV_COCO is the backbone of navigation, and it carries NADRZASTUP, so a borough's
  // parent council needs no derivation (FR-035).
  const council = db.query(
    `INSERT OR REPLACE INTO council
       (kodzastup, name, name_folded, oznac_typu, okres_code, druhzastup, typzastup,
        mandaty, cobvodu, stav_obce, parent_kodzastup)
     VALUES ($k, $n, $f, $typ, $okres, $druh, $typz, $mand, $obv, $stav, $parent)`,
  )
  ingest(
    files,
    "kvcoco.xml",
    kvCocoSchema,
    "KV_COCO",
    "KV_COCO_ROW",
    problems,
    (rows) => {
      let n = 0
      for (const row of rows as Record<string, unknown>[]) {
        council.run({
          k: String(row.KODZASTUP),
          n: String(row.NAZEVZAST),
          f: fold(String(row.NAZEVZAST)),
          // TYPZASTUP 1 is a municipal assembly; anything else is a borough assembly.
          typ: String(row.TYPZASTUP) === "1" ? "OBEC" : "MCMO",
          okres: codeOrNull(row.OKRES),
          druh: codeOrNull(row.DRUHZASTUP),
          typz: codeOrNull(row.TYPZASTUP),
          mand: (row.MANDATY as number | null) ?? null,
          obv: (row.COBVODU as number | null) ?? null,
          stav: codeOrNull(row.STAV_OBCE),
          parent: codeOrNull(row.NADRZASTUP),
        })
        n++
      }
      return n
    },
    counts,
    "council",
  )
}

function loadRegistries(
  db: Database,
  files: Map<string, string>,
  counts: Record<string, number>,
  problems: string[],
): void {
  // KV_ROS is the bridge between a result's VSTRANA and a candidate list's OSTRANA.
  // Without it, FR-034 cannot connect a party's result to its candidates.
  const bridge = db.query(
    `INSERT OR REPLACE INTO council_party (kodzastup, ostrana, vstrana, name, name_folded, ballot_order)
     VALUES ($k, $o, $v, $n, $f, $b)`,
  )
  ingest(
    files,
    "kvros.xml",
    kvRosSchema,
    "KV_ROS",
    "KV_ROS_ROW",
    problems,
    (rows) => {
      let n = 0
      for (const row of rows as Record<string, string | number | null>[]) {
        bridge.run({
          k: String(row.KODZASTUP),
          o: String(row.OSTRANA),
          v: String(row.VSTRANA),
          n: String(row.NAZEVCELK),
          f: fold(String(row.NAZEVCELK)),
          b: row.POR_STR_HL ?? null,
        })
        n++
      }
      return n
    },
    counts,
    "council_party",
  )

  const candidate = db.query(
    `INSERT OR REPLACE INTO candidate
       (kodzastup, ostrana, por_str_hl, name, name_folded, pstrana, nstrana, cobvodu,
        age, occupation, votes, elected)
     VALUES ($k, $o, $p, $n, $f, $ps, $ns, $obv, $age, $occ, $votes, $elected)`,
  )
  ingest(
    files,
    "kvrk.xml",
    kvRegkandSchema,
    "KV_REGKAND",
    "KV_REGKAND_ROW",
    problems,
    (rows) => {
      let n = 0
      for (const row of rows as Record<string, string | number | null>[]) {
        const full = `${row.TITULPRED ?? ""} ${row.JMENO} ${row.PRIJMENI}`.trim().replace(/\s+/g, " ")
        candidate.run({
          k: String(row.KODZASTUP),
          o: String(row.OSTRANA),
          p: Number(row.PORCISLO),
          n: full,
          f: fold(`${row.JMENO} ${row.PRIJMENI}`),
          ps: row.PSTRANA === null ? null : String(row.PSTRANA),
          ns: row.NSTRANA === null ? null : String(row.NSTRANA),
          obv: row.COBVODU ?? null,
          age: row.VEK ?? null,
          occ: row.POVOLANI ?? null,
          votes: row.POCHLASU ?? null,
          // MANDAT is "A" (ano) or "N" (ne). In a registry published before the election
          // every row is "N", which is correct - nobody has been elected yet. The value
          // becomes meaningful only once results are published.
          elected:
            String(row.MANDAT ?? "")
              .trim()
              .toUpperCase() === "A"
              ? 1
              : 0,
        })
        n++
      }
      return n
    },
    counts,
    "candidate",
  )
}
