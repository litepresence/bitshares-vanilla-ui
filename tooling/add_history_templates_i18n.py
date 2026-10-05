#!/usr/bin/env python3
"""One-shot: account-history one-liner template keys (history Task 3).

History rows render row._summary (HistorySummary.enrich) with fallback to
op labels. This adds the 10 account.sum_* template keys (daily-eight
families: transfer x3 directions, limit create/cancel/update, call update,
fill, feed, account update) to all 12 vanilla/locales/*.json as honest
English stubs (principle #10 — translators verify later).

Anchor-computed exact string surgery (no JSON round-trip, diffs stay
minimal), same convention as tooling/add_history_oplabels_i18n.py: dotted
registry line (_meta.translated) after its dotted anchor + dict entry after
its dict anchor. Safe to re-run. Verify with: python3 tooling/check_i18n.py
"""
import glob
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "vanilla", "locales")

# (dict-key suffix, exact default per the Task 3 brief; placeholders byte-verbatim).
TABLE = [
    ("sum_transfer_send", "Sent %(amount)s to %(to)s"),
    ("sum_transfer_recv", "Received %(amount)s from %(from)s"),
    ("sum_transfer", "Transfer %(amount)s from %(from)s to %(to)s"),
    ("sum_order_create", "Offered %(sell)s for at least %(buy)s"),
    ("sum_order_cancel", "Cancelled order %(order)s"),
    ("sum_order_update", "Updated order %(order)s"),
    ("sum_call_update", "Adjusted position: %(coll)s collateral, %(debt)s debt"),
    ("sum_fill", "Filled: paid %(pays)s, received %(receives)s"),
    ("sum_feed", "Feed published for %(asset)s by %(publisher)s"),
    ("sum_account_update", "Account updated: %(account)s"),
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
