/**
 * The logs screens (004 FR-008 to FR-014, research R6).
 *
 * Everything the application decides about these screens lives in pure functions over a
 * real `Navigation`, because nothing constructs `App` in a test. The last block reads
 * `app.ts` as text to make sure it only calls them.
 */

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { LogEntry } from "../../src/logging/logger.ts"
import { Navigation } from "../../src/ui/navigation.ts"
import { toText, toTextLines } from "../../src/ui/row.ts"
import { buildLogEntryRows, buildLogListRows, openLogs, syncLogSelection } from "../../src/ui/views/logs.ts"

function entry(seq: number, overrides: Partial<LogEntry> = {}): LogEntry {
  const at = overrides.at ?? `2026-10-09T19:0${seq % 10}:10.000Z`
  const level = overrides.level ?? "info"
  const message = overrides.message ?? `zprava ${seq}`
  const detail = overrides.detail === undefined ? null : overrides.detail
  const base = `${at} ${level.toUpperCase().padEnd(5)} ${message}`
  return {
    seq,
    at,
    level,
    message,
    detail,
    source: null,
    line: detail === null ? base : `${base} | ${detail}`,
    ...overrides,
  }
}

const localClock = (iso: string) => {
  const d = new Date(iso)
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":")
}

describe("the list (FR-009, FR-010, FR-014)", () => {
  const entries = [
    entry(0, { level: "error", message: "Neošetřená výjimka", detail: "TypeError: x" }),
    entry(1, {
      level: "warn",
      message: "Dokument odmítnut",
      source: "district:CZ0642",
      detail: '{"source":"district:CZ0642","reason":"x"}',
    }),
    entry(2, { level: "info", message: "Data zatím nejsou zveřejněna", source: "national" }),
    entry(3, { level: "debug", message: "ladeni" }),
  ]

  test("has a heading, a rule and a header naming the four columns", () => {
    const { rows } = buildLogListRows(entries, 100)
    const text = toTextLines(rows)
    expect(text[0]).toBe("Záznamy")
    const header = rows.find((r) => r.kind === "header")
    expect(header).toBeDefined()
    const headerText = toText(header ?? { cells: [] })
    for (const title of ["Čas", "Úroveň", "Zdroj", "Zpráva"]) expect(headerText).toContain(title)
  })

  test("one data row per entry, oldest first, starting at firstRow", () => {
    const { rows, firstRow } = buildLogListRows(entries, 100)
    const data = rows.filter((r) => r.kind === "data")
    expect(data).toHaveLength(4)
    expect(rows[firstRow]).toBe(data[0])
    expect(toText(data[0] ?? { cells: [] })).toContain("Neošetřená výjimka")
    expect(toText(data[3] ?? { cells: [] })).toContain("ladeni")
  })

  test("each row shows local time, a Czech level label, the source and the message with its detail", () => {
    const { rows, firstRow } = buildLogListRows(entries, 120)
    const warn = rows[firstRow + 1]
    expect(warn?.cells.map((c) => c.text)).toEqual([
      localClock(entries[1]?.at ?? ""),
      "VAROVÁNÍ",
      "district:CZ0642",
      'Dokument odmítnut | {"source":"district:CZ0642","reason":"x"}',
    ])
    const labels = rows.slice(firstRow).map((r) => r.cells[1]?.text)
    expect(labels).toEqual(["CHYBA", "VAROVÁNÍ", "INFO", "LADĚNÍ"])
  })

  test("a newline in the message cannot break the one-line row", () => {
    const multi = entry(8, { message: "Neošetřená výjimka", detail: "Error: prvni\r\ndruhy\rtreti\nctvrty" })
    const { rows, firstRow } = buildLogListRows([multi], 120)
    const text = rows[firstRow]?.cells[3]?.text ?? ""
    expect(text).not.toMatch(/[\r\n]/)
    expect(text).toBe("Neošetřená výjimka | Error: prvni ↵ druhy ↵ treti ↵ ctvrty")
  })

  test("an entry without a source leaves the source cell empty", () => {
    const { rows, firstRow } = buildLogListRows(entries, 100)
    expect(rows[firstRow]?.cells[2]?.text).toBe("")
  })

  test("the level labels share one width, so the columns line up", () => {
    const { rows } = buildLogListRows(entries, 100)
    const header = rows.find((r) => r.kind === "header")
    const levelColumn = header?.columns?.[1]
    expect(levelColumn?.width).toBe(Math.max(...["CHYBA", "VAROVÁNÍ", "INFO", "LADĚNÍ"].map((l) => l.length)))
  })

  test("a long message is cut to the width, never wrapped", () => {
    const long = entry(9, { message: "x".repeat(300) })
    const { rows, firstRow } = buildLogListRows([long], 80)
    const text = toText(rows[firstRow] ?? { cells: [] })
    expect([...text].length).toBeLessThanOrEqual(80)
    expect(text.endsWith("…")).toBe(true)
  })

  test("errors and warnings are in the warning role, debug is muted, info is plain", () => {
    const { rows, firstRow } = buildLogListRows(entries, 100)
    const roles = (i: number) => new Set(rows[firstRow + i]?.cells.map((c) => c.role))
    expect(roles(0)).toEqual(new Set(["warning"]))
    expect(roles(1)).toEqual(new Set(["warning"]))
    expect(roles(2)).toEqual(new Set([undefined]))
    expect(roles(3)).toEqual(new Set(["muted"]))
  })

  test("with no entries says so, and has nothing to select", () => {
    const { rows } = buildLogListRows([], 100)
    const text = toTextLines(rows)
    expect(text).toContain("Zatím nebyly zaznamenány žádné záznamy.")
    expect(rows.some((r) => r.kind === "data")).toBe(false)
  })
})

describe("the detail (FR-011)", () => {
  const long = entry(5, { message: "Dokument odmítnut", detail: `{"reason":"${"ř".repeat(250)}"}` })

  test("shows the whole line wrapped to the width, losing nothing", () => {
    const rows = buildLogEntryRows([entry(4), long], 5, 60)
    const text = toTextLines(rows)
    expect(text[0]).toBe("Záznam")
    // Heading, rule, blank, then the wrapped text. Read from the cells rather than
    // `toText`, which trims, so a piece ending in a space would otherwise lose it.
    const pieces = rows.slice(3).map((r) => r.cells.map((c) => c.text).join(""))
    for (const piece of pieces) expect([...piece].length).toBeLessThanOrEqual(60)
    expect(pieces.join("")).toBe(long.line)
  })

  test("a message spanning several lines keeps them as separate rows, never a raw newline in one", () => {
    const multi = entry(6, {
      level: "error",
      message: "Neošetřená výjimka",
      detail: 'ZodError: [\n  {\n    "code": 1\n  }\n]',
    })
    // Wide enough that nothing wraps, so the rows are exactly the entry's own lines.
    const rows = buildLogEntryRows([multi], 6, 200)
    const pieces = rows.slice(3).map((r) => r.cells.map((c) => c.text).join(""))
    for (const piece of pieces) expect(piece).not.toMatch(/[\r\n]/)
    expect(pieces).toHaveLength(5)
    const bare = entry(7, { detail: "Error: a\rb" })
    expect(
      buildLogEntryRows([bare], 7, 200)
        .slice(3)
        .map((r) => r.cells[0]?.text),
    ).toHaveLength(2)
    expect(pieces.join("\n")).toBe(multi.line)
  })

  test("says so when the entry has been evicted meanwhile", () => {
    const text = toTextLines(buildLogEntryRows([entry(4)], 5, 60))
    expect(text).toContain("Záznam již není k dispozici.")
  })
})

describe("opening, closing and keeping the selection (FR-008, FR-009, FR-012)", () => {
  function atCouncil(): Navigation {
    const nav = new Navigation()
    nav.push({ kind: "council", kodzastup: "582786" })
    nav.current.selected = 5
    nav.current.offset = 3
    return nav
  }

  test("opening selects the newest entry", () => {
    const nav = atCouncil()
    openLogs(nav, 4)
    expect(nav.screen.kind).toBe("logs")
    expect(nav.current.selected).toBe(3)
  })

  test("opening again while the logs are open stacks nothing (code review, T046)", () => {
    const nav = atCouncil()
    expect(openLogs(nav, 4)).toBe(true)
    const depth = nav.depth
    nav.current.selected = 1
    expect(openLogs(nav, 4)).toBe(false)
    expect(nav.depth).toBe(depth)
    expect(nav.current.selected).toBe(1)
    nav.push({ kind: "log-entry", seq: 1 })
    expect(openLogs(nav, 4)).toBe(false)
    expect(nav.depth).toBe(depth + 1)
  })

  test("with nothing logged the selection is the first row", () => {
    const nav = atCouncil()
    openLogs(nav, 0)
    expect(nav.current.selected).toBe(0)
  })

  test("closing returns to the screen it was opened from, selection and scroll intact", () => {
    const nav = atCouncil()
    openLogs(nav, 4)
    nav.pop()
    expect(nav.screen).toEqual({ kind: "council", kodzastup: "582786" })
    expect(nav.current.selected).toBe(5)
    expect(nav.current.offset).toBe(3)
  })

  test("closing an entry's detail returns to the list with its selection", () => {
    const nav = atCouncil()
    openLogs(nav, 4)
    nav.current.selected = 1
    nav.push({ kind: "log-entry", seq: 7 })
    nav.pop()
    expect(nav.screen.kind).toBe("logs")
    expect(nav.current.selected).toBe(1)
  })

  test("evictions move the selection back by as many rows, so it stays on its entry", () => {
    const nav = atCouncil()
    openLogs(nav, 20)
    nav.current.selected = 10
    expect(syncLogSelection(nav, 0, 3)).toBe(3)
    expect(nav.current.selected).toBe(7)
  })

  test("the correction is clamped at the first row", () => {
    const nav = atCouncil()
    openLogs(nav, 20)
    nav.current.selected = 2
    syncLogSelection(nav, 0, 5)
    expect(nav.current.selected).toBe(0)
  })

  test("nothing changes when nothing was dropped", () => {
    const nav = atCouncil()
    openLogs(nav, 20)
    nav.current.selected = 10
    expect(syncLogSelection(nav, 4, 4)).toBe(4)
    expect(nav.current.selected).toBe(10)
  })

  test("off the list nothing changes, and the correction waits until the user is back", () => {
    const nav = atCouncil()
    expect(syncLogSelection(nav, 0, 4)).toBe(0)
    expect(nav.current.selected).toBe(5)

    openLogs(nav, 1000)
    expect(nav.current.selected).toBe(999)
    nav.push({ kind: "log-entry", seq: 999 })
    expect(syncLogSelection(nav, 0, 4)).toBe(0)
    nav.pop()
    expect(syncLogSelection(nav, 0, 4)).toBe(4)
    expect(nav.current.selected).toBe(995)
  })
})

describe("the application only calls these, never reimplements them", () => {
  const source = readFileSync(join(import.meta.dir, "../../src/ui/app.ts"), "utf8")

  test("opening the logs and keeping the selection go through the tested functions", () => {
    expect(source).toContain("openLogs(")
    expect(source).toContain("syncLogSelection(")
    expect(source).not.toMatch(/nav\.push\(\{ kind: "logs" \}\)/)
  })

  test("an unhandled error is drawn at once, so an open logs view shows it (FR-012, T048)", () => {
    // Nothing else redraws while no source is due, e.g. once every source is final.
    for (const event of ["unhandledRejection", "uncaughtException"]) {
      expect(source).toMatch(
        new RegExp(`process\\.on\\("${event}", \\([a-z]+\\) => \\{\\s*this\\.logUnhandled\\(`),
      )
    }
    const body = source.slice(source.indexOf("private logUnhandled("))
    expect(body.slice(0, body.indexOf("\n  }\n"))).toMatch(
      /this\.deps\.log\.error\([^)]*\)[\s\S]*this\.draw\(\)/,
    )
  })

  test("copying goes through performCopy, which picks the text itself", () => {
    expect(source).toContain("performCopy(")
    expect(source).not.toContain("copyText(")
  })
})
