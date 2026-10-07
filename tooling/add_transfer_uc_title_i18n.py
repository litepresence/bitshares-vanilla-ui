#!/usr/bin/env python3
"""add_transfer_uc_title_i18n.py — transfer modal title key.

Adds transfer.uc_title with verbatim English default matching
vanilla/js/views/transfer-preview.js + transfer-propose.js t() calls, in
all 12 vanilla/locales/*.json. Non-en dicts take honest English stubs.
en.json _meta.translated inventory kept sorted, as check_i18n expects.
Idempotent.

Stdlib only. Usage: python3 tooling/add_transfer_uc_title_i18n.py (from /workspace).
Then: python3 tooling/check_i18n.py (must print OK).
"""
import io
import json

LOCALES = ["en", "de", "es", "fr", "it", "ja", "ko", "ru", "tr", "zh", "hi", "pt"]

NEW_KEYS = {
    "transfer.uc_title": "Unlock to continue",
}


def main():
    for code in LOCALES:
        path = "vanilla/locales/%s.json" % code
        with io.open(path, encoding="utf-8") as f:
            data = json.load(f)
        section = data.get("transfer")
        if not isinstance(section, dict):
            print("transfer section MISSING in %s" % path)
            return 1
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
