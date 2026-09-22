import { describe, expect, test } from "bun:test"
import { resolveDataDir, resolvePaths } from "../../src/config/paths.ts"

const WIN = { APPDATA: "C:\\Users\\tester\\AppData\\Roaming" }
const XDG = { XDG_DATA_HOME: "/home/tester/.local/share", XDG_STATE_HOME: "/home/tester/.local/state" }

describe("precedence (FR-047)", () => {
  test("--data-dir beats the environment variable", () => {
    const dir = resolveDataDir({
      platform: "linux",
      env: { ...XDG, VOLBY_DATA_DIR: "/from/env" },
      override: "/from/flag",
    })
    expect(dir).toBe("/from/flag")
  })

  test("VOLBY_DATA_DIR beats the OS convention", () => {
    const dir = resolveDataDir({
      platform: "linux",
      env: { ...XDG, VOLBY_DATA_DIR: "/from/env" },
      override: null,
    })
    expect(dir).toBe("/from/env")
  })
})

describe("OS conventions", () => {
  test("Windows uses APPDATA", () => {
    const dir = resolveDataDir({ platform: "win32", env: WIN, override: null })
    expect(dir).toBe("C:\\Users\\tester\\AppData\\Roaming\\volby-kv2026")
  })

  test("Linux uses XDG_DATA_HOME", () => {
    const dir = resolveDataDir({ platform: "linux", env: XDG, override: null })
    expect(dir).toBe("/home/tester/.local/share/volby-kv2026")
  })

  test("Linux falls back to ~/.local/share when XDG_DATA_HOME is unset", () => {
    const dir = resolveDataDir({ platform: "linux", env: { HOME: "/home/tester" }, override: null })
    expect(dir).toBe("/home/tester/.local/share/volby-kv2026")
  })

  test("Windows falls back to USERPROFILE when APPDATA is unset", () => {
    const dir = resolveDataDir({
      platform: "win32",
      env: { USERPROFILE: "C:\\Users\\tester" },
      override: null,
    })
    expect(dir).toContain("tester")
    expect(dir).toContain("volby-kv2026")
  })
})

describe("resolvePaths", () => {
  test("database, log and config all sit under the data directory", () => {
    const paths = resolvePaths({ platform: "linux", env: XDG, override: "/data" })
    expect(paths.dataDir).toBe("/data")
    expect(paths.database.startsWith("/data")).toBe(true)
    expect(paths.log.startsWith("/data")).toBe(true)
    expect(paths.database).toContain(".sqlite")
    expect(paths.log).toContain(".log")
  })

  test("paths are stable across calls with the same inputs", () => {
    const a = resolvePaths({ platform: "linux", env: XDG, override: null })
    const b = resolvePaths({ platform: "linux", env: XDG, override: null })
    expect(a).toEqual(b)
  })
})
