#!/usr/bin/env python3
"""Add eslab.hint_donors key to all locales (honest English stubs).

One-shot for the labs comprehensive-coverage round: es-lab-results.js
renders a donor-totals hint via t("eslab.hint_donors", <en>). Non-en dicts
keep English (never machine-translated); en inventory kept sorted as
check_i18n expects. Stdlib only.
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES_DIR = os.path.join(HERE, "..", "vanilla", "locales")
LOCALES = ["en", "de", "es", "fr", "hi", "it", "ja", "ko", "pt", "ru", "tr", "zh"]
KEY = "eslab.hint_donors"
EN_VAL = "Counts over the window; totals are raw integers — divide by the asset precision."

for code in LOCALES:
    path = os.path.join(LOCALES_DIR, code + ".json")
    with open(path, encoding="utf-8") as f:
        d = json.load(f)
    # nested dict: d["eslab"]["hint_donors"]
    ns = d.get("eslab")
    if not isinstance(ns, dict):
        raise SystemExit("missing eslab namespace in %s" % code)
    if "hint_donors" not in ns:
        # insert after hint_agg to keep file order stable-ish (dict order kept)
        new_ns = {}
        for k, v in ns.items():
            new_ns[k] = v
            if k == "hint_agg":
                new_ns["hint_donors"] = EN_VAL
        if "hint_donors" not in new_ns:
            new_ns["hint_donors"] = EN_VAL
        d["eslab"] = new_ns
    else:
        if code == "en" and d["eslab"]["hint_donors"] != EN_VAL:
            d["eslab"]["hint_donors"] = EN_VAL
    if code == "en":
        meta = d.get("_meta") or {}
        tr = meta.get("translated") or []
        if KEY not in tr:
            tr.append(KEY)
            tr.sort()
            meta["translated"] = tr
            d["_meta"] = meta
    else:
        meta = d.get("_meta") or {}
        if meta.get("untranslated") is False:
            tr = meta.get("translated") or []
            if KEY not in tr:
                tr.append(KEY)
                tr.sort()
                meta["translated"] = tr
                d["_meta"] = meta
    with open(path, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("updated", code)
