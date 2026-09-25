---

description: "Task list for the custom Windows executable icon"
---

# Tasks: Custom Icon for the Windows Executable

**Input**: Design documents from `specs/005-windows-exe-icon/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/build-windows.md](contracts/build-windows.md),
[quickstart.md](quickstart.md)

**Tests**: REQUIRED. The constitution makes TDD non-negotiable (Principle II):
- Every implementation task comes after a test task.
- That test must be seen FAILING before the implementation is written.
- Tests build `.ico` and "executable" buffers in memory, or write them into a directory
  from `withTempDataDir` (`tests/helpers/tmpdir.ts`). No test compiles a binary or depends
  on the platform.

**Review**: every task ends with a review against:
- Principles I and II,
- [contracts/build-windows.md](contracts/build-windows.md) (Principle III).

The REVIEW tasks at the end of each phase make this visible. A task is complete only
when its review has no open findings.

**Windows-only steps**: Bun embeds an icon only when it runs on Windows (research R2), and
the dev machine is WSL with no Windows Bun. Tasks marked **(Windows)** run on the CI
`windows-x64` job or on a Windows machine. Pushing the branch is an outward-facing
action, so ask the user before doing it.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2)
- Include exact file paths in descriptions

---

## Phase 1: Setup

- [X] T001 Record the baseline: run `bun test`, `bun run typecheck` and `bun run check`. Write the pass/fail and file counts in this task's notes. Every later phase is compared to this.
  - (Done 2026-09-25. `bun test`: 998 pass, 0 fail across 52 files. Typecheck clean. Biome clean, 135 files.)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The `.ico` reader. US1 uses it to pin the committed asset (FR-002). US2 uses
it to verify the build (FR-006).

### Tests (write first, observe failing)

- [X] T002 Create `tests/unit/windows-icon.test.ts` with a `describe("readIcoImages")` block. Import `readIcoImages` from `../../tools/build/verify-windows-icon.ts`. Add a small in-file helper `makeIco(images)` that builds a valid `.ico` buffer (6-byte header, then 16-byte entries, then the image bytes; little-endian) from `{ width, height, bitsPerPixel, data }` values. Tests, each named for the behaviour:
  - a two-image `.ico` returns both images in directory order, with `width`, `height`, `bitsPerPixel` and the exact `data` bytes;
  - a width or height byte of `0` is read as 256;
  - it throws when `reserved` is not 0;
  - it throws when `type` is not 1 (use 2, a cursor);
  - it throws when `count` is 0;
  - it throws when the directory is cut short (header says 2 entries, file ends after 1);
  - it throws when an entry's `offset + size` is past the end of the file;
  - it throws when an entry's `size` is 0;
  - a buffer shorter than 6 bytes throws.

  Data-model rules, verbatim: "`reserved` = 0, `type` = 1 (icon, not cursor), `count` >= 1", "the whole directory fits in the file", "`size` > 0, and `offset + size` <= file length". Every thrown `Error` message states what is wrong (for example `type is 2, expected 1`). Run it and observe it fail: the module does not exist.

### Implementation

- [X] T003 Create `tools/build/verify-windows-icon.ts` with a file doc comment in the style of `tools/mirror/build.ts`: what it checks, why a byte search is enough (research R3), and usage. Export:
  - `interface IcoImage { width: number; height: number; bitsPerPixel: number; data: Uint8Array }`;
  - `readIcoImages(bytes: Uint8Array): IcoImage[]`, which parses and validates per [data-model.md](data-model.md) with a `DataView`. `data` is a `subarray`, not a copy.

  Make T002 pass and no more.
- [X] T004 REVIEW Phase 2: Principles I and II, and the validation rules against the data model. Fix every finding, then run `bun test tests/unit/windows-icon.test.ts`, `bun run typecheck` and `bun run check`.
  - (Done 2026-09-25. T002 was seen failing first: the module did not exist. After T003, 9 pass. Every data-model rule has a test. The `DataView` honours `byteOffset`, so a sliced buffer parses correctly. No findings. Biome only rewrapped one object literal.)

**Checkpoint**: `readIcoImages` works on synthetic input.

---

## Phase 3: User Story 1 - Recognise the application by its own icon (Priority: P1) 🎯 MVP

**Goal**: `bun run build:win` produces `dist/volby-kv2026.exe` with the terminal icon.

**Independent Test**: build on Windows and look at the file in File Explorer, the
Properties dialog and a shortcut (quickstart § 3 and § 5).

### Tests (write first, observe failing)

- [X] T005 [US1] In `tests/unit/windows-icon.test.ts`, add `describe("the committed icon")`. Read `assets/icon.ico` (resolve from `import.meta.dir`, so the working directory does not matter). Assert that `readIcoImages` returns exactly ten images, with `[width, height]` of `[16,16] [20,20] [24,24] [32,32] [40,40] [48,48] [64,64] [96,96] [128,128] [256,256]` in that order, all with `bitsPerPixel` 32 (FR-002, research R6). Observe it fail: the file does not exist.
  - (Done 2026-09-25. Seen failing first: `ENOENT` on `assets/icon.ico`. Passes after T007.)
- [X] T006 [P] [US1] In `tests/unit/windows-icon.test.ts`, add `describe("build scripts")`. Read `package.json` from the repository root. Assert that:
  - the `build:win` script contains `--windows-icon=assets/icon.ico`, `--target=bun-windows-x64` and `--outfile dist/volby-kv2026.exe` (FR-001, FR-004);
  - the `build:linux` script contains no `--windows-` flag (FR-008).
  - (Done 2026-09-25. The `build:win` test was seen failing on `--windows-icon`. The `build:linux` test passed at once, as intended: it guards a script this feature must not change.)

  Observe the first assertion fail.

### Implementation

- [X] T007 [US1] First ask the user where `02-terminal.ico` comes from and under what licence (spec Assumptions). If they made it or it is free to ship under MIT, record that in the notes. If it needs attribution, add an `assets/README.md` with the source, author and licence, and link it from `README.md` `## Licence and disclaimer`. If it cannot be shipped, stop and tell the user. Then create `assets/` and copy the icon in unchanged: `cp /mnt/c/Users/bedna/Downloads/02-terminal.ico assets/icon.ico`. Check that the `sha256sum` of both files is the same and the size is 31,573 bytes. T005 passes.
  - (Done 2026-09-25. The user confirmed they made the icon, so it ships under the project's MIT licence and needs no attribution file. Copied unchanged: both files have sha256 `8abced35...a416c43f` and are 31,573 bytes. Set to mode 644, since files copied from `/mnt/c` arrive executable.)
- [X] T008 [US1] In `package.json`, add `--windows-icon=assets/icon.ico` to `build:win`, straight after `--minify`. Leave `build:linux` alone. T006 passes.
  - (Done 2026-09-25. T006 passes.)
- [X] T009 [US1] Run quickstart § 2 on the WSL machine. `bun run build:win` must exit 1 with `error: Using --windows-icon is only available when compiling on Windows`, and must write no `dist/volby-kv2026.exe`. Delete any older copy first, so a stale file cannot pass the check. `bun run build:linux` must still produce `dist/volby-kv2026`, and `dist/volby-kv2026 --self-test` must pass. Record both in the notes.
  - (Done 2026-09-25. `bun run build:win` exited 1 with `error: Using --windows-icon is only available when compiling on Windows`, and no `.exe` was written. The old one had been deleted first. `bun run build:linux` compiled, and `dist/volby-kv2026 --self-test` passed 2 of 2.)
- [X] T010 [US1] REVIEW Phase 3: Principles I and II, FR-001 to FR-004 and FR-008. Fix every finding, then run the full `bun test`, `bun run typecheck` and `bun run check`, and compare with T001.
  - (Done 2026-09-25. 1010 pass, 0 fail across 53 files: the baseline's 998 plus 12 new. Typecheck clean. Biome clean, 137 files. No findings: the icon path is written once, in `build:win`. The tests read `package.json` rather than repeating it, and `build:linux` is untouched.)

**Checkpoint**: the build embeds the icon. It is not yet verified, so a build that silently
loses the icon would still pass (US2 closes this).

---

## Phase 4: User Story 2 - Every official release carries the icon (Priority: P2)

**Goal**: the Windows build fails, and names the icon, whenever the output lacks it. CI and
releases then carry the icon with no workflow change (research R7).

**Independent Test**: the CI `windows-x64` job's Build log ends with the verifier's
success line, and a Windows build with the icon removed fails (quickstart § 4 and § 6).

### Tests (write first, observe failing)

- [X] T011 [US2] In `tests/unit/windows-icon.test.ts`, add `describe("findMissingImages")`. Use a synthetic "executable": 64 KiB of a filler byte, with image `data` (distinct byte patterns of at least 32 bytes each, not made of the filler) spliced in at chosen offsets. Tests:
  - all images spliced in: it returns `[]`;
  - none spliced in: it returns every image;
  - two of three spliced in: it returns just the third;
  - an image straddling the very end of the buffer is found;
  - an empty image list returns `[]`.

  Import `findMissingImages` and observe it fail.
  - (Done 2026-09-25. Seen failing first: `findMissingImages` was not exported.)
- [X] T012 [US2] In the same file, add `describe("verify command")` for an exported `verify(argv: string[]): { code: 0 | 1; message: string }`, the whole command minus the printing. Use `withTempDataDir` to write an `.ico` (from `makeIco`) and an "exe" (filler, with or without the images). Assert each row of the contract's verifier table, with `code` and exact `message`:
  - all present: `0`, `Icon <ico> is embedded in <exe> (N images).`
  - some missing: `1`, `Icon <ico> is not embedded in <exe>. Missing images: 16x16, 32x32` (listed in directory order, joined with `, `);
  - the `.ico` is missing or invalid: `1`, starting `Icon <ico> is not a valid .ico file: ` and then the reason;
  - the exe is missing: `1`, starting `Cannot read executable <exe>: `;
  - zero, one or three arguments: `1`, `Usage: verify-windows-icon.ts <exe> <ico>`.

  `<exe>` and `<ico>` are the paths exactly as passed in.

  Then add `describe("verify command as a process")`. It covers the entry block, which sets the exit code that `&&` in `build:win` and CI depend on (Principle II). Run the script with `Bun.spawnSync([process.execPath, "tools/build/verify-windows-icon.ts", exe, ico], { cwd: <repository root> })` on the same temporary files:
  - all present: exit code 0, the success message on stdout, stderr empty;
  - some missing: exit code 1, the failure message on stderr, stdout empty.

  Two cases are enough: every other message comes from `verify()`, which the cases above already cover. Observe all of it fail.
  - (Done 2026-09-25. Seen failing first, with the same missing export. It covers six `verify()` cases plus the two process cases. The "not an icon" case pins the full reason: `reserved is 28526, expected 0`, which is the bytes `no` read as little-endian.)
- [X] T013 [P] [US2] In `describe("build scripts")`, assert that `build:win`, after the compile, runs `&& bun run tools/build/verify-windows-icon.ts dist/volby-kv2026.exe assets/icon.ico`. That is the same output path and the same icon path the compile uses. Check this by pulling both paths out of the compile half of the script, not by repeating the literals, so the test fails if the two halves drift apart (DRY). Observe it fail.

### Implementation

  - (Done 2026-09-25. Seen failing after T014 and T015 had turned the rest green, as expected, since `build:win` had no `&&` part yet. The test also asserts there is no third `&&` part.)
- [X] T014 [US2] In `tools/build/verify-windows-icon.ts`, implement `findMissingImages(exe: Uint8Array, images: IcoImage[]): IcoImage[]` with `Buffer.from(exe.buffer, exe.byteOffset, exe.byteLength).indexOf(image.data)`, so no copy is made. T011 passes.
  - (Done 2026-09-25. T011 passes.)
- [X] T015 [US2] In the same file, implement `verify(argv)` per the contract. Read with `readFileSync`, and turn read and parse errors into the contract messages (use `error.message` for the reason). Add the entry point: `if (import.meta.main) { const r = verify(Bun.argv.slice(2)); (r.code === 0 ? console.log : console.error)(r.message); process.exit(r.code) }`. T012 passes, including the two process cases.
  - (Done 2026-09-25. T012 passes, including both process cases. The `.ico` is read before the `.exe`, so a missing icon always produces the message that names the icon.)
- [X] T016 [US2] In `package.json`, append `&& bun run tools/build/verify-windows-icon.ts dist/volby-kv2026.exe assets/icon.ico` to `build:win`. T013 passes. Also run the verifier by hand on the WSL machine to see the failure path end to end: cross-compile a throwaway Windows exe with no icon into the scratchpad, using the old `build:win` command without the flag, and run the verifier against it. It must exit 1, list all ten sizes as missing, and name `assets/icon.ico`. Record the output.
  - (Done 2026-09-25. T013 passes. The app itself cannot be cross-compiled for Windows on Linux: OpenTUI's Windows native package is not installed, which is the README's build-on-its-own-platform rule. So the hand check used a Bun Windows binary compiled from a one-line script during research. The icon resource comes from Bun's Windows runtime, not the app, so it carries the same default Bun icon.
    - `plain.exe` (86,087,168 bytes, Bun's icon): exit 1, `Icon assets/icon.ico is not embedded in .../plain.exe. Missing images: 16x16, 20x20, 24x24, 32x32, 40x40, 48x48, 64x64, 96x96, 128x128, 256x256`. It took 79 ms, far inside the plan's 1-second goal (analysis A1).
    - The same binary with `assets/icon.ico` appended: exit 0, `... is embedded ... (10 images).`
    - A missing path: exit 1, `Cannot read executable ...: ENOENT ...`.)
- [X] T017 [US2] REVIEW Phase 4: Principles I and II, FR-005 to FR-007, and every row of the contract tables. Fix every finding, then run the full suite, `bun run typecheck` and `bun run check`.
  - (Done 2026-09-25. Full suite: 1024 pass, 0 fail across 53 files. Biome clean. The review found and fixed:
    - **Typecheck error:** a test's `[images[2]]` is `IcoImage | undefined` under `noUncheckedIndexedAccess`. It is now `images.slice(2)`.
    - **Clarity:** the entry block's `;(cond ? console.log : console.error)(msg)` needed a leading semicolon under the repo's no-semicolon style. It is now a plain `if`/`else`, and both process tests still pass.

    Accepted, not changed:
    - `(error as Error).message`: `readFileSync` and `readIcoImages` only throw `Error`s.
    - `(1 images)` in the one-image process test: the contract fixes the wording, and the real icon has 10.
    - `&&` in `build:win` on Windows: `bun run` executes scripts with Bun's own shell there, which supports `&&`. T018 confirms this.

    Contract rows: every verifier row has a test. The `build:win` rows for Linux (T009) and for missing images (T016, by hand) have been seen. The Windows success row waits for T018.)
- [ ] T018 [US2] **(Windows)** With the user's approval, push the branch and check the `build` workflow:
  - in the `windows-x64` job, the *Build* step ends with `Icon assets/icon.ico is embedded in dist/volby-kv2026.exe (10 images).` and *Smoke-test the binary* passes (FR-005, FR-007);
  - the `linux-x64` job is green (FR-008).

  Download the `volby-kv2026-windows-x64` artefact with `gh run download`, then run the verifier on it from WSL. It should report embedded. Run the downloaded `volby-kv2026.exe --version` from WSL (interop runs Windows executables). It must print the `version` in `package.json`, `0.2.0` unless it has been bumped (FR-007). Then ask the user to run quickstart § 5 on it in File Explorer, at 100 % and 150 % scaling (SC-001, SC-002), and record their answer.

  **If the verifier fails in CI** but the icon is there (download the artefact from the failed run if one was uploaded, or build it on Windows without the `&&` part, and look in Explorer): research R3's assumption that Bun stores each image unchanged is wrong. Stop. Do not relax the check or remove it from `build:win`. Record what Explorer shows, then re-plan R3, for example by reading the `.exe`'s icon resources and comparing image dimensions and pixel data instead of raw bytes. Update research.md, the contract and the tests before changing the code.
- [ ] T019 [US2] **(Windows)** Ask the user to run quickstart § 4 on a Windows machine with Bun 1.4.2: rename `assets/icon.ico` away, run `bun run build:win`, and check the exit code is non-zero and the message names the icon (FR-006, SC-005). Record which layer stopped the build: Bun, or the verifier. That answers research R3's open question. If no Windows machine is available, record that SC-005 rests on T012, T013 and T016, and leave the task open with that note.

**Checkpoint**: both stories done. The next release's Windows asset carries the icon.

---

## Phase 5: Polish & Cross-Cutting Concerns

- [X] T020 [P] Update `README.md` `### Building` (FR-009). Keep the existing paragraph and add:
  - the Windows binary carries the icon in `assets/icon.ico`, and replacing that file changes it (the unit test pins its ten sizes, so update the test with it);
  - `build:win` checks the icon is embedded and fails if it is not;
  - `build:win` now only runs on Windows, where it used to cross-compile. Quote Bun's error so a Linux user recognises it.
  - (Done 2026-09-25. Added two paragraphs under `### Building`: where the icon lives and Bun's Linux error, quoted; then the check, how to change the icon, and the test that pins its sizes. The existing paragraph is kept.)
- [ ] T021 FINAL REVIEW of the whole branch against Principles I to III, FR-001 to FR-009 and SC-001 to SC-005. Every FR must trace to a test or a recorded check in this file (FR-001/002/004: T005, T006; FR-003: T005, T007; FR-005: T018; FR-006: T012, T013, T016, T019; FR-007: T018; FR-008: T006, T009; FR-009: T020). Check that nothing leftover remains (no scratch exes in the repo, `dist/` still ignored). Run `bun test`, `bun run typecheck` and `bun run check`, and record the counts against T001. Fix every finding.
  - (In progress 2026-09-25. **Local part done.** An independent reviewer read the whole diff and ran the tests, typecheck and lint. There were no findings at or above its confidence threshold. It confirmed:
    - every contract row, including stdout for success and stderr for every failure;
    - `&&` under Bun's script shell on Windows;
    - the README's quoted error, by running the command.

    Two below-threshold points were taken:
    - Every fixture was square, so a width/height swap in `readIcoImages` would go unnoticed. One fixture is now 48x24. A deliberate swap of the two reads turned that test red, and it went green again once restored.
    - The process tests duplicated their file setup. They now reuse `withFiles`, which is hoisted to module level, and the odd `(1 images)` is gone.

    Two points were accepted: `toStartWith` on the OS error text, which varies by platform, and `bitsPerPixel` being used only by the asset test, which FR-002 needs. Result: 1024 pass, 0 fail across 53 files. Typecheck clean. Biome clean, 137 files. **Waiting on** T018 and T019, then the requirement trace.)

---

## Dependencies & Execution Order

### Phase dependencies

| Phase | Depends on | Notes |
|---|---|---|
| 1 Setup | none | |
| 2 Foundational | Phase 1 | `readIcoImages` is used by both stories |
| 3 US1 | Phase 2 | |
| 4 US2 | Phase 2; T008 | T016 appends to the script T008 changed |
| 5 Polish | Phases 3 and 4 | T020 can start once T016 is done |

### Task dependencies within stories

- **Phase 2:** T002, then T003, then T004.
- **US1:** T005 and T006 first (either order), then T007 and T008, then T009, then T010.
- **US2:**
  - T011 and T012 come first, then T014 (T011 passes), then T015 (T012 passes).
  - T013 can be written any time after T008. T016 makes it pass and needs T015.
  - T018 needs T016 and T017.
  - T019 needs T016 and can run beside T018.

### Shared files (not parallel across these tasks)

| File | Tasks |
|---|---|
| `tests/unit/windows-icon.test.ts` | T002, T005, T006, T011, T012, T013 |
| `tools/build/verify-windows-icon.ts` | T003, T014, T015 |
| `package.json` | T008, T016 |
| `README.md` | T007 (only if the icon needs attribution), T020 |

The [P] marks on T006 and T013 mean they are independent of the tasks just before them,
not that they can be written at the same moment as another edit to the same test file.
They are separate `describe` blocks, so agents working in parallel must merge carefully.

## Parallel Examples

```text
# US1: the two tests are independent
T005  describe("the committed icon")   tests/unit/windows-icon.test.ts
T006  describe("build scripts")         tests/unit/windows-icon.test.ts

# Polish beside the Windows checks
T018 / T019 (waiting on CI and the user)   alongside   T020 README.md
```

## Implementation Strategy

### MVP (US1)

1. **Phase 1:** baseline.
2. **Phase 2:** the `.ico` reader.
3. **Phase 3:** asset, flag, Linux check.

**Stop and validate**: the first Windows CI run after Phase 3 already produces an artefact
with the icon, which quickstart § 5 can check in File Explorer. It is unverified, so
releasing it alone would break FR-006. Do not tag a release before US2 is done.

### Incremental delivery

4. **Phase 4 (US2):** verifier, script wiring, CI and Windows checks.
5. **Phase 5:** README, final review.

## Notes

- **Red first:** every test task must be seen FAILING before its implementation task
  starts. If a test passes at once, record why in the task notes.
- **Commits:** one per task, or per test-then-implementation pair, in the repository's
  Conventional Commits style. Commit `assets/icon.ico` in the same commit as T007.
