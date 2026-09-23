---

description: "Task list for the TUI visual refresh"
---

# Tasks: TUI Visual Refresh

**Input**: Design documents from `specs/002-tui-visual-refresh/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/interface.md](contracts/interface.md), [quickstart.md](quickstart.md)

**Tests**: REQUIRED. The constitution makes TDD non-negotiable (Principle II), so every
implementation task is preceded by a test task. That test must be observed FAILING before the
implementation is written. Colour assertions read the colours actually written, through
`captureSpans()` from `createTestRenderer()`, as `tests/ui/colour.test.ts` already does. They never
read the theme table.

**Review**: every task ends with a review against Principles I and II and against
[contracts/interface.md](contracts/interface.md) (Principle III). The phase-ending REVIEW tasks make
this visible. A task is complete only when its review has no open findings.

**Design reference**: [mocks/index.html](mocks/index.html), layout C. Open it from disk in a browser.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: The user story the task belongs to (US1 to US4 in spec.md)

---

## Phase 1: Setup

**Purpose**: Establish a green baseline, so every later failure is known to be new.

- [X] T001 Run `bun test`, `bun run typecheck` and `bun run check` from the repository root. Record the pass counts in the task notes. (Baseline 2026-09-23: 686 pass, 0 fail across 48 files; typecheck clean; biome clean, 129 files.) Stop and report if anything fails before a change has been made.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Themes become slot tables, and the colour layer learns to emit backgrounds. Every story
needs both.

**⚠️ CRITICAL**: no user story work can begin until this phase is complete.

### Tests (write first, observe failing)

- [X] T002 [P] Write `tests/ui/theme-contrast.test.ts` (SC-003, FR-001a). Test every theme in `THEME_NAMES` with the WCAG 2 relative-luminance contrast ratio:
  - `text`, `primary`, `accent`, `success`, `error` and `warning` ≥ 4.5 on each of `bg`, `panel`, `element` and `zebra`.
  - `muted` and `subtle` ≥ 3.0 on the same four.
  - The theme's `selectionText` ≥ 4.5 on `sel`.
  - `onAccent` ≥ 4.5 on each of `accent`, `primary`, `warning` and `success`.
  - Add a structural test: every theme defines exactly the 18 slots of [data-model.md § Slot](data-model.md#slot), each as a `#rrggbb` string.
  - Add a test that in `high-contrast`, `success`, `error` and `muted` have three distinct luminances (001 FR-062).
  - Add a test that `panel` differs from `bg` in every theme (SC-002).
- [X] T003 [P] Rewrite `tests/unit/theme.test.ts` for the new model:
  - `THEME_NAMES` equals exactly `["tokyonight", "catppuccin-mocha", "gruvbox", "nord", "catppuccin-latte", "high-contrast"]`, in that order.
  - `nextTheme` cycles in that order and wraps from `high-contrast` to `tokyonight`.
  - `themeLabel` returns "Tokyo Night", "Catppuccin Mocha", "Gruvbox Dark", "Nord", "Catppuccin Latte" and "Vysoký kontrast".
  - Each role resolves to the slot and bold given in [data-model.md § Role → slot](data-model.md#role--slot-fr-003): heading→primary bold, selection→selectionText bold, warning→warning bold, increase→success, decrease→error, muted→muted, accent→accent bold, subtle→subtle.
  - `MONOCHROME` has every slot `null`, and `isMonochrome(MONOCHROME)` is true.
- [X] T004 [P] Add tests to `tests/unit/row.test.ts` and `tests/ui/colour.test.ts` for background output from `src/ui/theme/apply.ts`:
  - `styledRow(row, theme, width, lead, columns, rowBg)` gives every chunk, the gutter included, the background `rowBg`.
  - It appends one trailing chunk of spaces in `rowBg`, so the styled row is exactly `width + lead.length` cells wide. Read the width back with `captureSpans()`.
  - The plain-text form (`toText`) is unchanged and still trimmed (research R1).
  - A cell with `surface: "primary"` (also `"accent"`, `"success"` and `"warning"`) gets that slot as its background and `onAccent` as its foreground.
  - A cell with `surface: "element"` gets `element` as its background and keeps its role's foreground.
  - Under `MONOCHROME`, no chunk carries `fg` or `bg`.
- [X] T005 [P] Update the theme-name uses in `tests/ui/colour.test.ts`, `tests/ui/panel.test.ts`, `tests/ui/redraw.test.ts`, `tests/ui/right-edge.test.ts` and `tests/ui/stability.test.ts`. `themeByName("dark")` becomes `themeByName("tokyonight")`, `"light"` becomes `"catppuccin-latte"`, and `"high-contrast"` is kept. Any assertion that expected an indexed colour (`RGBA.fromIndex`) now expects the hex value from [data-model.md § Theme values](data-model.md#theme-values). Also update `tests/integration/preferences.test.ts`: the round-trip loop at line 23 iterates over `THEME_NAMES`, and `writeTheme(db, "light")` at line 84 becomes `writeTheme(db, "catppuccin-latte")`, so the suite stays green through T011.

### Implementation

- [X] T006 Rewrite `src/ui/theme/themes.ts`:
  - Define `SLOTS`: the 18 slot names of data-model.md, as a `const` tuple, with the `Slot` type.
  - Define `Theme { name; label; contrastByBrightness; slots: Record<Slot, string | null>; selectionText: Slot }`.
  - Add the six themes, transcribing the values EXACTLY from [data-model.md § Theme values](data-model.md#theme-values), the adjusted tones marked * included. `selectionText` is `"text"`, except `"bg"` for `high-contrast`.
  - `THEME_NAMES` in contract order. `themeByName`, `nextTheme` and `themeLabel` as tested in T003.
  - `MONOCHROME` with every slot `null`. It is not in `THEME_NAMES`.
  - Delete the `ColorSpec` `indexed` kind and every use of it (research R10).
  - Makes T002 and T003 pass.
- [X] T007 Update `src/ui/theme/roles.ts` and the `Role` type in `src/ui/row.ts`: add the two roles `accent` and `subtle` with the meanings in data-model.md § Role → slot, and add `ROLE_SLOT: Record<Role, { slot: Slot | "selectionText"; bold: boolean }>` as that table gives it. The six existing roles keep their meanings.
- [X] T008 Update `src/ui/theme/apply.ts`:
  - `colorFor(theme, role)` resolves through `ROLE_SLOT`.
  - Add `slotColor(theme, slot)`, which returns `RGBA | undefined`, undefined when the slot is `null`.
  - `toTextChunk` emits `bg` as well as `fg`.
  - `styledRow` gains a `rowBg?: Slot` parameter: the gutter and every surface-less chunk take it, and one trailing space chunk pads to the full width (research R1).
  - Cells with a `surface` use that slot as the background, with `onAccent` foreground unless the surface is `element`.
  - `styledBlock` pads each line the same way.
  - Remains the ONLY module that produces a colour value.
  - Makes T004 pass.
- [X] T009 Update `src/ui/row.ts`: add to `Cell` the optional `surface?: "element" | "primary" | "accent" | "success" | "warning"` and `bar?: boolean`, and `fgSlot?: Slot` (data-model.md § Cell: "Used only for the `▌` joins"), and carry all three into `StyledChunk`. Nothing changes in `toText` or `toTextLines`.
- [X] T010 Update `src/ui/theme/detect.ts`: `resolveTheme` returns `themeByName("tokyonight")` when nothing is stored, or `themeByName("catppuccin-latte")` when the terminal reports `"light"` (FR-004). `isMonochrome` checks that every slot is `null`.
- [X] T011 Update `src/storage/queries/preferences.ts` and `src/ui/app.ts` so they compile against the new `ThemeName`. The legacy mapping is US3, so for now an unrecognised stored value is still treated as absent. Run the whole suite: T002 to T005 must pass and nothing else may regress.
- [X] T012 REVIEW Phase 2 against Principles I and II:
  - No module but `apply.ts` builds an `RGBA`.
  - The theme values match data-model.md cell for cell.
  - `indexed` is fully gone.
  - `bun test`, `bun run typecheck` and `bun run check` are green.

**Checkpoint**: the application runs in Tokyo Night with today's layout. Colours come from slots, and
backgrounds can be emitted.

---

## Phase 3: User Story 1 – Read a long table without losing the row (Priority: P1) 🎯 MVP

**Goal**: every table has a tinted header, alternating row backgrounds and a full-width selection
row (FR-015 to FR-017, FR-019).

**Independent Test**: open the national overview, the district list, a district, a council, a
candidate list, the watchlist and the search results in Tokyo Night. On each, adjacent data rows have
different backgrounds, the header is `element` and the selected row is `sel` (SC-001).

### Tests (write first, observe failing)

- [X] T013 [P] [US1] Add to `tests/unit/row.test.ts`: `tableHeader(columns, sort?)` in `src/ui/row.ts` returns two rows.
  - The first has `kind: "header"`, one cell per column with role `heading`, and the column the table is sorted by with role `"accent"`, keeping the ▲ or ▼ that `markSorted` adds.
  - The second has `kind: "rule"`, with `─` cells and no role (T021 draws a rule row in the `border` slot). Its plain text is identical to today's `headerRow` underline.
  - The plain text of the header row equals today's `headerRow(columns)[0]`, byte for byte.
- [X] T014 [P] [US1] Add to `tests/ui/colour.test.ts`, on the district list (77 rows) in Tokyo Night:
  - Every data row at an even position has background `#1a1b26` (bg), and every odd one `#1e2030` (zebra).
  - The header row is `#24283b` (element) across its full width, the gutter and the right padding included.
  - The rule row is `bg`.
  - The selected row is `#2e3c64` (sel) whether its position is odd or even, and its text is `#c0caf5` (text), bold, with `▶` in the gutter.
  - When the selection moves down one row, the row it left returns to its stripe.
- [X] T015 [P] [US1] Add to `tests/ui/colour.test.ts`: after `s` sorts the council table, the first data row is still on `bg` and the stripes still alternate (acceptance 1.3).
- [X] T016 [P] [US1] Add to `tests/ui/colour.test.ts` on the national overview: a party row with `votesChange` "increased" draws its votes cell in `#9ece6a` (success) with `▲`, and a decreased one in `#f7768e` (error) with `▼`. On the selected row, the `▲` or `▼` is still present (FR-019, edge case "Changed figure on the selected row").
- [X] T017 [P] [US1] Add to `tests/ui/colour.test.ts`: under `MONOCHROME`, the district list emits no `bg` on any cell, and the selected row is identifiable by `▶` alone (acceptance 1.4, FR-008).
- [X] T017a [US1] Add to `tests/ui/colour.test.ts` one test per table screen, in a loop over national, districts, district CZ0642, council 551082, candidates, watchlist (two councils added), search (query "brno") and help, all in Tokyo Night:
  - The header row's cells are `element` across the full width.
  - Data rows alternate `bg` and `zebra` starting at `bg`.
  - Under `MONOCHROME`, no cell on the screen has an `fg` or a `bg`.
  - Observe it failing for every screen before T019 and T020 (SC-001, SC-005).

### Implementation

- [X] T018 [US1] Add `tableHeader(columns: Column[], sort?: SortState): SemanticRow[]` to `src/ui/row.ts`, built on `headerRow` and `markSorted`, so its plain text is unchanged. Also add `kind?: "header" | "rule" | "data"` to `SemanticRow` ("Absent means text. Only `data` rows are striped", data-model.md). Makes T013 pass.
- [X] T019 [P] [US1] Replace the `const [header, underline] = headerRow(...)` pairs with `rows.push(...tableHeader(columns, sort))` in `src/ui/views/areas.ts` (4 sites: district list, district, council, candidates), and add `kind: "data"` to each data row object pushed after them.
- [X] T020 [P] [US1] Do the same in `src/ui/views/national-rows.ts`, `src/ui/views/search.ts`, `src/ui/views/watchlist.ts` and `src/ui/views/help.ts` (one site each). Leave `headerRow` in `src/ui/format.ts`, because `tableHeader` and the exporters use it.
- [X] T021 [US1] In `src/ui/chrome/state.ts`, add `rowBackground(rows, index, selectedLine): Slot`, implementing data-model.md § Row background in order: selected → `sel`, `kind: "header"` → `element`, `kind: "data"` at an odd position counting from 0 after the most recent header → `zebra`, otherwise `bg`.
  - Pass the result as `rowBg` to `styledRow` in `frameState.styleRow`. A `kind: "rule"` row is drawn in the `border` slot.
  - `markSelected` resolves every chunk on the selected row to the theme's `selectionText`. The exception is a chunk with role `increase` or `decrease`: it keeps its colour when that colour reaches 4.5:1 on `sel`, otherwise it takes `selectionText` (research R2).
  - Makes T014 to T017 pass.
- [X] T022 [US1] In `applyFrameState` in `src/ui/chrome/state.ts`, make each row's key passed to `Frame.setRows` its plain text plus its background slot name. A row whose background changes while its text does not is then redrawn, and a selection move still rewrites exactly two rows (commit 8b518ff). Write the test first: extend `tests/ui/redraw.test.ts` to assert that a selection move rewrites exactly two rows under Tokyo Night.
- [X] T023 [US1] REVIEW Phase 3:
  - No view decides a stripe.
  - Plain-text output of every screen is unchanged: the text assertions in `tests/integration/screen.test.ts` and `tests/ui/*.test.ts` pass untouched.
  - Walk quickstart §2 step 3 against the mock (layout C, Tokyo Night, "Seznam okresů"). (Automated checks done; the side-by-side visual walk is left for the user in a real terminal.)

**Checkpoint**: MVP. Every table is striped in every theme, and nothing else has changed.

---

## Phase 4: User Story 2 – Tell the screen's regions apart at a glance (Priority: P1)

**Goal**: each region on its own surface, with the rails, the segmented breadcrumb, the live
indicator, the screen label, the key chips, the warning row and the palette overlay (FR-009 to
FR-014, FR-024, FR-028).

**Independent Test**: on every screen in every theme, the content area's background differs from the
title bar, status bar and side panel, and the side panel is set apart by its rail. The chrome matches [contracts/interface.md](contracts/interface.md)
§ Screen regions, § Title bar and § Status bar (SC-002).

### Tests (write first, observe failing)

- [X] T024 [P] [US2] Add to `tests/ui/frame.test.ts`:
  - At 80 × 24 in Tokyo Night, every cell of row 0 and row 23 has background `#16161e` (panel).
  - Every content cell is `#1a1b26` (bg) or a stripe or selection tone.
  - Column 0 of every content row is `┃` in `#7aa2f7` (primary).
  - With the side panel open at 120 columns, the panel's first column is `┃` in `#bb9af7` (accent) and its cells are `panel`.
  - No cell anywhere has an undefined background.
  - `contentHeight` is body height − 1, and `rawContentWidth` is body width − 2 (rail and scroll bar) (research R5).
  - `panel` ≠ `bg`, and the side panel's first column is the accent rail (SC-002).
- [X] T025 [P] [US2] Add to `tests/ui/frame.test.ts` (placed in `tests/ui/stability.test.ts`, which already has the fixture database): at 80 × 24 with a stale warning shown, every screen (national, districts, district, council, candidates, watchlist, search, help) renders with no figure cut and at least 10 table rows visible where the screen has a table (SC-007, FR-028).
- [X] T026 [P] [US2] Add to `tests/unit/breadcrumb.test.ts`: `breadcrumbSegments(segments, width)` in `src/ui/chrome/breadcrumb.ts` returns the kept segments as a list, applying the existing left truncation (`…` first, the current level never dropped). The plain text `breadcrumbText` stays byte-identical for every existing case.
- [X] T027 [P] [US2] Add to `tests/ui/colour.test.ts` for the title bar at three levels deep:
  - `◆ VOLBY` is `#1a1b26` on `#bb9af7`, bold.
  - Earlier levels are `text` on `element`.
  - The current level is `onAccent` on `primary`, bold.
  - Each join is `▌` in the left segment's background colour on the right segment's background.
  - At the right end, `● živě` is `success` on `panel`, followed by the last successful refresh time in `muted`.
  - While a warning is shown, `● živě` is replaced by ` ● ZASTARALÉ ` in `onAccent` on `warning`.
- [X] T028 [P] [US2] Add to `tests/unit/status-bar.test.ts` and `tests/ui/colour.test.ts`:
  - The status bar starts with the screen label for the `Screen.kind`: PŘEHLED, OKRESY, OKRES, ZASTUPITELSTVO, KANDIDÁTI, SLEDOVANÉ, HLEDÁNÍ, NÁPOVĚDA, and PŘÍKAZY while the palette is open. It is drawn in `onAccent` on `primary`, bold, followed by `▌`.
  - Each key is a ` key ` chip in `onAccent` on `accent`, bold, with its label in `subtle`.
  - The theme label is right-aligned in `muted`.
  - Hints that do not fit are dropped whole from the right.
  - The set of keys equals today's `statusBarLine` set (001 FR-064).
- [X] T029 [P] [US2] Add to `tests/ui/colour.test.ts`: the warning row is `warning` across its full width, with its text in `onAccent`, bold (FR-014).
- [X] T030 [P] [US2] Add to `tests/ui/colour.test.ts`: the scroll bar track is `track` and the thumb is `muted` (research R6).
- [X] T031 [P] [US2] Add to `tests/ui/palette.test.ts`:
  - With the palette open, the content rows are still rendered beneath it, and their cells are blended toward `panel`: each background channel lies strictly between its undimmed value and `panel`'s.
  - The palette's border is rounded (`╭`), in `borderActive`, with the title ` Příkazy `, on `element`.
  - The search line is `›` in `accent` on `bg`.
  - Each entry's key is a chip. The highlighted entry is `sel` across the full width.
  - An unavailable entry shows its label and `(reason)` in `muted`.
  - Closing the palette leaves the content exactly as it was, with the same scroll position and selection.

### Implementation

- [X] T032 [US2] Update `src/ui/chrome/frame.ts` (research R5, R6):
  - `root` gets `backgroundColor` = `bg`.
  - `body` becomes `border: ["left"]`, `borderStyle: "heavy"`, `borderColor` = `primary`, `backgroundColor` = `bg`, `paddingTop: 1`.
  - `panel` keeps `border: ["left"]`, becomes `borderStyle: "heavy"`, `borderColor` = `accent`, `backgroundColor` = `panel`.
  - Add `applyTheme(theme)`, which sets these colours plus the scroll bar `verticalScrollBar.slider` background (`track`) and foreground (`muted`). It replaces `setBorderColor`.
  - NEVER set `borderColor` or `borderStyle` on a box without a border: it switches on a full border.
  - Update `contentHeight` and `rawContentWidth` per T024.
  - Update the fallback sizes that hard-code the old four-sided border: `width - 3` and `height - 4` in `tests/ui/colour.test.ts:69-70`, `tests/ui/redraw.test.ts:58,77` and `tests/ui/stability.test.ts:92`, and the fallback `26` in `tests/ui/panel.test.ts:153`. Derive them from the new metrics (width − 2, height − 3).
  - Makes T024 and T030 pass.
- [X] T033 [US2] Add `breadcrumbSegments` to `src/ui/chrome/breadcrumb.ts`, and rebuild `breadcrumbText` on it. Makes T026 pass.
- [X] T034 [US2] Add `titleBarRow(segments, live, width): SemanticRow` to `src/ui/chrome/state.ts`, building the badge, segments, joins, live indicator and clock as cells with `surface`. The live indicator reads `staleWarning(...) !== null`. The clock is the most recent `lastSuccessAt` across subscriptions, as `HH:MM:SS`, with no new data fetched (spec Assumptions). Render it through `styledRow` with `rowBg: "panel"` into `frame.titleBar`. Each join is a cell `{ text: "▌", fgSlot: <left segment's background slot>, surface: <right segment's surface> }`. The status bar's screen label join is built the same way. Makes T027 pass.
- [X] T035 [US2] Add `screenLabel(screen, paletteOpen)` and `statusBarRow(context, theme, width): SemanticRow` to `src/ui/components/status.ts`, reusing the hint list `statusBarLine` already builds. Keep `statusBarLine` as the plain-text form. Render through `styledRow` with `rowBg: "panel"` into `frame.statusBar`. Makes T028 pass.
- [X] T036 [US2] Render the warning row in `src/ui/chrome/frame.ts` and `src/ui/chrome/state.ts` as a styled row with `rowBg: "warning"` and the text in `onAccent`, bold. Makes T029 pass.
- [X] T037 [US2] Rebuild `src/ui/palette/view.ts` as an overlay (research R7):
  - A dimming `BoxRenderable` with `position: "absolute"`, `zIndex` above the body, covering the body, with `backgroundColor` = the theme's `panel` at alpha `0xB3`.
  - Over it, the palette `BoxRenderable` with `position: "absolute"`, a higher `zIndex`, `border: true`, `borderStyle: "rounded"`, `borderColor` = `borderActive`, `backgroundColor` = `element`, `title: " Příkazy "`, `bottomTitle: " Enter spustit · Esc zavřít "`.
  - Inside it, the existing `InputRenderable`, prefixed by `›`, and a pool of `TextRenderable` entry rows drawn with `styledRow`: label cell, `(reason)` in `muted` when unavailable, key cell with `surface: "accent"` when highlighted, else `accent` on `panel`, and `rowBg: "sel"` for the highlighted entry.
  - Remove `SelectRenderable`. Keep `filterEntries`, `entryLabel`, `entryDescription`, `move`, `current` and `chosen` unchanged in behaviour.
  - Makes T031 pass.
- [X] T038 [US2] Update `src/ui/app.ts` and `src/ui/chrome/frame.ts`:
  - Remove `setContentVisible` and `attachOverlay`'s swap. The body stays visible while the palette is open, and the overlay boxes toggle `visible` only.
  - Call `frame.applyTheme` and `palette.applyTheme` when the theme changes, in the same frame as `invalidateRows` (FR-027).
  - Run the full suite, including `tests/ui/mouse.test.ts` and `tests/ui/stability.test.ts`.
- [X] T039 [US2] REVIEW Phase 4:
  - Compare the running application with the mock at 80 × 24 and 100 × 30 in all six themes (quickstart §2 steps 2, 7, 8 and 9).
  - Check that regions do not move on a refresh (`tests/ui/stability.test.ts`).
  - Check that no `borderColor` is set on a borderless box.
  - (Done 2026-09-23. Deviations recorded: the national overview has no selection gutter, so its text sits against the rail as it sat against the old border; the palette key is `accent` on `element` rather than on `panel`; one-off notices use `element`. Found and fixed in review: in monochrome the content read through the palette, so it is now withheld while the palette is open, see `Frame.setContentHidden`.)

**Checkpoint**: layout C's chrome is complete in every theme. User Stories 1 and 2 both work.

---

## Phase 5: User Story 3 – Choose a theme I like (Priority: P2)

**Goal**: cycling, choosing by name from the palette, persistence, and legacy choices carried over
(FR-004 to FR-006a).

**Independent Test**: from a fresh data directory, Tokyo Night is used. `Ctrl+T` visits all six
themes in contract order. `Motiv: Nord` in the palette applies Nord. A restart keeps the choice.
A stored `dark` or `light` becomes Tokyo Night or Catppuccin Latte.

### Tests (write first, observe failing)

- [X] T040 [P] [US3] Add legacy carry-over cases to `tests/integration/preferences.test.ts` (the name updates were done in T005):
  - `readTheme` returns `"tokyonight"` for a stored `"dark"`, `"catppuccin-latte"` for `"light"`, `"high-contrast"` for `"high-contrast"`, the same name for each of the six, and `null` for `"solarized"` and for no row.
  - Reading does not rewrite the stored value.
- [X] T041 [P] [US3] Add to `tests/unit/theme.test.ts` (these cases were written with T003, where the defaults first changed): `resolveTheme(null, env)` gives `tokyonight` with `reportedScheme` `null` or `"dark"`, and `catppuccin-latte` with `"light"`. `resolveTheme("nord", { noColor: true, … })` gives `MONOCHROME`.
- [X] T042 [P] [US3] Add to `tests/ui/palette.test.ts`:
  - `paletteEntries` includes one entry per theme, labelled `Motiv: <themeLabel>`, with key `Ctrl+T`.
  - The active theme's entry is unavailable with the reason "tento motiv je aktivní".
  - Typing `motiv nord` narrows the list to the Nord entry (the existing fold matching).
  - Choosing it applies Nord and stores `"nord"`.
- [X] T043 [P] [US3] Add to `tests/ui/colour.test.ts`: after `Ctrl+T`, every region is repainted in the next theme within the same frame. No row keeps a Tokyo Night colour, and the status bar's theme label reads the new theme's label (FR-027, acceptance 3.3).

### Implementation

- [X] T044 [US3] Update `readTheme` in `src/storage/queries/preferences.ts` with the legacy map `{ dark: "tokyonight", light: "catppuccin-latte" }`, applied before `isThemeName`, with no write on read (data-model.md § Stored value). Makes T040 pass.
- [X] T045 [US3] Confirm that `resolveTheme` in `src/ui/theme/detect.ts` satisfies T041 (it was changed in T010). If a case fails, fix it there.
- [X] T046 [US3] Add the theme actions to `src/ui/palette/actions.ts`:
  - One `Action` per `THEME_NAMES` entry, with id `theme:<name>`, label `Motiv: <themeLabel(name)>` and key `Ctrl+T`.
  - `unavailable` returns "tento motiv je aktivní" when the name is the active theme. Add `activeTheme: ThemeName` to `ActionContext` for this.
  - Handle `theme:<name>` in `src/ui/app.ts` by setting `themeName`, calling `writeTheme` and posting the existing `Motiv: …` notice.
  - Makes T042 pass.
- [X] T047 [US3] Update `cycleTheme` in `src/ui/app.ts` to use the new `nextTheme` order and `themeLabel`, and make the status bar's theme label read the resolved theme. Makes T043 pass.
- [X] T048 [US3] REVIEW Phase 5: quickstart §2 steps 1, 4 and 5, and §4 (legacy preference), run by hand. No second place decides the default theme. (Automated checks done; the theme entries live outside the registry so the status bar and help screen are not crowded, and the palette filter now matches each typed word. The by-hand walk is left for the user.)

**Checkpoint**: users can pick any theme, and existing users keep an equivalent of their choice.

---

## Phase 6: User Story 4 – See the summary figures and the result at a glance (Priority: P3)

**Goal**: status badges, national cards with the collapse rule, council chips, the seat strip and bars
on a track (FR-018, FR-020 to FR-023).

**Independent Test**: the national overview and Brno-Bohunice at 80 × 24 and 120 × 34 match the
mock's "Přehled ČR" and "Zastupitelstvo" screens, and every figure shown today is still present in
the plain text (FR-026).

### Tests (write first, observe failing)

- [X] T049 [P] [US4] Rewrite the national summary assertions in `tests/ui/national.test.ts` first, and observe them failing:
  - The plain text contains a title line with `✓ konečné výsledky` (or the provisional label for provisional data).
  - Three card label cells: `SEČTENO OKRSKŮ`, `ÚČAST` and `PLATNÉ HLASY`.
  - The figures `14 722 / 14 722`, `100,00 %`, `46,07 %`, `87 076 331`, `8 255 204` voters, `3 803 131` envelopes and `59 228` elected, each exactly once, with any `▲` or `▼` change marker beside its figure.
  - KEEP every existing assertion about the party table unchanged.
- [X] T050 [P] [US4] Add to `tests/ui/national.test.ts` and `tests/ui/colour.test.ts`:
  - The cards are three rows on `element`, with the label in `muted` and the figure in `text`, bold.
  - Row 3 of the first two cards is a bar in `success` over `track`, of length share/100 × the card's inner width.
  - A secondary figure is omitted when `len(figure) + len(secondary) + 3 > cardWidth`.
  - When the content height cannot hold the cards plus 10 table rows, the summary is ONE line with every figure still present (FR-021).
- [X] T051 [P] [US4] Rewrite the council summary assertions in `tests/ui/areas.test.ts` first, and observe them failing:
  - Brno-Bohunice shows the chips `Okrsky 13 / 13`, `Účast 46,21 %` and `Mandáty 21`, each label in `subtle` on `element` followed by its value in `onAccent` on `primary`, bold.
  - The badge `✓ konečné` is in `onAccent` on `success`.
- [X] T052 [P] [US4] Add to `tests/ui/areas.test.ts`: `seatStrip(parties, width)` in `src/ui/views/areas.ts`.
  - For Brno-Bohunice it gives `Rozdělení mandátů ■■■■■■■■■ ■■■■ ■■ ■■ ■■ ■ ■  21`: one `■` per seat, parties with 0 seats omitted, groups in the table's displayed order separated by one space, groups alternating `primary` and `subtle`, and the total as a figure.
  - It returns no row when the strip does not fit `width`: it never wraps and is never cut (contract § Council summary).
  - After `s` sorts the table, the strip follows the new order.
- [X] T053 [P] [US4] Add to `tests/ui/colour.test.ts`: in the council and national tables, a bar cell's filled glyphs are in `bar`, and every cell of its column past the filled part has background `track`. Under `MONOCHROME`, the bar characters are unchanged from today and no cell has a `bg` (FR-018, acceptance 4.4).
- [X] T054 [P] [US4] Add to `tests/ui/panel.test.ts`: the side panel title reads `SLEDOVANÉ` in `accent`, bold, and each turnout bar is drawn in `bar` over `track`.

### Implementation

- [X] T055 [US4] Add `badge(text, surface): Cell` and `chip(label, value): Cell[]` to `src/ui/row.ts`: label cell `subtle` on `element`, value cell with `surface: "primary"`, bold. Both are padded with one space either side, as in the contract.
- [X] T056 [US4] Rebuild the summary in `src/ui/views/national-rows.ts`:
  - The title row with the status badge.
  - Then either three card rows or one collapsed line, chosen by a `contentHeight` option. The rule is: `contentHeight − (title 2 + cards 4 + header 2) ≥ 10`.
  - Cards share the width equally with 2-column gaps. Each card is a cell with `surface: "element"` per row, with bar cells marked `bar: true`.
  - Pass `contentHeight` from `composeScreen` in `src/ui/screen.ts`.
  - Makes T049 and T050 pass.
- [X] T057 [US4] Rebuild the council summary in `buildCouncilRows` in `src/ui/views/areas.ts` with `badge` and `chip`, and append `seatStrip` after the party table and before the note. Makes T051 and T052 pass.
- [X] T058 [US4] Mark every bar cell `bar: true` where views call `bar()`: `src/ui/views/national-rows.ts`, `src/ui/views/areas.ts` and `src/ui/chrome/panel.ts`. In `src/ui/theme/apply.ts`, give the filled glyphs the `bar` foreground and every blank cell of a bar cell the `track` background. Makes T053 pass.
- [X] T059 [US4] Update `buildPanelRows` in `src/ui/chrome/panel.ts`: the title `SLEDOVANÉ` in role `accent` (added in T007), and bars marked `bar: true`. Makes T054 pass.
- [X] T060 [US4] Run `tests/integration/export-parity.test.ts` and `tests/integration/export.test.ts` UNCHANGED. They must pass without edits (SC-006). If one fails, the export path is reading view rows and must be separated, not the test changed.
- [X] T061 [US4] REVIEW Phase 6:
  - Every figure from the old summaries is still asserted (FR-026, plan § Carried risks).
  - Walk quickstart §2 step 6 against the mock.
  - No colour is assigned by party (FR-025).
  - (Done 2026-09-23. Deviations, recorded in the spec (FR-021) and the contract: no card figure is "secondary", because FR-026 forbids dropping one, so the share sits beside its bar and voters and envelopes go in a detail line; the collapsed form is three compact lines, since one cannot hold every figure at 80 columns; card figures are bold in `primary`; the council badge opens the chip row. Found in review: rows with several cells and no columns joined them with a space in plain text but not when styled, so the two forms disagreed; non-tabular cells are now concatenated in both, spaces written into the cells.)

**Checkpoint**: all four stories work, each independently testable.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T062 [P] Write `tests/ui/theme-depth.test.ts` first:
  - `nearest256("#1a1b26")` returns the xterm-256 index at the smallest Euclidean RGB distance over indices 16 to 255 (the 6×6×6 cube and the grey ramp).
  - Exact cube colours map to themselves, for example `#5f87af` → 67.
  - Pure greys map to the grey ramp or the cube, whichever is nearer.
  - Results are cached: calling twice returns the same object.
- [X] T063 Implement `src/ui/theme/depth.ts` (`nearest256(hex): number`, cached in a `Map`). Use it in `slotColor` in `src/ui/theme/apply.ts`: `RGBA.fromIndex(nearest256(hex))` when the colour environment has `rgb === false && ansi256 === true`, otherwise `RGBA.fromHex(hex)`. Add `rgb` to `ColorEnvironment` in `src/ui/theme/detect.ts`, read from `renderer.capabilities?.rgb`. Makes T062 pass (research R8).
- [X] T064 Add a test (written in `tests/ui/theme-depth.test.ts` against `withCapabilities` and `resolveTheme`, since the App has no test harness; the event handler in `app.ts` only wires the two to the renderer) to `tests/ui/colour.test.ts`, and observe it failing: when the test renderer emits a `"capabilities"` event that changes `rgb` or `ansi256`, the next frame repaints every row in the newly resolved colours (256-colour indices when `rgb` becomes false).
- [X] T064a In `src/ui/app.ts`, re-read `renderer.capabilities` on the renderer's `"capabilities"` event, and redraw with `invalidateRows` when `rgb` or `ansi256` changed. Detection settles within about 5 s of start (plan § Carried risks). Makes T064 pass.
- [X] T065 [P] Extend `tests/ui/redraw.test.ts`: with the largest table in Tokyo Night, with stripes, cards and side panel, a selection move completes within 100 ms, and exactly two row renderables are rewritten (SC-008).
- [X] T066 [P] Update `README.md` line 37: the themes are Tokyo Night (default), Catppuccin Mocha, Gruvbox Dark, Nord, Catppuccin Latte and High contrast, cycled with `Ctrl+T` or chosen from the palette. Remove the sentence saying dark and light follow the terminal palette.
- [X] T067 [P] Add a note at the top of `specs/001-election-results-tui/contracts/interface.md` pointing to `specs/002-tui-visual-refresh/contracts/interface.md` as superseding its "Screen regions", "Colour roles" theme table and command palette look. Change nothing else in the 001 contract.
- [X] T068 Delete dead code left by the refresh (also removed: the palette's `entryLabel` and `entryDescription`, used only by tests once the palette drew rows, and carrying an em dash; their tests now read the row the palette draws. `isRole`, `keyHintLine` and `NATIONAL_HINTS` predate this feature and were left):
  - `setBorderColor`, `setContentVisible`, any unused `ColorSpec` members, and any import of `SelectRenderable`.
  - Confirm with `bun run check` and a search for each name.
- [ ] T069 Run [quickstart.md](quickstart.md) §1 to §4 in full, on Windows Terminal, plus Linux if available. Record any deviation from the mock as either a fix or a deliberate difference (SC-009). (§1 done 2026-09-23: 858 pass, typecheck and lint clean. §2 to §4 need a person watching a real terminal and are left for the user. Deviations already known are recorded under T039 and T061.)
- [X] T070 FINAL REVIEW: the whole diff against the constitution. Check the spec's success criteria SC-001 to SC-009 one by one, each with the test or quickstart step that proves it. The suite is green, and there are no open findings.
  - (Done 2026-09-23. SC-001 T014, T017a; SC-002 T024; SC-003 T002; SC-004 T042 (Ctrl+P, type, Enter); SC-005 T017a; SC-006 T060, exports untouched; SC-007 T025; SC-008 T022, T065; SC-009 pending T069. Finding fixed in review: the cell-width helper was written three times; now `cellsWide` in `row.ts`. Every test was observed failing before its code, except T022, where the code landed with T021 and the test was then shown failing against the old key before being kept; and T041, T043, T045, whose behaviour Phase 2 and 4 had already delivered, kept as guards.)

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: after Setup. BLOCKS every story, because slots and background output
  are used everywhere.
- **US1 (Phase 3)**: after Phase 2.
- **US2 (Phase 4)**: after Phase 2. It uses `styledRow` with `rowBg` from Phase 2, but not the
  stripes, so it can run in parallel with US1. Coordinate on `src/ui/chrome/state.ts`, which both
  touch (T021 and T034 to T036).
- **US3 (Phase 5)**: after Phase 2. T042 and T046 touch the palette's action list, not its rendering,
  so they do not need T037. If US2 is done first, the theme entries appear with chips automatically.
- **US4 (Phase 6)**: after Phase 2. T058 depends on T008 (`bar` handling in `apply.ts`). T056 and T057
  are independent of US1 to US3.
- **Polish (Phase 7)**: after the stories wanted for release.

### Within each phase

- Test tasks first, observed failing. Then implementation. Then the REVIEW task.
- In Phase 2: T006 → T007 → T008 (apply depends on slots and role mapping). T009 can run with T006.
  T010 and T011 come after T006.
- In US1: T017a and T018 → T019 and T020 (in parallel, different files) → T021 → T022.
- In US2: T032 → T038. T033 → T034. T035, T036 and T037 are independent of each other.
- In US4: T055 → T056 and T057 (in parallel). T058 after T056 and T057. T059 after T055.

### User story independence

| Story | Can ship alone after Phase 2 | Independent test |
|---|---|---|
| US1 | Yes: stripes on today's layout | Adjacent rows differ, header `element`, selection `sel` |
| US2 | Yes: new chrome, unstriped tables | Content differs in background from every region around it; side panel set apart by its rail |
| US3 | Yes: theme choice on today's layout | Default, cycle, palette entry, restart, legacy value |
| US4 | Yes: cards and strip on today's chrome | Figures unchanged in plain text, surfaces as contracted |

---

## Parallel examples

```text
# Phase 2 tests together:
T002 tests/ui/theme-contrast.test.ts
T003 tests/unit/theme.test.ts
T004 tests/unit/row.test.ts + tests/ui/colour.test.ts (background output)
T005 theme-name updates in five test files

# US1 views together, after T018:
T019 src/ui/views/areas.ts
T020 src/ui/views/national-rows.ts, search.ts, watchlist.ts, help.ts

# US2 tests together:
T024 T025 tests/ui/frame.test.ts
T026 tests/unit/breadcrumb.test.ts
T028 tests/unit/status-bar.test.ts
T031 tests/ui/palette.test.ts

# US4 tests together:
T049 T050 tests/ui/national.test.ts
T051 T052 tests/ui/areas.test.ts
T054 tests/ui/panel.test.ts
```

Tasks that add to `tests/ui/colour.test.ts` are marked [P] against tasks in other files only. Tasks
in the same file must be serialised.

---

## Implementation Strategy

### MVP first

1. Phase 1 and Phase 2: Tokyo Night by default, colours from slots.
2. Phase 3 (US1): striped tables. **Stop and validate** against the mock's "Seznam okresů" screen.
3. This alone delivers the most-asked-for readability improvement.

### Incremental delivery

1. Phase 4 (US2): the layout C chrome and palette overlay. The biggest visual change.
2. Phase 5 (US3): theme choice and legacy carry-over.
3. Phase 6 (US4): cards, chips and the seat strip.
4. Phase 7: 256-colour support, capability re-detection, documentation, final review.

## Notes

- There is no git branch for this feature yet: the work sits on `001-election-results-tui`. Create
  `002-tui-visual-refresh` before T002 if the features are to be merged separately.
- Commit after each task or logical group, with the attribution lines the repository uses.
- Never use an em dash in code, comments, commit messages or file names (organisation rule). Use a
  plain hyphen in code.
