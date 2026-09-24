# Interface Contract: Stop Polling When Results Are Final

**Feature**: `003-stop-polling-when-final`

What changes where the application meets the outside world: the requests it sends to the
publisher, and what the user sees. Everything not listed here stays as it is.

## 1. Requests to the publisher

| Source state | Automatic requests | Manual `r` |
|---|---|---|
| In progress | Once per interval, spread, with backoff on failure. Unchanged. | Allowed once per 60 s. Unchanged. |
| Final | **None.** | Allowed once per 60 s. It sends one request with the stored validators. |

- Finality is judged per source: nationwide, each district file, each council file.
- A final source does not start polling again by itself. A restart does not change
  that. Only `--reset` or a change of dataset starts it again.
- A manual refresh that returns data which is no longer final puts the source back into
  automatic polling.
- Registries and code lists: unchanged (downloaded once).

## 2. Title bar indicator

The indicator at the right of the title bar, before the clock:

| Condition | Text | Look |
|---|---|---|
| A source shown on screen is failing (stale warning) | ` ● ZASTARALÉ ` | `warning` role on the `warning` surface. Unchanged. |
| Every source shown on screen is final | ` ■ konečné · obnova ručně ` | `muted` role. |
| Otherwise | ` ● živě ` | `success` slot. Unchanged. |

The first matching row wins. The text carries the meaning in full, with or without colour
(FR-008, `NO_COLOR`). The breadcrumb shortens to make room, as it already does for the
clock.

**Sources shown on each screen:**

| Screen | Sources |
|---|---|
| `national`, `search`, `help` | `national` |
| `districts` | every `district:*` |
| `district` | `district:<nuts>` |
| `council`, `candidates` | `council:<kodzastup>` |
| `watchlist` | `council:<code>` for every watched council. Treated as `national` when the watchlist is empty. |

A screen whose sources are not all subscribed yet is not final.

## 3. Stale warning

`staleWarning` does not count final subscriptions. For final data, a failed manual
refresh is written to the log and nowhere else (research R6). The warning's text for
sources in progress is unchanged.

## 4. Footer and command palette

No change. `r obnovit` is already listed on every screen, and the palette's
"Vyžádat okamžité obnovení" is always available.

## 5. README

The "Polling" section replaces:

> The nationwide result and all 78 district files are refreshed continuously, spread
> across the interval rather than fired together.

with text to this effect:

> The nationwide result and all 78 district files are refreshed continuously, spread
> across the interval rather than fired together, until each one is final. A source whose
> count is complete is not requested again, not even after a restart. The title bar then
> says `konečné · obnova ručně`, and `r` still fetches it on demand, subject to the same
> 60-second floor.

## 6. Command line

No new flags. `--reset` also clears finality, because it clears the polling state.
