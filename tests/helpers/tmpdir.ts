/**
 * Isolated temporary data directories for tests.
 *
 * Tests must never touch the real per-user data location (FR-047): a test run
 * would otherwise clobber the developer's own cache, watchlist and config, and
 * results would depend on whatever a previous run left behind.
 */

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export interface TempDataDir {
  /** Absolute path to the directory. Removed by `cleanup()`. */
  path: string
  /** Path to a file inside the directory. */
  file(name: string): string
  /** Removes the directory and everything in it. Safe to call twice. */
  cleanup(): void
}

/** Creates an empty temporary directory. Always pair with `cleanup()` in a `finally` or `afterEach`. */
export function createTempDataDir(prefix = "volby-test-"): TempDataDir {
  const path = mkdtempSync(join(tmpdir(), prefix))
  return {
    path,
    file: (name: string) => join(path, name),
    cleanup: () => {
      rmSync(path, { recursive: true, force: true })
    },
  }
}

/**
 * Runs `body` with a temporary directory that is removed afterwards, even when
 * `body` throws.
 */
export async function withTempDataDir<T>(body: (dir: TempDataDir) => T | Promise<T>): Promise<T> {
  const dir = createTempDataDir()
  try {
    return await body(dir)
  } finally {
    dir.cleanup()
  }
}
