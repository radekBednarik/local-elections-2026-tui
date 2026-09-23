# Bug Fix: Selection gutter is counted twice or not at all, so rows jitter and right-hand columns are cut off

- **Slug**: rendering-bugs
- **Fixed**: 2026-09-23
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

The selection gutter is now taken off in one place, `viewWidthFor()`. Both the key handler and the draw compose screens at that width, and `styledRow` no longer takes the gutter off a second time. Styled rows also drop their trailing padding, as the plain text always did, so invisible padding can no longer trigger the ellipsis.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `src/ui/chrome/state.ts` | modified | New exported `viewWidthFor(contentWidth)`. `frameState` uses it instead of its inline `Math.max(20, contentWidth - GUTTER)`. |
| `src/ui/app.ts` | modified | `currentContent()` composes at `viewWidthFor(this.contentWidth())`. A movement key therefore hands `draw()` the same layout a refresh would build. |
| `src/ui/theme/apply.ts` | modified | `styledRow` clamps the body to `width`, the body's own width, and no longer to `width - lead.length`. The JSDoc now says which width it means. |
| `src/ui/row.ts` | modified | `toChunks` trims trailing blanks across chunks (new private `trimTrailing`), matching `toText`/`dataRow`. |
| `tests/ui/right-edge.test.ts` | added test | Checks styled output against plain output, with no stray ellipsis and whole Mandáty/Stav columns, across 3 screens at 4 widths. It also checks that the width the key handler composes at matches the refresh's. |
| `tests/ui/redraw.test.ts` | updated test | The harness can now draw with a screen composed beforehand, as `App.onKey` does. Two new tests cover that path. |

## Diff Highlights

```ts
// src/ui/chrome/state.ts
export function viewWidthFor(contentWidth: number): number {
  return Math.max(20, contentWidth - GUTTER)
}

// src/ui/app.ts - currentContent()
width: viewWidthFor(this.contentWidth()),   // was: this.contentWidth()

// src/ui/theme/apply.ts - styledRow()
const body = clampChunks(toChunks(row, columns), Math.max(0, width))
// was:      clampChunks(toChunks(row, columns), Math.max(0, width - [...lead].length))
```

## Tests Added or Updated

- `tests/ui/right-edge.test.ts` > "a styled row is cut where its plain form is, and nowhere else" > *screen* at *N* columns (12 cases: district list, one district and one council, at content widths 77, 97, 117 and 157). Every styled row, with trailing blanks trimmed, equals its plain line.
- `tests/ui/right-edge.test.ts` > "no styled row ends in an ellipsis its plain form does not have"
- `tests/ui/right-edge.test.ts` > "a styled row never runs past the content area"
- `tests/ui/right-edge.test.ts` > "the council table's Mandáty header, even with the bars shown". This is item 3 of the report.
- `tests/ui/right-edge.test.ts` > "the council table's seat counts end in a digit, not an ellipsis". This is also item 3.
- `tests/ui/right-edge.test.ts` > "the district screen has nothing after Stav". This is item 2.
- `tests/ui/right-edge.test.ts` > "a screen composed for a keystroke is laid out as a refresh lays it out". This is the jitter in item 1.
- `tests/ui/redraw.test.ts` > "a movement key, drawn with the screen it composed, touches two rows". This is the sluggishness in item 1.
- `tests/ui/redraw.test.ts` > "the refresh after a keystroke touches nothing". This is the snap-back in item 1.

## Local Verification

- `bun test` → 686 pass, 0 fail (48 files).
- `bunx biome check .` → no errors (checked 129 files).
- `bunx tsc --noEmit` → exit 0.
- **Mutation check.** I temporarily put the old `width - [...lead].length` clamp back in `apply.ts`. `tests/ui/right-edge.test.ts` then went to 15 fail and 3 pass, so the new tests catch the original fault. I then restored the fix, and `bun test tests/ui` went back to 184 pass, 0 fail.
- **Manual checks.** None. I have not run the TUI in a real terminal. The rendered strings were verified only through `frameState().styleRow()` and the OpenTUI test renderer.

## Deviations from Assessment

- **Optional step 3 (trimming trailing padding in `toChunks`) was needed, not optional.** At an 80-column terminal (content width 77, view width 75), the council-list name column hits its `Math.max(24, width - 52)` floor. The table is then 76 wide, 1 more than the view. Plain text trims the trailing padding of Stav, so it fits. The styled form kept the padding, so it still got `…`. That is the item 2 symptom again, and fixing the gutter alone does not cure it. After the trim, a row is ellipsised only when its visible text overflows, exactly as in the plain form.
- **Limitation of the keystroke tests.** The redraw and right-edge tests follow the key handler's path by calling `composeScreen` at `viewWidthFor(contentWidth)`, the same call `App.currentContent()` now makes. They do not drive `App.onKey` itself, because `App` needs a live renderer. If `App` stopped using `viewWidthFor`, these tests would not notice.

## Follow-ups

- Rebuild the Windows binary (`bun run build:win`) and run `--self-test`, as earlier fixes did.
- `tools/verify/keylatency.ts` composes at a hard-coded width of 105, not at `viewWidthFor(...)`. It still measures cost correctly, but it no longer mirrors `App.onKey` exactly. It is worth aligning.
- The ~26 ms main-thread ingest per district document (noted in 8b518ff) can still cause stutter while results are first arriving. If "sluggish" is reported again after this fix, look there next.
- Check visually at 80 columns that full-width rows sit right next to the scroll bar without touching it.
