#!/usr/bin/env python3
"""apply_i18n_batch_op77_update.py — add op-77 order-update keys (17 keys).

Batch: market.adjust_button "Adjust" / market.update_title "Adjust order" /
market.update_price "New price " / market.update_amount
"Amount for sale (new total) " / market.update_expiry "New expiration " /
market.update_review "Review update" / market.update_no_change
"No changes — edit price, amount, or expiration." /
market.update_price_change "Price (old → new)" / market.update_amount_change
"Amount change" / market.update_expiry_change "Expiration (old → new)" /
market.confirm_adjust "Confirm adjust" / market.update_bad_price
"Enter a price greater than zero." / market.update_bad_amount
"Enter an amount greater than zero." / market.update_bad_expiry
"Enter an expiration in the future." / market.update_broadcasting
"Broadcasting update…" / market.update_done "Order updated" /
market.fail_update "Update failed."
Call sites already landed in vanilla/js/views/market-orders.js (op-77
order-update flow); defaults below must match those t() defaults
byte-for-byte (trailing spaces, em dash U+2014, arrow U+2192, ellipsis
U+2026 preserved).

All 12 dicts are full-mode (untranslated=false, translated==all keys), so every
dict's _meta.translated gains the 17 keys (sorted). Non-es dicts keep English
verbatim (honest stubs); es carries real Spanish (flag: human-review).
Round-trip safe: json.dump(indent=2, ensure_ascii=False) + trailing newline.
"""
import io
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "vanilla", "locales")

EN_VALS = {
    ("market", "adjust_button"): "Adjust",
    ("market", "update_title"): "Adjust order",
    ("market", "update_price"): "New price ",
    ("market", "update_amount"): "Amount for sale (new total) ",
    ("market", "update_expiry"): "New expiration ",
    ("market", "update_review"): "Review update",
    ("market", "update_no_change"): "No changes \u2014 edit price, amount, or expiration.",
    ("market", "update_price_change"): "Price (old \u2192 new)",
    ("market", "update_amount_change"): "Amount change",
    ("market", "update_expiry_change"): "Expiration (old \u2192 new)",
    ("market", "confirm_adjust"): "Confirm adjust",
    ("market", "update_bad_price"): "Enter a price greater than zero.",
    ("market", "update_bad_amount"): "Enter an amount greater than zero.",
    ("market", "update_bad_expiry"): "Enter an expiration in the future.",
    ("market", "update_broadcasting"): "Broadcasting update\u2026",
    ("market", "update_done"): "Order updated",
    ("market", "fail_update"): "Update failed.",
}

# Real Spanish (flag: human-review). Glossary precedent in es.json:
# "Ajustar" (borrow.adjust), "Ajustar orden" (orden=order), "Precio"
# (market.th_price), "Cantidad" (confirm.amount), "Vencimiento"
# (barter.expiration), "Revisar X" (asset.review_*), "Confirmar ajuste"
# (borrow.confirm_margin_adjust pattern), "Transmitiendo…" (common.
# status_broadcasting / trade.s2), "Introduce un X mayor que cero"
# (createworker.daily_pay pattern), trailing spaces preserved where en
# has them, em dash / arrow / ellipsis kept byte-equivalent.
ES_VALS = {
    ("market", "adjust_button"): "Ajustar",
    ("market", "update_title"): "Ajustar orden",
    ("market", "update_price"): "Nuevo precio ",
    ("market", "update_amount"): "Cantidad en venta (nuevo total) ",
    ("market", "update_expiry"): "Nuevo vencimiento ",
    ("market", "update_review"): "Revisar actualizaci\u00f3n",
    ("market", "update_no_change"): "Sin cambios \u2014 edita precio, cantidad o vencimiento.",
    ("market", "update_price_change"): "Precio (anterior \u2192 nuevo)",
    ("market", "update_amount_change"): "Cambio de cantidad",
    ("market", "update_expiry_change"): "Vencimiento (anterior \u2192 nuevo)",
    ("market", "confirm_adjust"): "Confirmar ajuste",
    ("market", "update_bad_price"): "Introduce un precio mayor que cero.",
    ("market", "update_bad_amount"): "Introduce una cantidad mayor que cero.",
    ("market", "update_bad_expiry"): "Introduce un vencimiento en el futuro.",
    ("market", "update_broadcasting"): "Transmitiendo actualizaci\u00f3n\u2026",
    ("market", "update_done"): "Orden actualizada",
    ("market", "fail_update"): "Actualizaci\u00f3n fallida.",
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
        print("%s: +17 keys, translated=%d" % (code, len(tr)))


if __name__ == "__main__":
    main()
