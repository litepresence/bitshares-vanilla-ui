#!/usr/bin/env python3
"""Add trade.tab_single (SINGLE/SCALED shared toggle) to all 12 locale dicts.

One-shot for the scaled-toggle task: the buy-panel Buy/Scaled tabs become one
shared SINGLE/SCALED row above both columns, so trade.tab_buy's "Buy" label is
replaced by trade.tab_single "Single" (trade.tab_scaled "Scaled" reused as-is;
trade.tab_buy/tab_sell stay in the dicts untouched — no call-site churn).

Non-en values are ONE-SHOT machine translations (unverified — flagged for the
human audit wave, principle #10). Gate stays green: key sets stay identical
across dicts and every _meta.translated allowlist covers the new key.

Usage: python3 tooling/add_trade_tab_single_i18n.py
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "vanilla", "locales")

# One-shot translations of "Single" (tab label next to "Scaled").
VALUES = {
    "en": "Single",
    "de": "Einzel",
    "es": "Simple",
    "fr": "Simple",
    "hi": "एकल",
    "it": "Singolo",
    "ja": "単一",
    "ko": "단일",
    "pt": "Simples",
    "ru": "Одиночный",
    "tr": "Tekli",
    "zh": "单笔",
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
