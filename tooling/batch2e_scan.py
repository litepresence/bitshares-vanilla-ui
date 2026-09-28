#!/usr/bin/env python3
"""Batch-2e scanner: inventory convertible display literals per target file.

Lists candidate i18n sites (textContent assignments, el(doc,tag,"lit") calls,
field() labels, placeholder attributes, routeReady titles, showError/showStatus
string args, ["Label",...] row labels, header arrays, option labels) with line
numbers, WITHOUT modifying anything. Review output before converting.

Usage: python3 tooling/batch2e_scan.py [file...]
  No args: scans the batch-2e file list.
"""
import re
import sys
import os

VANILLA = "/workspace/vanilla/js"

BATCH_2E = [
    "credit-ui.js", "credit-detail-ui.js", "samet-ui.js", "borrow-ui.js",
    "barter-ui.js", "proposal-ui.js", "ticket-ui.js", "misc-ui.js",
    "vesting-ui.js", "accounts-ui.js", "auth-ui.js", "news-ui.js",
    "help-ui.js", "fees-ui.js", "referrals-ui.js", "favourites-ui.js",
    "password-ui.js", "prediction-ui.js", "instant-trade-ui.js",
    "create-account-ui.js", "create-worker-ui.js",
]

# Literal in double quotes (batch-2e files use double quotes for display text).
STR = r'"((?:\\.|[^"\\])*)"'


def candidates(path):
    src = open(path, encoding="utf-8").read()
    out = []
    for i, line in enumerate(src.split("\n"), 1):
        s = line.strip()
        # Skip console strings, comments, directives.
        if (not s or s.startswith("//") or s.startswith("/*") or s.startswith("*")
                or "console." in s or s.startswith('"use strict"')
                or s.startswith("'use strict'")):
            continue
        hits = []
        if re.search(r"\.textContent\s*=\s*" + STR, line):
            hits.append("textContent")
        if re.search(r"\bel\s*\(\s*doc\s*,\s*" + STR + r"\s*,\s*" + STR, line):
            hits.append("el(doc,tag,lit)")
        if re.search(r"\bfield\s*\(\s*doc\s*,\s*" + STR, line):
            hits.append("field-label")
        if "placeholder" in line and re.search(STR, line):
            hits.append("placeholder")
        if re.search(r"\brouteReady\s*\(\s*root\s*,\s*" + STR, line):
            hits.append("route-title")
        if re.search(r"\b(showError|showStatus|offlineBox|unlockBox)\s*\(", line) and re.search(STR, line):
            hits.append("status/err-arg")
        if re.search(r"\[\s*" + STR + r"\s*,", line):
            hits.append("row-label/header")
        if re.search(r"\bop\.textContent\s*=", line) or re.search(r"option.*textContent", line):
            hits.append("option")
        if re.search(r"\bana?\.?setAttribute\s*\(\s*\"(aria-label|title|placeholder)\"", line):
            hits.append("attr")
        if re.search(r"\.innerHTML\s*=\s*" + STR, line):
            hits.append("innerHTML")
        # Generic: toast/alert/confirm dialog string args.
        if re.search(r"\b(toast|alert|confirm|notify)\s*\(", line) and re.search(STR, line):
            hits.append("toast/alert")
        if hits:
            out.append((i, hits, s[:150]))
    return out


def main():
    files = sys.argv[1:] or BATCH_2E
    total = 0
    for f in files:
        path = f if os.path.isabs(f) else os.path.join(VANILLA, f)
        if not os.path.exists(path):
            print("MISSING: %s" % f)
            continue
        cands = candidates(path)
        total += len(cands)
        print("== %s (%d sites) ==" % (os.path.basename(path), len(cands)))
        for ln, hits, text in cands:
            print("  %4d [%s] %s" % (ln, ",".join(hits), text))
    print("TOTAL SITES: %d" % total)


if __name__ == "__main__":
    main()
