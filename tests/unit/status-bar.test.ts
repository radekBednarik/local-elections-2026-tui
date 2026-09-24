import { describe, expect, test } from "bun:test"
import { formatAge } from "../../src/domain/status.ts"
import type { Subscription } from "../../src/sources/scheduler.ts"
import {
  allFinal,
  isTooSmall,
  keyHintLine,
  MIN_COLUMNS,
  MIN_ROWS,
  NATIONAL_HINTS,
  sourceStatus,
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
    final: false,
    ...overrides,
  }
}

describe("sourceStatus (004 FR-001–FR-004)", () => {
  const NOW = new Date("2026-10-09T21:10:00.000Z")
  const AWAITING = "○ Výsledky zatím nejsou zveřejněny, aplikace je dál kontroluje. · l záznamy"
  const stale = (age: string) => `! ZASTARALÁ DATA z doby ${age}. Obnovení se nedaří. · l záznamy`
  const PARSER =
    "vysledky.xml: XML není well-formed: Expected closing tag 'VOLEBNI_STRANA' " +
    "(opened in line 6, col 1) instead of closing tag 'VYSLEDEK'. (řádek 7)"

  test("is absent while everything is current", () => {
    expect(sourceStatus([sub(), sub({ sourceKey: "district:CZ0100" })], NOW)).toBeNull()
  })

  test("ignores a final source that failed, since final figures are not stale (003 FR-009)", () => {
    expect(sourceStatus([sub({ final: true, consecutiveFailures: 1, lastError: "timeout" })], NOW)).toBeNull()
  })

  test("a source that never loaded is awaiting publication, never stale (FR-001, FR-002)", () => {
    const status = sourceStatus(
      [sub({ consecutiveFailures: 2, lastSuccessAt: null, lastError: "Data zatím nejsou zveřejněna" })],
      NOW,
    )
    expect(status?.kind).toBe("awaiting")
    expect(status?.text).toBe(AWAITING)
    expect(status?.text).not.toContain("ZASTARALÁ")
    expect(status?.text).not.toContain("Data zatím nejsou zveřejněna")
  })

  test("a document rejected before it ever loaded is awaiting too (spec scenario 1.2)", () => {
    const status = sourceStatus(
      [sub({ consecutiveFailures: 1, lastSuccessAt: null, lastError: PARSER })],
      NOW,
    )
    expect(status?.kind).toBe("awaiting")
    expect(status?.text).toBe(AWAITING)
  })

  test("a source that loaded before and now fails is stale, with the age of its data (FR-003)", () => {
    const status = sourceStatus(
      [
        sub({
          sourceKey: "district:CZ0642",
          consecutiveFailures: 3,
          lastError: "Spojení odmítnuto",
          lastSuccessAt: "2026-10-09T21:06:00.000Z",
        }),
      ],
      NOW,
    )
    expect(status?.kind).toBe("stale")
    expect(status?.text).toBe(stale(formatAge(240)))
    expect(status?.text).toBe(stale("před 4 min"))
    expect(status?.text).not.toContain("Spojení odmítnuto")
    expect(status?.text).not.toContain("CZ0642")
  })

  test("stale wins when never-loaded and previously loaded sources fail together", () => {
    const status = sourceStatus(
      [
        sub({ sourceKey: "national", consecutiveFailures: 1, lastSuccessAt: null, lastError: "404" }),
        sub({ sourceKey: "district:CZ0100", consecutiveFailures: 1, lastError: "503" }),
      ],
      NOW,
    )
    expect(status?.kind).toBe("stale")
  })

  test("with several stale sources the oldest data's age is reported (research R2)", () => {
    const status = sourceStatus(
      [
        sub({
          sourceKey: "district:CZ0100",
          consecutiveFailures: 1,
          lastSuccessAt: "2026-10-09T21:08:00.000Z",
        }),
        sub({
          sourceKey: "district:CZ0642",
          consecutiveFailures: 9,
          lastSuccessAt: "2026-10-09T21:00:00.000Z",
        }),
      ],
      NOW,
    )
    expect(status?.text).toBe(stale(formatAge(600)))
  })

  test("a success timestamp ahead of the local clock reports zero, not a negative age", () => {
    // Possible under clock skew. "před -900 s" is worse than useless to a reader.
    const status = sourceStatus(
      [sub({ consecutiveFailures: 1, lastError: "503", lastSuccessAt: "2026-10-09T22:00:00.000Z" })],
      new Date("2026-10-09T21:45:00.000Z"),
    )
    expect(status?.text).toBe(stale("před 0 s"))
  })

  test("fits the 80-column minimum whole, key hint included, at any age (FR-004, US1/AC4)", () => {
    // The row adds one leading space; a line cut to fit would lose the hint first.
    const at = (seconds: number) => new Date(NOW.getTime() - seconds * 1000).toISOString()
    const statuses = [
      sourceStatus([sub({ consecutiveFailures: 1, lastSuccessAt: null })], NOW),
      ...[59, 59 * 60, 23 * 3600 + 59 * 60, 999 * 3600 + 59 * 60].map((age) =>
        sourceStatus([sub({ consecutiveFailures: 1, lastSuccessAt: at(age) })], NOW),
      ),
    ]
    expect(statuses[4]?.text).toContain(formatAge(999 * 3600 + 59 * 60))
    for (const status of statuses) {
      const text = status?.text ?? ""
      expect([...` ${text}`].length).toBeLessThanOrEqual(79)
      expect(text.endsWith("· l záznamy")).toBe(true)
    }
  })

  test("no error text reaches the line, whatever the reason says (FR-004)", () => {
    for (const lastError of [PARSER, "řádek 1\nřádek 2", "503 Service Unavailable"]) {
      for (const lastSuccessAt of [null, "2026-10-09T21:00:00.000Z"]) {
        const text =
          sourceStatus([sub({ consecutiveFailures: 1, lastError, lastSuccessAt })], NOW)?.text ?? ""
        expect(text).not.toContain(lastError)
        expect(text).not.toContain("\n")
        expect(text).toContain("l záznamy")
      }
    }
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

describe("finality indicator (FR-008)", () => {
  const final = (sourceKey: Subscription["sourceKey"]) => sub({ sourceKey, final: true })

  test("is on when every source shown is final", () => {
    expect(allFinal([final("national"), final("district:CZ0100")], ["national", "district:CZ0100"])).toBe(
      true,
    )
  })

  test("is off while any source shown is still in progress", () => {
    expect(
      allFinal([final("national"), sub({ sourceKey: "district:CZ0100" })], ["national", "district:CZ0100"]),
    ).toBe(false)
  })

  test("is off while a source shown is not subscribed yet", () => {
    expect(allFinal([final("national")], ["national", "district:CZ0100"])).toBe(false)
  })

  test("is off when nothing is shown", () => {
    expect(allFinal([final("national")], [])).toBe(false)
  })
})
