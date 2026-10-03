#!/usr/bin/env python3
"""Add an en-identical key to every vanilla locale dict (honest stubs).

Usage: python3 tooling/sync_locale_keys.py <section> <key> <en-value>
Example: python3 tooling/sync_locale_keys.py shell lock Lock

Writes the key with the en value into all 12 dicts (stubs stay honest;
translators upgrade values later + list them in _meta.translated).
Also appends the dotted key to en.json _meta.translated.
Preserves trailing newline. Exit 0 on success.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "vanilla", "locales")
CODES = ["en", "es", "de", "fr", "it", "ja", "ko", "ru", "tr", "zh", "hi", "pt"]


def main():
    if len(sys.argv) != 4:
        print(__doc__)
        return 2
    section, key, value = sys.argv[1], sys.argv[2], sys.argv[3]
    for code in CODES:
        path = os.path.join(LOCALES, code + ".json")
        with open(path, encoding="utf-8") as fh:
            d = json.load(fh)
        d.setdefault(section, {})[key] = value
        if code == "en":
            tr = d["_meta"].setdefault("translated", [])
            dotted = section + "." + key
            if dotted not in tr:
                tr.append(dotted)
        text = json.dumps(d, ensure_ascii=False, indent=2)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
        print(code, "ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
