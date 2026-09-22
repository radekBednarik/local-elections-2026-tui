import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { createLogger, createNullLogger } from "../../src/logging/logger.ts"
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

describe("null logger", () => {
  test("accepts every call and writes nothing", () => {
    const log = createNullLogger()
    expect(() => {
      log.error("x")
      log.debug("y", { a: 1 })
    }).not.toThrow()
    expect(log.path).toBe("")
  })
})
