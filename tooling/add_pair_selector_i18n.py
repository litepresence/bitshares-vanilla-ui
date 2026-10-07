#!/usr/bin/env python3
"""add_pair_selector_i18n.py — selector-ladder copy keys.

Adds the 5 keys the parallel Markets/Pools selector ladder needs
(nav.markets, market_net.selector_title, pools.selector_title,
seo.title_markets, seo.desc_markets) to all 12 vanilla/locales/*.json.

Non-en dicts get the verbatim English value (unverified strings stay
English until a human verifies them — principle #10), so every new key is
allowlisted as a stub and stub-honest. insert-if-missing only: never
clobbers a refined translation. en.json _meta.translated inventory kept
sorted. `nav.exchange` ("Exchange", verified in 12 dicts) is deliberately
KEPT even though the navbar now uses `nav.markets` — its translations are
correct translations of the word "Exchange" and must not be destroyed.

Stdlib only. Usage: python3 tooling/add_pair_selector_i18n.py
Then: python3 tooling/check_i18n.py (must print OK).
"""
import io
import json

LOCALES = ["en", "de", "es", "fr", "it", "ja", "ko", "ru", "tr", "zh", "hi", "pt"]

NEW_KEYS = {
    "nav.markets": "Markets",
    "market_net.selector_title": "Market Selector",
    "pools.selector_title": "Pool Selector",
    "seo.title_markets": "Markets — BitShares Wallet",
    "seo.desc_markets": "Browse BitShares order-book markets by 24h volume and open any pair's trading desk. No login needed.",
}


def main():
    for code in LOCALES:
        path = "vanilla/locales/%s.json" % code
        with io.open(path, encoding="utf-8") as f:
            data = json.load(f)
        added = []
        for dotted, default in NEW_KEYS.items():
            section_name, key = dotted.split(".", 1)
            section = data.get(section_name)
            if not isinstance(section, dict):
                print("%s section MISSING in %s" % (section_name, path))
                return 1
            if key not in section:
                section[key] = default
                added.append(dotted)
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
        print("updated %s (%d added)" % (path, len(added)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
