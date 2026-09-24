# Data Model: Stop Polling When Results Are Final

**Feature**: `003-stop-polling-when-final` | **Date**: 2026-09-24

One column is added to one table that already exists. No other table changes, and
exports are not touched.

## Source subscription (`source_subscription`)

Existing columns are unchanged. Added:

| Column | Type | Default | Meaning |
|---|---|---|---|
| `final` | `INTEGER NOT NULL`, `CHECK (final IN (0, 1))` | `0` | The most recent successfully read copy of this source was final (research R3). |

The meaning of an existing column changes:

| Column | Before | After |
|---|---|---|
| `next_due_at` | `NULL` meant "due now". Every write set a time, so this never happened in practice. | `NULL` means "nothing scheduled". It is set only for a final source with no manual refresh pending. |

The `Subscription` record in `src/sources/scheduler.ts` gains `final: boolean`.

### Validation rules

- `final = 1` implies `next_due_at IS NULL`, except between a manual `requestRefresh` and
  the next recorded attempt.
- `final = 0` implies `next_due_at IS NOT NULL`.
- `final` is written only by `recordSuccess` for a `200` response. A `304` or a failure
  leaves it as it is.

### State transitions

```text
                 200, not final
              ┌────────────────┐
              ▼                │
     ┌─────────────────┐   200, final    ┌──────────────────────┐
 ──▶ │ polled          │ ──────────────▶ │ final                │
     │ final = 0       │                 │ final = 1            │
     │ next_due = time │ ◀────────────── │ next_due = NULL      │
     └─────────────────┘ 200, not final  └──────────────────────┘
          │     ▲        (manual only)      │ r (60 s floor)  ▲
          │     │                           ▼                 │
          │     │                  ┌──────────────────────┐   │
          │     └─ 200, not final ─│ final, refresh asked │───┘
          │                        │ final = 1            │  200 final,
          │ failure: backoff       │ next_due = now       │  304, or failure
          └──▶ (stays polled)      └──────────────────────┘
```

- New rows start **polled**, spread across one interval, as today.
- **Polled → final**: a `200` whose document is final.
- **Final → final, refresh asked**: the user presses `r` and the 60-second floor allows it.
- **Final, refresh asked → final**: a `200` that is still final, a `304`, or a failure.
  None of these schedules another automatic attempt.
- **Final, refresh asked → polled**: a `200` that is no longer final (FR-005).
- **Any state → gone**: `--reset`, or a change of election, date or base URL. The table
  is cleared with the results (FR-007).
- **Unsubscribe**: a council left behind is removed only while it is **polled** (research R5).

## Schema version

`SCHEMA_VERSION` goes from 1 to 2. A version-1 database is upgraded when it is opened, by
adding the column (research R2). A new database gets the column from `createSchema`.

## Ingest result

`IngestResult` in `src/sources/ingest.ts` gains `final` on success:

```ts
type IngestResult =
  | { ok: true; outcomes: WriteOutcome[]; publishedAt: string; final: boolean }
  | { ok: false; reason: string }
```

`final` is true when the document has at least one block and every block is final under
`determineStatus` (research R3).
