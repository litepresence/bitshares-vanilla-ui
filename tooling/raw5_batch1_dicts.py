#!/usr/bin/env python3
"""RAW5 batch1: V4 unlock_failed -> common + V11 case + V7 elastic (dicts only).

Reads all 12 vanilla/locales/*.json, applies:
- V4: add common.unlock_failed (per-locale majority, hi en-verbatim),
      delete 10 per-section unlock_failed keys, fix _meta.translated.
- V11 (en-only meaning-preserving case): 8 keys to sentence-case.
- V7: help.elastic -> "Community index (third-party history)" (en new;
      other 11 locales en-verbatim).
Preserves key order + 2-space JSON formatting.
"""
import json, glob, os

LOCALES = "/workspace/vanilla/locales"
CODES = ["en","de","es","fr","hi","it","ja","ko","pt","ru","tr","zh"]

OLD_UNLOCK_KEYS = [
    "barter.unlock_failed","borrow.unlock_failed","credit.unlock_failed",
    "trade.unlock_failed","transfer.unlock_failed","auth.unlock_failed",
    "instant.unlock_failed","proposal.unlock_failed","vote.unlock_failed",
    "trollbox.unlock_failed",
]

COMMON_UNLOCK = {
    "en": "Unlock failed.",
    "de": "Entsperren fehlgeschlagen.",
    "es": "Desbloqueo fallido.",
    "fr": "Échec du déverrouillage.",
    "hi": "Unlock failed.",  # variants differ beyond punctuation -> en-verbatim, R18 to translate
    "it": "Sblocco non riuscito.",
    "ja": "アンロックに失敗しました。",
    "ko": "잠금 해제에 실패했습니다.",
    "pt": "Falha ao desbloquear.",
    "ru": "Разблокировка не удалась.",
    "tr": "Kilit açılamadı.",
    "zh": "解锁失败。",
}

V11_EN = {
    "account.credit_management": "Credit management",
    "account.margin_positions": "Margin positions",
    "assets_feed.title": "Publish feed",
    "assets_manage.title": "Create asset",
    "account.s4": "My account",
    "menu.p_my_account": "My account",
    "menu.p_asset_create": "Create asset",
    "menu.p_asset_feed": "Publish feed",
    # account.export_csv stays "Export CSV" (CSV exempt)
}

V7_NEW = "Community index (third-party history)"

def flatten(d, prefix=""):
    out = {}
    for k, v in d.items():
        if k == "_meta":
            continue
        if isinstance(v, dict):
            out.update(flatten(v, prefix + k + "."))
        else:
            out[prefix + k] = v
    return out

def set_flat(d, dotted, val):
    sec, _, key = dotted.partition(".")
    if sec not in d or not isinstance(d[sec], dict):
        d[sec] = {}
    d[sec][key] = val

def del_flat(d, dotted):
    sec, _, key = dotted.partition(".")
    if isinstance(d.get(sec), dict) and key in d[sec]:
        del d[sec][key]

for code in CODES:
    p = os.path.join(LOCALES, code + ".json")
    d = json.load(open(p, encoding="utf-8"))
    flat_before = flatten(d)
    # V4
    for k in OLD_UNLOCK_KEYS:
        del_flat(d, k)
    set_flat(d, "common.unlock_failed", COMMON_UNLOCK[code])
    # V11 en-only
    if code == "en":
        for k, v in V11_EN.items():
            set_flat(d, k, v)
    # V7
    if code == "en":
        set_flat(d, "help.elastic", V7_NEW)
    else:
        set_flat(d, "help.elastic", V7_NEW)  # en-verbatim, R18 to translate
    # _meta.translated: remove old, add common.unlock_failed
    meta = d.get("_meta") or {}
    tr = meta.get("translated") or []
    trset = set(tr)
    for k in OLD_UNLOCK_KEYS:
        trset.discard(k)
    trset.add("common.unlock_failed")
    # V11/V7 change values only, keys unchanged -> allowlist unchanged otherwise
    flat_after = flatten(d)
    assert set(flat_after) == (set(flat_before) - set(OLD_UNLOCK_KEYS) | {"common.unlock_failed"}), code
    assert set(trset) == set(flat_after), code + " allowlist"
    meta["translated"] = sorted(trset)
    d["_meta"] = meta
    with open(p, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(code, "ok", len(flat_after))
