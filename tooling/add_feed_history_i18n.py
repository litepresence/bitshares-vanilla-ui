#!/usr/bin/env python3
"""One-shot: feed-history keys (feed producers + history chart slice).

Adds 17 asset.* keys to all 12 vanilla/locales/*.json as honest English
stubs (principle #10) + registers them in _meta.translated, and normalizes
file formatting to the repo canonical form (indent=2, ensure_ascii=False,
trailing newline) so diffs stay minimal.

Idempotent: safe to re-run. Verify with:
python3 tooling/check_i18n.py
"""
import glob
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "vanilla", "locales")

# (dict-key suffix, exact t() default — byte-identical to asset-feed-ui.js).
TABLE = [
    ("producers_live_title", "Feed producers"),
    ("loading_producers", "Loading producers\u2026"),
    ("producers_failed", "Could not load producers."),
    ("no_producers", "No feeds published yet \u2014 producers appear here once they publish."),
    ("witness_fed_note", "Witness-fed: all active witnesses may publish."),
    ("committee_fed_note", "Committee-fed: all active committee members may publish."),
    ("producer_col", "Producer"),
    ("published_col", "Published"),
    ("feed_history_title", "Feed history"),
    ("history_days", "Range"),
    ("plot_feeds", "Plot feeds"),
    ("no_history", "No history in this range \u2014 publishers publish rarely; try 90d."),
    ("history_loading", "Loading feed history\u2026"),
    ("history_capped", "Showing first 8 publishers (capped for speed)\u2026"),
    ("history_pub", "Publisher %(i)s/%(n)s\u2026"),
    ("history_exchange", "Loading exchange + pools\u2026"),
    ("history_failed", "Could not load feed history."),
]


def main():
    fails = []
    for path in sorted(glob.glob(os.path.join(LOCALES, "*.json"))):
        name = os.path.basename(path)
        try:
            with open(path, encoding="utf-8") as fh:
                d = json.load(fh)
        except (OSError, ValueError) as e:
            fails.append("%s unreadable: %s" % (name, e))
            continue
        g = d.setdefault("asset", {})
        for k, v in TABLE:
            if k not in g:
                g[k] = v
        meta = d.setdefault("_meta", {})
        reg = set(meta.get("translated") or [])
        for k, _v in TABLE:
            reg.add("asset." + k)
        meta["translated"] = sorted(reg)
        if meta.get("version") != 1:
            meta["version"] = 1
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(d, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        print("updated %s" % name)
    if fails:
        print("FAILURES:")
        for f in fails:
            print("  " + f)
        raise SystemExit(1)
    print("done")


if __name__ == "__main__":
    main()
