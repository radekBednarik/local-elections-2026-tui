# Test fixtures

The 2026 municipal election is on **9 October 2026**. Its result files do not exist yet, so every test and
every local run works against the fixtures here (research R9).

## `source-2022/` - raw downloads, never edited

Real published data from the 2022 municipal election, retrieved **2026-09-22**:

| File | Source URL |
|---|---|
| `national.xml` | `https://volby.gov.cz/pls/kv2022/vysledky?datumvoleb=20220923` |
| `okres_CZ0100.xml` | `https://volby.gov.cz/pls/kv2022/vysledky_obce_okres?datumvoleb=20220923&nuts=CZ0100` |
| `okres_CZ0642.xml` | `https://volby.gov.cz/pls/kv2022/vysledky_obce_okres?datumvoleb=20220923&nuts=CZ0642` |
| `obec_551082.xml` | `https://volby.gov.cz/pls/kv2022/vysledky_obec?datumvoleb=20220923&cislo_obce=551082` |
| `obec_582786.xml` | `.../vysledky_obec?...&cislo_obce=582786` |
| `obec_554782.xml` | `.../vysledky_obec?...&cislo_obce=554782` |

These are kept verbatim as the provenance of everything in `2026/`. Do not edit them.

## `2026/` - derived, what the application reads

Produced by `bun run tools/fixtures/derive.ts`. Re-runnable; do not hand-edit.

The derivation changes only two things: the generation timestamp becomes an election-night time on
2026-10-09, and the district files are trimmed to three councils each so fixtures stay readable and tests
stay fast. **Element and attribute shapes are carried over untouched.**

That is sound because 2022 and 2026 reference the same schemas – `kv_vysledky.xsd`,
`kv_vysledky_obce_okres.xsd`, `kv_vysledky_obec.xsd` – so the payload shape is stable across editions. Only
the *delivery* changed: 2022 served these through query-parameter endpoints, 2026 serves static files. The
2026 schema remains authoritative wherever the two are ever found to differ.

| File | Covers |
|---|---|
| `vysledky.xml` | National aggregate, both `OBEC` and `MCMO` council types |
| `vysledky_obce_okres_CZ0100.xml` | Prague: city council plus two boroughs (FR-035) |
| `vysledky_obce_okres_CZ0642.xml` | Brno: statutory city plus two boroughs |
| `vysledky_obec_554782.xml` | Praha hl.m. - large council |
| `vysledky_obec_582786.xml` | Brno - statutory city |
| `vysledky_obec_551082.xml` | Brno-Bohunice - a borough |

## `edge-cases/` - hand-written, what real data will not show you

Real 2022 data is a complete, clean, finished count. It cannot exercise failure or in-progress states, so
these are written by hand. Each one exists to make a specific requirement fail loudly if it regresses.

| File | Exercises |
|---|---|
| `malformed.xml` | Broken markup - reject whole, keep previous data (FR-025, FR-027) |
| `truncated.xml` | Cut mid-document - same |
| `wrong-shape.xml` | Well-formed but wrong structure - schema validation, not just parsing |
| `bad-number.xml` | Non-numeric where a number is required - explicit coercion (research R4) |
| `annulled.xml` | Election not held - explicit status, never zero votes |
| `unfilled-seats.xml` | Seats unallocated, and a tie - no invented ordering (FR-029) |
| `provisional.xml` | Count in progress - provisional label (FR-022) |
| `final.xml` | Count complete - final label |
| `republished-changed.xml` | Same area, newer timestamp, changed figures (FR-028, FR-036) |

## Document shapes, as observed

```text
VYSLEDKY @DATUM_CAS_GENEROVANI                      # national
  TYP_ZASTUP @OZNAC_TYPU @NAZ_TYPU                  # OBEC | MCMO
    UCAST @OKRSKY_CELKEM @OKRSKY_ZPRAC @OKRSKY_ZPRAC_PROC
          @ZAPSANI_VOLICI @VYDANE_OBALKY @UCAST_PROC
          @ODEVZDANE_OBALKY @PLATNE_HLASY
    ZASTUPIT_INFO @ZASTUPITELSTVA_CELKEM @ZASTUPITELSTVA_ZVOLENA @ZASTUPITELE_ZVOLENI
    VOLEBNI_STRANA @VSTRANA @NAZEV_STRANY @HLASY @HLASY_PROC
                   @ZASTUPITELE_POCET @ZASTUPITELE_PROC

VYSLEDKY_OBCE_OKRES @DATUM_CAS_GENEROVANI           # district
  OBEC @KODZASTUP @NAZEVZAST @OZNAC_TYPU @VOLENO_ZASTUP @POCET_OBVODU @JE_SPOCTENO
    VYSLEDEK
      UCAST ...
      VOLEBNI_STRANA @POR_STR_HLAS_LIST @VSTRANA @NAZEV_STRANY @HLASY @HLASY_PROC
                     @KANDIDATU_POCET @ZASTUPITELE_POCET @ZASTUPITELE_PROC
        ZASTUPITEL @PORADOVE_CISLO @JMENO @PRIJMENI @TITULPRED @TITULZA @HLASY @HLASY_PROC

VYSLEDKY_OBEC @DATUM_CAS_GENEROVANI                 # single council
  OBEC ...                                          # identical to the OBEC block above
```

Two things follow from this and are relied on in `src/parsing/`:

1. **The `OBEC` block is identical in the district and council documents.** It is defined once and reused,
   per the DRY principle.
2. **`ZASTUPITEL` lists only elected representatives**, not the full candidate list. Full candidate lists
   come from the `KVRK` registry, which is why reference data is needed for FR-034.

## Reference data

`2026/reg.zip` and `2026/ciselniky.zip` are derived by
`bun run tools/fixtures/derive-reference.ts` from the **real, already published** 2026
archives:

| Archive | Source URL | Size |
|---|---|---|
| `KV2026reg20260915_xml.zip` | `https://volby.gov.cz/opendata/kv2026/KV2026reg20260915_xml.zip` | 7.0 MB |
| `KV2026ciselniky20260915_xml.zip` | `https://volby.gov.cz/opendata/kv2026/KV2026ciselniky20260915_xml.zip` | 215 KB |

Retrieved 2026-09-22. These are gitignored because of their size; the derivation keeps
only the rows belonging to the six fixture councils, taking 126 MB uncompressed down to
220 KB of committed fixtures.

### What the real archives showed

Three things differ from the published description and from what the data model assumed.
All three are handled in `src/parsing/schemas/` and `src/storage/schema.ts`.

1. **`kvros_slozeni.xml` does not exist.** The registry archive contains only
   `kvrzcoco.xml`, `kvros.xml` and `kvrk.xml`. Coalition composition comes from
   `cvs_slozeni.xml` in the code lists instead, plus the `SLOZENI` field on `KV_ROS`.
2. **Code lists use child elements, not attributes**, unlike the result documents which
   put almost everything in attributes. Both shapes have to be parsed.
3. **Candidates are keyed by `OSTRANA`, results by `VSTRANA`.** `OSTRANA` is a party's
   number within one council; `VSTRANA` is its nationwide code. `KV_ROS` carries both
   and is the only bridge between them, so FR-034 cannot join a result to its candidate
   list without loading that registry.

`kvrk.xml` is 110 MB uncompressed - every candidate in the country. Loading it on first
run is the single most expensive thing the application does, which is what SC-015 and
FR-020 are really about.
