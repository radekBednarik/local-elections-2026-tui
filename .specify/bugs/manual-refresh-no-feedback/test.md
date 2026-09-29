# Bug Verification: Manual refresh [r] gives no feedback

- **Slug**: manual-refresh-no-feedback
- **Tested**: 2026-09-29
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

The reported scenario was reproduced through the real fetch, ingest, scheduler and logging modules against the local kv2022 mirror over `file://`. With the fix, every press of `r` now produces a notice and a log entry, including the final-data case that used to show nothing but the clock. The full suite, typecheck and lint pass with no regressions. The keypress could not be driven from the assistant's session, because `App.start()` always creates a real terminal renderer, so the result was first recorded as `partial`. The user then ran the app against the mirror, pressed `r`, and confirmed that it works, which raises the result to `verified`.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix, pipeline) | `bun run <scratchpad>/repro-refresh.ts` | pass | Real `fetchDocument` over `file://…/mirror` (kv2022, national + `district:CZ0100`), `Scheduler`, `recordFetch`, `ManualRefresh`, logger, fixed clock. Replays the steps of `App.refreshNow()` and `App.tick()` |
| Reproduction (post-fix, real TUI keypress) | `bun run dev -- --base-url file://… --election kv2022 --date 20220923`, then press `r` | pass | Run by the user on 2026-09-29 against the kv2022 mirror. Confirmed working |
| New / updated tests | `bun test tests/unit/refresh-feedback.test.ts tests/integration/resilience.test.ts tests/integration/scheduler.test.ts` | pass | 78 pass, 0 fail |
| Regression suite | `bun test` | pass | 1039 pass, 0 fail across 54 files |
| Type-check | `bun run typecheck` | pass | `tsc --noEmit` clean |
| Lint / format | `bun run check` | pass | Biome, 139 files, no issues |

## Output Excerpts

Pipeline reproduction against the mirror:

```text
1. Initial automatic load at T0+60s (both due by then)
  fetched national: outcome=ok result=changed
  fetched district:CZ0100: outcome=ok result=changed
  final: district:CZ0100=true, national=true
  log: []
2. Press r at T0+90s (within the 60 s floor)
  notice: Obnovení bude možné za 30 s.
  log: [ info Ruční obnovení odloženo {"waitSeconds":30} ]
3. Press r at T0+130s (floor elapsed, data final and identical)
  notice while fetching: Obnovuji…
  fetched national: outcome=ok result=unchanged
  fetched district:CZ0100: outcome=ok result=unchanged
  notice: Obnoveno: beze změny.
  title-bar clock: 2026-09-29T10:01:00.000Z -> 2026-09-29T10:02:10.000Z
  log: [ ..., info Ruční obnovení {"result":"unchanged","sources":{"district:CZ0100":"unchanged","national":"unchanged"}} ]
4. Automatic tick at T0+400s: final sources are not due, nothing logged
  log count: 2
```

This confirms the assessment's root cause for the reported case. Over `file://` the mirror returns an identical `200` (`outcome=ok`), which ingests as `unchanged`. Before the fix that path was silent apart from the clock moving (step 3). Automatic success still logs nothing (steps 1 and 4).

Test runs:

```text
Ran 78 tests across 3 files.   78 pass, 0 fail
Ran 1039 tests across 54 files. 1039 pass, 0 fail
```

## Residual Risks

- **The real keypress was checked only by hand.** The harness copies the logic of `refreshNow()` and `tick()` rather than calling them. The user's manual run in the TUI confirmed the wiring, but no automated test covers `App` itself.
- **Concurrent ticks** (the one-second `setInterval` loop) were not exercised. `ManualRefresh.settle` is designed to accept a result from any tick, and a unit test covers settling in any order, but no real concurrent ticks were run.
- **Log detail display.** Entry details are stored serialised. How the logs view renders the `sources` map of a `Ruční obnovení` entry was not checked on screen.
- The `partial` and `changed` outcomes were covered only by unit tests, not against the mirror. The mirror is final and unchanging, so it cannot produce them.

## Recommendation

Close the bug: verified end to end. The pipeline reproduction, the tests and the user's manual run in the TUI (`bun run dev -- --base-url file://…/mirror --election kv2022 --date 20220923`, then `r`) all agree.
