# Bug Verification: Live 2026 district and council documents rejected over JE_SPOCTENO="1"

- **Slug**: district-schema-rejected
- **Tested**: 2026-10-11
- **Assessment**: ./assessment.md
- **Fix**: ./fix.md
- **Result**: verified

## Summary

The bug no longer reproduces. Six newly downloaded live 2026 district files, including CZ0208 from the original report, all pass validation and are ingested through the app's real `ingestDistrict`, storing 355 council snapshots. The live data now includes a `JE_SPOCTENO="0"`, which the assessment could not observe; it is parsed correctly and the council is correctly stored as not final. There are no regressions: the full suite, typecheck and lint all pass.

## Checks Performed

| Check | Command / Action | Result | Notes |
|-------|------------------|--------|-------|
| Reproduction (post-fix) | New download of `okresy/vysledky_obce_okres_{CZ0208,CZ0100,CZ0642,CZ0323,CZ0806,CZ0532}.xml` from volby.gov.cz, then `ingestDistrict(db, nuts, body)` on an in-memory DB (scratchpad script) | pass | 6/6 `ok=true`; 355 council snapshots stored |
| Live `"0"` value | Same run; CZ0100 contains `JE_SPOCTENO="0"` for Praha hl.m. (554782) | pass | Stored `is_final = 0`, even though 1120/1120 polling districts are counted, as `determineStatus` intends (both signals must agree) |
| Live `"1"` value | Same run; for example 537021 Běrunice (5/5) and 582786 Brno (353/353) | pass | Stored `is_final = 1` |
| Pre-fix failure | Recorded during `/speckit-bug-fix`: the same CZ0208 and 537021 files gave `schema-mismatch` before the change | pass (historical) | Not re-run in this session; it would need the source reverted, which this command must not do |
| New / updated tests | `bun test tests/contract/results.test.ts tests/integration/ingest.test.ts` | pass | 52 pass, 0 fail |
| Regression suite | `bun test` | pass | 1183 pass, 0 fail, 55 files |
| Type-check | `bun run typecheck` | pass | `tsc --noEmit` exit 0 |
| Lint / format | `bun run check` | pass | Biome: 142 files, no fixes |
| Replay tool rewrite | Automated test | not-run | `atProgress` isn't exported and the tool has no tests; the hand check during the fix is the only evidence |
| TUI end to end | Launching the app against the live site | not-run | Ingest was exercised directly; the screens were not launched |

## Output Excerpts

```text
CZ0208 2026-10-10T22:23:00 {"1":86} ok=true
CZ0100 2026-10-11T07:02:00 {"0":1,"1":57} ok=true
CZ0642 2026-10-11T04:47:00 {"1":30} ok=true
CZ0323 2026-10-11T01:06:00 {"1":25} ok=true
CZ0806 2026-10-11T02:05:01 {"1":36} ok=true
CZ0532 2026-10-10T23:41:01 {"1":120} ok=true
snapshot rows: 355
554782 districts 1120/1120 is_final 0
537021 districts 5/5       is_final 1
582786 districts 353/353   is_final 1
```

```text
bun test:            1183 pass  0 fail  (Ran 1183 tests across 55 files. [105.93s])
bun run typecheck:   $ tsc --noEmit   (exit 0)
bun run check:       Checked 142 files in 36ms. No fixes applied.
```

## Residual Risks

- Only 6 of roughly 77 districts were downloaded live. The rest are expected to look the same (same publisher, same schema), but they were not checked.
- The per-council file (`zastup/vysledky_obec_*.xml`) was checked live during the fix (537021), not again here. It shares `obecSchema`, and the contract tests cover it.
- Prague is shown as provisional although every polling district is counted, because the publisher's own flag is still `"0"`. This is the intended behaviour, not a defect, but users may ask about it.
- The replay tool's handling of both spellings has no automated test.
- The fix only reaches users once it is released; the installed 0.3.0 binary still rejects every district.

## Recommendation

Close the bug: verified end to end against live 2026 data, including both flag values, with no regressions. Release a patch (0.3.1) now, while the count is still being published.
