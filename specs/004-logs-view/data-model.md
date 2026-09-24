# Data Model: Logs View Instead of the Stale-Data Warning Line

**Feature**: `004-logs-view`

There are no storage changes. `SCHEMA_VERSION` stays at 2, and no column or table is
added. Everything below is in-memory state or a type.

## LogEntry (new, `src/logging/logger.ts`)

One entry the logger accepted, as held for the logs view.

| Field | Type | Meaning |
|---|---|---|
| `seq` | `number` | Position in the session: 0 for the first entry, rising by one. It is never reused, so it still names one entry after evictions. |
| `at` | `string` | ISO timestamp, the same one written to the file. |
| `level` | `LogLevel` | `error`, `warn`, `info` or `debug`. |
| `message` | `string` | The message passed to the logger. |
| `detail` | `string \| null` | The serialised detail, exactly the text after ` \| ` in `line`: `Name: message` for an `Error`, JSON otherwise, or `[detail could not be serialised]`. `null` when no detail was given. |
| `source` | `string \| null` | `detail.source` when the detail is an object with a string `source`, otherwise `null`. |
| `line` | `string` | The exact line written to the file, without the trailing newline. This is what is copied and what the detail screen shows. |

**Rules**
- An entry is recorded only when it passes the level threshold, the same test that
  gates the file write.
- An entry is recorded even when the file write fails, or has been turned off after an
  earlier failure.
- `line` comes from the same `format(...)` call as the file text. There is one
  formatter, not two.
- `detail` comes from the same serialisation `line` uses. When `detail` is not null,
  `line` ends with `` `${message} | ${detail}` ``, otherwise with `message`.

## Logger (changed)

It gains two read-only members:

| Member | Type | Meaning |
|---|---|---|
| `entries()` | `readonly LogEntry[]` | Entries held, oldest first. At most `LOG_VIEW_LIMIT` (1000). |
| `dropped` | `number` | How many entries were evicted from the front so far. It only grows. |

**Invariant**: `entries()[i].seq === dropped + i`.

`createNullLogger()` returns `entries() = []` and `dropped = 0`.

## SourceStatus (replaces the `string | null` from `staleWarning`)

```text
SourceStatus = null | { kind: "stale" | "awaiting"; text: string }
```

It is derived from subscriptions that are failing (`consecutiveFailures > 0`) and not
`final`. The rule is in [research.md R1](research.md#r1--telling-not-yet-published-from-stale):

```text
no failing subscription                    → null
any failing one has lastSuccessAt ≠ null   → stale
otherwise                                  → awaiting
```

For `stale`, the age in `text` is measured from the **oldest** `lastSuccessAt` among
the failing subscriptions that have one, clamped at zero
([research.md R2](research.md#r2--what-the-main-screen-shows)).

## LiveIndicator (changed, `src/ui/chrome/state.ts`)

`"live" | "final" | "stale"` becomes `"live" | "final" | "stale" | "awaiting"`. The
precedence is checked top to bottom, and the first match wins:

1. The source status is `stale`: `stale`.
2. The source status is `awaiting`: `awaiting`.
3. Every source shown on screen is final: `final`.
4. Otherwise: `live`.

## FrameInputs / FrameState (changed)

- `FrameInputs.warning: string | null` becomes `sourceStatus: SourceStatus`.
- `FrameInputs` gains `logEntries: readonly LogEntry[]`. It is passed through to
  `composeScreen`, which needs it only for the logs screens.
- `FrameState.warningKind` becomes `"stale" | "awaiting" | "notice" | null`.
- **Look of the status row:**
  - `stale` keeps the `warning` surface with the `warning` role.
  - `awaiting` uses the `element` surface with the `muted` role.
  - `notice` is unchanged.
- **Precedence of the row (R3):** a notice first, then the source status. The source
  status is left out on the `logs` and `log-entry` screens.

## Screen (changed, `src/ui/navigation.ts`)

```text
Screen gains:
  | { kind: "logs" }
  | { kind: "log-entry"; seq: number }
```

| Screen | `screenLabel` | Breadcrumb segment | `shownSources` | `rowCount` | `open` target |
|---|---|---|---|---|---|
| `logs` | `ZÁZNAMY` | `Záznamy` | as `help`: `national` | number of entries | `{ kind: "log-entry", seq }` of the selected row |
| `log-entry` | `ZÁZNAM` | `Záznam` | as `help`: `national` | 0 | none |

## App state (changed, `src/ui/app.ts`)

| Field | Type | Purpose |
|---|---|---|
| `logsDroppedSeen` | `number` | `logger.dropped` when the logs screen was last drawn. When `dropped` has grown, the selection on a `logs` stack entry is reduced by the difference, clamped at 0 (FR-012). Updated only through `syncLogSelection`. |

## Logs-screen functions (new, `src/ui/views/logs.ts`)

These are pure functions, so every decision the App makes about the logs screens is
tested without driving `App` (research R6, R7):

| Function | Does |
|---|---|
| `openLogs(nav, count)` | Pushes `{ kind: "logs" }` and selects row `count - 1`, or 0 when `count` is 0, returning `true`. Already on `logs` or `log-entry`, it pushes nothing and returns `false`. |
| `syncLogSelection(nav, seen, dropped)` | On `logs` only: reduces `selected` by `dropped - seen`, clamped at 0, and returns `dropped`. On any other screen it changes nothing and returns `seen`. |
| `performCopy(scope, screen, selected, entries, copy)` | Off the logs screens returns `NOT_AVAILABLE_HERE` without calling `copy`. Otherwise it picks the text (`copyText`), calls `copy` unless there is nothing to copy, treats a throw as `false`, and returns the notice (`copyNotice`). |
| `buildLogListRows` / `buildLogEntryRows` | A line break in an entry shows as ` ↵ ` in its list row, and starts a new row in the detail (CRLF, CR or LF). |

`AppDependencies` gains `copy?: (text: string) => boolean`. When it is absent, the App
uses `renderer.copyToClipboardOSC52`.

Two App methods are glue only, pinned by structural tests in `tests/unit/logs-view.test.ts`:
- `copyToClipboard`, which passes the clipboard to `performCopy`;
- `logUnhandled(message, detail)`, which logs an error the process-level handlers
  caught and then draws, so an open logs view shows it at once (FR-012).

## ActionId (changed, `src/ui/palette/actions.ts`)

It gains `"logs" | "copy-entry" | "copy-all"`. See
[research.md R8](research.md#r8--keys-and-the-action-registry) for keys, placement and
availability.

## State transitions: source status

```text
            first failure, never loaded
  (none) ─────────────────────────────▶ awaiting
    ▲  ▲                                   │
    │  │ all failing sources recover       │ a source loads, then later fails
    │  └───────────────────────────────────┤
    │                                      ▼
    └──────── all failing sources recover ── stale
```

A source that loads successfully leaves the failing set. If it was the only failing
source, the status goes back to `null`. Entries already in the logs view stay.
