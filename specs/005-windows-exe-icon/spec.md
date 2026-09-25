# Feature Specification: Custom Icon for the Windows Executable

**Feature Branch**: `005-windows-exe-icon`

**Created**: 2026-09-25

**Status**: Draft

**Input**: User description: "Currently the built Windows binary has no custom icon, just the default Bun one. I want you to implement feature, so that Windows built binary will have this custom icon /mnt/c/Users/bedna/Downloads/02-terminal.ico"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Recognise the application by its own icon (Priority: P1)

A Windows user downloads `volby-kv2026-windows-x64.exe` from a release, or builds it locally, and
opens the folder that contains it. Today the file shows the generic icon of the runtime it was
built with, so it looks like an anonymous tool and is indistinguishable from any other program
built the same way. After this feature, the file shows the project's own terminal icon, the one
supplied as `02-terminal.ico`, everywhere Windows draws a program's icon from the file itself.

**Why this priority**: This is the whole feature. A distinct icon is what makes the download
look like a deliberate, finished application rather than a leftover build artefact, and it lets
the user find it among other files at a glance.

**Independent Test**: Build the Windows executable, open its folder in File Explorer, and check
that the custom icon is shown instead of the runtime's default icon, at every Explorer view size.

**Acceptance Scenarios**:

1. **Given** a freshly built Windows executable, **When** the user views its folder in File
   Explorer in any view (details, list, small, medium, large and extra large icons), **Then** the
   file shows the custom terminal icon, drawn crisply at that size rather than scaled from a
   single small image.
2. **Given** the Windows executable, **When** the user opens the file's Properties dialog,
   **Then** the custom icon is shown in the dialog header.
3. **Given** the Windows executable, **When** the user creates a desktop or Start menu shortcut
   to it or pins it to the taskbar, **Then** the shortcut or pinned item shows the custom icon.
4. **Given** the Windows executable with the custom icon, **When** the user runs it, **Then** the
   application starts and behaves exactly as before: the interface renders, data loads, and
   `--version` and `--self-test` give the same results as a build without the icon.

---

### User Story 2 - Every official release carries the icon (Priority: P2)

The maintainer pushes a version tag and the automated build publishes the Windows binary to the
GitHub release. The published binary carries the custom icon without the maintainer doing
anything by hand, and a build that silently lost the icon cannot be released unnoticed.

**Why this priority**: Users get the application from releases, not from the maintainer's
machine. If only local builds carry the icon, User Story 1 never reaches them. It is second
only because it depends on User Story 1 working at all.

**Independent Test**: Run the automated build for the Windows target, download the produced
artefact, and inspect its icon on a Windows machine; separately, remove or break the icon input
and confirm the Windows build fails rather than producing an icon-less binary.

**Acceptance Scenarios**:

1. **Given** the automated build runs for the Windows target, **When** it finishes successfully,
   **Then** the uploaded Windows artefact carries the custom icon.
2. **Given** a version tag is pushed, **When** the release job publishes the binaries, **Then**
   the published `volby-kv2026-windows-x64.exe` carries the custom icon.
3. **Given** the icon file is missing from the repository or cannot be read, **When** the
   Windows build runs, **Then** the build fails with a message that names the icon as the
   cause, instead of producing a binary with the default icon.

---

### Edge Cases

- **Running inside a terminal host**: The application is a console program. When it runs inside
  Windows Terminal, the taskbar button and window title bar belong to the terminal host and show
  the host's icon, not the application's. This is expected Windows behaviour and not a defect of
  this feature (see Assumptions).
- **Stale icon cache**: Windows caches file icons. A user who replaces an old build with a new
  one in the same place may briefly still see the old icon until Explorer refreshes. This is not
  a defect; a fresh download to a new location shows the correct icon immediately.
- **High-DPI displays**: At display scaling above 100 % Explorer asks for larger images than the
  nominal view size. The icon supplies images from 16×16 up to 256×256, so each view has an
  appropriately sized image.
- **Linux binary**: The Linux build has no equivalent embedded icon. It MUST be unchanged by this
  feature and MUST still build and pass its smoke test.
- **Cross-compiling the Windows binary on another platform**: The project already requires each
  binary to be built on its own platform. If embedding the icon is only possible on Windows,
  that requirement stays as it is and is not relaxed by this feature.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Windows executable MUST embed the custom terminal icon as its application
  icon, so that Windows shows it in place of the runtime's default icon wherever it reads the
  icon from the file (File Explorer, the Properties dialog, shortcuts, pinned items, and the
  "Open with" list).
- **FR-002**: The embedded icon MUST include every image size contained in the supplied icon
  (16, 20, 24, 32, 40, 48, 64, 96, 128 and 256 pixels square), so that Windows picks a native
  image for each display size instead of scaling one.
- **FR-003**: The icon file MUST be stored in the repository, at a stable location, so that any
  checkout of the repository can produce the icon-bearing binary without files from outside it.
- **FR-004**: The standard Windows build command documented in the README MUST produce the
  icon-bearing binary with no extra manual step.
- **FR-005**: The automated build that produces release artefacts MUST produce the Windows binary
  with the icon, using the same build command as FR-004.
- **FR-006**: If the icon cannot be embedded (missing, unreadable or invalid icon file), the
  Windows build MUST fail and report the icon as the reason. It MUST NOT fall back to producing
  a binary with the default icon.
- **FR-007**: Embedding the icon MUST NOT change the application's behaviour: the existing smoke
  test of the compiled Windows binary MUST pass, and `--version` output MUST be unchanged.
- **FR-008**: The Linux build and its output MUST be unaffected by this feature.
- **FR-009**: The README's building section MUST state that the Windows binary carries the
  custom icon and where the icon file lives, so a maintainer knows what to replace to change it.

### Key Entities

- **Application icon**: The single icon image set that represents the application on Windows.
  It holds ten square images from 16 to 256 pixels at full colour with transparency. It has one
  authoritative copy in the repository, used by every Windows build.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100 % of Windows builds produced by the documented build command or by the
  automated build, File Explorer shows the custom icon rather than the runtime's default icon.
- **SC-002**: The custom icon is shown crisply in all six File Explorer view modes, at 100 % and
  at 150 % display scaling, with no view falling back to the default icon.
- **SC-003**: A user who downloads the Windows binary from the next release can identify it as
  this application by its icon alone, without reading the file name.
- **SC-004**: Zero behavioural regressions: every existing check (tests, lint, typecheck and the
  compiled binary's smoke test) passes on both platforms after the change.
- **SC-005**: A Windows build with the icon file removed fails instead of succeeding, in every
  attempt.

## Assumptions

- The supplied file `02-terminal.ico` is the final artwork. It has been checked and is a valid
  Windows icon containing ten 32-bit images from 16×16 to 256×256, so no redesign, resizing or
  conversion is needed.
- The user has the right to ship this icon in the project, which is released under the MIT
  licence. If the artwork is under a different licence, its attribution is added alongside it.
- "Custom icon" means the file's own application icon. The taskbar and title-bar icon of a
  running console program are owned by the terminal host it runs in (for example Windows
  Terminal) and are out of scope; where the host does show the program's own icon, it will be
  the custom one.
- Other Windows file metadata (product name, publisher, description, file version shown in the
  Properties "Details" tab) is out of scope for this feature and may be addressed separately.
- Code signing of the Windows binary is out of scope.
- The Windows binary continues to be built on Windows, as the project already requires; the
  automated build already runs the Windows target on a Windows runner.
- Checking that the icon is present in a built binary is done on the Windows build itself; a
  build step that inspects the binary is acceptable as the means of meeting FR-006 and SC-005.
