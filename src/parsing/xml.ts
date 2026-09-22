/**
 * XML parsing (task T026).
 *
 * Two settings matter and are not defaults:
 *
 *   ignoreAttributes: false - the published documents carry almost everything in
 *     attributes (KODZASTUP, OZNAC_TYPU, HLASY). With the default the parser returns
 *     empty objects and the failure looks like missing data rather than misconfiguration.
 *
 *   parseAttributeValue: false - number coercion is done explicitly in the Zod layer.
 *     Letting the parser guess means a malformed number silently becomes a string, and
 *     the document would pass validation with a wrong figure in it (research R4).
 */

import { XMLParser, XMLValidator } from "fast-xml-parser"

/** Attribute keys are exposed without a prefix, so `OBEC.KODZASTUP` reads naturally. */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  // Elements that may legitimately appear once are still wanted as arrays, so callers
  // never have to handle "one municipality" and "many municipalities" differently.
  isArray: (name) => ARRAY_ELEMENTS.has(name),
})

const ARRAY_ELEMENTS = new Set(["TYP_ZASTUP", "OBEC", "VOLEBNI_STRANA", "ZASTUPITEL", "VYSLEDEK"])

export type XmlParseResult =
  | { ok: true; document: unknown }
  | { ok: false; reason: "not-well-formed" | "empty"; message: string }

/**
 * Parses a document, rejecting it whole if it is not well-formed.
 *
 * FR-025 requires a non-conforming document to be rejected rather than partially
 * displayed, so this never returns a half-parsed structure.
 */
export function parseXml(text: string): XmlParseResult {
  if (text.trim() === "") {
    return { ok: false, reason: "empty", message: "Dokument je prázdný." }
  }

  const validation = XMLValidator.validate(text)
  if (validation !== true) {
    return {
      ok: false,
      reason: "not-well-formed",
      message: `XML není well-formed: ${validation.err.msg} (řádek ${validation.err.line})`,
    }
  }

  try {
    return { ok: true, document: parser.parse(text) }
  } catch (error) {
    return {
      ok: false,
      reason: "not-well-formed",
      message: error instanceof Error ? error.message : String(error),
    }
  }
}
