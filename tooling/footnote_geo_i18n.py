#!/usr/bin/env python3
"""One-shot: footnote markers on node-table geo strings (2026-10-04).

Appends */** footnote markers (user-specified copy):
  settings.th_location  -> "Location *"            (was honest stub)
  settings.th_provider   -> "Provider *"            (was honest stub)
  settings.discover      -> translated value + " **" (translation kept,
                             marker is not language)
  settings.discover_note -> "**Find nodes searches ..." (full English stub —
                             the "Optional:" lead changed meaning, so old
                             translations are stale; translators re-verify)
  settings.geo_note      -> "*LOCATIONS and PROVIDERS come from ..."
                             (was honest stub)
All 12 vanilla/locales/*.json. Keys unchanged (no manifest edits).

Exact string surgery only. Safe to re-run. Validates JSON per file.
Verify with: python3 tooling/check_i18n.py
"""
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "vanilla", "locales")

EN_TH_LOCATION = '    "th_location": "Location *",\n'
EN_TH_PROVIDER = '    "th_provider": "Provider *",\n'
EN_DISCOVER_NOTE = ('    "discover_note": "**Find nodes searches GitHub for node lists, then probes what it finds. '
                    'GitHub and probed nodes see your network address. Results are candidates for your review — '
                    'nothing is added automatically.",\n')
EN_GEO_NOTE = ('    "geo_note": "*LOCATIONS and PROVIDERS come from ipaddress.to (https, no key) — it sees your '
               'address when asked; answers cache on this device for 30 days.",\n')

DISCOVER_LINE = re.compile(r'^    "discover": "(.*)",\n', re.MULTILINE)
DISCOVER_NOTE_LINE = re.compile(r'^    "discover_note": ".*",\n', re.MULTILINE)


def patch(name, src):
    """Returns (new_src, changed) or raises on unexpected shape."""
    # 1-2. stub headers (en + all stubs share the pre-marker English text).
    for pre, post in [('    "th_location": "Location",\n', EN_TH_LOCATION),
                      ('    "th_provider": "Provider",\n', EN_TH_PROVIDER)]:
        if post in src:
            pass
        elif src.count(pre) != 1:
            raise ValueError("%s: header anchor hits=%d" % (name, src.count(pre)))
        else:
            src = src.replace(pre, post)
    # 3. discover button: keep translation, append the marker.
    m = DISCOVER_LINE.search(src)
    if not m:
        raise ValueError("%s: discover line missing" % name)
    if not m.group(1).endswith(" **"):
        src = src[:m.start()] + '    "discover": "' + m.group(1) + ' **",\n' + src[m.end():]
    # 4. discover note: full stub (old translations of "Optional:" are stale).
    if EN_DISCOVER_NOTE not in src:
        if len(DISCOVER_NOTE_LINE.findall(src)) != 1:
            raise ValueError("%s: discover_note hits!=1" % name)
        src = DISCOVER_NOTE_LINE.sub(EN_DISCOVER_NOTE, src)
    # 5. geo note: full stub.
    if EN_GEO_NOTE not in src:
        pre = ('    "geo_note": "Node locations and providers come from ipaddress.to (https, no key) — it sees your '
               'address when asked; answers cache on this device for 30 days.",\n')
        if src.count(pre) != 1:
            raise ValueError("%s: geo_note anchor hits!=1" % name)
        src = src.replace(pre, EN_GEO_NOTE)
    return src


def main():
    fails = []
    for path in sorted(glob.glob(os.path.join(LOCALES, "*.json"))):
        name = os.path.basename(path)
        try:
            src = open(path, encoding="utf-8").read()
        except OSError as e:
            fails.append("%s unreadable: %s" % (name, e))
            continue
        try:
            new = patch(name, src)
        except ValueError as e:
            fails.append(str(e))
            continue
        if new != src:
            try:
                json.loads(new)
            except ValueError as e:
                fails.append("%s would break JSON: %s" % (name, e))
                continue
            open(path, "w", encoding="utf-8").write(new)
            print("checked %s (updated)" % name)
        else:
            print("checked %s" % name)
    if fails:
        print("\n".join(fails))
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
