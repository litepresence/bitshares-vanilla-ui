#!/usr/bin/env python3
"""add_trollbox_review_i18n.py — trollbox modal-review keys (unlock-confirm pilot).

Removes the inline-row keys (trollbox.login_gate/password_label/unlock —
no call sites remain after the modal migration) and adds the review keys
with verbatim English defaults matching vanilla/js/views/trollbox-ui.js
t() calls, in all 12 vanilla/locales/*.json.
Non-en dicts take honest English stubs. en.json _meta.translated inventory
kept sorted, as check_i18n expects. Idempotent.

Stdlib only. Usage: python3 tooling/add_trollbox_review_i18n.py (from /workspace).
Then: python3 tooling/check_i18n.py (must print OK).
"""
import io
import json

LOCALES = ["en", "de", "es", "fr", "it", "ja", "ko", "ru", "tr", "zh", "hi", "pt"]

STALE_KEYS = [
    "trollbox.login_gate",
    "trollbox.password_label",
    "trollbox.unlock",
]

NEW_KEYS = {
    "trollbox.post_review_title": "Review message",
    "trollbox.unlock_post": "Unlock & post",
    "trollbox.size_row": "Size",
    "trollbox.message_row": "Message",
    "trollbox.channel_row": "Channel",
    "trollbox.language_row": "Language",
    "trollbox.fee": "Fee",
    "trollbox.bytes_unit": "bytes",
}


def main():
    for code in LOCALES:
        path = "vanilla/locales/%s.json" % code
        with io.open(path, encoding="utf-8") as f:
            data = json.load(f)
        section = data.get("trollbox")
        if not isinstance(section, dict):
            print("trollbox section MISSING in %s" % path)
            return 1
        for dotted in STALE_KEYS:
            key = dotted.split(".", 1)[1]
            if key in section:
                del section[key]
        for dotted, default in NEW_KEYS.items():
            key = dotted.split(".", 1)[1]
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
