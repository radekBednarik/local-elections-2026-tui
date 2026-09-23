import { describe, expect, test } from "bun:test"
import {
  type ColorEnvironment,
  isMonochrome,
  readColorEnvironment,
  resolveTheme,
} from "../../src/ui/theme/detect.ts"
import { ROLE_MEANING, ROLE_SLOT, ROLES } from "../../src/ui/theme/roles.ts"
import {
  isThemeName,
  MONOCHROME,
  nextTheme,
  SLOTS,
  THEME_NAMES,
  type ThemeName,
  themeByName,
  themeLabel,
} from "../../src/ui/theme/themes.ts"

const env = (overrides: Partial<ColorEnvironment> = {}): ColorEnvironment => ({
  noColor: false,
  ansi256: true,
  rgb: null,
  reportedScheme: null,
  ...overrides,
})

describe("roles (FR-059, FR-003)", () => {
  test("there are eight, each with a distinct meaning", () => {
    expect(ROLES).toHaveLength(8)
    expect(new Set(Object.values(ROLE_MEANING)).size).toBe(8)
  })

  test("each role resolves to one slot, the same in every theme", () => {
    expect(ROLE_SLOT).toEqual({
      heading: { slot: "primary", bold: true },
      selection: { slot: "selectionText", bold: true },
      warning: { slot: "warning", bold: true },
      increase: { slot: "success", bold: false },
      decrease: { slot: "error", bold: false },
      muted: { slot: "muted", bold: false },
      accent: { slot: "accent", bold: true },
      subtle: { slot: "subtle", bold: false },
    })
  })

  test("there is no role for an electoral party (FR-060)", () => {
    // With thousands of local candidate lists there is no authoritative party colour,
    // and assigning one would imply an affiliation the source never published.
    expect(ROLES).not.toContain("party")
    expect(Object.keys(ROLE_MEANING).join(" ")).not.toMatch(/party|strana/i)
    expect(SLOTS.join(" ")).not.toMatch(/party|strana/i)
  })
})

describe("themes (FR-001, FR-005)", () => {
  test("the six themes exist, in the order the theme key cycles through them", () => {
    expect(THEME_NAMES).toEqual([
      "tokyonight",
      "catppuccin-mocha",
      "gruvbox",
      "nord",
      "catppuccin-latte",
      "high-contrast",
    ])
  })

  test("each has its label", () => {
    expect(THEME_NAMES.map(themeLabel)).toEqual([
      "Tokyo Night",
      "Catppuccin Mocha",
      "Gruvbox Dark",
      "Nord",
      "Catppuccin Latte",
      "Vysoký kontrast",
    ])
  })

  test("cycling visits every theme in order and wraps to the start", () => {
    const seen: ThemeName[] = ["tokyonight"]
    let current: ThemeName = "tokyonight"
    for (let i = 0; i < THEME_NAMES.length - 1; i++) {
      current = nextTheme(current)
      seen.push(current)
    }
    expect(seen).toEqual([...THEME_NAMES])
    expect(nextTheme("high-contrast")).toBe("tokyonight")
  })

  test("only high contrast relies on brightness, and only it reverses the selection", () => {
    for (const name of THEME_NAMES) {
      const theme = themeByName(name)
      const reversed = name === "high-contrast"
      expect(`${name}:${theme.contrastByBrightness}`).toBe(`${name}:${reversed}`)
      expect(`${name}:${theme.selectionText}`).toBe(`${name}:${reversed ? "bg" : "text"}`)
    }
  })

  test("the old terminal-palette names are not themes any more", () => {
    expect(isThemeName("tokyonight")).toBe(true)
    expect(isThemeName("dark")).toBe(false)
    expect(isThemeName("light")).toBe(false)
    expect(isThemeName("solarized")).toBe(false)
  })
})

describe("choosing a theme (FR-004, FR-008)", () => {
  test("NO_COLOR forces monochrome, outranking a stored preference", () => {
    // Honouring a stored theme here would emit escape sequences into a terminal that
    // explicitly asked not to receive them.
    expect(resolveTheme("high-contrast", env({ noColor: true }))).toBe(MONOCHROME)
  })

  test("a terminal without colour support forces monochrome", () => {
    expect(resolveTheme("nord", env({ ansi256: false }))).toBe(MONOCHROME)
  })

  test("a stored choice is honoured when colour is available", () => {
    expect(resolveTheme("gruvbox", env()).name).toBe("gruvbox")
    expect(resolveTheme("high-contrast", env()).name).toBe("high-contrast")
  })

  test("with no stored choice, Tokyo Night, or Catppuccin Latte on a light terminal", () => {
    expect(resolveTheme(null, env()).name).toBe("tokyonight")
    expect(resolveTheme(null, env({ reportedScheme: "dark" })).name).toBe("tokyonight")
    expect(resolveTheme(null, env({ reportedScheme: "light" })).name).toBe("catppuccin-latte")
  })

  test("the monochrome theme really carries no colour", () => {
    expect(isMonochrome(MONOCHROME)).toBe(true)
    for (const slot of SLOTS) expect(`${slot}=${MONOCHROME.slots[slot]}`).toBe(`${slot}=null`)
    for (const name of THEME_NAMES) {
      expect(`${name}:${isMonochrome(themeByName(name))}`).toBe(`${name}:false`)
    }
  })

  test("monochrome is not one of the selectable themes", () => {
    expect(THEME_NAMES.map(themeByName)).not.toContain(MONOCHROME)
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
