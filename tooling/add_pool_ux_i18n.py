#!/usr/bin/env python3
"""One-shot: pool-desk UX gaps i18n keys (swap flip + chart invert + stake
auto-fill preview).

Adds 10 keys with English defaults to all 12 vanilla/locales/*.json
(non-en dicts keep English = honest stubs, never machine-translated) +
en.json _meta.translated inventory (kept sorted, as check_i18n expects).
Reuses apply_batch from i18n_add_keys (anchored insert, position-preserving
value sync). Stdlib only. Safe to re-run.
Verify with: python3 tooling/check_i18n.py
"""
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from i18n_add_keys import apply_batch, LOCALES  # noqa: E402

BATCHES = [
    ("pool_detail", "pool_map", {
        "pool_detail.invert": "Invert",
        "pool_detail.invert_label": "Invert chart orientation (A-per-B / B-per-A)",
    }),
    ("pool", "spot_row", {
        "pool.swap_direction_label": "Swap sell and buy assets",
        "pool.stake_autofill_hint": "Type one amount \u2014 the other auto-fills at pool ratio.",
        "pool.stake_ratio_row": "Ratio (spot)",
        "pool.stake_ratio_empty": "Pool is empty \u2014 enter both amounts by hand.",
        "pool.stake_shares_row": "Est. LP shares",
        "pool.stake_preview_need_both": "Enter both amounts for a share estimate.",
        "pool.stake_preview_unavailable": "Share estimate unavailable (offline).",
        "pool.stake_preview_bad": "Check the amounts \u2014 no share estimate.",
    }),
]


def main():
    for code in LOCALES:
        path = os.path.join(HERE, "..", "vanilla", "locales", "%s.json" % code)
        with io.open(path, encoding="utf-8") as f:
            data = json.load(f)
        for ns, anchor, new_keys in BATCHES:
            if not apply_batch(data, ns, anchor, new_keys):
                print("ANCHOR %s.%s MISSING in %s" % (ns, anchor, path))
                return 1
        # Inventory lives in EVERY dict (check_i18n fully-translated branch:
        # each allowlist must cover all keys; non-en values stay honest
        # English stubs outside their verified translations).
        inv = data["_meta"]["translated"]
        for _, _, new_keys in BATCHES:
            for full in new_keys:
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
