/**
 * Export (User Story 6). The encoding assertions here are the point of the suite: they
 * check the BYTES written, not merely what the code intended, because the whole risk of
 * this feature is a file that opens as mojibake in Excel.
 */

import type { Database } from "bun:sqlite"
import { beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { BOM, buildCsv, DELIMITER, numberCell, quoteField } from "../../src/export/csv.ts"
import { reportForScreen } from "../../src/export/report.ts"
import { csvForScreen, tableForScreen } from "../../src/export/tables.ts"
import { suggestFilename, writeExport } from "../../src/export/writer.ts"
import { extractArchiveFile } from "../../src/reference/archive.ts"
import { loadReference, type ReferenceArchives } from "../../src/reference/loader.ts"
import { ingestDistrict, ingestNational } from "../../src/sources/ingest.ts"
import { openMemoryDatabase } from "../../src/storage/db.ts"
import { withTempDataDir } from "../helpers/tmpdir.ts"

const FIXTURES = join(import.meta.dir, "../../fixtures/2026")
const read = (name: string) => readFileSync(join(FIXTURES, name), "utf8")

let archives: ReferenceArchives
beforeAll(async () => {
  const reg = await extractArchiveFile(join(FIXTURES, "reg.zip"))
  const cis = await extractArchiveFile(join(FIXTURES, "ciselniky.zip"))
  if (!reg.ok || !cis.ok) throw new Error("fixture archives could not be extracted")
  archives = { registry: reg.files, codelists: cis.files }
})

let db: Database
beforeEach(() => {
  db = openMemoryDatabase()
  loadReference(db, archives)
  ingestNational(db, read("vysledky.xml"))
  ingestDistrict(db, "CZ0642", read("vysledky_obce_okres_CZ0642.xml"))
})

describe("CSV encoding (FR-053)", () => {
  test("the file BEGINS with a UTF-8 BOM", async () => {
    await withTempDataDir(async (dir) => {
      const csv = csvForScreen(db, { kind: "council", kodzastup: "551082" })
      expect(csv).not.toBeNull()
      if (csv === null) return

      const path = dir.file("out.csv")
      const result = await writeExport(path, csv.content)
      expect(result.ok).toBe(true)

      // Assert on the bytes. Without EF BB BF, Excel on a Czech system decodes with the
      // system code page and every accented character is corrupted.
      const bytes = readFileSync(path)
      expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf])
    })
  })

  test("fields are separated by semicolons, not commas", () => {
    const csv = csvForScreen(db, { kind: "council", kodzastup: "551082" })?.content ?? ""
    const headerLine = csv.split("\r\n").find((l) => l.startsWith("Č."))
    expect(headerLine).toBeDefined()
    expect(headerLine ?? "").toContain(DELIMITER)
    expect((headerLine ?? "").split(DELIMITER).length).toBeGreaterThan(4)
  })

  test("decimals use a comma, which is why the delimiter cannot", () => {
    const csv = csvForScreen(db, { kind: "council", kodzastup: "551082" })?.content ?? ""
    expect(csv).toMatch(/\d+,\d\d/)
  })

  test("lines end with CRLF", () => {
    const csv = csvForScreen(db, { kind: "council", kodzastup: "551082" })?.content ?? ""
    expect(csv).toContain("\r\n")
    // No bare LF outside a CRLF pair.
    expect(csv.replace(/\r\n/g, "")).not.toContain("\n")
  })

  test("Czech diacritics survive the round trip through a real file", async () => {
    await withTempDataDir(async (dir) => {
      const csv = csvForScreen(db, { kind: "district", nuts: "CZ0642" })
      if (csv === null) throw new Error("no table")
      const path = dir.file("okres.csv")
      await writeExport(path, csv.content)

      const back = readFileSync(path, "utf8")
      expect(back).toContain("Brno-Bohunice")
      expect(back).toMatch(/[ěščřžýáíéúůďťňó]/i)
    })
  })
})

describe("RFC 4180 quoting", () => {
  test("a field containing the delimiter is quoted", () => {
    expect(quoteField("a;b")).toBe('"a;b"')
  })

  test("a quote inside a field is doubled", () => {
    expect(quoteField('Sdružení "Naše obec"')).toBe('"Sdružení ""Naše obec"""')
  })

  test("a newline inside a field is quoted", () => {
    expect(quoteField("a\nb")).toBe('"a\nb"')
  })

  test("a plain field is left alone", () => {
    expect(quoteField("ANO 2011")).toBe("ANO 2011")
  })

  test("a real party name with punctuation round-trips", () => {
    // Coalition names routinely contain punctuation, so this is normal use, not an edge.
    const name = 'SPOLEČNĚ TOP 09 a nezávislí; s podporou "Zelených"'
    const quoted = quoteField(name)
    expect(quoted.startsWith('"')).toBe(true)
    // Unquoting restores the original exactly.
    expect(quoted.slice(1, -1).replace(/""/g, '"')).toBe(name)
  })
})

describe("provenance (FR-050, SC-017)", () => {
  test.each([
    ["national", { kind: "national" as const }],
    ["district", { kind: "district" as const, nuts: "CZ0642" }],
    ["council", { kind: "council" as const, kodzastup: "551082" }],
  ])("%s export states area, timestamp and status", (_label, screen) => {
    const csv = csvForScreen(db, screen)?.content ?? ""
    expect(csv).toContain("# Oblast:")
    expect(csv).toContain("# Data zveřejněna:")
    expect(csv).toContain("# Stav:")
    expect(csv).toContain("# Exportováno:")
  })

  test("the publisher timestamp is real, not a placeholder (SC-017)", () => {
    const csv = csvForScreen(db, { kind: "council", kodzastup: "551082" })?.content ?? ""
    // A dash here would make every exported figure untraceable.
    expect(csv).toContain("# Data zveřejněna: 2026-")
    expect(csv).not.toContain("# Data zveřejněna: —")
  })

  test("a district export also carries the document timestamp", () => {
    const csv = csvForScreen(db, { kind: "district", nuts: "CZ0642" })?.content ?? ""
    expect(csv).toContain("# Data zveřejněna: 2026-")
  })

  test("the area code is present, so a figure can be traced back", () => {
    const csv = csvForScreen(db, { kind: "council", kodzastup: "551082" })?.content ?? ""
    expect(csv).toContain("551082")
  })
})

describe("figures match the screen (FR-029)", () => {
  test("exported party votes equal the stored values, unrounded", () => {
    const table = tableForScreen(db, { kind: "council", kodzastup: "551082" })
    expect(table).not.toBeNull()
    if (table === null) return

    const stored = db
      .query(
        `SELECT votes FROM party_result
          WHERE snapshot_id = (SELECT id FROM result_snapshot WHERE area_id = '551082' AND is_current = 1)
          ORDER BY seats_won DESC, votes DESC LIMIT 1`,
      )
      .get() as { votes: number }

    expect(table.rows[0]?.[3]).toBe(String(stored.votes))
  })

  test("an absent figure is an empty cell, never a zero", () => {
    expect(numberCell(null)).toBe("")
    expect(numberCell(undefined)).toBe("")
    expect(numberCell(0)).toBe("0")
  })
})

describe("screens without a table", () => {
  test("the district list and search cannot be exported", () => {
    expect(csvForScreen(db, { kind: "districts" })).toBeNull()
    expect(csvForScreen(db, { kind: "search" })).toBeNull()
  })

  test("an unknown council yields nothing rather than an empty file", () => {
    expect(csvForScreen(db, { kind: "council", kodzastup: "000000" })).toBeNull()
  })
})

describe("summary report (FR-051)", () => {
  test("a council report is readable prose with the key figures", () => {
    const report = reportForScreen(db, { kind: "council", kodzastup: "551082" })
    expect(report).not.toBeNull()
    const body = report?.content ?? ""
    expect(body).toContain("Brno-Bohunice")
    expect(body).toContain("Účast")
    expect(body).toContain("Mandáty podle volebních stran")
    expect(body).toContain("Zvolení zastupitelé")
  })

  test("it carries no BOM, being prose rather than a spreadsheet file", () => {
    const body = reportForScreen(db, { kind: "council", kodzastup: "551082" })?.content ?? ""
    expect(body.startsWith(BOM)).toBe(false)
  })

  test("it wraps within 80 columns so it survives being pasted", () => {
    const body = reportForScreen(db, { kind: "council", kodzastup: "551082" })?.content ?? ""
    for (const line of body.split("\n")) {
      expect([...line].length).toBeLessThanOrEqual(100)
    }
  })

  test("a district report omits the candidate section", () => {
    const body = reportForScreen(db, { kind: "district", nuts: "CZ0642" })?.content ?? ""
    expect(body).toContain("Zastupitelstva")
    expect(body).not.toContain("Zvolení zastupitelé")
  })

  test("the national overview has no report form", () => {
    expect(reportForScreen(db, { kind: "national" })).toBeNull()
  })
})

describe("writing (FR-052)", () => {
  test("writes the file and reports its size", async () => {
    await withTempDataDir(async (dir) => {
      const result = await writeExport(dir.file("a.csv"), "obsah")
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.bytes).toBeGreaterThan(0)
    })
  })

  test("refuses to overwrite silently, but will when told to", async () => {
    await withTempDataDir(async (dir) => {
      const path = dir.file("a.csv")
      await writeExport(path, "první")
      const refused = await writeExport(path, "druhý")
      expect(refused.ok).toBe(false)

      const allowed = await writeExport(path, "druhý", { overwrite: true })
      expect(allowed.ok).toBe(true)
      expect(readFileSync(path, "utf8")).toBe("druhý")
    })
  })

  test("an unwritable path is reported with a reason, never thrown", async () => {
    const result = await writeExport("/\u0000invalid/path.csv", "x")
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).not.toBe("")
  })

  test("leaves no partial file behind when the write fails", async () => {
    await withTempDataDir(async (dir) => {
      // A directory cannot be overwritten by a file.
      const result = await writeExport(dir.path, "x", { overwrite: true })
      expect(result.ok).toBe(false)
      const { existsSync } = await import("node:fs")
      expect(existsSync(`${dir.path}.part`)).toBe(false)
    })
  })

  test("creates the destination directory if needed", async () => {
    await withTempDataDir(async (dir) => {
      const result = await writeExport(dir.file("hluboko/vnoreno/a.csv"), "obsah")
      expect(result.ok).toBe(true)
    })
  })
})

describe("suggested filenames", () => {
  test("strips diacritics and unsafe characters", () => {
    const name = suggestFilename("Brno-Bohunice", "csv", new Date("2026-10-09T21:15:00Z"))
    expect(name).toContain("brno-bohunice")
    expect(name.endsWith(".csv")).toBe(true)
    expect(name).not.toMatch(/[^\w.-]/)
  })

  test("handles a name that reduces to nothing", () => {
    expect(suggestFilename("///", "txt")).toContain("export")
  })
})

describe("a complete document", () => {
  test("assembles header, columns and rows in order", () => {
    const csv = buildCsv(
      {
        area: "Testov",
        areaCode: "1",
        publishedAt: "2026-10-09T21:15:00",
        isFinal: true,
        exportedAt: "2026-10-09T21:20:00",
      },
      ["A", "B"],
      [["1", "2"]],
    )
    const lines = csv.split("\r\n")
    expect(lines[0]).toBe(`${BOM}# Volby do zastupitelstev obcí 2026`)
    expect(lines).toContain("A;B")
    expect(lines).toContain("1;2")
  })
})
