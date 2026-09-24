# Feature Specification: Logs View Instead of the Stale-Data Warning Line

**Feature Branch**: `004-logs-view`

**Created**: 2026-09-24

**Status**: Draft

**Input**: User description: "Currently, when user starts the application and data were not yet published, there is an log or error message on top witch prefix: !Zastarala data ... and is followed by text, that is probably some kind of concat of logs. It is easily understandable, and if there are currently no data and therefore the xmls do not have expected data shape, the !zastarala data is absolutely misleading. I would like to have this reworkerd, so that these logs are accessible in its own distinct view, triggerd by some keypress - for example pressing [l] (logs) would open the logs view. And [Esc] will close it. The view will have keys mapped so that user can copy selected logs or all logs. The view will adhere to selected theme."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The top of the screen tells the truth before results are published (Priority: P1)

A user starts the application before the election authority has published any results.
The sources either do not exist yet or return documents that have no results in them.
Today the screen shows a warning line reading "! ZASTARALÁ DATA (...)" followed by a
truncated technical error. That text claims the user is looking at outdated data. In
fact there has never been any data, and the error text means nothing to a
non-technical reader. After this change the screen says plainly that results are not
yet available and that the application keeps checking. No raw error text appears
outside the logs view.

**Why this priority**: The current message is wrong. It points a user at a problem
that does not exist, on the screen everyone sees first on election night. Fixing it is
worth doing even without the logs view.

**Independent Test**: Start the application against sources that have not published
results yet (missing documents, or documents without the expected results). Confirm
that nothing on the main screens says the data is stale, that the status says results
are not yet available, and that no technical error text appears.

**Acceptance Scenarios**:

1. **Given** no source has ever loaded successfully and the sources report nothing
   published yet, **When** the user looks at any main screen, **Then** the screen says
   results are not yet available, the application keeps checking, and the word
   "ZASTARALÁ" / "ZASTARALÉ" appears nowhere.
2. **Given** a source has never loaded successfully because its document does not have
   the expected shape, **When** the user looks at the screen, **Then** the same
   "not yet available" state is shown and no parser or validation detail is shown
   outside the logs view.
3. **Given** a source loaded successfully earlier and later refreshes keep failing,
   **When** the user looks at the screen, **Then** the screen still says the data shown
   is out of date and how old it is. This case really is stale.
4. **Given** any source problem is being reported on a main screen, **When** the user
   reads the status, **Then** it is at most one short line in plain language that
   points to the logs key, with no copy of log entries.

---

### User Story 2 - Open a dedicated logs view with one key (Priority: P1)

A user wants to know why data is missing or late, or a technically minded user wants
the detail behind a problem. They press `l` from any main screen. A full-screen logs
view opens, listing what the application recorded during this session. Each entry shows
its time, its severity, the source it concerns (when there is one) and the complete
message, with nothing truncated. Pressing `Esc` closes the view and returns them to the
same screen, with the same selection and scroll position as before.

**Why this priority**: This is where the detail removed from the warning line goes.
Without it, User Story 1 would hide information that a user sometimes needs.

**Independent Test**: With some sources failing, press `l` on each main screen and
confirm that the logs view opens and lists the failures in full. Press `Esc` and
confirm that the previous screen comes back unchanged.

**Acceptance Scenarios**:

1. **Given** the user is on any main screen and the search box does not have focus,
   **When** they press `l`, **Then** the logs view opens and fills the content area.
2. **Given** the logs view is open, **When** the user presses `Esc`, **Then** the view
   closes and the previous screen comes back with its selection and scroll position
   unchanged.
3. **Given** the logs view is open, **When** the application records a new entry,
   **Then** the entry appears in the view without the user doing anything, and the
   user's current selection stays where it is.
4. **Given** there are more entries than fit on screen, **When** the user moves with
   the arrow, Page Up/Down, Home and End keys, **Then** the selection moves and the
   list scrolls the same way it does on the other list screens.
5. **Given** nothing has been recorded yet this session, **When** the user opens the
   logs view, **Then** it says there are no entries yet instead of showing an empty
   area.
6. **Given** an entry's message is longer than the screen is wide, **When** it is
   shown, **Then** the whole message is readable in the view, either wrapped or shown in
   full for the selected entry, and never cut off with no way to see the rest.

---

### User Story 3 - Copy the selected entry or all entries (Priority: P2)

A user wants to send the problem to someone, or paste it into an issue. In the logs
view they press `c` to copy the selected entry, or `C` (Shift+c) to copy every entry.
A short confirmation says what was copied, then they paste it anywhere.

**Why this priority**: Copying makes the view useful for reporting problems. Reading
the log is still worth having without it, so this comes after the view itself.

**Independent Test**: Open the logs view, press `c`, paste into another application
and confirm that the pasted text is exactly the selected entry. Press `C`, paste, and
confirm that every entry is there in the order shown.

**Acceptance Scenarios**:

1. **Given** the logs view is open with an entry selected, **When** the user presses
   `c`, **Then** that entry's full text (time, severity, source, message) goes to the
   clipboard and a confirmation notice appears.
2. **Given** the logs view is open with entries, **When** the user presses `C`, **Then**
   every entry, in display order and one per line, goes to the clipboard and the notice
   says how many entries were copied.
3. **Given** the logs view has no entries, **When** the user presses `c` or `C`,
   **Then** nothing is copied and a notice says there is nothing to copy.
4. **Given** the terminal cannot pass text to the clipboard, **When** the user copies,
   **Then** the application does not crash or corrupt the screen, and it does not claim
   a guaranteed success it cannot verify.

---

### User Story 4 - The logs view looks like the rest of the application (Priority: P3)

The logs view uses the theme the user picked. It uses the same title bar, status bar,
surfaces and text colours as every other screen, and it changes immediately when the
user switches theme while it is open. Severity is shown by a text label as well as by
colour, so it can be read without colour.

**Why this priority**: The user asked for it, and the application already follows the
theme everywhere else. It adds no new capability, so it comes last.

**Independent Test**: Open the logs view under each theme, including high-contrast,
and switch theme while it is open. Confirm that every region repaints in the new theme
and that severities can be told apart with colour turned off.

**Acceptance Scenarios**:

1. **Given** any theme is active, **When** the logs view is open, **Then** its
   background, text, selection highlight and severity colours come from that theme.
2. **Given** the logs view is open, **When** the user switches theme, **Then** the whole
   view repaints in the new theme in the same redraw.
3. **Given** entries of different severities, **When** they are shown, **Then** each
   severity has a text label, so it can be told apart without colour.
4. **Given** the logs view is open, **When** the user looks at the status bar, **Then**
   it names the screen as the logs view and lists its keys (move, copy selected, copy
   all, close).

---

### Edge Cases

- A source fails on every poll all night. The log keeps growing, but the view stays
  responsive, and the application keeps a bounded number of recent entries in memory
  (see Assumptions). The log file on disk is unaffected.
- The user presses `l` while typing in the search box. The letter goes into the search
  text and the logs view does not open.
- The user presses `l` while the command palette is open. It is treated like any other
  letter in the palette. Opening the logs view is also listed as a palette action.
- The logs view is open when the terminal is too small. The usual "window too small"
  message is shown, and the view comes back once the window is big enough again.
- Some sources were never published and others have gone stale. The status shows the
  stale case, because the user is looking at out-of-date figures, and the logs view
  holds the detail for both.
- The last failing source recovers. The short status line goes away. The entries stay
  in the logs view as a record of what happened.
- A document is rejected before publication because it has no results. This is shown
  as "not yet available", never as corrupt or stale data.
- Every source on screen is final and a manual refresh fails. As today, this does not
  raise a warning on the main screen (003 behaviour). The failure is visible in the logs
  view.
- The user presses `Esc` in the logs view. It closes the view. `Esc` does not also take
  the underlying screen back a level.
- Log writing to the file has failed. The in-app logs view still shows the entries
  recorded in memory.

## Requirements *(mandatory)*

### Functional Requirements

**Main-screen status**

- **FR-001**: The application MUST NOT label data as stale ("ZASTARALÁ" / "ZASTARALÉ",
  in the warning line or the title bar indicator) for a source that has never loaded
  successfully in this session or earlier.
- **FR-002**: When sources are failing and none of the failing sources has ever loaded
  successfully, the application MUST show a "results not yet available, still checking"
  state in place of the stale state. Like the stale state today, this is judged across
  all sources, not per screen.
- **FR-003**: When a source that loaded successfully before is now failing, the
  application MUST keep showing that the data on screen is out of date, and how old it
  is.
- **FR-004**: Any source-problem message on a main screen MUST be a single short line
  in plain Czech. It MUST NOT contain raw error, parser or validation text, and it MUST
  name the key that opens the logs view.
- **FR-005**: Every status the main screen shows through colour MUST also be shown
  through text or a symbol, as today.

**Logs view**

- **FR-006**: Pressing `l` on any main screen, while the search box does not have
  focus, MUST open the logs view.
- **FR-007**: Opening the logs view MUST also be available as a command-palette action
  and MUST be listed on the help screen.
- **FR-008**: Pressing `Esc` in the logs view MUST close it and return to the screen it
  was opened from, with that screen's selection and scroll position unchanged.
- **FR-009**: The logs view MUST list the entries the application recorded during the
  current session, in chronological order. When the view opens, the most recent entry
  is selected and visible.
- **FR-010**: Each entry in the list MUST show its local time, a severity label, the
  source it concerns when there is one, and its message, on one line cut to the
  available width. The complete text of an entry is shown by its detail view (FR-011).
- **FR-011**: A message longer than the available width MUST be readable in full inside
  the view. Opening the selected entry (`Enter`) shows it in full, and `Esc` returns to
  the list.
- **FR-012**: New entries recorded while the view is open MUST appear without user
  action, and MUST NOT move the user's selection off the entry they chose.
- **FR-013**: The logs view MUST support the same movement keys as other list screens
  (up, down, Page Up, Page Down, Home, End).
- **FR-014**: With no entries recorded, the logs view MUST show an explicit "no entries
  yet" message.
- **FR-015**: The entries shown in the logs view MUST be the same entries, with the same
  wording, as those written to the log file.

**Copying**

- **FR-016**: Pressing `c` in the logs view MUST copy the selected entry's full text to
  the clipboard.
- **FR-017**: Pressing `C` (Shift+c) in the logs view MUST copy all entries, in display
  order and one per line, to the clipboard.
- **FR-018**: After a copy, the application MUST show a short notice saying what was
  copied (one entry, or N entries). When there is nothing to copy, it MUST say so.
- **FR-019**: A copy MUST NOT write anything that corrupts the rendered screen, and a
  failed copy MUST NOT stop the application.

**Theme and chrome**

- **FR-020**: The logs view MUST use the active theme for its surfaces, text, selection
  highlight and severity colours, and MUST repaint fully on a theme switch within the
  same redraw.
- **FR-021**: The status bar MUST identify the logs view by name and MUST offer only
  keys that work there. It MUST agree with what the command palette offers on that
  screen.
- **FR-022**: The logs view MUST follow the existing minimum-terminal-size behaviour.

### Key Entities

- **Log entry**: One thing the application recorded. It has a time, a severity (error,
  warning, info, debug), a message, and optionally the source it concerns and extra
  detail. It is shown in the logs view and written to the log file with the same text.
- **Source load state**: For each result source, whether it has ever loaded
  successfully and whether it is failing now. This decides between the "not yet
  available" and "stale" states on the main screen.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: When the application starts before any results are published, no main
  screen shows the word "ZASTARALÁ" or "ZASTARALÉ". This holds for 100% of runs against
  unpublished sources.
- **SC-002**: No main screen shows raw error, parser or validation text in any source
  state. All such detail appears only in the logs view.
- **SC-003**: From any main screen, the user can open the logs view with one key press
  and return with one key press. The logs view appears or disappears within the same
  responsiveness budget as other screen changes (under 100 ms).
- **SC-004**: A user can copy one entry or the entire log into another application in
  at most two key presses from any main screen (`l`, then `c` or `C`). The pasted text
  is the entry exactly as it appears in the log file and in the entry's detail view.
- **SC-005**: Under every shipped theme, including high contrast, each region of the
  logs view uses that theme's colours, and severities can be told apart with colour
  turned off.
- **SC-006**: After a full night of repeated source failures, the logs view still opens
  and scrolls within the normal responsiveness budget.

## Assumptions

- The UI text stays in Czech, like the rest of the application. The view is labelled
  "ZÁZNAMY" in the status bar. The exact wording of the "not yet available" and stale
  lines is left to planning, as long as it meets FR-001 to FR-004.
- `l` is currently unused, and `c` / `C` are unused inside the new view. Copy keys
  follow the existing lowercase/Shift pairing (`w`/`W`, `e`/`E`).
- The logs view shows entries from the current session only. Earlier sessions stay
  available in the log file on disk, whose location does not change.
- The view keeps a bounded number of the most recent entries in memory (on the order of
  1,000). Older entries drop out of the view but stay in the log file.
- The view shows entries at or above the log level the application was started with,
  which is the same set that goes to the log file.
- Copying uses the terminal's own clipboard support, which is the only route that works
  over SSH and without extra system tools. Some terminals ignore it and the application
  cannot always detect that, so the notice reports that a copy was sent, not that it is
  guaranteed.
- The existing one-line warning row is kept only for the short status of FR-004. Its
  current contents (scope, truncated error, staleness) are replaced.
- "Not yet published" covers a missing source document and a document rejected because
  it has no results, as long as that source has never loaded successfully.
- Filtering, searching and exporting the log from inside the view are out of scope.
