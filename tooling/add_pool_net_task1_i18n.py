#!/usr/bin/env python3
"""add_pool_net_task1_i18n.py — Task 1 key inserter (pool-net v2 plan).

Adds 3 NEW pool_net.* keys with verbatim English defaults matching
vanilla/js/views/pool-net-ui.js I18n.t calls (Calm/Lively switch +
motion group label) to all 12 vanilla/locales/*.json. Non-en dicts
are fully-translated (untranslated=false), so new keys land with
honest English values — translators refine wording, never keys.
en.json _meta.translated inventory kept sorted, as check_i18n expects.

Stdlib only. Usage: python3 tooling/add_pool_net_task1_i18n.py.
Then: python3 tooling/check_i18n.py (must print OK).
"""
import io
import json
import sys

LOCALES = ["en", "de", "es", "fr", "it", "ja", "ko", "ru", "tr", "zh", "hi", "pt"]

# Verbatim I18n.t defaults from pool-net-ui.js (check_i18n.py enforces
# byte-equality; any transcription slip here fails that gate).
NEW_KEYS = {
    "pool_net.phys_calm": "Calm",
    "pool_net.phys_lively": "Lively",
    "pool_net.phys_label": "Network motion",
}

ANCHOR = "loading"


def main():
    for code in LOCALES:
        path = "vanilla/locales/%s.json" % code
        with io.open(path, encoding="utf-8") as f:
            data = json.load(f)
        section = data.get("pool_net")
        if not isinstance(section, dict) or ANCHOR not in section:
            print("ANCHOR pool_net.%s MISSING in %s" % (ANCHOR, path))
            return 1
        shorts = {}
        for full, v in NEW_KEYS.items():
            shorts[full.split(".", 1)[1]] = v
        rebuilt = {}
        for key, val in section.items():
            rebuilt[key] = shorts.get(key, val)
            if key == ANCHOR:
                for short, v in shorts.items():
                    if short not in section:
                        rebuilt[short] = v
        data["pool_net"] = rebuilt
        inv = data["_meta"]["translated"]
        for full in NEW_KEYS:
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
