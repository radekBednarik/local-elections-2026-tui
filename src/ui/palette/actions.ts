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
import { THEME_NAMES, type ThemeName, themeLabel } from "../theme/themes.ts"

/** What the registry needs to know about the moment, to judge each action. */
export interface ActionContext {
  screen: Screen
  /** The theme in use, so the palette can mark its own entry as already chosen. */
  activeTheme?: ThemeName
  /** Depth of the navigation stack, so "back" knows whether there is anywhere to go. */
  depth: number
  /** Selectable rows on this screen. */
  rowCount: number
  /** How many council types the data offers; switching needs at least two. */
  councilTypes: number
  /** True while the search box has focus and swallows letter keys. */
  searchActive: boolean
  /** Columns this screen offers to sort by; zero when it has no table (FR-037). */
  sortableColumns: number
}

export type ActionId =
  | "move"
  | "open"
  | "back"
  | "copy-entry"
  | "copy-all"
  | "search"
  | "logs"
  | "watch"
  | "watchlist"
  | "export-csv"
  | "export-report"
  | "council-type"
  | "sort"
  | "refresh"
  | "palette"
  | "side-panel"
  | "theme"
  | "help"
  | "quit"
  | `theme:${ThemeName}`

/** The actions in the registry proper, each with a key of its own (FR-078). */
export type RegistryActionId = Exclude<ActionId, `theme:${string}`>

export interface Action {
  id: ActionId
  /** Full Czech label, for the palette. */
  label: string
  /** Short label, for the status bar where every column counts. */
  hint: string
  /**
   * The key as the user must press it, written out: "Enter", "Shift+W", "Ctrl+P".
   *
   * This is the form the help screen and the command palette show, because both are
   * teaching the key and a glyph teaches nothing to someone who does not already know
   * it.
   */
  key: string
  /**
   * A compact form for the status bar, where columns are scarce.
   *
   * Absent when the written form is already short enough.
   */
  shortKey?: string
  /** Where the key applies, in Czech, for the help screen. */
  where: string
  /** Why this action does nothing here, or null when it applies (FR-069). */
  unavailable: (context: ActionContext) => string | null
}

const TABLE_SCREENS: Screen["kind"][] = ["national", "district", "council", "candidates"]
const REPORT_SCREENS: Screen["kind"][] = ["district", "council", "candidates"]
const LOGS_SCREENS: Screen["kind"][] = ["logs", "log-entry"]

/** What the user is told when an action is asked for where it does not apply. */
export const NOT_AVAILABLE_HERE = "Tento příkaz zde není dostupný."

/** Always applicable. */
const always = () => null

/** Applicable only while the logs are open. */
const onLogs = (c: ActionContext) =>
  LOGS_SCREENS.includes(c.screen.kind) ? null : "kopírovat lze jen v záznamech"

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
    where: "seznamy",
    unavailable: (c) => (c.rowCount > 0 ? null : "na této obrazovce není seznam"),
  },
  {
    id: "open",
    label: "Otevřít vybranou položku",
    hint: "otevřít",
    key: "Enter",
    shortKey: "⏎",
    where: "seznamy",
    unavailable: (c) => (c.rowCount > 0 || c.screen.kind === "national" ? null : "není co otevřít"),
  },
  {
    id: "back",
    label: "Zpět o úroveň výš",
    hint: "zpět",
    key: "Esc",
    where: "všude",
    unavailable: (c) => (c.depth > 1 ? null : "jste na úvodní obrazovce"),
  },
  // Right after "back" deliberately. They apply only on the logs screens, so everywhere
  // else they are unavailable and cost the status bar nothing; there, a narrow bar keeps
  // them rather than dropping them for global keys the palette also offers (004 R8).
  {
    id: "copy-entry",
    label: "Kopírovat vybraný záznam",
    hint: "kopírovat",
    key: "c",
    where: "záznamy",
    unavailable: onLogs,
  },
  {
    id: "copy-all",
    label: "Kopírovat všechny záznamy",
    hint: "vše",
    key: "Shift+C",
    shortKey: "C",
    where: "záznamy",
    unavailable: onLogs,
  },
  // Placed high deliberately. The status bar drops hints from the end when the terminal
  // is narrow, and the palette is how everything that got dropped is still reachable, so
  // it is the last hint that should ever go (FR-065).
  {
    id: "palette",
    label: "Otevřít paletu příkazů",
    hint: "příkazy",
    key: "Ctrl+P",
    where: "všude",
    unavailable: always,
  },
  {
    id: "search",
    label: "Hledat obec, stranu nebo kandidáta",
    hint: "hledat",
    key: "/",
    where: "všude",
    unavailable: always,
  },
  {
    id: "logs",
    label: "Zobrazit záznamy",
    hint: "záznamy",
    key: "l",
    where: "všude",
    unavailable: (c) => (LOGS_SCREENS.includes(c.screen.kind) ? "záznamy jsou právě otevřené" : null),
  },
  {
    id: "watch",
    label: "Přidat nebo odebrat ze sledovaných",
    hint: "sledovat",
    key: "w",
    where: "zastupitelstvo",
    unavailable: (c) => (c.screen.kind === "council" ? null : "sledovat lze jen otevřené zastupitelstvo"),
  },
  {
    id: "watchlist",
    label: "Zobrazit sledovaná zastupitelstva",
    hint: "sledovaná",
    key: "Shift+W",
    shortKey: "W",
    where: "všude",
    unavailable: always,
  },
  {
    id: "export-csv",
    label: "Exportovat zobrazenou tabulku do CSV",
    hint: "export",
    key: "e",
    where: "tabulky",
    unavailable: (c) => (TABLE_SCREENS.includes(c.screen.kind) ? null : "tato obrazovka nemá tabulku"),
  },
  {
    id: "export-report",
    label: "Uložit souhrnnou zprávu",
    hint: "souhrn",
    key: "Shift+E",
    shortKey: "E",
    where: "okres, zastupitelstvo",
    unavailable: (c) =>
      REPORT_SCREENS.includes(c.screen.kind) ? null : "souhrn existuje jen pro okres a zastupitelstvo",
  },
  {
    id: "council-type",
    label: "Přepnout typ zastupitelstva",
    hint: "typ",
    key: "t",
    where: "přehled ČR",
    unavailable: (c) => {
      if (c.screen.kind !== "national") return "typ se přepíná v přehledu ČR"
      return c.councilTypes > 1 ? null : "data obsahují jen jeden typ zastupitelstva"
    },
  },
  {
    id: "sort",
    label: "Seřadit podle dalšího sloupce",
    hint: "řadit",
    key: "s",
    where: "tabulky",
    unavailable: (c) => (c.sortableColumns > 0 ? null : "tato obrazovka nemá řaditelnou tabulku"),
  },
  {
    id: "refresh",
    label: "Vyžádat okamžité obnovení",
    hint: "obnovit",
    key: "r",
    where: "všude",
    unavailable: always,
  },
  {
    id: "side-panel",
    label: "Zobrazit nebo skrýt postranní panel",
    hint: "panel",
    key: "Ctrl+B",
    where: "všude",
    unavailable: always,
  },
  { id: "theme", label: "Přepnout motiv", hint: "motiv", key: "Ctrl+T", where: "všude", unavailable: always },
  {
    id: "help",
    label: "Nápověda",
    hint: "nápověda",
    key: "?",
    where: "všude",
    unavailable: (c) => (c.screen.kind === "help" ? "nápověda je právě otevřená" : null),
  },
  {
    id: "quit",
    label: "Ukončit aplikaci",
    hint: "konec",
    key: "q",
    where: "mimo hledání",
    unavailable: (c) => (c.searchActive ? "během hledání píše „q“ do dotazu" : null),
  },
]

/**
 * One palette entry per theme, so a theme can be chosen by name (002 FR-005).
 *
 * Kept OUT of the registry above. The registry also drives the status bar and the help
 * screen, and six entries all reached by the same key would crowd both for nothing; the
 * palette is the one place a theme is looked up by name. The key shown is the one that
 * cycles to it, so the palette still teaches a key (FR-066). The theme in use is listed
 * but unavailable, with the reason, rather than hidden (FR-069).
 */
export const THEME_ACTIONS: Action[] = THEME_NAMES.map((name) => ({
  id: `theme:${name}` as const,
  label: `Motiv: ${themeLabel(name)}`,
  hint: "motiv",
  key: "Ctrl+T",
  where: "všude",
  unavailable: (c: ActionContext) => (c.activeTheme === name ? "tento motiv je aktivní" : null),
}))

/** The theme an action selects, when it is one of the theme entries. */
export function themeOfAction(id: ActionId): ThemeName | null {
  return id.startsWith("theme:") ? (id.slice("theme:".length) as ThemeName) : null
}

/** Only the actions that do something here (FR-064). */
export function availableActions(context: ActionContext): Action[] {
  return ACTIONS.filter((action) => action.unavailable(context) === null)
}

/** Looks one action up by id, for the key handler. */
export function actionById(id: ActionId): Action | undefined {
  return ACTIONS.find((action) => action.id === id)
}
