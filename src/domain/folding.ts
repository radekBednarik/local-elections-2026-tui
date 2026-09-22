/**
 * Diacritic-insensitive text folding (task T037, FR-038).
 *
 * A user looking for Říčany will type "ricany" as often as "Říčany", and may type it in
 * any case. Both the stored name and the query are folded through this one function, so
 * they can only ever match or not match for the same reason.
 *
 * No dependency is needed: NFD decomposition splits a letter from its accent, and the
 * combining marks can then be dropped (research R6).
 */

/** Unicode combining diacritical marks, which NFD separates out. */
const COMBINING_MARKS = /[̀-ͯ]/g

/**
 * Folds text for comparison: decomposed, stripped of accents, lowercased, and with
 * runs of whitespace collapsed.
 *
 * Lowercasing uses the Czech locale so that letters fold the way a Czech reader expects.
 */
export function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLocaleLowerCase("cs")
    .replace(/\s+/g, " ")
    .trim()
}

/** True when `needle` appears anywhere in `haystack`, ignoring case and diacritics. */
export function foldedIncludes(haystack: string, needle: string): boolean {
  if (needle === "") return true
  return fold(haystack).includes(fold(needle))
}

/** True when `haystack` begins with `needle`, ignoring case and diacritics. */
export function foldedStartsWith(haystack: string, needle: string): boolean {
  if (needle === "") return true
  return fold(haystack).startsWith(fold(needle))
}
