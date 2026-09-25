# Data Model: Custom Icon for the Windows Executable

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

This feature stores no application data. The only "data" is the icon file and the
verifier's view of it.

## Application icon (`assets/icon.ico`)

The one authoritative copy of the icon (spec Key Entities, FR-003). It is a standard
Windows `.ico` file, all integers little-endian.

| Part | Layout | Rule the verifier enforces |
| ---- | ------ | -------------------------- |
| Header | 6 bytes: `reserved` u16, `type` u16, `count` u16 | `reserved` = 0, `type` = 1 (icon, not cursor), `count` >= 1 |
| Directory | `count` entries of 16 bytes each, straight after the header | the whole directory fits in the file |
| Entry | `width` u8, `height` u8 (0 means 256), `colours` u8, `reserved` u8, `planes` u16, `bitsPerPixel` u16, `size` u32, `offset` u32 | `size` > 0, and `offset + size` <= file length |
| Image | `size` bytes at `offset`: a PNG or a DIB bitmap | not interpreted; copied into the executable unchanged |

The committed file has ten entries, all 32 bits per pixel, of 16, 20, 24, 32, 40, 48, 64,
96, 128 and 256 pixels square (FR-002). A unit test pins these sizes, so replacing the
file with one that lacks sizes is a deliberate change that has to update the test.

## Icon image (verifier's working value)

What `readIcoImages` returns for each directory entry, and what `findMissingImages`
checks for in the executable.

| Field | Meaning |
| ----- | ------- |
| `width` | pixels, with the `0` byte already turned into 256 |
| `height` | pixels, as for `width` |
| `bitsPerPixel` | colour depth, as stored |
| `data` | the image's bytes (`size` bytes starting at `offset`) |

## Verification outcome

`findMissingImages(exe, images)` returns the images whose `data` does not occur in the
executable's bytes. The empty list means the icon is embedded. Anything else fails the
build (FR-006), and the message lists the missing images as `WxH` so a partial embed is
visible.
