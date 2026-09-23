# Data Model: TUI Visual Refresh

**Feature**: `002-tui-visual-refresh` | **Date**: 2026-09-23

No database schema changes. The only persisted value is the existing `theme` key in `app_config`.
Everything else here lives in memory and is rebuilt on every draw.

---

## Theme

A named set of colour slots. Exactly one is active at a time.

| Field | Type | Rule |
|---|---|---|
| `name` | `ThemeName` | One of the six names below. Also the stored value |
| `label` | string | Shown in the status bar and the palette, e.g. "Tokyo Night" |
| `contrastByBrightness` | boolean | True only for High contrast (001 FR-062) |
| `slots` | `Record<Slot, string \| null>` | Hex `#rrggbb` per slot. Every slot is `null` in monochrome only |
| `selectionText` | `Slot` | The slot the selected row's text uses: `text`, except `bg` in High contrast |

**ThemeName**: `tokyonight` · `catppuccin-mocha` · `gruvbox` · `nord` · `catppuccin-latte` ·
`high-contrast`. The theme key cycles through them in that order.

**Monochrome**: not a ThemeName and not selectable. Every slot is `null`, so no foreground or background
is ever emitted (FR-008). It is resolved when `NO_COLOR` is set or the terminal lacks colour, and it
does not overwrite the stored choice.

### Stored value (preference `theme`)

| Stored | Resolves to | Note |
|---|---|---|
| a ThemeName | that theme | |
| `dark` | `tokyonight` | Legacy value (FR-006a). Not rewritten on read |
| `light` | `catppuccin-latte` | Legacy value (FR-006a) |
| absent or anything else | `tokyonight`, or `catppuccin-latte` if the terminal reports light | FR-004 |

Colour availability is checked before the stored value, as today: `NO_COLOR` or no colour gives
monochrome.

## Slot

One meaning, the same in every theme (FR-002).

| Slot | Meaning | Kind |
|---|---|---|
| `bg` | Content area, even data rows, root | background |
| `panel` | Title bar, status bar, side panel | background |
| `element` | Table header, cards, earlier breadcrumb segments, palette | background |
| `zebra` | Odd data rows | background |
| `sel` | Selected row | background |
| `track` | Unfilled part of a bar column, scroll bar track | background |
| `border` | Dividers, the rule under a table header | foreground |
| `borderActive` | Palette frame | foreground |
| `text` | Body text | foreground |
| `muted` | Codes, timestamps, hints, card labels | foreground |
| `subtle` | Secondary figures, status bar labels, earlier breadcrumb levels | foreground |
| `primary` | Headings, column titles, content rail, current breadcrumb segment | both |
| `accent` | Sorted column, side panel rail and title, application badge, key chips | both |
| `success` | Rises, status badges | both |
| `error` | Falls | foreground |
| `warning` | Stale-data bar and badge | both |
| `onAccent` | Text drawn on a `primary`, `accent`, `success` or `warning` background | foreground |
| `bar` | Filled part of a share bar | foreground |

### Role → slot (FR-003)

The existing roles keep their meaning and resolve through slots:

| Role | Foreground slot | Bold |
|---|---|---|
| `heading` | `primary` | yes |
| `selection` | the theme's `selectionText` | yes |
| `warning` | `warning` | yes |
| `increase` | `success` | no |
| `decrease` | `error` | no |
| `muted` | `muted` | no |
| `accent` | `accent` | yes |
| `subtle` | `subtle` | no |

Two roles are new: `accent` (the sorted column, the side panel title, emphasised figures) and `subtle`
(secondary figures, chip and status bar labels). Chrome and summary rows need them, and each carries
one meaning, as 001 FR-059 requires. Rows of `kind: "rule"` are drawn in the `border` slot.

The `indexed` colour kind is removed (research R10).

## Theme values

These are the mock's values, with the contrast adjustments from research R9 applied (marked *). This
table is the source for `themes.ts`.

| Slot | Tokyo Night | Catppuccin Mocha | Gruvbox Dark | Nord | Catppuccin Latte | High contrast |
|---|---|---|---|---|---|---|
| bg | `#1a1b26` | `#1e1e2e` | `#282828` | `#2e3440` | `#eff1f5` | `#000000` |
| panel | `#16161e` | `#181825` | `#1d2021` | `#272c36` | `#e6e9ef` | `#262626`* |
| element | `#24283b` | `#313244` | `#3c3836` | `#3b4252` | `#dce0e8` | `#1f1f1f` |
| zebra | `#1e2030` | `#24243a` | `#2f2c2a` | `#333a47` | `#e7eaf0` | `#141414` |
| sel | `#2e3c64` | `#45475a` | `#504945` | `#434c5e` | `#ccd0da` | `#ffffff` |
| track | `#292e42` | `#313244` | `#3c3836` | `#3b4252` | `#dce0e8` | `#2a2a2a` |
| border | `#3b4261` | `#45475a` | `#504945` | `#4c566a` | `#bcc0cc` | `#ffffff` |
| borderActive | `#7aa2f7` | `#cba6f7` | `#fabd2f` | `#88c0d0` | `#8839ef` | `#ffff00` |
| text | `#c0caf5` | `#cdd6f4` | `#ebdbb2` | `#e5e9f0` | `#4c4f69` | `#ffffff` |
| muted | `#697196`* | `#787b90`* | `#928374` | `#848ea2`* | `#7b7e8e`* | `#808080`* |
| subtle | `#737aa2` | `#a6adc8` | `#bdae93` | `#aeb7c6` | `#6c6f85` | `#d0d0d0` |
| primary | `#7aa2f7` | `#89b4fa` | `#88a99c`* | `#88c0d0` | `#1a5ad8`* | `#ffffff` |
| accent | `#bb9af7` | `#cba6f7` | `#fabd2f` | `#96b1cc`* | `#7e35de`* | `#ffff00` |
| success | `#9ece6a` | `#a6e3a1` | `#b8bb26` | `#a3be8c` | `#2d701e`* | `#e0e0e0`* |
| error | `#f7768e` | `#f38ba8` | `#fc7c6c`* | `#d89fa4`* | `#c50e36`* | `#a0a0a0`* |
| warning | `#e0af68` | `#f9e2af` | `#fabd2f` | `#ebcb8b` | `#8b5812`* | `#ffff00` |
| onAccent | `#1a1b26` | `#1e1e2e` | `#282828` | `#2e3440` | `#eff1f5` | `#000000` |
| bar | `#7aa2f7` | `#b4befe` | `#8ec07c` | `#88c0d0` | `#1e66f5` | `#ffffff` |
| selectionText | text | text | text | text | text | bg (black on white) |

## SemanticRow (extended)

Existing fields (`cells`, `role`, `columns`) are unchanged.

| Field | Type | Rule |
|---|---|---|
| `kind` | `"header" \| "rule" \| "data"` or absent | Absent means text. Only `data` rows are striped (research R3) |

## Cell (extended)

| Field | Type | Rule |
|---|---|---|
| `surface` | `"element" \| "primary" \| "accent" \| "success" \| "warning"` or absent | The cell's own background, for cards, chips and badges. Text on `primary`, `accent`, `success` or `warning` uses `onAccent`. Text on `element` keeps its role's colour |
| `bar` | boolean or absent | Marks a bar cell, so its unfilled columns get the `track` background |
| `fgSlot` | `Slot` or absent | Overrides the role's foreground with a slot directly. Used only for the `▌` joins, whose foreground is the left segment's background slot |

## Row background (derived, not stored)

Decided in `frameState` for each row, in this order (the first match wins):

1. The selected row: `sel`.
2. `kind` is `header`: `element`.
3. `kind` is `data`, at an odd position counting from 0 after the last header: `zebra`.
4. Otherwise: `bg`.

The background fills the gutter, every cell without a `surface`, and the padding up to the full row
width (research R1). In monochrome it is `null` throughout.

## Chrome state (derived, per draw)

| Region | Background | Content |
|---|---|---|
| Title bar | `panel` | Breadcrumb segments (below), then the live indicator or warning badge and the clock, right-aligned |
| Warning row | `warning` | The existing stale-data text, in `onAccent`, bold |
| Content | `bg`, rail `primary` | The screen's rows |
| Side panel | `panel`, rail `accent` | The watchlist, with the title "SLEDOVANÉ" in `accent` |
| Status bar | `panel` | Screen label chip, key chips, the theme label right-aligned |

**Breadcrumb segments**: an application badge "◆ VOLBY" on `accent`, the earlier levels on `element` in
`text`, and the current level on `primary` in `onAccent`. Segments are joined by `▌`, drawn in the
left segment's background colour on the right segment's background. The existing left truncation
rule applies to the segment list before styling (001 FR-055).

**Screen label**: one label per `Screen.kind`: PŘEHLED, OKRESY, OKRES, ZASTUPITELSTVO, KANDIDÁTI,
SLEDOVANÉ, HLEDÁNÍ, NÁPOVĚDA, and PŘÍKAZY while the palette is open.
