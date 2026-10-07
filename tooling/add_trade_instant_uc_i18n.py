#!/usr/bin/env python3
"""add_trade_instant_uc_i18n.py — trade + instant-trade modal keys.

Adds trade.{uc_title,uc_amount,uc_price,uc_orders,uc_range,uc_total} and
instant.{uc_title,unlock_sign} with verbatim English defaults matching the
UnlockConfirm call sites, and removes the orphaned inline-row keys
(trade.password_label, trade.unlocking, instant.password, instant.unlock —
no call sites remain; instant.unlocked_repreview_note STAYS: the modal
keeps the re-review step), in all 12
vanilla/locales/*.json. Non-en dicts take honest English stubs.
_meta.translated inventories kept sorted, as check_i18n expects. Idempotent.

Stdlib only. Usage: python3 tooling/add_trade_instant_uc_i18n.py (from /workspace).
Then: python3 tooling/check_i18n.py (must print OK).
"""
import io
import json

LOCALES = ["en", "de", "es", "fr", "it", "ja", "ko", "ru", "tr", "zh", "hi", "pt"]

STALE_KEYS = [
    "trade.password_label",
    "trade.unlocking",
    "instant.password",
    "instant.unlock",
]

NEW_KEYS = {
    "trade.uc_title": "Unlock to continue",
    "trade.uc_amount": "Amount",
    "trade.uc_price": "Price",
    "trade.uc_orders": "Orders",
    "trade.uc_range": "Price range",
    "trade.uc_total": "Total to sell",
    "instant.uc_title": "Unlock to sign",
    "instant.unlock_sign": "Unlock & sign",
}

SECTIONS = {"trade": "trade", "instant": "instant"}


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
