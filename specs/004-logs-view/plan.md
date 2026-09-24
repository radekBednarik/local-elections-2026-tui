# Implementation Plan: Logs View Instead of the Stale-Data Warning Line

**Branch**: `004-logs-view` | **Date**: 2026-09-24 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/004-logs-view/spec.md`

## Summary

Before results are published, the status row says "ZASTARALÁ DATA" and shows a cut-off
parser error. This feature replaces that with an accurate one-line status. The detail
moves to a logs view that the user opens with `l`, can copy from, and closes with `Esc`.

The approach reuses what exists rather than adding mechanisms:
- **Status:** `staleWarning` becomes `sourceStatus`. It tells *stale* (a failing source
  loaded before) from *awaiting* (no failing source ever loaded) by the persisted
  `lastSuccessAt`. Both texts are fixed Czech, contain no error text, and name `l`. The
  title bar gains an `awaiting` indicator (R1, R2).
- **Status row precedence:** a one-off notice now wins the status row for its single
  keystroke. Without that, copy confirmations would never show while the awaiting line
  is up (R3).
- **Log record:** the logger keeps the last 1000 entries in memory, each with the exact
  line written to the file, even when the file write fails (R4). A `404` is logged once
  per change of reason, so the view is not empty before publication (R5).
- **Logs screens:** two new screen kinds on the existing navigation stack. `logs` is the
  list and `log-entry` is one entry in full, opened with `Enter`. `Esc` is the existing
  `back`. Selection, scrolling, theming and the minimum-size handling all come from the
  shared screen pipeline (R6).
- **Copy:** `c` copies the selected entry and `Shift+C` copies all entries, through the
  renderer's OSC 52 call behind an injectable function. The notice says "sent", with
  Czech plurals (R7).
- **Keys:** three new entries in the action registry, `logs`, `copy-entry` and
  `copy-all`. The status bar, the palette and the help screen pick them up
  automatically (R8).

## Technical Context

**Language/Version**: TypeScript 5.x on Bun 1.4.2+ (unchanged)

**Primary Dependencies**: `@opentui/core` 0.5.11, unchanged. Its existing
`CliRenderer.copyToClipboardOSC52` is used for the first time. No new dependency.

**Storage**: No change. `SCHEMA_VERSION` stays at 2. Log entries live in memory, and
the log file is unchanged apart from one added `info` line (R5).

**Testing**: `bun test`. The work extends the `logger`, `status-bar`, `keymap`, `frame`,
`palette`, `help-and-language`, `screen`, `colour`, `resilience` and
`navigation`/`stability` suites, and adds one small `logs-copy` unit suite. The replay
harness is used for end-to-end checks ([quickstart.md](quickstart.md)).

**Target Platform**: Windows 11 x64 and Linux x64, unchanged.

**Project Type**: Single-project terminal application.

**Performance Goals**:
- Opening or closing the logs view stays under the 100 ms keystroke budget (SC-003).
- Composing the list is one pass over at most 1000 short strings.

**Constraints**:
- Nothing is written to stdout or stderr while the TUI runs; OSC 52 goes through the
  renderer (FR-019).
- Every screen still fits 80 × 24.
- Text carries the meaning without colour (FR-005).
- No new theme role or slot (R6).

**Scale/Scope**:
- At most 1000 log entries held in memory.
- About 12 source files touched, 1 added:
  - touched: `logger.ts`, `status.ts`, `chrome/state.ts`, `navigation.ts`, `screen.ts`,
    `breadcrumb.ts`, `keymap.ts`, `palette/actions.ts`, `app.ts`, `README.md`
  - added: `views/logs.ts`
- 4 user stories, 22 functional requirements, 6 success criteria.

No NEEDS CLARIFICATION remains. Every design question is answered in
[research.md](research.md).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Principle I – Simplicity and Non-Duplication (KISS + DRY)

**Pass.**
- **One formatter:** the in-memory entry keeps the line from the same `format` call the
  file uses. FR-015 holds by construction, not by keeping two formats in step (R4).
- **One status rule:** `sourceStatus` decides stale versus awaiting, and the frame and
  the title bar both read its result (R1, R2).
- **One key source:** the new actions are registry entries, so the bar, the palette and
  the help screen cannot disagree (R8).
- **No new rendering path:** the logs screens are ordinary `Screen` kinds. Selection,
  scrolling, theming and the too-small message come for free. An overlay or a
  multi-line row model was rejected (R6).
- **No speculative features:** no filtering, no search, no history from earlier
  sessions, no host clipboard backend.

### Principle II – Test-Driven Development (NON-NEGOTIABLE)

**Pass, by plan.** Each row of the quickstart's test table is a failing test written
before its implementation. The pure pieces are all testable without a terminal:
- the logger record,
- `sourceStatus`,
- the key map,
- the registry,
- the logs rows,
- the copy text and notices.

The App glue is covered through the injected `copy` function. `tasks.md` will order each
test before its code.

### Principle III – Mandatory Code Review

**Pass, by plan.** Each task ends with a review step. That review must check in
particular:
- no status text can contain `lastError`,
- the logger records an entry exactly when it would write one,
- `Esc` in the logs view pops exactly one level,
- nothing reaches stdout outside the renderer.

### Quality Standards

- Tests stay deterministic: `sourceStatus` takes `now`, and logger tests use temporary
  directories as they do today.
- `staleWarning` is removed, not kept beside `sourceStatus`.
- The tests that assert the old warning text (`status-bar`, `frame`, `stability`,
  `colour`) are updated to the new text, not deleted.
- **Spec amendments made during planning:**
  - FR-002 is judged globally, not per screen (R1).
  - FR-011 is met by a detail screen opened with `Enter` (R6).
  - SC-004 means the pasted text is the log-file line (R7).

  All three are recorded in the spec and in research.

**Gate result: pass.** Nothing needs recording under Complexity Tracking.

### Post-design re-check

**Still passes.**

The design adds:
- two members on `Logger`,
- one type (`LogEntry`),
- one indicator state,
- two screen kinds,
- three registry entries,
- one view module,
- one optional App dependency.

It replaces one function (`staleWarning`) and reverses one precedence rule, with the
reason recorded (R3). No principle is strained.

## Project Structure

### Documentation (this feature)

```text
specs/004-logs-view/
├── plan.md                # This file
├── research.md            # Phase 0: decisions R1–R8
├── data-model.md          # Phase 1: LogEntry, SourceStatus, screens, indicator
├── quickstart.md          # Phase 1: automated and replay validation
├── contracts/
│   └── interface.md       # Phase 1: status row, title bar, logs screens, keys, notices
├── checklists/
│   └── requirements.md    # Spec quality checklist
└── tasks.md               # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
src/
├── logging/
│   └── logger.ts          # LogEntry; in-memory ring (1000), entries(), dropped
├── ui/
│   ├── app.ts             # perform: logs, copy-entry, copy-all; copy dep; dropped
│   │                      # tracking; recordFetch logs a 404 once per change of reason
│   ├── keymap.ts          # l, c, Shift+C
│   ├── navigation.ts      # Screen: logs, log-entry
│   ├── screen.ts          # composeScreen / shownSources for the two new screens
│   ├── views/
│   │   └── logs.ts        # NEW: list rows, detail rows, copy text, copy notice
│   ├── components/
│   │   └── status.ts      # sourceStatus replaces staleWarning; screenLabel
│   ├── chrome/
│   │   ├── state.ts       # awaiting indicator; row precedence; logEntries passthrough
│   │   └── breadcrumb.ts  # segments for Záznamy / Záznam
│   └── palette/
│       └── actions.ts     # logs, copy-entry, copy-all
README.md                  # keys table: l, c, Shift+C; the status row wording

tests/
├── unit/
│   ├── logger.test.ts
│   ├── status-bar.test.ts
│   ├── keymap.test.ts
│   └── logs-copy.test.ts  # NEW
├── integration/
│   ├── screen.test.ts
│   └── resilience.test.ts
└── ui/
    ├── frame.test.ts
    ├── palette.test.ts
    ├── help-and-language.test.ts
    ├── colour.test.ts
    └── stability.test.ts
```

**Structure Decision**: The existing single-project layout, unchanged. Each concern
lands in the module that already owns it: logging, UI chrome, views, and the registry.

## Complexity Tracking

No violations to justify.
