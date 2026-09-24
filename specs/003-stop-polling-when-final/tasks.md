---

description: "Task list for stopping automatic polling once results are final"
---

# Tasks: Stop Polling When Results Are Final

**Input**: Design documents from `specs/003-stop-polling-when-final/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/interface.md](contracts/interface.md), [quickstart.md](quickstart.md)

**Tests**: REQUIRED. The constitution makes TDD non-negotiable (Principle II), so every
implementation task is preceded by a test task. That test must be observed FAILING before the
implementation is written. Scheduler tests inject `now`, as `tests/integration/scheduler.test.ts`
already does, so no test depends on the wall clock.

**Review**: every task ends with a review against Principles I and II and against
[contracts/interface.md](contracts/interface.md) (Principle III). The phase-ending REVIEW tasks make
this visible. A task is complete only when its review has no open findings.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: The user story the task belongs to (US1 to US3 in spec.md)

---

## Phase 1: Setup

**Purpose**: Establish a green baseline, so every later failure is known to be new.

- [ ] T001 Create and switch to the branch `003-stop-polling-when-final` from `main` (`git switch -c 003-stop-polling-when-final`). Then run `bun test`, `bun run typecheck` and `bun run check` from the repository root. Record the pass counts in this task's notes. Stop and report if anything fails before a change has been made.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The `final` column exists in every database, new or upgraded, and the scheduler can
read it. Every story needs this.

**⚠️ CRITICAL**: no user story work can begin until this phase is complete.

### Tests (write first, observe failing)

- [ ] T002 [P] Add to `tests/integration/schema.test.ts`, in `describe("schema creation")`:
  - A new database has a `final` column on `source_subscription`, declared `INTEGER NOT NULL`, `DEFAULT 0`, `CHECK (final IN (0, 1))`. Read the declaration with `PRAGMA table_info(source_subscription)`.
  - Inserting `final = 2` throws, and inserting a row without `final` stores 0. Add this to `describe("constraints")`.
  - `SCHEMA_VERSION` is `2`.
- [ ] T003 [P] Add `describe("upgrading from schema version 1")` to `tests/integration/schema.test.ts`, using `withTempDataDir` from `tests/helpers/tmpdir.ts`:
  - Build a version-1 database on disk: create the schema, drop the `final` column by recreating `source_subscription` without it, set `schema_version` to `'1'`, and insert one subscription row and one watchlist row. Close it.
  - `openDatabase` on that file does not throw. Afterwards `readSchemaVersion` returns 2, the subscription row has `final = 0`, and the watchlist row is still there.
  - The existing test "refuses to open a database written by a different schema version" (value `'999'`) still passes unchanged.
- [ ] T004 [P] Add to `tests/integration/scheduler.test.ts`, in `describe("subscription lifecycle (FR-018a)")`: a newly subscribed source has `final === false` on the record returned by `scheduler.get`.

### Implementation

- [ ] T005 In `src/storage/schema.ts`:
  - Add `final INTEGER NOT NULL DEFAULT 0 CHECK (final IN (0, 1))` to `source_subscription`, after `pinned`, with a comment citing this feature and research R1.
  - Set `SCHEMA_VERSION = 2`.
  - Export `upgradeSchema(db: Database, from: number): void`. For `from === 1` it runs `ALTER TABLE source_subscription ADD COLUMN final INTEGER NOT NULL DEFAULT 0 CHECK (final IN (0, 1))` and writes `schema_version = '2'`, in one transaction. For any other value it does nothing.
  - Keep the column definition in one constant used by both the `CREATE TABLE` and the `ALTER TABLE`, so it is written once (Principle I).
  - Makes T002 pass.
- [ ] T006 In `src/storage/db.ts`, in `openDatabase`: when `version === 1`, call `upgradeSchema(db, 1)` instead of throwing. Any other mismatch still throws `SchemaVersionError`. Update the comment above the check: one in-place step exists because rebuilding would cost users their watchlist (research R2). Makes T003 pass.
- [ ] T007 In `src/sources/scheduler.ts`, add `final: boolean` to `Subscription`, with a doc comment ("The most recent successfully read copy was final; such a source is not polled automatically."). Map it in `toSubscription` as `Number(row.final ?? 0) === 1`. Makes T004 pass. Then update the `Subscription` literal in `tests/unit/status-bar.test.ts` (line 18 area) with `final: false`, so typecheck passes.
- [ ] T008 REVIEW Phase 2 against Principles I–III and data-model.md. Check that:
  - the column definition exists once,
  - a version-1 database keeps every row,
  - no other version is silently upgraded.

  Run `bun test`, `bun run typecheck` and `bun run check`. Fix every finding before continuing.

**Checkpoint**: every database has the column. Nothing behaves differently yet.

---

## Phase 3: User Story 1 - Final sources stop being polled on their own (Priority: P1) 🎯 MVP

**Goal**: A source read as final is never returned by `due()` again. Sources still in progress keep
their cadence. This survives a restart and is cleared by `--reset` or a dataset change.

**Independent Test**: Quickstart § 2 and § 4. Against the replay harness, `vysledky.xml`, `CZ0100`
and `CZ0642` stop appearing in the replay log once the count reaches 100 %, and they stay absent
after a restart without `--reset`.

### Tests (write first, observe failing)

- [ ] T009 [P] [US1] Add `describe("finality (research R3)")` to `tests/integration/ingest.test.ts`:
  - `ingestNational` on `fixtures/2026/vysledky.xml` returns `ok: true, final: true`.
  - `ingestCouncil(db, "551082", <edge-cases/provisional.xml>)` returns `final: false`, and `edge-cases/final.xml` returns `final: true`.
  - `ingestDistrict` on `fixtures/2026/vysledky_obce_okres_CZ0642.xml` returns `final: true`.
  - The same district document with one `JE_SPOCTENO="true"` replaced by `"false"` returns `final: false`.
  - A national document with one `TYP_ZASTUP` block's `OKRSKY_ZPRAC` lowered below `OKRSKY_CELKEM` returns `final: false`. Only one block is changed, so this proves "every block".
  - A district document whose only `OBEC` has no `VYSLEDEK` returns `final: false` (spec edge case: a council with no result).
  - Build the variant documents by string replacement on the fixtures inside the test, not as new fixture files.
- [ ] T010 [P] [US1] Add `describe("final sources (FR-001, FR-003)")` to `tests/integration/scheduler.test.ts`, using the existing `T0` and `at(seconds)` helpers:
  - After `recordSuccess("national", {}, T0, true)`, `get("national")` has `final === true` and `nextDueAt === null`, and `due(at(3600))` does not contain `national`.
  - After `recordSuccess("national", {}, T0, false)`, the source is due again at `at(60)`, exactly as today.
  - `recordSuccess` without the `final` argument (a `304`) keeps the stored value, both when it was `true` and when it was `false`.
  - With 79 sources from `liveSources(79)`, record the due times of all but one. Mark that one final. Every other source's `nextDueAt` is unchanged (FR-003, SC-006).
  - `recordFailure` on a source that is final increments `consecutiveFailures` and leaves `nextDueAt === null`.
  - `recordFailure` on a source that is not final still applies backoff (existing behaviour, asserted to guard it).
  - A row with `next_due_at IS NULL AND final = 0`, inserted by hand, is not returned by `due()`. The `IS NULL` branch is gone (research R4).
- [ ] T011 [P] [US1] Add `describe("releasing councils (research R5)")` to `tests/integration/scheduler.test.ts`, for a new `Scheduler.releaseCouncils(needed: Set<SourceKey>)`:
  - A council not in `needed`, not pinned and not final is removed.
  - A council not in `needed` that is final is kept.
  - A pinned council is kept, as today.
  - `national` and `district:*` rows are never removed, whatever `needed` holds.
- [ ] T012 [P] [US1] Add to `tests/integration/dataset.test.ts`:
  - In `describe("across a real restart")`: a subscription recorded final on a database on disk is still `final` with `nextDueAt === null` after closing and reopening with `openDatabase`, and `due()` does not return it (FR-006, SC-003).
  - In `describe("--reset clears the same source deliberately")`: after `resetData`, no subscription row remains, so the source starts polled when re-subscribed (FR-007).
  - In `describe("switching source clears what belonged to the old one")`: the same after `adoptDataset` with a different base URL.
- [ ] T013 [P] [US1] Add `describe("recording a fetch outcome")` to `tests/integration/resilience.test.ts`, for a new exported `recordFetch(db, scheduler, key, outcome)` in `src/ui/app.ts`:
  - An `ok` outcome with a final national body leaves `national` final and unscheduled.
  - An `ok` outcome with a body that fails validation records a failure and leaves `final` as it was.
  - A `not-modified` outcome keeps `final` as it was.
  - A `not-found` outcome and an `error` outcome record failures with the existing reasons ("Data zatím nejsou zveřejněna" and the outcome's reason).
  - Construct outcomes as literals of the type `fetchDocument` returns. No server is needed.

- [ ] T014 [P] [US2] Add `describe("manual refresh of a final source (FR-004, FR-005)")` to `tests/integration/scheduler.test.ts`. It belongs to US2, but it sits here because T016 implements this behaviour. Written any later, it could never be seen failing (Principle II).
  - A source recorded final at `T0`: `requestRefresh("national", at(30))` returns `false` and `due(at(30))` is empty. `requestRefresh("national", at(60))` returns `true`, and `due(at(60))` contains exactly `national` (SC-004).
  - After that request, `recordSuccess(..., at(61), true)` leaves it final, `nextDueAt === null`, and absent from `due(at(3600))`.
  - After that request, a `304` (`recordSuccess` without `final`) leaves it final and unscheduled.
  - After that request, `recordFailure` leaves it final and unscheduled.
  - After that request, `recordSuccess(..., at(61), false)` sets `final === false` and makes it due again at `at(121)` (FR-005).

### Implementation

- [ ] T015 [US1] In `src/sources/ingest.ts`:
  - Add `final: boolean` to the `ok: true` branch of `IngestResult`, with a doc comment citing research R3.
  - Add one private helper, `allFinal(snapshots: { isFinal: boolean }[]): boolean`, which returns `snapshots.length > 0 && snapshots.every((s) => s.isFinal)`. Comment why the length check exists: `[].every` is `true`.
  - In `ingestNational`, build the snapshot inputs first. Then `final: allFinal(inputs)`.
  - In `ingestDistrict` and `ingestCouncil`, collect the `obecToSnapshot` results and use the same helper.
  - `determineStatus` stays the only place that decides a single area's finality.
  - Makes T009 pass.
- [ ] T016 [US1] In `src/sources/scheduler.ts`:
  - `recordSuccess(key, validators = {}, now = new Date(), final?: boolean)`. SQL: `final = COALESCE($final, final)`, and `next_due_at = CASE WHEN COALESCE($final, final) = 1 THEN NULL ELSE $due END`. Pass `$final` as `null` when the argument is omitted, else `1` or `0`.
  - `recordFailure`: `next_due_at = CASE WHEN final = 1 THEN NULL ELSE $due END`.
  - `due()`: `WHERE next_due_at <= $now ORDER BY next_due_at ASC`. Remove the `IS NULL` condition and its `ORDER BY` term.
  - Add `releaseCouncils(needed: Set<SourceKey>)`, which deletes `council` rows not in `needed` with `pinned = 0 AND final = 0`.
  - Update the doc comments of `recordSuccess` (a `304` keeps finality), `recordFailure` (a final source is not rescheduled) and `due()` (a `NULL` due time means nothing is scheduled).
  - Leave `requestRefresh` and `canRefreshNow` unchanged.
  - Makes T010, T011 and T014 pass.
- [ ] T017 [US1] In `src/ui/app.ts`:
  - Extract the outcome handling of `tick()` into an exported module-level function, `recordFetch(db: Database, scheduler: Scheduler, key: SourceKey, outcome, log?)`, with behaviour unchanged except that a successful ingest passes `result.final` to `recordSuccess`. `tick()` calls it.
  - Replace the unsubscribe loop at the end of `syncSubscriptions` with `scheduler.releaseCouncils(needed)`.
  - Makes T013 pass, and T012 with T016.
- [ ] T018 [US1] REVIEW Phase 3 against Principles I–III, research R3–R5 and data-model.md § Validation rules. In particular, check that:
  - no path other than `requestRefresh` gives a final source a due time,
  - `final` is written only on a `200`,
  - `determineStatus` is not duplicated.

  Run the full suite, typecheck and lint. Then run quickstart § 2 and § 4 against the replay harness, and record what the replay log showed. Fix every finding before continuing.

**Checkpoint**: MVP. The application stops requesting final data by itself.

---

## Phase 4: User Story 2 - Manual refresh still works on final data (Priority: P2)

**Goal**: `r` fetches a final source once, subject to the 60-second floor. A result that is still
final keeps it stopped. A result that is no longer final resumes automatic polling.

**Independent Test**: Quickstart § 3. With a final screen, `r` produces exactly one request in the
replay log, a second `r` within 60 s produces none, and nothing is requested automatically afterwards.

This story's scheduler tests (T014) and the implementation (T016) are in Phase 3, so that each test
is seen failing before its code. What stays here is the check end to end.

### Validation

- [ ] T019 [US2] Confirm that `refreshNow()` in `src/ui/app.ts` still calls `requestRefresh` for every source of the screen and for `national`, and then `tick()`. With `bun run dev` against the replay harness, run quickstart § 3 and record what the replay log showed. If it disagrees with T014, fix it in `src/sources/scheduler.ts` within the rules of research R4. Write the reproducing test first, and record the cause here.
- [ ] T020 [US2] REVIEW Phase 4 against Principles I–III. Check that the 60-second floor covers manual refreshes of final sources. Run the full suite, and quickstart § 3 against the replay harness. Fix every finding before continuing.

**Checkpoint**: users keep full manual control over final data.

---

## Phase 5: User Story 3 - The user can see that polling has stopped (Priority: P3)

**Goal**: The title bar says `■ konečné · obnova ručně` when every source on screen is final, and the
stale warning never fires for final sources.

**Independent Test**: Quickstart § 2, last paragraph. On a final national screen the title bar shows
`konečné · obnova ručně`, with `NO_COLOR` too, and no `ZASTARALÉ` badge appears however long it is
left.

### Tests (write first, observe failing)

- [ ] T021 [P] [US3] Add `describe("sources shown on a screen (contract § 2)")` to `tests/integration/screen.test.ts`, for a new `shownSources(screen: Screen, watched: string[], districts: string[]): SourceKey[]` in `src/ui/screen.ts`:
  - `national`, `search` and `help` return `["national"]`.
  - `districts` returns every `district:<nuts>` from `districts`.
  - `district` returns `district:<nuts>`.
  - `council` and `candidates` return `council:<kodzastup>`.
  - `watchlist` returns `council:<code>` for each watched code, or `["national"]` when `watched` is empty.
- [ ] T022 [P] [US3] Add to `tests/unit/status-bar.test.ts`:
  - `describe("finality indicator")` for a new `allFinal(subscriptions: Subscription[], keys: SourceKey[]): boolean` in `src/ui/components/status.ts`. It is true when every key has a subscription with `final === true`. It is false when any key is missing, when any is not final, and for an empty `keys`.
  - In `describe("staleWarning (FR-044)")`: a failing subscription with `final: true` produces no warning (FR-009). A failing subscription that is not final, next to a final one, still produces the existing warning text, and counts only the non-final one in its scope.
- [ ] T023 [P] [US3] Add to `tests/ui/frame.test.ts`, calling `titleBarRow` from `src/ui/chrome/state.ts` directly and reading the plain text of its cells:
  - With indicator `"final"`, the row contains ` ■ konečné · obnova ručně ` and not `živě`.
  - With `"live"`, it contains ` ● živě `.
  - With `"stale"`, it contains ` ● ZASTARALÉ `.
  - At width 80 with a four-segment trail and a clock, the row is exactly 80 columns wide (`cellsWide`) and the indicator is intact.
  - The `"final"` indicator's cell has role `muted` and no surface.

### Implementation

- [ ] T024 [US3] In `src/ui/screen.ts`, add `shownSources` beside `sourcesForScreen`, with a doc comment citing contract § 2. It reuses `sourcesForScreen` for `district`, `council` and `candidates` rather than restating their keys. Makes T021 pass.
- [ ] T025 [US3] In `src/ui/components/status.ts`, add `allFinal`. In `staleWarning`, filter to `consecutiveFailures > 0 && !s.final`, and add a one-line comment citing FR-009 and research R6. Makes T022 pass.
- [ ] T026 [US3] In `src/ui/chrome/state.ts`:
  - Replace `titleBarRow`'s `stale: boolean` parameter with `indicator: "live" | "final" | "stale"`. The cells: `stale` is unchanged, `live` is unchanged, and `final` is `{ text: " ■ konečné · obnova ručně ", role: "muted" }`.
  - Add `final?: boolean` to the frame inputs, beside `lastSuccessAt`, with a doc comment. In `frameState`, choose the indicator in the order stale > final > live.
  - Update the `titleBarRow` doc comment.
  - Makes T023 pass.
- [ ] T027 [US3] In `src/ui/app.ts`, in `draw()`, pass `final: allFinal(subscriptions, shownSources(this.nav.screen, watchedCodes(db), districtCodes))`. Load `districtCodes` once in `start()`, from the query `subscribeDistricts` already runs, and share it with that method rather than querying twice. Check by hand, with `bun run dev` against the replay harness, that the national screen switches to `konečné · obnova ručně` once the count completes, and with `NO_COLOR=1` too.
- [ ] T028 [US3] REVIEW Phase 5 against Principles I–III and contract §§ 2–4. Check that:
  - the indicator's text carries the whole meaning without colour,
  - every screen still fits 80 × 24,
  - `allFinal` in `status.ts` and the private `allFinal` in `ingest.ts` do not duplicate knowledge, since they work on different inputs; if the reviewer judges otherwise, rename one and record the reason.

  Run the full suite. Fix every finding before continuing.

**Checkpoint**: the behaviour is visible and never looks like a fault.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T029 [P] Update the "Polling" section of `README.md` with the text in contract § 5. Leave every other section unchanged.
- [ ] T030 [P] Run quickstart § 6 by hand: start the new build against a data directory written by `main` (build `main` first, run it once, then check out the feature branch). Confirm it opens without asking for the database to be deleted, and that the watchlist and theme are still there. Record the result here.
- [ ] T031 Run every section of [quickstart.md](quickstart.md), plus `bun test`, `bun run typecheck` and `bun run check`. Map each success criterion SC-001 to SC-006 to the test or quickstart step that proves it, and record the mapping in this task's notes.
- [ ] T032 FINAL REVIEW of the whole change against the constitution, the spec's FR-001 to FR-011 and the contract. Confirm that:
  - every test was observed failing before its code,
  - no dead code or commented-out code remains,
  - no em dash appears in code, comments or commit messages.

  Fix every finding, then re-run the suite.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (1)** → **Foundational (2)** → **US1 (3)** → **US2 (4)** and **US3 (5)** → **Polish (6)**.
- **US2** depends on US1: its tests (T014) and the scheduler change (T016) are in Phase 3. Phase 4 only validates them end to end.
- **US3** depends on Phase 2 only for `Subscription.final`. It can be built in parallel with US1, but
  its end-to-end check (T027) needs US1 to be done.

### Within each phase

- Tests before implementation, and each test observed failing.
- T014 (with T010 and T011) before T016, which it tests.
- T015 before T017, because `recordFetch` reads `result.final`.
- T016 before T017, because `recordFetch` passes `final` and `releaseCouncils` must exist.
- T024 and T025 before T027.

### Parallel opportunities

```text
# Phase 2 tests together:
T002 T003 tests/integration/schema.test.ts   (same file: write in sequence)
T004      tests/integration/scheduler.test.ts

# US1 tests together:
T009 tests/integration/ingest.test.ts
T010 T011 T014 tests/integration/scheduler.test.ts   (same file: write in sequence)
T012 tests/integration/dataset.test.ts
T013 tests/integration/resilience.test.ts

# US3 tests together:
T021 tests/integration/screen.test.ts
T022 tests/unit/status-bar.test.ts
T023 tests/ui/frame.test.ts

# Polish:
T029 README.md
T030 manual upgrade check
```

Tasks marked [P] are parallel only against tasks in other files. Tasks in the same file must be
serialised.

---

## Implementation Strategy

### MVP first

1. Phase 1 and Phase 2: the column exists, and old databases are upgraded.
2. Phase 3 (US1): final sources stop being polled. **Stop and validate** with quickstart § 2 and § 4.
3. This alone delivers what was asked: the servers are no longer hammered for final data.

### Incremental delivery

1. Phase 4 (US2): checks end to end that manual refresh is intact. Its tests and code landed in Phase 3.
2. Phase 5 (US3): the title bar says so, and the stale warning stays quiet.
3. Phase 6: README, upgrade check, final review.

## Notes

- Commit after each task or logical group, with the attribution lines the repository uses.
- Never use an em dash in code, comments, commit messages or file names (organisation rule). Use a
  plain hyphen in code.
