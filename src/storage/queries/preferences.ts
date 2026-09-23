/**
 * User preferences (tasks T113, T151).
 *
 * Stored in the existing `app_config` key-value table, so no schema change was needed
 * for the UX amendment. They belong there because they travel with the data directory,
 * exactly as the election selection and the reference-load marker already do.
 *
 * An unrecognised stored value is treated as absent rather than as an error. A database
 * hand-edited to nonsense should give the user a working default, not a refusal to
 * start (FR-046).
 */

import type { Database } from "bun:sqlite"
import { isThemeName, type ThemeName } from "../../ui/theme/themes.ts"

const THEME_KEY = "theme"
const PANEL_KEY = "side_panel_open"

function read(db: Database, key: string): string | null {
  const row = db.query("SELECT value FROM app_config WHERE key = $k").get({ k: key }) as {
    value: string
  } | null
  return row?.value ?? null
}

function write(db: Database, key: string, value: string): void {
  db.query("INSERT OR REPLACE INTO app_config (key, value) VALUES ($k, $v)").run({ k: key, v: value })
}

/**
 * Themes that existed before the visual refresh, and what each became (002 FR-006a).
 *
 * "dark" and "light" took their colours from the terminal's own palette, which a
 * painted background cannot. A user who had chosen one gets its nearest replacement
 * rather than losing the choice. The stored value is left alone; the next theme switch
 * writes the new name.
 */
const LEGACY_THEMES: Record<string, ThemeName> = {
  dark: "tokyonight",
  light: "catppuccin-latte",
}

/** The stored theme, or null when none is stored or the value is unrecognised (FR-061). */
export function readTheme(db: Database): ThemeName | null {
  const stored = read(db, THEME_KEY)
  const value = stored === null ? null : (LEGACY_THEMES[stored] ?? stored)
  return value !== null && isThemeName(value) ? value : null
}

export function writeTheme(db: Database, theme: ThemeName): void {
  write(db, THEME_KEY, theme)
}

/** Whether the side panel is open. Defaults to open on a first run (FR-056). */
export function readSidePanelOpen(db: Database): boolean {
  const value = read(db, PANEL_KEY)
  if (value === null) return true
  return value === "1"
}

export function writeSidePanelOpen(db: Database, open: boolean): void {
  write(db, PANEL_KEY, open ? "1" : "0")
}
