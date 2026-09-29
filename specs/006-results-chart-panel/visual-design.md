# Visual Design Reference: Results Chart Panel

**Status**: Approved by the user on 2026-09-29, against the interactive mock in
`mock/results-chart-panel-mock.html` (also published at
https://claude.ai/artifact/F8hyF1VJqCtCxUndF5Zt5p). This document records the design decisions
the mock encodes, as an input for `/speckit-plan`. The requirements live in `spec.md`; this file
pins down the approved look so the plan does not have to re-derive it from the mock's source.

## The locked design in one paragraph

Pressing `g` on a view with a vote breakdown splits the content area: the existing table stays on
the left, reduced to its identifying columns, and a pane on the right draws a pie chart of the
same breakdown. The six largest entries get their own slice, each with a rank-assigned colour and
a rank-assigned fill texture; everything beyond the sixth is one muted, dot-textured "Ostatní"
slice. A legend below the pie lists every slice with its swatch, name, absolute votes (with the
app's ▲▼· change markers) and percentage share. Pressing `g` again (or Esc) closes the pane and
restores the full-width view untouched.

## Layout geometry (from the mock, at 100 × 30 cells)

Left to right inside the body region:

| Region | Cells (mock) | Notes |
|---|---|---|
| Content rail | 1 col | Existing heavy left border, `primary` slot (frame.ts) |
| Reduced table | ~49 cols | Sheds columns per the rule below |
| Scroll bar | 1 col | Existing pinned scroll bar (`track` + `muted` thumb) |
| Pane rail | 1 col | Heavy border, `accent` slot – the watchlist panel's own styling |
| Chart pane | ~48 cols | `panel` tone background, like the watchlist panel |

Title bar and status bar are untouched. The pane is a sibling of the scroll area inside the body,
exactly where `Frame`'s watchlist panel sits (`frame.ts` `setPanelVisible`); the chart pane and
the watchlist occupy the same region, chart wins while open.

Pane contents, top to bottom: title line (accent, bold, e.g. `Graf · ČR`), subtitle line (muted,
e.g. `podíl platných hlasů · průběžné`), the pie, then one legend row per slice.

## The pie

- Terminal cells are ~2:1 (height : width), so the disc is an ellipse in cell space that reads as
  a circle on screen: a cell at column offset `sx`, row offset `sy` from the centre is inside when
  `sx² + (2·sy)² ≤ R²`. The mock uses `R = 16` columns → a 33 × 17 cell disc.
- Slices run clockwise from twelve o'clock, ordered by descending votes, angle proportional to
  the entry's share of the whole (valid votes; the party's votes for candidates).
- **As delivered (research R3):** the pane reserves four rows for its title, subtitle and
  spacing, so at 100 × 30 the disc has R = 15 (31 × 15 cells). R = 16 is reached from 31
  rows up, and the radius shrinks with smaller terminals down to R = 8 at 24 rows.
- Each cell inside a slice is drawn as that slice's texture character in that slice's colour, on
  the pane's `panel` background. No borders between slices; texture and colour changes mark the
  boundary.

## Rank palettes and textures

Colour and texture belong to the RANK POSITION (1st..6th largest, then the aggregate), never to a
party or candidate. Textures, fixed across all themes:

| Rank | 1 | 2 | 3 | 4 | 5 | 6 | Ostatní |
|---|---|---|---|---|---|---|---|
| Texture | █ | ▓ | ▚ | ▒ | ▞ | ░ | · |

Slice colours per theme, drawn from each theme's published palette family (approved in the mock;
the plan should add them as theme slots validated by the existing contrast test):

| Theme | 1 | 2 | 3 | 4 | 5 | 6 | Ostatní |
|---|---|---|---|---|---|---|---|
| Tokyo Night | #7aa2f7 | #bb9af7 | #9ece6a | #ff9e64 | #7dcfff | #f7768e | #697196 (muted) |
| Catppuccin Mocha | #89b4fa | #cba6f7 | #a6e3a1 | #fab387 | #89dceb | #f38ba8 | #787b90 (muted) |
| Gruvbox Dark | #83a598 | #fabd2f | #b8bb26 | #fe8019 | #8ec07c | #fb4934 | #928374 (muted) |
| Nord | #88c0d0 | #b48ead | #a3be8c | #d08770 | #81a1c1 | #bf616a | #848ea2 (muted) |
| Catppuccin Latte | #1e66f5 | #8839ef | #3c9628 | #e45401 | #038cc2 | #d20f39 | #7b7e8e (muted) |
| Vysoký kontrast | #ffffff ×6 (textures alone distinguish) | | | | | | #808080 |

**Amended during implementation (research R7):** three Catppuccin Latte tones were darkened
in their own hue to reach 3:1 on the pane's `panel` background: green `#40a02b` →
`#3c9628`, peach `#fe640b` → `#e45401`, sky `#04a5e5` → `#038cc2`.

In monochrome / NO_COLOR nothing is painted and the textures carry the whole meaning, matching
the app's existing principle.

## Legend

One row per slice, in rank order: swatch (two texture characters in the slice colour), name
(truncated with … when long; the aggregate is labelled `Ostatní (N stran)` / `(N kand.)`), votes
right-aligned with the change marker prefix (▲ `success`, ▼ `error`, · new), share right-aligned
(`subtle`). Aggregate row's name in `muted`. Legend figures must equal the table's figures for
the same snapshot.

## Reduced table while the pane is open

Extends the existing "lose the aid before any figure" rule: the inline bar goes first, then seat
columns; name, votes (`Hlasy`) and share (`Podíl`) always stay.

- National: `Volební strana` · `Hlasy` · `Podíl` (cards row collapses to a one-line summary)
- Council: `Č.` · `Volební strana` · `Hlasy` · `Podíl`
- Candidates: `Poř.` · `Kandidát` · `Hlasy` · `Podíl` · elected marker `●` (`success`)

## Interaction

- `g` toggles the pane; the footer chip reads `g graf` closed and `g zavřít graf` open; the
  command palette carries the same action and greys it with a reason when the terminal is too
  narrow (existing FR-069 pattern) – below the minimum split width the footer hint is hidden.
- The left table remains fully interactive (selection, sort, drill-down, watch, export); the pane
  follows the current screen's context and updates on every data refresh, re-ranking slices.
- Esc closes the pane before it acts as "back".

## Existing mechanisms to reuse (pointers for the plan)

- Side pane placement and toggling: `src/ui/chrome/frame.ts` (watchlist panel, `setPanelVisible`).
- Key → intent → action registry: `src/ui/keymap.ts`, `src/ui/palette/actions.ts` (`g` is free).
- Status/footer chips and unavailable-with-reason: `src/ui/components/status.ts`,
  `src/ui/palette/view.ts`.
- Change markers and Czech formatting: `src/domain/status.ts` (`changeMarker`),
  `src/ui/format.ts` (`formatInteger`, `formatPercent`, `pad`).
- Theme slots and the contrast test: `src/ui/theme/themes.ts`,
  `tests/ui/theme-contrast.test.ts` – the six slice colours per theme are new slots to add there.
- The mock itself (`mock/results-chart-panel-mock.html`) contains a working reference
  implementation of the pie-cell math, the cutoff/aggregation and the legend layout in plain
  JavaScript, directly portable.
