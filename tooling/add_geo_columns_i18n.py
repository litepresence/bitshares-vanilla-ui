#!/usr/bin/env python3
"""One-shot: node-table Location + Provider columns (2026-10-04).

Adds settings.th_location ("Location"), settings.th_provider ("Provider")
and settings.geo_note (ip-api privacy disclosure) to all 12
vanilla/locales/*.json as honest English stubs (principle #10 —
translators verify later).

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

# (pattern, replacement, done_marker, missing_ok)
STEPS = [
    # geo_note source switch (ip-api http-blocked everywhere by our CSP ->
    # ipaddress.to over https). Done-marker is the new text.
    (re.compile(r'^    "geo_note": "Node locations and providers come from ip-api\.com \(plain http, no key\) — it sees your address when asked; answers cache on this device for 30 days\.",\n', re.MULTILINE),
     '    "geo_note": "Node locations and providers come from ipaddress.to (https, no key) — it sees your address when asked; answers cache on this device for 30 days.",\n',
     '"geo_note": "Node locations and providers come from ipaddress.to', False),
    # _meta.translated: geo_note with the g-keys (before hist_no).
    (re.compile(r'^(      "settings\.hist_no",\n)', re.MULTILINE),
     '      "settings.geo_note",\n\\1',
     '"settings.geo_note"', False),
    # _meta.translated, alpha order: th_history, th_location, th_node ...
    # (th_location < th_node; th_provider sits th_ping-adjacent below).
    (re.compile(r'^(      "settings\.th_history",\n)(      "settings\.th_node",\n)',
                re.MULTILINE),
     '\\1      "settings.th_location",\n\\2',
     '"settings.th_location"', False),
    (re.compile(r'^(      "settings\.th_ping",\n)', re.MULTILINE),
     '\\1      "settings.th_provider",\n',
     '"settings.th_provider"', False),
    # settings dict: th_location after th_history; th_provider after th_ping.
    (re.compile(r'^(    "th_history": "History",\n)', re.MULTILINE),
     '\\1    "th_location": "Location",\n',
     '"th_location"', False),
    (re.compile(r'^(    "th_ping": "Ping",\n)', re.MULTILINE),
     '\\1    "th_provider": "Provider",\n',
     '"th_provider"', False),
    # settings dict: geo_note after the history pill labels (alpha: geo
    # lives with the g-keys — anchor on hist_no which precedes them).
    (re.compile(r'^(    "hist_no": "NO",\n)', re.MULTILINE),
     '\\1    "geo_note": "Node locations and providers come from ip-api.com (plain http, no key) — it sees your address when asked; answers cache on this device for 30 days.",\n',
     '"geo_note"', False),
]


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
        for rx, new, done_marker, missing_ok in STEPS:
            if done_marker in src:
                continue
            hits = rx.findall(src)
            if len(hits) != 1:
                if missing_ok and not hits:
                    continue
                fails.append("%s: %r hits=%d (want 1)"
                             % (name, rx.pattern[:44], len(hits)))
                changed = None
                break
            src = rx.sub(new, src)
            changed = True
        if changed is None:
            continue
        if changed:
            open(path, "w", encoding="utf-8").write(src)
        print("checked %s%s" % (name, " (updated)" if changed else ""))
    if fails:
        print("\n".join(fails))
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
