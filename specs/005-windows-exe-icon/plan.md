# Implementation Plan: Custom Icon for the Windows Executable

**Branch**: `005-windows-exe-icon` | **Date**: 2026-09-25 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/005-windows-exe-icon/spec.md`

## Summary

The Windows binary shows Bun's default icon. This feature gives it the project's terminal
icon everywhere Windows reads an icon from the file, in local builds and in releases.

The approach uses what Bun and CI already provide:
- **Embed:** commit the icon as `assets/icon.ico` and add Bun's own
  `--windows-icon=assets/icon.ico` flag to `build:win` (R1, R6).
- **Verify:** `build:win` then runs a small verifier that checks every image of the `.ico`
  appears byte for byte in the `.exe`, and fails the build otherwise. Bun's behaviour on a
  bad icon cannot be tested locally, so FR-006 does not rely on it (R3).
- **CI:** no workflow change. The Windows job already runs `build:win` on
  `windows-latest`, then the `--self-test` smoke test, and the release job ships that
  artefact (R5, R7).
- **Limit:** Bun only accepts the flag on Windows, so `build:win` now fails on Linux with
  Bun's own message. The README already forbids releasing cross-compiled binaries (R2).

## Technical Context

**Language/Version**: TypeScript 5 on Bun 1.4.2 (pinned in CI)

**Primary Dependencies**: Bun's built-in `bun build --compile` and its `--windows-icon`
flag. No new dependencies.

**Storage**: N/A. One committed binary asset, `assets/icon.ico` (31,573 bytes).

**Testing**: `bun test`. Unit tests for the verifier's pure functions and the build
script wiring. The end-to-end check runs on the CI Windows runner.

**Target Platform**: Windows 10+ x64 for the icon. Linux x64 build unchanged.

**Project Type**: CLI / terminal UI application, shipped as single-file executables.

**Performance Goals**: The verifier adds under 1 second to the Windows build (ten byte
searches over a ~90 MB file).

**Constraints**: The icon can only be embedded when building on Windows (R2). Failures
must stop the build, not produce a binary with the default icon (FR-006).

**Scale/Scope**: One asset, one new tool file of about 60 lines, one test file, a
one-line `package.json` change, and a README paragraph.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Status |
| --------- | ----- | ------ |
| I. KISS | Uses Bun's built-in flag rather than a resource editor or a build script (R1). The verifier searches bytes rather than parsing PE resources (R3). No config layer: the icon path is a literal in one script. | Pass |
| I. DRY | The icon file exists once. Its path appears only in the `build:win` script, which passes it to both the compiler and the verifier. Local and CI builds use the same command (FR-004, FR-005). | Pass |
| II. TDD | The verifier's parsing and search functions, its command-line entry point (exit code and output stream, tested as a real process) and the script wiring are written test-first and run on any platform (R4). | Pass, with a note |
| III. Review | A code review follows implementation, as for every task. | Pass |
| Quality: deterministic tests | Tests use synthetic buffers and the committed asset. No network, no compilation, no platform checks. | Pass |

**Note on Principle II**: The embedding itself is Bun's code, triggered by a flag. The
only thing that can observe it is a Windows build, which cannot run on the Linux dev
machine. The verifier is the test for it, and it runs as part of `build:win` on the
Windows CI runner on every push. This is not a deviation from the principle, but the
review should confirm that the first Windows CI run shows the verifier passing.

**Post-design re-check**: The Phase 1 artefacts add no abstractions beyond the two
functions and the CLI in the contract. All gates still pass.

## Project Structure

### Documentation (this feature)

```text
specs/005-windows-exe-icon/
├── plan.md                    # This file
├── research.md                # Phase 0: R1-R7
├── data-model.md              # Phase 1: the .ico layout and validation rules
├── quickstart.md              # Phase 1: validation on Linux, Windows and CI
├── contracts/
│   └── build-windows.md       # Phase 1: build:win and verifier command lines
├── checklists/
│   └── requirements.md        # From /speckit-specify
└── tasks.md                   # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
assets/
└── icon.ico                          # NEW: copied unchanged from 02-terminal.ico

tools/
└── build/
    └── verify-windows-icon.ts        # NEW: readIcoImages, findMissingImages, CLI entry

tests/
└── unit/
    └── windows-icon.test.ts          # NEW: verifier functions + build:win wiring

package.json                          # build:win gains --windows-icon and the verifier
README.md                             # Building section: icon location, Windows-only
.github/workflows/build.yml           # unchanged
```

**Structure Decision**: Single project, following existing conventions. Build-time
tooling lives under `tools/`, next to `tools/mirror/` and `tools/replay/`. It is a new
`tools/build/` folder rather than `tools/verify/`, which holds the one-off verification
scripts of feature 001. Tests go in `tests/unit/`. `tsconfig.json` and `biome.json`
already include `tools/**/*.ts`, so the new file is linted and type-checked with no
config change. `assets/` is new; it is the conventional home for a non-code build input.

## Complexity Tracking

No constitution violations. Nothing to justify.
