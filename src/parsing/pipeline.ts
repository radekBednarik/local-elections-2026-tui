/**
 * Parse-and-validate pipeline (task T032).
 *
 * The single boundary every fetched document crosses. FR-025 requires a non-conforming
 * document to be rejected whole, so this returns either a fully validated document or a
 * reason - never a partially parsed structure that a caller might render.
 */

import type { ZodType } from "zod"
import { parseXml } from "./xml.ts"

export type RejectionReason = "empty" | "not-well-formed" | "schema-mismatch"

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: RejectionReason; message: string }

/**
 * Parses `text` and validates it against `schema`.
 *
 * `label` names the document in the rejection message, so a log entry says which source
 * failed rather than only that something did.
 */
export function parseAndValidate<T>(text: string, schema: ZodType<T>, label: string): ValidationResult<T> {
  const parsed = parseXml(text)
  if (!parsed.ok) {
    return { ok: false, reason: parsed.reason, message: `${label}: ${parsed.message}` }
  }

  const validated = schema.safeParse(parsed.document)
  if (!validated.success) {
    // Report the first few problems with their paths. The whole issue list can run to
    // hundreds of entries for a wrong-shaped document, which helps nobody.
    const issues = validated.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "<kořen>"}: ${issue.message}`)
      .join("; ")
    const more = validated.error.issues.length > 3 ? ` (+${validated.error.issues.length - 3} dalších)` : ""
    return {
      ok: false,
      reason: "schema-mismatch",
      message: `${label}: dokument neodpovídá schématu - ${issues}${more}`,
    }
  }

  return { ok: true, value: validated.data }
}
