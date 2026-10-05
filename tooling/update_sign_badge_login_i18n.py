#!/usr/bin/env python3
"""One-shot: shield badge copy retarget Settings -> Login (2026-10-05).

Rewords settings.sign_badge ("Extension signing active — details in
Settings" -> "... details in Login") and settings.sign_badge_local
("In-page signing — details in Settings" -> "... details in Login") in
all 12 vanilla/locales/*.json as honest English stubs (principle #10 —
translators verify later). The badge lands on #/login since the signing
relocation (d71e5b8), so "in Settings" misdirects.

Exact string surgery only. Safe to re-run. Verify with:
  python3 tooling/check_i18n.py
"""
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "vanilla", "locales")

OLD_ROUTED = "Extension signing active \u2014 details in Settings"
NEW_ROUTED = "Extension signing active \u2014 details in Login"
OLD_LOCAL = "In-page signing \u2014 details in Settings"
NEW_LOCAL = "In-page signing \u2014 details in Login"


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
        if OLD_ROUTED in src:
            src = src.replace(OLD_ROUTED, NEW_ROUTED)
            changed = True
        if OLD_LOCAL in src:
            src = src.replace(OLD_LOCAL, NEW_LOCAL)
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
