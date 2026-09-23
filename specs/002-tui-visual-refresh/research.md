# Research: TUI Visual Refresh

**Feature**: `002-tui-visual-refresh` | **Date**: 2026-09-23 | **Spec**: [spec.md](spec.md)

Every OpenTUI behaviour below was checked against `@opentui/core` 0.5.11 in `node_modules`. Where a
finding matters to the design, it was also reproduced with `createTestRenderer()` and read back
through `captureSpans()`. File references are relative to `node_modules/@opentui/core`.

---

## R1. How a row gets a background across its full width

**Finding**: a `TextRenderable`'s `bg` paints only the cells that hold glyphs. The rest of its
laid-out width stays transparent, whatever `width` or `alignSelf` says (`renderSelf` only calls
`drawTextBuffer`, `chunk-bun-bwjmgnxw.js:3148-3151`). A chunk's `bg` overrides the renderable's `bg`
for that chunk's cells only.

**Decision**: the styled form of a row is padded to the full row width with a trailing chunk of
spaces in the row's background. The gutter chunk carries the same background. The plain-text form is
not padded: it is still trimmed, because it is also the key that decides whether a row is redrawn
(`Frame.setRows`), and exports read it.

**Rationale**: it keeps one renderable per row, which is what made selection moves cheap
(commit 8b518ff). The padding is computed once, in the module that already clamps rows to width
(`clampChunks`), so the styled and plain forms still cut in the same place.

**Alternatives considered**: wrapping every row in a `BoxRenderable` with a `backgroundColor`. This
was rejected because it doubles the renderables per row and the layout work on every scroll. Using
the `INVERSE` attribute was also rejected: it cannot give two distinct stripe tones.

## R2. Striping and the selected row

**Decision**: striping is decided in `frameState`, not in the views. A row is striped when it is a
table data row (R3) and its position among the data rows since the last header row is odd, counting
from 0 (FR-016). The selected row takes the `sel` background instead (FR-017), and every chunk on it
takes the `text` foreground. The exceptions are chunks whose role is `increase` or `decrease`: they
keep their colour when it reaches 4.5:1 on `sel`, and fall back to `text` otherwise. The ▲ or ▼
marker stays in every case.

**Rationale**: the views already produce the rows in display order after sorting, so parity by
display position follows sorting and new data for free (acceptance scenario 1.3). Doing it in one
place is what keeps every table striped the same way (Principle I).

**Alternatives considered**: views marking their own rows striped. This was rejected because seven
views would restate one rule.

## R3. Telling a table's header and data rows apart

**Finding**: views build a header as `line(header, "heading")` followed by `line(underline, "muted")`,
and data rows carry `columns`. Nothing marks a row as a header, so the frame cannot tint it.

**Decision**: `SemanticRow` gains an optional `kind`: `"header"`, `"rule"` or `"data"`. The rows
produced by the existing `headerRow` pair are built through one new helper in `row.ts`, so every
view marks its header the same way. Rows with no `kind` are text (titles, summaries, notes), and they
are neither striped nor tinted.

**Rationale**: a mark that says what the row IS is sturdier than guessing from `role === "heading"`.
Titles carry `heading` too.

## R4. Cards, chips, badges and the seat strip

**Decision**: these are ordinary rows whose cells carry a background as well as a foreground. A cell
gains an optional `surface`: `"element"`, `"primary"`, `"accent"`, `"success"` or `"warning"`. The
theme resolves it to a background slot, and the text on it to `onAccent` or `text` (see the data
model). A national card is three rows of such cells, and the gaps between cards are cells with no
surface. No new renderable is involved.

**Rationale**: the whole content area stays one list of rows in one scroll box. That keeps the
existing guarantees that the scroll position and selection survive a refresh (001 FR-058), that text
and styled forms cut at the same width, and that exports never see styling.

**Consequence**: the plain-text form of the national summary and the council summary line changes.
Every figure and label stays (FR-026), but assertions in `tests/ui/national.test.ts` and
`tests/ui/areas.test.ts` that match the old summary strings will be rewritten to the new layout. That
is a deliberate change in behaviour, and each is rewritten test-first (Principle II). Exports are
built separately (`src/export/tables.ts`), so they are unaffected (SC-006).

## R5. The regions: title bar, content, side panel, status bar

**Findings**:
- `BoxRenderable.backgroundColor` fills the whole box, border cells included, and can be changed
  after construction (`chunk-bun-bwjmgnxw.js:2604`).
- `border: ["left"]` with `borderStyle: "heavy"` draws `┃` on the left only. `borderColor` can be
  changed after construction (`:2637`).
- **Trap**: setting `borderColor` or `borderStyle` on a box with `border: false` switches on a full
  four-sided border (`:2565-2567`, `:2586-2591`).

**Decisions**:
- The body box becomes `border: ["left"]`, `borderStyle: "heavy"`, `borderColor` = `primary`, and
  `backgroundColor` = `bg`. It costs one column and no rows, down from two columns and two rows.
  One of the two freed rows becomes a top padding row, as in the mock, and the other goes to the
  content (`contentHeight` = body height − 1, `rawContentWidth` = body width − 1 − scrollbar).
- The side panel becomes `border: ["left"]`, heavy, `borderColor` = `accent`, `backgroundColor` =
  `panel`. `PANEL_COST` is unchanged: the panel still costs its width plus one border column.
- The title bar and status bar stay one `TextRenderable` each, with styled content padded to the
  terminal width on the `panel` background (R1).
- The warning bar is padded the same way on the `warning` background (FR-014).
- `setBorderColor` is kept, and applies to boxes that do have a border.
- The root box gets `backgroundColor` = `bg`, so no cell is left for the terminal's own background to
  show through (edge case "Terminal's own background shows through").

**Supersedes**: 001 FR-054 asked for a "bordered content area". The content is now told apart by its
surface and a one-sided rail rather than a four-sided frame. The purpose of FR-054 (regions
distinguishable without reading them) is kept, and it is what SC-002 measures.

## R6. The scroll bar

**Finding**: the scroll box takes `verticalScrollbarOptions: { trackOptions: { backgroundColor,
foregroundColor } }`, where `backgroundColor` is the track and `foregroundColor` the thumb. These can
be changed after construction through `verticalScrollBar.slider` (`index.bun.js:13517-13538`, `13948`).

**Decision**: track = `track`, thumb = `muted`, both set when the theme changes, together with the
borders.

## R7. The command palette over dimmed content

**Findings**:
- A `position: "absolute"` box with a `zIndex` draws over its siblings.
- A `backgroundColor` with alpha is blended over what is already drawn, and it blends both the
  background and the foreground of the cells beneath. `#00000099` turned `#ff0000` into `#660000`,
  and the glyphs stayed visible.
- `SelectRenderable` options are plain strings, drawn in one colour per state (`renderables/Select.d.ts:9-26`),
  so it cannot draw a key as a chip (FR-024).

**Decisions**:
- The palette stops replacing the content area (`setContentVisible` goes away). While it is open,
  two absolute boxes are shown over the body. The first is a dimming layer on `panel` at alpha `0xB3`:
  it blends toward the panel tone, which dims correctly on both dark and light themes, where a black
  layer would muddy Latte. The second is the palette itself, a rounded box on `element` with
  `borderColor` = `borderActive`.
- The palette's list is drawn as styled rows, one `TextRenderable` per visible entry, through the same
  `styledRow` path as the tables. Each entry is a row of cells: the label, the reason when it is
  unavailable (in `muted`), and the key as a chip. The `SelectRenderable` is removed. The palette
  already keeps its own highlighted index and never read the component's state back, so nothing
  depended on it.
- The search input stays an `InputRenderable`, themed through its colour options.

**Alternatives considered**:
- Keeping `SelectRenderable` and dropping the chips. This was rejected because FR-024 asks for chips.
- Dimming by re-rendering every row in `muted`. This was rejected because it would invalidate every
  row twice per open and close, and the alpha layer costs nothing.

## R8. Colour depth

**Findings**: capabilities are detected natively from environment variables and terminal replies, and
are exposed as `renderer.capabilities.rgb` and `.ansi256`, updated for about 5 s after start
(`types.d.ts:66-67`, `docs/reference/terminal-capabilities.mdx`). There is no option to force a
colour depth. That OpenTUI approximates RGB on a 256-colour terminal is NOT proven. The documentation
says "emit or approximate", and a probe on Windows always reported `rgb: true` and emitted truecolor
sequences.

**Decision**: `colorFor` approximates the theme's hex value to the nearest xterm-256 index
(`RGBA.fromIndex`) itself when `rgb` is `false` and `ansi256` is `true`. The nearest index is found
by Euclidean distance over the 6×6×6 cube and the grey ramp, cached per hex value. When `ansi256` is
also `false`, the monochrome path is taken, as today.

**Rationale**: the spec's 256-colour edge case needs a guarantee we can test, and we cannot test a
behaviour of the native renderer that the probe could not trigger. The function is small, pure and
unit-testable. If a later OpenTUI version is shown to approximate reliably, the function can be
deleted.

**Alternatives considered**: relying on OpenTUI, which was rejected as unproven. Shipping a separate
256-colour table per theme was rejected because it would give each theme two sources of truth.

## R9. Theme values and the contrast floor (FR-001a, SC-003)

**Method**: WCAG 2 relative luminance contrast, computed for every foreground slot on every
background it is drawn on. Text, primary, accent, success, error and warning must reach 4.5:1.
Muted and subtle must reach 3:1. `onAccent` must reach 4.5:1 on accent, primary, warning and success.
Each failing tone was moved in 1 % steps toward white (dark themes) or black (Latte) until it passed.
Nothing else was changed.

**Adjusted tones** (all other values are as in [mocks/index.html](mocks/index.html)):

| Theme | Slot | Mock value | Adjusted | Worst ratio before → after |
|---|---|---|---|---|
| Tokyo Night | muted | `#565f89` | `#697196` | 2.35 → 3.05 |
| Catppuccin Mocha | muted | `#6c7086` | `#787b90` | 2.57 → 3.01 |
| Gruvbox Dark | primary | `#83a598` | `#88a99c` | 4.31 → 4.53 |
| Gruvbox Dark | error | `#fb4934` | `#fc7c6c` | 3.37 → 4.55 (on `element`) |
| Nord | muted | `#616e88` | `#848ea2` | 1.96 → 3.05 |
| Nord | accent | `#81a1c1` | `#96b1cc` | 3.74 → 4.53 |
| Nord | error | `#bf616a` | `#d89fa4` | 2.46 → 4.51 (on `element`) |
| Catppuccin Latte | muted | `#8c8fa1` | `#7b7e8e` | 2.42 → 3.04 |
| Catppuccin Latte | primary | `#1e66f5` | `#1a5ad8` | 3.71 → 4.54 |
| Catppuccin Latte | accent | `#8839ef` | `#7e35de` | 4.09 → 4.60 |
| Catppuccin Latte | success | `#40a02b` | `#2d701e` | 2.53 → 4.60 |
| Catppuccin Latte | error | `#d20f39` | `#c50e36` | 4.10 → 4.55 (on `element`) |
| Catppuccin Latte | warning | `#df8e1d` | `#8b5812` | 1.98 → 4.53 (on `element`) |

Darkening Latte's warning and success also fixes its light `onAccent` text on those badges (2.3 and
3.0:1 before).

High contrast passes every contrast pair as mocked, but it fails two other rules, and three tones
change:
- **Brightness separation** (001 FR-062): the mock drew rises and falls both in white, so they
  differed by symbol alone. Rises become `#e0e0e0`, falls `#a0a0a0` and muted text `#808080`, the
  brightness steps the current high-contrast theme uses. The worst ratios, on `element`, are 12.5,
  6.3 and 4.2:1.
- **Regions** (SC-002): `panel` and `bg` were both black, so the title bar and status bar could not
  be told from the content. `panel` becomes `#262626`.

The full table is in [data-model.md](data-model.md#theme-values).

**Revised during implementation (T002)**: the first pass checked `error` and `warning` only on the
backgrounds of table rows. A fall is also drawn inside a summary card, on `element`, so the test
checks every text slot on all four surfaces, and four tones were moved a little further. The table
above holds the final values.

**Enforcement**: the contrast check becomes a unit test over every theme, so a later edit to a theme
cannot quietly break SC-003.

## R10. Theme names, the stored preference and the palette entries

**Decisions**:
- `THEME_NAMES` becomes `tokyonight`, `catppuccin-mocha`, `gruvbox`, `nord`, `catppuccin-latte` and
  `high-contrast`, cycled in that order. The `indexed` colour kind is deleted: after FR-006a nothing
  uses it, and dead code is removed (Quality Standards).
- `readTheme` maps the legacy stored values `dark` to `tokyonight` and `light` to
  `catppuccin-latte`. `high-contrast` keeps its name. Nothing is rewritten on read. The next theme
  switch stores the new name, and an unknown value is still treated as absent.
- `resolveTheme` defaults to `tokyonight`, or `catppuccin-latte` when the terminal reports a light
  scheme (FR-004).
- The command palette gains one entry per theme, labelled "Motiv: <name>" and showing `Ctrl+T` as the
  key that reaches it (FR-005, 001 FR-066). The active theme's entry is marked unavailable with the
  reason "tento motiv je aktivní", which keeps 001 FR-069's rule that nothing is hidden.

## R11. Performance

The only per-keystroke additions are one padding chunk per rewritten row (two rows per selection move)
and a parity check. A theme switch already invalidates every row (`invalidateRows`). The 256-colour
approximation is cached per hex value. The 100 ms budget (SC-008) is checked by the existing redraw
test at the largest table, extended to run under a striped colour theme.
