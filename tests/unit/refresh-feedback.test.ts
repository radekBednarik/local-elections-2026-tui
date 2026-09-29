/**
 * What a manual refresh tells the user (bug manual-refresh-no-feedback, FR-019).
 *
 * Pressing `r` used to change nothing but the title-bar clock, so a refresh that found
 * no change, one the 60-second floor refused, and one that failed all looked alike.
 */

import { describe, expect, test } from "bun:test"
import { createLogger, type Logger } from "../../src/logging/logger.ts"
import { MIN_COLUMNS } from "../../src/ui/components/status.ts"
import {
  ManualRefresh,
  REFRESHING_NOTICE,
  refreshNotice,
  refreshTooSoonNotice,
  summariseRefresh,
} from "../../src/ui/refresh.ts"
import { withTempDataDir } from "../helpers/tmpdir.ts"

async function withLog(run: (log: Logger) => void): Promise<void> {
  await withTempDataDir((dir) => run(createLogger(dir.file("volby.log"))))
}
const messages = (log: Logger) => log.entries().map((e) => `${e.level} ${e.message}`)

describe("tracking a manual refresh", () => {
  test("reports once, after every requested source is in, with one log entry", async () => {
    await withLog((log) => {
      const refresh = new ManualRefresh(log)
      expect(refresh.start(["national", "district:CZ0100"])).toBe(REFRESHING_NOTICE)

      expect(refresh.settle("national", "unchanged")).toBeNull()
      expect(messages(log)).toEqual([])
      expect(refresh.settle("district:CZ0100", "not-modified")).toBe(refreshNotice("unchanged"))
      expect(messages(log)).toEqual(["info Ruční obnovení"])

      // Later polls of the same sources belong to no refresh, and say nothing.
      expect(refresh.settle("national", "changed")).toBeNull()
      expect(messages(log)).toEqual(["info Ruční obnovení"])
    })
  })

  test("a fetch of a source the refresh did not ask for is ignored", async () => {
    await withLog((log) => {
      const refresh = new ManualRefresh(log)
      refresh.start(["national"])
      expect(refresh.settle("district:CZ0100", "changed")).toBeNull()
      expect(refresh.settle("national", "failed")).toBe(refreshNotice("failed"))
    })
  })

  test("with no refresh started, fetches say nothing", async () => {
    await withLog((log) => {
      expect(new ManualRefresh(log).settle("national", "changed")).toBeNull()
      expect(messages(log)).toEqual([])
    })
  })

  test("a refused refresh is logged and says how long to wait", async () => {
    await withLog((log) => {
      expect(new ManualRefresh(log).refused(42)).toBe(refreshTooSoonNotice(42))
      expect(messages(log)).toEqual(["info Ruční obnovení odloženo"])
    })
  })
})

describe("summarising a manual refresh", () => {
  test("identical figures and a 304 both read as unchanged", () => {
    expect(summariseRefresh(["unchanged"])).toBe("unchanged")
    expect(summariseRefresh(["not-modified", "unchanged"])).toBe("unchanged")
  })

  test("new figures from any source read as new data", () => {
    expect(summariseRefresh(["unchanged", "changed"])).toBe("changed")
  })

  test("a failure wins over a success, and says whether anything loaded", () => {
    expect(summariseRefresh(["failed"])).toBe("failed")
    expect(summariseRefresh(["failed", "failed"])).toBe("failed")
    expect(summariseRefresh(["changed", "failed"])).toBe("partial")
  })
})

describe("manual refresh notices", () => {
  test("each outcome has its own text", () => {
    const texts = (["changed", "unchanged", "partial", "failed"] as const).map(refreshNotice)
    expect(new Set(texts).size).toBe(texts.length)
  })

  test("a failure points at the logs view", () => {
    expect(refreshNotice("failed")).toContain("l záznamy")
    expect(refreshNotice("partial")).toContain("l záznamy")
  })

  test("a refused refresh says how long to wait", () => {
    expect(refreshTooSoonNotice(42)).toContain("42 s")
  })

  test("every notice fits the 80-column minimum with the row's leading space", () => {
    const texts = [
      REFRESHING_NOTICE,
      refreshTooSoonNotice(60),
      ...(["changed", "unchanged", "partial", "failed"] as const).map(refreshNotice),
    ]
    for (const text of texts) expect([...` ${text}`].length).toBeLessThanOrEqual(MIN_COLUMNS)
  })
})
