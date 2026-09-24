/**
 * Help completeness (T095) and the Czech-only rule (T096, FR-004a).
 *
 * The language audit renders every screen and scans for English words that would mean
 * an interface string slipped through untranslated.
 */

import type { Database } from "bun:sqlite"
import { beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { USAGE } from "../../src/config/args.ts"
import { extractArchiveFile } from "../../src/reference/archive.ts"
import { loadReference, type ReferenceArchives } from "../../src/reference/loader.ts"
import { ingestDistrict, ingestNational } from "../../src/sources/ingest.ts"
import { openMemoryDatabase } from "../../src/storage/db.ts"
import { tooSmallMessage } from "../../src/ui/components/status.ts"
import type { Screen } from "../../src/ui/navigation.ts"
import { ACTIONS } from "../../src/ui/palette/actions.ts"
import { composeScreen } from "../../src/ui/screen.ts"
import { documentedKeys, helpRows, renderHelp } from "../../src/ui/views/help.ts"

const FIXTURES = join(import.meta.dir, "../../fixtures/2026")
const read = (name: string) => readFileSync(join(FIXTURES, name), "utf8")

let archives: ReferenceArchives
beforeAll(async () => {
  const reg = await extractArchiveFile(join(FIXTURES, "reg.zip"))
  const cis = await extractArchiveFile(join(FIXTURES, "ciselniky.zip"))
  if (!reg.ok || !cis.ok) throw new Error("fixture archives could not be extracted")
  archives = { registry: reg.files, codelists: cis.files }
})

let db: Database
const opts = { width: 110, councilType: "OBEC" }

beforeEach(() => {
  db = openMemoryDatabase()
  loadReference(db, archives)
  ingestNational(db, read("vysledky.xml"))
  ingestDistrict(db, "CZ0642", read("vysledky_obce_okres_CZ0642.xml"))
})

const SCREENS: [string, Screen][] = [
  ["national", { kind: "national" }],
  ["districts", { kind: "districts" }],
  ["district", { kind: "district", nuts: "CZ0642" }],
  ["council", { kind: "council", kodzastup: "551082" }],
  ["candidates", { kind: "candidates", kodzastup: "551082", vstrana: "768", ballotOrder: null }],
  ["watchlist", { kind: "watchlist" }],
  ["search", { kind: "search" }],
  ["help", { kind: "help" }],
  ["logs", { kind: "logs" }],
  ["log-entry", { kind: "log-entry", seq: 0 }],
]

describe("help completeness (FR-005)", () => {
  test("documents every key the application responds to", () => {
    const body = renderHelp().join("\n")
    for (const keys of documentedKeys()) expect(body).toContain(keys)
  })

  test("covers the keys a user would be stuck without", () => {
    const body = renderHelp().join("\n")
    for (const essential of ["Enter", "Esc", "/", "q", "Ctrl+C", "?"]) {
      expect(body).toContain(essential)
    }
  })

  test("lists the key for the logs view (004 FR-007)", () => {
    const body = renderHelp().join("\n")
    expect(body).toMatch(/\bl\s+Zobrazit záznamy/)
  })

  test("explains the polling limit and the polling-district boundary", () => {
    const body = renderHelp().join("\n")
    expect(body).toContain("60 sekund")
    expect(body).toContain("okrscích")
    // And that nothing is estimated (FR-029).
    expect(body).toContain("nedopočítává")
  })

  test("fits a narrow terminal", () => {
    for (const line of renderHelp(80)) expect([...line].length).toBeLessThanOrEqual(80)
  })
})

describe("every screen composes (exhaustiveness)", () => {
  test.each(SCREENS)("%s renders something", (_label, screen) => {
    const content = composeScreen(db, screen, opts)
    expect(content.lines.length).toBeGreaterThan(0)
    expect(content.lines.join("\n")).not.toContain("Neznámá obrazovka")
  })
})

describe("Czech only (FR-004a)", () => {
  /**
   * Words that would only appear if an interface string went untranslated. Deliberately
   * narrow: a broad English wordlist would trip over Czech party names, which routinely
   * contain English ("Brno Plus", "ANO"), and over NUTS codes.
   */
  const ENGLISH = [
    "Loading",
    "Error",
    "Failed",
    "Not found",
    "Results",
    "Turnout",
    "Party",
    "Votes",
    "Seats",
    "Search",
    "Settings",
    "Press",
    "Unknown",
    "Warning",
    "Total",
  ]

  test.each(SCREENS)("%s contains no untranslated interface text", (_label, screen) => {
    const body = composeScreen(db, screen, opts).lines.join("\n")
    for (const word of ENGLISH) {
      expect(body).not.toContain(word)
    }
  })

  test("the terminal-size message is Czech", () => {
    const body = tooSmallMessage(40, 10).join("\n")
    expect(body).toContain("Okno terminálu")
    for (const word of ENGLISH) expect(body).not.toContain(word)
  })

  test("command-line usage is Czech", () => {
    expect(USAGE).toContain("Použití")
    // Matched on the stem, because Czech declines the noun: the usage text says
    // "Vypsat tuto nápovědu", not the nominative "nápověda".
    expect(USAGE).toContain("nápověd")
    expect(USAGE).not.toContain("Usage")
    expect(USAGE).not.toContain("Options")
  })

  test("every screen uses Czech diacritics somewhere, so none is accidentally plain", () => {
    for (const [label, screen] of SCREENS) {
      const body = composeScreen(db, screen, opts).lines.join("\n")
      expect(`${label}: ${/[ěščřžýáíéúůďťňó]/i.test(body)}`).toBe(`${label}: true`)
    }
  })
})

describe("the help and the action registry cannot drift apart (T163)", () => {
  // They did. The help kept its own list, so it said "Enter" where the status bar said
  // "⏎", and an action added to the registry would never have appeared here at all. The
  // help is now generated from the registry, and these assertions say so.
  test("every action the application has is documented", () => {
    const documented = documentedKeys()
    for (const action of ACTIONS) {
      expect(documented).toContain(action.key)
    }
  })

  test("every documented key is either an action or a named exception", () => {
    // The exceptions move within a screen or answer unconditionally; they are not
    // things the application does, so they are not registry entries.
    const EXCEPTIONS = ["PgUp PgDn", "Home End", "Ctrl+C"]
    const fromRegistry = new Set(ACTIONS.map((a) => a.key))
    for (const key of documentedKeys()) {
      expect(fromRegistry.has(key) || EXCEPTIONS.includes(key)).toBe(true)
    }
  })

  test("the new keys of the redesign are all there", () => {
    const body = renderHelp(110).join("\n")
    for (const key of ["Ctrl+P", "Ctrl+B", "Ctrl+T"]) {
      expect(body).toContain(key)
    }
  })

  test("each documented key carries a Czech action and a place it works", () => {
    for (const row of helpRows()) {
      expect(row.action.length).toBeGreaterThan(3)
      expect(row.where.length).toBeGreaterThan(2)
    }
  })

  test("the help still says the mouse is optional (FR-078)", () => {
    expect(renderHelp(110).join("\n")).toContain("Myš je nepovinná")
  })
})
