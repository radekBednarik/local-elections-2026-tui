# Quickstart: validating the results chart panel

**Feature**: `006-results-chart-panel`

How to prove the feature works end to end. The expected behaviour and exact strings are in
[contracts/interface.md](contracts/interface.md). The rules behind them are in
[data-model.md](data-model.md) and [research.md](research.md).

## Prerequisites

- Bun 1.4.2 or later, and dependencies installed (`bun install`).
- The replay harness (`tools/replay/server.ts`). It serves the national document and the
  fixture councils `551082`, `554782` and `582786`.
- A terminal you can resize, at least 100 × 30 for the main checks.

## 1. Automated checks

```powershell
bun test
bun run typecheck
bun run check
```

All three must pass. The tests that carry this feature:

| What | Where | Proves |
|---|---|---|
| `rankSlices`: six ranked slices plus one aggregate. Exactly 7 entries give `Ostatní (1 …)`. 6 or fewer give no aggregate. Ties keep table order. Σ fractions = 1 | `tests/unit/chart.test.ts` (new) | FR-004, FR-005, edge cases |
| Aggregate votes and share equal the sums of their members (parties). For candidates, they are the remainder of the party's votes | `tests/unit/chart.test.ts` | FR-009, research R8 |
| Change markers: each ranked slice compares with its own previous votes. The aggregate compares sums, and is `new` when any member is new | `tests/unit/chart.test.ts` | FR-010 |
| Pie cells: the ellipse test, clockwise from twelve o'clock, and angular area proportional to share within one cell's tolerance, for a fixed 2-slice and 7-slice input | `tests/unit/chart.test.ts` | FR-004, US1/AC2 |
| Every slice's texture is distinct. The plain-text pie holds only textures and spaces | `tests/unit/chart.test.ts` | FR-007, SC-003 |
| `chartLayout` radius shrinks with height and width, is capped at 16 and floored at 4, and the legend always fits. It is 15 at the mock's 100 × 30 and 16 from 31 rows | `tests/unit/chart.test.ts` | Research R3 |
| `chartPaneWidth` and `chartFits` at 92, 93, 100 and 200 columns | `tests/ui/panel.test.ts` | FR-013, research R3 |
| `chartContext` for national (all parties, not 20), council, candidates, and a council without results (no data yet) | `tests/integration/screen.test.ts` | FR-001, FR-011, US2/AC2 |
| Legend figures equal the table's cell text for the same snapshot, in all three contexts | `tests/integration/screen.test.ts` | FR-009, SC-002 |
| Title and subtitle wording, `průběžné` / `konečné`, and Czech plurals of the aggregate | `tests/unit/chart.test.ts` | FR-014, FR-015 |
| Reduced tables: at pane width, national and council shed the bar and then the seat columns, and candidates collapse `Mandát` to `●`. No figure is cut. At 80 columns without the pane, output is unchanged | `tests/ui/national.test.ts`, `tests/ui/areas.test.ts` | FR-012, research R5 |
| The candidate table's new `Podíl` column shows the published `HLASY_PROC`, or `–` | `tests/ui/areas.test.ts` | Research R5 |
| `g` maps to `chart` | `tests/unit/keymap.test.ts` | FR-001 |
| Registry: `chart` is unavailable off chart screens and when it does not fit, each with its reason. The footer chip reads `g graf` / `g zavřít graf`. `back` is available while the chart is shown | `tests/ui/palette.test.ts`, `tests/unit/status-bar.test.ts` | FR-002, research R6 |
| The help screen lists `g` | `tests/ui/help-and-language.test.ts` | FR-002 |
| Every `slice*` slot is defined as `#rrggbb` and reaches 3:1 on `panel` in every theme | `tests/ui/theme-contrast.test.ts` | Research R7, SC-003 |
| Pane cells are painted from the theme and repaint on a theme switch. In monochrome nothing is painted | `tests/ui/colour.test.ts` | FR-006, FR-007 |
| Frame: the panel takes the chart width, `contentWidth` subtracts it, and the watchlist reappears on close | `tests/ui/frame.test.ts` | FR-003, spec edge case |
| Open, then close: the selection, offset and sort of the entry are unchanged | `tests/ui/stability.test.ts` | FR-003, SC-005 |
| A refresh that re-ranks two parties swaps their slices and marks the changed votes, with no key press | `tests/ui/stability.test.ts` | FR-010, SC-004 |
| Shrinking below the fit while the chart is shown closes it with the notice. Widening does not reopen it (`chartAfterResize`) | `tests/unit/chart.test.ts` | FR-013, research R4 |
| `readNationalParties`, `listCouncilParties` and `listElected` return `previousVotes` (and `votesChange` for `listElected`) from the previous snapshot, or `null` after one snapshot | `tests/integration/snapshots.test.ts` | FR-010, research R8 |
| The candidate table's votes carry change markers | `tests/ui/areas.test.ts` | Contract § 4, § 5 |
| Re-sorting the council table with the pane open reorders the table but not the chart | `tests/ui/areas.test.ts` | US2/AC3, research R9 |
| Export content is identical with the pane open or closed | `tests/ui/stability.test.ts` | FR-003 |

## 2. National overview (US1)

```powershell
bun run replay
bun run dev -- --base-url http://localhost:8787 --reset
```

At 100 × 30, on the national overview:

1. The footer shows `g graf`. Press `g`.
   - The view splits. The table on the left keeps `Volební strana · Hlasy · Podíl`, and no
     figure is cut.
   - The pane shows `Graf · ČR`, `podíl platných hlasů · průběžné`, a round-looking pie, and
     seven legend rows, the last one `Ostatní (N stran)`.
   - The footer now shows `g zavřít graf`.
2. Compare the legend with the table. The first six parties' votes and shares are identical to
   the table's. The aggregate equals the rest, since the table shows only 20 parties.
3. Scroll with `PgDn` / `PgUp` or the mouse wheel. The table scrolls as usual. (The national
   table has no sort; the re-sort check is in § 3.)
4. Press `Esc`. The full-width view returns with the same sort and scroll position. Press `g`,
   then `g` again: same result.
5. Open the palette (`Ctrl+P`) and type `graf`. The entry is listed with `g`.

## 3. Council and candidates (US2, US3)

The replay server does not serve the two reference archives
(`KV2026reg20260915_xml.zip`, `KV2026ciselniky20260915_xml.zip`). Without them the district
list and search are empty. For this section, put a small proxy in front of the replay server
that serves `fixtures/2026/reg.zip` and `fixtures/2026/ciselniky.zip` under those names and
forwards everything else. Then point `--base-url` at the proxy.

1. Drill into a fixture council, for example Brno (`582786`, district CZ0642). With `g` pressed
   on the way, or pressed now, the pane shows `Graf · Brno`, and its legend matches the council
   table. Press `s` a few times and move the selection: the table re-sorts and the selection
   moves as usual, and the chart's slice order does not change.
2. `Enter` on a party opens its candidates. The pane follows:
   - the title is `Graf · <party>`, and the subtitle is `podíl hlasů strany · …`,
   - the elected candidates are slices,
   - `Ostatní (N kand.)` holds the rest of the party's votes.
3. Open a council whose result is not published. The pane reads `Zatím není co zobrazit.`

## 4. Themes, no colour, high contrast (SC-003)

With the chart open:
- Cycle `Ctrl+T` through all six themes. The pie and the swatches repaint at once, and every
  slice stays distinguishable.
- In `Vysoký kontrast` all six slices are white, and the textures alone tell them apart.
- Run with `NO_COLOR=1`. The pie is drawn in textures only, and each legend swatch matches its
  slice by texture.

## 5. Width and the watchlist

1. Open the watchlist panel (`Ctrl+B`) on the national view, then press `g`. The chart replaces
   the watchlist. Press `g` again, and the watchlist is back.
2. Narrow the terminal below 93 columns while the chart is open. The pane closes, and the status
   row reads `Graf zavřen: okno je pro něj příliš úzké.` The footer no longer offers `g`, and
   the palette shows it greyed with `okno je pro graf příliš úzké`.
3. At 80 × 24 with no pane, every table looks exactly as before this feature.

## 6. Live refresh (SC-004)

The replay advances the count over `--duration` seconds (300 by default), so the figures keep
changing while you watch:

```powershell
bun run replay -- --duration 120
```

With the chart open on the national view, wait for the next refresh:
- The slices and the legend update without a key press.
- The changed votes carry `▲` in the legend, exactly as in the table.
