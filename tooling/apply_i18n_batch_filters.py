#!/usr/bin/env python3
"""apply_i18n_batch_filters.py — add market/pool filter + no-match keys (4 keys).

Batch: market.flt_min_price "Min price" / market.flt_max_price "Max price" /
market.no_filter_match "No fills match these filters." /
pool.no_filter_match "No swaps match these filters."
Call sites already landed in market-desk-panels.js + pool-detail-view.js
(other workers); defaults below must match those t() defaults byte-for-byte.

All 12 dicts are full-mode (untranslated=false, translated==all keys), so every
dict's _meta.translated gains the 4 keys (sorted). Non-es dicts keep English
verbatim (honest stubs); es carries real Spanish (human-review flagged).
Round-trip safe: json.dump(indent=2, ensure_ascii=False) + trailing newline
is byte-identical on these files (verified before running).
"""
import io
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "vanilla", "locales")

EN_VALS = {
    ("market", "flt_min_price"): "Min price",
    ("market", "flt_max_price"): "Max price",
    ("market", "no_filter_match"): "No fills match these filters.",
    ("pool", "no_filter_match"): "No swaps match these filters.",
}

# Real Spanish (flag: human-review). Glossary precedent in es.json:
# "Precio máximo/mínimo" (samet high/low_field), "ejecuciones" for fills
# (market.no_fills), singular "swap" (pool.confirm_swap), "Ningún X coincide"
# (market.no_match).
ES_VALS = {
    ("market", "flt_min_price"): "Precio m\u00ednimo",
    ("market", "flt_max_price"): "Precio m\u00e1ximo",
    ("market", "no_filter_match"): "Ninguna ejecuci\u00f3n coincide con estos filtros.",
    ("pool", "no_filter_match"): "Ning\u00fan swap coincide con estos filtros.",
}

CODES = ["en", "de", "es", "fr", "hi", "it", "ja", "ko", "pt", "ru", "tr", "zh"]


def main():
    for code in CODES:
        path = os.path.join(LOCALES, code + ".json")
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        vals = ES_VALS if code == "es" else EN_VALS
        # Values-only: append new keys at end of each section (append convention;
        # sections carry historical end-appends, not strict alpha order).
        for (sec, key), val in vals.items():
            if key in d[sec]:
                raise SystemExit("%s.%s.%s already exists, aborting" % (code, sec, key))
            d[sec][key] = val
        tr = d["_meta"]["translated"]
        for (sec, key) in vals:
            tr.append(sec + "." + key)
        tr.sort()
        out = io.StringIO()
        json.dump(d, out, indent=2, ensure_ascii=False)
        out.write("\n")
        with open(path, "w", encoding="utf-8") as f:
            f.write(out.getvalue())
        print("%s: +4 keys, translated=%d" % (code, len(tr)))


if __name__ == "__main__":
    main()
