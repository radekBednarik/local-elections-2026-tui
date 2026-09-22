import { describe, expect, test } from "bun:test"
import { MIN_INTERVAL_SECONDS, parseCliArgs } from "../../src/config/args.ts"

/** Convenience: parse and expect success. */
function ok(argv: string[]) {
  const result = parseCliArgs(argv)
  if (!result.ok) throw new Error(`expected success, got: ${result.message}`)
  return result
}

describe("defaults", () => {
  test("no arguments yields the current municipal election", () => {
    const { options } = ok([])
    expect(options.election).toBe("kv2026")
    expect(options.date).toBe("20261009")
    expect(options.intervalSeconds).toBe(60)
    expect(options.logLevel).toBe("info")
    expect(options.refreshReference).toBe(false)
    expect(options.baseUrl).toContain("volby.gov.cz")
  })
})

describe("--interval clamping (FR-017)", () => {
  test("a value below the floor is clamped, not rejected", () => {
    const result = ok(["--interval", "1"])
    expect(result.options.intervalSeconds).toBe(MIN_INTERVAL_SECONDS)
    // The clamp must be reported, otherwise it silently ignores the user.
    expect(result.warnings.join(" ")).toContain("60")
  })

  test("a value at or above the floor is kept as given", () => {
    expect(ok(["--interval", "60"]).options.intervalSeconds).toBe(60)
    expect(ok(["--interval", "300"]).options.intervalSeconds).toBe(300)
    expect(ok(["--interval", "300"]).warnings).toHaveLength(0)
  })

  test("a non-numeric interval is an error", () => {
    expect(parseCliArgs(["--interval", "brzy"]).ok).toBe(false)
  })
})

describe("--date validation", () => {
  test("accepts a real date in YYYYMMDD form", () => {
    expect(ok(["--date", "20261009"]).options.date).toBe("20261009")
  })

  test.each([
    ["wrong shape", "2026-10-09"],
    ["too short", "202610"],
    ["not a date", "abcdefgh"],
    ["month 13", "20261309"],
    ["day 32", "20261032"],
    ["31 September", "20260931"],
  ])("rejects %s", (_label, value) => {
    expect(parseCliArgs(["--date", value]).ok).toBe(false)
  })
})

describe("unknown options", () => {
  test("an unknown option is an error, never silently ignored", () => {
    const result = parseCliArgs(["--nonsense"])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.exitCode).toBe(1)
  })
})

describe("--base-url", () => {
  test("accepts http, https and file", () => {
    expect(ok(["--base-url", "http://localhost:8787"]).options.baseUrl).toBe("http://localhost:8787")
    expect(ok(["--base-url", "https://example.org"]).options.baseUrl).toBe("https://example.org")
    expect(ok(["--base-url", "file://./fixtures"]).options.baseUrl).toBe("file://./fixtures")
  })

  test("rejects an unsupported scheme", () => {
    expect(parseCliArgs(["--base-url", "ftp://example.org"]).ok).toBe(false)
  })

  test("strips a trailing slash so URL building never doubles it", () => {
    expect(ok(["--base-url", "http://localhost:8787/"]).options.baseUrl).toBe("http://localhost:8787")
  })
})

describe("--log-level", () => {
  test("accepts the four documented levels", () => {
    for (const level of ["error", "warn", "info", "debug"] as const) {
      expect(ok(["--log-level", level]).options.logLevel).toBe(level)
    }
  })

  test("rejects anything else", () => {
    expect(parseCliArgs(["--log-level", "trace"]).ok).toBe(false)
  })
})

describe("immediate commands", () => {
  test("help and version request a clean exit", () => {
    expect(ok(["--help"]).options.showHelp).toBe(true)
    expect(ok(["--version"]).options.showVersion).toBe(true)
  })

  test("--self-test is recognised", () => {
    // CI runs this instead of the bare binary, which would launch the interface and
    // wait for a keypress that never arrives on a runner.
    expect(ok(["--self-test"]).options.selfTest).toBe(true)
    expect(ok([]).options.selfTest).toBe(false)
  })
})
