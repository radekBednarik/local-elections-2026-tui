/**
 * Checks that an icon is embedded in a Windows executable, and fails the build if it is not.
 *
 * Why this is needed: `bun build --compile --windows-icon` only works when Bun runs on
 * Windows, so what it does with a missing or broken icon cannot be observed anywhere
 * else. A build that "succeeds" with Bun's default icon is exactly the silent failure
 * the Windows build must not allow (spec FR-006).
 *
 * Why a byte search is enough: Windows stores each image of an .ico unchanged as its own
 * RT_ICON resource. Only the directory is rewritten. So if every image of the .ico
 * appears byte for byte in the executable, the icon is embedded (research R3).
 *
 * Usage:
 *   bun run tools/build/verify-windows-icon.ts dist/volby-kv2026.exe assets/icon.ico
 */

import { readFileSync } from "node:fs"

export interface IcoImage {
  /** Pixels. The .ico stores 256 as 0; this is already converted. */
  width: number
  height: number
  bitsPerPixel: number
  /** The image's bytes, a view into the .ico buffer. */
  data: Uint8Array
}

const HEADER_SIZE = 6
const ENTRY_SIZE = 16

/** Parses an .ico directory and returns its images. Throws with the reason if the file is not a valid icon. */
export function readIcoImages(bytes: Uint8Array): IcoImage[] {
  if (bytes.length < HEADER_SIZE) throw new Error(`${bytes.length} bytes is too short for an .ico header`)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const reserved = view.getUint16(0, true)
  if (reserved !== 0) throw new Error(`reserved is ${reserved}, expected 0`)
  const type = view.getUint16(2, true)
  if (type !== 1) throw new Error(`type is ${type}, expected 1`)
  const count = view.getUint16(4, true)
  if (count === 0) throw new Error("the file contains no images")
  if (HEADER_SIZE + ENTRY_SIZE * count > bytes.length) {
    throw new Error(`a directory of ${count} entries does not fit in ${bytes.length} bytes`)
  }

  return Array.from({ length: count }, (_, i) => {
    const entry = HEADER_SIZE + ENTRY_SIZE * i
    const width = view.getUint8(entry) || 256
    const height = view.getUint8(entry + 1) || 256
    const size = view.getUint32(entry + 8, true)
    const offset = view.getUint32(entry + 12, true)
    const name = `image ${i + 1} (${width}x${height})`
    if (size === 0) throw new Error(`${name} is empty`)
    if (offset + size > bytes.length) throw new Error(`${name} runs past the end of the file`)
    return {
      width,
      height,
      bitsPerPixel: view.getUint16(entry + 6, true),
      data: bytes.subarray(offset, offset + size),
    }
  })
}

/** Returns the images whose bytes do not occur anywhere in the executable. */
export function findMissingImages(exe: Uint8Array, images: IcoImage[]): IcoImage[] {
  const haystack = Buffer.from(exe.buffer, exe.byteOffset, exe.byteLength)
  return images.filter((image) => haystack.indexOf(image.data) === -1)
}

/** The whole command minus the printing: exit code 0 when `<ico>` is embedded in `<exe>`, 1 otherwise. */
export function verify(argv: string[]): { code: 0 | 1; message: string } {
  if (argv.length !== 2) return { code: 1, message: "Usage: verify-windows-icon.ts <exe> <ico>" }
  const [exePath, icoPath] = argv as [string, string]

  let images: IcoImage[]
  try {
    images = readIcoImages(readFileSync(icoPath))
  } catch (error) {
    return { code: 1, message: `Icon ${icoPath} is not a valid .ico file: ${(error as Error).message}` }
  }
  let exe: Uint8Array
  try {
    exe = readFileSync(exePath)
  } catch (error) {
    return { code: 1, message: `Cannot read executable ${exePath}: ${(error as Error).message}` }
  }

  const missing = findMissingImages(exe, images)
  if (missing.length === 0) {
    return { code: 0, message: `Icon ${icoPath} is embedded in ${exePath} (${images.length} images).` }
  }
  const sizes = missing.map((image) => `${image.width}x${image.height}`).join(", ")
  return { code: 1, message: `Icon ${icoPath} is not embedded in ${exePath}. Missing images: ${sizes}` }
}

if (import.meta.main) {
  const result = verify(Bun.argv.slice(2))
  if (result.code === 0) console.log(result.message)
  else console.error(result.message)
  process.exit(result.code)
}
