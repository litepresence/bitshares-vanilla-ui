#!/usr/bin/env python3
"""add_map_connects_i18n.py — desk-map connects-definition key inserter.

Adds 4 NEW keys with verbatim English defaults matching the
market-desk-fill.js / pool-detail-view.js I18n.t calls to all 12
vanilla/locales/*.json, and retitles market.loading_pool_map to the
label-free "Loading map…" (pane headings removed by owner decision).
Non-en dicts keep honest English stubs (never machine-translated);
en.json _meta.translated inventory kept sorted, as check_i18n expects.

Stdlib only. Usage: python3 tooling/add_map_connects_i18n.py.
Then: python3 tooling/check_i18n.py (must print OK).
"""
import io
import json
import sys

LOCALES = ["en", "de", "es", "fr", "it", "ja", "ko", "ru", "tr", "zh", "hi", "pt"]

# Verbatim I18n.t defaults from the view calls (check_i18n.py enforces
# byte-equality; any transcription slip here fails that gate).
NEW_KEYS = {
    "market.map_connects":
        "A line connects two assets when there has been a market trade in the past 24 hours.",
    "market.map_connects_fallback":
        "A line connects two assets when a funded pool exists. 24h trade activity is unconfirmed (history unavailable) \u2014 showing funded pools.",
    "pool_detail.map_connects":
        "A line connects two assets when a funded pool exists and there has been a trade in the past 24 hours.",
    "pool_detail.map_connects_fallback":
        "A line connects two assets when a funded pool exists. 24h trade activity is unconfirmed (history unavailable) \u2014 showing funded pools.",
}

# Existing value retitled alongside (pane headings removed; the transient
# loading line must not reintroduce the dropped label).
RETITLED = {
    "market.loading_pool_map": "Loading map\u2026",
}


def main():
    for code in LOCALES:
        path = "vanilla/locales/%s.json" % code
        with io.open(path, encoding="utf-8") as f:
            data = json.load(f)
        for full, v in NEW_KEYS.items():
            section, _, sub = full.partition(".")
            if section not in data or not isinstance(data[section], dict):
                print("MISSING section %s in %s" % (section, path))
                return 1
            if sub in data[section]:
                print("%s ALREADY PRESENT in %s" % (full, path))
                return 1
            data[section][sub] = v
        for full, v in RETITLED.items():
            section, _, sub = full.partition(".")
            data[section][sub] = v
        inv = data["_meta"]["translated"]
        for full in NEW_KEYS:
            if full not in inv:
                inv.append(full)
        inv.sort()
        with io.open(path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print("updated %s" % path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
