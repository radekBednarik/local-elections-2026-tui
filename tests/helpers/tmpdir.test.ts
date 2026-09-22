import { describe, expect, test } from "bun:test"
import { existsSync, writeFileSync } from "node:fs"
import { createTempDataDir, withTempDataDir } from "./tmpdir.ts"

describe("createTempDataDir", () => {
  test("creates a real, empty, unique directory", () => {
    const a = createTempDataDir()
    const b = createTempDataDir()
    try {
      expect(existsSync(a.path)).toBe(true)
      expect(existsSync(b.path)).toBe(true)
      expect(a.path).not.toBe(b.path)
    } finally {
      a.cleanup()
      b.cleanup()
    }
  })

  test("cleanup removes the directory and its contents, and is safe to repeat", () => {
    const dir = createTempDataDir()
    writeFileSync(dir.file("volby.sqlite"), "x")
    expect(existsSync(dir.file("volby.sqlite"))).toBe(true)

    dir.cleanup()
    expect(existsSync(dir.path)).toBe(false)

    expect(() => {
      dir.cleanup()
    }).not.toThrow()
  })
})

describe("withTempDataDir", () => {
  test("cleans up after the body returns", async () => {
    let captured = ""
    const result = await withTempDataDir((dir) => {
      captured = dir.path
      return 42
    })
    expect(result).toBe(42)
    expect(existsSync(captured)).toBe(false)
  })

  test("cleans up even when the body throws", async () => {
    let captured = ""
    await expect(
      withTempDataDir((dir) => {
        captured = dir.path
        throw new Error("boom")
      }),
    ).rejects.toThrow("boom")
    expect(existsSync(captured)).toBe(false)
  })
})
