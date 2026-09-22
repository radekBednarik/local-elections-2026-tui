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

Every function is reachable by keyboard; nothing requires a mouse (FR-005). The key map is discoverable
from a help view and a persistent footer hint.

| Key | Action |
|---|---|
| `↑` `↓` `PgUp` `PgDn` `Home` `End` | Move within a list |
| `Enter` | Open the selected area |
| `Esc` / `Backspace` | Go up one level |
| `/` | Search (FR-038) |
| `s` | Cycle sort column (FR-037) |
| `w` | Toggle the selected council on the watchlist (FR-039) |
| `W` | Open the watchlist |
| `e` | Export the current table (FR-049) |
| `E` | Produce a summary report (FR-051) |
| `r` | Refresh now, subject to the 60 s floor (FR-019) |
| `?` | Help |
| `q` | Quit |
