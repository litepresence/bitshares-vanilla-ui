#!/usr/bin/env python3
"""Generate extension-wrapper toolbar icons (stdlib only, reproducible).
Blue (#049cce, the ref-ui button blue) square + white 5x7 bitmap "B".
Writes extension-wrapper/icons/icon{16,32,48,128}.png. Rerun anytime:
output is byte-stable (no timestamps in PNG)."""
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "extension-wrapper", "icons")

BLUE = (4, 156, 206)
WHITE = (255, 255, 255)

# 5x7 "B" (classic bitmap, hand-encoded public-domain letterform).
B = [
    "XXXX.",
    "X...X",
    "X...X",
    "XXXX.",
    "X...X",
    "X...X",
    "XXXX.",
]


def chunk(typ, data):
    c = typ + data
    return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)


def png(size):
    cell = max(1, size // 9)
    gw, gh = 5 * cell, 7 * cell
    ox, oy = (size - gw) // 2, (size - gh) // 2
    raw = b""
    for y in range(size):
        raw += b"\x00"
        for x in range(size):
            col, row = (x - ox) // cell, (y - oy) // cell
            if cell > 0 and 0 <= col < 5 and 0 <= row < 7 and ox >= 0 and oy >= 0:
                px = B[row][col] == "X"
            else:
                px = False
            c = WHITE if px else BLUE
            raw += bytes((c[0], c[1], c[2], 255))
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) +
            chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def main():
    os.makedirs(OUT, exist_ok=True)
    for size in (16, 32, 48, 128):
        with open(os.path.join(OUT, "icon%d.png" % size), "wb") as fh:
            fh.write(png(size))
        print("icon%d.png ok" % size)


if __name__ == "__main__":
    main()
