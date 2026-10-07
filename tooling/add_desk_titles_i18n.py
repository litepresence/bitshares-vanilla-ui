#!/usr/bin/env python3
"""add_desk_titles_i18n.py — Swap Desk / Exchange Desk header keys.

Adds pool.swap_desk ("Swap Desk") + market.exchange_desk ("Exchange Desk")
with verbatim English defaults to all 12 vanilla/locales/*.json. Non-en
dicts are fully-translated (untranslated=false), so new keys land allowlisted
with honest English values. en.json _meta.translated inventory kept sorted.

Stdlib only. Usage: python3 tooling/add_desk_titles_i18n.py.
Then: python3 tooling/check_i18n.py (must print OK).
"""
import io
import json

LOCALES = ["en", "de", "es", "fr", "it", "ja", "ko", "ru", "tr", "zh", "hi", "pt"]

NEW_KEYS = {
    "pool.swap_desk": "Swap Desk",
    "market.exchange_desk": "Exchange Desk",
}


def main():
    for code in LOCALES:
        path = "vanilla/locales/%s.json" % code
        with io.open(path, encoding="utf-8") as f:
            data = json.load(f)
        for dotted, default in NEW_KEYS.items():
            section_name, key = dotted.split(".", 1)
            section = data.get(section_name)
            if not isinstance(section, dict):
                print("section %s MISSING in %s" % (section_name, path))
                return 1
            if key not in section:
                section[key] = default
        meta = data.get("_meta")
        if isinstance(meta, dict) and isinstance(meta.get("translated"), list):
            inv = meta["translated"]
            for dotted in NEW_KEYS:
                if dotted not in inv:
                    inv.append(dotted)
            inv.sort()
        with io.open(path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print("updated %s" % path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
