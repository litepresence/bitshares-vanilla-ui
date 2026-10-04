#!/usr/bin/env python3
"""One-shot: footer build-info + network-prefix keys (2026-10-04).

Adds 11 shell.* keys (footer_brand_vanilla, footer_ahead/_one,
footer_behind/_one, footer_dahead, footer_dbehind, footer_diverged,
footer_net_host, footer_offbranch, footer_sync) to all 12
vanilla/locales/*.json as honest English stubs (principle #10 -
translators verify later). "Master" needs no key: it is the branch-name
identifier and stays byte-verbatim everywhere.

Exact string surgery only (no JSON round-trip, diffs stay minimal).
Safe to re-run: finished files match no pattern and are left untouched.
Aborts a file on an unexpected hit count. Verify with:
  python3 tooling/check_i18n.py
"""
import glob
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "vanilla", "locales")

DICT_BLOCK = ('    "footer_brand": "BITSHARES",\n'
              '    "footer_brand_vanilla": "BITSHARES VANILLA UI",\n'
              '    "footer_ahead": "%(n)s commits ahead of",\n'
              '    "footer_ahead_one": "1 commit ahead of",\n'
              '    "footer_behind": "%(n)s commits behind",\n'
              '    "footer_behind_one": "1 commit behind",\n'
              '    "footer_dahead": "%(n)s ahead",\n'
              '    "footer_dbehind": "%(n)s behind",\n'
              '    "footer_diverged": "diverged from",\n'
              '    "footer_net_host": "%(net)s - %(host)s",\n'
              '    "footer_offbranch": "not on Master",\n'
              '    "footer_sync": "in sync with"\n')

BEFORE_BLOCK = ('      "shell.footer_ahead",\n'
                '      "shell.footer_ahead_one",\n'
                '      "shell.footer_behind",\n'
                '      "shell.footer_behind_one",\n'
                '      "shell.footer_brand",\n')

AFTER_BLOCK = ('      "shell.footer_brand",\n'
               '      "shell.footer_brand_vanilla",\n'
               '      "shell.footer_dahead",\n'
               '      "shell.footer_dbehind",\n'
               '      "shell.footer_diverged",\n'
               '      "shell.footer_net_host",\n'
               '      "shell.footer_offbranch",\n'
               '      "shell.footer_sync",\n')

# (pattern, replacement, done_marker); every file must hit exactly once
# unless its done_marker is already present.
STEPS = [
    (re.compile(r'^    "footer_brand": "BITSHARES"\n', re.MULTILINE),
     DICT_BLOCK, '"footer_sync": "in sync with"'),
    (re.compile(r'^      "shell\.footer_brand",\n', re.MULTILINE),
     BEFORE_BLOCK, '"shell.footer_ahead"'),
    (re.compile(r'^      "shell\.footer_brand",\n', re.MULTILINE),
     AFTER_BLOCK, '"shell.footer_sync"'),
]

# NOTE: step 2 inserts BEFORE the brand line and step 3 appends AFTER it;
# both match the surviving original line exactly once (inserted lines
# differ), so sequential application is order-safe.


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
