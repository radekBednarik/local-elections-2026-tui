# Contract: Consumed data sources

**Feature**: `001-election-results-tui` | **Direction**: inbound only. The application is a read-only
client (spec Assumptions) – it never submits anything.

This is the contract the application depends on but does not control. Every document is validated with a
Zod schema before its figures reach the interface (FR-025, research R4).

Base location: `{base-url}/appdata/{election}/{date}/odata/`, where the three parts come from
`--base-url`, `--election` and `--date` (see [cli.md](./cli.md)).

---

## In scope – the three ongoing sources

| Key | Path | Granularity | Refresh | Requirement |
|---|---|---|---|---|
| `national` | `vysledky.xml` | Whole country | 60 s | FR-007 |
| `district:{NUTS}` | `okresy/vysledky_obce_okres_{CZXXXX}.xml` | One district, all its municipalities | 60 s | FR-008 |
| `council:{KODZASTUP}` | `zastup/vysledky_obec_{XXXXXX}.xml` | One council | 60 s | FR-009 |

`{CZXXXX}` comes from the published NUTS code list; `{XXXXXX}` is a `KODZASTUP` registry code.

**Volume**: 1 national + 77 district sources are polled continuously (FR-018). Council sources are polled
only while open or watched (FR-018a) – there are roughly 6,000 of them and polling them all is forbidden.

### Reference archives – retrieved once, on first run (FR-020)

| Archive | Contents |
|---|---|
| `KV2026reg20260915_xml.zip` | `KVRZCOCO`, `KVROS`, `KVROS_SLOZENI`, `KVRK` |
| `KV2026ciselniky20260915_xml.zip` | `CNUMNUTS`, `CNS`, `CPP`, `CVS`, `CVS_SLOZENI`, `KVDRUHZ`, `KVTYPZAS`, `KV_COCO` |

---

## Explicitly out of scope

| Source | Why excluded |
|---|---|
| `okrsky/vysledky_okrsky_{NNNNN}.xml` | Batch (dávka) – FR-012 |
| `obce_d/vysledky_obce_{NNNNN}.xml` | Batch (dávka), new in 2026 – FR-012 |
| `vysledky_okrsky.xml`, `vysledky_obce.xml` | Aliases returning the **latest batch**, therefore batch sources |
| Polling-district boundary data (GeoJSON, Shapefile) | Geospatial, separate portal, not renderable in a terminal |

**Consequence** (FR-013): per-polling-district vote breakdowns are published *only* through the batch
sources. The application must therefore state that this level does not exist rather than showing an empty
view. The finest granularity available is the individual council.

---

## Request contract

| Aspect | Rule |
|---|---|
| Minimum interval | 60 s per source, always (FR-016). The publisher's cache has 60 s granularity, so faster polling returns identical bytes |
| Scheduling | Sources are spread across the window, not fired together (research R8) |
| Conditional requests | Send `If-None-Match` / `If-Modified-Since` from the stored validators; `304` means keep the current snapshot and record a successful attempt (FR-023) |
| Identification | A descriptive `User-Agent` naming the application and version (FR-024) |
| Timeout | Per request, bounded. A timeout is an ordinary failure, not a crash (FR-046) |

## Response handling

| Response | Behaviour |
|---|---|
| `200` + valid document | Parse, validate, store. Replace the snapshot only if newer or changed (FR-028) |
| `200` + invalid document | **Reject entirely.** Keep the previous snapshot, log, mark the source failed (FR-025, FR-027) |
| `304 Not Modified` | Keep the snapshot, reset the failure counter, do not disturb change highlighting |
| `404` | Expected before publication begins. Report "results are not yet being published" and keep retrying (FR-045) |
| `5xx`, timeout, DNS failure | Increment failures, apply backoff, keep the last good data visible with a staleness warning (FR-043, FR-044) |

**Backoff**: on consecutive failures the interval grows from the configured value up to a ceiling, then
holds. One success resets it (FR-043). Backoff never drops below the 60 s floor.

## Document shape expectations

Validated per document type by Zod schemas mirroring the published XSDs. Cross-cutting rules:

- **Attributes carry the data.** The parser runs with `ignoreAttributes: false`; keys such as `CIS_OBEC`,
  `OZNAC_TYPU`, `PORADI_ZPRAC` are attributes, not elements.
- **Numbers are coerced explicitly** in the schema layer, so a malformed number fails validation instead of
  becoming a string (research R4).
- **Encoding is UTF-8**; Czech diacritics must survive parsing intact (FR-026).
- **`OZNAC_TYPU`** distinguishes a municipality (`OBEC`) from a borough (`MCMO`) and drives the separate
  presentation required by FR-035.
- **The publisher's generation timestamp is authoritative** for "last updated". Local time is used only to
  compute staleness age (data-model, edge case "clock skew").
- **Unknown fields are ignored, missing required fields are fatal** to that document. A source that adds a
  field must not break the client; a source that drops one the interface depends on must fail loudly.

## Reference data resilience

If the archives cannot be retrieved, the application still starts and shows results, degrading to numeric
codes with a warning (FR-011 edge case). A council or party present in results but absent from reference
data is displayed with its code and a note, never silently dropped.
