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
  --log-level <úroveň>   error | warn | info | debug, výchozí info
  --version              Vypsat verzi a skončit
  --help                 Vypsat tuto nápovědu a skončit
```

Press `?` inside the application for the full key map.

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
