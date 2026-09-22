import { describe, expect, test } from "bun:test"
import {
  type ColorEnvironment,
  isMonochrome,
  readColorEnvironment,
  resolveTheme,
} from "../../src/ui/theme/detect.ts"
import { ROLE_MEANING, ROLES } from "../../src/ui/theme/roles.ts"
import {
  isThemeName,
  MONOCHROME,
  nextTheme,
  THEME_NAMES,
  type ThemeName,
  themeByName,
  themeLabel,
} from "../../src/ui/theme/themes.ts"

const env = (overrides: Partial<ColorEnvironment> = {}): ColorEnvironment => ({
  noColor: false,
  ansi256: true,
  reportedScheme: null,
  ...overrides,
})

describe("roles (FR-059)", () => {
  test("there are exactly six, each with a distinct meaning", () => {
    expect(ROLES).toHaveLength(6)
    expect(new Set(Object.values(ROLE_MEANING)).size).toBe(6)
  })

  test("every theme defines every role, so none can fall back to nothing", () => {
    for (const name of THEME_NAMES) {
      const theme = themeByName(name)
      for (const role of ROLES) {
        expect(`${name}.${role}`).toBe(`${name}.${role}`)
        expect(theme.roles[role]).toBeDefined()
      }
    }
  })

  test("there is no role for an electoral party (FR-060)", () => {
    // With thousands of local candidate lists there is no authoritative party colour,
    // and assigning one would imply an affiliation the source never published.
    expect(ROLES).not.toContain("party")
    expect(Object.keys(ROLE_MEANING).join(" ")).not.toMatch(/party|strana/i)
  })
})

describe("themes (FR-061)", () => {
  test("the three documented themes exist and are named", () => {
    expect(THEME_NAMES).toEqual(["dark", "light", "high-contrast"])
    for (const name of THEME_NAMES) expect(themeLabel(name)).not.toBe("")
  })

  test("dark and light defer to the terminal's own palette", () => {
    // Indexed colours inherit the user's scheme. Hardcoded hex would clash with every
    // solarized or gruvbox setup.
    for (const name of ["dark", "light"] as const) {
      const theme = themeByName(name)
      for (const role of ROLES) {
        expect(`${name}.${role}=${theme.roles[role].kind}`).toBe(`${name}.${role}=indexed`)
      }
    }
  })

  test("high contrast pins explicit values instead", () => {
    // An unknown user palette cannot promise brightness separation, so this one cannot
    // defer to it.
    const theme = themeByName("high-contrast")
    for (const role of ROLES) {
      expect(`${role}=${theme.roles[role].kind}`).toBe(`${role}=hex`)
    }
  })

  test("high contrast separates roles by brightness, not hue (FR-062)", () => {
    const theme = themeByName("high-contrast")
    expect(theme.contrastByBrightness).toBe(true)

    // Read the grey level of each pinned colour; they must not all collapse together,
    // or a user who cannot distinguish hues would see one undifferentiated block.
    const levels = ROLES.map((role) => {
      const spec = theme.roles[role]
      if (spec.kind !== "hex") return 0
      const hex = spec.value.slice(1)
      const r = Number.parseInt(hex.slice(0, 2), 16)
      const g = Number.parseInt(hex.slice(2, 4), 16)
      const b = Number.parseInt(hex.slice(4, 6), 16)
      return Math.round(0.299 * r + 0.587 * g + 0.114 * b)
    })
    expect(new Set(levels).size).toBeGreaterThan(2)
  })

  test("cycling visits every theme and returns to the start", () => {
    const seen: ThemeName[] = [THEME_NAMES[0]]
    let current: ThemeName = THEME_NAMES[0]
    for (let i = 0; i < THEME_NAMES.length - 1; i++) {
      current = nextTheme(current)
      seen.push(current)
    }
    expect(new Set(seen).size).toBe(THEME_NAMES.length)
    expect(nextTheme(current)).toBe(THEME_NAMES[0])
  })

  test("an unrecognised theme name is rejected", () => {
    expect(isThemeName("dark")).toBe(true)
    expect(isThemeName("solarized")).toBe(false)
  })
})

describe("choosing a theme (T112, FR-063)", () => {
  test("NO_COLOR forces monochrome, outranking a stored preference", () => {
    // Honouring a stored theme here would emit escape sequences into a terminal that
    // explicitly asked not to receive them.
    expect(resolveTheme("high-contrast", env({ noColor: true }))).toBe(MONOCHROME)
  })

  test("a terminal without colour support forces monochrome", () => {
    expect(resolveTheme("dark", env({ ansi256: false }))).toBe(MONOCHROME)
  })

  test("a stored choice is honoured when colour is available", () => {
    expect(resolveTheme("light", env()).name).toBe("light")
    expect(resolveTheme("high-contrast", env()).name).toBe("high-contrast")
  })

  test("with no stored choice, the terminal's own report is followed", () => {
    expect(resolveTheme(null, env({ reportedScheme: "light" })).name).toBe("light")
    expect(resolveTheme(null, env({ reportedScheme: "dark" })).name).toBe("dark")
  })

  test("a terminal that reports nothing gets dark, not a guess dressed as detection", () => {
    expect(resolveTheme(null, env()).name).toBe("dark")
  })

  test("the monochrome theme really carries no colour", () => {
    expect(isMonochrome(MONOCHROME)).toBe(true)
    for (const name of THEME_NAMES) {
      expect(`${name}:${isMonochrome(themeByName(name))}`).toBe(`${name}:false`)
    }
  })
})

describe("reading the environment", () => {
  test.each([
    ["NO_COLOR set to 1", { NO_COLOR: "1" }, true],
    ["NO_COLOR set to anything", { NO_COLOR: "yes" }, true],
    ["NO_COLOR empty is not set, per the standard", { NO_COLOR: "" }, false],
    ["NO_COLOR absent", {}, false],
  ])("%s", (_label, vars, expected) => {
    expect(readColorEnvironment(vars).noColor).toBe(expected)
  })
})
