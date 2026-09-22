# Quickstart: Election Results TUI

**Feature**: `001-election-results-tui` | **Date**: 2026-09-22

How to set up, run, and validate the feature. Scenarios are ordered so each one can be run as soon as the
user story it covers is implemented – you do not need the whole application to start validating.

---

## Prerequisites

| Tool | Version | Check |
|---|---|---|
| Bun | 1.4.2 or later | `bun --version` |
| Git | any recent | `git --version` |

Nothing else. The Bun runtime supplies TypeScript, the test runner, and SQLite.

**Note**: the live result files do not exist until 9 October 2026. Everything below runs against fixtures
and the replay harness until then (research R9).

## Setup

```bash
bun install
bun run check          # Biome lint + format check
bun test               # full suite
```

## Running

```bash
bun run dev                                    # against the default election
bun run dev -- --base-url file://./fixtures    # against committed fixtures, no network
bun run replay                                 # start the replay harness
bun run dev -- --base-url http://localhost:8787  # against the replay harness
```

See [contracts/cli.md](./contracts/cli.md) for the full option list.

## Building

```bash
bun run build:win      # bun-windows-x64
bun run build:linux    # bun-linux-x64, needs the Linux native package present
```

Cross-compiling from Windows requires manually unpacking `@opentui/core-linux-x64` into `node_modules`,
because package managers refuse to install another platform's native package (research R1). **Release
binaries come from the CI matrix**, which builds each target on its own runner. A locally cross-compiled
Linux binary has never been executed on Linux and must be treated as unverified.

---

## Validation scenarios

Each scenario states what it proves. Run them against fixtures unless stated otherwise.

### V1 – Binary starts and loads its native core (FR-001, FR-002)

**Run this first.** It guards the riskiest assumption in the plan, and everything else depends on it.

```bash
bun run build:win
./dist/volby-kv2026.exe --version
```

**Expect**: the version prints, with no error about a missing native library or SQLite module.

Must also confirm `bun:sqlite` works inside the compiled binary – open the database and read a row from the
binary, not from `bun run`. Research R3 flags this as verified for OpenTUI but **not** for SQLite.

### V2 – National overview populates and refreshes (User Story 1, FR-031, FR-021, FR-022)

```bash
bun run replay
bun run dev -- --base-url http://localhost:8787
```

**Expect**: turnout, count progress, and seats per electoral party appear; the publication timestamp is
shown; figures are labelled provisional; values update without interaction as the harness advances, and
changed values are visibly marked (FR-036).

### V3 – Drill down and back (User Story 2, FR-032 to FR-035)

From the national view, open a district, then a council, then a party.

**Expect**: municipalities list with turnout and progress; a council shows votes, share, and seats per
party; a party shows candidates with ballot position, personal votes, and elected status. Prague or Brno
shows its boroughs as separate councils attributed to their parent. `Esc` returns without losing position.

### V4 – Survives a hostile network (User Story 3, FR-043 to FR-046)

With the application running against the harness, stop the harness.

**Expect**: the last results stay on screen; a staleness warning names the reason and the age; retries slow
down rather than continuing at full rate; the application does not exit. Restart the harness – the warning
clears and refreshing resumes with no restart.

Then start the application with the harness already down and a populated database: it must start and show
cached results marked stale (FR-042).

### V5 – Malformed input is rejected, not displayed (FR-025, FR-027, FR-046)

Point the application at the malformed and truncated fixtures.

**Expect**: the documents are rejected whole, the previous good figures remain, the failure is logged, and
the application keeps running. **No partially parsed figures ever reach the screen.**

### V6 – Reference data is fetched once (FR-020, FR-020a, SC-014)

Run twice with a fresh data directory, comparing the request log.

**Expect**: the first run retrieves the archives; the second retrieves none and starts from the stored
copy. `--refresh-reference` forces retrieval again.

### V7 – Polling floor is respected (FR-016, FR-017, SC-005)

Run for five minutes with `--interval 1`.

**Expect**: the clamp to 60 s is reported on stderr, and the request log shows no source requested more than
once per 60 s. Requests are spread across each window rather than firing together (research R8).

### V8 – Search and reference resolution (User Story 4, FR-038, FR-011)

Search `ricany`, `Říčany`, and `RICANY`.

**Expect**: all three find the same municipality. Nowhere in any view is a raw numeric code shown where a
name exists.

### V9 – Watchlist persists (User Story 5, FR-039)

Watch two councils, quit, restart.

**Expect**: both are still watched and refresh in place.

### V10 – Export opens correctly in a spreadsheet (User Story 6, FR-049 to FR-053, SC-016, SC-017)

Export a district table and open it in Excel with a Czech locale.

**Expect**: columns split correctly, Czech diacritics intact, the provenance header naming the area,
publication timestamp, and provisional/final status. This is the scenario most likely to fail – see
[contracts/exports.md](./contracts/exports.md) on the BOM and semicolon delimiter.

### V11 – Terminal edge cases (FR-040, FR-041)

Resize below 80×24 and back; run with `NO_COLOR=1`.

**Expect**: a clear minimum-size message rather than corrupted output; reflow on resize; every status still
distinguishable without colour.

### V12 – Long run (SC-008)

Run against the harness for 12 hours, or a compressed equivalent.

**Expect**: no termination, no memory growth that degrades responsiveness, keystrokes still answered within
100 ms while refreshing (SC-010).

---

## Cross-platform check

V1, V2, V10, and V11 must pass on **both** Windows 11 and Linux before release (FR-002, SC-013). The Linux
run happens on the CI runner, since no Linux machine is available locally.

## Election-day readiness

Close to 9 October 2026, before relying on the application:

1. Re-check the published schemas against the Zod schemas – the format may have changed since planning.
2. Confirm the date and base path for the real event.
3. Run V6 against the real reference archives.
4. Expect `404` until publication begins; V-scenario FR-045 covers that this is handled gracefully.

---

## Amendment scenarios: UX redesign (FR-054 to FR-079)

Added 2026-09-22. Run these in addition to V1-V12, which all still apply.

### V13 - Framed regions and breadcrumb (FR-054, FR-055, FR-058)

Open the application and drill from the national overview down to a council.

**Expect**: a title bar, a bordered content area and a status bar, distinguishable without reading
them. The breadcrumb grows as you descend (`ČR › Okres Brno-město › Brno-Bohunice`) and shortens as
you go back. **While a refresh arrives, nothing moves**: not the regions, not the scroll position, not
the selected row.

### V14 - Side panel (FR-056, FR-057)

Watch two councils, toggle the panel, restart, then narrow the terminal below 100 columns.

**Expect**: the panel shows both councils with live figures; its open or closed state survives the
restart; it hides itself as the terminal narrows and returns when widened. The content area is never
squeezed to keep it open.

### V15 - Themes (FR-059 to FR-063)

Cycle through dark, light and high-contrast. Restart. Then run with `NO_COLOR=1`.

**Expect**: the theme persists across the restart. Under `NO_COLOR` every state is still
distinguishable, because colour was only ever decoration on text and symbols. In high contrast,
brightness alone separates the roles.

**Also check**: no electoral party is coloured differently from any other (FR-060).

### V16 - Command palette (FR-065 to FR-069)

Open the palette from a council screen. Type part of an action name, with and without diacritics.
Choose one.

**Expect**: every action appears, each with its keyboard shortcut beside it. Search narrows
insensitively to case and diacritics. Choosing performs the action. An action that does not apply here
is shown marked unavailable with a reason, **not hidden**. Esc returns exactly where you were.

### V17 - Bars (FR-070 to FR-074)

Open a council with several parties, then narrow the terminal.

**Expect**: a proportional bar beside each party's percentage, with the exact published figure still
shown. Parties on 7.62% and 7.76% have visibly different bars. As the terminal narrows the **bars
disappear before any figure does**. No trend line appears anywhere.

### V18 - Mouse (FR-075 to FR-079)

**This is the scenario that cannot be trusted to the test suite.** `createTestRenderer` uses a mock
input, so these will pass in tests while being wrong in a real terminal. Check by hand, on
**Windows Terminal and a Linux terminal**.

Click a row, double-click a row, scroll with the wheel. Then **hold Shift and drag across some
figures, and copy them**.

**Expect**: click selects, double-click opens, the wheel scrolls (FR-076). Shift-drag still selects text and
the copy still works. If copy-paste is broken, FR-077 has failed however green the suite is.

Then unplug the mouse, or use a terminal without mouse support: everything must remain reachable by
keyboard (FR-078).

### V19 - Everything degraded at once (SC-023)

Run at exactly 80 × 24, with `NO_COLOR=1`, and without touching the mouse.

**Expect**: the application is complete and usable. The side panel is hidden, bars are gone, colour is
absent, and every figure, every action and every navigation path still works.
