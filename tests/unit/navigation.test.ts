import { describe, expect, test } from "bun:test"
import { Navigation } from "../../src/ui/navigation.ts"
import { applySort, cycleSort, sortMarker, UNSORTED } from "../../src/ui/sort.ts"

describe("navigation stack", () => {
  test("starts at the national overview", () => {
    expect(new Navigation().screen.kind).toBe("national")
  })

  test("push descends and pop returns", () => {
    const nav = new Navigation()
    nav.push({ kind: "district", nuts: "CZ0642" })
    nav.push({ kind: "council", kodzastup: "582786" })
    expect(nav.screen.kind).toBe("council")
    expect(nav.depth).toBe(3)

    expect(nav.pop()).toBe(true)
    expect(nav.screen.kind).toBe("district")
  })

  test("pop at the root is refused, so Esc can never empty the screen", () => {
    const nav = new Navigation()
    expect(nav.pop()).toBe(false)
    expect(nav.screen.kind).toBe("national")
    expect(nav.depth).toBe(1)
  })

  test("returning restores the selection the user left behind", () => {
    const nav = new Navigation()
    nav.push({ kind: "district", nuts: "CZ0642" })
    nav.move(5, 20)
    expect(nav.current.selected).toBe(5)

    nav.push({ kind: "council", kodzastup: "582786" })
    expect(nav.current.selected).toBe(0)

    nav.pop()
    expect(nav.current.selected).toBe(5)
  })

  test("a refresh does not move the user (User Story 2, scenario 5)", () => {
    // Redrawing reads the stack; only key presses change it. Reading repeatedly must
    // therefore leave position and depth untouched.
    const nav = new Navigation()
    nav.push({ kind: "district", nuts: "CZ0642" })
    nav.move(7, 30)

    for (let redraw = 0; redraw < 10; redraw++) {
      expect(nav.screen.kind).toBe("district")
      expect(nav.current.selected).toBe(7)
      expect(nav.depth).toBe(2)
    }
  })

  test("reset replaces the stack, as a search jump does", () => {
    const nav = new Navigation()
    nav.push({ kind: "district", nuts: "CZ0642" })
    nav.reset({ kind: "council", kodzastup: "551082" })
    expect(nav.depth).toBe(1)
    expect(nav.pop()).toBe(false)
  })
})

describe("selection movement", () => {
  test("is clamped at both ends", () => {
    const nav = new Navigation()
    nav.move(-5, 10)
    expect(nav.current.selected).toBe(0)
    nav.move(100, 10)
    expect(nav.current.selected).toBe(9)
  })

  test("an empty list keeps the selection at zero", () => {
    const nav = new Navigation()
    nav.move(3, 0)
    expect(nav.current.selected).toBe(0)
  })

  test("first and last jump to the ends", () => {
    const nav = new Navigation()
    nav.moveTo("last", 42)
    expect(nav.current.selected).toBe(41)
    nav.moveTo("first", 42)
    expect(nav.current.selected).toBe(0)
  })
})

describe("scrolling", () => {
  test("keeps the selected row visible when moving down and back up", () => {
    const nav = new Navigation()
    nav.move(25, 100)
    nav.ensureVisible(10)
    expect(nav.current.offset).toBe(16)
    expect(nav.current.selected - nav.current.offset).toBeLessThan(10)

    nav.move(-20, 100)
    nav.ensureVisible(10)
    expect(nav.current.offset).toBeLessThanOrEqual(nav.current.selected)
  })
})

describe("sorting (FR-037)", () => {
  const rows = [
    { name: "A", votes: 100 },
    { name: "B", votes: 300 },
    { name: "C", votes: 100 },
    { name: "D", votes: 200 },
  ]
  const key = (row: (typeof rows)[number], column: number) => (column === 0 ? row.name : row.votes)

  test("cycles descending, ascending, then back to the published order", () => {
    let state = UNSORTED
    state = cycleSort(state, 1)
    expect(state).toEqual({ column: 1, direction: "desc" })
    state = cycleSort(state, 1)
    expect(state).toEqual({ column: 1, direction: "asc" })
    state = cycleSort(state, 1)
    expect(state.column).toBeNull()
  })

  test("an unsorted state returns the rows exactly as published", () => {
    expect(applySort(rows, UNSORTED, key)).toBe(rows)
  })

  test("sorts descending and ascending by value", () => {
    expect(applySort(rows, { column: 1, direction: "desc" }, key).map((r) => r.votes)).toEqual([
      300, 200, 100, 100,
    ])
    expect(applySort(rows, { column: 1, direction: "asc" }, key).map((r) => r.votes)).toEqual([
      100, 100, 200, 300,
    ])
  })

  test("a tie keeps the source's own order, in both directions (FR-029)", () => {
    // A and C are tied on 100. Ordering them would claim a result the source did not
    // report, so A must always precede C.
    const desc = applySort(rows, { column: 1, direction: "desc" }, key)
    const asc = applySort(rows, { column: 1, direction: "asc" }, key)
    expect(desc.filter((r) => r.votes === 100).map((r) => r.name)).toEqual(["A", "C"])
    expect(asc.filter((r) => r.votes === 100).map((r) => r.name)).toEqual(["A", "C"])
  })

  test("sorts text using Czech collation", () => {
    const names = [{ n: "Žatec" }, { n: "Cheb" }, { n: "Říčany" }]
    const sorted = applySort(names, { column: 0, direction: "asc" }, (r) => r.n)
    expect(sorted.map((r) => r.n)).toEqual(["Cheb", "Říčany", "Žatec"])
  })

  test("absent values sort last in both directions, never first", () => {
    const withNulls = [{ v: 5 }, { v: null }, { v: 1 }]
    const k = (r: (typeof withNulls)[number]) => r.v
    expect(applySort(withNulls, { column: 0, direction: "asc" }, k).map((r) => r.v)).toEqual([1, 5, null])
    expect(applySort(withNulls, { column: 0, direction: "desc" }, k).map((r) => r.v)).toEqual([5, 1, null])
  })

  test("the sorted column is marked without relying on colour (FR-040)", () => {
    expect(sortMarker({ column: 1, direction: "asc" }, 1).trim()).not.toBe("")
    expect(sortMarker({ column: 1, direction: "asc" }, 1)).not.toBe(
      sortMarker({ column: 1, direction: "desc" }, 1),
    )
    expect(sortMarker({ column: 1, direction: "asc" }, 0)).toBe("")
  })
})
