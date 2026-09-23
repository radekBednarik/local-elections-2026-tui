/**
 * Themes (tasks T006, FR-001, FR-002, FR-007).
 *
 * A theme is a table of colour SLOTS, each with one meaning that is the same in every
 * theme: "stripe background", "accent", "text on an accent background". Screens never
 * name a colour; they name a role or a slot, and the active theme decides what it looks
 * like. That is what lets six themes share one layout.
 *
 * The values are the published palettes of Tokyo Night, Catppuccin, Gruvbox and Nord,
 * with stripe and selection tones chosen between their own surface colours. Tones that
 * missed the contrast floor were nudged until they passed and nothing else was touched
 * (research R9, specs/002-tui-visual-refresh/data-model.md). The contrast test in
 * tests/ui/theme-contrast.test.ts is what keeps it that way.
 *
 * These replace the themes that deferred to the terminal's own palette (FR-006a). A
 * painted background cannot come from a palette whose background is unknown.
 */

export const SLOTS = [
  "bg",
  "panel",
  "element",
  "zebra",
  "sel",
  "track",
  "border",
  "borderActive",
  "text",
  "muted",
  "subtle",
  "primary",
  "accent",
  "success",
  "error",
  "warning",
  "onAccent",
  "bar",
] as const

export type Slot = (typeof SLOTS)[number]

/** In the order the theme key cycles through them (FR-005). */
export const THEME_NAMES = [
  "tokyonight",
  "catppuccin-mocha",
  "gruvbox",
  "nord",
  "catppuccin-latte",
  "high-contrast",
] as const

export type ThemeName = (typeof THEME_NAMES)[number]

export function isThemeName(value: string): value is ThemeName {
  return (THEME_NAMES as readonly string[]).includes(value)
}

export interface Theme {
  name: ThemeName
  /** Shown in the status bar and the command palette. */
  label: string
  /** True when this theme relies on brightness rather than hue (001 FR-062). */
  contrastByBrightness: boolean
  /** Hex `#rrggbb` per slot. `null` only in monochrome, where nothing is coloured. */
  slots: Record<Slot, string | null>
  /**
   * The slot the selected row's text takes. `text` everywhere but high contrast, whose
   * selection is white and so needs black text on it.
   */
  selectionText: Slot
  /**
   * Drawn as the nearest xterm-256 colours rather than the exact values, for a terminal
   * that reports 256 colours but not true colour (research R8). Set only on the variants
   * detect.ts derives; every theme defined here is true colour.
   */
  palette256: boolean
}

const TOKYO_NIGHT: Theme = {
  name: "tokyonight",
  label: "Tokyo Night",
  contrastByBrightness: false,
  selectionText: "text",
  palette256: false,
  slots: {
    bg: "#1a1b26",
    panel: "#16161e",
    element: "#24283b",
    zebra: "#1e2030",
    sel: "#2e3c64",
    track: "#292e42",
    border: "#3b4261",
    borderActive: "#7aa2f7",
    text: "#c0caf5",
    muted: "#697196",
    subtle: "#737aa2",
    primary: "#7aa2f7",
    accent: "#bb9af7",
    success: "#9ece6a",
    error: "#f7768e",
    warning: "#e0af68",
    onAccent: "#1a1b26",
    bar: "#7aa2f7",
  },
}

const CATPPUCCIN_MOCHA: Theme = {
  name: "catppuccin-mocha",
  label: "Catppuccin Mocha",
  contrastByBrightness: false,
  selectionText: "text",
  palette256: false,
  slots: {
    bg: "#1e1e2e",
    panel: "#181825",
    element: "#313244",
    zebra: "#24243a",
    sel: "#45475a",
    track: "#313244",
    border: "#45475a",
    borderActive: "#cba6f7",
    text: "#cdd6f4",
    muted: "#787b90",
    subtle: "#a6adc8",
    primary: "#89b4fa",
    accent: "#cba6f7",
    success: "#a6e3a1",
    error: "#f38ba8",
    warning: "#f9e2af",
    onAccent: "#1e1e2e",
    bar: "#b4befe",
  },
}

const GRUVBOX: Theme = {
  name: "gruvbox",
  label: "Gruvbox Dark",
  contrastByBrightness: false,
  selectionText: "text",
  palette256: false,
  slots: {
    bg: "#282828",
    panel: "#1d2021",
    element: "#3c3836",
    zebra: "#2f2c2a",
    sel: "#504945",
    track: "#3c3836",
    border: "#504945",
    borderActive: "#fabd2f",
    text: "#ebdbb2",
    muted: "#928374",
    subtle: "#bdae93",
    primary: "#88a99c",
    accent: "#fabd2f",
    success: "#b8bb26",
    error: "#fc7c6c",
    warning: "#fabd2f",
    onAccent: "#282828",
    bar: "#8ec07c",
  },
}

const NORD: Theme = {
  name: "nord",
  label: "Nord",
  contrastByBrightness: false,
  selectionText: "text",
  palette256: false,
  slots: {
    bg: "#2e3440",
    panel: "#272c36",
    element: "#3b4252",
    zebra: "#333a47",
    sel: "#434c5e",
    track: "#3b4252",
    border: "#4c566a",
    borderActive: "#88c0d0",
    text: "#e5e9f0",
    muted: "#848ea2",
    subtle: "#aeb7c6",
    primary: "#88c0d0",
    accent: "#96b1cc",
    success: "#a3be8c",
    error: "#d89fa4",
    warning: "#ebcb8b",
    onAccent: "#2e3440",
    bar: "#88c0d0",
  },
}

const CATPPUCCIN_LATTE: Theme = {
  name: "catppuccin-latte",
  label: "Catppuccin Latte",
  contrastByBrightness: false,
  selectionText: "text",
  palette256: false,
  slots: {
    bg: "#eff1f5",
    panel: "#e6e9ef",
    element: "#dce0e8",
    zebra: "#e7eaf0",
    sel: "#ccd0da",
    track: "#dce0e8",
    border: "#bcc0cc",
    borderActive: "#8839ef",
    text: "#4c4f69",
    muted: "#7b7e8e",
    subtle: "#6c6f85",
    primary: "#1a5ad8",
    accent: "#7e35de",
    success: "#2d701e",
    error: "#c50e36",
    warning: "#8b5812",
    onAccent: "#eff1f5",
    bar: "#1e66f5",
  },
}

/**
 * High contrast.
 *
 * Every state is separated by BRIGHTNESS, not hue, so it stays legible to a user who
 * cannot tell the palette's colours apart (001 FR-062): rises, falls and muted text sit
 * on three distinct grey levels. The selection is reversed, white with black text.
 */
const HIGH_CONTRAST: Theme = {
  name: "high-contrast",
  label: "Vysoký kontrast",
  contrastByBrightness: true,
  selectionText: "bg",
  palette256: false,
  slots: {
    bg: "#000000",
    panel: "#262626",
    element: "#1f1f1f",
    zebra: "#141414",
    sel: "#ffffff",
    track: "#2a2a2a",
    border: "#ffffff",
    borderActive: "#ffff00",
    text: "#ffffff",
    muted: "#808080",
    subtle: "#d0d0d0",
    primary: "#ffffff",
    accent: "#ffff00",
    success: "#e0e0e0",
    error: "#a0a0a0",
    warning: "#ffff00",
    onAccent: "#000000",
    bar: "#ffffff",
  },
}

/**
 * The monochrome fallback (FR-008).
 *
 * Not selectable: it is what a terminal without colour, or `NO_COLOR`, resolves to.
 * Every slot is null, which is the strongest possible test that meaning is carried by
 * text, symbol and position rather than by hue.
 */
export const MONOCHROME: Theme = {
  name: "tokyonight",
  label: "bez barev",
  contrastByBrightness: true,
  selectionText: "text",
  palette256: false,
  slots: Object.fromEntries(SLOTS.map((slot) => [slot, null])) as Record<Slot, null>,
}

const THEMES: Record<ThemeName, Theme> = {
  tokyonight: TOKYO_NIGHT,
  "catppuccin-mocha": CATPPUCCIN_MOCHA,
  gruvbox: GRUVBOX,
  nord: NORD,
  "catppuccin-latte": CATPPUCCIN_LATTE,
  "high-contrast": HIGH_CONTRAST,
}

export function themeByName(name: ThemeName): Theme {
  return THEMES[name]
}

/** The next theme in the cycle, for the theme-switch key. */
export function nextTheme(current: ThemeName): ThemeName {
  const index = THEME_NAMES.indexOf(current)
  return THEME_NAMES[(index + 1) % THEME_NAMES.length] ?? "tokyonight"
}

/** The theme's name as the user sees it, in the status bar and the command palette. */
export function themeLabel(name: ThemeName): string {
  return THEMES[name].label
}
