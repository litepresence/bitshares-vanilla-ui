#!/usr/bin/env python3
"""add_pool_net_band_i18n.py — Task 5 key inserter (pool-net map plan).

Adds 7 NEW keys with English values to all 12 vanilla/locales/*.json
(non-en dicts keep English = honest stubs, never machine-translated) +
en.json _meta.translated inventory (kept sorted, as check_i18n expects).

Keys:
  pool.asset_1_field / pool.asset_2_field — order-free search legs
    ("Asset 1 (any leg)"; the create form keeps positional asset_a/b_field).
  pool.clear_btn — filter Clear button.
  pool_net.title / collapse / expand / loading — band header + placeholder
    (Task 7 adds the remaining pool_net.* keys: offline, verdicts, legend).

Stdlib only. Usage: python3 tooling/add_pool_net_band_i18n.py.
"""
import io
import json
import sys

LOCALES = ["en", "de", "es", "fr", "it", "ja", "ko", "ru", "tr", "zh", "hi", "pt"]

BATCHES = [
    ("pool", "list_btn", {
        "pool.asset_1_field": "Asset 1 (any leg)",
        "pool.asset_2_field": "Asset 2 (any leg)",
        "pool.clear_btn": "Clear",
    }),
    ("pool_net", None, {
        "pool_net.title": "Pool network",
        "pool_net.collapse": "Collapse",
        "pool_net.expand": "Expand",
        "pool_net.loading": "Loading network\u2026",
    }),
]


def apply_batch(data, ns, anchor, new_keys):
    """Insert one batch into data[ns] after anchor. anchor None creates a
    fresh namespace. Returns True if applied."""
    created = False
    if ns not in data or not isinstance(data.get(ns), dict):
        data[ns] = {}
        created = True
    section = data[ns]
    if not created and anchor is not None and len(section) > 0 and anchor not in section:
        return False
    shorts = {}
    for full, v in new_keys.items():
        shorts[full.split(".", 1)[1]] = v
    if created or len(section) == 0:
        data[ns] = dict(shorts)
        return True
    rebuilt = {}
    for key, val in section.items():
        # Idempotent: never clobber an existing key (refined
        # non-English translations survive re-runs); only missing
        # keys are inserted after the anchor below.
        rebuilt[key] = val
        if key == anchor:
            for short, v in shorts.items():
                if short not in section:
                    rebuilt[short] = v
    data[ns] = rebuilt
    return True


def main():
    for code in LOCALES:
        path = "vanilla/locales/%s.json" % code
        with io.open(path, encoding="utf-8") as f:
            data = json.load(f)
        for ns, anchor, new_keys in BATCHES:
            if not apply_batch(data, ns, anchor, new_keys):
                print("ANCHOR %s.%s MISSING in %s" % (ns, anchor, path))
                return 1
        if code == "en":
            inv = data["_meta"]["translated"]
            for _, _, new_keys in BATCHES:
                for full in new_keys:
                    if full not in inv:
                        inv.append(full)
            inv.sort()
        elif data.get("_meta", {}).get("untranslated") is False:
            # Fully-translated dict (wave-1+): allowlist must cover every key
            # (check_i18n). New keys land allowlisted with honest English
            # values — translators refine wording, never keys.
            inv2 = data["_meta"]["translated"]
            for _, _, new_keys in BATCHES:
                for full in new_keys:
                    if full not in inv2:
                        inv2.append(full)
            inv2.sort()
        # Pure stubs (untranslated=true, translated=[]) need no inventory:
        # their new-key values already equal en (honest stubs).
        with io.open(path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print("updated %s" % path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
