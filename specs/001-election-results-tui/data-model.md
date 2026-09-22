# Phase 1 Data Model: Election Results TUI

**Feature**: `001-election-results-tui` | **Date**: 2026-09-22 | **Storage**: `bun:sqlite`, WAL mode

Derived from the Key Entities section of [spec.md](./spec.md). Source field names from the publisher are
given in `CODE` form so the mapping from the published documents stays traceable.

---

## Storage layout

One database file at the per-user data path (FR-047). Three groups of tables with different lifecycles:

| Group | Written | Lifecycle |
|---|---|---|
| **Reference** | Once, on first run (FR-020) | Read-only afterwards. Never re-fetched unless absent, unusable, or the user asks |
| **Results** | Continuously while polling | Current row overwritten in place; one prior copy retained for change highlighting (FR-036a) |
| **Local state** | On user action | Watchlist, configuration, source subscriptions |

A single `election_event` key scopes every reference and result row, so pointing the application at a
different election (FR-014) cannot mix data from two elections.

---

## Reference entities

Loaded from the registry and code list archives. Field names map directly to the published code lists.

### `region`

From `CNUMNUTS`. A top-level territorial unit.

| Field | Source | Notes |
|---|---|---|
| `numnuts` | `NUMNUTS` | Numeric code, primary key |
| `nuts` | `NUTS` | NUTS code |
| `name` | `NAZEVNUTS` | Official name |
| `name_folded` | derived | Diacritic-stripped, lowercased for search (FR-038) |

### `district`

The unit at which per-district result documents are published, and the middle level of navigation.

| Field | Source | Notes |
|---|---|---|
| `nuts` | `NUTS` | `CZXXXX`, primary key. Used to build the per-district request |
| `region_nuts` | → `region.nuts` | |
| `name`, `name_folded` | | |

### `municipality`

| Field | Source | Notes |
|---|---|---|
| `obec` | `OBEC` | Registry code, primary key |
| `district_nuts` | → `district.nuts` | |
| `name`, `name_folded` | | |

### `council`

From `KVRZCOCO` and `KV_COCO`. **The unit results are actually reported for** – a municipal or borough
assembly. This is the central entity; municipalities exist mainly to group councils.

| Field | Source | Notes |
|---|---|---|
| `kodzastup` | `KODZASTUP` | Primary key. Used to build the per-council request |
| `obec` | → `municipality.obec` | |
| `druhzastup` | `DRUHZASTUP` → `council_type` | Village, city, statutory city, Prague, district, borough |
| `typzastup` | `TYPZASTUP` → `council_class` | Municipality vs borough |
| `mandaty` | `MANDATY` | Seats to be filled |
| `cobvodu` | `COBVODU` | Number of electoral wards |
| `stav_obce` | `STAV_OBCE` | Status – carries "election did not take place / annulled" |
| `parent_kodzastup` | derived | Set for boroughs, so FR-035 can attribute them to their parent |

**Validation**: `mandaty > 0` for any council with a result. A council whose `stav_obce` marks it as not
holding an election is displayed with that status rather than as zero votes.

### `council_type` / `council_class`

From `KVDRUHZ` (`DRUHZASTUP`, `NAZDRUHZAS`) and `KVTYPZAS` (`TYPZASTUP`, `NAZTYPUZAS`). Simple code-to-name
lookups; their only job is to satisfy FR-011 so no numeric code is ever shown.

### `political_party`

From `CNS`. A registered party or movement.

| Field | Source |
|---|---|
| `nstrana` | `NSTRANA` (primary key) |
| `name` | `NAZEV_STRN` |
| `abbrev_30`, `abbrev_8` | `ZKRATKAN30`, `ZKRATKAN8` |

### `political_affiliation`

From `CPP`. A candidate's party membership, which may differ from the list they stand on.
Fields: `pstrana` (key), `NAZEV_STRP`, `ZKRATKAP30`, `ZKRATKAP8`.

### `electoral_party`

From `KVROS` – a candidate list standing in one specific council. Note this is council-scoped, unlike
`CVS` which is the nationwide catalogue.

| Field | Source | Notes |
|---|---|---|
| `kodzastup` | `KODZASTUP` | Composite primary key with `ostrana` |
| `ostrana` | `OSTRANA` | List number within that council |
| `name` | `NAZEVCELK` | Up to 2000 characters |
| `typvs` | `TYPVS` (from `CVS`) | Party, coalition, independents, association |

### `electoral_party_composition`

From `KVROS_SLOZENI`. Resolves which registered parties make up a coalition or association.
`(kodzastup, ostrana) → nstrana`, many-to-many.

### `candidate`

From `KVRK`.

| Field | Source | Notes |
|---|---|---|
| `kodzastup`, `ostrana` | → `electoral_party` | |
| `por_str_hl` | `POR_STR_HL` | Ballot position |
| `name`, `name_folded` | | Searchable (FR-038) |
| `pstrana` | → `political_affiliation` | |
| `cobvodu` | `COBVODU` | Ward assignment |

**Volume note**: this is by far the largest reference table – every candidate in every municipality
nationwide. It needs an index on `(kodzastup, ostrana)` for the drill-down in FR-034 and on `name_folded`
for search.

---

## Result entities

Written from the three non-batch live sources. Batch sources are out of scope (FR-012), so there is
deliberately **no polling-district table** (FR-013).

### `result_snapshot`

The figures for one area at one moment. One current row per area, plus one prior row for change detection.

| Field | Notes |
|---|---|
| `area_kind` | `national` \| `district` \| `council` |
| `area_id` | `''`, a district `nuts`, or a `kodzastup` |
| `published_at` | The publisher's generation timestamp. **Authoritative for "last updated"**, never local time (edge case: clock skew) |
| `fetched_at` | Local time of retrieval, used only for staleness age (FR-044) |
| `districts_total`, `districts_counted` | Count progress (FR-031) |
| `is_final` | `districts_counted == districts_total`. Drives the provisional/final label (FR-022) |
| `voters_registered`, `envelopes_issued`, `valid_votes` | |
| `turnout_pct` | Stored as published, **not recomputed** (FR-029) |
| `is_current` | `1` for the live row, `0` for the retained prior row |

**Constraint**: at most two rows per `(area_kind, area_id)` – one current, one prior. Writing a new snapshot
demotes the current row and deletes any older one. This is what enforces FR-036a in storage rather than
relying on application discipline.

**Transition rule**: a snapshot is replaced only when the incoming `published_at` is newer, or figures
differ (FR-028). An identical re-fetch must not consume the prior row, otherwise the change highlight from
FR-036 would be wiped by a no-op refresh.

### `party_result`

Per electoral party within one snapshot. `(snapshot_id, ostrana)`, holding `votes`, `vote_pct` as
published, and `seats_won`. Sortable per FR-037.

### `candidate_result`

Per candidate within a council snapshot: `pochlasu` (`POCHLASU`, personal votes) and `mandat` (`MANDAT`,
whether elected) – FR-034.

---

## Local state entities

### `source_subscription`

The polling record for one live source. Directly implements FR-015, FR-016, FR-043.

| Field | Notes |
|---|---|
| `source_key` | e.g. `national`, `district:CZ0100`, `council:554782` |
| `last_success_at`, `last_attempt_at` | |
| `last_error` | Reason shown in the staleness warning (FR-044) |
| `consecutive_failures` | Drives backoff |
| `next_due_at` | Scheduler ordering. Spreading these values is how the 78 live sources avoid a once-a-minute burst |
| `etag`, `last_modified` | Conditional-request validators (FR-023) |

**Invariant**: `next_due_at - last_attempt_at >= 60s` always. FR-017 clamps any user-configured interval
that would breach it, and FR-019's manual refresh is subject to the same floor.

### `watchlist_entry`

`kodzastup` plus the order it was added. Persists across runs (FR-039).

### `app_config`

Key-value. Election event and date (FR-014), alternative base location (FR-014a), polling interval,
reference-data load status.

---

## Entity relationships

```text
region ──< district ──< municipality ──< council ──< electoral_party ──< candidate
                                            │              │
                                            │              └──< electoral_party_composition >── political_party
                                            │
                                            └── council_type, council_class          candidate >── political_affiliation

result_snapshot (national | district | council)
   ├──< party_result
   └──< candidate_result          council ──< watchlist_entry
                                  source_subscription (one per polled source)
```

---

## Derived values and what must never be computed

FR-029 forbids estimating, projecting, or extrapolating. The boundary:

| Allowed | Forbidden |
|---|---|
| `is_final` from counted vs total | Recomputing `turnout_pct` from raw counts – store what is published |
| `name_folded` for search | Projecting a final seat count from partial returns |
| Change flags by comparing current to prior snapshot | Inferring a winner before the source marks the count complete |
| Sorting and ordering for display | Inventing an order where the source reports a tie |

---

## Indexes

| Table | Index | Serves |
|---|---|---|
| `council` | `obec`, `parent_kodzastup` | Drill-down and borough grouping (FR-032, FR-035) |
| `council`, `municipality` | `name_folded` | Search (FR-038) |
| `candidate` | `(kodzastup, ostrana)`, `name_folded` | Candidate list and search (FR-034, FR-038) |
| `result_snapshot` | `(area_kind, area_id, is_current)` | The hottest read path – every render |
| `source_subscription` | `next_due_at` | Scheduler picking what is due |
