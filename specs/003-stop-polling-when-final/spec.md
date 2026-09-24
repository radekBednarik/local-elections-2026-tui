# Feature Specification: Stop Polling When Results Are Final

**Feature Branch**: `003-stop-polling-when-final`

**Created**: 2026-09-24

**Status**: Draft

**Input**: User description: "Currently, the README states, that nationwide results and 78 districts files are refreshed continously. I want this new feature to ensure, that once the results are final (completion is 100 %) the data source will no longer be polled automatically. Manually user can still poll them if he wants. But I want the application to not hammer the servers once the data are final."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Final sources stop being polled on their own (Priority: P1)

Late on election night the count finishes district by district. Each result source whose
figures the application already knows to be final stops being requested automatically, so
a user who leaves the dashboard running overnight or for days adds no load to the
publisher's servers for data that can no longer change. Sources still being counted
carry on polling exactly as before.

**Why this priority**: This is the whole point of the feature. The publisher's servers
carry peak load on election night; repeating requests for data that is final is waste the
application can avoid on its own.

**Independent Test**: Run the application against a source that publishes a final
nationwide result and a mix of final and in-progress district files. Watch requests for
several polling intervals: final sources are requested no more, in-progress ones keep
being requested at the usual interval.

**Acceptance Scenarios**:

1. **Given** the application is polling a district file that is still in progress, **When** a refresh returns that file with every council in it final, **Then** that file is not requested again automatically for the rest of the session.
2. **Given** the nationwide result is in progress, **When** a refresh returns it final for every council type it reports, **Then** it is not requested again automatically.
3. **Given** some district files are final and others are not, **When** further polling intervals pass, **Then** only the files that are not yet final are requested.
4. **Given** every nationwide and district source is final, **When** the application keeps running, **Then** it makes no automatic result requests at all.
5. **Given** an opened or watched council whose result is final, **When** polling intervals pass, **Then** that council's source is not requested automatically either.

---

### User Story 2 - Manual refresh still works on final data (Priority: P2)

A user who suspects the publisher has corrected a result after the count closed can
still ask for fresh data with the existing refresh action. The request goes out, subject
to the same once-per-60-seconds floor as any other request.

**Why this priority**: The user asked for it explicitly. Stopping automatic polling must
not remove the user's own control over the data.

**Independent Test**: With a final source on screen, press the refresh key and confirm
exactly one request for that source is made and its result is shown. Press it again
within 60 seconds and confirm no second request is made.

**Acceptance Scenarios**:

1. **Given** the screen on view shows data from a final source, **When** the user invokes refresh, **Then** that source is requested once and the figures it returns are shown.
2. **Given** a final source was requested less than 60 seconds ago, **When** the user invokes refresh again, **Then** no request is made, as today.
3. **Given** a manual refresh of a final source returns the same final data, **When** later polling intervals pass, **Then** the source stays out of automatic polling.
4. **Given** a manual refresh of a final source returns data that is no longer final, **When** later polling intervals pass, **Then** the source goes back to automatic polling.

---

### User Story 3 - The user can see that polling has stopped (Priority: P3)

A user looking at a final result can tell that the figures are final and that the
application is no longer checking for updates on its own, so a timestamp that stops
moving is not mistaken for a broken connection or stale data.

**Why this priority**: Without it, the correct behaviour looks like a fault. The
application already warns about stale data, and that warning must not fire for data that
is simply finished.

**Independent Test**: Open a final result and confirm the screen states, in text, that
the result is final and that automatic refresh has stopped for it. Leave it open well
past the stale-data threshold and confirm no stale-data warning appears.

**Acceptance Scenarios**:

1. **Given** every source the screen shows is final, **When** the user looks at the title bar, **Then** it says in text that automatic refresh has stopped because the results are final, and that manual refresh is still available.
2. **Given** a final source has not been requested for longer than the stale-data threshold, **When** the user views it, **Then** no stale-data or connection warning is shown for it.
3. **Given** the screen shows a source still in progress, **When** the user looks at the title bar, **Then** it shows the usual live indicator and no "stopped" message.

---

### Edge Cases

- **A figure reaches 100 % counted before the source flags the result as counted.** Finality follows the application's existing rule, which requires both signals to agree. Polling continues until they do, so it never stops one refresh early.
- **The nationwide result reports several council types and only some are final.** The nationwide source stays in automatic polling until every council type it reports is final.
- **A district file contains a council that publishes no result at all.** A district file is final only when every council it lists is final. A council with no result is not final, so the file keeps being polled.
- **The application is restarted after sources became final.** Sources already known final from stored data stay out of automatic polling after the restart, with no fresh request to confirm them.
- **Stored data is dropped** (`--reset`, or pointing the application at a different election, date or base URL). Finality is forgotten with the data, and every source starts in automatic polling again.
- **A request for a source that is still in progress fails.** Failure handling and backoff are unchanged. Only final data stops polling, never a failure.
- **A manual refresh of a final source fails.** The source stays final and unscheduled, the stored figures stay on screen, and the failure is written to the log only. No stale-data warning is raised: the figures are final, not stale, and since nothing retries a final source automatically, such a warning would never clear. A failed refresh therefore looks the same on screen as one that found no change. This is accepted.
- **The user runs the application against an election that is already complete** (a mirror of 2022, for example). Each source is fetched once, found final, and then left alone.
- **The user opens a council for the first time and it is already final.** It is fetched once to get its figures, then not polled automatically while it stays on screen or on the watchlist.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The application MUST stop requesting a result source automatically once the most recent successfully read copy of that source shows it final.
- **FR-002**: A source MUST count as final only when all of the results it carries are final under the application's existing definition of a final count: the source's own "counted" flag, where it has one, and all polling districts counted. The nationwide source is final when every council type it reports is final. A district file is final when every council it lists is final. A council source is final when that council is final.
- **FR-003**: Sources that are not final MUST keep being polled on the existing interval, spread across it, with the existing failure backoff. A source becoming final MUST NOT change the schedule of the sources still being polled.
- **FR-004**: The user MUST still be able to refresh a final source manually with the existing refresh action. That refresh MUST obey the existing once-per-60-seconds floor per source.
- **FR-005**: If a manual refresh returns data that is no longer final, the source MUST go back to automatic polling. If it returns final data, the source MUST stay out of automatic polling.
- **FR-006**: Knowledge that a source is final MUST survive a restart, so that a restarted application does not request final sources automatically.
- **FR-007**: When stored results are dropped (by `--reset`, or because the election, date or base URL changed), every source MUST start in automatic polling again.
- **FR-008**: For a screen where every source it shows is final, the title bar MUST say in text, not colour alone, that automatic refresh has stopped because the results are final and that manual refresh is still available.
- **FR-009**: The stale-data and connection warnings MUST NOT be shown for a source only because it has not been requested since it became final.
- **FR-010**: Registries and code lists are outside this feature. Their existing download-once behaviour MUST NOT change.
- **FR-011**: The README section on polling MUST describe the new behaviour: automatic polling stops for each source once its results are final, and manual refresh stays available.

### Key Entities

- **Result source**: One published results document the application polls: the nationwide result, one of the 78 district files, or one council's file. Each one is now either *polled automatically* or *final, not polled automatically*.
- **Source finality**: Whether the most recent successfully read copy of a source was final under FR-002. It is stored with the source's other polling state and dropped together with the stored results.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Against a data source where every result is final, a session left running for one hour makes at most one automatic request per result source it uses, and none after that.
- **SC-002**: In a session where results become final over time, the number of automatic requests per polling interval falls as sources become final, reaching zero once every polled source is final.
- **SC-003**: After a restart against unchanged final data, the application makes zero automatic result requests for sources already known final.
- **SC-004**: A manual refresh of a final source produces exactly one request whenever the 60-second floor allows it, and zero requests when it does not.
- **SC-005**: A user viewing a final result can tell from the screen alone, without colour, that automatic refresh has stopped and that manual refresh is still available.
- **SC-006**: No source that is still in progress misses an automatic poll because of this feature. Its polling cadence is unchanged.

## Assumptions

- "Final" means what the application already calls final and labels "konečné výsledky". The feature adds no new completeness rule. The user's "completion is 100 %" is read as that existing rule, which already needs 100 % of polling districts counted.
- The rule applies to each source on its own, not to the election as a whole. A district that finishes early stops being polled even while others are still counting. That gives the largest reduction in load, and it matches how the publisher releases results.
- Council sources, fetched when opened or watched, follow the same rule as the nationwide and district files. The user named only the nationwide and district files, but a watched council polled forever after it is final is the same waste.
- Publisher corrections after a result is final are rare. Covering them with manual refresh, not with a slower automatic poll, is acceptable, as the user's description says.
- The existing 60-second floor, backoff and conditional-request behaviour stay as they are. This feature decides only *whether* a source is polled automatically, not how.
