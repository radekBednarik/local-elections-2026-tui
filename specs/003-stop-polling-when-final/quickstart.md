# Quickstart: validating that final results stop being polled

**Feature**: `003-stop-polling-when-final`

How to prove the feature works, end to end. The expected behaviour is in
[contracts/interface.md](contracts/interface.md), and the state rules are in
[data-model.md](data-model.md#state-transitions).

## Prerequisites

- Bun 1.4.2 or later, and dependencies installed (`bun install`).
- The replay harness (`tools/replay/server.ts`). It serves the fixtures over a compressed
  clock, and it prints one line per request it receives, which makes polling visible.

## 1. Automated checks

```powershell
bun test
bun run typecheck
bun run check
```

All three must pass. The tests that carry this feature:

| What | Where | Proves |
|---|---|---|
| A final `200` clears the due time, and `due()` never returns the source | `tests/integration/scheduler.test.ts` | FR-001, SC-001 |
| Sources in progress keep their due times when another becomes final | `tests/integration/scheduler.test.ts` | FR-003, SC-006 |
| `requestRefresh` on a final source makes it due once, subject to the 60 s floor | `tests/integration/scheduler.test.ts` | FR-004, SC-004 |
| A `304` or a failure after a manual refresh leaves the source final and unscheduled | `tests/integration/scheduler.test.ts` | FR-005 |
| A `200` that is no longer final restores automatic polling | `tests/integration/scheduler.test.ts` | FR-005 |
| Ingest reports `final` for national, district and council documents, including an empty document and a council with no result | `tests/integration/ingest.test.ts` | FR-002 |
| Finality survives reopening the database, and `--reset` and a dataset change clear it | `tests/integration/dataset.test.ts` | FR-006, FR-007, SC-003 |
| A version-1 database opens, gains the column and is recorded as version 2 | `tests/integration/schema.test.ts` | research R2 |
| A final council is not unsubscribed when left | `tests/integration/watchlist.test.ts` or `screen.test.ts` | research R5 |
| The title bar shows `konečné · obnova ručně` only when every shown source is final | `tests/unit/status-bar.test.ts` | FR-008, SC-005 |
| `staleWarning` ignores final subscriptions | `tests/unit/status-bar.test.ts` | FR-009 |

## 2. A count that finishes (replay)

```powershell
bun run replay -- --duration 120
```

In a second terminal:

```powershell
bun run dev -- --base-url http://localhost:8787 --reset
```

Watch the replay terminal:

1. For the first two minutes, `vysledky.xml` and the two district fixtures
   (`CZ0100`, `CZ0642`) are requested about once a minute, as today.
2. Once the count reaches 100 %, each of them is requested **once more**, is read as
   final, and then **never appears again**.
3. The other 76 districts have no fixture. They keep appearing as `404` lines once per
   interval, because a missing document is not a final one.

In the application, the title bar on the national screen changes from `● živě` to
`■ konečné · obnova ručně`, and no `ZASTARALÉ` badge appears however long it is left.

## 3. Manual refresh still works

With the national screen showing `konečné · obnova ručně`:

1. Press `r`. The replay terminal shows exactly one request for `vysledky.xml`, answered
   with a `304`.
2. Press `r` again within 60 seconds. No request appears.
3. Wait 60 seconds and press `r`. One request appears.
4. Leave it for several minutes. No further automatic request appears.

## 4. Restart keeps it quiet

Quit with `q`, and start again **without** `--reset`:

```powershell
bun run dev -- --base-url http://localhost:8787
```

The replay terminal shows no request for `vysledky.xml`, `CZ0100` or `CZ0642`. Only the
`404` districts appear (SC-003).

Start once more **with** `--reset`. Every source is requested again, once, and each goes
quiet as it is found final (FR-007).

## 5. A finished election at full scale (optional)

Against a local mirror of 2022, where every figure is final:

```powershell
bun run mirror -- --districts 5
dist\volby-kv2026.exe --base-url file://C:/path/to/mirror --election kv2022 --date 20220923
```

Once the national file has been read, the title bar on the national screen says
`konečné · obnova ručně`, and so does each mirrored district's screen once that district
has been read. The application does not log individual reads, so count requests with the
replay harness (section 2), not with the mirror.

## 6. Upgrading an existing database

Start the new build against a data directory created by the previous release. It opens
without asking for the database to be deleted, and the watchlist, theme and panel state
are still there.
