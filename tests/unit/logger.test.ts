import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { createLogger, createNullLogger, LOG_VIEW_LIMIT } from "../../src/logging/logger.ts"
import { withTempDataDir } from "../helpers/tmpdir.ts"

describe("level filtering", () => {
  test("info level records error, warn and info but not debug", async () => {
    await withTempDataDir((dir) => {
      const log = createLogger(dir.file("volby.log"), "info")
      log.error("chyba")
      log.warn("varovani")
      log.info("informace")
      log.debug("ladeni")

      const contents = readFileSync(log.path, "utf8")
      expect(contents).toContain("chyba")
      expect(contents).toContain("varovani")
      expect(contents).toContain("informace")
      expect(contents).not.toContain("ladeni")
    })
  })

  test("error level records only errors", async () => {
    await withTempDataDir((dir) => {
      const log = createLogger(dir.file("volby.log"), "error")
      log.error("chyba")
      log.warn("varovani")
      expect(readFileSync(log.path, "utf8")).not.toContain("varovani")
    })
  })

  test("debug level records everything", async () => {
    await withTempDataDir((dir) => {
      const log = createLogger(dir.file("volby.log"), "debug")
      log.debug("ladeni")
      expect(readFileSync(log.path, "utf8")).toContain("ladeni")
    })
  })
})

describe("entry format", () => {
  test("each entry carries a timestamp and the level", async () => {
    await withTempDataDir((dir) => {
      const log = createLogger(dir.file("volby.log"))
      log.info("zprava")
      const line = readFileSync(log.path, "utf8").trim()
      expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+INFO\s+zprava$/)
    })
  })

  test("an Error detail is rendered without a stack dump", async () => {
    await withTempDataDir((dir) => {
      const log = createLogger(dir.file("volby.log"))
      log.error("stahovani selhalo", new TypeError("fetch failed"))
      const contents = readFileSync(log.path, "utf8")
      expect(contents).toContain("TypeError: fetch failed")
    })
  })

  test("a structured detail is serialised as JSON", async () => {
    await withTempDataDir((dir) => {
      const log = createLogger(dir.file("volby.log"))
      log.info("stazeno", { kodzastup: "551082", status: 200 })
      expect(readFileSync(log.path, "utf8")).toContain('{"kodzastup":"551082","status":200}')
    })
  })

  test("a detail that cannot be serialised does not throw", async () => {
    await withTempDataDir((dir) => {
      const log = createLogger(dir.file("volby.log"))
      const circular: Record<string, unknown> = {}
      circular.self = circular
      expect(() => {
        log.info("cyklicky detail", circular)
      }).not.toThrow()
      expect(readFileSync(log.path, "utf8")).toContain("could not be serialised")
    })
  })

  test("Czech diacritics survive the round trip", async () => {
    await withTempDataDir((dir) => {
      const log = createLogger(dir.file("volby.log"))
      log.info("Řícany u Prahy, Žďár nad Sázavou")
      expect(readFileSync(log.path, "utf8")).toContain("Žďár nad Sázavou")
    })
  })
})

describe("resilience", () => {
  test("creates the directory if it does not exist yet", async () => {
    await withTempDataDir((dir) => {
      const log = createLogger(dir.file("hluboko/vnoreno/volby.log"))
      log.info("zprava")
      expect(readFileSync(log.path, "utf8")).toContain("zprava")
    })
  })

  test("entries are still recorded after the file can no longer be written", async () => {
    await withTempDataDir((dir) => {
      const log = createLogger(dir.file("volby.log"))
      dir.cleanup()
      log.info("po smazani", { source: "national" })
      log.warn("a jeste jednou")
      const entries = log.entries()
      expect(entries.map((e) => e.message)).toEqual(["po smazani", "a jeste jednou"])
      expect(entries[0]?.line).toMatch(
        /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+INFO\s+po smazani \| \{"source":"national"\}$/,
      )
      expect(entries[1]?.line).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+WARN\s+a jeste jednou$/)
    })
  })

  test("a logger that cannot write never throws at the call site", async () => {
    await withTempDataDir((dir) => {
      const log = createLogger(dir.file("volby.log"))
      dir.cleanup() // the directory disappears underneath it
      expect(() => {
        log.info("po smazani")
        log.error("a jeste jednou")
      }).not.toThrow()
    })
  })
})

describe("in-memory record (004 research R4)", () => {
  test("a new logger holds no entries and has dropped none", async () => {
    await withTempDataDir((dir) => {
      const log = createLogger(dir.file("volby.log"))
      expect(log.entries()).toEqual([])
      expect(log.dropped).toBe(0)
    })
  })

  test("an accepted entry is recorded with the exact line written to the file", async () => {
    await withTempDataDir((dir) => {
      const log = createLogger(dir.file("volby.log"))
      log.warn("Dokument odmítnut", { source: "district:CZ0642", reason: "x" })

      const written = readFileSync(log.path, "utf8")
      const [entry] = log.entries()
      expect(log.entries()).toHaveLength(1)
      expect(entry?.seq).toBe(0)
      expect(entry?.level).toBe("warn")
      expect(entry?.message).toBe("Dokument odmítnut")
      expect(entry?.source).toBe("district:CZ0642")
      expect(entry?.line).toBe(written.replace(/\n$/, ""))
      expect(entry?.line.startsWith(entry?.at ?? "?")).toBe(true)
      expect(entry?.detail).toBe('{"source":"district:CZ0642","reason":"x"}')
      expect(entry?.line.endsWith(`Dokument odmítnut | ${entry?.detail}`)).toBe(true)
    })
  })

  test("the detail is null without one, and the error form for an Error", async () => {
    await withTempDataDir((dir) => {
      const log = createLogger(dir.file("volby.log"))
      log.info("bez detailu")
      log.error("x", new Error("boom"))
      const [plain, failure] = log.entries()
      expect(plain?.detail).toBeNull()
      expect(plain?.line.endsWith("bez detailu")).toBe(true)
      expect(failure?.detail).toBe("Error: boom")
      expect(failure?.line.endsWith("x | Error: boom")).toBe(true)
    })
  })

  test("a detail without a string source gives no source", async () => {
    await withTempDataDir((dir) => {
      const log = createLogger(dir.file("volby.log"))
      log.info("a")
      log.info("b", { source: 3 })
      log.info("c", new Error("source"))
      expect(log.entries().map((e) => e.source)).toEqual([null, null, null])
    })
  })

  test("entries below the threshold are neither written nor recorded", async () => {
    await withTempDataDir((dir) => {
      const log = createLogger(dir.file("volby.log"), "warn")
      log.info("informace")
      log.debug("ladeni")
      expect(log.entries()).toEqual([])
    })
  })

  test("only the last LOG_VIEW_LIMIT entries are kept, and evictions are counted", async () => {
    await withTempDataDir((dir) => {
      const log = createLogger(dir.file("volby.log"))
      for (let i = 0; i < LOG_VIEW_LIMIT + 5; i++) log.info(`zprava ${i}`)
      const entries = log.entries()
      expect(entries).toHaveLength(LOG_VIEW_LIMIT)
      expect(log.dropped).toBe(5)
      expect(entries[0]?.seq).toBe(5)
      expect(entries[0]?.message).toBe("zprava 5")
      entries.forEach((entry, i) => {
        expect(entry.seq).toBe(log.dropped + i)
      })
    })
  })

  test("the limit is a thousand entries", () => {
    expect(LOG_VIEW_LIMIT).toBe(1000)
  })
})

describe("null logger", () => {
  test("accepts every call and writes nothing", () => {
    const log = createNullLogger()
    expect(() => {
      log.error("x")
      log.debug("y", { a: 1 })
    }).not.toThrow()
    expect(log.path).toBe("")
  })

  test("holds no entries, whatever is logged", () => {
    const log = createNullLogger()
    log.error("a")
    log.warn("b")
    log.info("c")
    log.debug("d")
    expect(log.entries()).toEqual([])
    expect(log.dropped).toBe(0)
  })
})
