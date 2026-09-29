# Bug Assessment: Manual refresh [r] gives no feedback

- **Slug**: manual-refresh-no-feedback
- **Created**: 2026-09-29
- **Source**: pasted text
- **Verdict**: valid
- **Severity**: medium

## Report (verbatim or summarized)

> The user should be able to trigger manual data retrieval by pressing [r]. But there is no indication that this actually happend. There is no informain in logs [l] and also no indication in the header information bar, expcept the time is updated. I have tested the [r] against downloaded mirrored data from previous election, which are ofc final at this time.

## Symptom

Pressing `r` triggers a fetch, but the only visible change is the last-success clock in the title bar. No notice appears in the status row and nothing is written to the logs view (`l`), so the user cannot tell whether the refresh ran, found nothing new, was blocked by the 60-second floor, or failed.

Expected: a short confirmation of what the refresh did (started, unchanged, new data, too soon, failed), and a log entry recording the manual refresh and its result.

## Reproduction

1. Run the app against a mirror of a finished election (for example `--base-url file://...` or a local HTTP mirror), so every source is final.
2. Wait for the initial load. The title bar shows the final indicator and a clock.
3. Press `r`.
4. Observe: the clock may move, nothing else changes. Open the logs view with `l`: no entry for the refresh.
5. Press `r` again within 60 seconds. Observe: nothing changes at all, not even the clock, because the floor silently rejects the request.

The same silence applies to live data, not only to final mirrors. [NEEDS CLARIFICATION: the report was tested only against final mirrored data; live behaviour is inferred from the code.]

## Suspected Code Paths

- `src/ui/app.ts:627` `refreshNow()` – discards the `boolean` returned by `scheduler.requestRefresh()`, sets no `notice`, writes no log entry, and then awaits `tick()`. There is no feedback point anywhere in this method.
- `src/sources/scheduler.ts:227` `requestRefresh()` – returns `false` when the 60 s floor (`canRefreshNow`, line 219) blocks the request. The caller ignores it, so a blocked refresh is indistinguishable from a successful one.
- `src/ui/app.ts:841` `recordFetch()` – logs only failures: rejected documents (`warn`), not-published (`info`, once per reason) and transport errors (`warn`). A `200` that ingests and a `304` not-modified log nothing. This is deliberate for automatic polling (avoiding log floods, 004 research R5), but it means a manual refresh that succeeds leaves no trace.
- `src/ui/app.ts:704` `tick()` – returns `void`, so `refreshNow()` has no way to learn what the fetches did even if it wanted to report it.
- `src/storage/snapshots.ts:134` `writeSnapshot()` – for identical figures (the final-mirror case) it only updates `fetched_at` and returns `unchanged`. `recordSuccess` still bumps `last_success_at`, which is why the title-bar clock is the one thing that moves (`src/ui/chrome/state.ts:276` `titleBarRow`, fed by `latestSuccess` at `src/ui/app.ts:802`).
- `src/ui/app.ts:281` `onKey()` – clears `notice` at the start of every keystroke. Any notice set by the fix must be set after the `await this.tick()` so it survives until the next key, which the existing export flow (`exportCurrent`, line 651) already does.

## Root Cause Hypothesis

The manual refresh action was implemented as "move the due time to now and run a tick", reusing the automatic polling path end to end. That path is intentionally quiet on success, and the refresh action never adds a feedback layer of its own: it ignores whether the floor allowed the request, and `tick()` does not report outcomes back. With final mirrored data, every refresh ends as an unchanged `200` or a `304`, both silent, so the only side effect is the clock. Spec 003 (edge case "A manual refresh of a final source fails") explicitly accepted that a *failed* refresh of final data looks the same on screen as an unchanged one, but no spec requires the refresh to be silent in the success or floor-blocked cases either. FR-019 (001) only requires that the refresh exists. Confidence: high.

## Proposed Remediation

**Preferred**: Give `refreshNow()` its own feedback, using the existing `notice` mechanism and the logger.

1. Collect the results of `requestRefresh()` for every key. If none were accepted, set a notice such as `Obnovení je možné nejdříve za N s` (remaining seconds computed from `lastAttemptAt` and `MIN_INTERVAL_SECONDS`; a small `secondsUntilRefresh(key)` helper on `Scheduler` keeps that logic next to `canRefreshNow`), log it at `info`, draw, and return.
2. Otherwise set a notice `Obnovuji…` and draw before awaiting the fetch, so slow networks still show that something is happening.
3. After the fetch, summarise the outcome of the accepted sources in a notice and one `info` log entry, for example `Obnoveno: beze změny`, `Obnoveno: nová data`, or `Obnovení selhalo · l záznamy`. Derive the outcome from the subscription state after the tick (`lastAttemptAt` at or after the request time, `lastError`, `consecutiveFailures`) plus whether a new snapshot was written, rather than from `tick()`'s own loop. The automatic loop (`setInterval` at `src/ui/app.ts:211`) can run a concurrent `tick()` that picks up the due rows first, so the refresh's own tick may fetch nothing even though the refresh happened.
4. To tell "new data" from "unchanged", have `recordFetch()` return a small outcome value (`"changed" | "unchanged" | "not-modified" | "failed"`) derived from the ingest result, or have the refresh compare the current snapshot id before and after. Returning a value from `recordFetch()` is the cleaner option and keeps automatic polling behaviour unchanged.

Keep automatic polling silent on success, as today. Only the manual path logs a success, so the logs view gains at most one entry per `r` press.

**Alternatives**:
- Log every successful fetch at `debug` and show only a static "Obnovuji…" notice. Simpler, but `debug` is below the default `info` level so the logs view still shows nothing, and the notice cannot say whether anything changed.
- Add a transient "just refreshed" badge to the title bar indicator. More visible, but the title bar has a fixed layout contract (frame never moves) and an extra badge competes with the live/final/stale indicator for the narrow 80-column width. The status-row notice already exists for exactly this kind of one-shot message.

**Files likely to change**:
- `src/ui/app.ts` (`refreshNow`, possibly `recordFetch` return type)
- `src/sources/scheduler.ts` (optional helper for seconds until the floor allows a refresh)
- `tests/integration/scheduler.test.ts` (helper, if added)
- a test for `recordFetch` outcomes and for the refresh notice text (new or existing file under `tests/`, next to `tests/integration/resilience.test.ts` which already exercises `recordFetch`)

**Tests to add or update**:
- `recordFetch` returns `unchanged` for an identical final document, `changed` for new figures, `not-modified` for a `304`, and `failed` for rejected, not-found and transport failures.
- The refresh feedback builder (ideally a pure function taking the accepted keys and resulting subscriptions) yields the "too soon, N s" text when the floor blocks every key, and the unchanged, new-data and failed texts otherwise.
- A manual refresh writes exactly one `info` log entry, and an automatic tick with a successful unchanged fetch still writes none (guards against log flooding, 004 R5).
- The notice text fits the 80-column minimum with the row's leading space.

## Risks & Considerations

- Log volume: logging must stay limited to the manual path. Logging successes inside `recordFetch` for every automatic poll would flood the logs view during a live count.
- Spec 003 accepted that a failed refresh of final data is not shown as stale. A "Obnovení selhalo" notice is a one-shot message cleared by the next key, not a stale warning, so it does not contradict that decision, but the spec edge case text should be updated to say the failure is now reported once in the status row.
- Race with the automatic loop: outcome detection must not assume the refresh's own `tick()` performed the fetch (see step 3).
- `scheduler.due(..., 3)` caps a tick at three sources. A refresh requests at most two (screen source plus national), but other due sources can occupy the slots, leaving a requested source for the next loop tick. The summary should then say "Obnovuji…" rather than claim an outcome for a source not fetched yet, or the refresh should process its own keys directly.
- Notice lifetime: `onKey` clears the notice on the next keystroke, and the final notice must be assigned after the await, as `exportCurrent` does.
- Czech wording of the new texts should match the existing notices.

## Open Questions

- [NEEDS CLARIFICATION: Should a manual refresh that finds no change be logged at `info` (visible in the logs view by default), or is a status-row notice enough, with the log entry only for failures and floor rejections?]
- [NEEDS CLARIFICATION: Was the mirror served over `file://` or a local HTTP server? Over HTTP with ETag support the result is a `304`, over `file://` an identical `200`. Both are silent today and the fix covers both, but the reproduction steps should name the one used.]
