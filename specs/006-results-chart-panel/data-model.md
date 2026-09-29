# Data Model: Results Chart Panel

**Feature**: `006-results-chart-panel` | **Date**: 2026-09-29 | **Plan**: [plan.md](plan.md)

Nothing is persisted. `SCHEMA_VERSION` is unchanged, and the chart's open state lives only in
`App`. Every type below is an in-memory value that is built afresh on each draw.

## ChartEntry

One entry of a vote breakdown, before ranking. Built from existing query rows (see
research R8).

| Field | Type | Source |
|---|---|---|
| `name` | `string` | party name, or candidate name with titles (`listElected`) |
| `votes` | `number` | published votes |
| `sharePct` | `number \| null` | published `HLASY_PROC` (`votesPct`) |
| `previousVotes` | `number \| null` | the same entry in the previous snapshot, or null when there is none |

Order matters. Entries arrive in the view's **unsorted** table order, which is the tie-break.

## ChartContext

What one chart is drawn for (spec Key Entities, "Chart context").

| Field | Type | Notes |
|---|---|---|
| `kind` | `"national" \| "council" \| "candidates"` | the `Screen` kinds that offer the chart (`CHART_SCREENS`) |
| `title` | `string` | e.g. `Graf · ČR`, `Graf · Říčany` (research R10) |
| `subtitle` | `string` | share basis and `průběžné` / `konečné` (FR-015) |
| `entries` | `ChartEntry[]` | empty when there is nothing to chart yet |
| `whole` | `number` | the denominator: Σ votes for parties, the party's votes for candidates |
| `total` | `number` | how many entries the context has; for candidates, the party's candidate count |
| `unit` | `"stran" \| "kand."` | the aggregate's label noun |
| `aggregate` | `"sum" \| "remainder"` | `"sum"` for parties (the aggregate is its members' sum); `"remainder"` for candidates (`whole − Σ ranked`, research R8) |
| `previousWhole` | `number \| null` | candidates only: the party's votes in the previous snapshot, for the remainder's change marker |

For parties, `whole` is Σ `entries.votes` and `total === entries.length`.

**Validation**: `entries.length === 0 || whole <= 0` means "no data yet" (FR-011). The pane then
shows the message and no pie.

**Built by** `chartContext(db, screen, councilType): ChartContext | null`. It returns null for a
screen that does not offer the chart.

## Slice

One charted wedge (spec Key Entities, "Slice").

| Field | Type | Notes |
|---|---|---|
| `rank` | `0..5 \| "other"` | fixes texture and colour, never identity (FR-006) |
| `name` | `string` | the aggregate's name is `Ostatní (N stran)` / `Ostatní (N kand.)` |
| `votes` | `number` | the aggregate's votes are the sum of its members (parties), or `whole − Σ ranked` (candidates) |
| `sharePct` | `number \| null` | the aggregate's share is the sum of its members' published shares (parties), or the remainder over `whole` (candidates) |
| `fraction` | `number` | `votes / whole`: the angle, 0–1 |
| `change` | `ChangeKind` | `compareValue(votes, previousVotes)`; the aggregate compares sums (research R8) |
| `count` | `number` | aggregate only: how many entries it stands for |

**Rules** (research R9):
- Ranked slices are at most 6, in descending votes, with ties kept stable.
- The aggregate exists only when `total > 6`, or, for candidates, when `total > ranked` and the
  remainder is above 0. With exactly seven entries it has `count = 1`.
- Σ `fraction` over all slices is 1, within floating-point error.
- The ranked slices plus the aggregate account for every entry exactly once.

**Built by** `rankSlices(context): Slice[]`, which is pure.

## SliceStyle

This is fixed data, not state.

| Rank | 1 | 2 | 3 | 4 | 5 | 6 | other |
|---|---|---|---|---|---|---|---|
| Texture | `█` | `▓` | `▚` | `▒` | `▞` | `░` | `·` |
| Slot | `slice1` | `slice2` | `slice3` | `slice4` | `slice5` | `slice6` | `muted` |

## Theme slots (addition)

`SLOTS` gains `slice1` … `slice6`. Each theme's values are in visual-design.md, with the three
Catppuccin Latte tones nudged to 3:1 (research R7). `MONOCHROME` gets null for all of them. The
invariant, enforced by `tests/ui/theme-contrast.test.ts`, is that every `slice*` reaches 3:1
on `panel` in every theme.

## Pane geometry

`chartLayout(paneWidth, contentHeight, legendRows) → { radius, pieRows }`. It is pure
(research R3).

- `pieRows = contentHeight − 4 − legendRows`
- `radius = clamp(min(⌊(paneWidth − 3) / 2⌋, pieRows − 1), 4, 16)`

Fit rule, in `panel.ts`:
- `chartPaneWidth(raw) = min(60, raw − 51)`
- `chartFits(raw) = chartPaneWidth(raw) ≥ 40`

## App state (addition)

| Field | Type | Meaning |
|---|---|---|
| `chartOpen` | `boolean` | The user wants the chart. It is toggled by `g`, cleared by Esc while the chart is shown and by a shrink that closes it. |
| `chartShownLastDraw` | `boolean` | Whether the previous draw showed the pane, to tell a shrink that closes it from a screen that never showed it (research R4). |

The shrink rule is the pure `chartAfterResize({ open, shownLastDraw, onChartScreen }, fits) →
{ open, notice }` in `src/ui/views/chart.ts`. It closes the chart, with the notice, only when
all three inputs are true and `fits` is false.

Derived on each draw: `chartShown = chartOpen && isChartScreen(screen) && chartFits(raw)`.

State transitions:

```
closed --g (chart screen, fits)--> open
open   --g | Esc (while shown)--> closed
open   --navigate to non-chart screen--> open (hidden; watchlist may show)
open   --navigate to chart screen--> open (shown, new context)
open   --shrink below fit while shown--> closed + notice
```

## ActionContext and Action (additions)

- `ActionContext.chartOpen?: boolean` is `chartShown`, and false when absent.
- `ActionContext.chartFits?: boolean` is `chartFits(raw)`, and false when absent.
- `Action.hintFor?: (c: ActionContext) => string` is the status bar chip text when it depends on
  state (research R6).

## Query row additions

- `PartyRow.previousVotes: number | null` and `CouncilPartyRow.previousVotes: number | null`.
  The previous-snapshot map is already read; it is now exposed.
- `ElectedRow.votesChange: ChangeKind` and `ElectedRow.previousVotes: number | null`. These use a
  new lookup against the council's previous snapshot, mirroring `listCouncilParties`.
- `readNationalParties(db, type, limit)` is unchanged. The chart passes `-1` for all rows.
- `listRegisteredCandidates` rows gain `votesPct: number | null`, which is `r.votes_pct`, for the
  candidate table's new `Podíl` column (research R5).
