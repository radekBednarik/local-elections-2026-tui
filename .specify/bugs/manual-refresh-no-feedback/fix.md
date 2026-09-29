# Bug Fix: Manual refresh [r] gives no feedback

- **Slug**: manual-refresh-no-feedback
- **Fixed**: 2026-09-29
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

Every press of `r` now ends in one status-row notice and one `info` log entry. The notice says whether the refresh was refused by the 60-second floor (and how long to wait), found new data, found no change, failed, or partly failed. Automatic polling stays silent on success, as before.

Answers to the assessment's open questions (from the user): a no-change refresh does get a log entry, and the mirror was served over `file://`, so the reproduced case is an identical `200` that ingests as `unchanged`.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `src/ui/refresh.ts` | added | `FetchResult`, `summariseRefresh`, notice texts, and `ManualRefresh`, which tracks the requested sources and logs and reports once all are in |
| `src/ui/app.ts` | modified | `recordFetch` returns a `FetchResult`. `refreshNow` reports refused or started refreshes. `tick` passes each fetch result, including thrown fetches, to `settleRefresh` |
| `src/sources/scheduler.ts` | modified | added `secondsUntilRefresh`, and `canRefreshNow` now uses it. `requestRefresh` refuses a key with no subscription instead of reporting success for an update that touched no row |
| `tests/unit/refresh-feedback.test.ts` | added test | summary rules, notice texts and widths, `ManualRefresh` logging exactly once |
| `tests/integration/resilience.test.ts` | added tests | `recordFetch` return values, and automatic success logs nothing |
| `tests/integration/scheduler.test.ts` | added tests | `secondsUntilRefresh`, refusal for an unsubscribed key |

## Diff Highlights

```ts
// src/ui/app.ts, refreshNow()
const accepted = keys.filter((key) => scheduler.requestRefresh(key, now))
if (accepted.length === 0) {
  const waits = keys.map((key) => scheduler.secondsUntilRefresh(key, now)).filter((s) => s > 0)
  this.notice = this.manualRefresh.refused(waits.length === 0 ? 0 : Math.min(...waits))
  this.draw()
  return
}
this.notice = this.manualRefresh.start(accepted)
this.draw()
await this.tick()
```

```ts
// src/ui/app.ts, tick()
this.settleRefresh(sub.sourceKey, recordFetch(db, scheduler, sub.sourceKey, outcome, log))
```

Notices: `Obnovuji…`, `Obnovení bude možné za N s.`, `Obnoveno: nová data.`, `Obnoveno: beze změny.`, `Obnoveno jen zčásti, některé zdroje selhaly. · l záznamy`, `Obnovení selhalo. · l záznamy`. Log entries: `info Ruční obnovení { result, sources }` and `info Ruční obnovení odloženo { waitSeconds }`.

## Tests Added or Updated

- `tests/unit/refresh-feedback.test.ts` – "reports once, after every requested source is in, with one log entry": a multi-source refresh logs exactly one entry, and later polls of the same sources log nothing.
- `tests/unit/refresh-feedback.test.ts` – "a fetch of a source the refresh did not ask for is ignored", "with no refresh started, fetches say nothing", "a refused refresh is logged and says how long to wait".
- `tests/unit/refresh-feedback.test.ts` – summary rules (304 and identical figures read as unchanged, a failure wins, partial) and "every notice fits the 80-column minimum".
- `tests/integration/resilience.test.ts` – "returns what the fetch did, for the manual refresh summary": `changed`, then `unchanged` for the same final document (the reported mirror case), then `not-modified`, and `failed` for rejected, not-found and transport errors.
- `tests/integration/resilience.test.ts` – "automatic polling logs nothing on success, changed or not": guards against log flooding (004 R5).
- `tests/integration/scheduler.test.ts` – "says how many seconds remain until the floor allows it", "is refused for a source nothing is subscribed to".

## Local Verification

- Commands run: `bun test` → 1039 pass, 0 fail across 54 files.
- `bun run typecheck` → clean.
- `bun run check` (Biome) → clean after applying the formatter to one test line.
- Manual checks: none. The TUI was not driven against the `file://` mirror in this session. That is left to `/speckit-bug-test`.

## Deviations from Assessment

- **New file `src/ui/refresh.ts`.** The assessment listed only `app.ts` and `scheduler.ts`. `App` needs a real renderer and has no tests, so the refresh bookkeeping (`ManualRefresh`) and the pure summary and notice functions were moved into their own module. That was the only way to test the assessment's "a manual refresh writes exactly one `info` log entry" requirement.
- **Concurrent ticks handled by settling, not by re-reading subscription state.** The assessment suggested deriving outcomes from subscription state after the tick. Instead, every tick passes each fetch result to `ManualRefresh.settle`, and the summary is issued when the last requested source arrives, whichever tick fetched it. This also resolves the `due(..., 3)` crowding risk: a requested source fetched by a later loop tick still completes the summary, and until then the row shows `Obnovuji…`.
- **`requestRefresh` refuses an unsubscribed key.** Not in the assessment. Without this, an unsubscribed key would be "accepted" and would never settle, leaving the refresh pending forever.

## Follow-ups

- Update the spec 003 edge case "A manual refresh of a final source fails", which says a failed refresh looks the same on screen as an unchanged one. It is now reported once in the status row, still without a stale warning.
- A requested council that gets unsubscribed (the user navigates away) before its fetch never settles. The next refresh replaces the pending one and the notice clears on the next key, so the effect is only a missing summary log entry. Acceptable, but worth knowing.
- Consider mentioning the refresh notices in the README key help.
