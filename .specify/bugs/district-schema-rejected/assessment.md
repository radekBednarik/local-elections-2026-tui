# Bug Assessment: Live 2026 district and council documents rejected over JE_SPOCTENO="1"

- **Slug**: district-schema-rejected
- **Created**: 2026-10-11
- **Source**: pasted text
- **Verdict**: valid
- **Severity**: critical

## Report (verbatim or summarized)

> The application has a bug - looks like data model expectations were wrong, because clearly today elections are almost done, and districts data are still evaluated as invalid. Investigate and fix. Example of district warning log:
>
> `2026-10-11T04:58:06.454Z WARN  Dokument odmítnut | {"source":"district:CZ0208","reason":"vysledky_obce_okres_CZ0208.xml: dokument neodpovídá schématu - VYSLEDKY_OBCE_OKRES.OBEC.0.JE_SPOCTENO: Invalid option: expected one of \"true\"|\"false\"; VYSLEDKY_OBCE_OKRES.OBEC.1.JE_SPOCTENO: Invalid option: expected one of \"true\"|\"false\"; VYSLEDKY_OBCE_OKRES.OBEC.2.JE_SPOCTENO: Invalid option: expected one of \"true\"|\"false\" (+83 dalších)"}`

## Symptom

Every live 2026 district document (`vysledky_obce_okres_*.xml`) and every per-council document (`vysledky_obec_*.xml`) fails schema validation and is rejected, so no council results ever show up, even though the count is close to finished. Expected: these documents parse, and councils show as provisional or final.

## Reproduction

1. Download the live district file: `https://volby.gov.cz/appdata/kv2026/20261009/odata/okresy/vysledky_obce_okres_CZ0208.xml` (HTTP 200, 170 KB, generated `2026-10-10T22:23:00`).
2. Count the flag's values: all 86 `OBEC` elements have `JE_SPOCTENO="1"`, and none has `"true"`.
3. Run `parseAndValidate(body, districtSchema, ...)`: the result is `schema-mismatch` on `OBEC.N.JE_SPOCTENO`, exactly as in the report.
4. Swap every `JE_SPOCTENO="1"` for `"true"` and validate again: the result is `ok: true`. No other field fails.
5. The same applies to the council file `zastup/vysledky_obec_537021.xml` (raw: `schema-mismatch` on `VYSLEDKY_OBEC.OBEC.0.JE_SPOCTENO`, patched: `ok`).
6. The national file `vysledky.xml` validates fine, because it has no `JE_SPOCTENO`.

The download and validation script was a throwaway in the session scratchpad and is not committed.

## Suspected Code Paths

- `src/parsing/schemas/common.ts:31-32` – `booleanFromString = z.enum(["true", "false"])` only accepts the text forms. **This is the root cause.**
- `src/parsing/schemas/common.ts:103` – `obecSchema.JE_SPOCTENO` uses it. `obecSchema` is shared by `districtSchema` and `councilSchema` (`src/parsing/schemas/results.ts:49,58`), so both kinds of document fail.
- `src/sources/ingest.ts:97` – the only reader of the parsed value (`sourceSaysCounted`). It already expects a JS boolean, so it needs no change once parsing is fixed.
- `tools/replay/server.ts:54,76` – the replay harness hides progress by rewriting `JE_SPOCTENO="true"` to `"false"`. When it replays 2026 data written as `"1"`, that regex matches nothing, so councils replayed below 100 % would wrongly stay marked as counted. This is a secondary, tooling-only issue.

## Root Cause Hypothesis

**Confidence: high.** The schema was written from the 2022 sample files in `fixtures/source-2022/`, which write the flag as `"true"`/`"false"` (106 `true` and 2 `false` across `fixtures/`). The 2026 publisher writes the same XSD `xs:boolean` attribute in its other lexical form, `"1"`/`"0"`, and XSD treats both forms as equivalent. Because the attribute is required and the whole document is validated, one unknown spelling rejects the entire file. The live probe shows this one field is the only difference: once it is normalised, both document types validate unchanged.

## Proposed Remediation

**Preferred**: Make `booleanFromString` accept the full XSD `xs:boolean` value set: `"true"`, `"false"`, `"1"` and `"0"`. Map `"true"` and `"1"` to `true`, and keep rejecting anything else, so a genuinely corrupted value still fails loudly. Update the doc comment so it says both forms exist and why. This is a one-line schema change and keeps the strict-validation design.

Also fix `tools/replay/server.ts` so the progress rewrite handles both spellings: match `JE_SPOCTENO="(true|1)"` and write the matching false value. Otherwise replaying a 2026 mirror lies about provisional status.

**Alternatives**:
- Use `z.coerce.boolean()` or a loose truthy check. Rejected: anything non-empty, such as `"false"`, would become `true`, and validation would no longer catch bad data.
- Normalise `"1"`/`"0"` to `"true"`/`"false"` in the XML parsing step before validation. Rejected: it spreads a field-specific rule into the generic parser for no gain.

**Files likely to change**:
- `src/parsing/schemas/common.ts`
- `tools/replay/server.ts`
- `tests/contract/results.test.ts`
- `fixtures/` – a new small 2026-shaped fixture with `JE_SPOCTENO="1"`/`"0"`, or inline XML in the test, following the pattern at `tests/integration/ingest.test.ts:250-259`
- `fixtures/README.md` (mention the 2026 lexical form)

**Tests to add or update**:
- Contract test: a district document with `JE_SPOCTENO="1"` parses, and the value is `true`.
- Contract test: `JE_SPOCTENO="0"` parses as `false`.
- Contract test: an invalid value (for example `"yes"` or an empty string) is still rejected with `schema-mismatch`.
- The same check for the council document schema, since it shares `obecSchema`.
- Ingest test: a `"1"` document produces a snapshot with `sourceSaysCounted = true`, so the status is final when `OKRSKY_ZPRAC == OKRSKY_CELKEM`.
- Replay tool, if it has tests: below 100 % progress, a `"1"` value becomes `"0"`.

## Risks & Considerations

- Low risk to the code: the schema becomes more permissive in a narrow way, and the downstream type (`boolean`) does not change.
- `"0"` has not been seen live yet, because every council in CZ0208 is already counted. Its handling relies on XSD `xs:boolean` semantics, not on observed data. The official XSD path (`.../odata/kv_vysledky_obce_okres.xsd`) returned 404, so it could not be checked directly.
- Data rejected so far was never stored. After the fix, the next poll should ingest everything. Check whether a rejection causes a backoff or quarantine that delays recovery (the `Dokument odmítnut` handling around `src/sources/ingest.ts:182`).
- Release urgency: the election is under way and the shipped 0.3.0 binary shows no council results. A patch release is probably needed (see the memory note on releasing through workflow_dispatch).
- The 2022 fixtures can no longer stand in for the live format by themselves. Other attributes may also differ in 2026, but the live probe found no other mismatch in the district, council or national documents.

## Open Questions

- [NEEDS CLARIFICATION: Should this ship straight away as a patch release (0.3.1)?]
- [NEEDS CLARIFICATION: Should a trimmed live 2026 district document be committed as a fixture? It contains public candidate names, and the existing 2022 fixtures already do the same.]
