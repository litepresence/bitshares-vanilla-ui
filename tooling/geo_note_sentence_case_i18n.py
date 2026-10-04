#!/usr/bin/env python3
"""One-shot: geo_note sentence case (2026-10-04).

"*LOCATIONS and PROVIDERS come ..." -> "*Locations and providers come ..."
in all 12 vanilla/locales/*.json (identical honest stubs). Keys unchanged.
Safe to re-run. Verify with: python3 tooling/check_i18n.py
"""
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "vanilla", "locales")

OLD = '"geo_note": "*LOCATIONS and PROVIDERS come from '
NEW = '"geo_note": "*Locations and providers come from '
RX = re.compile(r'^    "geo_note": "\*LOCATIONS and PROVIDERS come from ', re.MULTILINE)


def main():
    fails = []
    for path in sorted(glob.glob(os.path.join(LOCALES, "*.json"))):
        name = os.path.basename(path)
        try:
            src = open(path, encoding="utf-8").read()
        except OSError as e:
            fails.append("%s unreadable: %s" % (name, e))
            continue
        if NEW in src:
            print("checked %s" % name)
            continue
        if len(RX.findall(src)) != 1:
            fails.append("%s: anchor hits!=1" % name)
            continue
        src = RX.sub('    ' + NEW, src)
        try:
            json.loads(src)
        except ValueError as e:
            fails.append("%s would break JSON: %s" % (name, e))
            continue
        open(path, "w", encoding="utf-8").write(src)
        print("checked %s (updated)" % name)
    if fails:
        print("\n".join(fails))
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
