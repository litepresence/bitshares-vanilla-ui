#!/usr/bin/env python3
"""add_pool_net_switch_i18n.py — Physics on/off switch key swap (user call).

Removes the segmented-control keys (pool_net.phys_calm/phys_lively/phys_label,
no longer referenced after the single-switch rebuild) and adds the switch keys
(pool_net.phys/phys_on/phys_off) with verbatim English defaults matching
vanilla/js/views/pool-net-ui.js I18n.t calls, in all 12 vanilla/locales/*.json.
Non-en dicts are fully-translated (untranslated=false), so new keys land
allowlisted with honest English values. en.json _meta.translated inventory
kept sorted, as check_i18n expects.

Stdlib only. Usage: python3 tooling/add_pool_net_switch_i18n.py.
Then: python3 tooling/check_i18n.py (must print OK).
"""
import io
import json

LOCALES = ["en", "de", "es", "fr", "it", "ja", "ko", "ru", "tr", "zh", "hi", "pt"]

STALE_KEYS = ["pool_net.phys_calm", "pool_net.phys_lively", "pool_net.phys_label"]
NEW_KEYS = {
    "pool_net.phys": "Physics",
    "pool_net.phys_on": "On",
    "pool_net.phys_off": "Off",
}


def main():
    for code in LOCALES:
        path = "vanilla/locales/%s.json" % code
        with io.open(path, encoding="utf-8") as f:
            data = json.load(f)
        section = data.get("pool_net")
        if not isinstance(section, dict):
            print("pool_net section MISSING in %s" % path)
            return 1
        for dotted in STALE_KEYS:
            key = dotted.split(".", 1)[1]
            if key in section:
                del section[key]
        for dotted, default in NEW_KEYS.items():
            # Idempotent: never clobber a refined translation with the
            # English stub on re-runs; only missing keys are added.
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
            f.write("\n")
        print("updated %s" % path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
