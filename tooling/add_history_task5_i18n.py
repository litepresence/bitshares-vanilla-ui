#!/usr/bin/env python3
"""One-shot: account-history one-liner template keys (history Task 5).

Governance / HTLC / tickets / vesting / proposals / misc / blind families
(tags 20,21,29,30,34,22,23,24,32,33,49-53,57,58,54-56,5,7,8,9,35,37,45,
39-41). Adds 26 account.sum_* template keys to all 12
vanilla/locales/*.json as honest English stubs (principle #10).
Tags 31/36/44/46 stay label-only (no account leg / predicates are chain
logic / bare-amount asset unresolvable / no brief template) — no keys.

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

# (dict-key suffix, exact default per the Task 5 brief; placeholders byte-verbatim).
TABLE = [
    ("sum_witness_create", "Became witness: %(account)s"),
    ("sum_witness_update", "Updated witness %(account)s"),
    ("sum_committee_create", "Became committee member: %(account)s"),
    ("sum_committee_update", "Updated committee member %(account)s"),
    ("sum_worker_create", 'Created worker \\"%(name)s\\"'),
    ("sum_proposal_create", "Proposed %(n)s operations"),
    ("sum_proposal_update", "Approved proposal %(proposal)s"),
    ("sum_proposal_delete", "Deleted proposal %(proposal)s"),
    ("sum_vesting_create", "Vested %(amount)s for %(owner)s"),
    ("sum_vesting_withdraw", "Withdrew %(amount)s vested"),
    ("sum_htlc_create", "HTLC %(id)s: %(amount)s from %(from)s to %(to)s"),
    ("sum_htlc_redeem", "Redeemed HTLC %(id)s"),
    ("sum_htlc_claimed", "HTLC %(id)s claimed"),
    ("sum_htlc_extend", "Extended HTLC %(id)s"),
    ("sum_htlc_refund", "HTLC %(id)s refunded"),
    ("sum_ticket_create", "Created ticket %(amount)s"),
    ("sum_ticket_update", "Updated ticket %(ticket)s"),
    ("sum_authorities", "Updated authorities for %(account)s"),
    ("sum_account_create", "Registered %(name)s"),
    ("sum_whitelist", "Listed %(account)s"),
    ("sum_upgrade", "Upgraded %(account)s"),
    ("sum_account_transfer", "Transferred account to %(owner)s"),
    ("sum_custom", "Custom operation by %(account)s"),
    ("sum_balance_claim", "Claimed %(amount)s"),
    ("sum_bid", "Bid %(coll)s for %(debt)s"),
    ("sum_blind", "Blind transfer (%(in)s in, %(out)s out)"),
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
