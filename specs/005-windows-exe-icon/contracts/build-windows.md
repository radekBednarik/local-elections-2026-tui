# Contract: Windows Build Command and Icon Verifier

**Feature**: [../spec.md](../spec.md) | **Plan**: [../plan.md](../plan.md)

This project's outside interfaces are its command lines. This feature changes one
(`bun run build:win`) and adds one (the verifier). The application's own command line
(`volby-kv2026.exe`, including `--version` and `--self-test`) does not change (FR-007).

## `bun run build:win`

| | |
| - | - |
| Runs on | Windows only (research R2) |
| Inputs | `src/main.ts` and its imports, `assets/icon.ico` |
| Output | `dist/volby-kv2026.exe`, carrying the icon |
| Steps | 1. compile with `--windows-icon=assets/icon.ico`; 2. run the verifier on the output |

Exit status:

| Situation | Exit | What the user sees |
| --------- | ---- | ------------------ |
| Compiled and every icon image found in the output | 0 | Bun's compile line, then the verifier's success line |
| Run on Linux or macOS | 1 | `error: Using --windows-icon is only available when compiling on Windows` (from Bun) |
| Compile fails for any reason, including a rejected icon | non-zero | Bun's error. The verifier does not run |
| Compile succeeds but images are missing from the output | 1 | the verifier's failure message (below) |
| `assets/icon.ico` missing or not a valid icon | non-zero | Bun's error, or the verifier's if Bun lets the compile through. The verifier's message names the icon. What Bun on Windows prints here cannot be observed from Linux (research R2, R3), and tasks T019 records it. If Bun fails with a message that does not name the icon, FR-006 is not met, and the plan must add an up-front icon check before the compile |

`build:linux` is unchanged (FR-008).

## `bun run tools/build/verify-windows-icon.ts <exe> <ico>`

Checks that the icon `<ico>` is embedded in the Windows executable `<exe>`. It reads both
files and writes nothing.

| Situation | Exit | Output |
| --------- | ---- | ------ |
| All images present | 0 | stdout: `Icon assets/icon.ico is embedded in dist/volby-kv2026.exe (10 images).` |
| Some or all images missing | 1 | stderr: `Icon assets/icon.ico is not embedded in dist/volby-kv2026.exe. Missing images: 16x16, 32x32, ...` |
| `<ico>` unreadable or invalid | 1 | stderr: `Icon assets/icon.ico is not a valid .ico file: <reason>` |
| `<exe>` unreadable | 1 | stderr: `Cannot read executable dist/volby-kv2026.exe: <reason>` |
| Wrong number of arguments | 1 | stderr: `Usage: verify-windows-icon.ts <exe> <ico>` |

The paths in the messages are the ones given on the command line. Every failure message
names the icon or the executable, so the cause is clear from the CI log (FR-006).
