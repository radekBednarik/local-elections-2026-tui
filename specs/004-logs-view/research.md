# Research: Logs View Instead of the Stale-Data Warning Line

**Feature**: `004-logs-view` | **Date**: 2026-09-24

Only one technology question came up: how to reach the clipboard. `@opentui/core` 0.5.11
already answers it (R7). Every other decision is about where a rule lives in the existing
code. Each entry records the decision, why, and what was rejected.

## R1 – Telling "not yet published" from "stale"

**Decision**: Classify the failing, non-final subscriptions by `lastSuccessAt`:
- If any of them has a `lastSuccessAt`, the state is **stale**. The user is looking at
  figures that were current once and are now out of date.
- If none of them has one, the state is **awaiting**: nothing has ever been loaded, so
  nothing on screen can be out of date.
- If none is failing, there is no source problem.

The judgement stays global across every subscription, as `staleWarning` and the title
bar badge already are (003 contract § 2).

**Rationale**:
- `lastSuccessAt` is already persisted in `source_subscription.last_success_at`, so
  "never loaded, in this session or earlier" (FR-001) needs no new state.
- `--reset` and a dataset change already clear the table, so a fresh dataset starts in
  the awaiting state again.
- One rule covers both ways a source can be unpublished: a `404` (`not-found`) and a
  document rejected because it has no results yet (`schema-mismatch`). Telling those
  apart by parsing the error text would be fragile and gains nothing, because both mean
  "no data yet" for a source that has never loaded.
- When stale and awaiting sources are both failing, the stale state wins (spec edge
  case). The user is looking at out-of-date figures somewhere, and that matters more.

**Alternatives considered**:
- *Per-screen classification.* The spec first said "shown on the current screen". That
  would mean mapping failures to screens, and it would differ from the stale badge,
  which is global by design (003). Rejected, and the spec's FR-002 was reworded to match.
- *Detect "no results yet" from the rejection reason.* Fragile, and unnecessary under
  the rule above.

## R2 – What the main screen shows

**Decision**: `staleWarning` is replaced by `sourceStatus(subscriptions, now)`. It
returns `{ kind: "stale" | "awaiting", text }` or `null`, and the text is fixed Czech
with no error text (contract § 1):
- **stale**: `! ZASTARALÁ DATA: zobrazena data {age}. Obnovení se nedaří. · l záznamy`
- **awaiting**: `○ Výsledky zatím nejsou zveřejněny, aplikace je průběžně kontroluje. · l záznamy`

The title bar indicator gains a fourth state, `awaiting`, shown as ` ○ čeká na výsledky `
in the `muted` role. `stale` keeps ` ● ZASTARALÉ `.

On the logs screens the status row is not shown: it would point to the screen the user
is already on. The title badge still shows the state.

**Rationale**:
- One function owns the rule and the wording. The frame only renders what it returns,
  as it does today.
- The source scope (`CZ0642` or `N zdrojů`) is dropped with the error text. Neither
  helps a non-technical reader, and both are in the log.
- The age stays, because FR-003 requires it. When several failing sources have loaded
  before, the age comes from the **oldest** `lastSuccessAt` among them, so the line
  gives the largest age. That is the conservative figure: somewhere on screen the data
  may be that old, and understating it would mislead the user in the direction that
  matters. The old `staleWarning` took the age from the source with the most
  consecutive failures, which usually, but not always, gave the same answer. The rule
  is now explicit.

**Alternatives considered**:
- *Title badge only, no status row in the awaiting state.* Saves a content row, but
  fails FR-004, which requires a line that names the logs key.
- *Keep the reason but make it friendlier.* That means mapping every rejection reason
  to prose, and it is still wrong before publication. Rejected.

## R3 – A one-off notice versus the persistent status row

**Decision**: A notice (a copy confirmation, "Tento příkaz zde není dostupný", and so
on) now takes the row for the one keystroke it lives. The source status returns on the
next key press. This reverses today's rule, where the stale warning always wins.

**Rationale**: The awaiting line can be up for hours before publication. Under the old
rule, every confirmation in that time would be hidden, including the copy notice that
FR-018 requires. The title bar badge still shows the source state while a notice is up,
so nothing is lost.

**Alternatives considered**: *A second row for notices.* It costs a content row on every
screen to cover a moment. Rejected.

## R4 – Where log entries are kept for the view

**Decision**: The logger keeps a bounded in-memory record next to the file:
- The last `LOG_VIEW_LIMIT = 1000` entries, and a running `dropped` count of entries
  evicted from the front.
- Each entry is recorded if it passes the level threshold, **whether or not the file
  write succeeds**, so the view survives a failing log file (spec edge case).
- The entry keeps the exact line the file receives, from the same `format` call. FR-015
  therefore holds by construction.
- The entry also keeps its serialised `detail` text, the part after ` | `, from the
  same serialisation the line uses. The list's message column is then `message` plus
  `detail`, without parsing the line back apart.
- New `Logger` members: `entries(): readonly LogEntry[]` and `dropped: number`.
  `createNullLogger` returns an empty record.

**Rationale**:
- The logger is the one place every entry passes through. The existing interface
  comment ("for tests and for the in-app log view") already anticipates this.
- A ring of 1000 short strings is well under 1 MB.

**Alternatives considered**:
- *Read the log file back.* It includes earlier sessions (out of scope) and costs file
  I/O on every draw. It also fails exactly when the file is broken.
- *A separate `LogBuffer` passed alongside the logger.* That is a second object at every
  call site for one consumer. Rejected (Principle I).

## R5 – Logging "not published yet"

**Decision**: The two outcomes that mean "no usable data yet" are logged only when the
reason changes. `recordFetch` reads the subscription's `lastError` before recording
the new failure, and:
- **`not-found`**: logs at `info` (`Data zatím nejsou zveřejněna`, with the source).
  It is not logged at all today.
- **A rejected document**: keeps its `warn` `Dokument odmítnut`. It is logged only when
  the rejection reason differs from `lastError`.

A success clears `lastError`, so the next occurrence after a success is logged again.
Transport failures (`failed`, `Stahování selhalo`) are still logged every time.

**Rationale**:
- Today a `404` is recorded on the subscription but never logged. Before publication,
  the status line would send the user to a logs view that says "no entries yet".
- Before publication, the more common case is a document that exists but does not yet
  have the expected shape. This is what prompted the feature. That case is rejected by
  validation and logged on every retry. Retry backoff (`backoffSeconds`) spaces the
  retries out, but across 79 sources the repeats would still crowd out everything else
  in a 1000-entry view.
- Logging only the change keeps the useful facts: when each source started being
  unavailable, why, and when the reason changed.

**Alternatives considered**: *Deduplicate every repeated failure, including transport
errors.* A run of network failures is diagnostic information the user may need to
count, and it is not the pre-publication case. Out of scope.

## R6 – The logs screens

**Decision**: Two new `Screen` kinds, reached through the existing navigation stack:
- `{ kind: "logs" }`: one line per entry, oldest first:
  `HH:MM:SS  VAROVÁNÍ  district:CZ0642  Dokument odmítnut | {…}`.
  Rows are cut to width like every other row.
- `{ kind: "log-entry"; seq: number }`: one entry in full. This is the exact log-file
  line, wrapped to the view width. It is opened with `Enter` from the list.

Behaviour:
- `l` pushes `logs` and then moves the selection to the last row (FR-009).
- `Esc` is the existing `back`. It pops to the list, or to wherever the logs were
  opened from, with that stack entry's selection and offset restored (FR-008).
- Each entry has a `seq` (its position in the whole session), so the detail screen
  names one entry even after the list has moved on. An entry evicted meanwhile shows
  `Záznam již není k dispozici.`.
- **Keeping the selection on its entry (FR-012):** appending changes no index, so only
  eviction can move the selection. The app remembers `dropped` when it last drew the
  logs screen, and subtracts the difference from the selection (clamped at 0).
- **Where the behaviour lives:** no test constructs `App`, and `perform` is private.
  Opening the list (push, then select the last row) and the eviction correction are
  therefore two pure functions in `src/ui/views/logs.ts`, `openLogs` and
  `syncLogSelection`. They work on a real `Navigation`, and `App` only calls them. This
  keeps every line of production code behind a failing test (Principle II). A
  structural test guards against the glue growing a second implementation, as
  `tests/ui/palette.test.ts` already does for `perform`.
- **Severity:** a Czech label carries the meaning (`CHYBA`, `VAROVÁNÍ`, `INFO`,
  `LADĚNÍ`, padded to one width). `CHYBA` and `VAROVÁNÍ` rows use the existing
  `warning` role, `LADĚNÍ` uses `muted`, and `INFO` uses the default text. No new role
  or theme slot.

**Rationale**:
- Everything else is reused:
  - the stack's per-entry selection and offset give FR-008,
  - `move`/`jump` give FR-013,
  - `open` gives FR-011,
  - the frame and theme pipeline give FR-020 and FR-022.
- A detail screen is the simplest way to show a long entry in full. A list row is one
  line (`firstRow + selected` maps a selection to a line), so wrapping inside the list
  would break selection and scrolling on every screen that shares that code.

**Alternatives considered**:
- *Wrap entries inside the list.* Needs multi-line selectable rows, a change to shared
  navigation. Rejected.
- *A pinned detail pane under the list.* The content area scrolls as one block, so the
  pane would scroll away. Rejected.
- *An overlay like the command palette.* A second rendering path with its own theming,
  when a screen gets theming for free. Rejected.

## R7 – Copying to the clipboard

**Decision**:
- **Mechanism:** use `CliRenderer.copyToClipboardOSC52(text)` from `@opentui/core`
  0.5.11. The App reaches it through one injected function, `copy(text): boolean`.
- **Where the behaviour lives:** choosing the text, calling `copy`, containing a throw
  and wording the notice are one pure function, `performCopy`, in
  `src/ui/views/logs.ts`. Tests pass it a recorder. `App` passes the real clipboard
  and shows the notice it returns (see R6 for why).
- **What `c` copies:** the selected entry's log-file line. On the detail screen, that
  entry's line.
- **What `C` copies:** every entry's line, oldest first, joined by `\n`.
- **Notices:**
  - After a send: `Odesláno do schránky: 1 záznam.` / `3 záznamy.` / `12 záznamů.`,
    using the existing `plural`.
  - When the call returns false: `Terminál nepodporuje kopírování do schránky.`
  - With no entries: `Není co kopírovat.`

**Rationale**:
- OSC 52 goes through the terminal the user is sitting at. It therefore works over SSH
  and on Windows Terminal, and needs no `xclip` or `clip.exe`.
- The renderer writes the sequence in step with its own output, so the frame is not
  corrupted (FR-019).
- A terminal may silently ignore OSC 52, so the notice says "sent", not "copied"
  (spec Assumptions).

**Alternatives considered**:
- *OpenTUI's host clipboard backend (`ClipboardWriteDestination`).* It is async and
  platform-specific, and it is not needed for FR-016 to FR-019. It can be revisited if
  users report terminals without OSC 52.
- *Shelling out to a platform tool.* A platform matrix and a subprocess, for no gain
  over OSC 52.

**Known limit**: some terminals and multiplexers cap the size of an OSC 52 payload.
`C` on a full 1000-entry log can exceed that cap. The call still returns without error,
so the notice may report a send the terminal dropped. This is accepted for now and
noted in the quickstart.

## R8 – Keys and the action registry

**Decision**: Three registry entries. Each appears in the status bar, the palette and the
help screen automatically:

| id | key | short | available |
|---|---|---|---|
| `logs` | `l` | | everywhere except `logs` and `log-entry` (`záznamy jsou právě otevřené`) |
| `copy-entry` | `c` | | on `logs` and `log-entry` only |
| `copy-all` | `Shift+C` | `C` | on `logs` and `log-entry` only |

Placement and behaviour:
- `copy-entry` and `copy-all` go right after `back`, so a narrow status bar keeps them
  on the logs screens. Elsewhere they are unavailable and take no space.
- `logs` goes after `search`.
- `open` is unchanged. It applies on `logs` because the list has rows, and it opens the
  detail. It does not apply on `log-entry`, which has no rows.
- In the key map, `l` maps to `logs`. `c` and Shift+c map to the copy actions,
  distinguished by `shift` in the same way `w`/`W` and `e`/`E` are.
- `l` typed while the search box has focus goes to the query, because the search
  handler runs first. Typed in the palette, it goes to the palette input. Both paths
  are unchanged.

**Rationale**: the registry is the single source of truth for keys (001 FR-064). Adding
entries there is the whole of FR-007 and FR-021.
