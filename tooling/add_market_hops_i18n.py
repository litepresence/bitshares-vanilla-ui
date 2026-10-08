#!/usr/bin/env python3
"""Add the market-hops i18n keys to all 12 vanilla locales.

Follows the add_market_net_i18n.py precedent: all dicts are
fully-translated (untranslated=false), so new keys land allowlisted with
honest English values — translators refine wording, never keys. The
_meta.translated inventory is kept sorted in every dict, as check_i18n
expects (a fully-translated dict's allowlist must cover every key).

Formatting matches the committed files exactly (indent=2, raw UTF-8,
trailing newline) so the diff stays minimal.

Idempotent: re-running reports existing keys and changes nothing.
"""
import io
import json
import sys

LOCALES = ["en", "de", "es", "fr", "it", "ja", "ko", "ru", "tr", "zh", "hi", "pt"]

# Verbatim I18n.t defaults from the call sites (check_i18n.py enforces
# byte-equality; any transcription slip here fails that gate).
NEW_KEYS = {
    # pool-net-chrome.js edgeCard / verdict (market branch), pool-net-ui.js
    # mountMarketGraph status
    "market_net.map_hops_ready": "%(pairs)s pairs · %(assets)s assets · 24h fills",
    "market_net.map_fallback": "%(pairs)s pairs · %(assets)s assets · 24h fills unconfirmed",
    "market_net.edge_card_fills": "%(desk)s · %(a)s–%(b)s · %(fills)s fills/24h",
    "market_net.edge_card_price": "@ %(price)s",
    "market_net.verdict_web": "Markets reachable from %(s)s: %(n)s",
    "market_net.verdict_path": "%(a)s reaches %(b)s in %(n)s filled markets",
    "market_net.verdict_no_path": "No filled-market route between %(a)s and %(b)s",
    "market_net.ramp_fills": "24h fills: low → high",
    # pool-graph.js drawGraph market branch + market-desk-fill.js note
    "market.map_hops_note": "A line is a market that filled in the past 24 hours. %(pairs)s pairs shown.",
    "market.map_hops_no_route": "No route to BTS through filled markets.",
    "market.map_hops_empty": "No market filled in the past 24 hours around these legs.",
    "market.map_aria": "Market network. Lines are markets that filled in the past 24 hours.",
    "market.map_edge_fills": "%(desk)s · %(a)s–%(b)s · %(fills)s fills/24h",
    "market.map_edge_price": "@ %(price)s · %(vol)s",
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
                print("MISMATCH %s %s: %r != %r" % (path, full, bucket[key], value))
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