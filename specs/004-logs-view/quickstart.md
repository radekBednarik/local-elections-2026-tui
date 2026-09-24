# Quickstart: validating the logs view and the honest status row

**Feature**: `004-logs-view`

How to prove the feature works end to end. The expected behaviour is in
[contracts/interface.md](contracts/interface.md). The state rules are in
[data-model.md](data-model.md).

## Prerequisites

- Bun 1.4.2 or later, and dependencies installed (`bun install`).
- The replay harness (`tools/replay/server.ts`).
- For the clipboard check, a terminal with OSC 52 support, such as Windows Terminal,
  WezTerm, kitty, or a recent xterm or iTerm2.

## 1. Automated checks

```powershell
bun test
bun run typecheck
bun run check
```

All three must pass. The tests that carry this feature:

| What | Where | Proves |
|---|---|---|
| The logger records every accepted entry in memory, keeps the last 1000, counts `dropped`, and `seq = dropped + index` | `tests/unit/logger.test.ts` | FR-009, FR-015, data-model invariant |
| The recorded `line` equals the text appended to the file | `tests/unit/logger.test.ts` | FR-015 |
| Entries are still recorded after the file becomes unwritable | `tests/unit/logger.test.ts` | Spec edge case |
| Entries below the level threshold are neither written nor recorded | `tests/unit/logger.test.ts` | Assumptions |
| `sourceStatus`: `null` when nothing fails; `awaiting` when only never-loaded sources fail; `stale` when any failing source loaded before; final sources ignored | `tests/unit/status-bar.test.ts` | FR-001–FR-003 |
| Neither status text contains the error string, a source code, or `ZASTARALÁ` (awaiting); both name `l` | `tests/unit/status-bar.test.ts` | FR-004, SC-001, SC-002 |
| The title bar shows `čeká na výsledky` in the awaiting state, and `ZASTARALÉ` only when stale | `tests/ui/frame.test.ts` | FR-001, SC-001 |
| A notice takes the status row over the source status. The row is absent on logs screens | `tests/ui/frame.test.ts` | Research R3 |
| A `404` or a rejected document is logged once per change of reason, not on every poll. Transport failures are still logged every time | `tests/integration/resilience.test.ts` | Research R5 |
| Offline start with cached data reads as stale, not awaiting | `tests/integration/resilience.test.ts` | FR-003, research R1 |
| With several stale sources, the age is the oldest data's age | `tests/unit/status-bar.test.ts` | Research R2 |
| `l`, `c` and `Shift+C` map to `logs`, `copy-entry` and `copy-all` | `tests/unit/keymap.test.ts` | FR-006, FR-016, FR-017 |
| Registry availability: `logs` everywhere except the logs screens; copy actions only there; `open` not on `log-entry` | `tests/ui/palette.test.ts` | FR-007, FR-021 |
| The help screen lists `l`, `c` and `Shift+C` | `tests/ui/help-and-language.test.ts` | FR-007 |
| The logs list: one row per entry, oldest first, Czech severity labels, empty state, `open` target is the entry's `seq` | `tests/integration/screen.test.ts` | FR-009, FR-010, FR-014 |
| The detail screen wraps the full line; an evicted `seq` shows the "not available" line | `tests/integration/screen.test.ts` | FR-011 |
| The copy text for one or all entries; notice wording with Czech plurals, empty and refused cases | `tests/unit/logs-copy.test.ts` | FR-016–FR-018 |
| `performCopy` calls `copy` with the right text, does not call it when there is nothing to copy, and contains a throwing `copy` | `tests/unit/logs-copy.test.ts` | FR-016–FR-019 |
| Logs rows are painted from the active theme and repaint on a switch | `tests/ui/colour.test.ts` | FR-020, SC-005 |
| `openLogs` selects the newest entry, and `Esc` (`pop`) restores the origin screen's selection and offset | `tests/unit/logs-view.test.ts` | FR-008, FR-009 |
| `syncLogSelection` keeps the selection on the same entry through evictions, including while the detail screen is open | `tests/unit/logs-view.test.ts` | FR-012 |
| `app.ts` calls `openLogs`, `syncLogSelection` and `performCopy` rather than reimplementing them | `tests/unit/logs-view.test.ts` (structural) | Principle II |

## 2. Before publication (awaiting)

Point the application at an address where nothing is published yet. The replay server
serves `kv2026` only (`{base}/appdata/{election}/{date}/odata`), so asking for another
election gives `404`s for every result source:

```powershell
bun run replay
bun run dev -- --base-url http://localhost:8787 --election kv2099 --reset
```

This starts as it is. The registries and code lists are not published for `kv2099`
either, but failing to load them is not fatal (`src/main.ts`, FR-011): the app carries
on with numeric codes and logs `VAROVÁNÍ Referenční data se nepodařilo stáhnout`,
which you will see in the logs view. (Checked 2026-09-24, T031.)

Expected:
- The status row reads
  `○ Výsledky zatím nejsou zveřejněny, aplikace je dál kontroluje. · l záznamy`.
- The title bar shows `○ čeká na výsledky`.
- Neither `ZASTARALÁ` nor `ZASTARALÉ` appears anywhere (SC-001).

Now press `l`:
- The logs list opens with the newest entry selected.
- It shows one `INFO … Data zatím nejsou zveřejněna` entry per source, and it does not
  grow on every poll (research R5).
- If the publisher serves documents without results instead of `404`s, the list shows
  one `VAROVÁNÍ … Dokument odmítnut` entry per source and reason, and likewise does not
  grow on every poll.

Press `Esc`: you are back on the national overview, with the selection unchanged.

The same state must appear with no server at all, where the error is a failed
connection instead of a `404`:

```powershell
bun run dev -- --base-url http://localhost:9 --reset
```

## 3. Data that goes stale

```powershell
bun run replay -- --fail-after 60
bun run dev -- --base-url http://localhost:8787 --reset
```

Expected:
- **Before 60 s:** `● živě` and no status row.
- **After 60 s:**
  - The title bar shows `● ZASTARALÉ`.
  - The status row reads `! ZASTARALÁ DATA z doby před … . Obnovení se nedaří. · l záznamy`,
    with no error text in it (FR-003, FR-004).

Now check the logs view:
- `l` shows the `VAROVÁNÍ Stahování selhalo` entries.
- `Enter` on one opens the detail screen with the full line.
- `Esc` goes back to the list, and `Esc` again goes back to the national overview.

## 4. Copying

Open the logs view with entries in it:
- **`c`:** the notice reads `Odesláno do schránky: 1 záznam.` Paste into an editor: the
  text is the selected entry's line exactly as it appears in the log file (SC-004).
- **`Shift+C`:** the notice reads `Odesláno do schránky: N záznamů.` (or `záznamy` for
  2 to 4). The pasted text has one line per entry, oldest first.

Two more cases:
- In a terminal without OSC 52, the notice reads
  `Terminál nepodporuje kopírování do schránky.` The screen is not corrupted and the
  app keeps running (FR-019).
- **Known limit (research R7):** with a very long log, some terminals and multiplexers
  drop an oversized OSC 52 payload silently. Note what happens in your terminal. It is
  not a failure of this feature.

## 5. Theme

With the logs view open:
- Press `Ctrl+T` through every theme, including high contrast. Every region repaints at
  once, and the selected row stays visible.
- Run with `NO_COLOR=1`. Severities are still distinguishable by their labels (FR-020,
  SC-005).

## 6. Responsiveness after a long run

Filling the view past 1000 entries takes hours of real polling. Nothing in the code logs
at `debug`, so `--log-level debug` does not speed it up. Measure the frame instead, with
a logger filled directly:
- Build the logs screen's full frame state from 1000 entries (250 already evicted).
- Style the visible rows.
- Time many repetitions.

It must stay well inside the 100 ms keystroke budget (SC-003, SC-006). Then evict
further entries while an entry is selected, apply `syncLogSelection`, and check that the
same `seq` is still selected (FR-012).

Measured 2026-09-24 (T045), 120 columns wide:
- **Frame time:** median 2.8 ms, p95 4.7 ms, max 5.2 ms.
- **Eviction:** after 37 evictions the selection stayed on the same entry.
