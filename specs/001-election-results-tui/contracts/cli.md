# Contract: Command-line and environment surface

**Feature**: `001-election-results-tui` | **Stability**: this is the user-facing contract of the binary.
Changes here are breaking changes.

Parsed with `util.parseArgs` (built in – see research R6). All output text is Czech (FR-004a); option names
stay ASCII so they are typable on any keyboard layout.

## Invocation

```text
volby-kv2026 [options]
```

With no options the application starts the dashboard against the default election event.

## Options

| Option | Argument | Default | Requirement |
|---|---|---|---|
| `--election <id>` | Election event id, e.g. `kv2026` | `kv2026` | FR-014 |
| `--date <YYYYMMDD>` | Publication date directory | `20261009` | FR-014 |
| `--base-url <url>` | Alternative base location for published data | official portal | FR-014a |
| `--interval <seconds>` | Polling interval | `60` | FR-017 |
| `--data-dir <path>` | Override the per-user data directory | OS convention | FR-047 |
| `--refresh-reference` | Force re-retrieval of registries and code lists, then continue | off | FR-020a |
| `--reset` | Drop every stored result and registry, then continue from nothing | off | FR-045 |
| `--log-level <level>` | `error` \| `warn` \| `info` \| `debug` | `info` | FR-030 |
| `--version` | Print version and exit | | |
| `--help` | Print usage and exit | | |

### Validation rules

- `--interval` below `60` is **clamped to 60, not rejected**, and the clamping is reported on stderr.
  FR-017 permits refusing or clamping; clamping is chosen so a careless value cannot prevent startup.
- `--date` must match `^\d{8}$` and be a real calendar date. Invalid input exits non-zero before any
  network access.
- `--base-url` accepts `http(s)://` and `file://`. The `file://` form is what lets the replay harness and
  fixture-driven tests run with no network at all (research R9).
- An unknown option exits non-zero with usage on stderr. Options are never silently ignored.

## Stored data belongs to its source

The data directory holds one database, and that database records which dataset filled it:
`election`, `date` and `base-url` together.

| On start | Behaviour |
|---|---|
| Same dataset as last time | Stored results are kept and shown, marked with their age |
| Any of the three differs | Results, subscriptions and reference data are dropped; the application starts empty and waiting (FR-045) |
| Data present with no recorded dataset | Treated as foreign and dropped. Written by a version that did not record one |
| `--reset` | Everything fetched is dropped, whatever the dataset |

The watchlist is the user's, not the data's. It survives a change of source or date, because
a council code means the same thing across mirrors of one election, and is cleared only when
the **election** changes. Theme and side-panel state always survive.

**Why this is a contract and not an implementation detail.** A run against a mirror used to
leave mirrored figures in the database, and the next run would find them, decide they were
current and draw them. Showing a 2022 figure as a 2026 one is the failure every provenance
requirement exists to prevent (FR-029, FR-050, SC-017).

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Clean exit on user request (FR-006) |
| `1` | Invalid arguments |
| `2` | Unrecoverable startup failure, e.g. the data directory cannot be created |

**No other exit code exists.** FR-046 forbids terminating because of a network error, a malformed document,
or an unexpected source value. Those are surfaced in the interface and written to the log while the
application keeps running.

## Environment variables

| Variable | Effect |
|---|---|
| `VOLBY_DATA_DIR` | Same as `--data-dir`. The option wins |
| `NO_COLOR` | Honoured. Every status stays distinguishable without colour (FR-040) |
| `OPENTUI_LIBC` | Build-time only (research R2). Not read at runtime |

## Terminal contract

- Requires a minimum of **80 columns by 24 rows**. Below that the application renders a single message
  stating the requirement and the current size, and continues to run (FR-041).
- Restores the terminal to its prior state on exit, including after a fatal signal (FR-006).
- Responds to `SIGINT` and `SIGTERM` by shutting down cleanly.
- Reflows on resize (FR-041).

## Keyboard contract

Every function is reachable by keyboard; nothing requires a mouse (FR-005, FR-078). The key map is
discoverable from the help view, from the context-sensitive status bar, and from the command palette,
which shows each action's key beside it (FR-066).

**One source of truth.** This table is generated from `src/ui/palette/actions.ts`, which the status
bar, the palette and the help screen all read. A key documented here and absent there is a bug in one
of them, and `tests/ui/help-and-language.test.ts` fails when they disagree.

| Key | Action | Where |
|---|---|---|
| `↑` `↓` | Move the selection | lists |
| `PgUp` `PgDn` | Move ten rows | lists |
| `Home` `End` | Jump to the first or last row | lists |
| `Enter` | Open the selected item | lists |
| `Esc` / `Backspace` | Go up one level | everywhere |
| `Ctrl+P` | Open the command palette (FR-065) | everywhere |
| `/` | Search (FR-038) | everywhere |
| `w` | Toggle the council on the watchlist (FR-039) | a council |
| `Shift+W` | Open the watchlist | everywhere |
| `e` | Export the current table (FR-049) | tables |
| `Shift+E` | Produce a summary report (FR-051) | a district or council |
| `t` | Cycle the council type | the national overview |
| `s` | Sort by the next column, then back to the published order (FR-037) | tables |
| `r` | Refresh now, subject to the 60 s floor (FR-019) | everywhere |
| `Ctrl+B` | Show or hide the side panel (FR-056) | everywhere |
| `Ctrl+T` | Cycle theme: dark, light, high contrast (FR-061) | everywhere |
| `?` | Help | everywhere |
| `q` | Quit | outside search |
| `Ctrl+C` | Quit, whatever has focus | everywhere |

The status bar shows only the keys that do something on the current screen (FR-064). A key that would
do nothing here is not offered; the palette lists it with the reason instead (FR-069).

## Mouse contract

Optional throughout (FR-078).

| Input | Action |
|---|---|
| Click a row | Select it (FR-075) |
| Double-click a row | Open it, exactly as `Enter` does (FR-075) |
| Wheel | Scroll the content area (FR-076) |
| `Shift` + drag | The terminal's own text selection, preserved (FR-077) |

Not clickable: the status bar, the breadcrumb and the side panel. No context menus, no draggable
dividers (FR-079).
