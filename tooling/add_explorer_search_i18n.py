#!/usr/bin/env python3
"""Add the explorer search-mode empty-state key to all 12 vanilla locales.

Follows the add_market_net_i18n.py precedent: all dicts are
fully-translated (untranslated=false), so the new key lands allowlisted
with an honest English value. The _meta.translated inventory is kept
sorted in every dict, as check_i18n expects. Formatting matches the
committed files exactly (indent=2, raw UTF-8, trailing newline).

Idempotent: re-running reports existing keys and changes nothing.
"""
import io
import json
import sys

LOCALES = ["en", "de", "es", "fr", "it", "ja", "ko", "ru", "tr", "zh", "hi", "pt"]

# Verbatim I18n.t default from explorer-assets.js paintCached
# (check_i18n.py enforces byte-equality).
NEW_KEYS = {
    "explorer.no_assets_match": "No assets match \"%(q)s\".",
}


def main():
    for code in LOCALES:
        path = "vanilla/locales/%s.json" % code
        with io.open(path, encoding="utf-8") as f:
            data = json.load(f)
        changed = False
        for full, value in NEW_KEYS.items():
            section, _, key = full.partition(".")
            bucket = data.setdefault(section, {})
            if key not in bucket:
                bucket[key] = value
                changed = True
            elif bucket[key] != value:
                print("MISMATCH %s %s" % (path, full))
                return 1
            inv = data["_meta"]["translated"]
            if full not in inv:
                inv.append(full)
                changed = True
        data["_meta"]["translated"] = sorted(data["_meta"]["translated"])
        if changed:
            with io.open(path, "w", encoding="utf-8", newline="\n") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
                f.write("\n")
        print(("updated " if changed else "unchanged ") + path)
    return 0


if __name__ == "__main__":
    sys.exit(main())