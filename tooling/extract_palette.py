#!/usr/bin/env python3
"""Extract the COMPLETE resolved color palette from the reference UI's theme
SCSS files (dark/light/midnight) into vanilla/assets/PALETTE.md.

Resolves $variable references plus darken()/lighten() so every entry is a
final hex value — the exact colors (and fonts) each page uses. Rerunnable:
  python3 tooling/extract_palette.py
Stdlib only.
"""
import colorsys
import os
import re

WORKSPACE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THEME_DIR = os.path.join(WORKSPACE, "bitshares-ui/app/assets/stylesheets/themes")
STYLE_DIR = os.path.join(WORKSPACE, "bitshares-ui/app/assets/stylesheets")
OUT = os.path.join(WORKSPACE, "vanilla/assets/PALETTE.md")
THEMES = ["dark", "light", "midnight"]


def is_hex(value):
    """Hex color literal, 3 or 6 digits (expand shorthand for adjust())."""
    m = re.match(r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$", value or "")
    if not m:
        return None
    h = m.group(1)
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return "#" + h.lower()


def adjust_any(base, percent, lighten):
    """adjust() extended to rgba() bases (alpha preserved, Sass semantics)."""
    m = re.match(
        r"^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)"
        r"(?:\s*,\s*([\d.]+))?\s*\)$", base or "")
    if m:
        r, g, b = float(m.group(1)) / 255.0, float(m.group(2)) / 255.0, float(m.group(3)) / 255.0
        h, li, s = colorsys.rgb_to_hls(r, g, b)
        li = li + percent / 100.0 if lighten else li - percent / 100.0
        li = max(0.0, min(1.0, li))
        nr, ng, nb = colorsys.hls_to_rgb(h, li, s)
        rgb = "%d, %d, %d" % (round(nr * 255), round(ng * 255), round(nb * 255))
        if m.group(4) is None:
            return "rgb(%s)" % rgb
        return "rgba(%s, %s)" % (rgb, m.group(4))
    base = is_hex(base) or base
    if is_hex(base):
        return adjust(base, percent, lighten)
    return None
    """Hex color literal, 3 or 6 digits (expand shorthand for adjust())."""
    m = re.match(r"^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$", value or "")
    if not m:
        return None
    h = m.group(1)
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return "#" + h.lower()


def hex_to_rgb(h):
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def rgb_to_hex(r, g, b):
    return "#%02x%02x%02x" % (
        max(0, min(255, round(r * 255))),
        max(0, min(255, round(g * 255))),
        max(0, min(255, round(b * 255))),
    )


def adjust(hex_color, percent, lighten):
    r, g, b = hex_to_rgb(hex_color)
    h, li, s = colorsys.rgb_to_hls(r, g, b)
    # Sass darken/lighten shift HSL lightness by percentage POINTS.
    li = li + percent / 100.0 if lighten else li - percent / 100.0
    li = max(0.0, min(1.0, li))
    return rgb_to_hex(*colorsys.hls_to_rgb(h, li, s))


def parse_theme(path):
    """Return (ordered_names, raw_dict) of $var assignments in a theme file."""
    names, raw = [], {}
    text = open(path).read()
    text = re.sub(r"//.*", "", text)  # strip line comments
    for m in re.finditer(r"\$([a-zA-Z0-9_-]+)\s*:\s*([^;]+);", text):
        name, value = m.group(1), m.group(2).strip()
        value = re.sub(r"\s*!default\s*$", "", value).strip()
        if name not in raw:
            names.append(name)
        raw[name] = value
    return names, raw


def resolve(value, raw, depth=0):
    """Resolve $refs + darken()/lighten() to a final value (or best effort)."""
    if depth > 20 or not isinstance(value, str):
        return value
    prev = None
    cur = value
    while prev != cur and depth < 20:
        prev = cur
        depth += 1
        m = re.match(r"darken\(\s*(\$[a-zA-Z0-9_-]+|#[0-9a-fA-F]{3,6}|rgba?\([^)]*\))\s*,\s*([\d.]+)%\s*\)$", cur)
        if m:
            base = resolve(m.group(1), raw, depth)
            done = adjust_any(base, float(m.group(2)), False)
            return done if done is not None else cur
        m = re.match(r"lighten\(\s*(\$[a-zA-Z0-9_-]+|#[0-9a-fA-F]{3,6}|rgba?\([^)]*\))\s*,\s*([\d.]+)%\s*\)$", cur)
        if m:
            base = resolve(m.group(1), raw, depth)
            done = adjust_any(base, float(m.group(2)), True)
            return done if done is not None else cur
        cur = re.sub(r"\$([a-zA-Z0-9_-]+)",
                     lambda mm: raw.get(mm.group(1), mm.group(0)), cur)
        # Nested calls inside larger values (e.g. box-shadows): resolve in place.
        def _sub(pat, light):
            def rep(mm):
                done = adjust_any(resolve(mm.group(1), raw, depth + 1),
                                  float(mm.group(2)), light)
                return done if done is not None else mm.group(0)
            return re.sub(pat, rep, cur)
        cur = _sub(r"darken\(\s*(\$[a-zA-Z0-9_-]+|#[0-9a-fA-F]{3,6}|rgba?\([^)]*\))\s*,\s*([\d.]+)%\s*\)", False)
        cur = _sub(r"lighten\(\s*(\$[a-zA-Z0-9_-]+|#[0-9a-fA-F]{3,6}|rgba?\([^)]*\))\s*,\s*([\d.]+)%\s*\)", True)
    return cur


def font_stacks():
    """Unique font-family stacks across all reference stylesheets."""
    found = {}
    for dirpath, _, filenames in os.walk(STYLE_DIR):
        for fn in filenames:
            if not fn.endswith((".scss", ".css")):
                continue
            text = open(os.path.join(dirpath, fn)).read()
            for m in re.finditer(r"font-family\s*:\s*([^;}]+)", text):
                stack = re.sub(r"\s+", " ", m.group(1)).strip()
                found[stack] = found.get(stack, 0) + 1
    return sorted(found.items(), key=lambda kv: -kv[1])


def main():
    themes = {}
    for theme in THEMES:
        names, raw = parse_theme(os.path.join(THEME_DIR, "_%s-theme.scss" % theme))
        themes[theme] = (names, {k: resolve(v, raw) for k, v in raw.items()})
    all_names = []
    for theme in THEMES:
        for name in themes[theme][0]:
            if name not in all_names:
                all_names.append(name)

    lines = []
    lines.append("# Reference UI palette (resolved)")
    lines.append("")
    lines.append("Extracted from `bitshares-ui/app/assets/stylesheets/themes/` by")
    lines.append("`tooling/extract_palette.py` — every `$variable` resolved through")
    lines.append("references + `darken()`/`lighten()` to its final value, per theme.")
    lines.append("Use these exact values when pixel-matching slices (principle #2).")
    lines.append("")
    lines.append("| variable | dark | light | midnight |")
    lines.append("|---|---|---|---|")
    for name in all_names:
        row = [name] + [themes[t][1].get(name, "—") for t in THEMES]
        lines.append("| " + " | ".join(row) + " |")
    lines.append("")
    lines.append("## Font stacks (by frequency across reference stylesheets)")
    lines.append("")
    for stack, count in font_stacks():
        lines.append("- (%dx) `%s`" % (count, stack))
    lines.append("")
    open(OUT, "w").write("\n".join(lines) + "\n")
    print("vars: %d, themes: %s" % (len(all_names), ",".join(THEMES)))
    print("wrote %s" % OUT)


if __name__ == "__main__":
    main()
