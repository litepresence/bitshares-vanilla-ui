#!/usr/bin/env python3
"""add_credit_borrow_pool_debit_uc_i18n.py — credit/borrow/pool/debit modal keys.

Adds credit.uc_title, borrow.uc_title, pool.{uc_title,uc_action} and
debit.{uc_title,uc_order} with verbatim English defaults matching the
UnlockConfirm call sites, and removes the orphaned inline-row keys
(credit.password, credit.unlock, pool.unlock_notice — no call sites remain;
borrow.password/borrow.unlock STAY: prediction-flows.js still uses them
until batch 6), in all 12 vanilla/locales/*.json. Non-en dicts take honest
English stubs. _meta.translated inventories kept sorted. Idempotent.

Stdlib only. Usage: python3 tooling/add_credit_borrow_pool_debit_uc_i18n.py (from /workspace).
Then: python3 tooling/check_i18n.py (must print OK).
"""
import io
import json

LOCALES = ["en", "de", "es", "fr", "it", "ja", "ko", "ru", "tr", "zh", "hi", "pt"]

STALE_KEYS = [
    "credit.password",
    "credit.unlock",
    "pool.unlock_notice",
]

NEW_KEYS = {
    "credit.uc_title": "Unlock to sign",
    "borrow.uc_title": "Unlock to sign",
    "pool.uc_title": "Unlock to continue",
    "pool.uc_action": "Action",
    "debit.uc_title": "Unlock to sign",
    "debit.uc_order": "Order",
}


def main():
    for code in LOCALES:
        path = "vanilla/locales/%s.json" % code
        with io.open(path, encoding="utf-8") as f:
            data = json.load(f)
        for dotted in STALE_KEYS:
            section_name, key = dotted.split(".", 1)
            section = data.get(section_name)
            if isinstance(section, dict) and key in section:
                del section[key]
        for dotted, default in NEW_KEYS.items():
            section_name, key = dotted.split(".", 1)
            section = data.get(section_name)
            if not isinstance(section, dict):
                print("%s section MISSING in %s" % (section_name, path))
                return 1
            if key not in section:
                section[key] = default
        meta = data.get("_meta")
        if isinstance(meta, dict) and isinstance(meta.get("translated"), list):
            inv = meta["translated"]
            for dotted in STALE_KEYS:
                if dotted in inv:
                    inv.remove(dotted)
            for dotted in NEW_KEYS:
                if dotted not in inv:
                    inv.append(dotted)
            inv.sort()
        with io.open(path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print("updated %s" % path)


if __name__ == "__main__":
    main()
