#!/usr/bin/env python3
"""Remove the standalone #/swap page's orphaned i18n keys + reword pool hints.

Swap-delete (2026-10-05): pool-swap-ui.js gone, menu/help entries gone,
pool-detail-view hints now point at the pool's own Swap panel. This script:
  1. Deletes 31 keys with zero remaining t() call sites (verified by grep
     for '"<key>"' across vanilla/js + vanilla/index.html before running).
  2. Rewords pool.swaps_hint / pool.my_swaps_hint in ALL 12 locales to the
     new English ("... from the Swap panel above ...") so no locale still
     points at the dead #/swap route. Non-en values become honest English
     fallbacks until human translators re-translate (reported as a concern).
  3. Prunes _meta.translated in every locale to the new key set.

Usage: python3 tooling/remove_swap_i18n.py
Exit 0 on success, 1 with problems. Idempotent.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "vanilla", "locales")
CODES = ["en", "es", "de", "fr", "hi", "it", "ja", "ko", "pt", "ru", "tr", "zh"]

# Dotted keys with zero remaining call sites (grep-verified 2026-10-05).
DELETE = [
    "pool.balances_for_the_sell_and_buy_assets_live_",
    "pool.block_col",
    "pool.buy_asset_field",
    "pool.create_stake_hint",
    "pool.err_not_in_pool",
    "pool.err_same_asset",
    "pool.event_col",
    "pool.events_hint",
    "pool.exchanges_title",
    "pool.find_failed",
    "pool.find_pool_hint",
    "pool.find_pools",
    "pool.hist_hint",
    "pool.history_failed",
    "pool.no_events",
    "pool.open_account_balances",
    "pool.pick_multi",
    "pool.pick_single",
    "pool.quote_failed",
    "pool.resolving",
    "pool.sell_asset_field",
    "pool.sell_col",
    "pool.swap_direction_label",
    "pool.swap_sub",
    "swap.quote_raw_prefix",
    "swap.min_raw_suffix",
    "menu.p_swap",
    "menu.d_swap",
    "help.topic_swap_title",
    "help.topic_swap_text",
    "help.topic_swap_body",
]

# New hint wording — byte-identical to pool-detail-view.js t() defaults.
REWORD = {
    "pool.swaps_hint": " Swaps appear after the first exchange in this pool \u2014 run one from the Swap panel above.",
    "pool.my_swaps_hint": " Run one from the Swap panel above \u2014 your swaps in this pool list here.",
}


def split(key):
    head, _, tail = key.partition(".")
    return head, tail


def main():
    problems = []
    for code in CODES:
        path = os.path.join(LOCALES, code + ".json")
        try:
            d = json.load(open(path, encoding="utf-8"))
        except (OSError, ValueError) as e:
            problems.append("%s unreadable: %s" % (code, e))
            continue
        for key in DELETE:
            head, tail = split(key)
            if head in d and isinstance(d[head], dict) and tail in d[head]:
                del d[head][tail]
            else:
                problems.append("%s: expected orphan key %s missing" % (code, key))
        for key, val in REWORD.items():
            head, tail = split(key)
            if head in d and isinstance(d[head], dict) and tail in d[head]:
                d[head][tail] = val
            else:
                problems.append("%s: expected hint key %s missing" % (code, key))
        # Prune _meta.translated to the live key set.
        live = set()
        for head, sub in d.items():
            if head == "_meta":
                continue
            if isinstance(sub, dict):
                for tail in sub:
                    live.add(head + "." + tail)
        meta = d.get("_meta") or {}
        meta["translated"] = sorted(live)
        d["_meta"] = meta
        # swap object must retain title only.
        if "swap" in d and isinstance(d["swap"], dict):
            extra = sorted(set(d["swap"]) - {"title"})
            if extra:
                problems.append("%s: swap object holds unexpected keys %s" % (code, extra))
        with open(path, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, indent=2, sort_keys=False)
            f.write("\n")
    if problems:
        print("FAIL:")
        print("\n".join(problems))
        return 1
    print("OK: deleted %d keys, reworded %d hints across %d locales." % (len(DELETE), len(REWORD), len(CODES)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
