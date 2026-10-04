#!/usr/bin/env python3
"""One-shot: tour away-note key (tester-report follow-up).

Adds tour.away_note ("On the Exchange desk — open it to see this
highlighted.") to all 12 vanilla/locales/*.json as honest English stubs
(principle #10 — translators verify later).

Exact string surgery only (no JSON round-trip, diffs stay minimal).
Safe to re-run. Verify with: python3 tooling/check_i18n.py
"""
import glob
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "vanilla", "locales")

STEPS = [
    # Dotted registry (alpha: first tour.* entry is tour.back).
    (re.compile(r'^(      "tour\.back",\n)', re.MULTILINE),
     '      "tour.away_note",\n\\1',
     '"tour.away_note"', False),
    # Tour dict (alpha: away_note before back).
    (re.compile(r'^(\s*"back": "Back",\n)', re.MULTILINE),
     '    "away_note": "On the Exchange desk \\u2014 open it to see this highlighted.",\n\\1',
     '"away_note": "On the Exchange desk', False),
]


def main():
    fails = []
    for path in sorted(glob.glob(os.path.join(LOCALES, "*.json"))):
        name = os.path.basename(path)
        # Dict step anchors on en's "back": "Back" — translated locales carry
        # their own value, so scope the dict regex per file below.
        try:
            src = open(path, encoding="utf-8").read()
        except OSError as e:
            fails.append("%s unreadable: %s" % (name, e))
            continue
        changed = False
        # Registry step (identical everywhere).
        rx, new, done_marker, _ = STEPS[0]
        if done_marker not in src:
            hits = rx.findall(src)
            if len(hits) != 1:
                fails.append("%s: registry anchor hits=%d" % (name, len(hits)))
                continue
            src = rx.sub(new, src)
            changed = True
        # Dict step (tour-scoped: s5_body precedes back only in tour).
        if '"away_note": "On the Exchange desk' not in src:
            rx2 = re.compile(r'^(\s*"s5_body": ".*",\n)(\s*"back": ".*",\n)', re.MULTILINE)
            hits2 = rx2.findall(src)
            if len(hits2) != 1:
                fails.append("%s: dict anchor hits=%d" % (name, len(hits2)))
                continue
            src = rx2.sub(
                '\\1    "away_note": "On the Exchange desk — open it to see this highlighted.",\n\\2',
                src)
            changed = True
        if changed:
            open(path, "w", encoding="utf-8").write(src)
            print("updated %s" % name)
    if fails:
        print("FAILURES:")
        for f in fails:
            print("  " + f)
        raise SystemExit(1)
    print("done")


if __name__ == "__main__":
    main()
