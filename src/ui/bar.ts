/**
 * Proportional bars (tasks T143, T144, FR-070 to FR-074).
 *
 * Eighth-blocks, so a bar resolves eight sub-steps per column instead of one. A
 * ten-column bar of full blocks can say only "about a tenth"; the same bar in eighths
 * says it to within 1.25 percentage points.
 *
 * THE BAR IS AN AID, NEVER A VALUE. It is drawn beside the published percentage and the
 * percentage is always shown (FR-071). Nothing anywhere reads a figure back out of a bar
 * length, and the bar is scaled to the published percentage rather than to any derived
 * quantity - not to the largest party in the table, which would make the same result
 * look different depending on its company.
 *
 * A NOTE ON RESOLUTION. Research R16 offered 7.62% against 7.76% as the pair eighths
 * would separate. It does not: those differ by 0.14 percentage points, which no bar of
 * any practical width can show - a ten-column bar would need seven hundred sub-steps.
 * Both draw as six eighths, and the figures beside them are what tell them apart. That
 * is not a shortcoming of this implementation; it is the reason FR-071 requires the
 * figure to be there at all, and it is asserted as a property in the tests rather than
 * left as a surprise.
 *
 * Shape, not colour, so a bar survives NO_COLOR and a monochrome terminal (FR-072).
 */

/** Partial blocks from one eighth to seven eighths. A full column is U+2588. */
const EIGHTHS = ["▏", "▎", "▍", "▌", "▋", "▊", "▉"]
const FULL = "█"

/** Columns a bar occupies. Wide enough to be read, narrow enough to be droppable. */
export const BAR_WIDTH = 10

/**
 * Draws `fraction` of `width` columns.
 *
 * A fraction outside 0 to 1 is clamped rather than rejected: the publisher's figures are
 * taken as given, and a bar is not the place to argue with them.
 */
export function bar(fraction: number | null | undefined, width = BAR_WIDTH): string {
  if (width <= 0) return ""
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) {
    return " ".repeat(width)
  }

  const clamped = Math.min(1, Math.max(0, fraction))
  const eighths = Math.round(clamped * width * 8)
  const full = Math.floor(eighths / 8)
  const remainder = eighths % 8

  const drawn = FULL.repeat(full) + (remainder === 0 ? "" : (EIGHTHS[remainder - 1] ?? ""))
  return drawn.padEnd(width, " ")
}

/**
 * Whether a bar column is affordable.
 *
 * `needed` is what the table costs without one. Bars are dropped ENTIRELY rather than
 * truncated when the terminal is narrow: a truncated bar is a lie about a proportion,
 * and losing the aid is always better than losing or distorting the data (FR-074).
 */
export function barsFit(viewWidth: number, needed: number): boolean {
  return viewWidth - needed >= BAR_WIDTH + 1
}
