# volby-kv2026

A terminal dashboard for the Czech municipal elections of **9 October 2026**. It polls
the official open data, parses it, and shows a live, self-updating view of the count that
you can drill into from the whole country down to an individual candidate.

The interface is in Czech throughout, because the data is.

## What it does

- **Live national overview** – turnout, polling districts counted, seats by electoral
  party, refreshing on its own with changed values marked.
- **Drill-down** – country → district → council → electoral party → candidates. Boroughs
  are grouped under their parent municipality.
- **Search** – by council, electoral party or candidate name, insensitive to case and
  diacritics. `ricany` finds Říčany.
- **Watchlist** – mark a handful of councils and watch them together; it survives a
  restart.
- **Export** – the displayed table to CSV, or a readable summary report.
- **Survives a bad network** – keeps the last good figures on screen, says plainly that
  they are stale and why, backs off, and recovers on its own.

## The interface

Three regions that never move. A title bar carrying a breadcrumb of where you are
(`ČR › Okres Brno-město › Brno-Bohunice`), a bordered content area, and a status bar
listing **only** the actions that do something on the screen you are looking at. New data
arriving changes the figures and nothing else: not the regions, not your scroll position,
not the row you had selected.

- **Command palette** (`Ctrl+P`) – every action the application has, searchable, with its
  key shown beside it so using the palette teaches you the shortcut. An action that does
  not apply here is listed with the reason rather than hidden.
- **Side panel** (`Ctrl+B`) – your watchlist beside the table, with live turnout. It hides
  itself when the terminal is too narrow to show it without squeezing the table, and comes
  back when there is room. Its state survives a restart.
- **Themes** (`Ctrl+T`, or type `motiv` in the palette) – Tokyo Night (the default),
  Catppuccin Mocha, Gruvbox Dark, Nord, Catppuccin Latte (light) and high contrast. Each
  region sits on its own background, table rows are striped, and every text colour meets
  a readable contrast on the background it is drawn on. High contrast separates states by
  brightness rather than hue. On a 256-colour terminal each colour is shown as its nearest
  match; with `NO_COLOR` nothing is coloured at all. A choice of the old "dark" or "light"
  theme carries over to Tokyo Night or Catppuccin Latte.
- **Bars** – a proportional bar beside each published share, drawn in eighth-blocks. On a
  narrow terminal the bars go before any figure does.
- **Mouse, optionally** – click a row to select it, double-click to open it, wheel to
  scroll. Nothing needs a mouse: every action has a key, and the chrome is not clickable.
  `Shift`+drag still gives you your terminal's own text selection.

**Colour is never load-bearing.** Every state it marks is also carried by text, a symbol
or a position, so `NO_COLOR` and a monochrome terminal lose decoration and nothing else.
Sorting is marked with `▾`, the selected row with `▶`, a risen figure with `▲`.

**No electoral party is coloured differently from any other.** With thousands of local
candidate lists there is no authoritative party colour, and inventing one would imply an
affiliation the source never published.

## What it deliberately does not do

**No per-polling-district (okrsek) results.** Those are published only through the
batch ("dávka") sources, which are out of scope. The finest granularity available is the
individual council. The application says so where a user would expect to find them,
rather than showing an empty screen.

**No projections.** Every figure comes straight from the published data. Nothing is
estimated, extrapolated, or recomputed — not even a turnout percentage that could be
derived from the counts beside it.

## Install

Download the binary for your platform from the
[releases page](https://github.com/radekBednarik/local-elections-2026-tui/releases) and
run it. It is self-contained: no runtime, no dependencies, nothing to install.

```bash
volby-kv2026            # Windows
./volby-kv2026          # Linux
```

Requires a terminal at least **80 × 24** with Unicode support.

## Usage

```text
volby-kv2026 [přepínače]

  --election <id>        Volby, výchozí kv2026
  --date <RRRRMMDD>      Datum zveřejnění, výchozí 20261009
  --base-url <url>       Jiné umístění dat (http://, https:// nebo file://)
  --interval <sekundy>   Interval stahování, minimum 60
  --data-dir <cesta>     Jiný adresář pro data aplikace
  --export-dir <cesta>   Adresář pro exporty, výchozí aktuální adresář
  --refresh-reference    Znovu stáhnout registry a číselníky
  --reset                Smazat uložené výsledky i registry a začít od nuly
  --log-level <úroveň>   error | warn | info | debug, výchozí info
  --version              Vypsat verzi a skončit
  --help                 Vypsat tuto nápovědu a skončit
```

Press `?` inside the application for the full key map, or `Ctrl+P` for the command palette.

Minimum terminal size is 80 × 24.

**Stored data belongs to the source it came from.** The database remembers which election,
date and base URL filled it. Point the application somewhere else - a mirror, a replay
harness, the live source - and it drops what it holds and starts empty, waiting for fresh
data, rather than showing you yesterday's figures as today's. `--reset` does the same on
demand. Your watchlist, theme and panel state survive; they are yours, not the data's.

### First run

The first launch downloads the registries and code lists (about 7 MB) and stores them
locally. Every later run reads them from disk and downloads nothing. They are what turns
numeric codes into names and supplies full candidate lists.

### Polling

No source is requested more than **once per 60 seconds**. That is the publisher's own
cache granularity, so a faster poll returns identical bytes while adding load on the
busiest night of the year. A shorter `--interval` is clamped, not rejected.

The nationwide result and all 78 district files are refreshed continuously, spread across
the interval rather than fired together. Individual councils are fetched when you open
them and stay subscribed only while on screen or on your watchlist.

## Data source

Published by the Czech Statistical Office at
[volby.gov.cz/opendata/kv2026](https://volby.gov.cz/opendata/kv2026/kv2026_opendata.htm).

| Used | Not used |
|---|---|
| `vysledky.xml` — nationwide | `vysledky_okrsky_NNNNN.xml` — batch |
| `vysledky_obce_okres_CZXXXX.xml` — per district | `vysledky_obce_NNNNN.xml` — batch |
| `vysledky_obec_XXXXXX.xml` — per council | polling-district boundaries (GIS) |
| registry and code list archives | |

## Development

```bash
bun install
bun test             # full suite
bun run check        # lint and format
bun run typecheck
bun run dev          # run from source
```

The 2026 result files do not exist until election day, so everything runs against
fixtures derived from the real 2022 election plus the real, already-published 2026
registries. See [fixtures/README.md](fixtures/README.md).

```bash
bun run replay                                    # serve fixtures on a compressed clock
bun run dev -- --base-url http://localhost:8787   # point the app at it
```

### Testing the real binary against a previous election

The fixtures cover six councils. To exercise the application at full scale — every
district, thousands of councils, real party and candidate names — mirror a previous
election locally:

```bash
bun run mirror                    # national + all 78 districts + Brno's councils
bun run mirror -- --districts 5 --councils CZ0100    # a quicker subset
```

Then point the built binary at it:

```bash
dist\volby-kv2026.exe --base-url file://C:/path/to/mirror --election kv2022 --date 20220923
```

The mirror downloads the 2022 results, which the publisher serves through
query-parameter endpoints, and writes them in the static-file layout the application
expects. Payloads are copied verbatim; only the layout changes. It pauses between
requests, skips anything already downloaded, and pairs the results with the **real 2026
registries** — council codes are stable between elections, so names and candidate lists
resolve correctly.

What this does and does not prove: it exercises fetching, parsing, storage, navigation,
search, the watchlist and export against genuine data at genuine volume. It does not
exercise a live count, since 2022 is complete and every figure is final — use the replay
harness for that.

### Building

```bash
bun run build:win      # bun-windows-x64
bun run build:linux    # bun-linux-x64 (glibc)
```

Each binary must be built on its own platform: OpenTUI ships a native library per
target, and package managers refuse to install another platform's. CI does this on a
matrix; a locally cross-compiled binary has never been executed and should not be
released.

## Licence and disclaimer

Unofficial. Not affiliated with the Czech Statistical Office. The published data is
authoritative; this is a viewer for it.
