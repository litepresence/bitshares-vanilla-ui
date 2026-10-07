#!/usr/bin/env python3
"""drop_orphan_pool_map_title.py — remove retired desk-map note keys.

pool_detail.pool_map ("Pool map") lost its last t() call site when the desk
pane headings were removed, and the BTS-provenance note lines went with the
same edit (connects-definition notes replace both). Unreferenced keys are
dead copy: remove them from all 12 vanilla/locales/*.json + the en.json
_meta.translated inventory so the dicts stay key-complete and orphan-free.

Stdlib only. Usage: python3 tooling/drop_orphan_pool_map_title.py.
Then: python3 tooling/check_i18n.py (must print OK).
"""
import io
import json
import sys

LOCALES = ["en", "de", "es", "fr", "it", "ja", "ko", "ru", "tr", "zh", "hi", "pt"]

# (section, sub, dotted) triples with no remaining t() call site.
DEAD = [
    ("pool_detail", "pool_map", "pool_detail.pool_map"),
    ("market", "no_bts_path", "market.no_bts_path"),
    ("market", "bts_provenance_prefix", "market.bts_provenance_prefix"),
    ("pool_detail", "no_bts_path_unverified", "pool_detail.no_bts_path_unverified"),
    ("pool_detail", "bts_provenance_prefix", "pool_detail.bts_provenance_prefix"),
]


def main():
    for code in LOCALES:
        path = "vanilla/locales/%s.json" % code
        with io.open(path, encoding="utf-8") as f:
            data = json.load(f)
        for section, sub, full in DEAD:
            if sub in data.get(section, {}):
                del data[section][sub]
            inv = data["_meta"]["translated"]
            if full in inv:
                inv.remove(full)
        with io.open(path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print("updated %s" % path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
