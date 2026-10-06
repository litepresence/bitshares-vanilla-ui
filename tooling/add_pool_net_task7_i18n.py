#!/usr/bin/env python3
"""add_pool_net_task7_i18n.py — Task 7 key inserter (pool-net map plan).

Adds 23 NEW pool_net.* keys with verbatim English defaults matching
vanilla/js/views/pool-net-ui.js I18n.t calls (post Task-7 twin/offline
dedup: twin is always the "%(n)s" template, empty-skeleton offline is
pool_net.offline_empty) to all 12 vanilla/locales/*.json. Non-en dicts
are fully-translated (untranslated=false), so new keys land allowlisted
with honest English values — translators refine wording, never keys.
en.json _meta.translated inventory kept sorted, as check_i18n expects.

Stdlib only. Usage: python3 tooling/add_pool_net_task7_i18n.py.
Then: python3 tooling/check_i18n.py (must print OK).
"""
import io
import json
import sys

LOCALES = ["en", "de", "es", "fr", "it", "ja", "ko", "ru", "tr", "zh", "hi", "pt"]

# Verbatim I18n.t defaults from pool-net-ui.js (check_i18n.py enforces
# byte-equality; any transcription slip here fails that gate).
NEW_KEYS = {
    "pool_net.empty": "No pools touch this filter.",
    "pool_net.canvas_label": "Pool network map. Press Enter to open BTS.",
    "pool_net.twin": "Pool rows (%(n)s)",
    "pool_net.direct": "paired with BTS",
    "pool_net.hops": "%(n)s hops to BTS",
    "pool_net.orphan": "orphaned from BTS",
    "pool_net.node_card": "%(sym)s (%(id)s) \u00b7 %(n)s pools \u00b7 %(hops)s",
    "pool_net.edge_card": "%(pool)s \u00b7 %(a)s\u2013%(b)s \u00b7 %(ba)s %(sa)s + %(bb)s %(sb)s",
    "pool_net.edge_nobal": "%(pool)s \u00b7 %(a)s\u2013%(b)s",
    "pool_net.verdict_full": "%(pools)s pools \u00b7 %(assets)s assets",
    "pool_net.verdict_path": "%(a)s reaches %(b)s in %(n)s hops",
    "pool_net.verdict_orphan": "No route between %(a)s and %(b)s",
    "pool_net.verdict_star": "Pools touching %(s)s: %(n)s",
    "pool_net.prompt": "Tap a node for the asset, a line for the pool.",
    "pool_net.legend": "Brands",
    "pool_net.col_pool": "Pool",
    "pool_net.col_a": "Asset 1",
    "pool_net.col_b": "Asset 2",
    "pool_net.twin_more": "Showing %(shown)s of %(n)s pools \u2014 narrow the filter to see fewer.",
    "pool_net.ready": "%(pools)s pools \u00b7 %(assets)s assets",
    "pool_net.offline": "Network unavailable \u2014 showing shipped skeleton. Retry when connected.",
    "pool_net.offline_empty": "Network unavailable \u2014 no skeleton pools cached.",
    "pool_net.partial": "Live update incomplete \u2014 showing shipped pools.",
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
