#!/usr/bin/env python3
"""One-shot: geo cache TTL 30 days -> 24 hours (2026-10-04).

Rewords settings.geo_note in all 12 vanilla/locales/*.json (identical
honest stubs). Keys unchanged. Safe to re-run. Verify with:
  python3 tooling/check_i18n.py
"""
import glob
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "vanilla", "locales")

OLD = 'answers cache on this device for 30 days.'
NEW = 'answers cache on this device for 24 hours.'
RX = re.compile(r'^    "geo_note": "(.*)answers cache on this device for 30 days\.",\n', re.MULTILINE)


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
        hits = RX.findall(src)
        if len(hits) != 1:
            fails.append("%s: geo_note anchor hits=%d (want 1)" % (name, len(hits)))
            continue
        src = RX.sub(lambda m: '    "geo_note": "' + m.group(1) + NEW + '",\n', src)
        try:
            import json
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
