/**
 * Copying from the logs view (004 FR-016 to FR-019, research R7).
 *
 * The copied text is always the log-file line, byte for byte, so what the user pastes
 * into a report is what the file holds. `performCopy` is the whole behaviour behind the
 * `c` and `C` keys; `App` only hands it the real clipboard.
 */

import { describe, expect, test } from "bun:test"
import type { LogEntry } from "../../src/logging/logger.ts"
import { copyNotice, copyText, performCopy } from "../../src/ui/views/logs.ts"

const entries: LogEntry[] = [0, 1, 2].map((seq) => ({
  seq,
  at: `2026-10-09T19:0${seq}:10.000Z`,
  level: "warn",
  message: `zprava ${seq}`,
  detail: seq === 1 ? '{"source":"national"}' : null,
  source: seq === 1 ? "national" : null,
  line: `2026-10-09T19:0${seq}:10.000Z WARN  zprava ${seq}${seq === 1 ? ' | {"source":"national"}' : ""}`,
}))

describe("the text to copy", () => {
  test("one entry is its log-file line", () => {
    expect(copyText(entries, "one", 1)).toBe(entries[1]?.line ?? "?")
  })

  test("all entries are their lines, oldest first, one per line", () => {
    expect(copyText(entries, "all", null)).toBe(entries.map((e) => e.line).join("\n"))
  })

  test("nothing to copy gives null", () => {
    expect(copyText([], "all", null)).toBeNull()
    expect(copyText([], "one", 0)).toBeNull()
    expect(copyText(entries, "one", 9)).toBeNull()
    expect(copyText(entries, "one", null)).toBeNull()
  })
})

describe("the notice", () => {
  test("counts in Czech", () => {
    expect(copyNotice(1, true)).toBe("Odesláno do schránky: 1 záznam.")
    expect(copyNotice(3, true)).toBe("Odesláno do schránky: 3 záznamy.")
    expect(copyNotice(12, true)).toBe("Odesláno do schránky: 12 záznamů.")
  })

  test("says when there is nothing to copy", () => {
    expect(copyNotice(0, true)).toBe("Není co kopírovat.")
    expect(copyNotice(0, false)).toBe("Není co kopírovat.")
  })

  test("says when the terminal refused, never claiming a copy it cannot verify", () => {
    expect(copyNotice(3, false)).toBe("Terminál nepodporuje kopírování do schránky.")
  })
})

describe("performing a copy (FR-016–FR-019)", () => {
  function recorder(result: boolean | "throw" = true) {
    const sent: string[] = []
    const copy = (text: string) => {
      sent.push(text)
      if (result === "throw") throw new Error("clipboard exploded")
      return result
    }
    return { sent, copy }
  }

  test("c on the list copies the selected entry", () => {
    const { sent, copy } = recorder()
    expect(performCopy("one", { kind: "logs" }, 2, entries, copy)).toBe("Odesláno do schránky: 1 záznam.")
    expect(sent).toEqual([entries[2]?.line ?? "?"])
  })

  test("c on the detail copies that entry, whatever the selection says", () => {
    const { sent, copy } = recorder()
    performCopy("one", { kind: "log-entry", seq: 1 }, 0, entries, copy)
    expect(sent).toEqual([entries[1]?.line ?? "?"])
  })

  test("C copies every entry", () => {
    const { sent, copy } = recorder()
    expect(performCopy("all", { kind: "logs" }, 0, entries, copy)).toBe("Odesláno do schránky: 3 záznamy.")
    expect(sent).toEqual([entries.map((e) => e.line).join("\n")])
  })

  test("with nothing to copy the clipboard is not touched", () => {
    const { sent, copy } = recorder()
    expect(performCopy("all", { kind: "logs" }, 0, [], copy)).toBe("Není co kopírovat.")
    expect(performCopy("one", { kind: "log-entry", seq: 42 }, 0, entries, copy)).toBe("Není co kopírovat.")
    expect(sent).toEqual([])
  })

  test("a refusing terminal is reported", () => {
    const { copy } = recorder(false)
    expect(performCopy("one", { kind: "logs" }, 0, entries, copy)).toBe(
      "Terminál nepodporuje kopírování do schránky.",
    )
  })

  test("a clipboard that throws is contained and reported as a refusal", () => {
    const { copy } = recorder("throw")
    expect(() => performCopy("all", { kind: "logs" }, 0, entries, copy)).not.toThrow()
    expect(performCopy("all", { kind: "logs" }, 0, entries, copy)).toBe(
      "Terminál nepodporuje kopírování do schránky.",
    )
  })
})
