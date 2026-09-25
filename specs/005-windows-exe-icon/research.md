# Research: Custom Icon for the Windows Executable

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Date**: 2026-09-25

All findings below were checked against Bun 1.4.2, the version pinned in CI
(`.github/workflows/build.yml`) and installed locally.

## R1 - How the icon gets into the executable

**Decision**: Add Bun's own `--windows-icon=assets/icon.ico` flag to the existing
`build:win` script in `package.json`.

**Rationale**: Bun 1.4.2 has the flag built in (`bun build --help` lists it, next to
`--windows-title`, `--windows-version` and the other metadata flags). It is a one-token
change to the command that CI and the README already use, so FR-004 and FR-005 are met
without new scripts or dependencies. The Bun repository's own test suite
(`test/bundler/compile-windows-metadata.test.ts`) exercises the flag with a hand-made `.ico`.

**Alternatives considered**:
- *Post-process the `.exe` with `rcedit` or a similar resource editor*: adds a dependency
  and a second tool touching the binary. A Bun executable carries its bundled program
  inside the PE file, and an external resource editor that rewrites sections risks
  corrupting it. Rejected.
- *Replace the CLI script with a `Bun.build({ compile: { windows: { icon } } })` script*:
  same effect, but moves a one-line command into a new file and duplicates the
  `--minify` and target options away from `build:linux`. No second use case justifies it
  (Constitution I). Rejected.

## R2 - Where the build can run

**Finding**: Bun refuses the flag unless it is running on Windows. Tested on this WSL
machine:

```text
$ bun build --compile --target=bun-windows-x64 --windows-icon=icon.ico hello.ts --outfile icon.exe
error: Using --windows-icon is only available when compiling on Windows
(exit code 1)
```

The same error, with exit code 1, appears when the icon path is missing or the file is
not an icon, because the platform check comes first.

**Decision**: Accept it. The README already says each binary must be built on its own
platform, and CI already builds the Windows binary on `windows-latest`. The only change is
that `bun run build:win` on Linux or macOS now stops with Bun's clear message instead of
producing a binary the README already says must not be released. The README's building
section says so (FR-009).

**Alternatives considered**: *Keep cross-compilation working by adding the icon only in
CI*: two build commands for one target, and a local build that silently differs from the
release. Violates FR-004 and DRY. Rejected.

## R3 - Proving the icon is in the binary (FR-006, SC-005)

**Finding**: It is not possible to check locally what Bun on Windows does with a missing or
invalid icon path, since the platform check hides it (R2). The docs do not promise a
failure. A build that "succeeds" with the default icon is exactly the silent failure
FR-006 forbids, so the build cannot rely on Bun alone.

**Decision**: A small verifier, `tools/build/verify-windows-icon.ts <exe> <ico>`, runs
right after the compile inside the same `build:win` script (`bun build ... && bun run
tools/build/verify-windows-icon.ts ...`). It:

1. reads the `.ico` directory (header, then one 16-byte entry per image) and validates it
   (see [data-model.md](data-model.md));
2. checks that each image's bytes appear verbatim in the executable;
3. exits 0 when every image is present, and otherwise exits 1 with a message that names
   the icon file and lists the missing sizes.

**Why a byte search and not a PE resource parser**: when an icon is embedded, Windows
stores each `.ico` image unchanged as its own `RT_ICON` resource. Only the directory is
rewritten (into an `RT_GROUP_ICON`). So "all ten images are present byte for byte" is the
exact property that matters, and it needs about twenty lines instead of a PE and
resource-tree parser. A false positive would need a 600+ byte PNG to appear in the binary
by chance, which is not credible. The check also fails correctly against Bun's default
icon, since the images differ.

**Alternatives considered**:
- *Parse the PE resource directory and compare the `RT_GROUP_ICON` entries*: more precise
  about structure, but several times the code for no extra guarantee. Rejected
  (Constitution I).
- *PowerShell `System.Drawing.Icon.ExtractAssociatedIcon` in a CI step*: returns one
  re-rendered bitmap, so it can only be compared loosely. It also only works on Windows,
  so it cannot be unit tested here. Rejected.
- *Rely on the smoke test*: `--self-test` proves the binary runs, not how it looks.
  Rejected as the only check, but kept for FR-007 (R5).

## R4 - Testing under the constitution's TDD rule

**Decision**: The verifier's logic is two pure functions in
`tools/build/verify-windows-icon.ts`, written test-first in
`tests/unit/windows-icon.test.ts`:

- `readIcoImages(bytes)`: parses and validates an `.ico`. Tests use synthetic buffers
  (valid, wrong type, zero images, entry past the end of the file) and the real
  `assets/icon.ico` (ten images, sizes 16 to 256, all 32-bit).
- `findMissingImages(exe, images)`: tests use a synthetic "executable" of filler bytes
  with none, some, or all of the images spliced in.

`verify(argv)` returns the exit code and message, so every contract row is tested
without a subprocess. Two more tests run the script as a real process, to prove the entry
block sends the message to the right stream and exits with that code. CI and `&&` depend
on that exit code.

A further test reads `package.json` and asserts that `build:win` passes
`--windows-icon=assets/icon.ico` and then runs the verifier on its output. It is small,
but without it someone can delete the flag and only a Windows CI run would notice.

All three run on Linux and in both CI jobs. The end-to-end proof (a real Windows build
with the icon) is the verifier running inside `build:win` on the Windows runner, which
fails the job if the icon is missing.

## R5 - Does embedding the icon change the binary's behaviour? (FR-007)

**Decision**: No new check needed. The existing CI step `Smoke-test the binary` runs
`dist/volby-kv2026.exe --self-test` after the build. It opens a real database and renders
a real frame, so a resource edit that damaged the bundled program would fail it. The
`--version` output comes from `package.json` and is untouched.

## R6 - The icon asset

**Finding**: `02-terminal.ico` is 31,573 bytes: a valid ICO (`reserved 0, type 1`) with ten
32-bit PNG-compressed images of 16, 20, 24, 32, 40, 48, 64, 96, 128 and 256 pixels square.
PNG images inside icons are supported by every Windows version this binary runs on
(Windows 10 and later).

**Decision**: Commit it unchanged as `assets/icon.ico`. It is the only icon, so a generic
name inside a new `assets/` directory is clearer than a numbered download name. At 31 KB
it needs no Git LFS.

## R7 - CI workflow changes

**Decision**: None. The Windows matrix job already runs `bun run build:win` (now with the
icon and the verifier), then the smoke test, then uploads the artefact. The release job
copies that same artefact. The icon therefore reaches releases (US2) with no workflow
edit.
