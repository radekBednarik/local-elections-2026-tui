---

description: "Task list for the logs view and the honest status row"
---

# Tasks: Logs View Instead of the Stale-Data Warning Line

**Input**: Design documents from `specs/004-logs-view/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/interface.md](contracts/interface.md), [quickstart.md](quickstart.md)

**Tests**: REQUIRED. The constitution makes TDD non-negotiable (Principle II):
- Every implementation task comes after a test task.
- That test must be seen FAILING before the implementation is written.
- `sourceStatus` takes `now`, so no test depends on the wall clock.
- Logger tests use `withTempDataDir` from `tests/helpers/tmpdir.ts`, as the existing
  ones do.

**Review**: every task ends with a review against:
- Principles I and II,
- [contracts/interface.md](contracts/interface.md) (Principle III).

The REVIEW tasks at the end of each phase make this visible. A task is complete only
when its review has no open findings.

**Wording**: every Czech string below is copied from
[contracts/interface.md](contracts/interface.md). Where a task and the contract differ,
the contract wins, and the task is corrected in the same change.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: The user story the task belongs to (US1 to US4 in spec.md)

---

## Phase 1: Setup

**Purpose**: Establish a green baseline, so every later failure is known to be new.

- [X] T001 Create the branch `004-logs-view` from `main` and switch to it (`git switch -c 004-logs-view`).
  - Commit the planning documents in `specs/004-logs-view/` and `.specify/feature.json` as the first commit.
  - Then run `bun test`, `bun run typecheck` and `bun run check` from the repository root, and record the pass counts in this task's notes.
  - Stop and report if anything fails before a change has been made.
  - (Done 2026-09-24. Branch created and planning docs committed as f45e77b. Baseline: 908 pass, 0 fail across 50 files; typecheck clean; biome clean, 132 files.)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The logger keeps an in-memory record of what it accepts, which US2 and US3
read. See [data-model.md § LogEntry](data-model.md#logentry-new-srcloggingloggerts) and research R4.

**⚠️ CRITICAL**: US2 and US3 cannot start until this phase is complete. US1 does not
depend on it and may run alongside.

### Tests (write first, observe failing)

- [X] T002 [P] Add `describe("in-memory record (004 research R4)")` to `tests/unit/logger.test.ts`, with these tests:
  - A new logger has `entries()` equal to `[]` and `dropped === 0`.
  - After `warn("Dokument odmítnut", { source: "district:CZ0642", reason: "x" })`, there is one entry with:
    - `seq === 0`, `level === "warn"`, `message === "Dokument odmítnut"`, `source === "district:CZ0642"`;
    - `at` equal to the ISO timestamp in the file line;
    - `line` equal to the file's content with the trailing `\n` removed. Read the file with `readFileSync`.
    - `detail` equal to `{"source":"district:CZ0642","reason":"x"}`, which is exactly the text after ` | ` in `line`.
  - `detail` is `null` for an entry logged without a detail, and `"Error: boom"` for `error("x", new Error("boom"))`. In both cases `line` ends with `message` followed by ` | ${detail}` when `detail` is not null.
  - A detail with no string `source` (none; `{ source: 3 }`; an `Error`) gives `source === null`.
  - Entries below the threshold are neither written nor recorded. Test with a logger created at `"warn"`, and check that `info` and `debug` leave `entries()` empty.
  - Writing `LOG_VIEW_LIMIT + 5` entries:
    - `entries().length === LOG_VIEW_LIMIT` and `dropped === 5`;
    - `entries()[0].seq === 5`;
    - every entry satisfies `entries()[i].seq === dropped + i`.
  - `LOG_VIEW_LIMIT` is exported and equals `1000`.
- [X] T003 [P] Add a test to `describe("resilience")` in `tests/unit/logger.test.ts`. When the log path cannot be written, entries are still recorded, with the same `line` text a successful write would have produced. Force the failure the way the existing resilience test does.
- [X] T004 [P] Add to `describe("null logger")` in `tests/unit/logger.test.ts`: `createNullLogger()` has `entries()` equal to `[]` and `dropped === 0`, and neither changes after calls to `error`, `warn`, `info` or `debug`.

### Implementation

- [X] T005 In `src/logging/logger.ts`:
  - Export `LOG_VIEW_LIMIT = 1000`.
  - Export `interface LogEntry { seq: number; at: string; level: LogLevel; message: string; detail: string | null; source: string | null; line: string }`, with a doc comment for each field taken from data-model.md.
  - `detail` is the serialised detail text the formatter puts after ` | `: the `Error` form, the JSON, or the `[detail could not be serialised]` fallback. It is `null` when there is no detail. Split `format` into one private `detailText(detail): string | null` plus the line assembly, so `detail` and `line` come from the same serialisation (Principle I).
  - Add `entries(): readonly LogEntry[]` and `readonly dropped: number` to `Logger`. Replace the comment on `path` ("Everything written so far, for tests and for the in-app log view.") with an accurate one.
  - Change `format` to take the timestamp as a parameter, so the entry's `at` and the file line share one `new Date().toISOString()` call. Keep one formatter (Principle I).
  - In `write`:
    - after the threshold check, build the line once;
    - push the entry into the record BEFORE the `writable` check, so a failing file does not stop recording;
    - when the record exceeds `LOG_VIEW_LIMIT`, `shift()` and increment `dropped`;
    - then append to the file as before.
  - `source` is `detail.source` when `detail` is a non-null, non-`Error` object whose `source` is a string, otherwise `null`.
  - `createNullLogger` returns `entries: () => []` and `dropped: 0`.
  - Makes T002 to T004 pass.
- [X] T006 REVIEW Phase 2 against Principles I–III and data-model.md. Check that:
  - there is exactly one formatter;
  - a recorded entry exists exactly when the threshold passes;
  - nothing in the logger can write to stdout or stderr.

  Run `bun test`, `bun run typecheck` and `bun run check`. Fix every finding before continuing.
  - (Done 2026-09-24. Red first: the suite failed on the missing `LOG_VIEW_LIMIT` export. 917 pass, 0 fail. Findings: one formatting issue, fixed with biome. One formatter (`format`), with `detailText` shared by line and entry. Recording happens after the threshold check and before the `writable` check. No stdout/stderr writes.)

**Checkpoint**: the logger holds the session's last 1000 entries. Nothing visible changes yet.

---

## Phase 3: User Story 1 - The top of the screen tells the truth before results are published (Priority: P1) 🎯 MVP

**Goal**: A source that has never loaded is never called stale.
- The status row shows a fixed Czech line with no error text.
- The title bar shows `○ čeká na výsledky` before publication and `● ZASTARALÉ` only for
  data that really is stale.

Contract § 1 and § 2, research R1 to R3.

**Independent Test**: Quickstart § 2 up to "Now press `l`", and quickstart § 3 up to
"Now check the logs view".

### Tests (write first, observe failing)

- [X] T007 [P] [US1] In `tests/unit/status-bar.test.ts`, replace `describe("staleWarning (FR-044)")` and `describe("warning robustness")` with `describe("sourceStatus (004 FR-001–FR-004)")`. It uses the existing `sub()` helper and passes `now` explicitly. Cases:
  - `null` when nothing is failing, and `null` when the only failing source is `final: true`.
  - **Awaiting cases:**
    - `{ consecutiveFailures: 2, lastSuccessAt: null, lastError: "Data zatím nejsou zveřejněna" }` gives `kind: "awaiting"`.
    - Its text is exactly `○ Výsledky zatím nejsou zveřejněny, aplikace je průběžně kontroluje. · l záznamy`.
    - The text contains neither `ZASTARALÁ` nor the `lastError`.
  - A schema-rejection `lastError` (a long parser message) with `lastSuccessAt: null` is also `awaiting` (FR-002, spec scenario 1.2).
  - **Stale cases:**
    - A failing source with `lastSuccessAt` four minutes before `now` gives `kind: "stale"`.
    - Its text is exactly `! ZASTARALÁ DATA: zobrazena data před 4 min. Obnovení se nedaří. · l záznamy`. Build the expected age with `formatAge(240)` rather than a literal if `formatAge` words it differently.
    - The text does not contain the `lastError` or the source key.
  - One awaiting and one stale failing source together give `stale` (spec edge case).
  - Two stale failing sources whose `lastSuccessAt` are 2 and 10 minutes before `now` give an age of `formatAge(600)`. The oldest data on screen is reported, not the freshest (research R2).
  - A `lastSuccessAt` ahead of `now` is clamped to zero age. This moves the clock-skew case over from the old tests.
  - Neither text contains `lastError` for any of the old robustness inputs: the long reason, and the reason with newlines.
- [X] T008 [P] [US1] Update `describe("finality indicator (FR-008)")` in `tests/unit/status-bar.test.ts`, or its `titleBarRow` counterpart in `tests/ui/frame.test.ts` if the indicator is asserted there, and add:
  - `titleBarRow(trail, "awaiting", …)` contains ` ○ čeká na výsledky ` with the `muted` role;
  - `"stale"` still gives ` ● ZASTARALÉ `.
- [X] T009 [P] [US1] In `tests/ui/frame.test.ts`, update the tests around lines 249–270 and 356 to pass `sourceStatus` instead of a warning string, and add:
  - `sourceStatus` awaiting:
    - the title bar shows `čeká na výsledky`;
    - no row contains `ZASTARALÁ` or `ZASTARALÉ`;
    - the status row shows the awaiting text on the `element` surface.
  - `sourceStatus` stale: `● ZASTARALÉ`, and the stale text on the `warning` surface.
  - **Precedence (research R3):** with both a `notice` and a stale `sourceStatus`, the row shows the notice. The title bar still shows `● ZASTARALÉ`.
- [X] T010 [P] [US1] In `tests/integration/resilience.test.ts`, change `describe("the staleness warning (FR-044)")` to use `sourceStatus`.
  - The first test becomes "appears on failure and clears on recovery". The `mode = "down"` step expects `kind: "stale"`, because the counting pass succeeded first. Replace `toContain("503")` with `not.toContain("503")`: the reason now lives only in the log (FR-004).
  - Add a test: with no successful pass (`mode = "down"` from the start), `sourceStatus(scheduler.all())?.kind === "awaiting"`.
  - The final-results test keeps expecting `null`.
  - In `describe("offline start (FR-042)")` (around line 221), the first run ingests with `ingestNational` directly and never records a success, so `lastSuccessAt` stays `null`. Under research R1 that would read as awaiting, which is not what the test describes.
    - Add `scheduler.recordSuccess("national", {}, new Date(), false)` after the ingest and before `recordFailure`, as the real fetch path (`recordFetch`) does.
    - Change the assertion to `expect(sourceStatus(restored.all())?.kind).toBe("stale")`.
    - Update the import from `staleWarning` to `sourceStatus`.
- [X] T011 [P] [US1] In `tests/ui/colour.test.ts` (around lines 520–561) and `tests/ui/stability.test.ts` (around line 228), replace the old warning strings with `sourceStatus` values. Keep what each test asserts:
  - the colour tests: the stale row and chip colours, via `● ZASTARALÉ` and `ZASTARALÁ DATA`;
  - the stability test: the row appears without moving the content.

### Implementation

- [X] T012 [US1] In `src/ui/components/status.ts`:
  - Replace `staleWarning` and `MAX_REASON` with `export type SourceStatus = { kind: "stale" | "awaiting"; text: string } | null` and `export function sourceStatus(subscriptions: Subscription[], now = new Date()): SourceStatus`, following data-model.md § SourceStatus.
    - Rule: failing means `consecutiveFailures > 0 && !final`; stale if any failing one has `lastSuccessAt !== null`; otherwise awaiting.
    - For stale, the age is taken from the OLDEST `lastSuccessAt` among the failing sources that have one, which gives the largest age, clamped at zero. This is the conservative figure: the user is told how old the oldest data on screen may be (research R2).
  - Put the two texts in named constants. The doc comment cites FR-001 to FR-004 and research R1/R2.
  - Remove `staleWarning`. Do not keep it as an alias.
  - Makes T007 pass.
- [X] T013 [US1] In `src/ui/chrome/state.ts`:
  - **Indicator:**
    - Add `"awaiting"` to `LiveIndicator`.
    - Add `awaiting: { text: " ○ čeká na výsledky ", role: "muted" }` to `INDICATOR_CELLS`.
    - The precedence is stale, then awaiting, then final, then live. Update the doc comment of `LiveIndicator`.
  - **Inputs and state:**
    - In `FrameInputs`, replace `warning: string | null` with `sourceStatus: SourceStatus`.
    - Change `FrameState.warningKind` to `"stale" | "awaiting" | "notice" | null`.
  - **Status row (research R3):**
    - Add `awaiting: { surface: "element", role: "muted" }` to `WARNING_LOOK`.
    - The row shows `inputs.notice` when it is not null, otherwise `inputs.sourceStatus?.text`.
    - Replace the comment "A real staleness warning always wins the row" with the new rule and its reason.
  - Makes T008 and T009 pass.
- [X] T014 [US1] In `src/ui/app.ts`, in `draw()`, pass `sourceStatus: sourceStatus(subscriptions)` instead of `warning: staleWarning(subscriptions)`, and update the import.
  - Update every other `frameState({...})` call site that still passes `warning:` (at least `tests/ui/right-edge.test.ts`, `tests/ui/redraw.test.ts` and `tests/ui/panel.test.ts`) to `sourceStatus: null`.
  - `bun run typecheck` must pass. Makes T010 and T011 pass.
- [X] T015 [US1] REVIEW Phase 3 against Principles I–III and contract § 1–2. Check that:
  - `lastError` is not read anywhere in `src/ui/`, apart from the scheduler record;
  - a grep for `staleWarning` finds nothing;
  - the notice precedence change is commented with its reason.

  Run `bun test`, `bun run typecheck` and `bun run check`. Fix every finding before continuing.
  - (Done 2026-09-24. Red first: the suites failed on the missing `sourceStatus` export and on 6 frame/colour assertions. 922 pass, 0 fail; typecheck and biome clean. Deviations recorded: (1) T009's `frameState`-level assertions (awaiting surface, notice precedence) live in `tests/ui/colour.test.ts`, whose `paintRows` builds a real frame from a database. `tests/ui/frame.test.ts` drives the `Frame` renderable with plain strings, which is still valid and was left alone. (2) Typecheck found `FrameInputs.warning` and `staleWarning` in five `tools/verify/*` scripts too, now updated. (3) One more `staleWarning` use in resilience's rejected-document test now expects `stale`, because that test counts successfully first. Findings: none open. `lastError` is not read anywhere in `src/ui/`.)

**Checkpoint**: the first screen before publication is honest. The status row names `l`,
which US2 makes work. Ship US1 and US2 together (see Implementation Strategy).

---

## Phase 4: User Story 2 - Open a dedicated logs view with one key (Priority: P1)

**Goal**:
- `l` opens the `ZÁZNAMY` list of this session's entries, newest selected.
- `Enter` opens one entry in full (`ZÁZNAM`).
- `Esc` goes back one level with selection and scroll restored.
- New entries appear live and never move the selection off its entry.
- A `404` or a rejected document is logged once per change of reason.

Contract § 3, § 4, § 6 (the `logs` row) and § 7; research R5, R6 and R8.

**Independent Test**: Quickstart § 2 from "Now press `l`", and quickstart § 3 from "Now
check the logs view".

**Depends on**: Phase 2.

### Tests (write first, observe failing)

- [X] T016 [P] [US2] Create `tests/unit/logs-view.test.ts` for `src/ui/views/logs.ts`. Build `LogEntry` literals directly. Tests:
  - **`buildLogListRows(entries, width)`:**
    - The heading is `Záznamy`, followed by a rule and a table header with `Čas`, `Úroveň`, `Zdroj` and `Zpráva`.
    - There is one data row per entry, oldest first.
    - The time is local `HH:MM:SS` of `at`.
    - The level labels are `CHYBA`, `VAROVÁNÍ`, `INFO` and `LADĚNÍ`, padded to one width.
    - An empty source cell is shown for `source: null`.
    - The message cell is `message` when `detail` is `null`, otherwise `` `${message} | ${detail}` ``. It is never parsed back out of `line`. The row is cut to width like other rows.
  - **Roles:** `CHYBA` and `VAROVÁNÍ` rows use the `warning` role, `LADĚNÍ` rows use `muted`, and `INFO` rows have no role.
  - **Empty list:** `entries = []` gives the single line `Zatím nebyly zaznamenány žádné záznamy.`, with `rowCount` 0.
  - **`buildLogEntryRows(entries, seq, width)`:**
    - The heading is `Záznam`, and the entry's full `line` is wrapped to `width` with no characters lost. Joining the wrapped pieces gives `line`.
    - A `seq` not present gives `Záznam již není k dispozici.`
- [X] T017 [P] [US2] Add to `tests/integration/screen.test.ts`. Pass `logEntries` through `ScreenOptions`:
  - `composeScreen(db, { kind: "logs" }, …)`:
    - `rowCount` equals the number of entries, and `firstRow` points at the first data row;
    - `target(i)` is `{ kind: "log-entry", seq: entries[i].seq }`.
  - `{ kind: "log-entry", seq }` has `rowCount` 0 and `target` null.
  - `shownSources` for both kinds returns `["national"]`, as for `help`.
- [X] T018 [P] [US2] In `tests/ui/help-and-language.test.ts`, check that:
  - `describe("every screen composes (exhaustiveness)")` covers `logs` and `log-entry`;
  - the help screen lists a row with key `l` and label `Zobrazit záznamy`.

  In `tests/unit/breadcrumb.test.ts` (or wherever `segmentsFor` is tested), check that:
  - `segmentsFor` gives `Záznamy` for `logs` and `Záznam` for `log-entry`;
  - `screenLabel` gives `ZÁZNAMY` and `ZÁZNAM`.
- [X] T019 [P] [US2] In `tests/unit/keymap.test.ts`:
  - `l` maps to `{ kind: "action", id: "logs" }`;
  - the `describe("every action has a key (FR-078)")` suite still passes with the new registry entry.

  In `tests/ui/palette.test.ts`:
  - `logs` is available on `national`, `council` and `help`;
  - on `logs` and `log-entry` it is unavailable with the reason `záznamy jsou právě otevřené`;
  - `open` is unavailable on `log-entry` (rowCount 0) and available on `logs` when there are entries.
- [X] T020 [P] [US2] In `tests/ui/frame.test.ts`: on `logs` and `log-entry` screens, with an awaiting `sourceStatus` and no notice, there is no status row, but the title bar still shows `čeká na výsledky`. With a notice, the notice row is shown (data-model § FrameInputs/FrameState).
- [X] T021 [P] [US2] In `tests/unit/logs-view.test.ts`, add `describe("opening, closing and keeping the selection (FR-008, FR-009, FR-012)")`.
  - **Why here:** no test drives `App` today (`perform` is private, and no test constructs `App`). The logs-screen behaviour is therefore specified as two pure functions in `src/ui/views/logs.ts` that operate on a real `Navigation`. `App` only calls them (T029). That keeps every line of production code behind a failing test (Principle II).
  - **`openLogs(nav: Navigation, count: number): void`:** pushes `{ kind: "logs" }` and selects the last row. Tests:
    - From `national`, push a council, then set `nav.current.selected = 5` and `nav.current.offset = 3`. `openLogs(nav, 4)` gives `nav.screen.kind === "logs"` and `nav.current.selected === 3` (FR-009).
    - `nav.pop()` then gives back the council with `selected === 5` and `offset === 3` (FR-008).
    - With `count === 0`, `selected === 0`.
    - From `logs`, `nav.push({ kind: "log-entry", seq: 7 })` and then `nav.pop()` returns to `logs` with its selection unchanged (contract § 4).
  - **`syncLogSelection(nav: Navigation, seen: number, dropped: number): number`:** returns the `dropped` count to remember. Tests:
    - On `logs` with `selected === 10`: `syncLogSelection(nav, 0, 3)` sets `selected === 7` and returns `3`.
    - On `logs` with `selected === 2`: `(0, 5)` clamps to `selected === 0`.
    - When nothing was dropped (`seen === dropped`), the selection is unchanged.
    - On any other screen, including `log-entry` above a `logs` entry, it changes nothing and returns `seen` unchanged. The correction is then applied once the user is back on `logs`.
  - **Sequence test:**
    1. Open the logs with `openLogs(nav, 1000)`.
    2. Push `log-entry`.
    3. Call `syncLogSelection(nav, 0, 4)`: nothing changes and it returns `0`.
    4. `pop()`.
    5. Call `syncLogSelection(nav, 0, 4)`: `selected` goes from 999 to 995, so it still points at the same `seq`.
- [X] T022 [P] [US2] In `tests/integration/resilience.test.ts`, in `describe("recording a fetch outcome")`, use a logger created with `createLogger` in a temp dir, and read it with `entries()`. Tests:
  - Two consecutive `not-found` outcomes for `national` log exactly one `info` entry `Data zatím nejsou zveřejněna` with `source: "national"`.
  - A `failed` outcome in between, followed by `not-found` again, logs it again.
  - Two consecutive `ok` outcomes whose body fails validation with the same reason log exactly one `warn` entry `Dokument odmítnut`. Use the fixture server's malformed or unexpected-shape mode, or an inline body such as `<VYSLEDKY/>`. A body rejected for a different reason logs again. A successful ingest in between, followed by the same rejection, logs it again, because a success clears `lastError`.
  - `failed` outcomes (network, HTTP 5xx) keep logging `warn` `Stahování selhalo` on every occurrence. That case is unchanged (research R5).

### Implementation

- [X] T023 [US2] In `src/ui/navigation.ts`, add `| { kind: "logs" } | { kind: "log-entry"; seq: number }` to `Screen`. Then fix every exhaustive `switch` that `bun run typecheck` flags, as in the tasks below. No `default` fallbacks are added to silence it.
- [X] T024 [US2] Create `src/ui/views/logs.ts` with:
  - `buildLogListRows`, `buildLogEntryRows`, `openLogs` and `syncLogSelection`, as specified in T016 and T021.
  - A private `LEVEL_LABEL: Record<LogLevel, string>` and a private `LEVEL_ROLE`.
  - The same `row.ts` helpers `help.ts` uses (`line`, `blank`, `tableHeader`, `cell`).
  - A file header comment citing 004 FR-009 to FR-014 and research R6, including why long entries open a detail screen rather than wrapping in the list.
  - Makes T016 and T021 pass.
- [X] T025 [US2] In `src/ui/screen.ts`:
  - Add `logEntries?: readonly LogEntry[]` to `ScreenOptions`. Default: `[]`.
  - Add `case "logs"`: `content(rows, width, firstRow, entries.length, (i) => entries[i] ? { kind: "log-entry", seq: entries[i].seq } : null)`.
  - Add `case "log-entry"`: `content(rows, width, 0, 0, () => null)`.
  - In `sourcesForScreen` and `shownSources`, treat both kinds like `help`.
  - Makes T017 pass.
- [X] T026 [US2] In `src/ui/chrome/breadcrumb.ts`, add the segments `Záznamy` / `Záznam`. In `src/ui/components/status.ts` `screenLabel`, add `ZÁZNAMY` / `ZÁZNAM`. Makes T018's breadcrumb and label assertions pass.
- [X] T027 [US2] In `src/ui/palette/actions.ts`:
  - Add `"logs"` to `ActionId`.
  - Add the registry entry right after `search`: `{ id: "logs", label: "Zobrazit záznamy", hint: "záznamy", key: "l", where: "všude", unavailable: (c) => (c.screen.kind === "logs" || c.screen.kind === "log-entry" ? "záznamy jsou právě otevřené" : null) }`.
  - In `src/ui/keymap.ts`, add `case "l": return { kind: "action", id: "logs" }`.
  - Makes T018's help assertion and T019 pass.
- [X] T028 [US2] In `src/ui/chrome/state.ts`:
  - Add `logEntries: readonly LogEntry[]` to `FrameInputs` and pass it to `composeScreen`. Default `[]` at the test call sites updated in T014, or make the field optional with default `[]`.
  - Leave out `sourceStatus` from the status row when `nav.screen.kind` is `logs` or `log-entry`.
  - Makes T020 pass.
- [X] T029 [US2] In `src/ui/app.ts`, glue only. Every decision is in the functions T021 tests, and this task adds no branching logic of its own:
  - **`perform`:** add `case "logs"`:
    - `this.sort = UNSORTED`;
    - `openLogs(this.nav, this.deps.log.entries().length)`;
    - `this.logsDroppedSeen = this.deps.log.dropped`.
  - **Selection correction:** add `private logsDroppedSeen = 0`. At the top of `draw()`, set `this.logsDroppedSeen = syncLogSelection(this.nav, this.logsDroppedSeen, this.deps.log.dropped)`.
  - **Entries to compose:** pass `logEntries: this.deps.log.entries()` in `draw()`, and wherever the key handler composes a screen (`currentContent()`).
  - `Esc` needs no change: it is `back`, which pops one level.
  - **Guard test:** add a structural test to `tests/unit/logs-view.test.ts`, in the style of the "one implementation, not two" test in `tests/ui/palette.test.ts`. It reads `src/ui/app.ts` as text and asserts:
    - it calls `openLogs(` and `syncLogSelection(`;
    - it contains no `nav.push({ kind: "logs" })` of its own.

    This way the glue cannot quietly grow a second implementation. Write the test first and observe it fail.
- [X] T030 [US2] In `src/ui/app.ts` `recordFetch`:
  - At the top of the function, read `const previous = scheduler.get(key)?.lastError ?? null` BEFORE any `recordFailure` call.
  - **`not-found` branch:** call `log.info(NOT_PUBLISHED, { source: key })` only when `previous !== NOT_PUBLISHED`. `NOT_PUBLISHED = "Data zatím nejsou zveřejněna"` is one constant used for both the failure record and the log (Principle I).
  - **Rejected-document branch** (`result.ok === false`): call `log.warn("Dokument odmítnut", …)` only when `previous !== result.reason`.
  - **`failed` branch:** unchanged.
  - Comment the rule once, above `previous`: repeats of an unchanged "no data yet" reason would flood the 1000-entry view before publication, while every network failure still counts (research R5).
  - Makes T022 pass.
- [X] T031 [US2] REVIEW Phase 4 against Principles I–III and contract § 3, § 4, § 6 and § 7. Check that:
  - no screen `switch` gained a `default` fallback;
  - `Esc` from `log-entry` returns to `logs` with its selection, and `Esc` from `logs` returns to the origin screen with its selection and offset;
  - entries are read from the logger, never from the file;
  - `l` typed in the search box and in the palette still reaches the input.

  Run `bun test`, `bun run typecheck` and `bun run check`, then run quickstart § 2 and § 3 by hand. Record the working command for quickstart § 2 in `specs/004-logs-view/quickstart.md`: check whether `--election kv2099` starts, as the plan flagged. Fix every finding before continuing.
  - (Done 2026-09-24. Red first: 17 failures plus the missing `views/logs.ts` module. Two of T022's tests passed at once because they describe behaviour that stays the same, and they remain as guards. After implementation: 964 pass, 0 fail; typecheck and biome clean.
    - **Deviations:** `segmentsFor` is tested in `tests/integration/screen.test.ts`, because it needs a database. `screenLabel` is tested in `tests/unit/context-status.test.ts`, where its table already was.
    - **Run by hand** in a pseudo-terminal (pyte, 100×30) against the replay server with `--election kv2099`:
      - the awaiting row and badge show;
      - `l` opens `ZÁZNAMY` with the newest entry selected;
      - `Enter` shows the full line;
      - `Esc` goes back one level each time;
      - `/` then `brl` types into the query;
      - `l` in the palette filters it without switching screens.
    - **Finding, fixed:** the detail screen put `▶` on its heading, because `firstRow` 0 with no rows let the frame mark line 0. `log-entry` now starts its list past the last row. A test was written first and failed. The help screen has the same pre-existing quirk, which is out of scope and not changed.
    - **Noted, by design:** `lastError` persists across restarts, so a source still unpublished after a restart is not logged again in the new session (R5 compares with the stored reason).
    - **Quickstart § 2:** the `--election kv2099` recipe starts. Reference loading failure is not fatal. The quickstart now says so.)

**Checkpoint**: US1 + US2 together are the MVP. The status row is honest, and `l` shows the detail behind it.

---

## Phase 5: User Story 3 - Copy the selected entry or all entries (Priority: P2)

**Goal**: `c` copies the selected entry's log-file line, and `Shift+C` copies all lines.
Each copy shows a notice with Czech plurals, and a failure never breaks the screen.
Contract § 5 and § 6, research R7.

**Independent Test**: Quickstart § 4.

**Depends on**: Phase 4.

### Tests (write first, observe failing)

- [X] T032 [P] [US3] Create `tests/unit/logs-copy.test.ts` for the functions in `src/ui/views/logs.ts`:
  - **`copyText(entries, "one", seq)`:** gives that entry's `line`. For `"all"` it gives every `line` joined by `\n`, oldest first. It gives `null` when there is nothing to copy: no entries, or a `seq` not present.
  - **`copyNotice(count, sent)`:**
    - `(1, true)` → `Odesláno do schránky: 1 záznam.`;
    - `(3, true)` → `Odesláno do schránky: 3 záznamy.`;
    - `(12, true)` → `Odesláno do schránky: 12 záznamů.`;
    - `(0, …)` → `Není co kopírovat.`;
    - `(n, false)` → `Terminál nepodporuje kopírování do schránky.`
  - The plural comes from `plural` in `src/ui/format.ts`, not a new rule.
- [X] T033 [P] [US3] In `tests/unit/keymap.test.ts`, `describe("shift distinguishes the pairs")`:
  - `c` maps to `copy-entry`;
  - `C` (shift flag, or sequence `"C"`) maps to `copy-all`.

  In `tests/ui/palette.test.ts`:
  - both copy actions are available on `logs` and `log-entry`;
  - elsewhere they are unavailable with the reason `kopírovat lze jen v záznamech`.

  In `tests/ui/help-and-language.test.ts`: the help lists `c` / `Kopírovat vybraný záznam` and `Shift+C` / `Kopírovat všechny záznamy`.
- [X] T034 [P] [US3] Add a status bar test to `tests/unit/context-status.test.ts`. On `logs` at 80 columns with entries, the bar starts with `ZÁZNAMY`, and within the first hints it contains `c kopírovat` and `C vše` before any global hint that follows `back` in the registry. This checks the placement in research R8.

### Implementation

- [X] T035 [US3] In `src/ui/views/logs.ts`, add `copyText` and `copyNotice` as specified in T032. Makes T032 pass.
- [X] T036 [US3] In `src/ui/palette/actions.ts`:
  - Add `"copy-entry" | "copy-all"` to `ActionId`.
  - Add both entries right after `back`:
    - `{ id: "copy-entry", label: "Kopírovat vybraný záznam", hint: "kopírovat", key: "c", where: "záznamy", unavailable: onLogs }`;
    - `{ id: "copy-all", label: "Kopírovat všechny záznamy", hint: "vše", key: "Shift+C", shortKey: "C", where: "záznamy", unavailable: onLogs }`.
    - `onLogs` returns `null` on `logs` / `log-entry`, and `"kopírovat lze jen v záznamech"` elsewhere.
  - Add a comment explaining the placement: they are unavailable everywhere else, so they cost other screens nothing, and on the logs screens they survive a narrow bar.
  - In `src/ui/keymap.ts`, add `case "c": return { kind: "action", id: shift ? "copy-all" : "copy-entry" }`, and extend the shift comment to name `c`/`C`.
  - Makes T033 and T034 pass.
- [X] T037 [P] [US3] In `tests/unit/logs-copy.test.ts`, add `describe("performing a copy (FR-016–FR-019)")` for `performCopy(scope: "one" | "all", screen: Screen, selected: number, entries: readonly LogEntry[], copy: (text: string) => boolean): string`. It returns the notice to show. As in T021, `App` is not driven in tests, so the behaviour lives in this pure function and `App` only calls it (T038). Use a recording `copy` and three entries (`seq` 0 to 2). Tests:
  - On `logs` with `selected === 2`, `"one"` records exactly `entries[2].line` and returns `Odesláno do schránky: 1 záznam.`
  - On `{ kind: "log-entry", seq: 1 }`, `"one"` records `entries[1].line`, whatever `selected` is.
  - `"all"` records the three lines joined by `\n`, oldest first, and returns `Odesláno do schránky: 3 záznamy.`
  - With `entries = []`, or on `log-entry` with a `seq` no longer present, `copy` is NOT called, and the function returns `Není co kopírovat.`
  - A `copy` returning `false` gives `Terminál nepodporuje kopírování do schránky.`
  - A `copy` that throws gives the same refusal notice, and the error does not escape (FR-019).

  Observe it failing (the function does not exist) before T038.
- [X] T038 [US3] Make T037 pass:
  - **In `src/ui/views/logs.ts`:** add `performCopy`, built on `copyText` and `copyNotice` from T035. The seq comes from the screen: `log-entry` uses `screen.seq`; `logs` uses `entries[selected]?.seq`. The `copy` call is wrapped in `try/catch`, which treats a throw as `false`.
  - **In `src/ui/app.ts`, glue only:**
    - Add `copy?: (text: string) => boolean` to `AppDependencies`, documented per data-model.md.
    - Add a private `copyToClipboard = (text: string) => (this.deps.copy ?? ((t) => this.renderer?.copyToClipboardOSC52(t) ?? false))(text)`.
    - In `perform`, `copy-entry` and `copy-all` set `this.notice = performCopy(scope, this.nav.screen, this.nav.current.selected, this.deps.log.entries(), this.copyToClipboard)`.
  - Never log the copied text.
  - Extend T029's structural guard test to assert that `app.ts` calls `performCopy(` and does not call `copyText(` itself.
- [X] T039 [US3] REVIEW Phase 5 against Principles I–III and contract § 5–6. Check that:
  - the copied text is byte-identical to the file line;
  - nothing writes to stdout;
  - a throwing clipboard call is contained.

  Run `bun test`, `bun run typecheck` and `bun run check`, and quickstart § 4 in an OSC 52 terminal. Fix every finding before continuing.
  - (Done 2026-09-24. Red first: 6 failures, including the missing `copyNotice` export. The extended structural guard failed on its own before `app.ts` called `performCopy`. After: 983 pass, 0 fail; typecheck and biome clean.
    - **Run in a pseudo-terminal** against the replay server:
      - `c` emitted one OSC 52 sequence (`ESC ] 52 ; c ; …`) with the selected entry's line, and showed `Odesláno do schránky: 1 záznam.`;
      - `C` emitted all 4 lines and showed `… 4 záznamy.`;
      - decoded, the payloads are byte-identical to the log file (the whole file, and its last line).
    - **The status bar** on `ZÁZNAMY` at 100 columns offers `c kopírovat` and `C vše` right after `Esc zpět`.
    - **Not checked here:** a real system clipboard receiving the text, which depends on the user's terminal. `copyToClipboard` does not catch errors itself; `performCopy` contains a throw, which T037 tests.
    - Findings: none open.)

**Checkpoint**: the log can be copied out with two key presses from any screen.

---

## Phase 6: User Story 4 - The logs view looks like the rest of the application (Priority: P3)

**Goal**: The logs screens are painted from the active theme, repaint on a switch, and
separate severities without colour. Contract § 3, FR-020, SC-005.

**Independent Test**: Quickstart § 5.

**Depends on**: Phase 4.

### Tests (write first, observe failing)

- [X] T040 [P] [US4] In `tests/ui/colour.test.ts`, add `describe("the logs view follows the theme (004 FR-020)")`. It uses the helpers the file already has for other screens (`slot`, `cellsAt`, `expectRun`):
  - For every theme in `THEME_NAMES`, drawing `logs` with one `warn`, one `info` and one `debug` entry gives:
    - the `VAROVÁNÍ` row text on the theme's `warning` slot;
    - the `LADĚNÍ` row on `muted`;
    - the selected row on the theme's selection colours;
    - the content background on the content surface.
  - Switching theme and redrawing repaints every row in the new theme's slots.
  - With the monochrome theme, each label (`VAROVÁNÍ`, `INFO`, `LADĚNÍ`) is still present in the text, and the selection marker `▶` is on the selected row.

  If these pass at once because Phase 4 already built them right, record that in the task notes. They stay as guards.
  - (Done 2026-09-24. All 8 passed at once, as anticipated: Phase 4 already built this right. To prove they can fail, `debug` was mapped to no role in `views/logs.ts`: 6 of 8 failed. The monochrome and theme-switch tests do not depend on that colour, so they kept passing. The code was then restored exactly (empty diff). The theme-switch test is the existing T043 test run on the logs screen.)

### Implementation

- [X] T041 [US4] Fix whatever T040 finds in `src/ui/views/logs.ts` or `src/ui/chrome/state.ts`. No new theme slot or role (research R6). If nothing fails, mark the task done with "no change needed".
  - (No change needed.)
- [X] T042 [US4] REVIEW Phase 6 against Principles I–III. Run quickstart § 5 by hand in at least Tokyo Night, Catppuccin Latte, high contrast and `NO_COLOR=1`. Fix every finding before continuing.
  - (Done 2026-09-24. Ran in a pseudo-terminal with the logs view open, cycling all six themes with `Ctrl+T`:
    - `VAROVÁNÍ` took each theme's warning colour on its background, e.g. Tokyo Night `e0af68/1a1b26` and Latte `8b5812/eff1f5`.
    - The selected row took each theme's `sel`, bold. High contrast reverses it: black on white.
    - Cycling returned to Tokyo Night with identical colours.
    - Under `NO_COLOR=1` there is no background anywhere, and the labels are present.
    - Findings: none.)

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T043 [P] Update `README.md`:
  - In `## The interface`, add a **Logs** (`l`) bullet: what it lists, `Enter` for detail, `c` / `Shift+C` to copy, `Esc` to close, current session only, and the log file for older sessions.
  - Describe the status row's two states: awaiting vs stale.
  - In `### Polling`, replace any wording that says a failure shows its reason on screen.
- [ ] T044 [P] Search `src/` and `tests/` for any remaining `ZASTARALÁ DATA (` pattern, `staleWarning`, `MAX_REASON` or `warning:` field on `FrameInputs`. Remove leftovers; there must be no dead code (Quality Standards).
- [ ] T045 Run quickstart § 6: fill past 1000 entries with `--log-level debug`. Confirm the view opens and scrolls with no visible delay, and that the selection stays on its entry as old entries drop out. Record the result in this task's notes.
- [ ] T046 FINAL REVIEW of the whole branch against Principles I–III, spec FR-001 to FR-022 and SC-001 to SC-006. Every FR must trace to a test named in this file. Run `bun test`, `bun run typecheck` and `bun run check`, and record the counts. Fix every finding.

---

## Dependencies & Execution Order

### Phase dependencies

| Phase | Depends on | Notes |
|---|---|---|
| 1 Setup | none | |
| 2 Foundational | Phase 1 | |
| 3 US1 | Phase 1 only | Can run beside Phase 2 |
| 4 US2 | Phase 2 | T028 edits `state.ts` after T013 (US1) |
| 5 US3 | Phase 4 | Needs the logs screens and entries |
| 6 US4 | Phase 4 | Can run beside Phase 5 |
| 7 Polish | Phases 3–6 | |

### Task dependencies within stories

- **US1:** the tests T007–T011 come before T012, then T013, then T014.
- **US2:**
  - T023 comes first: the `Screen` union unblocks the typecheck.
  - T024, T026 and T027 can then run in parallel.
  - T025 needs T024.
  - T028 needs T025.
  - T029 needs T027 and T028.
  - T030 is independent of the screen work.
- **US3:**
  - The tests T032, T033, T034 and T037 come first.
  - T035 comes next, making T032 pass.
  - T038 needs T035 and makes T037 pass.
  - T036 is independent.

### Shared files (not parallel across these tasks)

| File | Tasks |
|---|---|
| `src/ui/chrome/state.ts` | T013, T028, T041 |
| `src/ui/app.ts` | T014, T029, T030, T038 |
| `src/ui/palette/actions.ts` | T027, T036 |
| `src/ui/keymap.ts` | T027, T036 |
| `src/ui/views/logs.ts` | T024, T035, T038, T041 |
| `tests/unit/logs-view.test.ts` | T016, T021, T029 (guard), T038 (guard extension) |
| `tests/unit/logs-copy.test.ts` | T032, T037 |

## Parallel Examples

**Phase 2 tests together** (the same file, but separate `describe` blocks; if run by
separate agents, merge carefully):

```text
T002, T003, T004  →  tests/unit/logger.test.ts
```

**Phase 3 tests together** (all different files):

```text
T007 tests/unit/status-bar.test.ts
T009 tests/ui/frame.test.ts
T010 tests/integration/resilience.test.ts
T011 tests/ui/colour.test.ts + tests/ui/stability.test.ts
```

**Phase 4 tests together**:

```text
T016 tests/unit/logs-view.test.ts
T017 tests/integration/screen.test.ts
T018 tests/ui/help-and-language.test.ts + tests/unit/breadcrumb.test.ts
T019 tests/unit/keymap.test.ts + tests/ui/palette.test.ts
T022 tests/integration/resilience.test.ts
```

**Across stories**: Phase 2 (logger) and Phase 3 (US1 status) touch disjoint files and
can proceed together. After Phase 4, Phases 5 and 6 can too, except for
`src/ui/views/logs.ts`.

## Implementation Strategy

### MVP (US1 + US2)

1. **Phase 1:** baseline.
2. **Phases 2 and 3 in parallel:** the logger record, and the honest status row.
3. **Phase 4:** `l` works, so the key the status row names is real.

**Stop and validate** with quickstart § 2 and § 3. The MVP is US1 **with** US2. US1 alone
advertises `l`, which does nothing until US2, and a status bar or hint offering a dead
key is what 001 FR-064 forbids. If US1 must ship alone, drop `· l záznamy` from both
texts until US2 lands, and record that in T015.

### Incremental delivery

4. **Phase 5 (US3):** copy.
5. **Phase 6 (US4):** theme guards.
6. **Phase 7:** README, clean-up, final review.

## Notes

- **[P] tasks:** they touch different files and depend on no incomplete task.
- **Red first:** every test task must be seen FAILING before its implementation task
  starts. Record in the task notes when a test passed at once and why (see T040).
- **Commits:** one per task, or per test-then-implementation pair, in the repository's
  Conventional Commits style.
