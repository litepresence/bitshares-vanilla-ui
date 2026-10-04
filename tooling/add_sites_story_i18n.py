#!/usr/bin/env python3
"""One-shot: connected-sites story labels (2026-10-04).

Adds settings.sign_sites_story_a ("Example: a dice game at ") and
settings.sign_sites_story_b (" asks to play as ... fictional example.")
to all 12 vanilla/locales/*.json as honest English stubs (principle #10).
Keys unchanged otherwise. Safe to re-run. Verify with:
  python3 tooling/check_i18n.py
"""
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "vanilla", "locales")

MAN_RX = re.compile(r'^(      "settings\.sign_sites",\n)', re.MULTILINE)
MAN_NEW = ('\\1      "settings.sign_sites_story_a",\n'
           '      "settings.sign_sites_story_b",\n')
DICT_RX = re.compile(r'^(    "sign_sites": ".*",\n)', re.MULTILINE)
DICT_A = '    "sign_sites_story_a": "Example: a dice game at ",\n'
DICT_B = '    "sign_sites_story_b": " asks to play as your account — approving lists it here, bound to that account only. Signatures still prompt every time. (That link goes nowhere — it is a fictional example.)",\n'


def main():
    fails = []
    for path in sorted(glob.glob(os.path.join(LOCALES, "*.json"))):
        name = os.path.basename(path)
        try:
            src = open(path, encoding="utf-8").read()
        except OSError as e:
            fails.append("%s unreadable: %s" % (name, e))
            continue
        changed = False
        if '"settings.sign_sites_story_a"' not in src or '"settings.sign_sites_story_b"' not in src:
            if len(MAN_RX.findall(src)) != 1:
                fails.append("%s: manifest anchor hits!=1" % name)
                continue
            src = MAN_RX.sub(MAN_NEW, src)
            changed = True
        if '"sign_sites_story_a": ' not in src or '"sign_sites_story_b": ' not in src:
            if len(DICT_RX.findall(src)) != 1:
                fails.append("%s: dict anchor hits!=1" % name)
                continue
            src = DICT_RX.sub('\\1' + DICT_A + DICT_B, src)
            changed = True
        if changed:
            try:
                json.loads(src)
            except ValueError as e:
                fails.append("%s would break JSON: %s" % (name, e))
                continue
            open(path, "w", encoding="utf-8").write(src)
        print("checked %s%s" % (name, " (updated)" if changed else ""))
    if fails:
        print("\n".join(fails))
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
