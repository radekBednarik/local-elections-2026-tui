# Interface Contract: Results Chart Panel

**Feature**: `006-results-chart-panel` | **Date**: 2026-09-29 | **Plan**: [plan.md](../plan.md)

This is the user-facing contract: what the user can press, see and rely on. Every string is
exact Czech, and tests assert these strings. The look is fixed by
[visual-design.md](../visual-design.md). The types behind it are in
[data-model.md](../data-model.md).

## 1. Key and action

| Key | Action id | Palette label | Footer chip (closed / open) | Where |
|---|---|---|---|---|
| `g` | `chart` | `Zobrazit nebo skrýt graf` | `g graf` / `g zavřít graf` | `přehled ČR, zastupitelstvo, kandidáti` |

Unavailable reasons, shown greyed in the palette. The footer hides the chip whenever either one
applies (FR-002):

| Condition | Reason |
|---|---|
| Screen is not `national`, `council` or `candidates` | `graf je jen pro ČR, zastupitelstvo a kandidáty` |
| `chartFits(rawContentWidth)` is false (terminal under 93 columns) | `okno je pro graf příliš úzké` |

- `Esc` closes the pane when it is shown, and does nothing else. Pressed again, it goes back as
  before.
- `back` is available while the pane is shown, even at depth 1.
- The help screen lists `g` with its label and `where`, like every other registry entry.

## 2. Layout

When the pane is shown, the body holds, left to right:

| Region | Width |
|---|---|
| content rail | 1 |
| table (gutter included) | `raw − paneWidth − 1` |
| scroll bar | 1 |
| pane rail (`accent`, heavy) | 1 |
| pane (`panel` tone) | `paneWidth = min(60, raw − 51)` |

The title bar, the warning row and the status bar do not change. While the chart is shown, the
watchlist panel is not. The watchlist returns on close if the user has it open and it fits.

## 3. Pane contents (top to bottom)

1. **Title**, `accent` bold:
   - `Graf · ČR` (plus ` · obce` or ` · MČ a MO` when the data holds both council types),
   - `Graf · <council name>`,
   - `Graf · <party name>`.

   Truncated with `…` to the pane width. The title's form states the level (FR-014, spec
   amendment): `ČR` is the national party breakdown, a council name is that council's parties,
   and a party name is that party's candidates.
2. **Subtitle**, `muted`:
   - parties: `podíl platných hlasů · průběžné` or `podíl platných hlasů · konečné`,
   - candidates: `podíl hlasů strany · průběžné` or `podíl hlasů strany · konečné`.
3. A blank row.
4. **The pie**:
   - `2·⌊R/2⌋ + 1` rows, centred in the pane width,
   - clockwise from twelve o'clock, by descending votes,
   - each cell is its slice's texture in its slice's slot.
5. A blank row.
6. **The legend**, one row per slice in rank order:
   ```
   ██ ANO 2011                  ▲1 234 567  24,31 %
   ·· Ostatní (221 stran)         15 941 361  31,02 %
   ```
   - The swatch is two texture characters in the slice's slot.
   - The name is padded or truncated with `…`. The aggregate's name is in `muted`.
   - Votes are `withChange(formatInteger(votes), change)`, right-aligned, and coloured by
     `roleForChange`.
   - The share is `formatPercent(sharePct)`, right-aligned, in `subtle`.

**No data yet** (FR-011). In place of rows 3 to 6:

```
Zatím není co zobrazit.
Graf se vykreslí, jakmile
budou zveřejněny výsledky.
```

**Aggregate labels** follow Czech plurals through the existing plural helper:
- parties: `Ostatní (1 strana)`, `Ostatní (2 strany)`, `Ostatní (5 stran)`,
- candidates: `Ostatní (N kand.)`.

## 4. Figures (FR-009)

- Every legend figure equals the corresponding table cell's text for the same snapshot, apart
  from the change-marker prefix, which both carry identically.
- **Parties**: the aggregate's votes are the sum of the aggregated entries' votes, and its share
  is the sum of their published shares.
- **Candidates**: the aggregate's votes are the party's votes less the charted candidates, and its
  share is that remainder over the party's votes. Unelected candidates have no published
  preferential votes (research R8).

## 5. Reduced tables

These columns follow from width alone (research R5), so they apply whenever the width is this
narrow, pane or not:

| Screen | Full width | At pane width |
|---|---|---|
| National | Volební strana · Hlasy · Podíl · bar · Mandáty · Podíl | Volební strana · Hlasy · Podíl |
| Council | Č. · Volební strana · Hlasy · Podíl · bar · Mandáty | Č. · Volební strana · Hlasy · Podíl |
| Candidates | Poř. · Kandidát · Hlasy · **Podíl** · Mandát | Poř. · Kandidát · Hlasy · Podíl · `●` |

The candidates `Podíl` column is new at every width. It shows the published share of the party's
votes, or `–` where none is published. The candidates `Hlasy` column also gains change markers
(`▲▼·`), exactly as the party tables carry them, so the table and the legend show the same text.

## 6. Notices

| When | Status row text |
|---|---|
| The terminal shrinks below the fit while the pane is shown | `Graf zavřen: okno je pro něj příliš úzké.` |
| `g` is pressed where the chart is unavailable | the existing `Tento příkaz zde není dostupný.` path, with the reason in the palette |

## 7. Refresh (FR-010, SC-004)

- Every draw rebuilds the pane, and a refresh tick draws, so new figures appear within one
  refresh cycle with no key press.
- Slices re-rank by the new votes. Colours and textures follow the new rank, and the legend is
  the mapping.
- Change markers compare each entry with its own previous votes, never with its previous rank.
