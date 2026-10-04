#!/usr/bin/env python3
"""One-shot: node-remove confirm strings (2026-10-04).

Adds 7 settings.confirm_* keys (remove title/action/hide/unlist/result/
switch/back) to all 12 vanilla/locales/*.json as honest English stubs
(principle #10 — translators verify later). Send button reuses
settings.remove; row terms reuse settings.th_node.

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

KEYS = [
    '    "confirm_back": "Back",\n',
    '    "confirm_remove_action": "Action",\n',
    '    "confirm_remove_hide": "Hide this node (stays hidden until re-added)",\n',
    '    "confirm_remove_result": "Result",\n',
    '    "confirm_remove_switch": "Active node moves to %(node)s",\n',
    '    "confirm_remove_title": "Remove node?",\n',
    '    "confirm_remove_unlist": "Remove from my list",\n',
]
LISTED = [
    '      "settings.confirm_back",\n',
    '      "settings.confirm_remove_action",\n',
    '      "settings.confirm_remove_hide",\n',
    '      "settings.confirm_remove_result",\n',
    '      "settings.confirm_remove_switch",\n',
    '      "settings.confirm_remove_title",\n',
    '      "settings.confirm_remove_unlist",\n',
]

# (pattern, replacement, done_marker); exactly one hit unless done.
STEPS = [
    # dict: after th_provider+remove (key-only match — values translated).
    (re.compile(r'^(    "th_provider": "[^"\n]*",\n    "remove": "[^"\n]*",\n)', re.MULTILINE),
     '\\1' + ''.join(KEYS),
     '"confirm_remove_title"'),
    # _meta.translated, alpha order (confirm_* < connecting).
    (re.compile(r'^(      "settings\.connecting",\n)(      "settings\.custom_placeholder",\n)', re.MULTILINE),
     '\\1' + ''.join(LISTED) + '\\2',
     '"settings.confirm_remove_title"'),
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
