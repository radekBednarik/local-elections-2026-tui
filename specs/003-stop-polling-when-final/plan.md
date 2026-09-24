# Implementation Plan: Stop Polling When Results Are Final

**Branch**: `003-stop-polling-when-final` | **Date**: 2026-09-24 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/003-stop-polling-when-final/spec.md`

## Summary

Once a result source (the nationwide file, a district file or a council file) is read
as final, the application stops requesting it automatically. It keeps that knowledge
across restarts, and it still fetches the source when the user presses `r`.

The approach reuses the polling state that exists today rather than adding a mechanism:
- **Storage:** `source_subscription` gains a `final` column (research R1). A version-1
  database is upgraded in place by one `ALTER TABLE` (R2).
- **Ingest:** each ingest function reports whether the document it read is final, by
  combining the existing `determineStatus` over its blocks (R3).
- **Scheduler:** a final source has no next due time, so `due()` never returns it.
  `requestRefresh` still sets a due time of now, which is how a manual refresh gets
  through without a second code path (R4).
- **Subscriptions:** a final council is kept subscribed when left, so reopening it costs
  no request (R5).
- **UI:** the title bar's `● živě` becomes `■ konečné · obnova ručně` when everything on
  screen is final, and the stale warning ignores final sources (R6).

## Technical Context

**Language/Version**: TypeScript 5.x on Bun 1.4.2+ (unchanged)

**Primary Dependencies**: `@opentui/core` 0.5.11, unchanged. No new dependency.

**Storage**: `bun:sqlite`. One added column, `source_subscription.final`. `SCHEMA_VERSION`
goes from 1 to 2, with an in-place upgrade from 1 ([data-model.md](data-model.md)).

**Testing**: `bun test`, extending the existing `scheduler`, `ingest`, `dataset`, `schema`
and `status-bar` suites. The replay harness is used for the end-to-end check
([quickstart.md](quickstart.md)).

**Target Platform**: Windows 11 x64 and Linux x64, unchanged.

**Project Type**: Single-project terminal application.

**Performance Goals**: No new work on the hot path. `due()` loses a condition, and the
title bar check is a lookup over the subscriptions `draw()` already loads.

**Constraints**:
- No source is requested more than once per 60 seconds, whether the request is automatic
  or manual (001 FR-016). That is unchanged.
- The cadence of sources still in progress is unchanged (SC-006).
- Every screen still fits 80 × 24, and the text carries the meaning without colour.
- Exports are unchanged.

**Scale/Scope**:
- 79 always-on sources, plus the councils the user opens or watches.
- About 9 source files touched, none added: `schema.ts`, `db.ts`, `ingest.ts`, `screen.ts`,
  `scheduler.ts`, `app.ts`, `status.ts`, `chrome/state.ts` and `README.md`.
- 3 user stories, 11 functional requirements, 6 success criteria.

No NEEDS CLARIFICATION remains. Every design question is answered in [research.md](research.md).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Principle I – Simplicity and Non-Duplication (KISS + DRY)

**Pass.**
- **One definition of "final":** the per-area rule stays in `determineStatus`, and ingest
  only combines results with `every` (R3). The UI reads the stored flag and never works
  finality out again.
- **One scheduling mechanism:** a final source is simply one with no due time. Manual
  refresh reuses the existing "due now" path, so no "refresh requested" flag or second
  queue is added (R4).
- **No new module, table or flag.** The column sits in a table that `--reset` and a
  dataset change already clear, so FR-006 and FR-007 need no new code (R1).
- **One-step upgrade, not a framework:** the schema upgrade handles version 1 only (R2).
  A general migration layer would be speculative.

### Principle II – Test-Driven Development (NON-NEGOTIABLE)

**Pass, by plan.** Every behaviour in the quickstart's test table is written as a failing
test first:
- scheduler transitions,
- ingest `final` for each document shape,
- persistence, reset and upgrade,
- keeping a final council subscribed,
- the title bar indicator and the stale warning.

`tasks.md` will order each test before its implementation.

### Principle III – Mandatory Code Review

**Pass, by plan.** Each task ends with a review step. That review must check in particular:
- no path lets a final source become due except `requestRefresh`,
- the 60-second floor still covers manual refreshes.

### Quality Standards

- Tests are deterministic: the scheduler tests already inject `now`, and the new ones do
  the same.
- The `IS NULL` branch in `due()` is removed rather than left as dead code (R4).
- The spec correction to scenario 2.2 is recorded in research R7.

**Gate result: pass.** Nothing needs recording under Complexity Tracking.

### Post-design re-check

**Still passes.** The design adds:
- one column,
- one optional parameter on `recordSuccess`,
- one field on the success branch of `IngestResult`,
- one field on `Subscription`,
- one indicator state.

It removes one dead branch. No principle is strained.

## Project Structure

### Documentation (this feature)

```text
specs/003-stop-polling-when-final/
├── plan.md                # This file
├── research.md            # Phase 0: decisions R1–R7
├── data-model.md          # Phase 1: the column, state transitions, schema version
├── quickstart.md          # Phase 1: automated and replay validation
├── contracts/
│   └── interface.md       # Phase 1: requests, title bar, warning, README text
├── checklists/
│   └── requirements.md    # Spec quality checklist
└── tasks.md               # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
src/
├── storage/
│   ├── schema.ts          # `final` column; SCHEMA_VERSION = 2; version-1 upgrade
│   └── db.ts              # run the upgrade instead of throwing for version 1
├── sources/
│   ├── ingest.ts          # IngestResult.final for national, district, council
│   └── scheduler.ts       # Subscription.final; due(); recordSuccess/recordFailure; releaseCouncils
├── ui/
│   ├── app.ts             # recordFetch (extracted from tick) passes `final`; releaseCouncils
│   ├── screen.ts          # shownSources, beside sourcesForScreen
│   ├── components/
│   │   └── status.ts      # staleWarning ignores final subscriptions
│   └── chrome/
│       └── state.ts       # title bar indicator: živě / konečné · obnova ručně / ZASTARALÉ
README.md                  # Polling section (contract § 5)

tests/
├── integration/
│   ├── scheduler.test.ts  # transitions, floor, cadence of sources still in progress
│   ├── ingest.test.ts     # `final` for each document shape
│   ├── dataset.test.ts    # survives restart; cleared by reset and dataset change
│   └── schema.test.ts     # version-1 upgrade
└── unit/
    └── status-bar.test.ts # indicator states; stale warning
```

**Structure Decision**: The existing single-project layout, unchanged. The work lands in
the modules that already own each concern: storage, sources, and the UI chrome.

## Complexity Tracking

No violations to justify.
