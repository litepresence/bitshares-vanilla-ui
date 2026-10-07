#!/usr/bin/env python3
"""add_edge_ramp_i18n.py — edge volume-ramp legend keys.

Adds pool_net.ramp + market_net.ramp with verbatim English defaults matching
the legend/caption t() calls, in all 12 vanilla/locales/*.json. Non-en
dicts take honest English stubs. _meta.translated inventories kept sorted,
as check_i18n expects. Idempotent: never clobbers existing values.

Stdlib only. Usage: python3 tooling/add_edge_ramp_i18n.py (from /workspace).
Then: python3 tooling/check_i18n.py (must print OK).
"""
import io
import json

LOCALES = ["en", "de", "es", "fr", "it", "ja", "ko", "ru", "tr", "zh", "hi", "pt"]

NEW_KEYS = {
    "pool_net.ramp": "Pool size: small → large",
    "market_net.ramp": "24h volume: low → high",
}


def main():
    for code in LOCALES:
        path = "vanilla/locales/%s.json" % code
        with io.open(path, encoding="utf-8") as f:
            data = json.load(f)
        for dotted, default in NEW_KEYS.items():
            section_name, key = dotted.split(".", 1)
            section = data.get(section_name)
            if not isinstance(section, dict):
                print("%s section MISSING in %s" % (section_name, path))
                return 1
        for dotted, default in NEW_KEYS.items():
            section_name, key = dotted.split(".", 1)
            section = data.get(section_name)
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
