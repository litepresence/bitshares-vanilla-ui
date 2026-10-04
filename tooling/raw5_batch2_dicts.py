#!/usr/bin/env python3
"""RAW5 batch2 dicts: V2 unlock CTA, V3 locked templates -> common, V5/V6 glosses.

- V2: transfer.unlock_sign -> "Unlock & review" (en new; 11 locales en-verbatim).
- V3: add common.locked_preview + common.locked_sign (en = barter values;
      other locales = their barter values, preserving translations);
      delete barter/borrow/credit/instant locked_preview_note+locked_sign_note (8)
      + transfer.locked_sign_hint (1, repointed to common.locked_sign).
      proposal/vote/debit browsing variants deliberately kept (report).
- V5/V6: CER/HTLC/slate glosses (en new; 11 locales en-verbatim, R18 to translate).
- V1: no dict change (ladder already Review->Confirm->Sign & Send).
"""
import json, os

LOCALES = "/workspace/vanilla/locales"
CODES = ["en","de","es","fr","hi","it","ja","ko","pt","ru","tr","zh"]

V2_NEW = "Unlock & review"
V3_DEL = [
    "barter.locked_preview_note","barter.locked_sign_note",
    "borrow.locked_preview_note","borrow.locked_sign_note",
    "credit.locked_preview_note","credit.locked_sign_note",
    "instant.locked_preview_note","instant.locked_sign_note",
    "transfer.locked_sign_hint",
]
V3_ADD = ["common.locked_preview","common.locked_sign"]
GLOSS = {
    "explorer.feed_cer_premium": "Core exchange rate (CER) premium (publisher-rule estimate)",
    "asset.cer_row": "Core exchange rate (CER)",
    "htlc.list_sub": "Hash time-locked contract (HTLC) transfers redeemable with a secret preimage before expiry.",
    "vote.in_sync": "Vote slate matches the chain — no changes to publish.",
    "vote.proxies_follow_another_account_s_slate_re": "Proxies follow another account's vote slate — read how voting works before setting one.",
    "vote.proxy_follows": " — your stake follows this account; the vote slate below is read-only.",
}

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

def get_flat(d, dotted):
    sec, _, key = dotted.partition(".")
    return d.get(sec, {}).get(key)

for code in CODES:
    p = os.path.join(LOCALES, code + ".json")
    d = json.load(open(p, encoding="utf-8"))
    fb = flatten(d)
    # V2
    set_flat(d, "transfer.unlock_sign", V2_NEW)
    # V3: capture barter translations BEFORE delete
    prev = get_flat(d, "barter.locked_preview_note")
    sign = get_flat(d, "barter.locked_sign_note")
    for k in V3_DEL:
        del_flat(d, k)
    set_flat(d, "common.locked_preview", prev)
    set_flat(d, "common.locked_sign", sign)
    # V5/V6 glosses -> en-verbatim outside en
    for k, v in GLOSS.items():
        set_flat(d, k, v)
    meta = d.get("_meta") or {}
    trset = set(meta.get("translated") or [])
    for k in V3_DEL:
        trset.discard(k)
    for k in V3_ADD:
        trset.add(k)
    fa = flatten(d)
    assert set(fa) == (set(fb) - set(V3_DEL) | set(V3_ADD)), code
    assert set(trset) == set(fa), code + " allowlist"
    meta["translated"] = sorted(trset)
    d["_meta"] = meta
    with open(p, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(code, "ok", len(fa))
