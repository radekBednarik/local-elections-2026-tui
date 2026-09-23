# Bug Verification: Selection gutter is counted twice or not at all, so rows jitter and right-hand columns are cut off

- **Slug**: rendering-bugs
- **Tested**: 2026-09-23
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: partial

## Summary

A scripted reproduction drove the **real `App`**: `App.start`, `App.onKey` via mocked key presses, the refresh draw, `Frame`, theme styling and native text buffers. It ran against OpenTUI's headless test renderer. On the pre-fix commit it reproduces all three reported symptoms. On the fixed working tree none of them occur. The full suite, lint and typecheck all pass, and I found no regressions.

The result is **partial**, not verified, for two reasons:

- **No real terminal.** The assessment's reproduction is manual, in a real terminal, with live polling. I did not do that. The headless renderer covers the same code path but not a physical terminal.
- **Load-time sluggishness untested.** I verified the keystroke-cost part of "sluggish" (80 rows rewritten becomes 2). I did not verify the subjective feel under real network ingest while results are first arriving.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction, pre-fix (control) | `bun test ./.specify/bugs/rendering-bugs/repro/app-repro.test.ts` in a temporary worktree at `4b3ea44` | fail (0/9, as expected) | All three symptoms reproduced at 100, 120 and 160 columns. The worktree was removed afterwards. |
| Reproduction, post-fix | `bun test ./.specify/bugs/rendering-bugs/repro/app-repro.test.ts` on the working tree | pass (9/9) | Same script, same widths. |
| Reproduction in a real terminal | manual steps from assessment.md | not-run | Needs an interactive terminal session, which this harness can't drive. |
| New / updated tests | `bun test tests/ui/right-edge.test.ts tests/ui/redraw.test.ts` | pass | Included in the full-suite run below. |
| Regression suite | `bun test` | pass | 686 pass, 0 fail, 48 files. The repro file is under `.specify/`, which `bun test` does not discover, so the count is unchanged and its `mock.module` cannot leak into the suite. |
| Lint | `bunx biome check .` | pass | 129 files, no errors. |
| Type-check | `bunx tsc --noEmit` | pass | Exit 0. |

## Output Excerpts

The reproduction, pre-fix (`4b3ea44`), at 120 columns. The final `|` is the body border, and the scroll bar column is removed.

```text
[120] NUTS col: ... rows touched: key=80 refresh=0; NUTS per draw: [63,61,61]
[120] district header: |  Zastupitelstvo   ...   Okrsky       Účast   Mandáty Stav       …   |
[120] council header:  |    Č. Volební strana   ...   Hlasy       Podíl               Mand…   |
 0 pass
 9 fail
```

- **Item 1.** The Down key's own draw puts NUTS at column 63. The very next draw puts it back at 61: the reported "moves right for a short time". The keystroke rewrote 80 rows.
- **Item 2.** A `…` column after Stav.
- **Item 3.** `Mand…` against the border.

Post-fix, same script:

```text
[120] NUTS col: before=62 afterKey=62 afterRefresh=62; rows touched: key=2 refresh=0; NUTS per draw: [61,61,61]
[120] district header: |  Zastupitelstvo   ...   Okrsky       Účast   Mandáty Stav           |
[120] council header:  |    Č. Volební strana   ...   Hlasy       Podíl               Mandáty |
[120] council row 1:   |▶    4 KDU-ČSL   ...   ·32 584     36,56 % ███▋               ·9 |
 9 pass
 0 fail
```

The 100- and 160-column results match. At 100 columns there are no bars, and NUTS stays at 41 for every draw. At 160 it stays at 101.

Full suite:

```text
 686 pass
 0 fail
Ran 686 tests across 48 files. [107.46s]
```

## Residual Risks

- **No real terminal.** The headless test renderer runs the production render path, but it is not Windows Terminal or conhost. Glyph widths could differ in a real terminal: `▶`, the bar blocks, and the NBSP digit grouping shown as `·` above. Rows now fill right up to the scroll bar column, so an unexpected double-width glyph would push the last cell under the bar.
- **Sluggishness only partly covered.** A keystroke now costs 2 row rewrites instead of 80, and a refresh after it costs 0. The ~26 ms main-thread ingest per district document (noted in 8b518ff) was not exercised: the repro points at an address that refuses at once, so nothing is ingested. Held keys may still stutter while the count is arriving.
- **Keystroke unit tests stop short of `App`.** The regression tests added in the fix (`redraw.test.ts`, `right-edge.test.ts`) mirror `App.currentContent()` rather than calling it. The end-to-end repro here does exercise `App`, but it lives in `.specify/` and is not part of `bun test`.
- **Screen for item 3.** It is still an assumption that item 3 was the council screen (see assessment Open Questions). Both candidate screens were verified, so this does not change the result.

## Recommendation

Hold, pending a two-minute manual check. Rebuild (`bun run build:win`), run against a mirror or the replay server at about 120 columns, and check:

1. Holding Down on Okresy leaves NUTS and Zastupitelstva still.
2. The Okres table ends at Stav.
3. A council table ends with a whole `Mandáty` column.

If all three hold, close the bug as verified. If any of the three symptoms reappears, reopen with `/speckit-bug-assess`, noting the terminal and width. If only the stutter during the initial load remains, open a separate bug for the main-thread ingest cost rather than reopening this one.
