# Research: Results Chart Panel

**Feature**: `006-results-chart-panel` | **Date**: 2026-09-29 | **Plan**: [plan.md](plan.md)

Every decision below was taken against the current code (`src/ui/**`, `src/storage/queries/**`)
and the approved design in [visual-design.md](visual-design.md). No NEEDS CLARIFICATION remains.

---

## R1 – Rendering the pie inside OpenTUI

**Decision**: The pie is ordinary text. Each pane row is a `SemanticRow` whose cells are runs of
one slice's texture character, coloured through `fgSlot`. The pane renders through the existing
`styledBlock` path into the panel's single `TextRenderable`, exactly as the watchlist panel does.

**Rationale**:
- No new rendering path. `toTextLines` gives the plain form (textures only), so tests can assert
  the pie as text and the monochrome guarantee holds by construction (`row.ts` never consults a
  theme).
- `styledBlock` already joins rows with newline chunks, and a run of equal cells collapses into
  one chunk, so a 33 × 17 disc costs well under a hundred chunks.
- The cell test from the mock is portable as is: a cell at column offset `sx` and row offset `sy`
  from the centre is inside when `sx² + (2·sy)² ≤ R²`. Its angle is `atan2(sx, −2·sy)`, taken
  clockwise from twelve o'clock, and it belongs to the first slice whose cumulative share reaches
  that angle's fraction.

**Alternatives considered**:
- `FrameBufferRenderable` with per-cell drawing. Rejected: it adds a second drawing path that
  the plain-text tests cannot see, and it needs its own theme handling.
- Braille or half-block sub-cell rendering. Rejected: textures would no longer be one character
  per cell, and legibility without colour (FR-007) would be lost.

## R2 – Where the pane lives: one side region, two contents

**Decision**: The chart pane reuses `Frame.panel`, the box the watchlist already occupies. The
frame gains a panel width that the caller sets. `setPanelVisible(visible, width = PANEL_WIDTH)`
sets the box's width, and `contentWidth` subtracts `width + 1` instead of the fixed
`PANEL_COST`. `applyPanel` decides the content: chart rows when the chart is shown, the
watchlist rows otherwise.

**Rationale**:
- The spec says the two occupy the same region and that the chart wins (Assumptions, Edge
  Cases). One box with two contents gives that by construction.
- The watchlist is restored on close for free. `sidePanelOpen` (the user's intent) is never
  touched by the chart, so when the chart hides, the next draw shows the watchlist again if it
  fits.
- `frame.ts` warns that adding and removing children of the body puts the scroll bar on the
  wrong edge. Reusing the one panel box keeps the number of such swaps unchanged.

**Alternatives considered**: A second box beside the panel. Rejected: it is the swap the frame
comment warns about, and it needs a precedence rule between two boxes that would otherwise be
free.

## R3 – Split geometry and the fit rule

**Decision** (constants in `src/ui/chrome/panel.ts`, next to `panelFits`):

| Constant | Value | Meaning |
|---|---|---|
| `CHART_MIN_TABLE` | 50 | Columns the table keeps (gutter included, so view width 48) |
| `CHART_MIN_PANE` | 40 | Narrowest chart pane: a pie of radius 16 plus a legend row |
| `CHART_MAX_PANE` | 60 | Beyond this, extra width goes to the table |

- `chartPaneWidth(raw) = min(CHART_MAX_PANE, raw − 1 − CHART_MIN_TABLE)`. Here `raw` is
  `frame.rawContentWidth`, and the `1` is the pane's rail.
- `chartFits(raw) = chartPaneWidth(raw) ≥ CHART_MIN_PANE`. That means `raw ≥ 91`, which is a
  terminal of at least 93 columns.
- At the mock's 100 columns: raw = 98, the pane is 47 and the table 50. That matches the mock's
  48 / 49 split within a column.

**Height does not gate the chart.** At the supported minimum of 24 rows, the content area has 21
rows (20 while the warning row shows). Pane rows are laid out as:
- 3 rows for the title, subtitle and a blank,
- up to 7 legend rows,
- 1 blank.

That leaves at least 9 rows for the pie, which is a radius of 8. The radius is
`R = min(⌊(paneWidth − 3) / 2⌋, pieRows − 1)`, capped at 16 (the approved size) and floored at 4.
So the pie shrinks with the terminal and never removes the legend.

The floor of 4 can exceed `pieRows` only below the supported minimum. At 80 × 24 or larger there
are always at least 9 pie rows, so an overflowing pie is unreachable in practice.

**Deviation from the mock.** The mock draws R = 16 (33 × 17) at 100 × 30. Here, 30 rows give a
content area of 27, and so `pieRows = 27 − 4 − 7 = 16` and R = 15, a 31 × 15 disc. The mock
packs the legend straight under the pie, with no title spacing. The four fixed rows here (title,
subtitle and two blanks) keep the pane readable, and R = 16 is reached from 31 rows up. The shape,
textures and proportions are unchanged; only the disc is one step smaller.

**Rationale**: The table always wins, as with the watchlist (FR-057, FR-013). The numbers come
from the reduced table's real needs (R5), not from an even split: at 100 columns an even split
would leave the council table two columns short, and it would cut `Podíl`.

## R4 – Open state, visibility, Esc and shrinking

**Decision**: `App` gains `chartOpen: boolean`, the user's intent, like `sidePanelOpen` but not
persisted. On every draw:

```
chartShown = chartOpen && CHART_SCREENS.includes(screen.kind) && chartFits(raw)
```

- **`g`** toggles `chartOpen`. It is unavailable, with a reason, on other screens and when the
  chart does not fit (R6).
- **Navigation** keeps the intent. Drilling from the national view to the districts hides the
  pane, and the watchlist returns if the user has it open. Opening a council then shows the chart
  again, now for that council ("the pane follows the current screen's context",
  visual-design.md).
- **Esc** (`back`) closes the pane first when it is shown, and pops the stack only when it is
  not. `back`'s availability becomes `depth > 1 || chartShown`, so the palette and the footer
  never say "jste na úvodní obrazovce" while Esc would in fact close the pane.
- **Shrinking**: a draw that finds `chartOpen`, a chart screen, the pane shown on the previous
  draw, and `!chartFits` sets `chartOpen = false` and a notice: "Graf zavřen: okno je pro něj
  příliš úzké." The spec says the pane closes, not that it hides. Widening the window again does
  not reopen it.
- **Selection, scroll and sort** live on the navigation entry and in `App.sort`. Neither changes
  on open or close. Only the composition width changes (FR-003, SC-005).

**Alternatives considered**: Closing the pane on every navigation. Rejected: the council to
candidates drill-down is exactly where a user wants the chart to follow. A persisted preference
was rejected too (YAGNI: nothing in the spec asks for it).

## R5 – Reduced tables: a width rule, not a pane flag

**Decision**: The table builders shed columns by width alone, extending the existing FR-074
rule. They never ask whether the pane is open.
- **National and council**: the bar goes first (existing `barsFit`). Then the seat columns go
  when the width cannot hold them beside a name of 20 columns:
  - national `Mandáty` + seat `Podíl`: shed below 67,
  - council `Mandáty`: shed below 61.
  Once shed, the name column takes the remaining width with a floor of 14, instead of the fixed
  floor of 20 that would overflow and cut `Podíl`.
- **Candidates**: the table gains `Podíl`, which is the published `HLASY_PROC`, the share of the
  party's votes (R8). Below 63 columns, the `Mandát` column (`ano`, 8 wide) collapses to a
  one-cell column showing `●` in `increase` for an elected candidate.
- **National cards**: these already collapse to compact lines by width (`cardRows` returns
  null), so the one-line summary in visual-design.md needs no change.

**Rationale**:
- One rule for every width, testable by calling the builder at a width. An 80-column terminal
  without the pane composes at view width 76, above every threshold, so its tables are
  byte-for-byte unchanged.
- **Side effect, accepted and recorded**: with the watchlist open at 89–94 columns, the national
  table today overflows. Its name floor of 20 plus the fixed 47 exceeds a view of 62, and the
  clamp cuts the seat share. It now sheds the seat columns instead, which is what FR-074 always
  required.

**Alternatives considered**: A `compact` option threaded from `App` into each builder. Rejected:
it gives two ways to lay out one table, and it leaves the watchlist overflow in place.

## R6 – The key, the registry and the footer chip

**Decision**:
- **Key**: `g` → `{ kind: "action", id: "chart" }` in `keymap.ts`. `g` is free.
- **Registry**: one entry, `chart`:
  - label "Zobrazit nebo skrýt graf", hint "graf", key `g`,
  - `where`: "přehled ČR, zastupitelstvo, kandidáti".
  - `unavailable`, checked in this order:
    1. not a chart screen → "graf je jen pro ČR, zastupitelstvo a kandidáty",
    2. `!chartFits` → "okno je pro graf příliš úzké".
- **`ActionContext`** gains optional `chartOpen?: boolean` (the pane is shown) and
  `chartFits?: boolean`, each read as false when absent. They are optional because many existing
  tests build an `ActionContext` literally, and none of those contexts has a chart.
- **`Action`** gains an optional `hintFor?: (c: ActionContext) => string`. The status bar uses
  it in place of `hint`. For `chart` it returns "zavřít graf" when the pane is shown and "graf"
  otherwise. The palette and the help screen keep the static label.
- **Placement**: directly after `open`, so a narrow footer drops it late.

**Rationale**:
- One entry keeps the footer, the palette and the help screen in step (the registry's own rule).
- The only dynamic part is the chip's wording, and `hintFor` expresses that in one optional
  field, without two entries fighting over one key.

**Alternatives considered**: Two entries, `chart-open` and `chart-close`. Rejected: the help
screen would list `g` twice, and the key map would need state to pick between them.

## R7 – Slice colours as theme slots, and their contrast

**Decision**: `SLOTS` gains `slice1` … `slice6`, one per rank. Every theme defines them with the
approved values from visual-design.md, and `MONOCHROME` gets null automatically. The aggregate
slice uses the existing `muted`.

The contrast test gains `["slice1".."slice6", 3, ["panel"]]`. The 3:1 floor is WCAG 1.4.11, for
non-text graphics. The pie and the swatches are drawn only on `panel`.

Measured against `panel`:

| Theme | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| Tokyo Night | 7.14 | 7.77 | 9.84 | 8.84 | 10.48 | 6.80 |
| Catppuccin Mocha | 8.34 | 8.64 | 11.81 | 9.92 | 11.29 | 7.58 |
| Gruvbox Dark | 6.09 | 9.67 | 7.94 | 6.49 | 7.79 | 4.77 |
| Nord | 7.00 | 4.94 | 6.87 | 4.92 | 5.20 | 3.42 |
| Catppuccin Latte | 4.04 | 4.45 | **2.75** | **2.45** | **2.30** | 4.46 |
| Vysoký kontrast | 21 ×6 | | | | | |

Three Latte tones fail: green `#40a02b`, peach `#fe640b` and sky `#04a5e5`. Following the
002 R9 precedent, each is darkened in its own hue until it reaches 3:1, and nothing else is
touched. The nudged values are fixed when the test is written red first, and recorded in
`visual-design.md` as an amendment.

In high contrast all six are `#ffffff` (visual-design.md). The theme's `contrastByBrightness`
principle holds, because texture separates the slices.

**Rationale**: Theme slots are how every other colour in the app is added and tested. A slot per
rank keeps "colour belongs to the rank" visible in the type itself.

**Alternatives considered**: Reusing `primary`, `accent`, `success` and so on for the slices.
Rejected: that gives only five distinct hues in some themes, and it overloads roles whose
meaning is fixed (`roles.ts`: "so the set cannot quietly grow a second meaning").

## R8 – Where the figures come from, per context

**Decision**: One pure input shape per chart, `ChartEntry { name, votes, sharePct,
previousVotes }`. For each context, the entries come from existing queries, in their unsorted
table order, which is the tie-break (FR-005).

| Context | Entries | Share | Whole |
|---|---|---|---|
| National | `readNationalParties(db, type, -1)`, **all** parties (SQLite `LIMIT -1`), not the table's 20 | published `votesPct` | Σ votes (= valid votes) |
| Council | `listCouncilParties(db, kodzastup)` | published `votesPct` | Σ votes |
| Candidates | elected candidates with published votes (`listElected`) | published `HLASY_PROC` (share of the party's votes) | the party's `votes` |

The aggregate "Ostatní" slice:
- **Parties**: votes are Σ of the aggregated entries' votes, and the share is Σ of their
  published shares. That makes FR-009 ("equal to the sum of the entries it aggregates") hold
  exactly, rounding included. The count is the number of aggregated parties.
- **Candidates**: the result document publishes preferential votes **only for elected
  candidates**. Unelected candidates have none (`listRegisteredCandidates` shows "–"). A
  party's votes in a Czech municipal election are the sum of its candidates' votes; the fixture
  confirms this (481 / 6 916 = 6.95 % = `HLASY_PROC`). So:
  - the aggregate's votes are `party.votes − Σ charted candidates`,
  - its share is that remainder over `party.votes`, formatted with `formatPercent`,
  - its count is `party.candidates − charted`, labelled `Ostatní (N kand.)`.

  This amends FR-009 for candidates, where the entries are not individually published, and is
  recorded in the spec.

The candidate table currently shows no change markers. It gains them through
`ElectedRow.votesChange`, so it carries the same marker as the legend (contract § 4).

Change markers (FR-010):
- `PartyRow` and `CouncilPartyRow` expose the `previousVotes` they already look up.
- `listElected` gains the same lookup against the previous snapshot, and exposes `votesChange`
  and `previousVotes`.
- A ranked slice's marker is `compareValue(votes, previousVotes)`.
- The aggregate's marker is `compareValue(Σ votes, Σ previousVotes)`, with null previous when
  any member lacks one. So a new entry makes the whole aggregate "new" rather than guessing.

**"No data yet"** (FR-011) applies when there are no entries or the whole is 0:
- national totals are null,
- the council has no result,
- the candidate context has no elected candidate with votes.

**Rationale**: Every legend figure is either a published figure or a sum of published figures.
The one derived figure, the candidates' remainder, is derived from published totals and
labelled as an aggregate.

**Alternatives considered**:
- Charting all registered candidates with unknown votes as zero. Rejected: it states a figure the
  source never published (FR-029 in 001).
- Computing parties' shares from votes. Rejected: it can disagree with the table's published
  percentage in the second decimal, which breaks FR-009.

## R9 – Ranking, cutoff and colour assignment

**Decision**:
- `rankSlices(context)` sorts by votes, descending. The sort is stable (ECMAScript
  `Array.prototype.sort`), so ties keep the table's unsorted order.
- It takes the first six as ranked slices 1–6. With more than six entries, the rest form one
  aggregate. With six or fewer there is no aggregate.
- Entries with zero votes still count towards the aggregate's count. They get no ranked slice
  unless fewer than six entries have votes.
- A user sort of the council table does not change the tie-break. The chart ranks from the
  unsorted order, so re-sorting the table never reorders the chart.
- Rank *k* takes texture `█ ▓ ▚ ▒ ▞ ░`[k] and slot `slice{k+1}`. The aggregate takes `·` and
  `muted`.

**Rationale**: FR-004 to FR-007, the exactly-seven edge case, and the tie edge case all follow
mechanically from one small function.

## R10 – Titles, subtitles and legend text (Czech)

**Decision** (full strings in [contracts/interface.md](contracts/interface.md)):
- **Title** (accent, bold):
  - `Graf · ČR`, plus ` · obce` / ` · MČ a MO` when more than one council type exists,
  - `Graf · <council name>`,
  - `Graf · <party name>`.
- **Subtitle** (muted):
  - `podíl platných hlasů · průběžné|konečné` for parties,
  - `podíl hlasů strany · průběžné|konečné` for candidates.
  Provisional status comes from the same `isFinal` the view's badge uses (FR-015).
- **Legend row**: swatch (two texture characters), name (truncated with `…` by `pad`), votes
  (`withChange(formatInteger)`), share (`formatPercent`).

**Rationale**: Every formatter is reused. The pane cannot drift from the tables' number format.

## R11 – Performance

The pane is rebuilt on every draw:
- one query of up to about 230 national parties,
- a sort,
- at most 33 × 17 = 561 cell tests.

That is well under a millisecond, inside the 100 ms keystroke budget (SC-010 in 001), so no
caching is added (YAGNI). `styledBlock` re-sets the panel text on every draw, as the watchlist
panel already does.
