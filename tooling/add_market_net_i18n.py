#!/usr/bin/env python3
"""add_market_net_i18n.py — markets landing Task 3 key inserter.

Adds 20 NEW market_net.* keys with verbatim English defaults matching
vanilla/js/views/market-net-ui.js I18n.t calls to all 12
vanilla/locales/*.json. All dicts are fully-translated
(untranslated=false), so new keys land allowlisted with honest English
values — translators refine wording, never keys. en.json
_meta.translated inventory kept sorted, as check_i18n expects.

Stdlib only. Usage: python3 tooling/add_market_net_i18n.py.
Then: python3 tooling/check_i18n.py (must print OK).
"""
import io
import json
import sys

LOCALES = ["en", "de", "es", "fr", "it", "ja", "ko", "ru", "tr", "zh", "hi", "pt"]

# Verbatim I18n.t defaults from market-net-ui.js (check_i18n.py enforces
# byte-equality; any transcription slip here fails that gate).
NEW_KEYS = {
    "market_net.title": "Markets",
    "market_net.subtitle": "Top order-book markets by 24h volume. Pick a row to open the desk.",
    "market_net.asset_1_field": "Asset 1 (any leg)",
    "market_net.asset_2_field": "Asset 2 (any leg)",
    "market_net.list_btn": "List markets",
    "market_net.clear_btn": "Clear",
    "market_net.loading": "Loading markets\u2026",
    "market_net.empty": "No markets found for this filter.",
    "market_net.offline": "Network unavailable \u2014 showing cached markets. Retry when connected.",
    "market_net.col_market": "Market",
    "market_net.col_last": "Last",
    "market_net.col_change": "24h \u0394",
    "market_net.col_vol": "24h vol",
    "market_net.col_spark": "7d",
    "market_net.top_note": "Top %(shown)s of %(probed)s probed \u2014 by 24h volume.",
    "market_net.band_title": "Market network",
    "market_net.collapse": "Collapse",
    "market_net.expand": "Expand",
    "market_net.open_desk": "Open %(id)s",
    "market_net.spark_label": "7-day trend for %(id)s",
}


def main():
    for code in LOCALES:
        path = "vanilla/locales/%s.json" % code
        with io.open(path, encoding="utf-8") as f:
            data = json.load(f)
        if "market_net" in data:
            print("market_net ALREADY PRESENT in %s" % path)
            return 1
        section = {}
        for full, v in NEW_KEYS.items():
            section[full.split(".", 1)[1]] = v
        data["market_net"] = section
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
