# Research: Stop Polling When Results Are Final

**Feature**: `003-stop-polling-when-final` | **Date**: 2026-09-24

The Technical Context had no open technology questions: no dependency is added, and every
decision here is about where a rule lives in the existing code. Each entry records the
decision, why, and what was rejected.

## R1 – Where a source's finality is stored

**Decision**: A new column on the existing polling state,
`source_subscription.final INTEGER NOT NULL DEFAULT 0 CHECK (final IN (0, 1))`.

**Rationale**:
- `source_subscription` already holds everything about *whether and when* a source is
  polled. Finality is one more fact of the same kind.
- It is already in `RESULT_TABLES` (`src/storage/dataset.ts:69`), so `--reset` and a
  dataset change clear it with no new code (FR-007).
- It is already persisted, so a restart keeps it (FR-006).

**Alternatives considered**:
- *Derive finality from the stored snapshots on every `due()` call.* No schema change,
  but a district's finality would need a join over every council in that district. It
  would also rely on `council.district_nuts` matching file membership, and the ingest
  code notes that it does not always (Prague). It also gives no clean way to let a manual
  refresh through. Rejected: more SQL, weaker rule.
- *An in-memory set of final keys.* Lost on restart, so it fails FR-006.

## R2 – How the schema change reaches existing databases

**Decision**: Raise `SCHEMA_VERSION` to 2. In `openDatabase`, a database at version 1 is
upgraded in place with one `ALTER TABLE source_subscription ADD COLUMN final …`, and the
version is then recorded as 2. Any other mismatch still throws `SchemaVersionError`, as
today.

**Rationale**: Without an upgrade, every existing database would refuse to open, and the
user would be told to delete the file. That throws away 7 MB of registries and the
watchlist to gain one column. SQLite adds a column with a constant default in place, so
the upgrade is a single statement.

**Alternatives considered**:
- *Bump the version and let the existing error tell the user to delete the file.* This
  matches the comment in `db.ts` that rebuilding beats migrating. But it costs the user
  their watchlist and a re-download, two weeks before the election. Rejected.
- *A general migration framework.* One step does not justify a framework (Principle I,
  YAGNI). The step is a named function for version 1 only.
- *`CREATE TABLE IF NOT EXISTS` alone.* It does not add columns to an existing table, so
  it would silently leave old databases without the column.

## R3 – What makes a fetched document final

**Decision**: Each ingest function reports `final: boolean` on success, computed from the
snapshots it has just built with the existing `determineStatus`:
- **National**: every `TYP_ZASTUP` block is final.
- **District**: the document lists at least one council, and every council in it is final.
- **Council**: every `OBEC` block in it is final.

A document with no blocks at all is not final.

**Rationale**: The rule reads the document the scheduler has just fetched, so FR-001's
"most recent successfully read copy" holds literally. No second definition of "final"
is written (Principle I, DRY): the per-area rule stays in `determineStatus`, and ingest
only combines results with `every`.

A council published without a result has zero polling districts, so `determineStatus`
already calls it not final (spec edge case). "Not empty" is required explicitly, because
`[].every(...)` is `true`.

**Alternatives considered**: Returning the snapshot list and letting the caller decide.
Rejected, because the three document shapes would leak into `app.ts`.

## R4 – How the scheduler skips final sources and still lets a manual refresh through

**Decision**: A final source has no next due time: `next_due_at` is `NULL`.
- `due()` returns only rows with `next_due_at <= now`. The `IS NULL` branch is removed.
- `recordSuccess(key, validators, now, final?)`:
  - A `200` passes `final`. A `304` passes nothing and keeps the stored value, because
    unchanged bytes have unchanged finality.
  - `next_due_at` becomes `NULL` when the resulting `final` is 1, and the usual interval
    otherwise.
- `recordFailure` on a final source increments the failure count but leaves
  `next_due_at` `NULL`, so a failed manual refresh does not restart automatic polling.
- `requestRefresh` is unchanged. It sets `next_due_at = now`, subject to the 60-second
  floor, so the next `tick()` fetches the source once whatever its finality (FR-004).
- A `200` that is no longer final sets `final = 0` and a normal due time, so automatic
  polling resumes (FR-005).

**Rationale**:
- Nothing new is needed for "manual refresh": the one existing mechanism, a due time of
  now, serves both the automatic and the manual path.
- Today every insert and update writes `next_due_at`, so the `IS NULL` branch in `due()`
  can only be reached by a hand-edited row. Giving `NULL` the meaning "nothing
  scheduled" changes no behaviour that exists.
- Sources still in progress keep the exact due times they had, so FR-003 and SC-006 hold
  by construction.

**Alternatives considered**:
- *`WHERE final = 0` in `due()`, plus a separate "refresh requested" column.* Two columns
  to express one idea.
- *Clearing `final` on a manual request.* A failed or `304` manual refresh would then
  restart automatic polling of final data.
- *A far-future `next_due_at`.* A magic value, and it misleads anyone reading the table.

## R5 – Council subscriptions that are left behind

**Decision**: `syncSubscriptions` no longer unsubscribes a council that is `final`.
A council that is still in progress is unsubscribed when left, as today.

**Rationale**:
- Today a left council is deleted and re-subscribed on the next visit, and a fresh row
  is due immediately with no 60-second history. Reopening a final council would fetch it
  every time.
- Keeping the row costs no requests, because a final row is never due. It also keeps the
  60-second floor.
- The set stays bounded by the councils the user actually opened. Rows are cleared with
  the results.

**Alternatives considered**: Seeding `final` from the stored snapshot when a council is
re-subscribed. That is a second route to the same fact, and it needs a snapshot query in
the subscribe path.

## R6 – Telling the user polling has stopped

**Decision**:
- The title bar's live indicator, today ` ● živě `, shows ` ■ konečné · obnova ručně `
  when every source the current screen shows is final. That is text, not colour
  (FR-008).
- The footer already lists `r obnovit` on every screen, which covers "manual refresh is
  still available".
- "The sources a screen shows":
  - Ordinary screens: the result of `sourcesForScreen`.
  - The national screen, and screens with no source of their own: `national`.
  - The watchlist: the watched councils.
- `staleWarning` ignores final subscriptions. The stale badge is driven by that warning,
  so it follows (FR-009).

**Rationale**:
- The indicator is the one place that already claims the data is "live", so that claim is
  the one that has to change. Nothing moves, and no row is added, so every screen still
  fits in 80 × 24.
- The warning today fires on failures, never on age. For a final source, the only
  failure left is a failed manual refresh. Calling final figures "ZASTARALÁ DATA" would
  be false, so the failure goes to the log (`log.warn`, as for every failure today).

**Alternatives considered**:
- *A new line under the table.* That costs a content row on 24-row terminals.
- *A one-off notice on each refresh.* It disappears on the next keystroke, and FR-008
  asks for a lasting statement.
- *Warning on a failed manual refresh of final data.* The warning would never clear,
  because nothing retries the source automatically.

## R7 – Manual refresh blocked by the 60-second floor

**Finding**: `refreshNow` ignores `requestRefresh`'s return value, so a blocked refresh
does nothing visible. The spec first said the user "is told when refresh becomes
available, as today". That was wrong, and scenario 2.2 now says only that no request is
made.

**Decision**: No change here. Feedback on a blocked refresh is a separate improvement,
outside what the user asked for.
