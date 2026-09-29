# Feature Specification: Results Chart Panel

**Feature Branch**: `006-results-chart-panel`

**Created**: 2026-09-29

**Status**: Draft

**Input**: User description: "I want to implement feature, that would allow to render a graphical representation of elections results. My idea, which we can brainstorm upon, is, that where appropriate, user can open a panel, that will render a pie chart of selected values, for example percent of votes per party on national level, or percent of votes per party on city council level or absolute votes given to parties on national level, local council or candidates in the selected party. The pie chart is just a proposal - if it is not possible to render them within OpenTUI framework, then I am open to suggestions for different graphical representation"

## Clarifications

### Session 2026-09-29

Settled against an interactive mock rendered in all six themes and approved by the user. The mock
is kept at `mock/results-chart-panel-mock.html`, and the approved visual decisions it encodes are
recorded in `visual-design.md` beside this spec.

- Q: Pie chart, or a bar chart to avoid per-party colours and sub-cell slices? → A: Pie chart.
  Slice colours are allowed because they are assigned by RANK POSITION (largest slice first),
  never by party identity, so no political affiliation is implied and the original
  no-party-colours concern does not apply. Sub-cell slices are prevented by the cutoff below.
- Q: How does the chart stay legible without colour (high contrast, NO_COLOR, monochrome)? → A:
  Every slice combines its colour with a distinct fill character (texture). Texture alone
  distinguishes the slices; colour is added on top, never instead, consistent with the
  application's existing rule that colour is decoration and meaning is carried by symbol.
- Q: How many slices? → A: The six largest entries get their own slice; every entry beyond the
  sixth is aggregated into one muted "Ostatní" slice whose label carries the count. The exact
  figures for every aggregated entry remain available in the table beside the chart.
- Q: Overlay over the content, or a split view? → A: A split view. The chart opens as a side pane:
  the left half keeps the existing tabular view, fully interactive, and the right half shows the
  pie chart with its legend. No overlay and nothing modal.

### Planning amendments (2026-09-29)

Made during `/speckit-plan`; rationale in `research.md`.

- FR-009, candidates (R8): the source publishes preferential votes only for elected candidates,
  so the "Ostatní" slice of a candidate chart is the party's votes less the charted candidates,
  and its share is that remainder over the party's votes. For parties the aggregate remains the
  exact sum of its members' published figures.
- FR-013 (R3, R4): the chart fits by width alone (a terminal of at least 93 columns); at every
  supported height the pie shrinks rather than the chart being withheld. The shrink notice reads
  "Graf zavřen: okno je pro něj příliš úzké."
- FR-012 (R5): the candidate table gains a published `Podíl` column at every width, so the
  legend's share has a table figure to match.
- FR-006 (R7): three Catppuccin Latte slice tones are darkened in hue to reach 3:1 on the pane.
- FR-005, ties (R9): "the order the underlying table uses" means the table's default, unsorted
  order. A sort the user applies to the table never reorders the chart.
- FR-014 (R10): the title's form states the level. `Graf · ČR` is the national party breakdown;
  `Graf · <council>` is that council's parties; `Graf · <party>` is that party's candidates,
  confirmed by the subtitle `podíl hlasů strany`. The breadcrumb above names the same level.


## Overview

Wherever the application shows a breakdown of votes – parties at the national level, parties in
one council, or candidates of one party – the user can open a chart pane beside the table. The
view splits in two: the left half keeps the existing table, still fully interactive, and the
right half draws a pie chart of the same breakdown, with a legend giving each slice's name,
absolute votes and percentage share. The six largest entries get their own slice and colour;
everything beyond the sixth is aggregated into a single muted "Ostatní" slice. Each slice pairs a
colour with a distinct fill texture, so the chart reads the same in every theme, including high
contrast and terminals without colour.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Visualise the national party breakdown (Priority: P1)

A user watching the national overview on election night wants to see at a glance how the vote is
splitting between electoral parties, without reading a column of numbers. They press the chart
action shown in the footer and the view splits: the party table stays on the left, and a pie
chart opens on the right showing the six strongest parties as coloured, textured slices plus one
aggregated slice for the rest, with a legend giving each slice's exact votes and share. They keep
navigating the table while the chart stays up, and close the pane to get the full-width view back.

**Why this priority**: The national overview is the first screen every user sees and the place
where "who is winning" is asked most often. A single chart context already delivers the core
value of the feature and exercises everything the other contexts need (the split, the pie, the
legend, the cutoff, live refresh).

**Independent Test**: From the national overview, open the chart pane and verify that the six
largest parties each appear as a distinct slice with the aggregate as the seventh, that slice
angles are proportional to vote shares, that the legend figures match the table exactly, and that
closing the pane restores the full-width view unchanged.

**Acceptance Scenarios**:

1. **Given** the national overview is displayed with party results, **When** the user invokes the
   chart action, **Then** the view splits and the right pane shows a pie chart with one slice per
   each of the six largest parties plus one aggregated slice, ordered clockwise from twelve
   o'clock by descending votes, with a legend beneath giving each slice's name, absolute votes and
   percentage share.
2. **Given** the chart pane is open, **When** the user compares any two slices, **Then** their
   angular sizes correspond to the ratio of the vote shares they represent.
3. **Given** the chart pane is open, **When** the user scrolls the party table on the left,
   **Then** the table responds exactly as it does without the pane. (The national table has no
   selection and no sort; re-sorting with the pane open is covered by User Story 2.)
4. **Given** the chart pane is open, **When** the user dismisses it, **Then** the full-width view
   reappears with its selection, scroll position and sort order unchanged.
5. **Given** the chart pane is open, **When** a data refresh publishes new figures, **Then** the
   slices and legend update without user action and changed values are marked in the legend the
   same way the tables mark them.
6. **Given** the national overview is displayed, **When** the user opens the command palette,
   **Then** the chart action is listed there with its keyboard shortcut, and the footer of the
   supporting views lists it too.

---

### User Story 2 - Visualise one council's party results (Priority: P2)

A user has drilled down into a single municipality's council. They open the chart pane and see
the same kind of pie chart for that council alone: the strongest parties as distinct slices,
proportional to the votes received in that council, with exact figures in the legend.

**Why this priority**: "Who won in my town" is the question most users actually have; the council
view is where they answer it. It reuses the pane built for Story 1 with a different data scope.

**Independent Test**: Open a council with published results, invoke the chart action, and verify
the slices and legend match that council's party table figures; open a council whose results are
not yet published and verify the pane explains that there is nothing to chart yet.

**Acceptance Scenarios**:

1. **Given** a council detail view with published results, **When** the user invokes the chart
   action, **Then** the chart pane shows the council's parties as slices with legend figures
   matching the council's table.
2. **Given** a council whose results are not yet published, **When** the user invokes the chart
   action, **Then** the pane opens with a clear "no data yet" message in place of the chart
   instead of an empty or misleading drawing.
3. **Given** the chart pane is open on a council, **When** the user moves the selection or
   re-sorts the party table on the left, **Then** the table responds exactly as it does without
   the pane, and the chart's slice order does not change.

---

### User Story 3 - Visualise candidate votes within a party (Priority: P3)

A user has opened the candidate list of one electoral party in a council. They open the chart
pane and see the six candidates with the most preferential votes as slices, proportional to their
share of the party's votes, with the remaining candidates aggregated, so they can see at a glance
which candidates are carrying the list.

**Why this priority**: A narrower audience than the party breakdowns, but it completes the "where
appropriate" promise: every view that shows a vote breakdown offers the same chart.

**Independent Test**: From a party's candidate list, invoke the chart action and verify six
candidate slices plus the aggregate, with legend figures matching the candidate table.

**Acceptance Scenarios**:

1. **Given** a party's candidate list with published preferential votes, **When** the user
   invokes the chart action, **Then** the chart pane shows the six candidates with the most votes
   as slices plus one aggregated slice, each legend entry labelled with name, absolute votes and
   share of the party's votes.

---

### Edge Cases

- Exactly seven entries: the rule is mechanical – entries beyond the sixth are aggregated – so
  the seventh entry alone forms the "Ostatní" slice, labelled with its count of one.
- Six or fewer entries: every entry gets its own slice and no aggregate slice is drawn.
- Entries tied on votes at the cutoff boundary: broken by the order the underlying table uses,
  so chart and table never disagree about who is sixth.
- A refresh changes the ranking: slices are re-ranked and colours reassigned by the new rank
  positions; the legend marks the changed values. A party's colour is not stable across refreshes
  or contexts, and the legend is the authoritative mapping at all times.
- All entries at zero (counting just started): the pane shows the "no data yet" message rather
  than a pie of zero slices.
- Terminal too narrow for the split: the chart action is not offered – the footer hides the hint
  and the command palette lists the action as unavailable with the reason, following the
  application's existing rule that inapplicable actions are shown greyed with an explanation.
- Terminal shrinks below the minimum while the pane is open: the pane closes and the full-width
  view returns; the status row notes why.
- Very long party or candidate names: truncated with an ellipsis in the legend, never allowed to
  push the figures out of the pane.
- The watchlist side panel is open when the chart is invoked: the chart pane takes its place and
  the watchlist state is restored when the chart closes.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: On every view that shows a vote breakdown – the national party overview, a single
  council's party results, and a single party's candidate list – the user MUST be able to open a
  chart pane with a single action, and close it again with the same action.
- **FR-002**: The chart action MUST follow the application's existing discoverability rules: it
  appears in the context-sensitive footer only on views that support it and only when the
  terminal is wide enough, and it is listed in the command palette with its shortcut, greyed with
  the reason when it cannot run here.
- **FR-003**: Opening the chart MUST split the content area in two: the existing tabular view
  remains on the left and stays fully interactive (selection, sorting, drill-down, watch and
  export continue to work), and the chart pane occupies the right. Closing the pane MUST restore
  the full-width view with its selection, scroll position and sort order intact.
- **FR-004**: The chart MUST be a pie chart whose slice angles are proportional to each entry's
  share of the whole (valid votes for parties; the party's votes for candidates), with slices
  ordered clockwise from twelve o'clock by descending votes.
- **FR-005**: The six entries with the most votes MUST each receive their own slice; every entry
  beyond the sixth MUST be aggregated into a single "Ostatní" slice whose label carries the count
  of aggregated entries. With six or fewer entries no aggregate slice is drawn. Ties at the
  boundary are broken by the order the underlying table uses.
- **FR-006**: Each ranked slice MUST be drawn in a colour assigned by its rank position from a
  fixed per-theme palette of six slice colours, and the aggregate slice in the theme's muted
  tone. Colours are assigned to rank positions, never to party or candidate identity, so no
  political affiliation is implied.
- **FR-007**: Each slice MUST additionally be filled with a distinct texture character, fixed per
  rank position, so that all slices are distinguishable by texture alone – in the high-contrast
  theme, under NO_COLOR and on monochrome terminals. Colour is added on top of the texture,
  never instead of it.
- **FR-008**: The pane MUST include a legend listing every slice in rank order: its swatch (the
  slice's texture in the slice's colour), its name, its absolute vote count and its percentage
  share. The exact published figures are never replaced by the graphic – the legend always
  accompanies it.
- **FR-009**: The figures shown in the legend MUST be identical to the figures shown in the
  corresponding table for the same data snapshot, with the aggregate slice's figures equal to the
  sum of the entries it aggregates.
- **FR-010**: When the underlying data refreshes while the pane is open, the chart and legend
  MUST update without user action; slices are re-ranked by the new figures and legend values that
  changed since the previous refresh MUST be marked using the application's existing change
  marking.
- **FR-011**: When the chart's context has no published figures yet, the pane MUST show an
  explanatory message in Czech instead of an empty chart.
- **FR-012**: While the pane is open, the table beside it MUST keep its identifying and primary
  columns – name, absolute votes and percentage share – and shed secondary columns (the inline
  bar first, then seat figures) rather than truncate or distort any figure, extending the
  application's existing narrow-width rule.
- **FR-013**: The chart pane MUST be offered only when the terminal affords both the pane and the
  reduced table; below that width the action is unavailable (per FR-002), and if the terminal
  shrinks below it while the pane is open, the pane closes and the full-width view returns.
- **FR-014**: All pane text – title, legend, messages, footer hints – MUST be in Czech,
  consistent with the rest of the application, and the pane title MUST state what is being
  charted (the area and level) so a chart is never ambiguous about its scope.
- **FR-015**: Provisional data MUST be labelled as provisional inside the pane, matching the
  application's existing convention for unfinished counts.

### Key Entities

- **Chart context**: The scope a chart is drawn for – national parties, one council's parties, or
  one party's candidates in one council. Determines the pane title, the entry set and which share
  is shown.
- **Slice**: One charted wedge – its rank position (which fixes its colour and texture), the
  name, absolute vote count, percentage share, and whether its figures changed in the latest
  refresh. The aggregate slice additionally carries the count of entries it stands for.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From any supported view, a user can open the chart and identify the leading party
  or candidate and its approximate share within 5 seconds, without reading any numeric column.
- **SC-002**: For every supported context, 100% of the legend figures match the corresponding
  table for the same data snapshot, and the aggregate slice equals the sum of its entries.
- **SC-003**: Every slice is identifiable in all six themes, including high contrast, and on a
  terminal without colour, using texture and the legend alone.
- **SC-004**: After new data is published, the open chart reflects it within one refresh cycle,
  with no user action.
- **SC-005**: Opening and closing the chart never loses the user's place: in 100% of cases the
  underlying view's selection, scroll position and sort order are unchanged afterwards, and the
  table remains fully operable while the pane is open.

## Assumptions

- **Pie chart in a split pane**: Decided in the 2026-09-29 clarification session, superseding the
  earlier bar-chart-in-overlay draft. The split pane reuses the application's existing side-panel
  mechanism and its "shown only when there is room" rule; nothing is modal.
- **Rank-based colours resolve the no-party-colours rule**: The application's design rules forbid
  per-party colours because a colour per party would imply a political affiliation the source
  never published. Assigning colours to rank positions carries no such implication: the colour
  says "largest", "second largest", and so on. The accepted consequence is that a party's colour
  can change between contexts and refreshes; the legend is always the authoritative mapping.
- **Six slice colours per theme**: Each of the six themes gains a fixed palette of six slice
  colours drawn from its own published palette family, plus the existing muted tone for the
  aggregate, validated by the same contrast test that guards the other slots. In the
  high-contrast theme slices are separated by texture and brightness rather than hue, matching
  that theme's design principle.
- **Both figures always shown, no metric toggle**: The user mentioned charting either percentages
  or absolute votes. For every supported context the two are proportional to each other, so the
  slices would be identical either way. Each legend entry therefore carries both figures and no
  toggle is needed.
- **Seats are not charted**: Seat counts are already tabulated; charting them alongside votes
  would double the pane's complexity for little added insight. Out of scope for this feature.
- **No chart for list-of-areas views**: District and council listing views compare areas by
  turnout and progress, not by a single vote distribution, so they do not offer the chart. The
  existing export functions are unaffected; exporting the chart itself is out of scope.
- **Watchlist side panel**: The chart pane and the watchlist panel occupy the same region; the
  chart takes precedence while open and the watchlist state is restored when it closes.
