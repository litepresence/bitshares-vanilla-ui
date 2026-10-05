#!/usr/bin/env python3
"""Add trade.tab_single (SINGLE/SCALED shared toggle) to all 12 locale dicts.

SPENT one-shot (2026-10-05, principle #10 fix): the original run wrote
one-shot MACHINE translations for the 11 non-en locales, which violates
the honest-English rule (unverified strings must stay English until a
human verifies them). All non-en trade.tab_single values were reverted
to honest English "Single". This script is now IDEMPOTENT-HONEST: a
re-run sets every locale to "Single" and never reintroduces translations.

One-shot for the scaled-toggle task: the buy-panel Buy/Scaled tabs become one
shared SINGLE/SCALED row above both columns, so trade.tab_buy's "Buy" label is
replaced by trade.tab_single "Single" (trade.tab_scaled "Scaled" reused as-is;
trade.tab_buy/tab_sell stay in the dicts untouched — no call-site churn).

Non-en values stay HONEST ENGLISH "Single" until the audit wave verifies a
real translation per principle #10 (never write machine translations into
locale dicts). Gate stays green: key sets stay identical across dicts and
every _meta.translated allowlist covers the new key (fully-translated gate
branch performs no value checks, so allowlists are left untouched).

Usage: python3 tooling/add_trade_tab_single_i18n.py
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "vanilla", "locales")

# Honest-English only (SPENT): every locale gets en "Single" until a human
# translator verifies a real translation (principle #10). A re-run MUST NOT
# reintroduce machine translations — this table is intentionally en-identical.
VALUES = {
    "en": "Single",
    "de": "Single",
    "es": "Single",
    "fr": "Single",
    "hi": "Single",
    "it": "Single",
    "ja": "Single",
    "ko": "Single",
    "pt": "Single",
    "ru": "Single",
    "tr": "Single",
    "zh": "Single",
}

CODES = ["en", "de", "es", "fr", "hi", "it", "ja", "ko", "pt", "ru", "tr", "zh"]


def main():
    for code in CODES:
        path = os.path.join(LOCALES, code + ".json")
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        trade = d.get("trade")
        if not isinstance(trade, dict):
            raise SystemExit("%s: no trade dict" % code)
        if "tab_single" not in trade:
            # Keep tab order stable: insert right before tab_buy.
            items = list(trade.items())
            out = {}
            for k, v in items:
                if k == "tab_buy":
                    out["tab_single"] = VALUES[code]
                out[k] = v
            if "tab_single" not in out:
                out["tab_single"] = VALUES[code]
            d["trade"] = out
        else:
            d["trade"]["tab_single"] = VALUES[code]
        meta = d.setdefault("_meta", {})
        allow = meta.get("translated") or []
        if "trade.tab_single" not in allow:
            allow.append("trade.tab_single")
            meta["translated"] = allow
        with open(path, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print("%s: tab_single=%s" % (code, VALUES[code]))


if __name__ == "__main__":
    main()
