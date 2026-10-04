#!/usr/bin/env python3
"""One-shot: transfer share-link notice key (2026-10-04).

Adds settings-free transfer.share_needs_to_amount ("A shareable link needs
a recipient and an amount.") to all 12 vanilla/locales/*.json as honest
English stubs (principle #10 — translators verify later). All other
share-row strings reuse existing misc.* keys verbatim (no churn).

Exact string surgery only (no JSON round-trip, diffs stay minimal).
Safe to re-run. Verify with: python3 tooling/check_i18n.py
"""
import glob
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "vanilla", "locales")

STEPS = [
    # _meta.translated (alpha: sender_recipient_different < share < title).
    (re.compile(r'^(      "transfer\.sender_recipient_different",\n)', re.MULTILINE),
     '\\1      "transfer.share_needs_to_amount",\n',
     '"transfer.share_needs_to_amount"', False),
    # transfer dict: share key before "title" (same alpha slot).
    # NOTE: done-marker includes the dict colon+English value — the dotted
    # _meta.translated line is a substring trap (it skipped this step once),
    # and so is the pre-existing misc.share_needs_to_amount ("A shareable
    # link needs a recipient and at least one amount line." in en.json).
    (re.compile(r'^(    "sender_recipient_different": ".*",\n)', re.MULTILINE),
     '\\1    "share_needs_to_amount": "A shareable link needs a recipient and an amount.",\n',
     '"share_needs_to_amount": "A shareable', False),
]


def main():
    fails = []
    for path in sorted(glob.glob(os.path.join(LOCALES, "*.json"))):
        name = os.path.basename(path)
        try:
            src = open(path, encoding="utf-8").read()
        except OSError as e:
            fails.append("%s unreadable: %s" % (name, e))
            continue
        changed = False
        for rx, new, done_marker, missing_ok in STEPS:
            if done_marker in src:
                continue
            hits = rx.findall(src)
            if len(hits) != 1:
                if missing_ok and not hits:
                    continue
                fails.append("%s: %r hits=%d (want 1)"
                             % (name, rx.pattern[:44], len(hits)))
                changed = None
                break
            src = rx.sub(new, src)
            changed = True
        if changed is None:
            continue
        if changed:
            open(path, "w", encoding="utf-8").write(src)
        print("checked %s%s" % (name, " (updated)" if changed else ""))
    if fails:
        print("\n".join(fails))
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
