/**
 * Colour roles (tasks T110, T007, FR-059, FR-003).
 *
 * Eight roles, each with one meaning. A role resolves to the same slot in every theme and
 * on every screen, which is the whole point: a user learns that warnings look one way
 * and learns it once.
 *
 * Deliberately absent: a role for an electoral party. With thousands of local candidate
 * lists there is no authoritative colour per party, and assigning one would imply a
 * political affiliation the source never published (FR-060).
 */

import type { Slot } from "./themes.ts"

export const ROLES = [
  "heading",
  "selection",
  "warning",
  "increase",
  "decrease",
  "muted",
  "accent",
  "subtle",
] as const

export type Role = (typeof ROLES)[number]

/** What each role is for, so the set cannot quietly grow a second meaning. */
export const ROLE_MEANING: Record<Role, string> = {
  heading: "Column headers and region titles",
  selection: "The row the user has highlighted",
  warning: "Stale data, failures, anything needing attention",
  increase: "A value that rose since the previous refresh",
  decrease: "A value that fell since the previous refresh",
  muted: "Secondary text: codes, timestamps, hints",
  accent: "The sorted column, the side panel title, emphasised figures",
  subtle: "Secondary figures, chip and status bar labels",
}

/**
 * The slot each role takes, and whether it is bold (data-model.md § Role → slot).
 *
 * `selectionText` is not a slot but a pointer to one: the theme says which slot its
 * selected row's text uses, because high contrast reverses its selection. Bold is the
 * same in every theme, monochrome included, so emphasis survives a terminal without
 * colour (FR-063).
 */
export const ROLE_SLOT: Record<Role, { slot: Slot | "selectionText"; bold: boolean }> = {
  heading: { slot: "primary", bold: true },
  selection: { slot: "selectionText", bold: true },
  warning: { slot: "warning", bold: true },
  increase: { slot: "success", bold: false },
  decrease: { slot: "error", bold: false },
  muted: { slot: "muted", bold: false },
  accent: { slot: "accent", bold: true },
  subtle: { slot: "subtle", bold: false },
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value)
}
