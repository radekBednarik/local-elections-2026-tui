/**
 * Colour depth (task T063, research R8).
 *
 * A terminal that reports 256 colours but not true colour is given each theme colour as
 * its nearest xterm-256 index. OpenTUI's documentation says it will "emit or
 * approximate" a colour, but no approximation could be observed, so the application
 * does it rather than trust it.
 *
 * Only indices 16 to 255 are considered: the 6×6×6 colour cube and the grey ramp, whose
 * values are fixed by the xterm standard. Indices 0 to 15 are the terminal's own palette
 * and could be anything.
 */

/** The six levels of each channel in the colour cube. */
const CUBE = [0, 95, 135, 175, 215, 255]

/** Every candidate index with the colour it stands for. */
const CANDIDATES: [number, number, number, number][] = [
  ...Array.from({ length: 216 }, (_, i): [number, number, number, number] => [
    16 + i,
    CUBE[Math.floor(i / 36)] ?? 0,
    CUBE[Math.floor(i / 6) % 6] ?? 0,
    CUBE[i % 6] ?? 0,
  ]),
  ...Array.from({ length: 24 }, (_, i): [number, number, number, number] => {
    const v = 8 + i * 10
    return [232 + i, v, v, v]
  }),
]

const cache = new Map<string, number>()

/**
 * The xterm-256 index nearest to a `#rrggbb` colour, by Euclidean distance in RGB.
 *
 * Cached per value: a theme has eighteen colours and they are asked for on every draw.
 */
export function nearest256(hex: string): number {
  const known = cache.get(hex)
  if (known !== undefined) return known
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
  let best = 16
  let bestDistance = Number.POSITIVE_INFINITY
  for (const [index, cr, cg, cb] of CANDIDATES) {
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2
    if (d < bestDistance) {
      best = index
      bestDistance = d
    }
  }
  cache.set(hex, best)
  return best
}
