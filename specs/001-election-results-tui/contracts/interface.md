# Contract: On-screen interface

**Feature**: `001-election-results-tui` | **Added**: 2026-09-22 (UX amendment, FR-054 to FR-079)

What the user sees and can do. This is a contract because changing it changes what people have
learned; it is not a description of how the rendering works.

---

## Screen regions (FR-054)

```text
┌─ ČR › Okres Brno-město › Brno-Bohunice ──────────────────┬─ Sledované ──┐
│                                                          │ Brno-Bohunice│
│  Stav: průběžné výsledky   Okrsky: 6 / 13                │  46,21 %     │
│                                                          │ Praha 1      │
│   Č. Volební strana          Hlasy   Podíl               │  40,24 %     │
│  ─── ──────────────────  ────────  ──────────            │              │
│    4 KDU-ČSL               15 949  36,56% ███████▌       │              │
│    3 ANO 2011               8 200  18,80% ███▉           │              │
│                                                          │              │
├──────────────────────────────────────────────────────────┴──────────────┤
│ ↑↓ výběr · ⏎ otevřít · esc zpět · w sledovat · e export · ⌘ příkazy     │
└─────────────────────────────────────────────────────────────────────────┘
```

| Region | Always present | Carries |
|---|---|---|
| Title bar | Yes | Breadcrumb of the path taken (FR-055) |
| Content area | Yes | The current screen, scrollable |
| Status bar | Yes | Only the actions available here, with their keys (FR-064) |
| Side panel | When open and there is room | The watchlist (FR-056, FR-057) |

**Stability (FR-058)**: regions keep their position across refreshes. A refresh changes figures inside
a region, never the regions themselves, and never the user's scroll position or selection.

## Breadcrumb (FR-055)

Separator `›`. Truncates from the left when too long, keeping the current location visible, because
"where am I" is the question it exists to answer.

```text
ČR                                          national overview
ČR › Okresy                                 district list
ČR › Okres Brno-město                       one district
ČR › Okres Brno-město › Brno-Bohunice       one council
… › Brno-Bohunice › ANO 2011                candidates, truncated
```

## Side panel (FR-056, FR-057)

| Rule | Behaviour |
|---|---|
| Toggle | One key. State persists between runs |
| Width | Fixed, narrow enough to show a council name and its turnout |
| Auto-hide | Hides when the terminal cannot show it beside a readable content area, returns when there is room |
| Precedence | The content area is never squeezed below readable width to keep the panel open |
| Empty | Says how to add a council rather than showing a blank box |

## Colour roles (FR-059 to FR-063)

Six roles. A colour means the same thing on every screen.

| Role | Used for |
|---|---|
| `heading` | Column headers, region titles |
| `selection` | The highlighted row |
| `warning` | Stale-data warning, failures |
| `increase` | A value that rose since the last refresh |
| `decrease` | A value that fell |
| `muted` | Secondary text: codes, timestamps, hints |

**Not a role**: electoral party. No party is ever coloured (FR-060).

| Theme | Resolution |
|---|---|
| `dark`, `light` | ANSI indexed slots, so the user's own terminal scheme shows through |
| `high-contrast` | Explicit values, since an unknown user palette cannot guarantee brightness separation (FR-062) |

**Colour is always redundant.** Every state it marks is also carried by text, symbol or position, so
the interface is complete without it (FR-063). `NO_COLOR` and a monochrome terminal lose decoration
only.

## Command palette (FR-065 to FR-069)

| Property | Behaviour |
|---|---|
| Opening | One key, from any screen |
| Contents | Every action the application supports, never a subset |
| Shortcut | Shown beside each entry, so using the palette teaches the key (FR-066) |
| Search | Type to narrow; insensitive to case and Czech diacritics, as FR-038 (FR-067) |
| Choosing | Performs the action directly (FR-068) |
| Unavailable here | Shown, marked unavailable, with the reason. Never hidden (FR-069) |
| Dismissing | Esc closes and returns to exactly where the user was |

Hiding an inapplicable action would teach the user the application is smaller than it is. Showing it
greyed with a reason teaches them its shape.

## Bars (FR-070 to FR-074)

Drawn with Unicode eighth-blocks (`▏▎▍▌▋▊▉█`), giving eight sub-steps per column so that 7.62% and
7.76% are visibly different in a narrow column.

| Rule | Behaviour |
|---|---|
| Always beside the figure | The published percentage is the result; the bar is an aid (FR-071) |
| Scale | Proportional to the published percentage, never to a derived value |
| Monochrome | Shape, not colour, so it survives `NO_COLOR` (FR-072) |
| Narrow terminal | Omitted entirely rather than truncated: lose the aid, never the data (FR-074) |
| No trends | No sparklines or time series. No history is kept to draw one from (FR-073) |

## Mouse (FR-075 to FR-079)

| Input | Action |
|---|---|
| Click a row | Select it |
| Double-click a row | Open it, as Enter does |
| Wheel | Scroll the content area |
| Shift + drag | The terminal's own text selection, preserved (FR-077) |

**Not clickable**: status bar, breadcrumb, side panel. No context menus, no draggable dividers
(FR-079).

**Optional throughout**: every action is reachable by keyboard, and the application is fully usable in
a terminal with no mouse support (FR-078).

## Keys

Additions and changes from [cli.md](./cli.md).

| Key | Action | Where |
|---|---|---|
| `Ctrl+P` | Open the command palette | Everywhere |
| `Ctrl+B` | Show or hide the side panel | Everywhere |
| `Ctrl+T` | Cycle theme: dark, light, high-contrast | Everywhere |

All keys previously documented continue to work unchanged.
