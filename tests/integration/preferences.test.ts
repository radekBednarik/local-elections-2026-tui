import type { Database } from "bun:sqlite"
import { beforeEach, describe, expect, test } from "bun:test"
import { openDatabase, openMemoryDatabase } from "../../src/storage/db.ts"
import {
  readSidePanelOpen,
  readTheme,
  writeSidePanelOpen,
  writeTheme,
} from "../../src/storage/queries/preferences.ts"
import { THEME_NAMES, type ThemeName } from "../../src/ui/theme/themes.ts"
import { withTempDataDir } from "../helpers/tmpdir.ts"

let db: Database
beforeEach(() => {
  db = openMemoryDatabase()
})

describe("theme preference (FR-061)", () => {
  test("is absent on a fresh database, so detection decides", () => {
    expect(readTheme(db)).toBeNull()
  })

  test("round-trips every theme", () => {
    for (const theme of THEME_NAMES) {
      writeTheme(db, theme)
      expect(readTheme(db)).toBe(theme)
    }
  })

  test("survives a restart", async () => {
    await withTempDataDir((dir) => {
      const path = dir.file("volby.sqlite")
      const first = openDatabase(path)
      writeTheme(first, "high-contrast")
      first.close()

      const second = openDatabase(path)
      try {
        expect(readTheme(second)).toBe("high-contrast")
      } finally {
        second.close()
      }
    })
  })

  test.each([
    ["dark", "tokyonight"],
    ["light", "catppuccin-latte"],
    ["high-contrast", "high-contrast"],
  ])("a stored %s from before the refresh carries over to %s (002 FR-006a)", (stored, expected) => {
    db.query("INSERT OR REPLACE INTO app_config (key, value) VALUES ('theme', $v)").run({ v: stored })
    expect(readTheme(db)).toBe(expected as ThemeName)
  })

  test("carrying a legacy value over does not rewrite it; the next theme switch does", () => {
    db.query("INSERT OR REPLACE INTO app_config (key, value) VALUES ('theme', 'dark')").run()
    readTheme(db)
    const stored = db.query("SELECT value FROM app_config WHERE key = 'theme'").get() as { value: string }
    expect(stored.value).toBe("dark")
  })

  test("an unrecognised stored value reads as absent, not as an error", () => {
    // A database hand-edited to nonsense should give a working default rather than
    // refusing to start (FR-046).
    db.query("INSERT OR REPLACE INTO app_config (key, value) VALUES ('theme', 'solarized')").run()
    expect(readTheme(db)).toBeNull()
  })
})

describe("side panel preference (FR-056)", () => {
  test("defaults to open on a first run", () => {
    expect(readSidePanelOpen(db)).toBe(true)
  })

  test("round-trips both states", () => {
    writeSidePanelOpen(db, false)
    expect(readSidePanelOpen(db)).toBe(false)
    writeSidePanelOpen(db, true)
    expect(readSidePanelOpen(db)).toBe(true)
  })

  test("survives a restart", async () => {
    await withTempDataDir((dir) => {
      const path = dir.file("volby.sqlite")
      const first = openDatabase(path)
      writeSidePanelOpen(first, false)
      first.close()

      const second = openDatabase(path)
      try {
        expect(readSidePanelOpen(second)).toBe(false)
      } finally {
        second.close()
      }
    })
  })
})

describe("no schema change was needed", () => {
  test("both preferences live in the existing app_config table", () => {
    writeTheme(db, "catppuccin-latte")
    writeSidePanelOpen(db, false)

    const keys = (db.query("SELECT key FROM app_config ORDER BY key").all() as { key: string }[]).map(
      (r) => r.key,
    )
    expect(keys).toContain("theme")
    expect(keys).toContain("side_panel_open")

    // And they sit alongside what was already stored there.
    expect(keys).toContain("schema_version")
  })
})
