#!/usr/bin/env python3
"""One-shot: account-history one-liner template keys (history Task 4).

Pool / asset / credit / SameT / debit families (tags 59-63,75,10-18,42,
43,47,48,64-76,25-28). Adds 34 account.sum_* template keys to all 12
vanilla/locales/*.json as honest English stubs (principle #10).

Anchor-computed exact string surgery (no JSON round-trip, diffs stay
minimal), same convention as tooling/add_history_templates_i18n.py (Task 3):
dotted registry line (_meta.translated) after its dotted anchor + dict
entry after its dict anchor. Safe to re-run. Verify with:
python3 tooling/check_i18n.py
"""
import glob
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "vanilla", "locales")

# (dict-key suffix, exact default per the Task 4 brief; placeholders byte-verbatim).
TABLE = [
    ("sum_pool_create", "Created pool %(a)s / %(b)s"),
    ("sum_pool_delete", "Deleted pool %(pool)s"),
    ("sum_pool_deposit", "Staked %(a)s + %(b)s in pool %(pool)s"),
    ("sum_pool_withdraw", "Unstaked %(shares)s from pool %(pool)s"),
    ("sum_pool_swap", "Swapped %(sell)s \u2192 at least %(buy)s in pool %(pool)s"),
    ("sum_pool_update", "Updated pool %(pool)s"),
    ("sum_asset_create", "Created asset %(symbol)s"),
    ("sum_asset_update", "Updated asset %(asset)s"),
    ("sum_issuer_update", "New issuer for %(asset)s: %(issuer)s"),
    ("sum_smartcoin_update", "Updated smartcoin %(asset)s"),
    ("sum_feed_producers", "Set %(n)s feed producers for %(asset)s"),
    ("sum_asset_issue", "Issued %(amount)s to %(to)s"),
    ("sum_asset_burn", "Burned %(amount)s"),
    ("sum_fee_pool_fund", "Funded fee pool of %(asset)s with %(amount)s"),
    ("sum_asset_settle", "Requested settlement of %(amount)s"),
    ("sum_global_settle", "Globally settled %(asset)s"),
    ("sum_settle_cancel", "Cancelled settlement of %(amount)s"),
    ("sum_claim_fees", "Claimed %(amount)s in fees"),
    ("sum_samet_create", "Created SameT fund with %(amount)s"),
    ("sum_samet_delete", "Deleted SameT fund %(fund)s"),
    ("sum_samet_update", "Updated SameT fund %(fund)s"),
    ("sum_samet_borrow", "Borrowed %(amount)s from fund %(fund)s"),
    ("sum_samet_repay", "Repaid %(amount)s to fund %(fund)s"),
    ("sum_offer_create", "Created credit offer in %(asset)s"),
    ("sum_offer_delete", "Deleted offer %(offer)s"),
    ("sum_offer_update", "Updated offer %(offer)s"),
    ("sum_offer_accept", "Borrowed %(amount)s against %(coll)s (offer %(offer)s)"),
    ("sum_deal_repay", "Repaid %(amount)s on deal %(deal)s"),
    ("sum_deal_update", "Updated deal %(deal)s"),
    ("sum_deal_expired", "Deal %(deal)s expired"),
    ("sum_debit_create", "Authorized %(amount)s debit for %(to)s"),
    ("sum_debit_update", "Updated %(amount)s debit for %(to)s"),
    ("sum_debit_claim", "Claimed %(amount)s debit"),
    ("sum_debit_delete", "Deleted debit permission %(perm)s"),
]


def main():
    en = json.load(open(os.path.join(LOCALES, "en.json"), encoding="utf-8"))
    existing = sorted(en["account"].keys())
    new_keys = sorted(s for s, _ in TABLE)
    label = dict(TABLE)
    # Anchor map: predecessor within (existing + new) sorted order.
    universe = sorted(set(existing) | set(new_keys))
    anchors = {}
    for k in new_keys:
        anchors[k] = universe[universe.index(k) - 1]
    fails = []
    for path in sorted(glob.glob(os.path.join(LOCALES, "*.json"))):
        name = os.path.basename(path)
        try:
            src = open(path, encoding="utf-8").read()
        except OSError as e:
            fails.append("%s unreadable: %s" % (name, e))
            continue
        changed = False
        for k in new_keys:
            dotted = '"account.%s"' % k
            if dotted in src and ('"%s": "%s"' % (k, label[k])) in src:
                continue
            # 1. dotted registry line after its dotted anchor.
            if dotted not in src:
                arx = re.compile(r'^(      "account\.%s",\n)' % re.escape(anchors[k]), re.MULTILINE)
                hits = arx.findall(src)
                if len(hits) != 1:
                    fails.append("%s: registry anchor %s hits=%d" % (name, anchors[k], len(hits)))
                    changed = None
                    break
                src = arx.sub('\\1      "account.%s",\n' % k, src)
                changed = True
            # 2. dict entry after its dict anchor (anchor value differs per
            # locale — match the key prefix only, keep that locale's value).
            if ('"%s": "%s"' % (k, label[k])) not in src:
                ad = anchors[k]
                arx2 = re.compile(r'^(    "%s": ".*",\n)' % re.escape(ad), re.MULTILINE)
                hits2 = arx2.findall(src)
                if len(hits2) != 1:
                    fails.append("%s: dict anchor %s hits=%d" % (name, ad, len(hits2)))
                    changed = None
                    break
                src = arx2.sub('\\1    "%s": "%s",\n' % (k, label[k]), src)
                changed = True
        if changed is None:
            continue
        if changed:
            open(path, "w", encoding="utf-8").write(src)
            print("updated %s" % name)
    if fails:
        print("FAILURES:")
        for f in fails:
            print("  " + f)
        raise SystemExit(1)
    print("done")


if __name__ == "__main__":
    main()
