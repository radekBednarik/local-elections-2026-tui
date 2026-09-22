/**
 * Result document schemas (tasks T027-T029).
 *
 * One module for all three, because they share `common.ts` and splitting them would
 * scatter three ten-line schemas across three files for no benefit.
 */

import { z } from "zod"
import {
  councilTypeCode,
  decimalFromString,
  generatedAt,
  intFromString,
  obecSchema,
  optionalInt,
  ucastSchema,
  volebniStranaSchema,
} from "./common.ts"

/** Seats and assemblies, reported per council type in the national document. */
const zastupitInfoSchema = z.object({
  ZASTUPITELSTVA_CELKEM: intFromString,
  ZASTUPITELSTVA_ZVOLENA: intFromString,
  ZASTUPITELE_ZVOLENI: intFromString,
})

/**
 * The national aggregate, split into municipal assemblies (OBEC) and borough
 * assemblies (MCMO). Both are reported, and FR-035 requires them kept apart.
 */
const typZastupSchema = z.object({
  OZNAC_TYPU: councilTypeCode,
  NAZ_TYPU: z.string(),
  UCAST: ucastSchema,
  ZASTUPIT_INFO: zastupitInfoSchema,
  VOLEBNI_STRANA: z.array(volebniStranaSchema).optional().default([]),
})

/** `vysledky.xml` - nationwide results (FR-007). */
export const nationalSchema = z.object({
  VYSLEDKY: z.object({
    DATUM_CAS_GENEROVANI: generatedAt,
    TYP_ZASTUP: z.array(typZastupSchema).min(1),
  }),
})
export type NationalDocument = z.infer<typeof nationalSchema>

/** `vysledky_obce_okres_CZXXXX.xml` - one district and all its councils (FR-008). */
export const districtSchema = z.object({
  VYSLEDKY_OBCE_OKRES: z.object({
    DATUM_CAS_GENEROVANI: generatedAt,
    OBEC: z.array(obecSchema).optional().default([]),
  }),
})
export type DistrictDocument = z.infer<typeof districtSchema>

/** `vysledky_obec_XXXXXX.xml` - one council (FR-009). */
export const councilSchema = z.object({
  VYSLEDKY_OBEC: z.object({
    DATUM_CAS_GENEROVANI: generatedAt,
    OBEC: z.array(obecSchema).min(1),
  }),
})
export type CouncilDocument = z.infer<typeof councilSchema>

// Re-exported so callers validating a bare fragment do not reach into common.ts.
export { decimalFromString, intFromString, optionalInt }
