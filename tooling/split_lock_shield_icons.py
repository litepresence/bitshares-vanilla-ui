#!/usr/bin/env python3
"""Split the user-supplied 2x2 lock/shield sheet into transparent PNGs.

Source: 17911209250103.png (1280x720, white background; user-provided art,
see vanilla/assets/PROVENANCE.md):
  top-left     green shield + check  -> shield-ok.png
  top-right    red shield + X        -> shield-bad.png
  bottom-left  red padlock (locked)  -> lock-closed.png
  bottom-right green padlock (open)  -> lock-open.png

Method: quadrant split -> content bbox (non-white pixels) with padding ->
edge flood-fill (corners + edge midpoints, small threshold) turning only
background-connected white transparent. White glyphs INSIDE the icons
(check/X/keyhole) survive because flood fill never crosses the icon edge.
Outputs land in vanilla/assets/icons/ as RGBA PNGs.

Requires: pip install pillow (one-off dev tool, never shipped).
Rerun: python3 tooling/split_lock_shield_icons.py
"""
import os
import sys

try:
    from PIL import Image, ImageDraw, ImageChops
except ImportError:
    print("need pillow: pip install pillow")
    sys.exit(1)

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "vanilla", "assets", "icons",
                     "_source-lock-shield-4up.png")
OUTDIR = os.path.join(HERE, "..", "vanilla", "assets", "icons")

QUADS = {
    # name: (left, upper, right, lower) in source pixels
    "shield-ok": (0, 0, 640, 360),
    "shield-bad": (640, 0, 1280, 360),
    "lock-closed": (0, 360, 640, 720),
    "lock-open": (640, 360, 640 + 640, 720),
}
PAD = 10
WHITE_THRESH = 12  # near-white background tolerance (keeps drop shadows)


def content_bbox(tile):
    grey = tile.convert("L")
    diff = ImageChops.difference(grey, Image.new("L", grey.size, 255))
    bbox = diff.point(lambda v: 255 if v > WHITE_THRESH else 0).getbbox()
    if not bbox:
        return (0, 0) + tile.size
    l, u, r, b = bbox
    l = max(0, l - PAD)
    u = max(0, u - PAD)
    r = min(tile.size[0], r + PAD)
    b = min(tile.size[1], b + PAD)
    return (l, u, r, b)


def clear_background(img):
    img = img.convert("RGBA")
    w, h = img.size
    seeds = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1),
             (w // 2, 0), (w // 2, h - 1), (0, h // 2), (w - 1, h // 2)]
    for xy in seeds:
        try:
            ImageDraw.floodfill(img, xy, (0, 0, 0, 0), thresh=WHITE_THRESH)
        except Exception:
            pass
    return img


def main():
    if not os.path.exists(SRC):
        print("missing source: %s" % SRC)
        return 1
    base = Image.open(SRC)
    print("source: %s %s" % (base.size, base.mode))
    w, h = base.size
    quads = {
        "shield-ok": (0, 0, w // 2, h // 2),
        "shield-bad": (w // 2, 0, w, h // 2),
        "lock-closed": (0, h // 2, w // 2, h),
        "lock-open": (w // 2, h // 2, w, h),
    }
    for name in sorted(quads):
        box = quads[name]
        tile = base.crop(box)
        tile = tile.crop(content_bbox(tile))
        tile = clear_background(tile)
        # Header glyphs render at 18px (54px at 3x retina): downscale to a
        # 96px bounding box (LANCZOS) so the four files stay small; the
        # full-res sheet stays in _source-*-4up.png for any larger use.
        try:
            tile.thumbnail((96, 96), Image.LANCZOS)
        except Exception:
            pass
        # Sanity: corners must be transparent, center opaque.
        w, h = tile.size
        px = tile.load()
        corners_clear = all(px[x, y][3] == 0 for x, y in
                            [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)])
        center_solid = px[w // 2, h // 2][3] > 0
        out = os.path.join(OUTDIR, name + ".png")
        tile.save(out)
        print("%-12s %s corners-clear=%s center-solid=%s" %
              (name + ".png", tile.size, corners_clear, center_solid))
        if not (corners_clear and center_solid):
            print("  WARNING: sanity check failed for %s" % name)
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
