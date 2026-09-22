# Tasks: Election Results TUI

**Input**: Design documents from `/specs/001-election-results-tui/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: **MANDATORY, not optional.** Constitution Principle II makes Test-Driven Development
non-negotiable: a failing test must exist and be observed failing before the corresponding implementation
code is written. Every task labelled `[TDD]` below means exactly that – write the test, watch it fail, then
implement only enough to make it pass.

**Organization**: Tasks are grouped by user story so each story can be implemented, tested, and demonstrated
independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[TDD]**: Write the failing test first, then the implementation, in this one task
- **[Story]**: Which user story the task serves (US1–US6)
- Exact file paths are given in every task

## Constitution obligations that apply to every task

These come from [.specify/memory/constitution.md](../../.specify/memory/constitution.md) and are not
repeated in each task description:

1. **Principle II** – No production code without a failing test observed first. Bug fixes start with a
   reproducing test.
2. **Principle III** – A task is complete only when its code has been reviewed and every finding is
   resolved. Review checks correctness, test coverage, and compliance with Principles I and II.
   Phase-ending `REVIEW` tasks make this visible, but review applies per task, not only per phase.
3. **Principle I** – No abstraction until two concrete use cases exist. No duplicated knowledge.

## Path conventions

Single project at repository root: `src/`, `tests/`, `fixtures/`, `tools/`. Full layout in
[plan.md](./plan.md#source-code-repository-root).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Make the project buildable and prove the riskiest assumption before anything depends on it.

- [X] T001 Initialize Bun project at repository root: create `package.json` (name `volby-kv2026`, `type: "module"`, `private: true`) and `tsconfig.json` with `strict: true`, `moduleResolution: "bundler"`, target ES2022
- [X] T002 Add pinned runtime dependencies to `package.json`: `@opentui/core@0.5.11`, `fast-xml-parser@5.11.1`, `zod@4.6.5`, `fflate@0.8.3`, then run `bun install`
- [X] T003 [P] Configure Biome v2.5.14 in `biome.json` (formatter + linter, 2-space indent, 110 column width) and add `check` / `format` scripts to `package.json`
- [X] T004 [P] Create the directory skeleton from plan.md: `src/{config,sources,parsing,reference,storage,domain,ui,export,logging}/`, `tests/{unit,integration,ui,contract}/`, `fixtures/{2026,edge-cases}/`, `tools/replay/`, each with a `.gitkeep`
- [X] T005 Add build scripts to `package.json`: `build:win` → `bun build --compile --target=bun-windows-x64 --minify src/main.ts --outfile dist/volby-kv2026.exe` (**`--bytecode` removed: it cannot compile top-level await, which OpenTUI's bundle uses - research R2a**); `build:linux` → same with `--target=bun-linux-x64` plus `--define process.env.OPENTUI_LIBC='"glibc"'` (research R2 – without the define the build demands both glibc and musl native packages)
- [X] T006 **CRITICAL SMOKE TEST** – write `src/main.ts` as a stub that opens a `bun:sqlite` database, writes and reads one row, imports `@opentui/core`, prints the version, and exits. Compile with `build:win` and run the resulting binary. This resolves the one high-severity open risk in research R3: `bun:sqlite` is documented as a built-in but has **not** been verified inside a compiled binary. **Do not proceed to T007 until this passes.**
- [X] T007 Create `.github/workflows/build.yml` with a matrix over `windows-latest` and `ubuntu-latest`, each installing Bun, running `bun install`, `bun run check`, `bun test`, and its own platform build, then uploading the binary as an artifact
- [X] T008 [P] Add a `test` script to `package.json` and a `tests/helpers/tmpdir.ts` utility that creates and cleans an isolated temporary data directory per test, so tests never touch the real per-user location
- [X] T009 **REVIEW** Phase 1: verify the smoke test genuinely exercised SQLite inside the binary, that build scripts match research R1/R2, and that no dependency was added beyond the four in T002

**Checkpoint**: The project builds to a running single binary on Windows, CI is wired, and the storage
assumption is proven rather than assumed.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Fixtures, storage, parsing, and fetching that every user story needs.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete. Fixtures come first because
Principle II forbids writing implementation code without a failing test, and the live 2026 sources do not
exist until 9 October 2026 (research R9).

### Fixtures and the replay harness

- [X] T010 [P] Download the 2022 municipal election data and save raw samples under `fixtures/source-2022/` for reference: one national result, two district results, and five council results including Prague and Brno. Record the retrieval date and source URLs in `fixtures/README.md`
- [X] T011 Derive `fixtures/2026/vysledky.xml` (national) from the 2022 sample, reshaped to the 2026 static-file structure. **The 2026 schema is authoritative wherever the two differ** (research R9) – 2022 used query-parameter endpoints, not the same delivery
- [X] T012 [P] Derive `fixtures/2026/vysledky_obce_okres_CZ0100.xml` and `..._CZ0642.xml` (Prague and a Moravian district) covering a district with boroughs and one without
- [X] T013 [P] Derive `fixtures/2026/vysledky_obec_*.xml` for five councils: a village, a statutory city, a Prague borough, one with a coalition, and one with an independents' association
- [X] T014 [P] Assemble `fixtures/2026/reg.zip` and `fixtures/2026/ciselniky.zip` containing `KVRZCOCO`, `KVROS`, `KVROS_SLOZENI`, `KVRK` and `CNUMNUTS`, `CNS`, `CPP`, `CVS`, `CVS_SLOZENI`, `KVDRUHZ`, `KVTYPZAS`, `KV_COCO`, scoped to the municipalities in T011–T013
- [X] T015 [P] Hand-write `fixtures/edge-cases/` for conditions real 2022 data will not contain: `malformed.xml` (broken markup), `truncated.xml` (cut mid-document), `annulled.xml` (`STAV_OBCE` marking no election held), `unfilled-seats.xml` (seats unallocated), `republished-changed.xml` (same area, newer timestamp, different figures), `provisional.xml` and `final.xml` (partial vs complete count)
- [X] T016 Build the replay harness in `tools/replay/server.ts`: serves `fixtures/2026/` over HTTP on a configurable port, advancing through a timed sequence of snapshots so a count can be rehearsed in minutes. Supports a `--fail-after` flag to simulate the source going away (needed by US3)

### Configuration and logging

- [X] T017 [TDD] Implement CLI argument parsing in `src/config/args.ts` using `util.parseArgs`, per [contracts/cli.md](./contracts/cli.md). Tests in `tests/unit/args.test.ts` must cover: `--interval 1` is **clamped to 60 and reported on stderr, not rejected**; `--date` must match `^\d{8}$` and be a real calendar date or exit 1; unknown options exit 1 and are never silently ignored
- [X] T018 [TDD] Implement per-user path resolution in `src/config/paths.ts` (`%APPDATA%` on Windows, XDG variables on Linux, overridable by `--data-dir` then `VOLBY_DATA_DIR` in that precedence), with tests in `tests/unit/paths.test.ts` (FR-047)
- [X] T019 [TDD] Implement a file logger in `src/logging/logger.ts` honouring `--log-level` (`error|warn|info|debug`), writing to the per-user log path. Must never write to stdout or stderr while the TUI owns the terminal (FR-030)

### Storage

- [X] T020 [TDD] Create the database schema in `src/storage/schema.ts` for the **reference** tables per [data-model.md](./data-model.md): `region`, `district`, `municipality`, `council`, `council_type`, `council_class`, `political_party`, `political_affiliation`, `electoral_party`, `electoral_party_composition`, `candidate`. Every name column has a paired `name_folded` column. `electoral_party.name` holds up to 2000 characters. Tests in `tests/integration/schema.test.ts`
- [X] T021 [TDD] Create the **result** tables in `src/storage/schema.ts`: `result_snapshot`, `party_result`, `candidate_result`. Enforce in storage that **at most two rows exist per `(area_kind, area_id)`** – one `is_current = 1` and one prior – so the no-history decision (FR-036a) cannot be violated by application code
- [X] T022 [TDD] Create the **local state** tables in `src/storage/schema.ts`: `source_subscription`, `watchlist_entry`, `app_config`. `source_subscription` holds `last_success_at`, `last_attempt_at`, `last_error`, `consecutive_failures`, `next_due_at`, `etag`, `last_modified`
- [X] T023 [P] Add the indexes listed in data-model.md to `src/storage/schema.ts`: `council(obec)`, `council(parent_kodzastup)`, `council(name_folded)`, `municipality(name_folded)`, `candidate(kodzastup, ostrana)`, `candidate(name_folded)`, `result_snapshot(area_kind, area_id, is_current)`, `source_subscription(next_due_at)`
- [X] T024 [TDD] Implement database opening in `src/storage/db.ts` with `strict: true` and `PRAGMA journal_mode = WAL`, plus a test in `tests/integration/concurrent.test.ts` proving two connections against one file do not corrupt data (FR-048)
- [X] T025 [TDD] Implement snapshot write in `src/storage/snapshots.ts`: one transaction per document, demoting the current row to prior and deleting any older row. **An identical re-fetch must not consume the prior row**, otherwise a no-op refresh would wipe the change highlight required by FR-036. Test that case explicitly

### Parsing and validation

- [X] T026 [TDD] Wrap `fast-xml-parser` in `src/parsing/xml.ts` configured with `ignoreAttributes: false` – the source carries most data in attributes such as `CIS_OBEC`, `OZNAC_TYPU`, `PORADI_ZPRAC`. Test against `fixtures/2026/vysledky.xml`
- [X] T027 [TDD] Write the Zod schema for the national result in `src/parsing/schemas/national.ts`. Numeric fields are **explicitly coerced in the schema**, so a malformed number fails validation instead of silently becoming a string (research R4). Unknown fields are ignored; missing required fields are fatal to the document
- [X] T028 [P] [TDD] Write the Zod schema for the district result in `src/parsing/schemas/district.ts`, including `OZNAC_TYPU` distinguishing `OBEC` from `MCMO`
- [X] T029 [P] [TDD] Write the Zod schema for the council result in `src/parsing/schemas/council.ts`, including per-party votes and per-candidate `POCHLASU` / `MANDAT`
- [X] T030 [P] [TDD] Write Zod schemas for the registry documents in `src/parsing/schemas/registry.ts`: `KVRZCOCO`, `KVROS`, `KVROS_SLOZENI`, `KVRK`
- [X] T031 [P] [TDD] Write Zod schemas for the code lists in `src/parsing/schemas/codelists.ts`: `CNUMNUTS`, `CNS`, `CPP`, `CVS`, `CVS_SLOZENI`, `KVDRUHZ`, `KVTYPZAS`, `KV_COCO`
- [X] T032 [TDD] Implement the parse-and-validate pipeline in `src/parsing/pipeline.ts` returning a discriminated result (valid document or rejection reason). Test with `fixtures/edge-cases/malformed.xml` and `truncated.xml` that **the document is rejected whole** and no partial figures escape (FR-025)

### Reference data loading

- [X] T033 [TDD] Implement ZIP extraction in `src/reference/archive.ts` using `fflate`, tested against `fixtures/2026/reg.zip`
- [X] T034 [TDD] Implement the first-run reference loader in `src/reference/loader.ts`: download, extract, validate, and store all registries and code lists in one transaction. Populate every `name_folded` column during load
- [X] T035 [TDD] Implement reference reuse in `src/reference/loader.ts`: on later runs read from storage and **retrieve nothing**, re-retrieving only when the stored copy is absent or unusable or `--refresh-reference` is passed (FR-020a, SC-014). Test asserts zero requests on a second run
- [X] T036 [TDD] Implement graceful degradation in `src/reference/resolve.ts`: when reference data is missing, results still display using numeric codes plus a warning, and a council or party absent from reference data is shown with its code and a note rather than dropped (FR-011 edge cases)

### Domain utilities

- [X] T037 [P] [TDD] Implement diacritic folding in `src/domain/folding.ts`: `normalize("NFD")`, strip combining marks, `toLocaleLowerCase("cs")`. Test that `Ricany`, `Říčany`, `ŘÍČANY` and `ricany` all fold identically (FR-038, research R6 – no dependency needed)
- [ ] T038 [P] [TDD] Implement provisional/final determination and change detection in `src/domain/status.ts`: `is_final` is `districts_counted === districts_total`; changes are computed by comparing current to prior snapshot. **`turnout_pct` is stored as published and never recomputed** (FR-029)

### Fetching

- [ ] T039 [TDD] Implement source URL construction in `src/sources/urls.ts` from `--base-url`, `--election`, `--date` per [contracts/data-sources.md](./contracts/data-sources.md). Must support `file://` so fixture-driven tests need no network. **Must not be able to construct a batch source URL** – FR-012 excludes `vysledky_okrsky_*`, `vysledky_obce_*` and their latest-batch aliases
- [ ] T040 [TDD] Implement the fetch client in `src/sources/client.ts` using built-in `fetch`: sends a descriptive `User-Agent` (FR-024) and conditional `If-None-Match` / `If-Modified-Since` from stored validators, with a bounded per-request timeout. Handles `200`, `304`, `404`, `5xx`, timeout and DNS failure as distinct outcomes (FR-023)
- [ ] T041 **REVIEW** Phase 2: verify every parser rejects rather than partially accepts, that the two-row snapshot constraint is enforced in storage rather than by convention, that no batch source can be reached, and that no test depends on network access

**Checkpoint**: Fixtures, storage, parsing, validation, and fetching all work and are covered by tests.
User stories can now begin.

---

## Phase 3: User Story 1 - Watch the national count come in (Priority: P1) 🎯 MVP

**Goal**: A live, self-updating national overview showing turnout, count progress, and seats per electoral
party, with its publication timestamp and a provisional marker.

**Independent Test**: Run against the replay harness and confirm the overview populates, updates without
user action as the harness advances, and that the completion percentage and timestamp advance with it.

- [ ] T042 [US1] [TDD] Implement the polling scheduler in `src/sources/scheduler.ts`. **Hard invariant: `next_due_at - last_attempt_at >= 60s` per source, always** (FR-016). Sources are spread across the polling window rather than fired together (research R8). A manual refresh (FR-019) is subject to the same floor. Test asserts no source is requested twice within 60 s across a simulated 5-minute run
- [ ] T043 [US1] [TDD] Implement the national source subscription in `src/sources/national.ts`: fetch, parse, validate, store snapshot, update subscription record
- [ ] T044 [P] [US1] [TDD] Implement national overview queries in `src/storage/queries/national.ts`: current snapshot with party results joined to electoral party names, ordered by seats then votes
- [ ] T045 [US1] Create the OpenTUI application shell in `src/ui/app.ts`: renderer setup, root layout, footer with key hints, `q` to quit restoring the terminal (FR-006), `SIGINT`/`SIGTERM` handling
- [ ] T046 [US1] [TDD] Implement the national overview view in `src/ui/views/national.ts` showing turnout, districts counted of total, and the seats table. Test with `createTestRenderer()` from `@opentui/core/testing` and assert on `captureCharFrame()` output
- [ ] T047 [US1] [TDD] Implement the header status bar in `src/ui/components/status.ts` showing the **publisher's** generation timestamp as "last updated" (never local time) and a provisional-versus-final marker (FR-021, FR-022, data-model clock-skew edge case)
- [ ] T048 [US1] [TDD] Implement change highlighting in `src/ui/components/table.ts`: values differing from the prior snapshot are marked. **The marker must be a symbol or text as well as a colour**, so it survives a monochrome terminal and `NO_COLOR` (FR-036, FR-040)
- [ ] T049 [US1] Wire the background refresh loop into `src/ui/app.ts` so the view re-renders when new data lands, without blocking input. One document at a time through parse-validate-store, yielding between documents (research R8, SC-010)
- [ ] T050 [US1] [TDD] Implement the minimum terminal size guard in `src/ui/app.ts`: below 80×24 render a single message stating the requirement and current size and keep running; reflow on resize (FR-041)
- [ ] T051 [US1] Run quickstart scenario **V2** end to end against the replay harness and record the result
- [ ] T052 **REVIEW** User Story 1: verify the 60-second floor cannot be bypassed by any path including manual refresh, that timestamps come from the publisher, and that nothing is conveyed by colour alone

**Checkpoint**: MVP. A working live national dashboard, independently demonstrable.

---

## Phase 4: User Story 2 - Drill down from country to district to council (Priority: P2)

**Goal**: Navigate national → district → council → party → candidates, with boroughs presented separately.

**Independent Test**: From the national view, open a named district then a named council and verify parties,
votes, seats, and elected candidates match the fixture data.

- [ ] T053 [US2] [TDD] Implement background prefetch of all 77 district sources in `src/sources/districts.ts`, started at launch and refreshed on schedule (FR-018). Must yield between documents so the interface stays responsive
- [ ] T054 [P] [US2] [TDD] Implement on-demand council fetching in `src/sources/councils.ts`: retrieved when opened, refreshed only while on screen or watched. **Must never poll all councils** (FR-018a) – test asserts an idle application with nothing open polls only the 78 national and district sources
- [ ] T055 [P] [US2] [TDD] Implement district queries in `src/storage/queries/district.ts`: municipalities of a district with turnout, count progress, and seat totals
- [ ] T056 [P] [US2] [TDD] Implement council queries in `src/storage/queries/council.ts`: electoral parties with votes, vote share, and seats; candidates by party with ballot position, personal votes, and elected status
- [ ] T057 [US2] [TDD] Implement borough grouping in `src/domain/councils.ts` using `parent_kodzastup`, so a subdivided municipality presents each council separately and attributed to its parent (FR-035)
- [ ] T058 [US2] [TDD] Implement the district view in `src/ui/views/district.ts` with a scrollable municipality list that stays responsive in the largest districts (edge case: hundreds of municipalities)
- [ ] T059 [P] [US2] [TDD] Implement the council view in `src/ui/views/council.ts` showing per-party votes, share, and seats
- [ ] T060 [P] [US2] [TDD] Implement the candidate view in `src/ui/views/candidates.ts` listing ballot position, personal votes, and elected status (FR-034)
- [ ] T061 [US2] [TDD] Implement navigation state in `src/ui/navigation.ts`: `Enter` descends, `Esc`/`Backspace` ascends, and **a refresh while a view is open preserves the user's position** (US2 acceptance scenario 5)
- [ ] T062 [P] [US2] [TDD] Implement column sorting in `src/ui/components/table.ts` via `s` (FR-037). Where the source reports a tie, **preserve source order rather than inventing one** (FR-029, edge case: ties)
- [ ] T063 [US2] [TDD] Implement explicit status display for councils with no result in `src/ui/views/council.ts` – election not held or annulled shows that status, **never zero votes** (edge case: councils with no result)
- [ ] T064 [US2] [TDD] Implement the FR-013 boundary message in `src/ui/views/council.ts`: where a user would expect per-polling-district detail, state that this level is not available because it is published only in batch form, rather than showing an empty view
- [ ] T065 [US2] [TDD] Implement progressive availability in `src/ui/views/district.ts`: districts not yet retrieved are marked as still loading rather than blocking the interface (FR-018b)
- [ ] T066 [US2] Run quickstart scenario **V3** end to end and record the result
- [ ] T067 **REVIEW** User Story 2: verify councils are never bulk-polled, that ties and no-result councils are not misrepresented, and that the FR-013 boundary is visible to a user

**Checkpoint**: Full drill-down works alongside the national overview.

---

## Phase 5: User Story 3 - Survive a hostile network (Priority: P2)

**Goal**: Keep the last good data on screen, warn clearly, back off, and recover unattended.

**Independent Test**: Stop the replay harness mid-run and confirm results stay visible with a staleness
warning, retries slow down, and refreshing resumes by itself when the harness restarts.

- [ ] T068 [US3] [TDD] Implement progressive backoff in `src/sources/backoff.ts`: interval grows with consecutive failures up to a ceiling, one success resets it, and **it never drops below the 60-second floor** (FR-043). Test with a simulated failure sequence
- [ ] T069 [US3] [TDD] Implement last-good-data retention in `src/sources/scheduler.ts`: a failed fetch or a rejected document leaves the previous snapshot untouched (FR-027)
- [ ] T070 [P] [US3] [TDD] Implement the staleness indicator in `src/ui/components/status.ts`: persistent, stating the reason and the **age computed from the publisher timestamp**, clearing automatically on the next success (FR-044)
- [ ] T071 [P] [US3] [TDD] Implement the pre-publication state in `src/ui/views/national.ts`: a `404` before publication begins shows "results are not yet being published" and retrying continues, rather than failing at launch (FR-045)
- [ ] T072 [US3] [TDD] Implement offline start in `src/ui/app.ts`: with no network and a populated database, start successfully and present cached results marked stale (FR-042)
- [ ] T073 [US3] [TDD] Add a top-level resilience guard verified by `tests/integration/resilience.test.ts`: **no network error, malformed document, or unexpected source value may terminate the process** (FR-046). Assert the only exit codes reachable are 0, 1, and 2 per [contracts/cli.md](./contracts/cli.md)
- [ ] T074 [US3] Run quickstart scenarios **V4** and **V5** end to end, using the harness `--fail-after` flag, and record the results
- [ ] T075 **REVIEW** User Story 3: verify no failure path can exit the process, that backoff respects the floor, and that a `304` response does not disturb change highlighting

**Checkpoint**: The application is fit to run unattended through an election night.

---

## Phase 6: User Story 4 - Search and reference lookup (Priority: P3)

**Goal**: Jump to any council by partial name; show official names everywhere instead of codes.

**Independent Test**: Search a municipality by partial name with and without diacritics, open it, and
confirm no raw numeric codes appear where a name exists.

- [ ] T076 [P] [US4] [TDD] Implement search queries in `src/storage/queries/search.ts` over `council.name_folded`, `municipality.name_folded`, and `candidate.name_folded`, with results ranked by prefix match then substring
- [ ] T077 [US4] [TDD] Implement the search view in `src/ui/views/search.ts` opened by `/`, showing live results as the user types and opening the selection on `Enter`. Assert `Ricany`, `Říčany` and `RICANY` all match the same municipality (FR-038)
- [ ] T078 [P] [US4] [TDD] Implement electoral party search in `src/storage/queries/search.ts`: searching a party name lists the councils where it stood (US4 acceptance scenario 2)
- [ ] T079 [US4] [TDD] Audit every view for code leakage via `tests/ui/no-codes.test.ts`: assert that rendered frames contain no bare numeric code where a name is available (FR-011, US4 acceptance scenario 3)
- [ ] T080 [US4] Run quickstart scenario **V8** and record the result
- [ ] T081 **REVIEW** User Story 4: verify folding is applied identically to stored names and queries, and that search never triggers a bulk fetch of councils

**Checkpoint**: The application is navigable without knowing the administrative hierarchy.

---

## Phase 7: User Story 5 - Follow a personal watchlist (Priority: P3)

**Goal**: Mark councils as watched, see them together, and have that survive restarts.

**Independent Test**: Watch two councils, restart, and confirm both are still watched and refreshing.

- [ ] T082 [P] [US5] [TDD] Implement watchlist persistence in `src/storage/queries/watchlist.ts`: add, remove, and list by insertion order (FR-039)
- [ ] T083 [US5] [TDD] Implement watchlist toggling via `w` in `src/ui/views/council.ts` with an on-screen confirmation
- [ ] T084 [US5] [TDD] Implement the watchlist view in `src/ui/views/watchlist.ts` opened by `W`, refreshing each entry in place as new data lands
- [ ] T085 [US5] [TDD] Extend the scheduler in `src/sources/scheduler.ts` so watched councils stay subscribed even when not on screen, and are unsubscribed on removal (FR-018a)
- [ ] T086 [US5] Run quickstart scenario **V9** and record the result
- [ ] T087 **REVIEW** User Story 5: verify removing a watched council actually stops its polling and does not leak a subscription

**Checkpoint**: Several areas can be monitored at once.

---

## Phase 8: User Story 6 - Take the numbers away (Priority: P3)

**Goal**: Export the current table to a spreadsheet-readable file, and produce a shareable summary report.

**Independent Test**: Export a district table, open it in Excel under a Czech locale, and confirm columns
and diacritics are intact with the provenance header present.

- [ ] T088 [P] [US6] [TDD] Implement the CSV writer in `src/export/csv.ts` per [contracts/exports.md](./contracts/exports.md): **UTF-8 with BOM**, semicolon delimiter, comma decimal separator, CRLF endings, RFC 4180 quoting. Test explicitly that a party name containing `;` and `"` round-trips – 2000-character coalition names with punctuation are normal here, not an edge case
- [ ] T089 [US6] [TDD] Implement the provenance header in `src/export/csv.ts`: area name and code, publisher timestamp, provisional or final status, export time. **No exported figure may be untraceable** (FR-050, SC-017)
- [ ] T090 [P] [US6] [TDD] Implement the summary report writer in `src/export/report.ts`: plain UTF-8 text wrapped at 80 columns, containing area identification, timestamp and status, turnout and progress, seats by party, and elected candidates. A district report omits the candidate section (FR-051)
- [ ] T091 [US6] [TDD] Implement export actions `e` and `E` in `src/ui/views/*`, writing to a user-chosen path **via a temporary file then rename**, so an interrupted export cannot leave a half-written file, and confirming before overwriting an existing file
- [ ] T092 [US6] [TDD] Implement non-blocking export with error reporting in `src/export/writer.ts`: an unwritable path, permission failure, or lack of space is reported with its reason and the application keeps running (FR-052, FR-046)
- [ ] T093 [US6] Run quickstart scenario **V10**, opening the output in real spreadsheet software under a Czech locale – this is the scenario most likely to fail, and it cannot be proven by unit tests alone
- [ ] T094 **REVIEW** User Story 6: verify the BOM and delimiter are actually present in written bytes, not just intended, and that export cannot block the render loop

**Checkpoint**: All six user stories are independently functional.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T095 [P] Implement the help view in `src/ui/views/help.ts` opened by `?`, listing every key from [contracts/cli.md](./contracts/cli.md) (FR-005)
- [ ] T096 [P] Verify Czech throughout: audit every user-facing string in `src/` for English leakage, including error and status text (FR-004a). **Source terminology must match the published data**
- [ ] T097 [P] Run quickstart scenario **V11**: resize below and above the minimum, and run with `NO_COLOR=1` (FR-040, FR-041)
- [ ] T098 Run quickstart scenario **V7**: five minutes at `--interval 1`, confirming the clamp and that the request log shows no source polled faster than 60 s (SC-005)
- [ ] T099 Run quickstart scenario **V6**: two runs against a fresh data directory, confirming the second retrieves no reference data (SC-014)
- [ ] T100 Run quickstart scenario **V12**: a 12-hour run against the harness, watching for memory growth and confirming keystroke response stays within 100 ms during refreshes (SC-008, SC-010)
- [ ] T101 Verify cross-platform behaviour: scenarios **V1, V2, V10, V11** must pass on Linux via the CI runner, since no Linux machine is available locally (FR-002, SC-013)
- [ ] T102 [P] Write `README.md` at repository root: what the application is, where the data comes from, how to install, run, and build, and an explicit statement that per-polling-district detail is out of scope (FR-013)
- [ ] T103 [P] Add release packaging to `.github/workflows/build.yml`: attach both binaries to a GitHub release on a tag
- [ ] T104 Confirm accuracy against the published source for a full sample of districts, comparing displayed figures field by field (SC-006). **No rounding or derivation** – figures must match exactly
- [ ] T105 **ELECTION-DAY READINESS** – close to 9 October 2026, re-check the published schemas against the Zod schemas, confirm the real date and base path, and run V6 against the real reference archives. The format may have changed since planning (research, residual risks)
- [ ] T106 **REVIEW** Final: confirm every functional requirement has a covering test, that no dead code or commented-out code remains, and that every deviation from a constitution principle is documented with its justification

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1 (Setup)**: No dependencies. **T006 gates everything** – if SQLite does not work inside the compiled binary, the storage approach must change before any other work has value
- **Phase 2 (Foundational)**: Depends on Phase 1. **Blocks every user story.** Within it, fixtures (T010–T016) block everything else, because Principle II forbids implementation without a failing test and there is no live data source until 9 October 2026
- **Phase 3–8 (User Stories)**: All depend on Phase 2
- **Phase 9 (Polish)**: Depends on the stories being polished

### User story dependencies

- **US1 (P1)**: Only Phase 2. This is the MVP
- **US2 (P2)**: Only Phase 2 in principle, but reuses the app shell (T045) and table component (T048) from US1. Build US1 first unless staffing forces otherwise
- **US3 (P2)**: Only Phase 2. Genuinely independent – it hardens the scheduler and can be developed against any view
- **US4 (P3)**: Phase 2 for reference data; its views reuse US2's navigation
- **US5 (P3)**: Needs US2's council view to have something to watch
- **US6 (P3)**: Needs at least one table view to export from, so effectively US1

### Within each user story

- The failing test comes first, always (Principle II)
- Storage queries before views
- Domain rules before the views that display them
- Review before the story is considered complete (Principle III)

### Parallel opportunities

- **Phase 1**: T003, T004, T008
- **Phase 2**: fixtures T012–T015 together; Zod schemas T028–T031 together; domain utilities T037–T038 together
- **Phase 3**: T044 alongside T045
- **Phase 4**: T054–T056 together; T059–T060 together; T062 alongside them
- **Phase 6**: T076 and T078 together
- **Phase 8**: T088 and T090 together
- **Phase 9**: T095, T096, T097, T102, T103 together

---

## Parallel Example: Phase 2 Zod schemas

```bash
# Four schema modules, four test files, no shared state:
Task: "Write the Zod schema for the district result in src/parsing/schemas/district.ts"
Task: "Write the Zod schema for the council result in src/parsing/schemas/council.ts"
Task: "Write Zod schemas for the registry documents in src/parsing/schemas/registry.ts"
Task: "Write Zod schemas for the code lists in src/parsing/schemas/codelists.ts"
```

---

## Implementation Strategy

### MVP first (User Story 1 only)

1. Phase 1 Setup – **stop at T006 until the compiled binary proves SQLite works**
2. Phase 2 Foundational – fixtures first, then storage, parsing, fetching
3. Phase 3 User Story 1
4. **Stop and validate**: quickstart V2 against the replay harness
5. A working live national dashboard, demonstrable on its own

Phase 2 is unusually large relative to Phase 3. That is inherent: the value is in correctly consuming a
complex external data source, and that machinery is shared by every story.

### Incremental delivery

1. Setup + Foundational → foundation ready
2. + US1 → **MVP**, live national dashboard
3. + US2 → full drill-down, the question most users actually have
4. + US3 → fit to run unattended on election night
5. + US4, US5, US6 → navigation, monitoring, and extraction

**Suggested release boundary**: US1 + US2 + US3. That is a complete, resilient dashboard. US4–US6 are
quality-of-life additions that can follow once the tool has been used against real data.

### Solo development note

The parallel markers above indicate tasks that *may* run concurrently, which matters mainly for ordering
freedom rather than staffing. Working sequentially in task order is correct and loses nothing.

### Election-day constraint

The live sources do not exist until **9 October 2026**. Every task before T105 runs against fixtures and the
replay harness. T105 is the only task that cannot be completed early, and it must not be skipped – the
published format may change between now and then.
