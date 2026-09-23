# Feature Specification: TUI Visual Refresh

**Feature Branch**: `002-tui-visual-refresh`

**Created**: 2026-09-23

**Status**: Draft

**Input**: User description: "Improve the visual design of the TUI frontend. I want more bling. Add more colours to the palette themes, to get something akin to TokyoNight, Catppuccin Mocha, etc. Each next row must have a background so tabular data is more easily readable ((i % 2) === 0 distinguishes even and odd rows). Content can have coloured backgrounds, for example header, footer and main content, to make them more distinguishable. Take inspiration from modern TUIs such as OpenCode. Make design mocks first. All proposed design must be implementable within the OpenTUI framework."

## Clarifications

### Session 2026-09-23

- Q: Which of the three mocked layouts should be built? → A: **Layout C, "Segments and cards"**:
  a segmented breadcrumb, an accent rail along the content edge, summary figures in cards, and a
  mode label at the start of the status bar.
- Q: Which themes should ship? → A: **All six mocked themes**: Tokyo Night, Catppuccin Mocha, Gruvbox
  Dark, Nord, Catppuccin Latte (light) and High contrast.
- Q: Which theme is the default? → A: **Tokyo Night**.
- Q: Should today's two themes that borrow the terminal's own colour scheme stay available next to
  the six new ones? → A: **No, remove them.** Only the six new themes remain. A stored "dark" choice
  moves to Tokyo Night and a stored "light" choice to Catppuccin Latte.
- Q: Where a published palette's grey for secondary text, or its text on a coloured badge or bar,
  is harder to read than the contrast target allows, should the tone be adjusted, or should the
  palettes be kept exactly as published? → A: **Adjust.** Only the tones that fall short are
  lightened or darkened until they pass, and SC-003 is a test every theme must pass.

The approved design reference is [mocks/index.html](mocks/index.html). It draws every screen as a
grid of terminal cells, one character per cell with its own foreground, background and weight, so
nothing in it depends on an effect a terminal cannot produce. Where this specification and the mock
disagree, this specification wins.

## Scope

This feature changes how the existing screens LOOK. It adds no data source, no figure, no screen and
no action. It extends the layout and visual design requirements of the first feature (001 FR-054 to
FR-074) and must not weaken any of them. In particular, these rules from the first feature continue
to hold unchanged:

- Nothing is coloured by electoral party (001 FR-060).
- Colour is decoration on top of meaning already carried by text, symbol or position, so the
  interface stays complete on a monochrome terminal and under `NO_COLOR` (001 FR-040, FR-063).
- A bar is drawn from the published percentage, scaled to 100 %, and never shown without the figure
  (001 FR-070, FR-071).
- Regions keep their position as data refreshes (001 FR-058).
- The minimum supported terminal is 80 columns by 24 rows (001 FR-041).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Read a long table without losing the row (Priority: P1)

A user following the count scans across a wide table: a party name on the left, its votes, share
and seats on the right. Today every row has the same background, so the eye slips to the neighbouring
row halfway across. With alternating row backgrounds, and a clearly tinted header row and selected
row, the user can follow one row from its name to its seats without losing it.

**Why this priority**: This is the one change that makes the figures themselves easier to read. The
rest of the feature is presentation around the data; this is presentation of the data.

**Independent Test**: Open any table screen (national overview, district list, district, council,
candidates, watchlist, search results) in a colour theme and confirm that alternate rows carry two
distinct backgrounds, the header row a third, and the selected row a fourth.

**Acceptance Scenarios**:

1. **Given** a colour theme and a table with at least three rows, **When** the table is shown,
   **Then** the rows alternate between two backgrounds, with the first data row on the base
   background and the second on the stripe background.
2. **Given** a striped table, **When** the user moves the selection, **Then** the selected row shows
   the selection background across its full width regardless of its stripe, and the row it left
   returns to its own stripe.
3. **Given** a striped table, **When** the user sorts it or new data arrives, **Then** the striping
   follows the rows' displayed positions, so the pattern never shows two adjacent rows alike.
4. **Given** a monochrome terminal or `NO_COLOR`, **When** any table is shown, **Then** no background
   is painted, and the selection is still shown by its marker character.

---

### User Story 2 - Tell the screen's regions apart at a glance (Priority: P1)

A user glancing at the terminal from across the desk can see immediately where the title bar, the
content, the side panel and the status bar are. Each region has its own background tone. The
breadcrumb is a row of coloured segments ending in the current location. The content has a coloured
rail along its left edge. The status bar opens with a label naming the current screen and shows each
key as a small highlighted chip.

**Why this priority**: The user explicitly asked for more distinguishable regions and more visual
richness. It is the most visible part of the change and it applies to every screen at once.

**Independent Test**: Open each screen and confirm the content area's background differs from the
title bar, status bar and side panel around it, that the side panel is set apart by its rail, and that
the breadcrumb, content rail, screen label and key chips appear as in the approved mock (SC-002).

**Acceptance Scenarios**:

1. **Given** any screen in a colour theme, **When** it is shown, **Then** the title bar and status bar
   share a panel background, the content area sits on the base background, and the side panel, when
   open, sits on the panel background with a rail in the accent colour separating it from the
   content.
2. **Given** the user is three levels deep, **When** the breadcrumb is shown, **Then** it reads as
   joined segments: an application badge in the accent colour, each earlier level on an element
   background, and the current level in the primary colour.
3. **Given** a breadcrumb too long for the terminal, **When** it is shown, **Then** it still
   truncates from the left and always keeps the current location (001 FR-055).
4. **Given** any screen, **When** the status bar is shown, **Then** it starts with a label naming the
   current screen, each available key is shown as a chip followed by its label, and the name of the
   active theme is shown at the right end.
5. **Given** the data has gone stale, **When** the warning row is shown, **Then** it has a warning
   background across the full width, and the live indicator in the title bar changes from "živě" to
   a warning badge.

---

### User Story 3 - Choose a theme I like (Priority: P2)

A user who lives in Catppuccin or Gruvbox all day wants the dashboard to match the rest of their
terminal. They cycle through the themes with the existing key, or pick one by name from the command
palette, and the choice is remembered the next time they start the application.

**Why this priority**: It turns the refresh into something users can make their own, but the
application is already better with only the default theme, so it comes after the stories that
deliver the improvement itself.

**Independent Test**: Start with no stored preference and confirm Tokyo Night is used. Switch to each
theme in turn, restart after each, and confirm the choice was kept.

**Acceptance Scenarios**:

1. **Given** no stored theme choice and a terminal that does not report a light scheme, **When** the
   application starts, **Then** it uses Tokyo Night.
2. **Given** no stored theme choice and a terminal that reports a light scheme, **When** the
   application starts, **Then** it uses Catppuccin Latte.
3. **Given** any theme, **When** the user presses the theme key, **Then** the next theme in a fixed
   order is applied to every region at once, and the status bar names it.
4. **Given** the command palette, **When** the user types a theme's name, **Then** an entry for that
   theme is offered, and choosing it applies the theme directly.
5. **Given** a theme was chosen, **When** the application is restarted, **Then** the same theme is
   used, unless colour is unavailable, in which case monochrome is used without discarding the
   stored choice (001 FR-063).

---

### User Story 4 - See the summary figures and the result at a glance (Priority: P3)

A user opening the national overview sees the headline figures – precincts counted, turnout and valid
votes – in three cards, each on its own background, and the counted and turnout cards carry a
progress bar. On a council screen the key facts sit in labelled chips, and a strip of one block per
seat shows how the seats divided. Share bars sit on a visible track, so the user can see how far
each bar is from 100 %.

**Why this priority**: It adds polish to the two screens users spend most time on, but every figure
it shows is already on screen today as text.

**Independent Test**: Open the national overview and a council at 80 by 24 and at a larger size, and
confirm the cards, chips, bar tracks and seat strip appear as in the mock and every figure still
matches the plain-text form.

**Acceptance Scenarios**:

1. **Given** the national overview, **When** it is shown, **Then** precincts counted, turnout and
   valid votes each appear in a card with a label, the figure, and for the first two a progress bar
   drawn from the published percentage.
2. **Given** a card too narrow for its secondary figure, **When** it is shown, **Then** the secondary
   figure is dropped and the main figure is never overwritten or cut.
3. **Given** a council screen, **When** it is shown, **Then** precincts, turnout and seats appear as
   label and value chips, and below the party table a seat strip shows one block per seat won, in
   the table's displayed order, followed by the total number of seats as a figure.
4. **Given** any share bar, **When** it is shown in a colour theme, **Then** the unfilled part of its
   column is painted in a track colour, and on a monochrome terminal the bar is unchanged from today.
5. **Given** a status badge such as "✓ konečné výsledky", **When** it is shown, **Then** it has the
   success background, and its text alone still states the status.

---

### Edge Cases

- **Minimum terminal size**: at 80 by 24 with the stale warning shown, the chrome and cards must still
  leave a usable table. When the national overview cannot fit the cards and at least ten table rows,
  the cards collapse to a single summary line.
- **Side panel open at 100 columns**: the content area narrows; bars shrink or drop by the existing
  rule (001 FR-074) rather than squeezing the party name column below readability.
- **Selected row on a stripe**: the selection background always wins over the stripe.
- **Changed figure on the selected row**: a figure that rose or fell keeps its ▲ or ▼ marker; its
  colour may yield to the selection text colour, but the marker never disappears.
- **High contrast**: the selected row is shown as dark text on a light background, and stripes
  differ from the base by brightness, so the theme stays legible without hue (001 FR-062).
- **Light theme**: all backgrounds and text keep sufficient contrast on a light base; no element is
  defined only for dark themes.
- **Terminal with only 256 colours**: themes are shown with the nearest available colours and remain
  legible; a terminal with no colour support falls back to monochrome as today.
- **Terminal's own background shows through**: no cell in a colour theme is left unpainted, so a
  terminal whose background differs from the theme does not show through as gaps or seams.
- **Command palette open**: the content behind it is dimmed, and the palette sits on its own
  element background with its search field on the base background.
- **Theme switch mid-refresh**: every region repaints in the new theme in the same frame; no row
  keeps the colours of the previous theme.
- **Stored theme from before this feature**: "dark", "light" or "high-contrast" is carried over to
  its replacement (FR-006a), not treated as unknown.
- **Unknown stored theme name** (for example from a newer version): it is ignored and the default
  is used, as today.

## Requirements *(mandatory)*

### Functional Requirements

#### Themes

- **FR-001**: The application MUST offer these named colour themes: Tokyo Night, Catppuccin Mocha,
  Gruvbox Dark, Nord, Catppuccin Latte and High contrast, with the colours given in the approved mock.
- **FR-001a**: Where a mock colour misses the contrast floor in SC-003, that tone MUST be lightened
  or darkened until it passes. Every other tone keeps its published value, so each theme stays
  recognisable.
- **FR-002**: Every theme MUST define the same set of colour slots, each with one meaning: base
  background, panel background, element background, stripe background, selection background, border,
  active border, text, muted text, subtle text, primary, accent, success, error, warning, text on an
  accent background, bar and bar track. A slot MUST mean the same thing on every screen and in every
  theme.
- **FR-003**: The existing roles (heading, selection, warning, increase, decrease, muted; 001 FR-059)
  MUST each resolve to one of these slots, so every existing screen is themed without restating its
  meaning.
- **FR-004**: With no stored choice, the application MUST use Tokyo Night, or Catppuccin Latte when the
  terminal reports a light colour scheme.
- **FR-005**: The existing theme key MUST cycle through every theme in a fixed order, and the command
  palette MUST offer each theme by name as a directly selectable entry.
- **FR-006**: The chosen theme MUST persist between runs (001 FR-061).
- **FR-006a**: The six themes in FR-001 MUST be the only selectable themes. The themes that borrowed
  the terminal's own colour scheme are removed. A stored choice from before this feature MUST be
  carried over: "dark" becomes Tokyo Night, "light" becomes Catppuccin Latte, and "high-contrast"
  becomes the new High contrast theme. The user is not asked, and no warning is shown.
- **FR-007**: The High contrast theme MUST separate every background slot and every text slot by
  brightness rather than hue (001 FR-062).
- **FR-008**: When colour is unavailable or `NO_COLOR` is set, the application MUST render with no
  foreground or background colour at all, exactly as the monochrome path does today.

#### Surfaces and regions

- **FR-009**: In every colour theme, the title bar and status bar MUST be painted with the panel
  background, the content area with the base background, and the side panel with the panel
  background, across their full width and height.
- **FR-010**: The content area MUST carry a vertical rail in the primary colour along its left edge,
  and the side panel a rail in the accent colour along the edge it shares with the content.
- **FR-011**: The breadcrumb MUST be drawn as joined segments: an application badge, one segment per
  level on the element background, and the current level on the primary colour, each join drawn with
  a half-block character so no special font is needed.
- **FR-012**: The title bar MUST show a live indicator at its right end, and replace it with a warning
  badge while data is stale.
- **FR-013**: The status bar MUST begin with a label naming the current screen, show each available
  key as a chip on the accent background followed by its label, and show the active theme's name at
  its right end. The set of keys offered is unchanged from today (001 FR-064). When they do not all fit, whole
  hints are dropped from the right, never cut.
- **FR-014**: The stale-data warning row MUST be painted with the warning background across its full
  width, with its text in the on-accent colour.

#### Tables

- **FR-015**: Every table's header row MUST be painted with the element background and its column
  titles shown in the primary colour; the column the table is sorted by MUST be shown in the accent
  colour.
- **FR-016**: Data rows MUST alternate between the base background and the stripe background by their
  displayed position, with the first data row on the base background, across the full width of the
  content area.
- **FR-017**: The selected row MUST be painted with the selection background across its full width,
  overriding its stripe, and MUST keep the selection marker character in its gutter (001 FR-040).
  All text on the selected row, muted text included, MUST be shown in the theme's selection text
  colour, so that it meets the contrast floor on the selection background (SC-003). A rise or fall
  may keep its own colour where that colour also meets 4.5:1 on the selection background. Its ▲ or ▼
  marker is always kept.
- **FR-018**: A share bar MUST be drawn in the bar colour over a track painted in the bar track colour
  for the full width of its column. The bar's length MUST continue to come from the published
  percentage scaled to 100 % (001 FR-070, FR-071).
- **FR-019**: A rise MUST be shown in the success colour and a fall in the error colour, each still
  marked with ▲ or ▼.

#### Summary figures

- **FR-020**: The national overview MUST show precincts counted, turnout and valid votes in three
  cards on the element background, each with a muted label, the figure in bold, and for precincts
  counted and turnout a progress bar drawn from the published percentage.
- **FR-021**: A card MUST never overlap or cut its figure, and the cards MUST give way to compact
  summary lines, every figure still shown, when the terminal cannot fit them and at least ten table
  rows. (Refined during implementation: every figure has a fixed place, the share beside its bar and
  the voters and envelopes in a detail line, so none is "secondary" and none can be dropped, as
  FR-026 requires. One line cannot hold every figure at 80 columns, so the compact form is three.)
- **FR-022**: A council screen MUST show precincts, turnout and seats as label and value chips, and a
  seat strip of one block per seat won by each party, in the party table's displayed order, followed
  by the total seat count as a figure. The strip MUST be omitted, never wrapped or cut, when it does
  not fit the width (as bars are, 001 FR-074).
- **FR-023**: Status badges (for example "✓ konečné výsledky") MUST be drawn on the success background,
  and their text MUST state the status on its own.

#### Overlays

- **FR-024**: While the command palette is open, the content behind it MUST be dimmed, the palette
  MUST be drawn in a rounded frame in the active border colour on the element background, and each
  entry's key MUST be shown as a chip.

#### Constraints carried over

- **FR-025**: No colour in any theme may be assigned by electoral party. The seat strip and bars MUST
  use theme slots only, never a colour per party (001 FR-060).
- **FR-026**: Every figure, marker and label shown today MUST still be present in the plain-text form
  of each screen, whatever its new arrangement (cards, chips, seat strip). Exports MUST be unaffected
  by this feature and by the theme.
- **FR-027**: The refresh MUST NOT move any region, reset the scroll position or change the selection
  (001 FR-058), and a theme switch MUST repaint every region in the same frame.
- **FR-028**: Every screen MUST remain complete and usable at 80 by 24 in every theme.

### Key Entities

- **Theme**: a named set of colour slots (FR-002). One is active at a time; the user's choice is
  stored as a preference.
- **Colour slot**: one meaning, one colour per theme, for example "stripe background" or "accent".
  Screens name slots or roles, never colours.
- **Surface**: a region painted with one background slot: title bar, status bar, content area, side
  panel, card, chip, palette.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In every colour theme, on every table screen, any two adjacent data rows have different
  backgrounds, and the selected row's background differs from both stripes.
- **SC-002**: In every colour theme, the content area's background differs from the title bar, status
  bar and side panel around it, so each region can be identified without reading it. The side panel,
  which shares the panel tone with the title and status bars, is set apart from the content by its
  rail.
- **SC-003**: In every theme, text meets a contrast ratio of at least 4.5:1 on every background it is
  drawn on, muted and subtle text at least 3:1, and text on an accent, warning or success background
  at least 4.5:1.
- **SC-004**: A first-time user starting with no stored preference sees Tokyo Night, and any theme can
  be reached in at most 3 keystrokes through the command palette.
- **SC-005**: Under `NO_COLOR`, every screen emits no colour at all and still shows every figure,
  marker and label, with the selection identifiable by its marker alone.
- **SC-006**: Every export is byte-identical to before this feature for the same data.
- **SC-007**: Every screen fits 80 by 24 in every theme, with the stale warning shown, without
  truncating a figure.
- **SC-008**: A keystroke that moves the selection still redraws in under 100 milliseconds on the
  largest table (001 SC-010, SC-026).
- **SC-009**: The six themes, three sizes and four screens in the approved mock match the application
  when compared side by side, apart from differences recorded as deliberate.

## Assumptions

- Row striping applies to tables only. Summary lines, notes and the help screen keep the base
  background.
- Users run a terminal with at least 256 colours; true colour gives the exact theme values. A
  terminal without colour gets monochrome, as today.
- The live indicator and clock in the title bar use information the application already has (the
  refresh state and the time of the last refresh); no new data is fetched to show them.
- Theme colours are the published palettes of Tokyo Night, Catppuccin, Gruvbox and Nord, with stripe
  and selection tones chosen between their existing surface colours. A check of the mock's values
  found the tones FR-001a will adjust: the muted text of Tokyo Night,
  Catppuccin Mocha, Nord and Catppuccin Latte (about 2.4 to 2.9:1 on their base), and Catppuccin
  Latte's light text on its warning and success backgrounds (2.3 and 3.0:1).
- The mock is a design reference, not a pixel contract: exact column widths follow the existing
  layout rules.
