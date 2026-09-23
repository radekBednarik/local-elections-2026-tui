/**
 * Keys to intents (T131, T137, T151; FR-078).
 *
 * The property worth asserting is reachability: every action in the registry must have a
 * key, because the palette shows each action's shortcut and a blank one would be a lie.
 * It is also what FR-078 requires - the application fully usable with no mouse.
 */

import { describe, expect, test } from "bun:test"
import { intentFor } from "../../src/ui/keymap.ts"
import { ACTIONS, type ActionId, type RegistryActionId } from "../../src/ui/palette/actions.ts"
import type { KeyEvent } from "../../src/ui/search-input.ts"

function press(name: string, modifiers: Partial<KeyEvent> = {}): KeyEvent {
  return { name, ...modifiers } as KeyEvent
}

const actionOf = (key: KeyEvent): ActionId | null => {
  const intent = intentFor(key)
  return intent?.kind === "action" ? intent.id : null
}

describe("every action has a key (FR-078)", () => {
  // Keys the registry advertises, pressed as the user would press them.
  // The per-theme palette entries (002 FR-005) have no key of their own: Ctrl+T cycles.
  const PRESSES: Record<RegistryActionId, KeyEvent> = {
    move: press("down"),
    open: press("return"),
    back: press("escape"),
    search: press("/"),
    watch: press("w"),
    watchlist: press("w", { shift: true }),
    "export-csv": press("e"),
    "export-report": press("e", { shift: true }),
    "council-type": press("t"),
    sort: press("s"),
    refresh: press("r"),
    palette: press("p", { ctrl: true }),
    "side-panel": press("b", { ctrl: true }),
    theme: press("t", { ctrl: true }),
    help: press("?"),
    quit: press("q"),
  }

  for (const action of ACTIONS) {
    test(`${action.id} is reachable`, () => {
      const key = PRESSES[action.id as RegistryActionId]
      expect(key).toBeDefined()
      const intent = intentFor(key)
      expect(intent).not.toBeNull()
      if (action.id === "move") {
        expect(intent?.kind).toBe("move")
      } else {
        expect(actionOf(key)).toBe(action.id)
      }
    })
  }

  test("the table above covers the registry exactly, so a new action cannot be missed", () => {
    expect(Object.keys(PRESSES).sort()).toEqual(ACTIONS.map((a) => a.id).sort())
  })
})

describe("shift distinguishes the pairs", () => {
  test("w toggles watching, W opens the list", () => {
    expect(actionOf(press("w"))).toBe("watch")
    expect(actionOf(press("w", { shift: true }))).toBe("watchlist")
    // The key name arrives lower-cased, so the sequence is the other way of telling.
    expect(actionOf(press("w", { sequence: "W" }))).toBe("watchlist")
  })

  test("e exports the table, E writes the summary", () => {
    expect(actionOf(press("e"))).toBe("export-csv")
    expect(actionOf(press("e", { sequence: "E" }))).toBe("export-report")
  })
})

describe("control keys", () => {
  test("Ctrl+C quits whatever has focus", () => {
    expect(intentFor(press("c", { ctrl: true }))?.kind).toBe("force-quit")
  })

  test("Ctrl+T is the theme, plain t is the council type", () => {
    expect(actionOf(press("t", { ctrl: true }))).toBe("theme")
    expect(actionOf(press("t"))).toBe("council-type")
  })

  test("an unassigned control key does nothing rather than something surprising", () => {
    expect(intentFor(press("z", { ctrl: true }))).toBeNull()
  })
})

describe("movement", () => {
  test("arrows move one row, page keys ten", () => {
    expect(intentFor(press("up"))).toEqual({ kind: "move", delta: -1 })
    expect(intentFor(press("pagedown"))).toEqual({ kind: "move", delta: 10 })
  })

  test("home and end jump", () => {
    expect(intentFor(press("home"))).toEqual({ kind: "jump", to: "first" })
    expect(intentFor(press("end"))).toEqual({ kind: "jump", to: "last" })
  })
})

describe("unknown keys", () => {
  test("are ignored rather than guessed at", () => {
    expect(intentFor(press("f7"))).toBeNull()
    expect(intentFor(press(""))).toBeNull()
  })
})
