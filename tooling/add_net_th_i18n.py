#!/usr/bin/env python3
"""One-shot: node-table NETWORK column header (2026-10-04).

Adds settings.th_network ("Network") to all 12 vanilla/locales/*.json
as honest English stubs (principle #10 — translators verify later).
MAINNET/TESTNET cell words reuse settings.network_mainnet/testnet;
chain prefixes and dashes are verbatim values, never translated.

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

# (pattern, replacement, done_marker); every file must hit exactly once
# unless its done_marker is already present.
STEPS = [
    # dict: th_network after th_location (anchors verified byte-identical
    # in en/de 2026-10-04; runner aborts any file that differs).
    (re.compile(r'^    "th_location": "Location \*",\n', re.MULTILINE),
     '    "th_location": "Location *",\n    "th_network": "Network",\n',
     '"th_network"'),
    # _meta.translated, alpha order (th_location < th_network < th_node).
    (re.compile(r'^(      "settings\.th_location",\n)(      "settings\.th_node",\n)',
                re.MULTILINE),
     '\\1      "settings.th_network",\n\\2',
     '"settings.th_network"'),
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
        for pat, repl, marker in STEPS:
            if marker in text:
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
