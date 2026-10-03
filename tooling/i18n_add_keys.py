#!/usr/bin/env python3
"""i18n_add_keys.py — one-shot batch key inserter (Phase 3 precedent, reusable).

Adds NEW settings-namespace keys with English values to all 10
vanilla/locales/*.json (non-en dicts keep English = honest stubs, never
machine-translated) + en.json _meta.translated inventory (kept sorted, as
check_i18n expects). Stdlib only. Usage: python3 tooling/i18n_add_keys.py.
Fails non-zero if any dict lacks the anchor or check_i18n would go red.
"""
import io
import json
import sys

LOCALES = ["en", "de", "es", "fr", "it", "ja", "ko", "ru", "tr", "zh"]

# Batches: (namespace, anchor-key, {full.key: english-default}). New keys go
# after the anchor; en inventory kept sorted. Non-en dicts keep English
# (honest stubs, never machine-translated).
BATCHES = [
    ("settings", "network_testnet", {
        "settings.hist_yes": "History",
        "settings.hist_no": "No history",
        "settings.es_title": "Community history index",
        "settings.es_toggle": "Enable community history (ElasticSearch)",
        "settings.es_note": "Run by the community, not by this wallet — questions: t.me/bitsharesDEV. Turn off to use chain history only.",
        "settings.testnet_hist": "Testnet: node history works here, but the community index covers mainnet only — index-powered features are unavailable.",
    }),
    ("market", "no_price_history", {
        "market.load_deeper": "Load deeper history",
        "market.back_to_live": "Back to live trades",
    }),
    ("borrow", "blank_wallet_account", {
        "borrow.my_settlements": "My settlements",
        "borrow.my_settlements_hint": "Force-settlement orders waiting at the feed price — yours or any account's, reads are public.",
        "borrow.my_settlements_empty": "No open settlements for this account.",
        "borrow.settlements_unavailable": "Settlements unavailable on this node — switch nodes in Settings.",
    }),
]


def apply_batch(data, ns, anchor, new_keys):
    """Insert one batch into data[ns] after anchor (position-preserving
    value sync; reruns self-heal to the script values, which must mirror
    the t() defaults byte-for-byte). Returns True if the anchor existed."""
    section = data.get(ns)
    if not isinstance(section, dict) or anchor not in section:
        return False
    shorts = {}
    for full, v in new_keys.items():
        shorts[full.split(".", 1)[1]] = v
    rebuilt = {}
    for key, val in section.items():
        rebuilt[key] = shorts.get(key, val)
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
        if code != "en":
            pass  # inventory lives in en.json only (W1 precedent)
        else:
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
