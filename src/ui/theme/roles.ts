/**
 * Colour roles (task T110, FR-059).
 *
 * Six roles, each with one meaning. A role resolves to the same colour on every screen,
 * which is the whole point: a user learns that warnings look one way and learns it once.
 *
 * Deliberately absent: a role for an electoral party. With thousands of local candidate
 * lists there is no authoritative colour per party, and assigning one would imply a
 * political affiliation the source never published (FR-060).
 */

export const ROLES = ["heading", "selection", "warning", "increase", "decrease", "muted"] as const

export type Role = (typeof ROLES)[number]

/** What each role is for, so the set cannot quietly grow a second meaning. */
export const ROLE_MEANING: Record<Role, string> = {
  heading: "Column headers and region titles",
  selection: "The row the user has highlighted",
  warning: "Stale data, failures, anything needing attention",
  increase: "A value that rose since the previous refresh",
  decrease: "A value that fell since the previous refresh",
  muted: "Secondary text: codes, timestamps, hints",
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value)
}
