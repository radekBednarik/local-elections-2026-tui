# Phase 0 Research: Election Results TUI

**Feature**: `001-election-results-tui` | **Date**: 2026-09-22

Findings that resolve the unknowns in the Technical Context. Items marked **verified** were tested on this
machine (Bun 1.4.2, Windows 11 x64); items marked **documented** come from the publisher's or a vendor's
documentation without local execution.

---

## R1: OpenTUI packaging and the single-binary requirement

**Decision**: Use `@opentui/core` (imperative API, no framework binding). Ship via `bun build --compile`,
building each target on its own native platform.

**Rationale**: FR-001 demands a single self-contained executable, and OpenTUI is not pure TypeScript – it is
a Zig core reached through `bun:ffi`. This is the highest-risk assumption in the whole plan, so it was
tested rather than assumed.

**Verified findings**:

| Question | Result |
|---|---|
| How is the native code distributed? | Per-platform optional dependencies: `@opentui/core-{win32,linux,darwin}-{x64,arm64}`, plus `-musl` variants for Linux |
| What is in them? | `opentui.dll` (Windows), `libopentui.so` (Linux) |
| How is it loaded? | `bun:ffi` `dlopen`, resolved at runtime from `process.platform` / `process.arch` |
| Does `bun build --compile` embed it? | **Yes.** OpenTUI explicitly detects the `/$bunfs/` virtual path and rewrites it, so it is designed for compiled binaries |
| Does the compiled Windows binary run? | **Yes.** Compiled and executed successfully; the embedded DLL loaded |
| Compiled size | 93 MB (Windows), 94 MB (Linux), before `--minify` / `--bytecode` |
| Does cross-compiling to Linux work? | **Only if the Linux native package is physically present in `node_modules`** |

**The cross-compilation obstacle**: `bun add @opentui/core-linux-x64` on Windows records the dependency in
`package.json` but does **not** extract it into `node_modules`, because the package declares `os: linux`.
`npm i --os=linux --cpu=x64` fails outright with `notsup`. The build then fails with
`Could not resolve: "@opentui/core-linux-x64"`.

It can be forced by `npm pack`-ing the tarball and extracting it into `node_modules/@opentui/` by hand,
which was verified to produce a valid Linux ELF binary. That workaround is fragile and the resulting binary
has never been executed on Linux.

**Consequence**: Build each platform on its own runner. This matches OpenTUI's own instruction: "Build a
separate executable for each release target... The matching optional Core native package must exist on the
build machine."

**Alternatives considered**:

- *Node.js SEA*: OpenTUI supports it, but requires extracting assets at startup and setting
  `OTUI_ASSET_ROOT`. More moving parts than `bun --compile`, and the user specified Bun.
- *Ship source + require Bun on the target*: violates FR-001.
- *`@opentui/react` or `@opentui/solid`*: adds a reconciler and a second paradigm for a dashboard whose
  state is a handful of tables. Rejected on KISS grounds; `@opentui/core` is sufficient.

---

## R2: Build-time libc selection

**Decision**: Pass `--define process.env.OPENTUI_LIBC='"glibc"'` when building the Linux target.

**Rationale**: Documented by OpenTUI: "An unset build-time value can retain both Linux branches and require
both native packages for that architecture." This was observed directly – the first cross-compile attempt
demanded both `@opentui/core-linux-x64` *and* `@opentui/core-linux-x64-musl`. Defining the value prunes the
branch and halves the native packages the build needs.

**Scope note**: glibc only. A musl build is a separate target and is not committed to, consistent with the
spec's distribution assumption.

### R2a: `--bytecode` is unusable here (found during T006)

`bun build --compile --bytecode` **fails** on this project:

```text
11882 | var backend2 = await loadBackend2();
error: Expected "=>" but found ";"  (@opentui/core/chunk-bun-*.js)
```

Bytecode compilation cannot handle top-level `await`, and OpenTUI's own bundle uses it to load the native
backend. The flag is therefore dropped from both build scripts; `--minify` is kept and saves about 11 MB
before compilation. The startup gain `--bytecode` would have offered is not available on this stack.

---

## R3: Storage

**Decision**: `bun:sqlite`, one database file in the per-user data directory, WAL journal mode.

**Rationale**: Built into the runtime, so it costs nothing in the binary and needs no native dependency of
its own. It satisfies FR-020a (reference data queried directly on later runs without re-fetching), FR-042
(start without network), and FR-048 (two instances without corruption – WAL gives readers and a writer
concurrent access).

**Applied design notes**:

- Synchronous API. All database calls must stay off the render path; see R8.
- `strict: true` so parameters bind without `$` prefixes.
- `.transaction()` for batch writes – one transaction per fetched document, not per row. A district file
  holds hundreds of municipalities and per-row commits would be visibly slow.
- Reference data and result data live in the same file but are separated by table, since reference data is
  written once (FR-020) and results are overwritten continuously (FR-036a).

**RESOLVED (T006, 2026-09-22)**: Bun's docs do not state whether `bun:sqlite` works inside a `--compile`
binary. It was therefore smoke-tested rather than assumed, and it **works**: the compiled Windows binary
opens an on-disk database, enables WAL, writes and reads back a row containing Czech diacritics. The binary
was also run with `node_modules` removed entirely and still passed, confirming it is genuinely
self-contained (FR-001). This closes the highest-severity risk in the plan.

Note that the `type: "sqlite", embed: true` import form is explicitly read-only and in-memory, so it is
*not* suitable here – the database is opened from a real path at runtime.

---

## R4: Parsing and validation

**Decision**: `fast-xml-parser` v5.11.1 for parsing, `zod` v4.6.5 for validating the parsed object.

**Rationale**: The publisher ships XSDs, but validating against real XSDs in TypeScript requires a libxml2
binding – a second native dependency that would have to cross-compile alongside OpenTUI's. That risk is not
worth taking for a read-only client.

Hand-written Zod schemas mirroring the XSDs give an equivalent guarantee at the boundary that matters
(FR-025: reject a non-conforming document rather than display partial figures), with three advantages:
TypeScript types are inferred from the schemas so parser and types cannot drift; the schemas are plain
values and therefore directly unit-testable, which Principle II requires; and there is no native code.

**Both packages are current and actively maintained** (published 2026-08-27 and 2026-09-13 respectively).

**Applied design notes**:

- Parse with `ignoreAttributes: false` – the source carries most of its data in attributes
  (`CIS_OBEC`, `OZNAC_TYPU`, `PORADI_ZPRAC`).
- Numeric coercion must be explicit in the Zod layer, not left to the XML parser's guessing, so that a
  malformed number fails validation instead of silently becoming a string.
- One schema module per source document type, each with a fixture-driven test.

---

## R5: Archive extraction

**Decision**: `fflate` v0.8.3, used only on first run.

**Rationale**: The registry and code list bundles are ZIP archives. Node's `zlib` handles gzip and deflate
streams, not the ZIP container format, so a library is genuinely needed. `fflate` is small, dependency-free,
pure TypeScript, and actively maintained.

**Alternatives considered**: `adm-zip` (widely used but has had path-traversal advisories),
`yauzl` (solid but callback-based and heavier than needed for a once-per-install operation).

---

## R6: Things that need no dependency

Adding a package for any of these would violate the constitution's KISS principle.

| Need | Resolution |
|---|---|
| HTTP fetching | `fetch`, built into Bun. Conditional requests (FR-023) are ordinary request headers |
| Diacritic-insensitive search (FR-038) | `String.normalize("NFD")` then strip combining marks. One function, no package |
| Command-line arguments (FR-014, FR-014a) | `util.parseArgs`, built in |
| CSV export (FR-049) | Roughly 20 lines. See R7 for the encoding subtlety, which no generic library gets right for this case anyway |
| Retry backoff (FR-043) | A few lines of arithmetic over the subscription record |
| Per-user paths (FR-047) | `%APPDATA%` on Windows, XDG variables on Linux. One small module |

---

## R7: Czech text handling

**Decision**: UTF-8 everywhere internally. CSV exports are written UTF-8 **with a BOM** and a semicolon
delimiter.

**Rationale**: FR-053 requires diacritics to survive into spreadsheet software. Excel on a Czech Windows
system opens a BOM-less UTF-8 CSV using the system code page, which corrupts every accented character – and
it splits on semicolons, not commas, under a Czech locale. This is the single most likely way FR-053 fails
in practice, so it is settled here rather than discovered later.

**Search folding**: fold both the stored name and the query through the same normalize-and-strip function,
so `Ricany`, `Říčany`, and `ricany` all match. Case folding uses `toLocaleLowerCase("cs")`.

---

## R8: Concurrency model

**Decision**: Single process. Network fetching runs as async tasks on the event loop; parsing, validation,
and database writes run in the same loop but are chunked so no single operation blocks a frame.

**Rationale**: SC-010 requires the interface to answer a keystroke within 100 ms while a refresh is running.
The per-district set is around 10 MB across 77 files, and parsing one file is a synchronous CPU burst. With
`bun:sqlite` also being synchronous, the risk is a long blocking stretch that freezes the UI.

**Applied design notes**:

- One document at a time through the parse-validate-store pipeline, yielding between documents. FR-018b
  already requires the interface to work while data arrives, so incremental is the specified behaviour.
- The fetch scheduler spreads the 78 live sources across each polling window rather than firing them
  together, which respects FR-016 and avoids a once-a-minute burst against the publisher.
- A worker thread is the fallback if measurement shows parsing still blocks. Not adopted up front: it adds
  serialization and lifecycle complexity, and the constitution says not to introduce it before it is needed.

---

## R9: Test data and the replay harness

**Decision**: Fixtures committed to the repository, derived from the 2022 election data, plus a local
replay harness serving them over HTTP on a timer. The application reaches it through FR-014a.

**Rationale**: The 9 October 2026 result files do not exist yet, and the constitution forbids writing
implementation code before a failing test. Every parsing and rendering task therefore needs fixtures from
task one.

**Correction carried from clarification**: 2022 served the same three non-batch result sets through
*query-parameter endpoints* (`/pls/kv2022/vysledky?datumvoleb=20220923`), not the static file layout 2026
uses. The payloads are a shape reference; fixtures must be validated against the **2026** schemas, which are
authoritative wherever the two differ.

**What fixtures must cover**, drawn from the spec's edge cases – these will not all appear in real 2022
data and must be hand-written:

- A municipality subdivided into boroughs (Prague, Brno) – FR-035
- A coalition and an independents' association – exercises party composition
- A council with no result, an annulled election – edge case "councils with no result"
- Unallocated seats – edge case "ties and unfilled seats"
- A truncated and a malformed document – FR-025, FR-046
- A republished area whose figures changed – FR-028
- Provisional and fully-counted states – FR-022

**Harness scope**: a development and verification tool, not a shipped feature. It serves fixtures on a
compressed clock so a full count can be rehearsed in minutes instead of twelve hours (SC-008).

---

## R10: Toolchain decisions confirmed with the user

| Area | Decision | Note |
|---|---|---|
| Test runner | `bun test` | Built in; Jest-compatible `expect`; runs the same runtime that ships |
| UI testing | `@opentui/core/testing` | `createTestRenderer()` gives a real renderer with in-memory output and `captureCharFrame()` for frame assertions. Makes Principle II workable for the view layer |
| Lint / format | Biome v2.5.14 | One tool, one config |
| Build and release | GitHub Actions matrix | `windows-latest` and `ubuntu-latest`, each building its own target natively |
| Document validation | Zod schemas from the XSDs | See R4 |

**Open prerequisite**: the repository has **no git remote**. The CI matrix cannot run until it is pushed to
GitHub. This blocks release automation only – all development and local verification proceed without it.

---

## Residual risks

| Risk | Severity | Handling |
|---|---|---|
| `bun:sqlite` untested inside a compiled binary | High – would undermine FR-001 | Smoke-test in the very first build task, before any feature work depends on it |
| Linux binary never executed on Linux from this machine | High | The CI matrix runs it on `ubuntu-latest`; treat any locally cross-compiled Linux binary as unverified |
| ~93 MB per binary | Low | Inherent to embedding the Bun runtime. `--minify --bytecode` will reduce it; no requirement sets a size limit |
| Publisher changes the 2026 format before election day | Medium | Zod validation fails loudly rather than silently mis-parsing (FR-025). Re-check the schemas close to 9 October |
| Real election-day load or rate limiting differs from assumptions | Medium | FR-016 and FR-043 already constrain request rate; the replay harness cannot reproduce the publisher's real behaviour under load |

---

# Phase 0 Research: UX amendment (FR-054 to FR-079)

Added 2026-09-22, after the first build was run against real 2022 data. The findings below come from
the OpenTUI documentation installed as an agent skill, read against the working application rather
than in the abstract.

## R11: Almost all of the chrome already exists as components

**Decision**: Build the redesign on OpenTUI's built-in renderables rather than drawing frames by hand.

**Rationale**: The current interface is one `TextRenderable` holding a block of text, which is why it
reads as basic. OpenTUI ships exactly the pieces the amendment calls for:

| Requirement | Component | What it provides |
|---|---|---|
| FR-054, FR-055 framed regions, breadcrumb | `BoxRenderable` | `border`, `borderStyle` (single/double/rounded/heavy), `borderColor`, `title`, `bottomTitle` |
| FR-056 side panel | `BoxRenderable` in a flex row | Flexbox layout is already how the renderer positions children |
| long lists (78 districts, 6,000 councils) | `ScrollBoxRenderable` | Bounded viewport with culling and a scrollbar; `stickyScroll` for live updates |
| FR-065 command palette list | `SelectRenderable` | Options list with `ITEM_SELECTED` and `SELECTION_CHANGED` events |
| FR-067 palette search, existing search box | `InputRenderable` | Single-line editing, placeholder, `CHANGE` event |

`ScrollBoxRenderable` matters more than it first appears: the district list is 78 rows and a large
district runs to hundreds of councils, which the current hand-rolled offset arithmetic scrolls by
slicing an array. Culling in a real viewport is both faster and less code.

**Alternatives considered**: hand-drawing borders with box-drawing characters, as the `rule()` helper
does today. Rejected: it duplicates what the layout engine already does, and it cannot participate in
flexbox sizing, so every region would need manual width arithmetic that FR-057's auto-hiding panel
would then have to redo.

## R12: `TextTableRenderable` is deliberately NOT adopted yet

**Decision**: Keep rendering result tables as text rows. Revisit after the rest of the amendment lands.

**Rationale**: `TextTableRenderable` is real and would give bordered, wrapping, selectable cells. But
the current table code carries decisions that took real data to get right: non-breaking-space
grouping, the decimal comma, ellipsis truncation measured in code points, and the central width clamp
added after a council line overflowed an 80-column terminal. Replacing it wholesale would put all of
that back in play at the same time as five other changes.

The bars in FR-070 and the colour roles in FR-059 can be delivered without it. Swapping the table is a
separable follow-up with its own risk, and bundling it here would make a failure hard to attribute.

## R13: Colour must not be hardcoded hex

**Decision**: Express the palette as **roles**, resolved per theme to either an ANSI indexed slot or an
explicit colour. Default to indexed.

**Rationale**: `RGBA.fromIndex(0..255)` targets the terminal's own ANSI palette slot, and
`RGBA.defaultForeground()` / `defaultBackground()` target its defaults. Colours expressed that way
inherit whatever scheme the user has already configured, so the application looks at home in their
terminal instead of fighting it. Hardcoded hex would clash with every solarized or gruvbox setup.

The high-contrast theme (FR-062) is the exception: it needs guaranteed brightness separation, which an
unknown user palette cannot promise, so it pins explicit values.

**Capability detection**: `renderer.capabilities` exposes `ansi256`, and `color_scheme_updates` reports
the terminal's own light/dark preference (mode 2031). That gives an honest default theme rather than
guessing, and a terminal that reports neither falls back to the monochrome path FR-063 already
requires.

## R14: Views must carry meaning, not pre-formatted strings

**Decision**: Change the view builders from returning `string[]` to returning **semantic rows** - cells
with a role - and render those to either plain text or styled chunks.

**Rationale**: This is the one structural change the amendment forces. A `string` cannot carry colour,
so FR-059's roles and FR-070's bars cannot be expressed in the current return type. Two bad options
and one good one:

- Style inside the builders, returning chunks. Loses the plain-text form that the export module and
  roughly 120 tests depend on.
- Add a second styling pass that re-parses the strings. Fragile, and creates two sources of truth.
- **Return semantic rows.** One source of truth, rendered two ways: to plain text for tests and
  exports, to styled chunks for the terminal. Colour becomes a property of the renderer, not of the
  data, which is also what keeps FR-063 honest.

This preserves the existing tests in shape: they assert on the plain-text rendering, which remains
available and is what the export module already consumes.

## R15: Mouse is routed by cell bounds, and Shift-drag already works

**Decision**: Attach mouse handlers to row renderables; do not implement hit-testing.

**Rationale**: OpenTUI routes mouse input through rendered cell bounds and tracks one global text
selection per renderer. Events carry `modifiers` including `shift`, and `isDragging` marks events
belonging to a selection drag. FR-077's requirement that Shift-drag still selects text for copying is
therefore the framework's own behaviour rather than something to build.

**Caveat**: enabling mouse reporting takes the terminal's native selection away by default, which is
exactly why FR-077 exists. This must be verified by hand in a real terminal, not only in tests -
`createTestRenderer` uses a mock input and will happily pass while the real behaviour is wrong.

## R16: Bars are drawn with block characters

**Decision**: Use the Unicode eighth-block characters for sub-cell resolution.

**Rationale**: FR-070 needs a bar beside a percentage in a narrow column. Full blocks alone give one
cell of resolution per column, so a 10-column bar can only show 10 steps - visibly coarse when
comparing 7.62% against 7.76%. The eighth-blocks give eight sub-steps per cell, so the same 10 columns
resolve 80 steps.

FR-072 requires the bar to survive a monochrome terminal, which block characters do: they are shape,
not colour. FR-074's rule that bars are omitted rather than truncated on a narrow terminal is a
layout decision, made where the column widths are computed.

**Alternatives considered**: ASCII `#` bars (coarser and noisier), and braille patterns (finer, but
they render inconsistently across fonts and would fail FR-004's plain-terminal requirement).

## Residual risks, amendment

| Risk | Severity | Handling |
|---|---|---|
| Mouse reporting breaks native copy-paste in a real terminal | High - FR-077 | Must be checked by hand in Windows Terminal and a Linux terminal; the mock input cannot detect it |
| Semantic-row migration touches every view | Medium | Plain-text rendering keeps the existing assertions valid; migrate one view at a time with the suite green between each |
| Indexed colours look wrong in an unusual terminal palette | Low | The high-contrast theme pins explicit values, and monochrome remains supported |
| Theming and palette add surface the constitution's KISS principle argues against | Accepted | Recorded in the spec's Assumptions, justified by a concrete use case rather than speculation |
