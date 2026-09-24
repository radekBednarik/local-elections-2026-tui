# Interface Contract: Logs View Instead of the Stale-Data Warning Line

**Feature**: `004-logs-view`

What changes in what the user sees and presses. Anything not listed here stays as it
is. The requests sent to the publisher do not change.

## 1. Status row (below the title bar)

| Condition | Text | Look |
|---|---|---|
| A notice from the last key press | the notice | `element` surface. Unchanged look; it now **wins** over the source status (research R3). |
| A source that loaded before is failing (stale) | `! ZASTARALÁ DATA: zobrazena data {age}. Obnovení se nedaří. · l záznamy` | `warning` surface, `warning` role |
| Only never-loaded sources are failing (awaiting) | `○ Výsledky zatím nejsou zveřejněny, aplikace je průběžně kontroluje. · l záznamy` | `element` surface, `muted` role |
| Nothing is failing, or the screen is `logs` / `log-entry` with no notice | (no row) | |

- The first matching row wins.
- `{age}` is `formatAge`'s output, e.g. `před 4 min`. With several stale sources, it
  is the age of the oldest data among them.
- The row never contains an error text, a parser or validation message, or a source
  code.
- Final sources are ignored, as in 003.

## 2. Title bar indicator

| Condition | Text | Look |
|---|---|---|
| Source status is stale | ` ● ZASTARALÉ ` | unchanged |
| Source status is awaiting | ` ○ čeká na výsledky ` | `muted` role |
| Every source on screen is final | ` ■ konečné · obnova ručně ` | unchanged |
| Otherwise | ` ● živě ` | unchanged |

The first matching row wins.

## 3. Logs list screen (`ZÁZNAMY`)

It opens with `l` from any screen except the logs screens. It can also be opened from
the palette ("Zobrazit záznamy") and it is listed on the help screen.

```text
Záznamy
────────────────────────────────────────────────────────────
Čas       Úroveň    Zdroj            Zpráva
▶ 21:04:10  VAROVÁNÍ  district:CZ0642  Dokument odmítnut | {"source":"district:CZ06…
  21:04:11  INFO      national         Data zatím nejsou zveřejněna | {"source":"n…
```

- **Order and selection:** entries are listed oldest first. The newest is selected when
  the screen opens.
- **One line per entry**, cut to the view width. The full text is on the detail screen.
- **Source column:** empty when the entry has no source.
- **With no entries:** a single line, `Zatím nebyly zaznamenány žádné záznamy.`
- **Colour:** `CHYBA` and `VAROVÁNÍ` rows use the `warning` role, `LADĚNÍ` rows use
  `muted`, and `INFO` rows use the default text. The label alone carries the meaning.
- **New entries** appear on the next redraw. The selection stays on the entry the user
  chose.

| Key | Effect |
|---|---|
| `↑` `↓` `PgUp` `PgDn` `Home` `End` | Move the selection, as on other lists |
| `Enter` | Open the selected entry's detail |
| `c` | Copy the selected entry's line |
| `Shift+C` | Copy all entries' lines, oldest first, one per line |
| `Esc` | Close and return to the previous screen, with its selection and scroll |

The other global keys keep working: `Ctrl+P`, `/`, `Shift+W`, `r`, `Ctrl+B`, `Ctrl+T`,
`?` and `q`.

## 4. Log entry detail screen (`ZÁZNAM`)

- **Content:** the entry's exact log-file line, wrapped to the view width, under the
  heading `Záznam`.
- **An entry evicted since it was opened:** the screen shows
  `Záznam již není k dispozici.`
- **Keys:**
  - `c` copies this entry.
  - `Shift+C` copies all entries.
  - `Esc` returns to the list, with the selection unchanged.

## 5. Copy notices

| Outcome | Notice |
|---|---|
| Sent, one entry | `Odesláno do schránky: 1 záznam.` |
| Sent, N entries | `Odesláno do schránky: N záznamy.` (2–4) / `N záznamů.` (5 and more) |
| Nothing to copy | `Není co kopírovat.` |
| The terminal refused | `Terminál nepodporuje kopírování do schránky.` |

The copied text is always the log-file line(s), byte for byte.

## 6. Status bar, palette, help

| Action | Key (help/palette) | Status bar | Palette label | Where |
|---|---|---|---|---|
| `logs` | `l` | `l záznamy` | Zobrazit záznamy | všude |
| `copy-entry` | `c` | `c kopírovat` | Kopírovat vybraný záznam | záznamy |
| `copy-all` | `Shift+C` | `C vše` | Kopírovat všechny záznamy | záznamy |

The status bar label for the screens is `ZÁZNAMY` (list) and `ZÁZNAM` (detail).

## 7. Log file

- The file format is unchanged, and so are its location and the `--log-level`
  threshold.
- **A `404` for a source is now logged** at `info` as `Data zatím nejsou zveřejněna`,
  with the source. It is not logged today.
- **`Dokument odmítnut` (`warn`) is logged less often.** It is still written, but only
  when the rejection reason differs from the source's previous failure.
- **Both of these are logged once per change of reason.** A success resets that, so
  the next occurrence is logged again.
- **`Stahování selhalo` is unchanged:** it is logged on every occurrence (research R5).
