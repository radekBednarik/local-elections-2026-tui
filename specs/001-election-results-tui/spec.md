# Feature Specification: Election Results TUI

**Feature Branch**: `001-election-results-tui`

**Created**: 2026-09-22

**Status**: Draft

**Input**: User description: "Build TUI application. This application will be available for user as a binary. Application must support Windows 11 and Linux. The application will periodically poll for new data from the source, parse them and present them in the dashboard. The main source of data, their structure, etc is here: https://volby.gov.cz/opendata/kv2026/kv2026_opendata.htm . Application must handle all available data source, EXCEPT for batch sources (davka)."

## Clarifications

### Session 2026-09-22

- Q: At startup, prefetch all district results or load reference data only and fetch on demand? → A: Background prefetch of the nationwide and per-district results at startup, refreshed at the publisher's documented rate; reference registries downloaded once on first run only and persisted locally for reuse by every later run; per-council results still fetched on demand.
- Q: Keep a history of how each area's figures changed through the evening, or only the latest figures? → A: Latest figures only, plus a highlight on what changed since the previous refresh. No time series is accumulated.
- Q: What do tests and the dashboard run against before election night, given the live files do not exist until 9 October 2026? → A: Fixtures derived from the real 2022 municipal election data, supplemented by hand-written fixtures for edge cases the 2022 data does not contain, plus a local replay harness that serves those fixtures on a timer so a full election night can be rehearsed end to end. Fixtures MUST be validated against the 2026 schemas, because 2022 delivered the same three non-batch result sets through a different mechanism.
- Q: Should the application's own labels, menus, status and error text be Czech or English? → A: Czech throughout, matching the source data and the intended audience. No runtime language switching and no string catalogue.
- Q: Should the user be able to save what they are viewing to a file, or is the application view-only? → A: Both a tabular export of the currently displayed table and a formatted summary report for a chosen area, each written to a user-chosen location.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Watch the national count come in (Priority: P1)

An interested citizen, journalist, or analyst starts the application on election night. Within seconds
they see a nationwide picture of the municipal elections: how many polling districts have reported,
overall turnout, and the national tally of council seats won by each electoral party. The screen keeps
refreshing on its own as new results are published, and clearly marks when the data was last updated
and that the count is still in progress.

**Why this priority**: This is the smallest slice that delivers the core value of the product – a live,
self-updating view of the election. It depends on a single data source and is useful on its own even if
no drill-down exists yet.

**Independent Test**: Launch the application against the national results source and confirm that the
overview populates, that it visibly updates when new data is published, and that the reported completion
percentage and timestamp change accordingly. Delivers a usable live national dashboard.

**Acceptance Scenarios**:

1. **Given** the application is launched during an active count, **When** the first fetch completes,
   **Then** the national overview shows turnout, count progress (districts reported out of total), and
   seats per electoral party, together with the time the data was published.
2. **Given** the national overview is displayed, **When** newer national data becomes available, **Then**
   the displayed figures update without user action and the "last updated" indicator advances.
3. **Given** the count is not yet complete, **When** the user views any figure, **Then** the view is
   clearly labelled as provisional.
4. **Given** newly fetched data differs from the previous fetch, **When** the view refreshes, **Then** the
   values that changed are visually distinguishable from those that did not.

---

### User Story 2 - Drill down from country to district to council (Priority: P2)

A user following a specific part of the country navigates from the national view into a district, sees
every municipality in that district with its turnout and count progress, and then opens a single council
to see its full result: each electoral party's vote share, the seats it won, and which candidates were
elected.

**Why this priority**: Municipal elections are inherently local. Without drill-down the product answers
"how is the country doing" but not "who won in my town", which is the question most users actually have.
It builds directly on Story 1's fetching and rendering foundation.

**Independent Test**: From the national view, navigate into a named district and then a named
municipality, and verify that the displayed parties, vote counts, seat allocation, and elected candidates
match the published source data for that municipality.

**Acceptance Scenarios**:

1. **Given** the national overview is displayed, **When** the user selects a district, **Then** a list of
   every municipality in that district appears with turnout, count progress, and seat totals.
2. **Given** a district view is displayed, **When** the user selects a municipality, **Then** the full
   council result for that municipality appears, including each electoral party's votes, vote share, and
   seats won.
3. **Given** a council result is displayed, **When** the user opens an electoral party, **Then** its
   candidates are listed with their ballot position, personal votes, and whether they were elected.
4. **Given** a municipality that is subdivided into city districts or boroughs, **When** its result is
   displayed, **Then** each council within that municipality is presented separately and identifiably.
5. **Given** the user is viewing a district or council, **When** new data for that area is published,
   **Then** the open view refreshes in place without losing the user's position.

---

### User Story 3 - Survive a hostile network (Priority: P2)

A user runs the application on an unreliable connection, or the publisher's servers are slow or briefly
unavailable during peak load. The application keeps showing the last good data, states plainly that it is
stale and why, retries on its own without the user intervening, and recovers silently once the source is
reachable again. It never hammers the publisher's servers.

**Why this priority**: Election night is precisely when the source is under the heaviest load. An
application that blanks out, crashes, or floods the server on the first timeout is unusable exactly when
it matters, so this cannot be deferred past the first drill-down release.

**Independent Test**: Interrupt network access while the application is running and confirm that the last
known results stay on screen, that a clear stale-data warning appears, and that normal refreshing resumes
by itself once access is restored.

**Acceptance Scenarios**:

1. **Given** results are displayed, **When** a fetch fails, **Then** the last successfully retrieved data
   remains visible and an explicit warning identifies the data as stale and states the failure reason.
2. **Given** repeated fetch failures, **When** the application retries, **Then** the interval between
   attempts increases up to a ceiling rather than retrying at full rate.
3. **Given** the source becomes reachable again, **When** the next attempt succeeds, **Then** the warning
   clears and normal refreshing resumes without a restart.
4. **Given** the application is started with no network access at all and a populated local cache, **Then**
   it starts successfully and presents the cached results marked as stale.
5. **Given** a fetched file is malformed or truncated, **When** it is parsed, **Then** it is rejected, the
   previous good data is retained, and the problem is recorded without the application terminating.

---

### User Story 4 - Search and reference lookup (Priority: P3)

A user who does not know which district a municipality belongs to types part of its name and jumps
straight to its result. The same search finds electoral parties and candidates by name. Names,
abbreviations, and council types shown anywhere in the application are the official ones from the
published registries and code lists rather than raw numeric codes.

**Why this priority**: Navigating roughly 6,000 municipalities purely by hierarchy is slow, and raw codes
are unreadable. Both depend on the reference data being loaded, so they are specified together.

**Independent Test**: Search for a municipality by a partial name, jump to its result, and confirm that
party and council-type names are rendered as human-readable text rather than codes.

**Acceptance Scenarios**:

1. **Given** the reference data is loaded, **When** the user types part of a municipality name, **Then**
   matching municipalities are listed and selecting one opens its result.
2. **Given** the user searches for an electoral party name, **Then** councils where that party stood are
   listed.
3. **Given** any result view, **When** a party, council type, or region is displayed, **Then** it is shown
   by its official name, not by its numeric code.
4. **Given** search input containing Czech diacritics or their unaccented equivalents, **When** the user
   searches, **Then** both forms match the same municipality.

---

### User Story 5 - Follow a personal watchlist (Priority: P3)

A user who cares about a handful of specific councils marks them as favourites. On every launch those
councils appear together on a single screen, refreshing continuously, so the user can watch several places
at once without repeatedly navigating the hierarchy. The watchlist survives restarts.

**Why this priority**: A significant quality-of-life improvement that turns a browsing tool into a
monitoring tool, but the product is fully usable without it.

**Independent Test**: Mark two councils as watched, restart the application, and confirm both appear on
the watchlist screen with live, refreshing results.

**Acceptance Scenarios**:

1. **Given** a council result is displayed, **When** the user marks it as watched, **Then** it is added to
   the watchlist and a confirmation is shown.
2. **Given** a non-empty watchlist, **When** the application is restarted, **Then** the same councils are
   still watched.
3. **Given** the watchlist screen is open, **When** new data is published for any watched council, **Then**
   that entry updates in place.
4. **Given** a watched council, **When** the user removes it from the watchlist, **Then** it no longer
   appears on the watchlist screen after the next render.

---

### User Story 6 - Take the numbers away (Priority: P3)

A journalist writing up the result needs the figures out of the terminal and into an article or a
spreadsheet. From whichever table they are looking at they save the rows to a file they can open in
spreadsheet software, and for a single area they can also produce a readable summary they can send to an
editor as it stands, without reformatting.

**Why this priority**: The tool is useful without it, but a reader who cannot extract figures will retype
them by hand and introduce errors. It depends on the result views existing, so it follows them.

**Independent Test**: Open a district's result, export it, and confirm the saved file opens in spreadsheet
software with the same figures and columns shown on screen. Separately, produce a summary report for one
council and confirm it is readable without further editing.

**Acceptance Scenarios**:

1. **Given** any table of results is displayed, **When** the user exports it and chooses a location,
   **Then** a file is written there containing the same rows and figures shown on screen.
2. **Given** an exported file, **When** it is opened, **Then** it identifies the area it covers, the
   publication time of the data, and whether the result was provisional or final.
3. **Given** a council or district is selected, **When** the user requests a summary report, **Then** a
   readable document is produced containing turnout, count progress, seats by electoral party, and the
   elected candidates.
4. **Given** the chosen location cannot be written to, **When** the user exports, **Then** the failure is
   reported with its reason and the application continues running.
5. **Given** an export of a large district is in progress, **When** the user navigates, **Then** the
   interface stays responsive.

---

### Edge Cases

- **Before publication begins**: the election-day data set does not exist yet, so every fetch returns "not
  found". The application must start, explain that results are not yet being published, and keep retrying
  rather than failing at launch.
- **Count complete**: once every polling district has reported, the application must stop labelling figures
  as provisional and indicate that the result is final, while continuing to refresh at a reduced rate in
  case of corrections.
- **Corrections after publication**: an area's result may be republished with different figures after
  having been reported. The newer published figures must replace the older ones, and the change must be
  visible to the user.
- **Councils with no result**: a municipality where the election did not take place, was annulled, or had
  no valid candidate list must be shown with an explicit status rather than as zero votes.
- **Ties and unfilled seats**: a council where seats remain unallocated or where the source reports a tie
  must be displayed as the source reports it, without the application inventing an ordering.
- **Terminal too small**: the application must remain usable or clearly state the minimum size required
  rather than rendering corrupted output.
- **Terminal resized while running**: the layout must reflow and remain readable.
- **No colour or limited colour support**: information conveyed by colour must also be conveyed by text or
  symbol, so the application is usable on a monochrome terminal.
- **Reference data unavailable**: if registries and code lists cannot be retrieved, the application must
  still show results, degrading to numeric codes with a warning rather than refusing to start.
- **Reference data older than results**: a council or party present in results but absent from the cached
  reference data must be displayed with its code and a note, not silently dropped.
- **Clock skew**: if the local clock disagrees with the publisher's timestamps, "last updated" must be
  derived from the published timestamp, not from local time.
- **Two concurrent instances**: two copies of the application sharing one cache location must not corrupt
  each other's cached data.
- **Very large district**: the largest districts contain hundreds of municipalities; lists must remain
  scrollable and responsive.

## Requirements *(mandatory)*

### Functional Requirements

#### Distribution and platform

- **FR-001**: The application MUST be distributed as a single self-contained executable that a user can run
  without installing a runtime, interpreter, or additional dependencies.
- **FR-002**: The application MUST run on Windows 11 and on Linux, with a separate executable provided for
  each platform.
- **FR-003**: The application MUST run entirely inside a terminal, requiring no graphical desktop
  environment.
- **FR-004**: The application MUST render correctly in terminals that support Unicode and in terminals
  restricted to a monochrome palette.
- **FR-004a**: All text the application generates itself – headings, labels, menus, help, status messages,
  and error text – MUST be in Czech, using the same terminology as the published source data. The
  application MUST NOT offer a runtime language choice.
- **FR-005**: The application MUST be operable entirely by keyboard, and MUST display or make discoverable
  the keys available in the current view.
- **FR-006**: The application MUST exit cleanly on user request, restoring the terminal to its prior state.

#### Data sources in scope

- **FR-007**: The application MUST retrieve and present the nationwide aggregate results source.
- **FR-008**: The application MUST retrieve and present the per-district results source for every district
  identified by the published NUTS code list.
- **FR-009**: The application MUST retrieve and present the per-council results source for individual
  municipal and borough councils.
- **FR-010**: The application MUST retrieve the published registry archives and use them to resolve
  councils, seat counts, electoral parties, party composition, and candidates.
- **FR-011**: The application MUST retrieve the published code list archives and use them to resolve
  regions, political parties, political affiliations, electoral parties, council types, and council
  classifications into human-readable names.
- **FR-012**: The application MUST NOT consume the batch ("dávka") result sources, namely the incremental
  polling-district batches and the incremental municipality batches, nor their latest-batch aliases.
- **FR-013**: Because polling-district-level results are published only through a batch source, the
  application MUST NOT offer per-polling-district vote breakdowns, and MUST make that boundary evident to
  the user rather than presenting an empty view.
- **FR-014**: The application MUST allow the user to select which election event and date its data is read
  from, defaulting to the current municipal election, so that the application does not require rebuilding
  when the publication date changes.
- **FR-014a**: The application MUST allow its data source location to be pointed at an alternative base
  location holding a copy of the published data, so that it can be exercised against archived or locally
  served data without contacting the publisher.

#### Polling and freshness

- **FR-015**: The application MUST poll each subscribed live results source on a recurring interval without
  user action.
- **FR-016**: The application MUST NOT poll any individual live source more often than once per 60 seconds,
  which is the publisher's stated refresh granularity.
- **FR-017**: The application MUST allow the user to configure the polling interval, and MUST refuse or
  clamp any configured value that would breach FR-016.
- **FR-018**: The application MUST begin retrieving the nationwide result and every per-district result in
  the background as soon as it starts, and MUST keep refreshing them at the interval the publisher
  documents for those sources.
- **FR-018a**: The application MUST NOT continuously poll every individual council in the country. A
  council's own result is retrieved when the user opens it, and is refreshed only while it remains on
  screen or on the user's watchlist.
- **FR-018b**: The application MUST be usable while the background retrieval is still in progress,
  presenting each area as its data arrives and indicating which areas have not loaded yet, rather than
  blocking the interface until every district has been retrieved.
- **FR-019**: The application MUST allow the user to trigger an immediate refresh, subject to the same
  minimum-interval limit.
- **FR-020**: The application MUST retrieve the registry and code list archives once, on its first run, and
  store them locally in a form it can query directly on later runs.
- **FR-020a**: On every subsequent run the application MUST reuse the stored reference data without
  retrieving it again. It MUST re-retrieve only when the stored copy is absent or unusable, or when the
  user explicitly asks it to refresh.
- **FR-021**: The application MUST display, for every result shown, the publication timestamp of the data
  it came from.
- **FR-022**: The application MUST distinguish provisional results from final results, based on whether all
  polling districts for that area have reported.
- **FR-023**: The application MUST avoid re-downloading unchanged content when the source indicates the
  content has not changed since the previous fetch.
- **FR-024**: The application MUST identify itself to the publisher's servers in its requests so that its
  traffic is attributable.

#### Parsing and correctness

- **FR-025**: The application MUST parse the published data using the publisher's documented structure and
  MUST reject a document that does not conform, rather than displaying partially parsed figures.
- **FR-026**: The application MUST correctly handle Czech diacritics in all source data and display them
  intact.
- **FR-027**: The application MUST retain the last successfully parsed data for a source when a later fetch
  or parse of that source fails.
- **FR-028**: The application MUST prefer the most recently published figures for an area when an area's
  result is republished with changed values.
- **FR-029**: The application MUST present vote counts, vote shares, turnout, and seat counts exactly as
  derived from the source, and MUST NOT estimate, project, or extrapolate results.
- **FR-030**: The application MUST record parse and fetch failures to a log the user can inspect, without
  interrupting the interface.

#### Presentation

- **FR-031**: The application MUST present a national overview containing turnout, count progress, and
  seats by electoral party.
- **FR-032**: Users MUST be able to navigate from the national overview to a district, and from a district
  to an individual council.
- **FR-033**: The application MUST present, for an individual council, each electoral party's votes, vote
  share, and seats won.
- **FR-034**: Users MUST be able to see the candidates of an electoral party within a council, including
  ballot position, personal votes, and whether they were elected.
- **FR-035**: The application MUST present municipalities subdivided into boroughs or city districts as
  separate councils, clearly attributed to their parent municipality.
- **FR-036**: The application MUST visually indicate values that changed since the previous refresh.
- **FR-036a**: The application MUST retain only the most recent result for each area, together with
  whatever is needed to highlight the change from the one before it. It MUST NOT accumulate a history of
  an area's figures over time, and MUST NOT offer trend, replay, or previous-election comparison views.
- **FR-037**: Users MUST be able to sort a list of councils, parties, or candidates by the columns
  displayed.
- **FR-038**: Users MUST be able to search for a council, electoral party, or candidate by name, with
  matching that is insensitive to letter case and to the presence or absence of Czech diacritics.
- **FR-039**: Users MUST be able to add a council to a watchlist and remove it again, and the watchlist
  MUST persist between runs.
- **FR-040**: The application MUST convey every status it signals with colour through text or symbol as
  well.
- **FR-041**: The application MUST remain usable when the terminal is resized, and MUST state the minimum
  supported terminal size when the terminal is smaller than that.

#### Export

- **FR-049**: Users MUST be able to export the table currently displayed to a file at a location of their
  choosing, in a plain tabular format that common spreadsheet software can open directly.
- **FR-050**: An exported file MUST carry the same figures shown on screen, together with the area it
  covers, the publication timestamp of the underlying data, and whether that result was provisional or
  final, so that a figure taken from it can be traced back to its source.
- **FR-051**: Users MUST be able to produce a formatted summary report for a selected council or district
  that is readable as written, without spreadsheet software, containing turnout, count progress, seats by
  electoral party, and the elected candidates.
- **FR-052**: Exporting MUST NOT block the interface, and any failure – including a path that cannot be
  written, insufficient permission, or insufficient space – MUST be reported to the user with its reason
  without terminating the application.
- **FR-053**: Exported files and reports MUST preserve Czech diacritics intact when opened in common
  spreadsheet and text software on both supported platforms.

#### Resilience and local state

- **FR-042**: The application MUST cache retrieved data locally so that a restart does not require
  re-retrieving reference data and so that it can start without network access.
- **FR-043**: The application MUST back off progressively between retries after consecutive failures, up to
  a maximum interval, and resume normal polling once a request succeeds.
- **FR-044**: The application MUST display a persistent, unambiguous indicator whenever displayed data is
  stale, including the reason and the age of the data.
- **FR-045**: The application MUST start successfully and explain the situation when the election data for
  the selected date has not yet been published.
- **FR-046**: The application MUST NOT terminate because of a network error, a malformed document, or an
  unexpected value in the source data.
- **FR-047**: The application MUST store its cache, configuration, watchlist, and log in the conventional
  per-user location for each supported operating system.
- **FR-048**: The application MUST tolerate a second instance running concurrently against the same cache
  location without corrupting stored data.

### Key Entities *(include if feature involves data)*

- **Election event**: A specific municipal election identified by its date; determines which published data
  set every other entity is read from.
- **Region**: A top-level territorial unit, identified by a numeric and a NUTS code, carrying an official
  name.
- **District**: A territorial subdivision of a region, identified by a NUTS code; the unit at which
  per-district result files are published and the intermediate level of the navigation hierarchy.
- **Municipality**: A populated place holding an election; belongs to a district and may be subdivided into
  boroughs or city districts.
- **Council**: An elected body attached to a municipality or a borough, identified by a council code and
  characterised by a council type and classification. It has a fixed number of seats and may be split into
  electoral wards. This is the unit results are actually reported for.
- **Electoral ward**: A subdivision of a council's territory across which its seats are apportioned, where
  a council uses them.
- **Electoral party**: A candidate list standing for election in a council – a political party, a movement,
  a coalition, an association, or a group of independent candidates. Carries a name, an abbreviation, a
  type, votes received, and seats won.
- **Party composition**: The link between an electoral party and the registered political parties that
  constitute it, present because coalitions and associations are made up of several component parties.
- **Political party**: A registered party or movement that may appear as, or within, an electoral party.
- **Political affiliation**: The party membership attributed to an individual candidate, which may differ
  from the electoral party they stand for.
- **Candidate**: A person standing on an electoral party's list within a council, carrying a ballot
  position, an affiliation, personal votes received, and whether they were awarded a seat.
- **Result snapshot**: The figures retrieved for one area at one moment – turnout, polling districts
  reported out of total, votes, and seat allocation – stamped with the publication time and a flag for
  whether the count is complete. Only the current snapshot is retained per area, plus enough of the
  preceding one to highlight what changed.
- **Watchlist entry**: A council the user has chosen to monitor, persisted between runs.
- **Source subscription**: The application's record of one live source it is polling, holding the last
  successful retrieval time, the last failure, and the current retry interval.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user who has never run the application before can download one file, run it, and see live
  national results within 2 minutes, without installing anything else.
- **SC-002**: From a cold start with reference data already cached, the national overview is readable
  within 5 seconds of launch.
- **SC-003**: From the national overview, a user can reach the full result of any named municipality in no
  more than 4 keyboard interactions using search, or no more than 3 levels of navigation using the
  hierarchy.
- **SC-004**: Newly published figures appear on screen within one polling interval of publication, for
  every area currently displayed or watched.
- **SC-005**: The application issues no more than one request per source per 60 seconds, verifiable from
  its own request log.
- **SC-006**: Every figure the application displays for a given area matches the publisher's data for that
  area exactly, with no rounding or derivation errors, across a full sample of districts.
- **SC-007**: With the network disconnected for 10 minutes, the application continues running, keeps the
  last results visible, shows a stale-data warning throughout, and resumes updating within one polling
  interval of reconnection, without a restart.
- **SC-008**: The application runs continuously for the full duration of an election count – at least 12
  hours – without terminating, and without memory growth that degrades responsiveness.
- **SC-009**: No network failure, malformed document, or unexpected source value causes the application to
  terminate; each is surfaced to the user as a message and recorded in the log.
- **SC-010**: The interface responds to a keystroke within 100 milliseconds while a background refresh is
  in progress, so that fetching never blocks navigation.
- **SC-011**: The application is fully operable on a monochrome terminal, with no status distinguishable by
  colour alone.
- **SC-012**: Czech characters render intact in every view on both supported platforms, in application
  labels as well as in source data.
- **SC-013**: Identical results are produced on Windows 11 and on Linux for the same input data.
- **SC-014**: On the second and every subsequent launch, the application retrieves no reference data,
  verifiable from its own request log.
- **SC-015**: Every district's results are available for browsing within 3 minutes of a first launch on a
  typical home connection, without the user having visited those districts.
- **SC-016**: A user can export the table they are viewing in no more than 3 keyboard interactions, and the
  resulting file opens in common spreadsheet software with its columns and Czech characters intact.
- **SC-017**: Every exported file and summary report states the area covered, the publication timestamp,
  and whether the result was provisional or final, so no exported figure is untraceable.

## Assumptions

- **Scope of sources**: "All available data sources except batch" is read as the three ongoing result
  sources (nationwide, per-district, per-council) plus the registry and code list archives. The two
  incremental batch sources are excluded by the user's explicit instruction.
- **Consequence of excluding batch sources**: Per-polling-district vote breakdowns are published only via
  the batch source, so that level of detail is out of scope. The finest granularity the application can
  offer is the individual council.
- **Geographic boundary data out of scope**: The polling-district boundary files are geospatial data served
  from a separate portal and cannot be meaningfully rendered in a terminal, so they are excluded.
- **Reference data is static**: Registries and code lists are published as dated archives ahead of the
  election. They are treated as fixed for the life of the election and retrieved only once, on first run.
- **Read-only client**: The application only consumes published open data. It submits nothing, requires no
  credentials, and needs no account.
- **Public endpoints**: The published open data endpoints are reachable over the public internet without
  authentication or IP allow-listing.
- **Primary usage window**: The application is designed to be most valuable during and shortly after the
  count, but must also work before publication begins and after the result is final.
- **No projections**: The application reports only what the source publishes. Seat projections, swing
  calculations, and comparisons against previous elections are out of scope for this feature.
- **Terminal capability**: Users run a terminal capable of Unicode output. A minimum usable terminal size
  will be stated by the application rather than assumed to be met.
- **Single user, local machine**: There is no multi-user, server, or shared-deployment mode.
- **Data volume**: The complete per-district result set is on the order of 10 MB, which is small enough to
  cache locally in full.
- **Distribution**: Executables are produced for Windows 11 on x86-64 and for Linux on x86-64, which covers
  the stated platform requirement; other architectures are not committed to.
- **Test data before election day**: The live result files for 9 October 2026 do not exist until the count
  begins, so all development and testing runs against fixtures. Fixtures are derived from the published
  2022 municipal election data, which contains the same three non-batch result sets with genuine Czech
  names, coalitions, and borough structures, and are supplemented by hand-written fixtures for edge cases
  the 2022 data does not exercise.
- **2022 data is a shape reference, not a drop-in**: The 2022 edition served the same three result sets
  through query-parameter endpoints rather than the static files used in 2026, and the municipality batch
  source did not exist then. Fixtures derived from 2022 MUST therefore be validated against the published
  2026 schemas, and the 2026 schema is authoritative wherever the two differ.
- **Replay harness**: A local harness serves the fixtures on a timer to rehearse a full count end to end.
  It is a development and verification tool, not a shipped feature, and depends only on FR-014a.

All decisions raised during specification have been resolved; see the Clarifications section.
