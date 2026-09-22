/**
 * The action registry (task T127, FR-064, FR-066, FR-069).
 *
 * Every action the application performs is declared here once, with its label, its key
 * and a predicate saying whether it applies where the user is standing.
 *
 * This is the SINGLE SOURCE OF TRUTH, shared by the status bar and the command palette.
 * The two showed different things when each kept its own list, and a status bar that
 * offers a key which does nothing is worse than one that offers nothing at all. Adding
 * an action here makes it appear in both; there is no second place to forget.
 *
 * `unavailable` returns the REASON rather than a boolean, because the palette shows
 * inapplicable actions with their reason rather than hiding them (FR-069). Hiding them
 * would teach the user the application is smaller than it is.
 */

import type { Screen } from "../navigation.ts"

/** What the registry needs to know about the moment, to judge each action. */
export interface ActionContext {
  screen: Screen
  /** Depth of the navigation stack, so "back" knows whether there is anywhere to go. */
  depth: number
  /** Selectable rows on this screen. */
  rowCount: number
  /** How many council types the data offers; switching needs at least two. */
  councilTypes: number
  /** True while the search box has focus and swallows letter keys. */
  searchActive: boolean
}

export type ActionId =
  | "move"
  | "open"
  | "back"
  | "search"
  | "watch"
  | "watchlist"
  | "export-csv"
  | "export-report"
  | "council-type"
  | "refresh"
  | "palette"
  | "side-panel"
  | "theme"
  | "help"
  | "quit"

export interface Action {
  id: ActionId
  /** Full Czech label, for the palette. */
  label: string
  /** Short label, for the status bar where every column counts. */
  hint: string
  /** The key as the user must press it. */
  key: string
  /** Why this action does nothing here, or null when it applies (FR-069). */
  unavailable: (context: ActionContext) => string | null
}

const TABLE_SCREENS: Screen["kind"][] = ["national", "district", "council", "candidates"]
const REPORT_SCREENS: Screen["kind"][] = ["district", "council", "candidates"]

/** Always applicable. */
const always = () => null

/**
 * Ordered by how much a user needs them, because the status bar renders as many as fit
 * and drops from the end.
 */
export const ACTIONS: Action[] = [
  {
    id: "move",
    label: "Posunout výběr",
    hint: "výběr",
    key: "↑↓",
    unavailable: (c) => (c.rowCount > 0 ? null : "na této obrazovce není seznam"),
  },
  {
    id: "open",
    label: "Otevřít vybranou položku",
    hint: "otevřít",
    key: "⏎",
    unavailable: (c) => (c.rowCount > 0 || c.screen.kind === "national" ? null : "není co otevřít"),
  },
  {
    id: "back",
    label: "Zpět o úroveň výš",
    hint: "zpět",
    key: "esc",
    unavailable: (c) => (c.depth > 1 ? null : "jste na úvodní obrazovce"),
  },
  // Placed high deliberately. The status bar drops hints from the end when the terminal
  // is narrow, and the palette is how everything that got dropped is still reachable, so
  // it is the last hint that should ever go (FR-065).
  { id: "palette", label: "Otevřít paletu příkazů", hint: "příkazy", key: "Ctrl+P", unavailable: always },
  {
    id: "search",
    label: "Hledat obec, stranu nebo kandidáta",
    hint: "hledat",
    key: "/",
    unavailable: always,
  },
  {
    id: "watch",
    label: "Přidat nebo odebrat ze sledovaných",
    hint: "sledovat",
    key: "w",
    unavailable: (c) => (c.screen.kind === "council" ? null : "sledovat lze jen otevřené zastupitelstvo"),
  },
  {
    id: "watchlist",
    label: "Zobrazit sledovaná zastupitelstva",
    hint: "sledovaná",
    key: "W",
    unavailable: always,
  },
  {
    id: "export-csv",
    label: "Exportovat zobrazenou tabulku do CSV",
    hint: "export",
    key: "e",
    unavailable: (c) => (TABLE_SCREENS.includes(c.screen.kind) ? null : "tato obrazovka nemá tabulku"),
  },
  {
    id: "export-report",
    label: "Uložit souhrnnou zprávu",
    hint: "souhrn",
    key: "E",
    unavailable: (c) =>
      REPORT_SCREENS.includes(c.screen.kind) ? null : "souhrn existuje jen pro okres a zastupitelstvo",
  },
  {
    id: "council-type",
    label: "Přepnout typ zastupitelstva",
    hint: "typ",
    key: "t",
    unavailable: (c) => {
      if (c.screen.kind !== "national") return "typ se přepíná v přehledu ČR"
      return c.councilTypes > 1 ? null : "data obsahují jen jeden typ zastupitelstva"
    },
  },
  { id: "refresh", label: "Vyžádat okamžité obnovení", hint: "obnovit", key: "r", unavailable: always },
  {
    id: "side-panel",
    label: "Zobrazit nebo skrýt postranní panel",
    hint: "panel",
    key: "Ctrl+B",
    unavailable: always,
  },
  { id: "theme", label: "Přepnout motiv", hint: "motiv", key: "Ctrl+T", unavailable: always },
  {
    id: "help",
    label: "Nápověda",
    hint: "nápověda",
    key: "?",
    unavailable: (c) => (c.screen.kind === "help" ? "nápověda je právě otevřená" : null),
  },
  {
    id: "quit",
    label: "Ukončit aplikaci",
    hint: "konec",
    key: "q",
    unavailable: (c) => (c.searchActive ? "během hledání píše „q“ do dotazu" : null),
  },
]

/** Only the actions that do something here (FR-064). */
export function availableActions(context: ActionContext): Action[] {
  return ACTIONS.filter((action) => action.unavailable(context) === null)
}

/** Looks one action up by id, for the key handler. */
export function actionById(id: ActionId): Action | undefined {
  return ACTIONS.find((action) => action.id === id)
}
