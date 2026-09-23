# Quickstart: validating the visual refresh

**Feature**: `002-tui-visual-refresh`

How to prove the feature works, end to end. What each screen should look like is in
[contracts/interface.md](contracts/interface.md), and the colour values are in
[data-model.md](data-model.md#theme-values).

## Prerequisites

- Bun 1.4.2 or later, and dependencies installed (`bun install`).
- A true-colour terminal: Windows Terminal, or any Linux terminal with `COLORTERM=truecolor`.
- The fixture replay server, so the screens have data before 9 October 2026 (see the
  [001 quickstart](../001-election-results-tui/quickstart.md) for how to point the application at it).

## 1. Automated checks

```powershell
bun test
bun run typecheck
bun run check
```

All three must pass. The tests that carry this feature:

| What | Where | Proves |
|---|---|---|
| Contrast of every slot pair in every theme | `tests/ui/theme-contrast.test.ts` | SC-003 |
| Adjacent regions and rows differ in background | `tests/ui/colour.test.ts` | SC-001, SC-002 |
| Striping follows the display position, after sorting too | `tests/ui/colour.test.ts` | FR-016, scenario 1.3 |
| Selection overrides the stripe and keeps `▶` | `tests/ui/colour.test.ts` | FR-017 |
| No colour at all under monochrome, every figure present | `tests/ui/colour.test.ts` | FR-008, SC-005 |
| Legacy stored `dark` or `light` carried over | `tests/integration/preferences.test.ts` | FR-006a |
| Nearest xterm-256 colour, and the theme following the terminal's report | `tests/ui/theme-depth.test.ts` | Edge case "256 colours" |
| Every screen fits 80 × 24 with the warning shown | `tests/ui/stability.test.ts` | SC-007, FR-028 |
| Keystroke redraw under 100 ms on the largest table | `tests/ui/redraw.test.ts` | SC-008 |
| Exports unchanged | `tests/integration/export-parity.test.ts` | SC-006 |

## 2. Manual walk-through against the mock

Open `specs/002-tui-visual-refresh/mocks/index.html` in a browser, next to the running application
(`bun run dev`, against the replay server). Resize the terminal to 100 × 30, then do the following.

1. **Default theme.** Delete the `theme` row from the database, or start with a fresh data directory,
   then start the application. Expected: Tokyo Night, with the theme label "Tokyo Night" at the right
   of the status bar.
2. **Regions.** On the national overview, compare with the mock (layout C, Tokyo Night, "Přehled
   ČR"). Expected: segmented breadcrumb, content rail, three cards, a tinted table header, striped
   rows, the side panel on its own tone, and the screen label "PŘEHLED" in the status bar.
3. **Stripes.** Move the selection with ↓ through ten rows. Expected: the selected row is always the
   selection tone, and the row it left returns to its stripe. Press `s` to sort. Expected: the
   stripes still alternate from the first row.
4. **Every theme.** Press `Ctrl+T` six times. Expected: each theme in the order of the contract
   table, then back to Tokyo Night, with every region repainted at once. Then open the palette
   (`Ctrl+P`), type `motiv nord` and press Enter. Expected: Nord.
5. **Persistence.** Quit (`q`) and start again. Expected: Nord.
6. **Council.** Open Okres Brno-město, then Brno-Bohunice. Expected: chips, bars on a track, and the
   seat strip `■■■■■■■■■ ■■■■ ■■ ■■ ■■ ■ ■  21`, as in the mock's "Zastupitelstvo" screen.
7. **Palette.** Press `Ctrl+P`. Expected: the content stays visible but dimmed, and the palette
   appears in a rounded frame with keys as chips.
8. **Stale data.** Stop the replay server and wait for the next poll. Expected: a full-width warning
   row, and the live indicator in the title bar turns into the warning badge.
9. **Minimum size.** Resize to 80 × 24, with the warning still shown. Expected: every screen is
   complete and no figure is cut. The national cards still fit here with ten table rows below them;
   they give way to compact lines only when that is no longer true (FR-021).

## 3. Monochrome and reduced colour

```powershell
$env:NO_COLOR = "1"; bun run dev
```

Expected: no colour anywhere. Every screen shows the same figures and markers, and the selection is
visible as `▶`. Press `Ctrl+T`, quit, unset `NO_COLOR` and start again. Expected: the theme chosen
under `NO_COLOR` is used.

A 256-colour terminal cannot be forced from inside the application (research R8), so the
nearest-colour mapping is covered by `tests/ui/theme-depth.test.ts` rather than by hand.

## 4. Legacy preference

```powershell
bun -e "import { Database } from 'bun:sqlite'; const db = new Database('<data dir>/volby.sqlite'); db.run(`INSERT OR REPLACE INTO app_config (key, value) VALUES ('theme', 'light')`)"
bun run dev
```

Expected: Catppuccin Latte. Repeat with `dark`. Expected: Tokyo Night.
