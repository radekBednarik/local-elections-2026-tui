import { describe, expect, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { findMissingImages, readIcoImages, verify } from "../../tools/build/verify-windows-icon.ts"
import { withTempDataDir } from "../helpers/tmpdir.ts"

interface ImageSpec {
  width: number
  height: number
  bitsPerPixel: number
  data: Uint8Array
}

/** Builds a valid .ico: a 6-byte header, one 16-byte entry per image, then the image bytes. */
function makeIco(images: ImageSpec[]): Uint8Array {
  const headerSize = 6 + 16 * images.length
  const total = headerSize + images.reduce((sum, image) => sum + image.data.length, 0)
  const bytes = new Uint8Array(total)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, 0, true)
  view.setUint16(2, 1, true)
  view.setUint16(4, images.length, true)
  let offset = headerSize
  images.forEach((image, i) => {
    const entry = 6 + 16 * i
    view.setUint8(entry, image.width === 256 ? 0 : image.width)
    view.setUint8(entry + 1, image.height === 256 ? 0 : image.height)
    view.setUint16(entry + 4, 1, true)
    view.setUint16(entry + 6, image.bitsPerPixel, true)
    view.setUint32(entry + 8, image.data.length, true)
    view.setUint32(entry + 12, offset, true)
    bytes.set(image.data, offset)
    offset += image.data.length
  })
  return bytes
}

/** Image bytes that are distinct per `seed` and never a run of one repeated byte. */
function pattern(seed: number, length = 48): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => (seed * 37 + i * 11 + 1) % 251)
}

const small: ImageSpec = { width: 16, height: 16, bitsPerPixel: 32, data: pattern(1) }
const large: ImageSpec = { width: 256, height: 256, bitsPerPixel: 32, data: pattern(2) }

describe("readIcoImages", () => {
  test("returns every image in directory order with its size, depth and exact bytes", () => {
    const images = readIcoImages(makeIco([small, { ...large, width: 48, height: 24, bitsPerPixel: 8 }]))
    expect(images.map(({ width, height, bitsPerPixel }) => [width, height, bitsPerPixel])).toEqual([
      [16, 16, 32],
      [48, 24, 8],
    ])
    expect(images[0]?.data).toEqual(small.data)
    expect(images[1]?.data).toEqual(large.data)
  })

  test("reads a width or height byte of 0 as 256", () => {
    const [image] = readIcoImages(makeIco([large]))
    expect([image?.width, image?.height]).toEqual([256, 256])
  })

  test("rejects a header whose reserved field is not 0", () => {
    const bytes = makeIco([small])
    new DataView(bytes.buffer).setUint16(0, 1, true)
    expect(() => readIcoImages(bytes)).toThrow("reserved is 1, expected 0")
  })

  test("rejects a cursor file, whose type is 2", () => {
    const bytes = makeIco([small])
    new DataView(bytes.buffer).setUint16(2, 2, true)
    expect(() => readIcoImages(bytes)).toThrow("type is 2, expected 1")
  })

  test("rejects a file that contains no images", () => {
    expect(() => readIcoImages(makeIco([]))).toThrow("contains no images")
  })

  test("rejects a directory that is cut short", () => {
    const bytes = makeIco([small])
    new DataView(bytes.buffer).setUint16(4, 2, true)
    expect(() => readIcoImages(bytes.subarray(0, 6 + 16 + 8))).toThrow(
      "directory of 2 entries does not fit in 30 bytes",
    )
  })

  test("rejects an entry whose image runs past the end of the file", () => {
    const bytes = makeIco([small])
    new DataView(bytes.buffer).setUint32(6 + 8, small.data.length + 1, true)
    expect(() => readIcoImages(bytes)).toThrow("image 1 (16x16) runs past the end of the file")
  })

  test("rejects an entry with an empty image", () => {
    const bytes = makeIco([small])
    new DataView(bytes.buffer).setUint32(6 + 8, 0, true)
    expect(() => readIcoImages(bytes)).toThrow("image 1 (16x16) is empty")
  })

  test("rejects a buffer too short to hold the header", () => {
    expect(() => readIcoImages(new Uint8Array(5))).toThrow("5 bytes is too short for an .ico header")
  })
})

const ROOT = join(import.meta.dir, "..", "..")

describe("the committed icon", () => {
  test("holds ten 32-bit square images from 16 to 256 pixels", () => {
    const images = readIcoImages(readFileSync(join(ROOT, "assets", "icon.ico")))
    expect(images.map(({ width, height }) => [width, height])).toEqual(
      [16, 20, 24, 32, 40, 48, 64, 96, 128, 256].map((size) => [size, size]),
    )
    expect(images.every((image) => image.bitsPerPixel === 32)).toBe(true)
  })
})

describe("build scripts", () => {
  const scripts: Record<string, string> = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts

  test("the Windows build embeds the committed icon", () => {
    const script = scripts["build:win"]
    expect(script).toContain("--target=bun-windows-x64")
    expect(script).toContain("--windows-icon=assets/icon.ico")
    expect(script).toContain("--outfile dist/volby-kv2026.exe")
  })

  test("the Windows build then verifies the same executable against the same icon", () => {
    const [compile = "", check = "", ...rest] = scripts["build:win"]?.split("&&") ?? []
    const icon = compile.match(/--windows-icon=(\S+)/)?.[1]
    const exe = compile.match(/--outfile (\S+)/)?.[1]
    expect(rest).toEqual([])
    expect(check.trim()).toBe(`bun run tools/build/verify-windows-icon.ts ${exe} ${icon}`)
  })

  test("the Linux build uses no Windows-only flags", () => {
    expect(scripts["build:linux"]).not.toContain("--windows-")
  })
})

/** A stand-in executable: filler bytes with the given images written at spaced offsets. */
function makeExe(images: Uint8Array[], length = 64 * 1024): Uint8Array {
  const exe = new Uint8Array(length).fill(0xab)
  images.forEach((data, i) => {
    exe.set(data, 1000 + i * 5000)
  })
  return exe
}

describe("findMissingImages", () => {
  const images = readIcoImages(makeIco([1, 2, 3].map((seed) => ({ ...small, data: pattern(seed) }))))

  test("finds nothing missing when every image is in the executable", () => {
    expect(findMissingImages(makeExe(images.map((image) => image.data)), images)).toEqual([])
  })

  test("reports every image when none is in the executable", () => {
    expect(findMissingImages(makeExe([]), images)).toEqual(images)
  })

  test("reports only the image that is not in the executable", () => {
    const exe = makeExe(images.slice(0, 2).map((image) => image.data))
    expect(findMissingImages(exe, images)).toEqual(images.slice(2))
  })

  test("finds an image that ends exactly at the end of the executable", () => {
    const [image] = images
    if (!image) throw new Error("no image")
    const exe = makeExe([])
    exe.set(image.data, exe.length - image.data.length)
    expect(findMissingImages(exe, [image])).toEqual([])
  })

  test("reports nothing for an icon with no images to look for", () => {
    expect(findMissingImages(makeExe([]), [])).toEqual([])
  })
})

const iconSpecs = [small, { ...small, width: 32, height: 32, data: pattern(3) }, large]

/** Writes a three-image icon and an executable holding the images at `embedded` indexes, then runs `body`. */
function withFiles<T>(embedded: number[], body: (paths: { exe: string; ico: string }) => T) {
  return withTempDataDir((dir) => {
    const paths = { exe: dir.file("app.exe"), ico: dir.file("icon.ico") }
    writeFileSync(paths.ico, makeIco(iconSpecs))
    writeFileSync(paths.exe, makeExe(embedded.map((i) => iconSpecs[i]?.data ?? new Uint8Array())))
    return body(paths)
  })
}

describe("verify command", () => {
  test("succeeds and counts the images when every image is embedded", () =>
    withFiles([0, 1, 2], ({ exe, ico }) => {
      expect(verify([exe, ico])).toEqual({
        code: 0,
        message: `Icon ${ico} is embedded in ${exe} (3 images).`,
      })
    }))

  test("fails and lists the missing sizes in directory order", () =>
    withFiles([1], ({ exe, ico }) => {
      expect(verify([exe, ico])).toEqual({
        code: 1,
        message: `Icon ${ico} is not embedded in ${exe}. Missing images: 16x16, 256x256`,
      })
    }))

  test("fails and names the icon when the icon file does not exist", () =>
    withFiles([0], ({ exe, ico }) => {
      const result = verify([exe, `${ico}.missing`])
      expect(result.code).toBe(1)
      expect(result.message).toStartWith(`Icon ${ico}.missing is not a valid .ico file: `)
    }))

  test("fails and names the icon when the icon file is not an icon", () =>
    withFiles([0], ({ exe, ico }) => {
      writeFileSync(ico, "not an icon")
      expect(verify([exe, ico])).toEqual({
        code: 1,
        message: `Icon ${ico} is not a valid .ico file: reserved is 28526, expected 0`,
      })
    }))

  test("fails and names the executable when it cannot be read", () =>
    withFiles([0], ({ exe, ico }) => {
      const result = verify([`${exe}.missing`, ico])
      expect(result.code).toBe(1)
      expect(result.message).toStartWith(`Cannot read executable ${exe}.missing: `)
    }))

  test("prints usage unless given exactly two paths", () => {
    for (const argv of [[], ["a.exe"], ["a.exe", "b.ico", "c"]]) {
      expect(verify(argv)).toEqual({ code: 1, message: "Usage: verify-windows-icon.ts <exe> <ico>" })
    }
  })
})

describe("verify command as a process", () => {
  function run(exe: string, ico: string) {
    const result = Bun.spawnSync([process.execPath, "tools/build/verify-windows-icon.ts", exe, ico], {
      cwd: ROOT,
    })
    return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() }
  }

  test("exits 0 and reports on stdout when the icon is embedded", () =>
    withFiles([0, 1, 2], ({ exe, ico }) => {
      expect(run(exe, ico)).toEqual({
        code: 0,
        stdout: `Icon ${ico} is embedded in ${exe} (3 images).\n`,
        stderr: "",
      })
    }))

  test("exits 1 and reports on stderr when the icon is missing", () =>
    withFiles([1], ({ exe, ico }) => {
      expect(run(exe, ico)).toEqual({
        code: 1,
        stdout: "",
        stderr: `Icon ${ico} is not embedded in ${exe}. Missing images: 16x16, 256x256\n`,
      })
    }))
})
