#!/usr/bin/env python3
"""One-shot: Discrete timescale i18n keys (exchange + pool raw-fill plots).

Adds 6 keys with English defaults to all 12 vanilla/locales/*.json
(non-en dicts keep English = honest stubs, never machine-translated) +
every _meta.translated inventory (kept sorted, as check_i18n expects).
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
    ("market", "timeframe_label", {
        "market.tf_discrete": "Discrete",
        "market.discrete_fills": "fills",
        "market.discrete_swaps": "swaps",
        "market.discrete_unavailable": "Indicators unavailable in Discrete.",
        "market.discrete_no_fills": "No fills yet \u2014 place an order or try another pair.",
        "market.discrete_volume": "Discrete volume",
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


if __name__ == "__main__":
    main()
