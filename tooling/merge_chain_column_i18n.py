#!/usr/bin/env python3
"""One-shot: merge NETWORK into CHAIN column i18n (2026-10-04).

Adds settings.network_devnet ("devnet") and DROPS settings.th_network
(header retired with the column) across all 12 vanilla/locales/*.json
as honest English stubs (principle #10). MAINNET/TESTNET reuse
settings.network_mainnet/testnet (rendered caps via CSS); chain states
are verbatim values, never translated.

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

ADDS = [
    # (pattern, replacement, done_marker)
    (re.compile(r'^    "network_mainnet": "mainnet",\n', re.MULTILINE),
     '    "network_devnet": "devnet",\n    "network_mainnet": "mainnet",\n',
     '"network_devnet"'),
    (re.compile(r'^      "settings\.network_mainnet",\n', re.MULTILINE),
     '      "settings.network_devnet",\n      "settings.network_mainnet",\n',
     '"settings.network_devnet"'),
]
DROPS = [
    # (pattern, replacement, absent_marker): skip when absent_marker gone.
    (re.compile(r'^    "th_location": "Location \*",\n    "th_network": "Network",\n', re.MULTILINE),
     '    "th_location": "Location *",\n',
     '"th_network"'),
    (re.compile(r'^      "settings\.th_network",\n', re.MULTILINE),
     '',
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
        for pat, repl, marker in ADDS:
            if marker in text:
                continue
            hits = len(pat.findall(text))
            if hits != 1:
                print("ABORT %s: add hits %d" % (path, hits))
                return 1
            text = pat.sub(repl, text, count=1)
            changed = True
        for pat, repl, gone in DROPS:
            if gone not in text:
                continue
            hits = len(pat.findall(text))
            if hits != 1:
                print("ABORT %s: drop hits %d" % (path, hits))
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
