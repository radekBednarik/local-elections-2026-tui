import { describe, expect, test } from "bun:test"
import { applySearchKey } from "../../src/ui/search-input.ts"

/** Applies a sequence of keystrokes, returning the resulting query. */
function type(start: string, keys: Parameters<typeof applySearchKey>[1][]): string {
  let query = start
  for (const key of keys) {
    const result = applySearchKey(query, key)
    if (result.handled) query = result.query
  }
  return query
}

const char = (c: string) => ({ name: c, sequence: c })

describe("typing", () => {
  test("ordinary letters build the query", () => {
    expect(type("", [char("b"), char("r"), char("n"), char("o")])).toBe("brno")
  })

  test("a letter that is also a shortcut is typed, not acted on", () => {
    // "q" quits everywhere else. Inside the search box it must be a letter, or nobody
    // could search for Quido, and "r" would refresh instead of typing.
    for (const letter of ["q", "r", "t", "/"]) {
      const result = applySearchKey("", char(letter))
      expect(result.handled).toBe(true)
      if (result.handled) expect(result.query).toBe(letter)
    }
  })

  test("accented characters are accepted", () => {
    expect(type("", [char("Ř"), char("í"), char("č")])).toBe("Říč")
  })

  test("spaces and digits are accepted", () => {
    expect(type("", [char("A"), char("N"), char("O"), char(" "), char("2")])).toBe("ANO 2")
  })
})

describe("backspace", () => {
  test("removes the last character", () => {
    expect(type("brno", [{ name: "backspace" }])).toBe("brn")
  })

  test("removes a whole accented character, not half of one", () => {
    expect(type("Říč", [{ name: "backspace" }])).toBe("Ří")
  })

  test("on an empty query is harmless", () => {
    expect(type("", [{ name: "backspace" }])).toBe("")
  })
})

describe("escape", () => {
  test("clears a non-empty query and keeps the screen", () => {
    const result = applySearchKey("brno", { name: "escape" })
    expect(result.handled).toBe(true)
    if (result.handled) expect(result.query).toBe("")
  })

  test("is passed through once the query is empty, so the screen closes", () => {
    expect(applySearchKey("", { name: "escape" }).handled).toBe(false)
  })
})

describe("keys that belong to navigation", () => {
  test.each(["up", "down", "pageup", "pagedown", "home", "end", "return", "enter"])(
    "%s is not consumed, so results stay navigable",
    (name) => {
      expect(applySearchKey("brno", { name }).handled).toBe(false)
    },
  )

  test("a control combination is not consumed", () => {
    expect(applySearchKey("brno", { name: "c", ctrl: true, sequence: "\u0003" }).handled).toBe(false)
  })
})

describe("control sequences never reach the query", () => {
  test.each([
    ["an arrow escape sequence", { name: "up", sequence: "\u001b[A" }],
    ["a bare escape byte", { name: "unknown", sequence: "\u001b" }],
    ["a delete byte", { name: "unknown", sequence: "\u007f" }],
    ["an empty sequence", { name: "unknown", sequence: "" }],
  ])("%s", (_label, key) => {
    expect(applySearchKey("brno", key).handled).toBe(false)
  })

  test("no control character can be smuggled in", () => {
    const result = type("", [
      char("b"),
      { name: "unknown", sequence: "\u0007" },
      { name: "unknown", sequence: "\u001b[2J" },
      char("r"),
    ])
    expect(result).toBe("br")
  })
})
