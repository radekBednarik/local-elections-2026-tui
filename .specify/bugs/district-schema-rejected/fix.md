# Bug Fix: Live 2026 district and council documents rejected over JE_SPOCTENO="1"

- **Slug**: district-schema-rejected
- **Fixed**: 2026-10-11
- **Assessment**: ./assessment.md
- **Status**: applied

## Summary

`JE_SPOCTENO` is now parsed as a full XSD `xs:boolean`: `"true"`/`"1"` mean true, `"false"`/`"0"` mean false, and any other value is still rejected. The replay harness's "not yet counted" rewrite now handles both spellings too. With these changes the unmodified live 2026 district and council files validate.

## Changes

| File | Change | Notes |
|------|--------|-------|
| `src/parsing/schemas/common.ts` | modified | `booleanFromString` accepts `"1"`/`"0"` in addition to `"true"`/`"false"`; doc comment explains why |
| `tools/replay/server.ts` | modified | progress rewrite matches `JE_SPOCTENO="(true\|1)"` and writes the matching false spelling |
| `tests/contract/results.test.ts` | added tests | new `JE_SPOCTENO lexical forms` describe block |
| `tests/integration/ingest.test.ts` | added test | finality follows the `1`/`0` flags end to end |
| `fixtures/README.md` | modified | records the 2026 spelling difference |

## Diff Highlights

```ts
// src/parsing/schemas/common.ts
const booleanFromString = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1")
```

```ts
// tools/replay/server.ts
out = out.replace(
  /JE_SPOCTENO="(true|1)"/g,
  (_m, v: string) => `JE_SPOCTENO="${v === "1" ? "0" : "false"}"`,
)
```

## Tests Added or Updated

- `tests/contract/results.test.ts::JE_SPOCTENO lexical forms > a district document with JE_SPOCTENO=… parses as …`: `"true"`, `"false"`, `"1"` and `"0"` each map to the right boolean for every council in the district file.
- `tests/contract/results.test.ts::JE_SPOCTENO lexical forms > a council document with JE_SPOCTENO=…`: the same check for `councilSchema` (shared `obecSchema`).
- `tests/contract/results.test.ts::JE_SPOCTENO lexical forms > still rejects JE_SPOCTENO=…`: `"yes"`, `""`, `"TRUE"` and `"2"` are still rejected with `schema-mismatch`, so the fix doesn't loosen validation in general.
- `tests/integration/ingest.test.ts::finality of a whole document > a district document written with the live 2026 flags (1/0) follows them`: all `"1"` gives a final district; one `"0"` gives a non-final district.

## Local Verification

- Before the fix, `bun test tests/contract/results.test.ts tests/integration/ingest.test.ts` gave 5 failures (red), all on the new `"1"`/`"0"` cases.
- After the fix:
  - `bun test` (full suite) passes: 1183 pass, 0 fail.
  - `bun run typecheck` is clean.
  - `bun run check` (Biome) is clean after auto-formatting.
- Manual checks:
  - The unmodified live `vysledky_obce_okres_CZ0208.xml` and `vysledky_obec_537021.xml`, downloaded from `volby.gov.cz` into the session scratchpad, now give `ok: true` from `parseAndValidate`. Before the fix both gave `schema-mismatch`.
  - The replay regex was run on a sample string: `1→0`, `true→false`, and values that were already false are left unchanged.

## Deviations from Assessment

- **Fixture approach**: the assessment allowed either a new 2026-shaped fixture or inline XML. I chose to rewrite the flag inside the existing `fixtures/2026/` files in the tests. That means no live data is committed, so the open question about committing a live file stays open.
- **New finding, scope unchanged**: `fixtures/2026/` is copied from the 2022 data (see `fixtures/README.md`), not downloaded live, even though the contract test header calls these files "REAL published documents". That copy is how the wrong assumption got into the tests. It's recorded in the README note rather than fixed here.
- No test was added for the replay tool: `atProgress` isn't exported, and the tool has no test file. It was checked by hand (see above).

## Follow-ups

- Release a 0.3.1 patch quickly: the shipped 0.3.0 shows no council results for 2026. See the release-via-workflow_dispatch memory note: bump the version in 3 files, then run `gh workflow run build.yml --ref v0.3.1`.
- Consider refreshing `fixtures/2026/` from a real 2026 download once the count is final, so the contract tests run against real data, as their header says.
- `"0"` hasn't been seen live yet; the handling relies on `xs:boolean` semantics. Watch the logs for any other `Dokument odmítnut` entries after upgrading.
