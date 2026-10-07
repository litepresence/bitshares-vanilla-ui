#!/usr/bin/env python3
"""add_desk_volume_map_i18n.py — desk volume-map keys (market_net.*).

Adds the 11 market-mode band keys with verbatim English defaults matching
vanilla/js/views/pool-net-ui.js + pool-net-chrome.js t() calls, in all 12
vanilla/locales/*.json. Non-en dicts take honest English stubs.
en.json _meta.translated inventory kept sorted, as check_i18n expects.
Idempotent: never clobbers existing values.

Stdlib only. Usage: python3 tooling/add_desk_volume_map_i18n.py (from /workspace).
Then: python3 tooling/check_i18n.py (must print OK).
"""
import io
import json

LOCALES = ["en", "de", "es", "fr", "it", "ja", "ko", "ru", "tr", "zh", "hi", "pt"]

NEW_KEYS = {
    "market_net.map_ready": "%(markets)s markets · %(assets)s assets",
    "market_net.map_empty": "No markets with recent volume.",
    "market_net.verdict_full": "%(markets)s markets · %(assets)s assets",
    "market_net.verdict_star": "Markets touching %(s)s: %(n)s",
    "market_net.node_card": "%(sym)s (%(id)s) · %(n)s markets",
    "market_net.edge_card": "%(desk)s · %(a)s–%(b)s · %(vol)s",
    "market_net.twin": "Market rows (%(n)s)",
    "market_net.col_market": "Market",
    "market_net.twin_more": "Showing %(shown)s of %(n)s markets — narrow the filter to see fewer.",
    "market_net.canvas_label": "Market network map. Press Enter to open the market.",
    "market_net.prompt": "Tap a node for the asset, a line for the market.",
}


def main():
    for code in LOCALES:
        path = "vanilla/locales/%s.json" % code
        with io.open(path, encoding="utf-8") as f:
            data = json.load(f)
        section = data.get("market_net")
        if not isinstance(section, dict):
            print("market_net section MISSING in %s" % path)
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
        print("updated %s" % path)


if __name__ == "__main__":
    main()
