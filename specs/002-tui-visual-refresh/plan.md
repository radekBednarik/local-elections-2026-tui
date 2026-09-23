# Implementation Plan: TUI Visual Refresh

**Branch**: `002-tui-visual-refresh` | **Date**: 2026-09-23 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/002-tui-visual-refresh/spec.md`

## Summary

The TUI gets the approved layout C: six named colour themes (Tokyo Night by default), a background
for every region, striped table rows, a segmented breadcrumb, a content rail, summary cards and
chips, a seat strip, and a command palette drawn over dimmed content.

The approach extends the pipeline that already exists rather than adding a parallel one:
- Views keep producing `SemanticRow`s. Rows gain a `kind` (header, rule or data), and cells gain a
  `surface` (research R3, R4).
- `frameState` decides each row's background, including stripes and the selection (R2).
- `apply.ts` stays the only module that produces a colour. It now emits backgrounds and pads each
  styled row to the full width, because OpenTUI paints a text background under glyphs only (R1).
- The chrome becomes backgrounds and one-sided rails on the boxes that exist today (R5).
- The palette becomes an absolute overlay over an alpha dimming layer, and its list is drawn through
  the same row path (R7).
- Themes are one table of slots (data model). The contrast floor is enforced by a test (R9).

## Technical Context

**Language/Version**: TypeScript 5.x on Bun 1.4.2+ (unchanged)

**Primary Dependencies**: `@opentui/core` 0.5.11, unchanged. Every API used was verified in the
installed version (research): box `backgroundColor`, one-sided `border` with `heavy` and `rounded`
styles, text and chunk `bg`, absolute positioning with `zIndex`, alpha blending, scroll bar
`trackOptions`, `RGBA.fromIndex`. No new dependency.

**Storage**: `bun:sqlite`, unchanged. The existing `theme` key in `app_config`. No schema change, and
legacy values are mapped on read (FR-006a).

**Testing**: `bun test` with `createTestRenderer()` and `captureSpans()`, which read back the colours
actually written (`tests/ui/colour.test.ts` already works this way).

**Target Platform**: Windows 11 x64 and Linux x64, unchanged. True colour expected. 256 colours are
approximated by the application (R8), and anything less gives monochrome.

**Project Type**: Single-project terminal application.

**Performance Goals**: Selection move and redraw within 100 ms on the largest table (SC-008,
001 SC-010, SC-026). This feature adds one padding chunk per rewritten row and a cached colour lookup.

**Constraints**:
- Monochrome and `NO_COLOR` emit no colour (FR-008).
- Exports are byte-identical (SC-006).
- Every screen fits 80 × 24 (FR-028).
- Regions never move on a refresh (001 FR-058).
- No colour per party (FR-025).

**Scale/Scope**:
- 6 themes × 18 slots.
- 8 screens and the palette overlay.
- About 15 source files touched, 1 added.
- 4 user stories, 30 functional requirements, 9 success criteria.

No NEEDS CLARIFICATION remains: every open technical question was answered in [research.md](research.md).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Principle I – Simplicity and Non-Duplication (KISS + DRY)

**Pass.**
- **One pipeline:** no new rendering path. Cards, chips, badges, the seat strip and the palette list
  are rows of cells, so they reuse `styledRow`, clamping and the row pool (R4, R7).
- **One source for colours:** the colour values live in one slot table (data model), and roles
  resolve through it. The mock's values are transcribed once, into `themes.ts`.
- **One place per rule:**
  - Striping and the selection background are decided in `frameState`, not in seven views (R2).
  - Table headers are built by one helper in `row.ts`, not restated per view (R3).
- **Less code:** the `indexed` colour kind and `SelectRenderable` are removed because nothing needs
  them any more. The palette already kept its own state.
- **The one new module**, `src/ui/theme/depth.ts` (nearest xterm-256 colour), is required by the
  spec's 256-colour edge case. That behaviour could not be shown to exist in OpenTUI (R8). It is a
  pure function of about 20 lines.

### Principle II – Test-Driven Development (NON-NEGOTIABLE)

**Pass, with one change of behaviour to manage.** Every step starts with a failing test that reads
the colours actually written, through `captureSpans()`, not the theme table.
- **Rewritten summary assertions:** the national and council summaries change layout, so the
  existing assertions that match the old strings change with them. Each is rewritten first, observed
  failing against the current code, and only then is the view changed (R4).
- **Contrast** is enforced by a new test over every theme (R9).
- **Unchanged exports:** the export-parity test stays untouched and must keep passing, which is the
  proof of SC-006.

### Principle III – Mandatory Code Review

**Pass.**
- Each task in the sequence below ends with a review against Principles I and II, and against the
  interface contract.
- The review of the chrome and palette tasks also compares the running application with the mock at
  80 × 24 and 100 × 30 (quickstart §2).

### Post-Phase 1 re-check

**Pass.** The design adds the new fields to `SemanticRow` and `Cell`, reuses every existing mechanism,
and removes two. No complexity needs justifying, so Complexity Tracking stays empty.

## Project Structure

### Documentation (this feature)

```text
specs/002-tui-visual-refresh/
├── plan.md              # This file
├── spec.md              # Feature specification (clarified 2026-09-23)
├── research.md          # Phase 0: OpenTUI findings and decisions R1-R11
├── data-model.md        # Phase 1: themes, slots, row and cell fields, theme values
├── quickstart.md        # Phase 1: how to validate
├── contracts/
│   └── interface.md     # Phase 1: what the user sees (amends the 001 contract)
├── mocks/
│   └── index.html       # Approved design reference (layout C)
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
src/
├── storage/queries/
│   └── preferences.ts     # legacy "dark"/"light" mapped on read (FR-006a)
└── ui/
    ├── row.ts             # SemanticRow.kind, Cell.surface, Cell.bar, table header helper
    ├── theme/
    │   ├── themes.ts      # six themes as slot tables; ThemeName; cycle order; labels
    │   ├── roles.ts       # role → slot mapping (meanings unchanged)
    │   ├── apply.ts       # fg AND bg per chunk, row padding, surfaces, depth approximation
    │   ├── depth.ts       # NEW: nearest xterm-256 index, cached (R8)
    │   └── detect.ts      # defaults tokyonight / catppuccin-latte (FR-004)
    ├── chrome/
    │   ├── frame.ts       # root bg, body rail, panel rail, scroll bar colours, overlay layers,
    │   │                  # content metrics for the one-sided border (R5, R6, R7)
    │   ├── state.ts       # row backgrounds: selection, header, stripes (R2); styled chrome lines
    │   ├── breadcrumb.ts  # segments kept as a list for styling, same truncation
    │   └── panel.ts       # "SLEDOVANÉ" title, bars on a track
    ├── components/
    │   └── status.ts      # screen label, key chips, theme label (plain text unchanged in meaning)
    ├── palette/
    │   ├── view.ts        # overlay, dimming layer, styled entry rows; SelectRenderable removed
    │   └── actions.ts     # one entry per theme (R10)
    ├── views/
    │   ├── national-rows.ts  # cards and badge; collapse rule (FR-020, FR-021)
    │   ├── areas.ts          # header kinds; council chips; seat strip (FR-022)
    │   ├── search.ts         # header kinds
    │   └── watchlist.ts      # header kinds
    └── app.ts             # theme wiring, overlay open/close, capability-driven depth

tests/
├── ui/
│   ├── theme-contrast.test.ts   # NEW: SC-003 over every theme
│   ├── theme-depth.test.ts      # NEW: nearest-256 mapping
│   ├── colour.test.ts           # stripes, selection, regions, monochrome
│   ├── frame.test.ts            # 80 × 24 fit, content metrics
│   ├── palette.test.ts          # overlay, chips, theme entries
│   ├── national.test.ts         # cards (rewritten summary assertions)
│   ├── areas.test.ts            # chips, seat strip (rewritten summary assertions)
│   ├── panel.test.ts            # theme names updated
│   └── redraw.test.ts           # budget under a striped theme
└── integration/
    └── preferences.test.ts      # legacy mapping
```

**Structure Decision**: the existing single project. All changes are inside `src/ui` plus one line of
preference mapping. No directory is added except the new test files.

## Sequencing

Each step is a slice that leaves the application working and the suite green. Steps 1 and 2 give
User Story 1, steps 3 and 4 give User Story 2, steps 5 and 6 give User Story 3, and step 7 gives
User Story 4. Step 8 covers the 256-colour edge case.

1. **Themes as slots.** The six themes, the slot table, role → slot, the contrast test, and deletion of
   `indexed`. The existing `dark`, `light` and `high-contrast` tests are rewritten to the new names.
2. **Row backgrounds.** `kind` on rows and the header helper, full-width padding, stripes and the
   selection in `frameState`.
3. **Region surfaces.** Root, body rail, panel rail, scroll bar colours, warning row and new content
   metrics, including the 80 × 24 fit test.
4. **Title and status bars.** Breadcrumb segments, live indicator, clock, screen label, key chips and
   theme label.
5. **Defaults and persistence.** `tokyonight` and `catppuccin-latte` defaults, legacy mapping, cycle
   order.
6. **Palette.** Overlay and dimming layer, styled entries with chips, theme entries.
7. **Summary surfaces.** Status badges, national cards with the collapse rule, council chips, seat
   strip and bar tracks.
8. **Colour depth.** `depth.ts` and its use in `colorFor` when the terminal reports no true colour.

## Complexity Tracking

No violations to justify.

## Carried risks

- **Summary assertions.** Rewriting the national and council summaries touches assertions written for
  the first feature. Each rewrite must keep asserting every figure and marker (FR-026), not merely the
  new layout.
- **Alpha dimming in tests.** The dimming layer was verified to blend in the test renderer. If a
  terminal renders the blend poorly, the fallback is to re-render the rows in `muted` (R7,
  alternative), at the cost of invalidating them.
- **Colour depth detection.** It runs natively and settles within about 5 s of start (R8). The theme
  must re-resolve when a `capabilities` event arrives. Today `app.ts` reads the capabilities once, at
  start, so this is a small new obligation, not an existing one.
- **Stale research on OpenTUI.** Findings are for 0.5.11. An upgrade must re-check R1 (glyph-only text
  backgrounds) and R5 (a border colour enabling a full border), because the design works around both.
