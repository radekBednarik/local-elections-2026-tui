/**
 * Shared schema pieces (tasks T027-T029).
 *
 * The `OBEC` block is byte-identical in the district document and the single-council
 * document, so it is defined once here and reused by both. Defining it twice would be
 * the exact duplication Principle I forbids, and the two copies would drift.
 *
 * Numbers arrive as strings because the XML layer deliberately does not coerce them
 * (see parsing/xml.ts). Coercion happens here, where a malformed value fails validation
 * loudly instead of becoming a silent wrong figure.
 */

import { z } from "zod"

/** A required integer written as a string in the source. */
export const intFromString = z
  .string()
  .regex(/^-?\d+$/, "očekáváno celé číslo")
  .transform((value) => Number(value))

/** A required decimal written as a string, e.g. "46.21". */
export const decimalFromString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "očekáváno desetinné číslo")
  .transform((value) => Number(value))

/** An optional integer: absent stays absent, present must still be a number. */
export const optionalInt = intFromString.optional().nullable()
export const optionalDecimal = decimalFromString.optional().nullable()

/** `JE_SPOCTENO="true"` - the source writes booleans as text. */
export const booleanFromString = z.enum(["true", "false"]).transform((value) => value === "true")

/** The publisher's generation timestamp, authoritative for "last updated" (FR-021). */
export const generatedAt = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/, "očekáván čas ve tvaru RRRR-MM-DDTHH:MM:SS")

/** Council type: a municipal assembly or a borough assembly (FR-035). */
export const councilTypeCode = z.enum(["OBEC", "MCMO"])

/** Turnout and count progress, present on every result document. */
export const ucastSchema = z.object({
  OKRSKY_CELKEM: intFromString,
  OKRSKY_ZPRAC: intFromString,
  OKRSKY_ZPRAC_PROC: decimalFromString,
  ZAPSANI_VOLICI: intFromString,
  VYDANE_OBALKY: intFromString,
  UCAST_PROC: decimalFromString,
  ODEVZDANE_OBALKY: intFromString,
  PLATNE_HLASY: intFromString,
})
export type Ucast = z.infer<typeof ucastSchema>

/**
 * An elected representative.
 *
 * Note this is only the ELECTED ones, not the full candidate list. Full lists come from
 * the KVRK registry, which is why FR-034 needs reference data.
 */
export const zastupitelSchema = z.object({
  PORADOVE_CISLO: intFromString,
  JMENO: z.string(),
  PRIJMENI: z.string(),
  TITULPRED: z.string().optional().default(""),
  TITULZA: z.string().optional().default(""),
  HLASY: intFromString,
  HLASY_PROC: decimalFromString,
})
export type Zastupitel = z.infer<typeof zastupitelSchema>

/** A candidate list within one council, with its votes, seats and elected members. */
export const volebniStranaSchema = z.object({
  POR_STR_HLAS_LIST: optionalInt,
  VSTRANA: z.string(),
  NAZEV_STRANY: z.string(),
  HLASY: intFromString,
  HLASY_PROC: decimalFromString,
  KANDIDATU_POCET: optionalInt,
  ZASTUPITELE_POCET: intFromString,
  ZASTUPITELE_PROC: optionalDecimal,
  ZASTUPITEL: z.array(zastupitelSchema).optional().default([]),
})
export type VolebniStrana = z.infer<typeof volebniStranaSchema>

/** The result body of one council. */
export const vysledekSchema = z.object({
  UCAST: ucastSchema,
  VOLEBNI_STRANA: z.array(volebniStranaSchema).optional().default([]),
})

/**
 * One council: identity plus its result.
 *
 * Reused verbatim by the district document and the single-council document.
 */
export const obecSchema = z.object({
  KODZASTUP: z.string(),
  NAZEVZAST: z.string(),
  OZNAC_TYPU: councilTypeCode,
  VOLENO_ZASTUP: intFromString,
  POCET_OBVODU: optionalInt,
  JE_SPOCTENO: booleanFromString,
  // A council where no election took place carries no result body at all, which is why
  // this is optional rather than required (edge case: councils with no result).
  VYSLEDEK: z.array(vysledekSchema).optional().default([]),
})
export type Obec = z.infer<typeof obecSchema>
