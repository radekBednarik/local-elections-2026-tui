# Quickstart: Validating the Windows Executable Icon

**Feature**: [spec.md](spec.md) | **Contract**: [contracts/build-windows.md](contracts/build-windows.md)

## 1. Any platform: unit tests and static checks

```bash
bun test tests/unit/windows-icon.test.ts   # icon parsing, byte search, build script wiring
bun test                                   # full suite still green (SC-004)
bun run check && bun run typecheck
```

Expected: all pass. The icon test reports ten images from 16x16 to 256x256.

## 2. Linux or macOS: the Windows build refuses clearly

```bash
bun run build:win
```

Expected: exit 1 with `error: Using --windows-icon is only available when compiling on
Windows`. No `.exe` is written. `bun run build:linux` still works as before (FR-008).

## 3. Windows: build, verify, smoke test

In PowerShell, from the repository root:

```powershell
bun install --frozen-lockfile
bun run build:win
dist\volby-kv2026.exe --version
dist\volby-kv2026.exe --self-test
```

Expected:
- `build:win` ends with `Icon assets/icon.ico is embedded in dist/volby-kv2026.exe (10 images).`
- `--version` prints the same version as before the change.
- `--self-test` passes (FR-007).

## 4. Windows: the build fails without the icon (SC-005)

```powershell
Rename-Item assets\icon.ico icon.ico.bak
bun run build:win; echo "exit $LASTEXITCODE"
Rename-Item assets\icon.ico.bak icon.ico
```

Expected: non-zero exit, and a message naming `assets/icon.ico`. Restore the file
afterwards.

## 5. Windows: what the user sees (US1, SC-002)

1. Open `dist\` in File Explorer. Switch through Details, List, Small, Medium, Large and
   Extra large icons. Each view shows the terminal icon, sharp and not Bun's.
2. Right-click the file, open Properties. The icon is shown in the header.
3. Right-click, *Show more options*, *Send to*, *Desktop (create shortcut)*. The shortcut
   shows the icon.
4. Repeat step 1 with display scaling at 150 %.

If an old build was replaced in the same folder and the old icon still shows, that is
Windows' icon cache (spec Edge Cases). Copy the file to a new folder to check.

## 6. CI and release (US2)

Push the branch. In the `windows-x64` job, the *Build* step log ends with the verifier's
success line and *Smoke-test the binary* passes. Download the `volby-kv2026-windows-x64`
artefact and repeat step 5 on it. On the next `v*` tag, the release asset
`volby-kv2026-windows-x64.exe` is that same artefact.
