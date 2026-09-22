# Contract: Export formats

**Feature**: `001-election-results-tui` | **Direction**: outbound. Files the application writes for the
user (FR-049 to FR-053).

These files leave the application and are opened by other software, so their format is a contract.

---

## Tabular export (FR-049)

Triggered by `e` from any result view. Writes the **currently displayed table** – same rows, same columns,
same order, including any sort the user applied (FR-037).

### Encoding – the part most likely to go wrong

| Property | Value | Why |
|---|---|---|
| Character encoding | UTF-8 **with BOM** | Without the BOM, Excel on a Czech Windows system decodes using the system code page and corrupts every accented character. This is the most likely way FR-053 fails |
| Delimiter | Semicolon `;` | Excel under a Czech locale splits on `;`. A comma-delimited file lands entirely in column A |
| Decimal separator | Comma `,` | Czech convention, consistent with the delimiter choice |
| Line ending | CRLF | Widest spreadsheet compatibility |
| Quoting | Fields containing `;`, `"`, CR or LF are wrapped in `"`; embedded `"` doubled | RFC 4180 |

Party names reach 2000 characters and coalition names routinely contain punctuation, so quoting is
exercised in normal use, not just edge cases.

### Structure

A provenance header precedes the table, satisfying FR-050 and SC-017 – no exported figure may be
untraceable:

```text
# Volby do zastupitelstev obcí 2026
# Oblast: <area name and code>
# Data zveřejněna: <publisher timestamp, ISO 8601>
# Stav: <předběžné | konečné>
# Exportováno: <local timestamp, ISO 8601>

<column headers>
<rows>
```

Comment lines begin with `#`. Spreadsheet software imports them as text rows, which is acceptable and
keeps provenance attached to the data rather than in a separate file.

**Figures are written exactly as stored** – no recomputation, no rounding (FR-029).

---

## Summary report (FR-051)

Triggered by `E` for a selected council or district. Plain UTF-8 text, readable as written, no spreadsheet
required. Line width 80 so it survives pasting into mail and chat.

Contents:

1. Area name, code, and council type
2. Publication timestamp and provisional/final status
3. Turnout and count progress
4. Seats by electoral party, ordered by seats then votes
5. Elected candidates with their ballot position and personal votes

A district report omits section 5, which exists only per council.

---

## Writing behaviour

| Rule | Requirement |
|---|---|
| The user chooses the destination path | FR-049 |
| Writing must not block the interface | FR-052, SC-010 |
| A failure – unwritable path, permission, no space – is reported with its reason and the application keeps running | FR-052, FR-046 |
| An existing file is never overwritten without confirmation | Not spec-mandated; a data-loss guard |
| Write to a temporary file then rename | Prevents a half-written export if the process is interrupted |

## Out of scope

No PDF, XLSX, or JSON export; no automatic upload or sharing; no scheduled or unattended export. Export is
always an explicit user action against what is currently on screen.
