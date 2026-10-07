#!/usr/bin/env python3
"""add_discrete_tip_i18n.py — discrete hover-card label keys.

Adds 7 market.discrete_tip_* keys with verbatim English defaults matching
vanilla/js/api/discrete-charts.js tipLines() to all 12 vanilla/locales/*.json.
Non-en dicts are fully-translated (untranslated=false), so new keys land
allowlisted with honest English values; insert-if-missing only (never
clobbers refined translations). en.json _meta.translated inventory kept
sorted.

Stdlib only. Usage: python3 tooling/add_discrete_tip_i18n.py.
Then: python3 tooling/check_i18n.py (must print OK).
"""
import io
import json

LOCALES = ["en", "de", "es", "fr", "it", "ja", "ko", "ru", "tr", "zh", "hi", "pt"]

NEW_KEYS = {
    "market.discrete_tip_time": "Time",
    "market.discrete_tip_price": "Price",
    "market.discrete_tip_volume": "Volume",
    "market.discrete_tip_volume_quote": "Volume (quote)",
    "market.discrete_tip_account": "Account",
    "market.discrete_tip_order": "Order",
    "market.discrete_tip_block": "Block",
}


def main():
    for code in LOCALES:
        path = "vanilla/locales/%s.json" % code
        with io.open(path, encoding="utf-8") as f:
            data = json.load(f)
        section = data.get("market")
        if not isinstance(section, dict):
            print("market section MISSING in %s" % path)
            return 1
        for dotted, default in NEW_KEYS.items():
            key = dotted.split(".", 1)[1]
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
