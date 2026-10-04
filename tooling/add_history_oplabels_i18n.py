#!/usr/bin/env python3
"""One-shot: account-history op labels 11..77 (tester-report follow-up).

History rows showed "Operation #19" for anything past tag 10. This adds
account.op_* labels for every real op tag (11-77, names per the
open-graphene spec oracle) to all 12 vanilla/locales/*.json as honest
English stubs (principle #10 — translators verify later).

Anchor-computed exact string surgery (no JSON round-trip, diffs stay
minimal). Safe to re-run. Verify with: python3 tooling/check_i18n.py
"""
import glob
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "vanilla", "locales")

# (dict-key suffix, human label). Existing 0..10 untouched.
TABLE = [
    ("asset_update", "Asset update"),
    ("smartcoin_update", "Smartcoin update"),
    ("feed_producers_update", "Feed producers update"),
    ("asset_issue", "Asset issue"),
    ("asset_burn", "Asset burn"),
    ("fee_pool_fund", "Fee pool fund"),
    ("asset_settle", "Asset settle"),
    ("global_settle", "Global settle"),
    ("feed_publish", "Feed publish"),
    ("witness_join", "Witness join"),
    ("witness_update", "Witness update"),
    ("proposal_create", "Proposal create"),
    ("proposal_update", "Proposal update"),
    ("proposal_delete", "Proposal delete"),
    ("debit_create", "Direct debit create"),
    ("debit_update", "Direct debit update"),
    ("debit_claim", "Direct debit claim"),
    ("debit_delete", "Direct debit delete"),
    ("committee_join", "Committee join"),
    ("committee_update", "Committee update"),
    ("params_update", "Global parameters update"),
    ("vesting_create", "Vesting create"),
    ("vesting_withdraw", "Vesting withdraw"),
    ("worker_create", "Worker create"),
    ("custom_op", "Custom operation"),
    ("assert_op", "Assert"),
    ("balance_claim", "Balance claim"),
    ("override_transfer", "Override transfer"),
    ("blind_to", "Transfer to blind"),
    ("blind_transfer", "Blind transfer"),
    ("blind_from", "Transfer from blind"),
    ("settle_cancel", "Settle cancel"),
    ("claim_fees", "Claim fees"),
    ("fba_distribute", "FBA distribute"),
    ("collateral_bid", "Collateral bid"),
    ("execute_bid", "Execute bid"),
    ("claim_pool", "Claim pool"),
    ("issuer_update", "Issuer update"),
    ("htlc_create", "HTLC create"),
    ("htlc_redeem", "HTLC redeem"),
    ("htlc_redeemed", "HTLC redeemed"),
    ("htlc_extend", "HTLC extend"),
    ("htlc_refund", "HTLC refund"),
    ("authority_create", "Authority create"),
    ("authority_update", "Authority update"),
    ("authority_delete", "Authority delete"),
    ("ticket_create", "Ticket create"),
    ("ticket_update", "Ticket update"),
    ("pool_create", "Pool create"),
    ("pool_delete", "Pool delete"),
    ("pool_deposit", "Pool deposit"),
    ("pool_withdraw", "Pool withdraw"),
    ("pool_swap", "Pool swap"),
    ("samet_create", "Same-T fund create"),
    ("samet_delete", "Same-T fund delete"),
    ("samet_update", "Same-T fund update"),
    ("samet_borrow", "Same-T borrow"),
    ("samet_repay", "Same-T repay"),
    ("offer_create", "Credit offer create"),
    ("offer_delete", "Credit offer delete"),
    ("offer_update", "Credit offer update"),
    ("offer_accept", "Credit accept"),
    ("deal_repay", "Deal repay"),
    ("deal_expired", "Deal expired"),
    ("pool_update", "Pool update"),
    ("deal_update", "Deal update"),
    ("order_update", "Order update"),
]


def main():
    en = json.load(open(os.path.join(LOCALES, "en.json"), encoding="utf-8"))
    existing = sorted(en["account"].keys())
    new_keys = sorted("op_" + s for s, _ in TABLE)
    label = dict(("op_" + s, v) for s, v in TABLE)
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
