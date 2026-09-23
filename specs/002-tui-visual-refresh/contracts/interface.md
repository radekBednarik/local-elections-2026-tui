# Contract: On-screen interface (visual refresh)

**Feature**: `002-tui-visual-refresh` | **Added**: 2026-09-23 | **Amends**:
[001 interface contract](../../001-election-results-tui/contracts/interface.md)

What the user sees. The sections of the 001 contract not named here (breadcrumb truncation, side
panel rules, bars, mouse, keys) are unchanged and still bind. Where the two conflict, this one wins.
The approved picture of this contract is [mocks/index.html](../mocks/index.html), layout C.

---

## Screen regions (supersedes 001 "Screen regions")

At 80 × 24, Tokyo Night, district list:

```text
 ◆ VOLBY ▌ ČR ▌ Okresy ▌                                     ● živě  21:15:03     ← panel
┃                                                                          │      ← bg, rail primary
┃ Okresy  77  načteno 1 z 77                                               │
┃                                                                          │
┃   Okres                                          NUTS         Zastupitel │      ← element
┃   Benešov                                        CZ0201     ◌ načítá se… │      ← bg
┃   Beroun                                         CZ0202     ◌ načítá se… │      ← zebra
┃   Blansko                                        CZ0641     ◌ načítá se… │      ← bg
┃ ▶ Brno-město                                     CZ0642            3 / 3 │      ← sel
┃   Brno-venkov                                    CZ0643     ◌ načítá se… │      ← zebra
┃   …                                                                      │
 OKRESY ▌  ↑↓  pohyb   Enter  otevřít   Esc  zpět   /  hledat   Tokyo Night       ← panel
```

| Region | Surface | Edge | Always present |
|---|---|---|---|
| Title bar | `panel` | none | Yes |
| Warning row | `warning`; a one-off notice ("Motiv: Nord") sits on `element` instead | none | Only while there is something to say |
| Content | `bg` | heavy rail `┃` in `primary` on the left | Yes |
| Side panel | `panel` | heavy rail `┃` in `accent` on the left | When open and there is room (001 FR-057) |
| Status bar | `panel` | none | Yes |

Every cell of the terminal belongs to exactly one surface. None is left to the terminal's own
background.

**Chrome cost at 80 × 24**: title bar 1 row, status bar 1 row, content top padding 1 row, rail
1 column, scroll bar 1 column. That leaves 21 content rows, one more than today.

## Title bar

```text
 ◆ VOLBY ▌ ČR ▌ Okres Brno-město ▌ Brno-Bohunice ▌                  ● živě  21:15:03
 └accent┘   └─element──────────────┘ └──primary──┘                    └success fg┘ └muted┘
```

| Part | Look | Rule |
|---|---|---|
| Application badge | `◆ VOLBY`, `onAccent` on `accent`, bold | Always first |
| Earlier levels | `text` on `element` | Truncated from the left first, with `…` (001 FR-055) |
| Current level | `onAccent` on `primary`, bold | Never dropped |
| Join | `▌` in the left segment's colour on the right segment's colour | No Nerd Font needed |
| Live indicator | `● živě` in `success` on `panel` | Becomes ` ● ZASTARALÉ ` in `onAccent` on `warning` while stale |
| Clock | time of the last successful refresh, `muted` | Right end |

## Status bar

```text
 ZASTUPITELSTVO ▌  ↑↓  pohyb   Enter  kandidáti   Esc  zpět   w  sledovat          Catppuccin Mocha
```

| Part | Look |
|---|---|
| Screen label | Upper case, `onAccent` on `primary`, bold, joined by `▌` |
| Key chip | ` key ` in `onAccent` on `accent`, bold |
| Key label | `subtle` on `panel` |
| Theme label | `muted`, right end |

The set of keys is the one 001 FR-064 already decides. When they do not fit, whole hints are dropped
from the right, never cut.

## Tables

| Row | Background | Text |
|---|---|---|
| Header | `element` | Column titles in `primary`, bold. The sorted column in `accent`, with its ▲ or ▼ |
| Rule under header | `bg` | `─` in `border` |
| Data, even position (0, 2, 4 …) | `bg` | By role |
| Data, odd position (1, 3, 5 …) | `zebra` | By role |
| Selected | `sel` across the full width | `▶` in the gutter. All text in the theme's selection text colour, bold, except a ▲/▼ figure whose own colour reaches 4.5:1 on `sel` |

- Position counts data rows only, from 0, after the most recent header.
- Rises use `success` with `▲`, and falls use `error` with `▼`. The marker is always present.
- A bar is drawn in `bar`, and the unfilled part of its column in `track`. Its length is the
  published share out of 100 (001 FR-070, FR-071).

## National overview summary

```text
┃ Zastupitelstva obcí   ✓ konečné výsledky
┃ Zveřejněno: 2026-10-09T21:15:00 (před 0 s)
┃
┃  SEČTENO OKRSKŮ          ÚČAST                   PLATNÉ HLASY
┃  ·14 722 / 14 722        ·46,07 %                ·87 076 331
┃  ██████████ 100,00 %     █████████▎              59 228 zvolených
┃ Voliči: 8 255 204   Vydané obálky: 3 803 131
```

| Part | Look | Rule |
|---|---|---|
| Status badge | ` ✓ konečné výsledky `, `onAccent` on `success` | The text states the status on its own |
| Card | 3 rows on `element`: label `muted`, figure bold in `primary` (or in `success`/`error` when it rose or fell), then a bar in `success` over `track` with the share beside it, or the elected count in `muted` | Three cards share the width equally with a 2-column gap on `bg` |
| Detail line | Voters and envelopes, `muted`, under the cards | Always shown with the cards |
| Collapse | The cards and detail line become three compact lines, every figure kept | When the cards and 10 table rows do not fit the content height, or a card is too narrow for its figure |

The figures shown are the ones shown today: precincts counted and their share, turnout, valid votes,
elected councillors. The labels move into the cards. The ▲ or ▼ change markers stay beside the
figures.

## Council summary

```text
┃ Brno-Bohunice (Brno)
┃ ────────────────────────────────────
┃ Zastupitelstvo městské části nebo městského obvodu
┃  ✓ konečné výsledky   Okrsky  13 / 13   Účast  46,21 %   Mandáty  21
```

The status badge (`onAccent` on `success`) opens the chip row. Each chip is a label (`subtle` on
`element`) followed by a value (`onAccent` on `primary`, bold).

Under the party table:

```text
┃ Rozdělení mandátů ■■■■■■■■■ ■■■■ ■■ ■■ ■■ ■ ■  21
```

One `■` per seat won, one group per party with at least one seat, in the table's displayed order,
separated by one space. Groups alternate between `primary` and `subtle`, and the total follows as a
figure. The strip is omitted when it does not fit the width. It never wraps, and it is never cut.

## Command palette (amends 001 "Command palette")

The behaviour in the 001 contract is unchanged. The look:

| Part | Look |
|---|---|
| Behind | The content area stays visible, dimmed toward `panel` |
| Frame | Rounded, `borderActive`, title ` Příkazy ` in `accent`, bottom title ` Enter spustit · Esc zavřít ` in `muted` |
| Body | `element` |
| Search field | `›` in `accent`, then the query in `text`, on `bg` |
| Entry | Label in `text`. The key at the right: `accent` on the palette body (`element`), or a chip in `onAccent` on `accent` when highlighted |
| Highlighted entry | `sel` across the full width |
| Unavailable entry | Label and `(reason)` in `muted` |
| Theme entries | `Motiv: <name>`, key `Ctrl+T`. The active theme is unavailable with the reason "tento motiv je aktivní" |

## Themes (supersedes 001 "Colour roles" theme table)

| Theme | Stored name | Default when |
|---|---|---|
| Tokyo Night | `tokyonight` | No stored choice, terminal not reporting light |
| Catppuccin Mocha | `catppuccin-mocha` | |
| Gruvbox Dark | `gruvbox` | |
| Nord | `nord` | |
| Catppuccin Latte | `catppuccin-latte` | No stored choice, terminal reporting light |
| Vysoký kontrast | `high-contrast` | |

- `Ctrl+T` cycles through the themes in the order of this table.
- A stored `dark` becomes Tokyo Night, and a stored `light` becomes Catppuccin Latte.
- The values of every slot are in [data-model.md](../data-model.md#theme-values).

**Monochrome** (`NO_COLOR`, or no colour support): no foreground or background is emitted anywhere,
except the scroll bar thumb, which keeps OpenTUI's own grey as it always has. With no colour to dim
with, the content is withheld while the palette is open rather than showing through it.
Every character above is still drawn, the selection is shown by `▶`, and the stored theme is kept
for next time.

**256 colours** (the terminal reports no true colour): each hex value is shown as its nearest
xterm-256 colour.
