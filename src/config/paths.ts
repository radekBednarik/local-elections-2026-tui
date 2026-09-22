/**
 * Per-user file locations (task T018, FR-047).
 *
 * Platform and environment are passed in rather than read from `process`, so the
 * conventions for both operating systems can be tested from either one. Only
 * `currentPaths()` touches the real process.
 */

import { homedir } from "node:os"
import { posix, win32 } from "node:path"

/** Directory name used under whichever per-user root the platform provides. */
const APP_DIR = "volby-kv2026"

/**
 * Joins using the separator of the *target* platform, not the host's.
 *
 * `node:path`'s bare `join` follows whichever OS the process happens to run on, which
 * would make these functions produce Windows separators while resolving Linux paths.
 */
function joinFor(platform: NodeJS.Platform | string): (...parts: string[]) => string {
  return platform === "win32" ? win32.join : posix.join
}

export interface PathInputs {
  platform: NodeJS.Platform | string
  env: Record<string, string | undefined>
  /** Value of `--data-dir`, which wins over everything else. */
  override: string | null
}

export interface AppPaths {
  dataDir: string
  database: string
  log: string
}

/**
 * Resolves the data directory.
 *
 * Precedence, highest first: `--data-dir`, `VOLBY_DATA_DIR`, then the OS convention.
 */
export function resolveDataDir({ platform, env, override }: PathInputs): string {
  if (override !== null && override !== "") return override

  const fromEnv = env.VOLBY_DATA_DIR
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv

  const join = joinFor(platform)

  if (platform === "win32") {
    const appData = env.APPDATA
    if (appData !== undefined && appData !== "") return join(appData, APP_DIR)
    const profile = env.USERPROFILE ?? homedir()
    return join(profile, "AppData", "Roaming", APP_DIR)
  }

  // Linux and anything else: XDG Base Directory.
  const xdgData = env.XDG_DATA_HOME
  if (xdgData !== undefined && xdgData !== "") return join(xdgData, APP_DIR)
  const home = env.HOME ?? homedir()
  return join(home, ".local", "share", APP_DIR)
}

/**
 * Resolves every file the application owns.
 *
 * The database, log and configuration all live together so that `--data-dir` moves the
 * whole footprint in one step, and so a test directory is fully isolated.
 */
export function resolvePaths(inputs: PathInputs): AppPaths {
  const dataDir = resolveDataDir(inputs)
  const join = joinFor(inputs.platform)
  return {
    dataDir,
    database: join(dataDir, "volby.sqlite"),
    log: join(dataDir, "volby.log"),
  }
}

/** The real paths for this process. */
export function currentPaths(override: string | null = null): AppPaths {
  return resolvePaths({ platform: process.platform, env: process.env, override })
}
