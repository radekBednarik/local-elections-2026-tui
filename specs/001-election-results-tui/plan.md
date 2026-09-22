# Implementation Plan: Election Results TUI

**Branch**: `001-election-results-tui` | **Date**: 2026-09-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-election-results-tui/spec.md`

## Summary

A single-binary terminal dashboard over the Czech 2026 municipal election open data. It retrieves the three
ongoing (non-batch) result sources plus the registry and code list archives, validates them, stores them in
an embedded database, and presents a navigable national → district → council drill-down that refreshes
itself while the count runs.

Technical approach: TypeScript on Bun, OpenTUI for the interface, `bun:sqlite` for storage, and
`bun build --compile` to produce one self-contained executable per platform. Documents are parsed with
`fast-xml-parser` and validated with Zod schemas mirroring the publisher's XSDs, so a changed or malformed
source fails loudly instead of producing wrong figures.

The riskiest assumption – that OpenTUI's native Zig core survives compilation into a single binary – was
verified empirically before writing this plan, not assumed. See [research.md](./research.md) R1.

## Technical Context

**Language/Version**: TypeScript 5.x on Bun 1.4.2+ (verified installed)

**Primary Dependencies**: `@opentui/core` 0.5.11 (terminal UI, native Zig core via `bun:ffi`),
`fast-xml-parser` 5.11.1 (parsing), `zod` 4.6.5 (validation), `fflate` 0.8.3 (archive extraction). All
current and actively maintained as of 2026-09-22.

**Storage**: `bun:sqlite`, one database file in the per-user data directory, WAL journal mode. Built into
the runtime – no native dependency of its own.

**Testing**: `bun test` (built in) with `@opentui/core/testing` `createTestRenderer()` for the view layer.
Fixtures derived from the 2022 election plus a local replay harness, because the 2026 result files do not
exist until 9 October 2026.

**Target Platform**: Windows 11 x64 and Linux x64 (glibc). One self-contained executable per target, built
natively on its own CI runner.

**Project Type**: Single-project CLI / terminal application.

**Performance Goals**: Keystroke answered within 100 ms during a refresh (SC-010); national overview
readable within 5 s of a warm start (SC-002); all districts browsable within 3 minutes of first launch
(SC-015).

**Constraints**: No source polled more than once per 60 s (FR-016, SC-005) – a hard limit, not a target.
Must never terminate on a network error, malformed document, or unexpected value (FR-046). Must run 12+
hours without degradation (SC-008). Must start and work offline from cache (FR-042).

**Scale/Scope**: 78 continuously polled sources (1 national + 77 districts); roughly 6,000 councils fetched
on demand; ~10 MB of result data; a candidate table covering every candidate nationwide. 6 user stories,
59 functional requirements, 17 success criteria.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Principle I – Simplicity and Non-Duplication (KISS + DRY)

| Check | Status |
|---|---|
| No abstraction introduced before two concrete use cases exist | **Pass.** `@opentui/core` chosen over the React/Solid bindings – no reconciler for a handful of tables. No worker thread until measurement shows one is needed (research R8). No repository or ORM layer over `bun:sqlite` |
| No dependency added where the runtime already provides the capability | **Pass.** HTTP, CLI parsing, diacritic folding, CSV writing, and backoff all use built-ins (research R6). Four runtime dependencies total |
| Single authoritative representation per piece of knowledge | **Pass.** Zod schemas are the single source of both validation and TypeScript types, so parser and types cannot drift. Source field names appear once, in the schema modules |

### Principle II – Test-Driven Development (NON-NEGOTIABLE)

| Check | Status |
|---|---|
| A failing test can exist before any implementation code | **Pass, and this was a real risk.** The live sources do not exist yet, so without fixtures no test could be written first. Resolved by committing fixtures and a replay harness (research R9) before feature work begins |
| The view layer is testable, not just the logic | **Pass.** `@opentui/core/testing` provides a real renderer with in-memory output and `captureCharFrame()` for frame assertions |
| Every layer has a test seam | **Pass.** Parsing and validation are pure functions over fixture strings; storage is a real database file in a temp directory; fetching goes through `--base-url`, so `file://` fixtures need no network mocking |

### Principle III – Mandatory Code Review

| Check | Status |
|---|---|
| Review is a required step, not optional follow-up | **Deferred to `/speckit-tasks`.** Every task that writes code must carry an explicit review step. This plan cannot enforce it; the task breakdown must |

**Gate result: PASS.** No violations, so the Complexity Tracking table below is empty.

### Post-Phase 1 re-check

Re-evaluated after the data model and contracts were written. Still **PASS**. Two observations:

- The data model constrains `result_snapshot` to at most two rows per area, enforcing the "no history"
  clarification in storage rather than relying on application discipline. Simpler and harder to get wrong.
- The export contract is where hidden complexity lurks (UTF-8 BOM, semicolon delimiter, Czech decimal
  comma). It is written down rather than left to be rediscovered, but it is not an abstraction.

## Project Structure

### Documentation (this feature)

```text
specs/001-election-results-tui/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── cli.md           # Command-line and keyboard surface
│   ├── data-sources.md  # Consumed published documents
│   └── exports.md       # Written file formats
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/speckit-tasks - NOT created here)
```

### Source Code (repository root)

```text
src/
├── main.ts                  # Entry point, argument parsing, wiring
├── config/                  # CLI + environment, per-user paths (FR-047)
├── sources/                 # Fetching: URL building, conditional requests,
│                            #   scheduler, backoff (FR-015 to FR-024, FR-043)
├── parsing/                 # fast-xml-parser wrappers + Zod schemas,
│                            #   one module per document type (FR-025)
├── reference/               # Archive download, extraction, first-run load (FR-020)
├── storage/                 # bun:sqlite schema, migrations, queries (FR-042, FR-048)
├── domain/                  # Entities and rules: provisional/final, change
│                            #   detection, diacritic folding (FR-022, FR-036)
├── ui/                      # OpenTUI views: overview, district, council,
│                            #   party, candidates, search, watchlist, help
├── export/                  # CSV and summary report writers (FR-049 to FR-053)
└── logging/                 # File logger (FR-030)

tests/
├── unit/                    # Parsing, validation, folding, backoff, formatting
├── integration/             # Storage, first-run reference load, scheduler
├── ui/                      # createTestRenderer frame assertions
└── contract/                # Fixtures validated against the Zod schemas

fixtures/                    # Committed test data (research R9)
├── 2026/                    # Derived from 2022, validated against 2026 schemas
└── edge-cases/              # Hand-written: malformed, truncated, annulled,
                             #   unfilled seats, boroughs, coalitions

tools/
└── replay/                  # Local harness serving fixtures on a timer

.github/workflows/           # Build matrix: windows-latest + ubuntu-latest
```

**Structure Decision**: Single project, layered by responsibility rather than by feature. The dependency
direction is one-way – `sources` → `parsing` → `storage` → `domain` → `ui` – so that everything below `ui`
is testable without a renderer, which Principle II requires. `fixtures/` and `tools/replay/` sit outside
`src/` because they must never be bundled into the shipped binary.

## Complexity Tracking

> No constitution violations. Table intentionally empty.

## Phase status

| Phase | Status | Output |
|---|---|---|
| 0 – Research | Complete | [research.md](./research.md) |
| 1 – Design & Contracts | Complete | [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md) |
| 2 – Tasks | Not started | Run `/speckit-tasks` |

## Carried risks and prerequisites

| Item | Impact | Action |
|---|---|---|
| `bun:sqlite` not yet verified inside a compiled binary | High – FR-001 | Smoke-test in the first build task, before anything depends on it (quickstart V1) |
| No git remote on this repository | Blocks CI only | Push to GitHub before the build matrix can run. Development is unaffected |
| Linux binary never executed on Linux locally | High – FR-002 | CI runs it on `ubuntu-latest`. Treat any local cross-build as unverified |
| Publisher may change the format before 9 October 2026 | Medium | Zod validation fails loudly rather than mis-parsing. Re-check schemas close to the date (quickstart, election-day readiness) |
| ~93 MB per binary | Low | Inherent to embedding the Bun runtime. No requirement sets a size limit |
