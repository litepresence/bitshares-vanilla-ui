#!/usr/bin/env python3
"""One-shot: extension install-notice labels (2026-10-04).

Adds settings.sign_ext_present ("Extension detected on this device.") and
settings.sign_ext_absent ("No extension detected on this device — signatures
happen in this page.") to all 12 vanilla/locales/*.json as honest English
stubs (principle #10 — translators verify later).

Exact string surgery only. Safe to re-run. Verify with:
  python3 tooling/check_i18n.py
"""
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "vanilla", "locales")

MAN_RX = re.compile(r'^(      "settings\.sign_ext",\n)', re.MULTILINE)
MAN_NEW = ('\\1      "settings.sign_ext_absent",\n'
           '      "settings.sign_ext_present",\n')
DICT_RX = re.compile(r'^(    "sign_ext": ".*",\n)', re.MULTILINE)
DICT_NEW = ('\\1    "sign_ext_absent": "No extension detected on this device — signatures happen in this page.",\n'
            '    "sign_ext_present": "Extension detected on this device.",\n')


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
        if '"settings.sign_ext_absent"' not in src or '"settings.sign_ext_present"' not in src:
            if len(MAN_RX.findall(src)) != 1:
                fails.append("%s: manifest anchor hits!=1" % name)
                continue
            src = MAN_RX.sub(MAN_NEW, src)
            changed = True
        if '"sign_ext_absent": ' not in src or '"sign_ext_present": ' not in src:
            if len(DICT_RX.findall(src)) != 1:
                fails.append("%s: dict anchor hits!=1" % name)
                continue
            src = DICT_RX.sub(DICT_NEW, src)
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
