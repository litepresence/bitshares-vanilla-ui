#!/usr/bin/env python3
"""One-shot: explorer assets filter-memory honesty keys (Polish Task 7).

Adds 5 explorer.* keys to all 12 vanilla/locales/*.json as honest English
stubs (principle #10): the Showing count line + the three filter-mode names
shared by the radios and the line (single source, no drift).

Anchor-computed exact string surgery (no JSON round-trip, diffs stay
minimal), same convention as tooling/add_account_pager_i18n.py: dotted
registry line (_meta.translated) after its dotted anchor + dict entry
after its dict anchor. Safe to re-run. Verify with:
python3 tooling/check_i18n.py
"""
import glob
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "vanilla", "locales")

# (dict-key suffix, exact t() default — byte-identical to explorer-assets.js).
TABLE = [
    ("assets_showing", "Showing"),
    ("assets_of", "of"),
    ("assets_mode_market", "SmartCoins"),
    ("assets_mode_user", "User-Issued"),
    ("assets_mode_prediction", "Prediction"),
]

DICT_ANCHOR = "assets_failed"
REG_ANCHOR = "explorer.assets_failed"


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
        for k, label in TABLE:
            dotted = '"explorer.%s"' % k
            if dotted not in src:
                arx = re.compile(
                    r'^(      "%s",\n)' % re.escape(REG_ANCHOR),
                    re.MULTILINE)
                hits = arx.findall(src)
                if len(hits) != 1:
                    fails.append("%s: registry anchor %s hits=%d"
                                 % (name, REG_ANCHOR, len(hits)))
                    changed = None
                    break
                src = arx.sub(lambda m: m.group(1) + '      "explorer.%s",\n' % k,
                              src)
                changed = True
            # Dict entry after its dict anchor (anchor value differs per
            # locale — match the key prefix only, keep that locale's value).
            if ('"%s": "%s"' % (k, label)) not in src:
                arx2 = re.compile(r'^(    "%s": ".*",\n)' % re.escape(DICT_ANCHOR),
                                  re.MULTILINE)
                hits2 = arx2.findall(src)
                if len(hits2) != 1:
                    fails.append("%s: dict anchor %s hits=%d"
                                 % (name, DICT_ANCHOR, len(hits2)))
                    changed = None
                    break
                src = arx2.sub(lambda m: m.group(1) + '    "%s": "%s",\n' % (k, label),
                               src)
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
