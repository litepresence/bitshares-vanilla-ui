#!/usr/bin/env python3
"""One-shot: portfolio price-pager keys (Polish Task 6).

Adds 3 account.* keys to all 12 vanilla/locales/*.json as honest English
stubs (principle #10): the pager notice, the "Page X of Y" template, and
the page-scoped total label. The old first-20 notice key stays in the
dicts untouched (history; collect_i18n_orphans flags it when unused).

Anchor-computed exact string surgery (no JSON round-trip, diffs stay
minimal), same convention as tooling/add_history_task6_i18n.py: dotted
registry line (_meta.translated) after its dotted anchor + dict entry
after its dict anchor. Safe to re-run. Verify with:
python3 tooling/check_i18n.py
"""
import glob
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "vanilla", "locales")

# (dict-key suffix, exact t() default — byte-identical to account-ui.js).
TABLE = [
    ("page_total", "Page total \u2248 "),
    ("portfolio_page", "Page %(page)s of %(pages)s"),
    ("prices_cover_this_page",
     "Prices cover this page \u2014 turn the page to price more assets."),
]

# Dict anchors: single unique lines, except password_label (5 sections —
# the account occurrence is the one followed by "price_th").
ANCHORS = {
    "page_total": ("orders_title", None),
    "portfolio_page": ("password_label", "price_th"),
    "prices_cover_this_page": ("prices_cover_the_first_20_assets_the_rest_are", None),
}


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
        for k, label in TABLE:
            anchor, follower = ANCHORS[k]
            # 1. dotted registry line after its dotted anchor.
            dotted = '"account.%s"' % k
            if dotted not in src:
                arx = re.compile(
                    r'^(      "account\.%s",\n)' % re.escape(anchor),
                    re.MULTILINE)
                hits = arx.findall(src)
                if len(hits) != 1:
                    fails.append("%s: registry anchor %s hits=%d"
                                 % (name, anchor, len(hits)))
                    changed = None
                    break
                src = arx.sub(lambda m: m.group(1) + '      "account.%s",\n' % k,
                              src)
                changed = True
            # 2. dict entry after its dict anchor (anchor value differs per
            # locale — match the key prefix only, keep that locale's value;
            # a follower scopes a colliding anchor to the account section).
            if ('"%s": "%s"' % (k, label)) not in src:
                if follower is None:
                    arx2 = re.compile(r'^(    "%s": ".*",\n)' % re.escape(anchor),
                                      re.MULTILINE)
                else:
                    arx2 = re.compile(
                        r'^(    "%s": ".*",\n)(    "%s")'
                        % (re.escape(anchor), re.escape(follower)),
                        re.MULTILINE)
                hits2 = arx2.findall(src)
                if len(hits2) != 1:
                    fails.append("%s: dict anchor %s hits=%d"
                                 % (name, anchor, len(hits2)))
                    changed = None
                    break
                if follower is None:
                    src = arx2.sub(lambda m: m.group(1) + '    "%s": "%s",\n' % (k, label),
                                   src)
                else:
                    src = arx2.sub(
                        lambda m: m.group(1) + '    "%s": "%s",\n' % (k, label) + m.group(2),
                        src)
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
