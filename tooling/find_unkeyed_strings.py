#!/usr/bin/env python3
"""Find user-visible string literals NOT routed through t() (principle #10).

Scans vanilla/js/**/*.js + vanilla/index.html for DOM text sinks assigned
plain string literals: textContent, innerText, .placeholder/.title/.alt/
aria-label assignments, createTextNode("..."), and option/button labels.
Skips: t(...) calls, empty strings, pure punctuation/numbers, URLs, object
IDs (1.2.x), CSS values, console.* / error-object internals, and test seams.

Output: file:line + snippet, grouped by file with a total. Exit 0 always
(measurement, not a gate) — triage decides what gets keyed.

Usage: python3 tooling/find_unkeyed_strings.py [--short]
"""
import glob
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOTS = [os.path.join(HERE, "..", "vanilla", "js"),
         os.path.join(HERE, "..", "vanilla", "index.html")]

SINK_RE = re.compile(
    r"""(?:\.(?:textContent|innerText|placeholder|title|alt)\s*=\s*"""
    r"""|setAttribute\(\s*["'](?:aria-label|title|alt|placeholder)["']\s*,\s*"""
    r"""|createTextNode\(\s*"""
    r"""|new\s+Option\(\s*)"""
    r"""(["'])((?:\\.|(?!\1)[^\\])*)\1"""
)
T_CALL = re.compile(r"""\bt\(\s*["']""")
SKIP_RE = re.compile(
    r"""^(?:\s*|[….,:;!?\-–—/()\[\]{}*+=<>|~^%$#@&\\'"`0-9xX\s]*|"""
    r"""https?://\S*|wss?://\S*|#(?:/[\w\-./?=&%]*)?|1\.\d+\.\d+|"""
    r"""[\w\-./]+\.(?:js|css|png|svg|ico|json)|\d[\d.,%]*\s*[a-zA-Z%]*|"""
    r"""true|false|null|undefined)$"""
)


def main():
    short = "--short" in sys.argv
    files = []
    for root in ROOTS:
        if os.path.isdir(root):
            files.extend(glob.glob(os.path.join(root, "**", "*.js"), recursive=True))
        else:
            files.append(root)
    total = 0
    per_file = {}
    for path in sorted(files):
        if "sdk" + os.sep + "vendor" in path or "sdk/vendor" in path:
            continue  # vendored libs are never touched (audit target, not source)
        try:
            lines = open(path, encoding="utf-8").read().splitlines()
        except OSError:
            continue
        hits = []
        for i, ln in enumerate(lines, 1):
            if "t(" in ln and T_CALL.search(ln):
                continue
            for m in SINK_RE.finditer(ln):
                lit = m.group(2).replace('\\"', '"').replace("\\'", "'")
                if not lit or not re.search(r"[A-Za-z\u00c0-\u024f]", lit):
                    continue
                if SKIP_RE.match(lit.strip()):
                    continue
                hits.append((i, lit.strip()[:90]))
        if hits:
            per_file[os.path.relpath(path, HERE + "/..")] = hits
            total += len(hits)
    for f, hits in per_file.items():
        print("%s (%d)" % (f, len(hits)))
        if not short:
            for ln, lit in hits[:25]:
                print("  %d: %s" % (ln, lit))
            if len(hits) > 25:
                print("  ... +%d more" % (len(hits) - 25))
    print("TOTAL UNKEYED: %d in %d files" % (total, len(per_file)))


if __name__ == "__main__":
    main()
