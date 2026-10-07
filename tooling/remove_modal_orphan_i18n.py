#!/usr/bin/env python3
"""remove_modal_orphan_i18n.py — drops keys orphaned by the unlock-confirm migration.

Removes barter.wallet_is_locked_enter_your_password_to_conti (pool unlockBox
was its last caller) and transfer.unlocking (transfer preview/propose status
lines are gone) — zero call sites remain (verified by grep). Idempotent.

Stdlib only. Usage: python3 tooling/remove_modal_orphan_i18n.py (from /workspace).
Then: python3 tooling/check_i18n.py (must print OK).
"""
import io
import json

LOCALES = ["en", "de", "es", "fr", "it", "ja", "ko", "ru", "tr", "zh", "hi", "pt"]

STALE_KEYS = [
    "barter.wallet_is_locked_enter_your_password_to_conti",
    "transfer.unlocking",
]


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
        meta = data.get("_meta")
        if isinstance(meta, dict) and isinstance(meta.get("translated"), list):
            inv = meta["translated"]
            for dotted in STALE_KEYS:
                if dotted in inv:
                    inv.remove(dotted)
        with io.open(path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print("updated %s" % path)


if __name__ == "__main__":
    main()
