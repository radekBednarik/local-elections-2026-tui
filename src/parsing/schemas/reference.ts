/**
 * Registry and code list schemas (tasks T030-T031).
 *
 * These documents differ from the result documents in shape: they put their data in
 * CHILD ELEMENTS rather than attributes, and wrap every record in an `X_ROW` element.
 * Both shapes therefore have to be parsed, which is why `parsing/xml.ts` is configured
 * to handle attributes and elements alike.
 *
 * Only the fields the application actually consumes are modelled. Zod ignores unknown
 * keys, so the publisher adding a field cannot break the client, while dropping one the
 * application depends on fails loudly (FR-025).
 */

import { z } from "zod"
import { intFromString, optionalInt } from "./common.ts"

/** Every reference document stamps its generation time on the root element. */
const datGener = z.string()

/**
 * Wraps the repetitive `{ ROOT: { DATGENER, ROOT_ROW: [...] } }` shape.
 *
 * Writing this out eleven times would be the duplication Principle I forbids.
 */
function documentOf<T extends z.ZodTypeAny>(root: string, rowElement: string, row: T) {
  return z.object({
    [root]: z.object({
      DATGENER: datGener,
      [rowElement]: z.array(row).optional().default([]),
    }),
  })
}

/** Numeric codes are written as text, and some are optional in practice. */
const code = z.union([z.string(), z.number()]).transform((v) => String(v))
const optionalCode = code.optional().nullable()

// ---------------------------------------------------------------------------
// Code lists
// ---------------------------------------------------------------------------

/** CNUMNUTS: maps the numeric region/district code used elsewhere to its NUTS code. */
export const cnumnutsRow = z.object({
  NUMNUTS: code,
  NUTS: z.string(),
  NAZEVNUTS: z.string(),
})
export const cnumnutsSchema = documentOf("CNUMNUTS", "CNUMNUTS_ROW", cnumnutsRow)

/** CNS: registered political parties and movements. */
export const cnsRow = z.object({
  NSTRANA: code,
  NAZEV_STRN: z.string(),
  ZKRATKAN30: z.string().optional().default(""),
  ZKRATKAN8: z.string().optional().default(""),
})
export const cnsSchema = documentOf("CNS", "CNS_ROW", cnsRow)

/** CPP: a candidate's declared political affiliation, which may differ from their list. */
export const cppRow = z.object({
  PSTRANA: code,
  NAZEV_STRP: z.string(),
  ZKRATKAP30: z.string().optional().default(""),
  ZKRATKAP8: z.string().optional().default(""),
})
export const cppSchema = documentOf("CPP", "CPP_ROW", cppRow)

/** CVS: the nationwide catalogue of electoral parties. NAZEVCELK runs to 2000 chars. */
export const cvsRow = z.object({
  VSTRANA: code,
  NAZEVCELK: z.string(),
  ZKRATKAV30: z.string().optional().default(""),
  ZKRATKAV8: z.string().optional().default(""),
  /** Party, coalition, association or independents. */
  TYPVS: optionalCode,
})
export const cvsSchema = documentOf("CVS", "CVS_ROW", cvsRow)

/** CVS_SLOZENI: which registered parties make up each electoral party. */
export const cvsSlozeniRow = z.object({
  VSTRANA: code,
  NSTRANA: code,
})
export const cvsSlozeniSchema = documentOf("CVS_SLOZENI", "CVS_SLOZENI_ROW", cvsSlozeniRow)

/** KVDRUHZ: council kind - village, town, statutory city, Prague, borough. */
export const kvdruhzRow = z.object({
  DRUHZASTUP: code,
  NAZDRUHZAS: z.string(),
})
export const kvdruhzSchema = documentOf("KVDRUHZ", "KVDRUHZ_ROW", kvdruhzRow)

/** KVTYPZAS: council classification - municipality versus borough. */
export const kvtypzasRow = z.object({
  TYPZASTUP: code,
  NAZTYPUZAS: z.string(),
})
export const kvtypzasSchema = documentOf("KVTYPZAS", "KVTYPZAS_ROW", kvtypzasRow)

/**
 * KV_COCO: every elected council in the country.
 *
 * This is the backbone of navigation. `NADRZASTUP` names the parent council of a
 * borough directly, so FR-035's attribution needs no derivation.
 */
export const kvCocoRow = z.object({
  KRAJ: optionalCode,
  OKRES: optionalCode,
  TYPZASTUP: optionalCode,
  DRUHZASTUP: optionalCode,
  KODZASTUP: code,
  NAZEVZAST: z.string(),
  COBVODU: optionalInt,
  MANDATY: optionalInt,
  /** Present on a borough, naming the municipality it belongs to. */
  NADRZASTUP: optionalCode,
  /** Carries "election not held" and similar states (edge case: councils with no result). */
  STAV_OBCE: optionalCode,
})
export const kvCocoSchema = documentOf("KV_COCO", "KV_COCO_ROW", kvCocoRow)

// ---------------------------------------------------------------------------
// Registries
// ---------------------------------------------------------------------------

/** KV_RZCOCO: councils with their municipality, seat count and status. */
export const kvRzcocoRow = z.object({
  KRAJ: optionalCode,
  OKRES: optionalCode,
  KODZASTUP: code,
  NAZEVZAST: z.string(),
  OBEC: optionalCode,
  NAZEVOBCE: z.string().optional().default(""),
  TYPZASTUP: optionalCode,
  DRUHZASTUP: optionalCode,
  COBVODU: optionalInt,
  MANDATY: optionalInt,
  STAV_OBCE: optionalCode,
})
export const kvRzcocoSchema = documentOf("KV_RZCOCO", "KV_RZCOCO_ROW", kvRzcocoRow)

/**
 * KV_ROS: electoral parties standing in each council.
 *
 * THE BRIDGE. Results identify a party by `VSTRANA` (nationwide), while candidate lists
 * identify it by `OSTRANA` (that council's own numbering). This registry is the only
 * place carrying both, so FR-034 cannot join a result to its candidates without it.
 */
export const kvRosRow = z.object({
  KODZASTUP: code,
  /** The party's number within this council. */
  OSTRANA: code,
  /** The party's nationwide code, as used in result documents. */
  VSTRANA: code,
  NAZEVCELK: z.string(),
  ZKRATKAO8: z.string().optional().default(""),
  POR_STR_HL: optionalInt,
  COBVODU: optionalInt,
})
export const kvRosSchema = documentOf("KV_ROS", "KV_ROS_ROW", kvRosRow)

/** KV_REGKAND: full candidate lists, including those not elected. */
export const kvRegkandRow = z.object({
  KODZASTUP: code,
  OSTRANA: code,
  PORCISLO: intFromString,
  JMENO: z.string(),
  PRIJMENI: z.string(),
  TITULPRED: z.string().optional().default(""),
  VEK: optionalInt,
  POVOLANI: z.string().optional().default(""),
  /** Declared affiliation, which may differ from the list stood on. */
  PSTRANA: optionalCode,
  NSTRANA: optionalCode,
  COBVODU: optionalInt,
  POCHLASU: optionalInt,
  /** "A" (ano) or "N" (ne). All "N" in a registry published before the election. */
  MANDAT: z.union([z.string(), z.number()]).optional().nullable(),
})
export const kvRegkandSchema = documentOf("KV_REGKAND", "KV_REGKAND_ROW", kvRegkandRow)

export type KvCocoRow = z.infer<typeof kvCocoRow>
export type KvRosRow = z.infer<typeof kvRosRow>
export type KvRegkandRow = z.infer<typeof kvRegkandRow>
export type CnumnutsRow = z.infer<typeof cnumnutsRow>
