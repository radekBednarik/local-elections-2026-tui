/**
 * The context-sensitive status bar (T122, FR-064) and the registry behind it (T127).
 *
 * The rule under test is a negative one: the status bar MUST NOT offer an action that
 * would do nothing where the user is standing. A key that is advertised and then does
 * nothing teaches the user to distrust the whole bar.
 */

import { describe, expect, test } from "bun:test"
import { contextHints, statusBarLine } from "../../src/ui/components/status.ts"
import type { Screen } from "../../src/ui/navigation.ts"
import { ACTIONS, type ActionContext, availableActions } from "../../src/ui/palette/actions.ts"

function ctx(screen: Screen, overrides: Partial<ActionContext> = {}): ActionContext {
  return {
    screen,
    depth: 1,
    rowCount: 0,
    councilTypes: 1,
    searchActive: false,
    ...overrides,
  }
}

const ids = (context: ActionContext) => availableActions(context).map((a) => a.id)

describe("only what applies here (FR-064)", () => {
  test("the national overview does not offer a list movement it has no list for", () => {
    expect(ids(ctx({ kind: "national" }))).not.toContain("move")
  })

  test("a district list does offer it", () => {
    expect(ids(ctx({ kind: "districts" }, { rowCount: 78 }))).toContain("move")
  })

  test("only a council can be watched", () => {
    expect(ids(ctx({ kind: "council", kodzastup: "582786" }))).toContain("watch")
    expect(ids(ctx({ kind: "districts" }, { rowCount: 78 }))).not.toContain("watch")
  })

  test("going back is not offered at the top level", () => {
    expect(ids(ctx({ kind: "national" }))).not.toContain("back")
    expect(ids(ctx({ kind: "district", nuts: "CZ0642" }, { depth: 3 }))).toContain("back")
  })

  test("the council type switch needs more than one type to switch between", () => {
    expect(ids(ctx({ kind: "national" }, { councilTypes: 1 }))).not.toContain("council-type")
    expect(ids(ctx({ kind: "national" }, { councilTypes: 2 }))).toContain("council-type")
  })

  test("a screen without a table does not offer to export one", () => {
    expect(ids(ctx({ kind: "help" }))).not.toContain("export-csv")
    expect(ids(ctx({ kind: "council", kodzastup: "582786" }))).toContain("export-csv")
  })

  test("the summary report exists only where one can be written", () => {
    expect(ids(ctx({ kind: "national" }))).not.toContain("export-report")
    expect(ids(ctx({ kind: "district", nuts: "CZ0642" }, { depth: 2 }))).toContain("export-report")
  })

  test("help is not offered while it is already open", () => {
    expect(ids(ctx({ kind: "help" }, { depth: 2 }))).not.toContain("help")
  })

  test("q does not quit while the search box has focus", () => {
    expect(ids(ctx({ kind: "search" }, { searchActive: true }))).not.toContain("quit")
  })
})

describe("every unavailable action states a reason (FR-069)", () => {
  test("no action refuses silently", () => {
    const screens: Screen[] = [
      { kind: "national" },
      { kind: "districts" },
      { kind: "district", nuts: "CZ0642" },
      { kind: "council", kodzastup: "582786" },
      { kind: "candidates", kodzastup: "582786", vstrana: "1", ballotOrder: 1 },
      { kind: "watchlist" },
      { kind: "search" },
      { kind: "help" },
    ]
    for (const screen of screens) {
      for (const action of ACTIONS) {
        const reason = action.unavailable(ctx(screen))
        if (reason !== null) expect(reason.length).toBeGreaterThan(5)
      }
    }
  })
})

describe("the rendered bar", () => {
  test("shows the key beside the label, so the bar teaches the keys", () => {
    const line = statusBarLine(ctx({ kind: "council", kodzastup: "582786" }, { depth: 3 }), 120)
    expect(line).toContain("w sledovat")
    expect(line).toContain("esc zpět")
  })

  test("never exceeds the width, dropping the least important first", () => {
    for (const width of [80, 100, 40, 20]) {
      expect([...statusBarLine(ctx({ kind: "national" }), width)].length).toBe(width)
    }
  })

  test("a narrow bar keeps the most important actions", () => {
    const narrow = statusBarLine(ctx({ kind: "districts" }, { rowCount: 78, depth: 2 }), 30)
    expect(narrow).toContain("výběr")
  })

  test("the hints come from the registry, not from a second list", () => {
    const context = ctx({ kind: "watchlist" }, { rowCount: 2, depth: 2 })
    expect(contextHints(context).map((h) => h.label)).toEqual(availableActions(context).map((a) => a.hint))
  })
})
