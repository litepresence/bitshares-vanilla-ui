#!/usr/bin/env python3
"""One-shot: pools share-field 1.19.x hint key (tester-report follow-up).

Adds pool.share_or_pool_hint ("symbol, 1.3.x, or pool 1.19.x") to all 12
vanilla/locales/*.json as honest English stubs (principle #10 —
translators verify later).

Exact string surgery only (no JSON round-trip, diffs stay minimal).
Safe to re-run. Verify with: python3 tooling/check_i18n.py
"""
import glob
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "vanilla", "locales")

STEPS = [
    # Dotted call-site registry (alpha: share_help < share_or_pool_hint < share_ph).
    (re.compile(r'^(      "pool\.share_help",\n)', re.MULTILINE),
     '\\1      "pool.share_or_pool_hint",\n',
     '"pool.share_or_pool_hint"', False),
    # Pool dict (same alpha slot; done-marker pins the dict colon+value so
    # the dotted registry line above is not a substring trap).
    (re.compile(r'^(    "share_help": ".*",\n)', re.MULTILINE),
     '\\1    "share_or_pool_hint": "symbol, 1.3.x, or pool 1.19.x",\n',
     '"share_or_pool_hint": "symbol, 1.3.x, or pool 1.19.x"', False),
    # Direct-hit note (alpha: depth_unavailable < direct_hit < err_not_in_pool).
    (re.compile(r'^(      "pool\.depth_unavailable",\n)', re.MULTILINE),
     '\\1      "pool.direct_hit",\n',
     '"pool.direct_hit"', False),
    (re.compile(r'^(    "depth_unavailable": ".*",\n)', re.MULTILINE),
     '\\1    "direct_hit": "Direct pool lookup — pager hidden.",\n',
     '"direct_hit": "Direct pool lookup', False),
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
            print("updated %s" % name)
    if fails:
        print("FAILURES:")
        for f in fails:
            print("  " + f)
        raise SystemExit(1)
    print("done")


if __name__ == "__main__":
    main()
