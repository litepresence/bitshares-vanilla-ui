#!/usr/bin/env python3
"""add_unlockconfirm_i18n.py — shared unlock-confirm modal keys.

Adds unlockconfirm.{password,empty_password,unlock_failed} with verbatim
English defaults matching vanilla/js/ui/unlock-confirm.js t() calls, in all
12 vanilla/locales/*.json. Non-en dicts take honest English stubs (never
masquerade as translations). en.json _meta.translated inventory kept sorted,
as check_i18n expects. Idempotent: never clobbers existing values.

Stdlib only. Usage: python3 tooling/add_unlockconfirm_i18n.py (from /workspace).
Then: python3 tooling/check_i18n.py (must print OK).
"""
import io
import json

LOCALES = ["en", "de", "es", "fr", "it", "ja", "ko", "ru", "tr", "zh", "hi", "pt"]

NEW_KEYS = {
    "unlockconfirm.password": "Password",
    "unlockconfirm.empty_password": "Enter your wallet password.",
    "unlockconfirm.unlock_failed": "Unlock failed.",
    "unlockconfirm.cancel": "Back",
    "unlockconfirm.unlock_post": "Unlock & post",
}


def main():
    for code in LOCALES:
        path = "vanilla/locales/%s.json" % code
        with io.open(path, encoding="utf-8") as f:
            data = json.load(f)
        section = data.get("unlockconfirm")
        if not isinstance(section, dict):
            section = {}
            data["unlockconfirm"] = section
        for dotted, default in NEW_KEYS.items():
            key = dotted.split(".", 1)[1]
            if key not in section:
                section[key] = default
        meta = data.get("_meta")
        if isinstance(meta, dict) and isinstance(meta.get("translated"), list):
            inv = meta["translated"]
            for dotted in NEW_KEYS:
                if dotted not in inv:
                    inv.append(dotted)
            inv.sort()
        with io.open(path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print("updated %s" % path)


if __name__ == "__main__":
    main()
