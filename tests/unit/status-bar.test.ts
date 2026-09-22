import { describe, expect, test } from "bun:test"
import type { Subscription } from "../../src/sources/scheduler.ts"
import {
  isTooSmall,
  keyHintLine,
  MIN_COLUMNS,
  MIN_ROWS,
  NATIONAL_HINTS,
  staleWarning,
  tooSmallMessage,
} from "../../src/ui/components/status.ts"

function sub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    sourceKey: "national",
    areaKind: "national",
    areaId: "",
    nextDueAt: null,
    lastAttemptAt: "2026-10-09T21:00:00.000Z",
    lastSuccessAt: "2026-10-09T21:00:00.000Z",
    lastError: null,
    consecutiveFailures: 0,
    etag: null,
    lastModified: null,
    pinned: false,
    ...overrides,
  }
}

describe("staleWarning (FR-044)", () => {
  test("is absent while everything is current", () => {
    expect(staleWarning([sub(), sub({ sourceKey: "district:CZ0100" })])).toBeNull()
  })

  test("states the reason and the age of the data", () => {
    const warning = staleWarning(
      [sub({ consecutiveFailures: 3, lastError: "Spojení odmítnuto" })],
      new Date("2026-10-09T21:10:00.000Z"),
    )
    expect(warning).not.toBeNull()
    expect(warning).toContain("Spojení odmítnuto")
    expect(warning).toContain("10 min")
  })

  test("is unmissable in plain text, not signalled by colour alone (FR-040)", () => {
    const warning = staleWarning([sub({ consecutiveFailures: 1, lastError: "timeout" })]) ?? ""
    expect(warning).toContain("ZASTARALÁ DATA")
    expect(warning.startsWith("!")).toBe(true)
  })

  test("reports the worst failure rather than burying it in a list", () => {
    const warning = staleWarning([
      sub({ sourceKey: "district:CZ0100", consecutiveFailures: 1, lastError: "prvni" }),
      sub({ sourceKey: "district:CZ0642", consecutiveFailures: 7, lastError: "nejhorsi" }),
    ])
    expect(warning).toContain("nejhorsi")
    expect(warning).toContain("2 zdrojů")
  })

  test("handles a source that has never succeeded", () => {
    const warning = staleWarning([sub({ consecutiveFailures: 2, lastSuccessAt: null, lastError: "404" })])
    expect(warning).toContain("bez úspěšného načtení")
  })
})

describe("terminal size (FR-041)", () => {
  test("the documented minimum is enforced in both dimensions", () => {
    expect(isTooSmall(MIN_COLUMNS - 1, MIN_ROWS)).toBe(true)
    expect(isTooSmall(MIN_COLUMNS, MIN_ROWS - 1)).toBe(true)
    expect(isTooSmall(MIN_COLUMNS, MIN_ROWS)).toBe(false)
  })

  test("the message states both the requirement and the current size", () => {
    const lines = tooSmallMessage(60, 20).join("\n")
    expect(lines).toContain(`${MIN_COLUMNS} × ${MIN_ROWS}`)
    expect(lines).toContain("60 × 20")
    // It must be clear the application has not died.
    expect(lines).toContain("pokračuje v běhu")
  })
})

describe("key hints (FR-005)", () => {
  test("every hint is discoverable from the footer", () => {
    const line = keyHintLine(NATIONAL_HINTS, 100)
    for (const hint of NATIONAL_HINTS) {
      expect(line).toContain(hint.key)
      expect(line).toContain(hint.label)
    }
  })

  test("quit is always offered, so the user is never trapped", () => {
    expect(NATIONAL_HINTS.some((h) => h.key === "q")).toBe(true)
  })

  test("the line never exceeds the terminal width", () => {
    expect([...keyHintLine(NATIONAL_HINTS, 40)]).toHaveLength(40)
  })
})

describe("warning robustness", () => {
  test("a success timestamp ahead of the local clock reports zero, not a negative age", () => {
    // Possible under clock skew. "před -900 s" is worse than useless to a reader.
    const warning = staleWarning(
      [
        sub({
          consecutiveFailures: 1,
          lastError: "503",
          lastSuccessAt: "2026-10-09T22:00:00.000Z",
        }),
      ],
      new Date("2026-10-09T21:45:00.000Z"),
    )
    expect(warning).not.toContain("-")
    expect(warning).toContain("před 0 s")
  })

  test("a long parser message is truncated, so the warning stays one line", () => {
    const long =
      "vysledky.xml: XML není well-formed: Expected closing tag 'VOLEBNI_STRANA' " +
      "(opened in line 6, col 1) instead of closing tag 'VYSLEDEK'. (řádek 7)"
    const warning = staleWarning([sub({ consecutiveFailures: 1, lastError: long })]) ?? ""
    expect(warning.length).toBeLessThan(140)
    expect(warning).toContain("…")
    // The gist must survive the truncation.
    expect(warning).toContain("well-formed")
  })
})
