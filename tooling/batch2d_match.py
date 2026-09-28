#!/usr/bin/env python3
"""Batch-2d reuse matcher (read-only audit aid).

For each of the 8 batch-2d files, lists every unique double-quoted literal
(counts + first line) alongside byte-identical en.json keys (if any), so the
worker reuses existing keys wherever byte-identical instead of minting.

Usage: python3 tooling/batch2d_match.py [substring-filter]
Read-only: never modifies sources.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
JS = os.path.join(HERE, "..", "vanilla", "js")
EN = os.path.join(HERE, "..", "vanilla", "locales", "en.json")

FILES = ["asset-ui.js", "asset-manage-ui.js", "asset-feed-ui.js",
         "htlc-ui.js", "debit-ui.js", "pool-ui.js",
         "pool-detail-ui.js", "pool-swap-ui.js"]

LIT_RE = re.compile(r'"((?:\\.|[^"\\])*)"')


def unesc(s):
    return s.replace('\\"', '"').replace("\\\\", "\\")


def flatten(d, prefix=""):
    out = {}
    for k, v in d.items():
        if k == "_meta":
            continue
        if isinstance(v, dict):
            out.update(flatten(v, prefix + k + "."))
        else:
            out[prefix + k] = v
    return out


def main():
    en_flat = flatten(json.load(open(EN, encoding="utf-8")))
    by_val = {}
    for k, v in en_flat.items():
        by_val.setdefault(v, []).append(k)
    filt = sys.argv[1] if len(sys.argv) > 1 else None
    for fname in FILES:
        src = open(os.path.join(JS, fname), encoding="utf-8").read().split("\n")
        seen = {}
        for i, line in enumerate(src, 1):
            s = line.strip()
            if (not s or s.startswith("//") or s.startswith("*")
                    or s.startswith("/*") or "console." in s):
                continue
            for m in LIT_RE.finditer(line):
                lit = unesc(m.group(1))
                if lit in ("use strict", ""):
                    continue
                if lit not in seen:
                    seen[lit] = [0, i]
                seen[lit][0] += 1
        print("=" * 100)
        print("## %s (%d unique literals)" % (fname, len(seen)))
        for lit, (n, ln) in sorted(seen.items(), key=lambda kv: kv[1][1]):
            if filt and filt not in lit:
                continue
            hits = by_val.get(lit)
            tag = "REUSE " + ",".join(sorted(hits)) if hits else "NEW?"
            print("  L%d x%d [%s] %r" % (ln, n, tag, lit[:110]))


if __name__ == "__main__":
    main()
