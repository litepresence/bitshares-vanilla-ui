#!/usr/bin/env python3
"""One-shot: drop orphaned chain-pill locale keys (2026-10-04).

Removes settings.node_good/stale/suspect/forked (dict + _meta.translated)
from all 12 vanilla/locales/*.json. Sole JS consumer (chain-cell pill text)
died in the NETWORK/CHAIN merge; grep confirms zero remaining call sites.

Exact string surgery only (no JSON round-trip, diffs stay minimal).
Safe to re-run: finished files match nothing and are left untouched.
Aborts a file on an unexpected hit count. Verify with:
  python3 tooling/check_i18n.py
"""
import glob
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "vanilla", "locales")

# (pattern, replacement, absent_marker): skip file when absent_marker gone;
# else the pattern must hit exactly once. Dict values differ per locale
# (translated), so patterns match KEYS only.
DROPS = [
    (re.compile(r'^    "node_good": "[^"\n]*",\n', re.MULTILINE), '', '"node_good"'),
    (re.compile(r'^    "node_stale": "[^"\n]*",\n', re.MULTILINE), '', '"node_stale"'),
    (re.compile(r'^    "node_suspect": "[^"\n]*",\n', re.MULTILINE), '', '"node_suspect"'),
    (re.compile(r'^    "node_forked": "[^"\n]*",\n', re.MULTILINE), '', '"node_forked"'),
    (re.compile(r'^      "settings\.node_good",\n', re.MULTILINE), '', '"settings.node_good"'),
    (re.compile(r'^      "settings\.node_stale",\n', re.MULTILINE), '', '"settings.node_stale"'),
    (re.compile(r'^      "settings\.node_suspect",\n', re.MULTILINE), '', '"settings.node_suspect"'),
    (re.compile(r'^      "settings\.node_forked",\n', re.MULTILINE), '', '"settings.node_forked"'),
]


def main():
    paths = sorted(glob.glob(os.path.join(LOCALES, "*.json")))
    if len(paths) != 12:
        print("ABORT: expected 12 locale files, found %d" % len(paths))
        return 1
    for path in paths:
        with open(path, encoding="utf-8") as f:
            text = f.read()
        changed = False
        for pat, repl, gone in DROPS:
            if gone not in text:
                continue
            hits = len(pat.findall(text))
            if hits != 1:
                print("ABORT %s: %d hits" % (path, hits))
                return 1
            text = pat.sub(repl, text, count=1)
            changed = True
        if changed:
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)
            print("updated " + os.path.basename(path))
    print("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
