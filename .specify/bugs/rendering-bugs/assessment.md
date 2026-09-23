# Bug Assessment: Selection gutter is counted twice or not at all, so rows jitter and right-hand columns are cut off

- **Slug**: rendering-bugs
- **Created**: 2026-09-23
- **Source**: pasted text
- **Verdict**: valid
- **Severity**: high

## Report (verbatim or summarized)

> there are several formatting/rendering bugs. Description of these bugs:
>
> 1. navigation via up/down keys on Okresy list is still sluggish. Also, after each key press the rendered screen jitters. The columns NUTS and Zastupitelstva will move to the right a bit for a short time, before moving back to previous position.
> 2. in Zastupitelstva list, in the right part of the rendered screen, there are columns Okrsky, Ucast, Mandaty and Stav. Right next to Stav there is a probably another column, but I can see only three dots (...) in the header and also in the cells of that column, there are also just ... .
> 3. In the zastupitelstvo obce screen - will render after selecting an Okres, the Mandaty column is hugging the right border of the screen and is partially cut off from the right side. User can see just Mand... . Values for this column in cells only contain ... (three dots).

Screen mapping used below (from `src/ui/screen.ts`):

| Report item | Screen kind | Builder |
|---|---|---|
| 1 "Okresy list" | `districts` | `buildDistrictListRows` |
| 2 "Zastupitelstva list" (Okrsky, Účast, Mandáty, Stav) | `district` | `buildDistrictRows` |
| 3 "zastupitelstvo obce" (Mandáty is the last column) | `council` | `buildCouncilRows` |

Item 3 says the screen appears "after selecting an Okres". The only table whose *last* column is Mandáty is the council table, which opens after selecting a council inside an Okres. The Okres screen's Mandáty column sits before Stav. So this assessment reads item 3 as the council screen. See Open Questions.

## Symptom

1. On the district list, each Up/Down press shifts the NUTS and Zastupitelstva columns two cells to the right. They snap back on the next background redraw. Each shift rewrites every row, so the "two rows per keystroke" optimisation from 8b518ff does not apply while the refresh loop is running. Expected: only the selection marker moves, and the columns stay put.
2. On one district's council table, a column of `…` appears to the right of Stav, in the header, the underline and every data row. Expected: Stav is the last thing on the row, and nothing is truncated.
3. On a council's party table (at widths where the bar column is shown), the header shows `Mand…` against the right border, and every seat count shows only `…`. Expected: the full `Mandáty` header and the seat numbers.

## Reproduction

1. Run the application at a normal width (for example 120 columns) with reference data loaded, so the refresh loop is polling the district sources.
2. Open **Okresy** and press Down a few times. The NUTS and Zastupitelstva columns jump right by two cells. Within about a second (the next `tick()` that finds a due source) they jump back.
3. Press Enter on any district. The council table shows a trailing `…` column after Stav, on the header, the underline and the data rows.
4. Press Enter on a council that has results. With the bar column visible (wide enough for `barsFit`), the last column reads `Mand…`, and the values read `…`.

Worked numbers for a 120-column terminal with the side panel closed: `rawContentWidth` = 120 − 2 border − 1 scrollbar = **117**, and `viewWidth` = 117 − 2 gutter = **115**. The styled clamp is 115 − 2 lead = **113**.

## Suspected Code Paths

- `src/ui/theme/apply.ts:49-61` `styledRow()`: clamps the body to `width - lead.length`. The caller passes `viewWidth`, which already has the gutter taken off, so the gutter is subtracted **twice**. Tables are laid out to `viewWidth` but may only draw `viewWidth - 2`.
- `src/ui/chrome/state.ts:120-160` `frameState()`: computes `viewWidth = contentWidth - GUTTER` and composes at that width. Then it calls `styledRow(..., viewWidth, lead(...))`, which is where the double subtraction happens.
- `src/ui/app.ts:604-617` `currentContent()` / `contentWidth()`: composes the screen at `contentWidth()` **without** taking off the gutter. `onKey` (`src/ui/app.ts:278-291`) passes this content through to `draw(content)` on `move` and `jump`. Any other draw (for example `tick()` at `src/ui/app.ts:625-684`, which runs every 1 s via `setInterval` at `src/ui/app.ts:184`) lets `frameState` compose at `viewWidth`. Two layouts that are 2 columns apart therefore alternate.
- `src/ui/row.ts:142-171` `clampChunks()`: keeps `width - 1` characters and appends `…`. This is the `…` the user sees. Unlike `dataRow`, `toChunks` pads the last cell to its full width and does not `trimEnd`. So even trailing padding gets cut, and a padded Stav cell turns into "text, spaces, `…`".
- `src/ui/views/areas.ts:207-213` `buildDistrictRows()` columns: `(width-52)+14+11+9+14` plus 4 gaps = exactly `width`. That fills `viewWidth` completely, so it overflows the double-reduced clamp by 2.
- `src/ui/views/areas.ts:299-309` `buildCouncilRows()` columns with bars: `4+(width-41-B-1)+12+11+B+10` plus 5 gaps = exactly `width`. It overflows the same way. The last column is right-aligned Mandáty (10 wide), so `   Mandáty` becomes `   Mand…` and `        12` becomes `       …`.
- `src/ui/views/areas.ts:152-156` `buildDistrictListRows()` columns: `(width-34)+8+20` plus 2 gaps = `width - 4`. This fits in both layouts, which is why item 1 shows movement but no `…`. The Okres column is `width - 34`, so composing 2 columns wider pushes NUTS and Zastupitelstva right by 2.
- `src/ui/chrome/frame.ts:204-232` `setRows()`: the per-row key is the plain line. When the Okres column width changes by 2, every row's key changes, so all ~81 rows are rewritten on the keystroke *and again* on the next background draw.
- `tests/ui/redraw.test.ts:57-76`: the harness calls `frameState` without `content`. So it never takes the key-handler path that passes content through, and it never checks the styled rows for a trailing `…`.

## Root Cause Hypothesis

Two code paths disagree about who owns the 2-column selection gutter (`GUTTER` in `src/ui/chrome/state.ts:37`).

(a) `frameState` narrows the view by the gutter, and `styledRow` narrows it again by the lead it writes. So every styled row is clamped 2 columns short of the width its table was laid out for. Any table that uses its full width (the district council table, and the council party table when bars are shown) loses its last 3 characters to `clampChunks`, which puts `…` in their place. That is items 2 and 3.

(b) `App.currentContent()` composes at the full content width, without taking off the gutter. The key handler hands that content to `draw()` for every move and jump. Background draws compose at the gutter-reduced width instead. So the district list flips between two layouts 2 columns apart. The shift is visible (item 1's jitter). Every flip changes every row's text key, which defeats the two-row skip in `Frame.setRows` and brings back the all-row rewrite that 8b518ff removed (item 1's sluggishness).

**Confidence: high** for items 2 and 3 and for the jitter in item 1. The arithmetic above reproduces the exact strings reported (`Mand…`, and a lone `…` after Stav). **Medium** that this fully explains the remaining sluggishness. The ~26 ms main-thread ingest per district document, noted in 8b518ff's commit message, is an independent contributor while the count is arriving.

## Proposed Remediation

**Preferred**: Decide the view width in exactly one place, and make every consumer use that one number.

1. Export a single helper, for example `viewWidthFor(contentWidth)` in `src/ui/chrome/state.ts`, that returns `Math.max(20, contentWidth - GUTTER)`. Use it in `frameState` and in `App.currentContent()`, so the key handler composes at the same width as every other draw. As a result, `draw(content)` and `draw()` produce byte-identical lines when nothing has changed, and the row skip works again.
2. Make `styledRow` clamp the *body* to the width the body was laid out for, not to `width - lead`. The cleanest shape: `frameState` passes `viewWidth` as the body width, and `styledRow` clamps the body to exactly that and writes the lead beside it. This keeps its current contract of "`width` is the body's width". The alternative is for `frameState` to pass `contentWidth` as the total. Pick one and document it in the JSDoc. Right now the doc comment implies that `width` is the total while the caller passes the body width.
3. Optionally, `trimEnd` the final chunk in `toChunks`, matching `dataRow`. Trailing padding can then never be what triggers `…`. This is defence in depth, not the fix.

**Alternatives**:
- Keep `styledRow` as it is and have `frameState` pass `inputs.contentWidth` (the total) instead of `viewWidth`. This is a one-line change, but it leaves two different meanings of "width" living next to each other, which is how this bug arose.
- Stop passing precomposed content from `onKey`, and let `draw()` always compose. This removes the layout flip but gives back the perf saving from 8b518ff. Not recommended.

**Files likely to change**:
- `src/ui/chrome/state.ts`
- `src/ui/app.ts`
- `src/ui/theme/apply.ts`
- `src/ui/row.ts` (only if the optional trim is taken)
- `tests/ui/redraw.test.ts`
- a new or extended test in `tests/ui/` (for example `frame.test.ts` or `areas.test.ts`) for right-edge truncation

**Tests to add or update**:
- **No right-edge ellipsis**: for the `district` and `council` screens (council with bars shown), at a few widths (80, 100, 120, 160), render through `frameState` and `applyFrameState` into a test renderer. Assert that no styled row whose plain text fits `viewWidth` ends in `…`. Also assert that the Mandáty header and a known seat count appear in full.
- **Styled equals plain**: for every row, the styled text (chunks joined, trailing spaces trimmed) equals the plain line from `FrameState.lines`. This locks in the "cut in the same place" promise stated in `state.ts` and `row.ts`.
- **Stable layout across draw paths**: compose via the key-handler path (`currentContent()`, or a `frameState` call given `content` composed the same way) and via the plain `draw()` path. Assert that the `lines` are identical. Then extend `redraw.test.ts`: after a move draw followed by a background draw with no data change, the number of rows touched is 0.
- **Rows touched per keystroke**: in `redraw.test.ts`, drive the move through the same content handoff that `App.onKey` uses, and assert that 2 rows are touched, not 81.

## Risks & Considerations

- Changing the width the key handler composes at also changes `content.rowCount`/`firstRow` only if a view's row count depends on width. None do today, but check the search and national views.
- Existing snapshot or string assertions that were written against the double-reduced clamp may encode the bug. Review failures rather than updating them blindly, as happened with the "78 districts" tests in 407a7ff.
- The district council table and the council party table use exactly the full `viewWidth`. After the fix, a row fills the viewport right up to the scrollbar column. `rawContentWidth` already reserves that column, so check visually once at 80 columns.
- The side panel path (`PANEL_COST`) takes columns away from `contentWidth` before the gutter. Confirm that the single helper is applied after the panel deduction, in both places.
- The 26 ms per-document ingest on the main thread can still make held keys stutter during the initial load. That is out of scope here, but the verification should state it so that "still sluggish" is not reported again for a different cause.

## Open Questions

- [NEEDS CLARIFICATION: Item 3 says the screen appears "after selecting an Okres", but the only table whose last column is Mandáty is the council screen, which opens after selecting a council inside an Okres. This assessment assumes the council screen. If the user did mean the Okres screen itself, items 2 and 3 are the same symptom seen from two angles, and the same fix covers both.]
- [NEEDS CLARIFICATION: The terminal width the user was running at. The truncation happens at every width where the bars fit, and on the district screen at every width. The worked numbers assume 120 columns.]
- [NEEDS CLARIFICATION: Whether the sluggishness remains after the jitter is fixed, once the refresh loop has finished its initial load. If it does, the ingest cost is the next suspect.]
