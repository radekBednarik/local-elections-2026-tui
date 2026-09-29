# Implementation Plan: Results Chart Panel

**Branch**: `006-results-chart-panel` | **Date**: 2026-09-29 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/006-results-chart-panel/spec.md`, with the approved
look in [visual-design.md](visual-design.md)

## Summary

Pressing `g` on the national overview, a council or a party's candidate list splits the content
area. The table stays on the left, still fully interactive. A pane on the right draws a textured,
rank-coloured pie of the same breakdown, with a legend of exact figures.

The approach reuses what exists rather than adding mechanisms:
- **Rendering:** the pie is text. Each pane row is a `SemanticRow` of texture-character runs
  coloured through `fgSlot`, drawn by the existing `styledBlock` into the panel's one text node.
  The plain-text form is the textures, so tests assert the pie directly and monochrome works by
  construction (R1).
- **Region:** the chart uses the watchlist's panel box, with a width set per content. The chart
  wins while shown. The watchlist returns on close because its intent flag is never touched
  (R2).
- **Fit:** the pane is `min(60, raw − 51)` columns and is offered at 40 or more, which is a
  terminal of 93 or more columns. Height never gates the chart: the pie's radius shrinks and the
  legend always stays (R3).
- **State:** `chartOpen` is intent. The pane shows on chart screens when it fits, and follows the
  user through the drill-down. Esc closes it before going back. A shrink closes it with a notice
  (R4).
- **Reduced tables:** a width rule in the builders, extending FR-074. The bar goes first, then
  the seat columns. Candidates gain a published `Podíl` column and collapse `Mandát` to `●`.
  Full-width output at 80 columns is unchanged (R5).
- **Key:** one registry entry, `chart`, on `g`. An optional `hintFor` lets the footer chip read
  `g graf` / `g zavřít graf` (R6).
- **Colour:** six new theme slots, `slice1` to `slice6`, with the approved values. The contrast
  test adds 3:1 on `panel`, and three Catppuccin Latte tones are nudged to pass (R7).
- **Figures:**
  - the legend uses published figures only,
  - for parties, the aggregate is the exact sum of its members,
  - for candidates, the aggregate is the party's votes less the charted, elected candidates,
    because the source publishes no preferential votes for anyone else (R8, spec amendment).

## Technical Context

**Language/Version**: TypeScript 5.x on Bun 1.4.2+ (unchanged)

**Primary Dependencies**: `@opentui/core` 0.5.11, unchanged. No new dependency. The pie uses
only `TextRenderable` and `StyledText`, which are already in use.

**Storage**: No change. `SCHEMA_VERSION` is unchanged. The chart's open state is in memory only.
The read queries gain `previousVotes` / `votesChange` fields computed from snapshots that
already exist.

**Testing**: `bun test`. The work adds one unit suite, `tests/unit/chart.test.ts`, and extends:
- `theme-contrast`, `panel`, `frame`, `palette`, `keymap`, `status-bar` and `help-and-language`,
- `national`, `areas`, `screen`, `colour` and `stability`.

The replay harness covers end-to-end checks ([quickstart.md](quickstart.md)).

**Target Platform**: Windows 11 x64 and Linux x64, unchanged.

**Project Type**: Single-project terminal application.

**Performance Goals**:
- Opening, closing or re-sorting with the pane open stays within the 100 ms keystroke budget.
- A pane rebuild is one query of about 230 rows, one sort and at most 561 cell tests: well under
  1 ms (R11).

**Constraints**:
- Every screen still fits 80 × 24, where the chart is simply not offered.
- Meaning never depends on colour. Textures and the legend carry it (FR-007).
- No figure is ever truncated or distorted (FR-012).
- All text is Czech.
- No per-party colour: colour is by rank (FR-006).

**Scale/Scope**:
- 3 user stories, 15 functional requirements, 5 success criteria.
- About 16 source files touched, 1 added:
  - added: `src/ui/views/chart.ts` (context, ranking, pie cells, pane rows),
  - touched:
    - UI: `theme/themes.ts`, `chrome/panel.ts`, `chrome/frame.ts`, `chrome/state.ts`,
      `palette/actions.ts`, `components/status.ts`, `keymap.ts`, `app.ts`,
    - views: `views/national-rows.ts`, `views/areas.ts`,
    - queries: `storage/queries/national.ts`, `storage/queries/areas.ts`,
    - docs: `README.md`, `visual-design.md` (Latte amendment).

No NEEDS CLARIFICATION remains. Every design question is answered in [research.md](research.md).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Principle I – Simplicity and Non-Duplication (KISS + DRY)

**Pass.**
- **No new rendering path:** the pie is `SemanticRow`s through `styledBlock`. A frame buffer or
  a custom renderable was rejected (R1).
- **One side region:** the chart reuses the watchlist's panel box. A second box and a precedence
  rule between the two were rejected (R2).
- **One layout rule:** the tables shed columns by width, as they already drop bars. A `compact`
  flag threaded through the builders was rejected (R5).
- **One registry entry:** `chart` drives the footer, the palette and the help screen. The only
  new field, `hintFor`, is optional and has one use (R6).
- **One formatter set:** the legend uses `formatInteger`, `formatPercent`, `withChange`,
  `roleForChange` and `pad`, so its numbers cannot drift from the tables (R10).
- **No speculative features:** no metric toggle, no seat chart, no chart export, no persisted
  chart preference and no caching (spec Assumptions, R4, R11).

### Principle II – Test-Driven Development (NON-NEGOTIABLE)

**Pass, by plan.** Every row of the quickstart's test table is a failing test written before its
code. The core is pure and testable without a terminal:
- `rankSlices`,
- `pieCells` and `chartLayout`,
- `chartContext` against a fixture database,
- `buildChartRows`, as plain text,
- `chartPaneWidth` and `chartFits`,
- the registry entry and the key map.

The `App` glue (toggle, Esc precedence, shrink-closes) is covered through `stability` and
`frame` tests, the way the watchlist panel is today. `tasks.md` will order each test before its
code. The Latte nudges are fixed by writing the contrast test first and watching it fail.

### Principle III – Mandatory Code Review

**Pass, by plan.** Each task ends with a review step. The review must check in particular:
- every legend figure is a published figure or a sum of published figures (FR-009),
- full-width output at 80 columns is byte-identical to before (R5),
- no slice colour is keyed to a party or candidate identity (FR-006),
- no path removes and re-adds body children beyond the existing panel toggle (`frame.ts`
  warning).

### Quality Standards

- Tests stay deterministic: the chart functions take the database and the screen, and nothing
  reads the clock.
- `frame.ts` no longer reads `PANEL_COST`: it subtracts the panel's actual width. `PANEL_COST`
  remains the watchlist's fit cost in `panelFits`, its one remaining use.
- **Spec amendments made during planning**, recorded in the spec's Clarifications:
  - FR-009 for candidates: the aggregate is the party's votes less the charted candidates (R8).
  - FR-013: the fit is by width only, and the shrink notice text is fixed (R3, R4).
  - The candidate table gains `Podíl` at every width (R5).
  - Three Catppuccin Latte slice tones are nudged to reach 3:1 (R7).
  - Ties break by the table's unsorted order (R9), and the title's form states the level
    (FR-014, R10).
  - US1 acceptance scenario 3 is limited to scrolling, since the national table has no sort. The
    re-sort check moves to US2 as a new scenario 3.
- **Deviation from the approved mock** (recorded in R3): at 100 × 30 the disc has radius 15 rather
  than 16, because of the pane's title spacing. It reaches 16 from 31 rows up.

**Gate result: pass.** Nothing needs recording under Complexity Tracking.

### Post-design re-check

**Still passes.**

The design adds:
- one view module,
- six theme slots,
- three constants and two functions in `panel.ts`,
- one optional parameter on `setPanelVisible`,
- two `ActionContext` fields and one optional `Action` field,
- one registry entry and one key,
- one `App` flag, plus the one that detects a shrink,
- `previousVotes` / `votesChange` on three query row types.

It changes one existing rule: `back` is also available while the chart is shown, and the reason
is recorded (R4). No principle is strained.

## Project Structure

### Documentation (this feature)

```text
specs/006-results-chart-panel/
├── plan.md                # This file
├── research.md            # Phase 0: decisions R1–R11
├── data-model.md          # Phase 1: ChartEntry, ChartContext, Slice, slots, geometry, state
├── quickstart.md          # Phase 1: automated and replay validation
├── contracts/
│   └── interface.md       # Phase 1: key, layout, pane text, figures, reduced tables, notices
├── visual-design.md       # Approved look (input), plus the Latte amendment
├── mock/
│   └── results-chart-panel-mock.html
├── checklists/
│   └── requirements.md    # Spec quality checklist
└── tasks.md               # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
src/
├── storage/queries/
│   ├── national.ts        # PartyRow.previousVotes
│   └── areas.ts           # CouncilPartyRow.previousVotes; ElectedRow votesChange/previousVotes;
│                          # registered candidates carry votesPct
├── ui/
│   ├── app.ts             # chartOpen; perform "chart"; Esc closes first; shrink closes + notice
│   ├── keymap.ts          # g → chart
│   ├── views/
│   │   ├── chart.ts       # NEW: chartContext, rankSlices, chartLayout, pieCells, buildChartRows
│   │   ├── national-rows.ts # seat columns shed by width
│   │   └── areas.ts       # council seat column shed; candidates Podíl + ● collapse
│   ├── chrome/
│   │   ├── panel.ts       # CHART_* constants, chartPaneWidth, chartFits
│   │   ├── frame.ts       # panel width per content; contentWidth uses it
│   │   └── state.ts       # applyPanel picks chart or watchlist; chart context fields
│   ├── components/
│   │   └── status.ts      # footer chip uses Action.hintFor
│   ├── palette/
│   │   └── actions.ts     # "chart" entry; ActionContext.chartOpen/chartFits; hintFor; back rule
│   └── theme/
│       └── themes.ts      # slice1..slice6 in SLOTS and every theme
README.md                  # keys table: g

tests/
├── unit/
│   ├── chart.test.ts      # NEW
│   ├── keymap.test.ts
│   └── status-bar.test.ts
├── integration/
│   └── screen.test.ts
└── ui/
    ├── theme-contrast.test.ts
    ├── panel.test.ts
    ├── frame.test.ts
    ├── palette.test.ts
    ├── help-and-language.test.ts
    ├── national.test.ts
    ├── areas.test.ts
    ├── colour.test.ts
    └── stability.test.ts
```

**Structure Decision**: The existing single-project layout, unchanged. The chart is a view
(`src/ui/views/chart.ts`) like every other screen's content. Its fit rule sits beside the
watchlist's in `panel.ts`, and colour stays in theme slots resolved only by `theme/apply.ts`.

## Complexity Tracking

No violations to justify.
