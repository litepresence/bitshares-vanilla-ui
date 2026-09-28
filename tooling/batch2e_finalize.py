#!/usr/bin/env python3
"""Batch-2e finalizer: rebuild frag-batch2e.json from the FINAL call sites.

- Literal t("key", "default") pairs are extracted from the 20 converted
  files (keys exactly as the code uses them; orphaned keys from superseded
  mechanical passes drop out automatically).
- Dynamic-key entries (opName/ERRMAP/INNER_DEFS/TOPICS/KINDS use-sites whose
  keys are built with +) are pulled VERBATIM from git HEAD sources, so the
  fragment stays byte-faithful to the pre-conversion literals.

Usage: python3 tooling/batch2e_finalize.py [--apply]
  Default: dry run (prints counts). --apply: writes the fragment.
"""
import json
import os
import re
import subprocess
import sys

WS = "/workspace"
JS = os.path.join(WS, "vanilla", "js")
FRAG = os.path.join(WS, "vanilla", "locales", "frag-batch2e.json")

NS_OF = {
    "credit-ui.js": "credit", "credit-detail-ui.js": "credit",
    "samet-ui.js": "samet", "borrow-ui.js": "borrow", "barter-ui.js": "barter",
    "proposal-ui.js": "proposal", "ticket-ui.js": "ticket",
    "misc-ui.js": "misc", "vesting-ui.js": "vesting", "auth-ui.js": "auth",
    "news-ui.js": "news", "help-ui.js": "help", "fees-ui.js": "fees",
    "referrals-ui.js": "referrals", "favourites-ui.js": "favourites",
    "password-ui.js": "password", "prediction-ui.js": "prediction",
    "instant-trade-ui.js": "instant", "create-account-ui.js": "createaccount",
    "create-worker-ui.js": "createworker",
}
FILES = [f for f in NS_OF if f != "accounts-ui.js"]

T_RE = re.compile(r"""\bt\(\s*"((?:\\.|[^"\\])*)"\s*,\s*"((?:\\.|[^"\\])*)\"""")
T_DYN_SUFFIX = re.compile(r"""\bt\(\s*"((?:\\.|[^"\\])*)"\s*\+""")


def unescape(v):
    return v.replace("\\'", "'").replace('\\"', '"').replace("\\\\", "\\")


def head(fname):
    r = subprocess.run(["git", "-C", WS, "show", "HEAD:vanilla/js/" + fname],
                       capture_output=True, text=True, check=True)
    return r.stdout


def main():
    apply = "--apply" in sys.argv
    frag = {}
    # 1. literal call sites (final files, exact keys).
    for f in FILES:
        ns = NS_OF[f]
        sec = frag.setdefault(ns, {})
        cur = open(os.path.join(JS, f), encoding="utf-8").read()
        for m in T_RE.finditer(cur):
            key = unescape(m.group(1))
            dflt = unescape(m.group(2))
            if not key.startswith(ns + "."):
                print("WARN %s: foreign key %s" % (f, key))
                continue
            key = key[len(ns) + 1:]
            if key in sec and sec[key] != dflt:
                print("WARN %s: key %s has two defaults" % (f, key))
            sec[key] = dflt
    # 2. dynamic entries from HEAD.
    prop = head("proposal-ui.js")
    # 2a. OP_NAMES values.
    m = re.search(r"var OP_NAMES = \{(.*?)\};", prop, re.S)
    for num, name in re.findall(r"(\d+):\s*\"((?:\\.|[^\"\\])*)\"", m.group(1)):
        frag["proposal"]["op_" + num] = unescape(name)
    frag["proposal"]["op_unknown"] = "operation type %(n)s"
    frag["proposal"]["lock_type_tpl"] = "lock type %(n)s"
    frag["proposal"]["listing_tpl"] = "listing %(n)s"
    # 2b. ERRMAP sentences.
    m = re.search(r"var ERRMAP = \[(.*?)\];", prop, re.S)
    for code, sent in re.findall(r"\[\s*\"((?:\\.|[^\"\\])*)\"\s*,\s*\"((?:\\.|[^\"\\])*)\"\s*\]", m.group(1)):
        frag["proposal"]["err_" + unescape(code).replace("-", "_")] = unescape(sent)
    # 2c. INNER_DEFS labels + human placeholders.
    m = re.search(r"var INNER_DEFS = \{(.*?)\};", prop, re.S)
    for kind in ("transfer", "whitelist", "ticket"):
        km = re.search(kind + r": \[(.*?)\]\]", m.group(1), re.S)
        defs = re.findall(r"\[\s*\"((?:\\.|[^\"\\])*)\"\s*,\s*\"((?:\\.|[^\"\\])*)\"(?:\s*,\s*\"((?:\\.|[^\"\\])*)\")?",
                          km.group(1))
        for i, d in enumerate(defs):
            frag["proposal"]["inner_%s_%d" % (kind, i)] = unescape(d[0])
            ph = unescape(d[1])
            if ph not in ("", "1.5", "180", "white"):
                frag["proposal"]["innerph_%s_%d" % (kind, i)] = ph
    # 2d. help TOPICS titles + guides.
    hlp = head("help-ui.js")
    m = re.search(r"var TOPICS = \[(.*?)\n  \];", hlp, re.S)
    for key, title, guide in re.findall(
            r"\[\s*\"((?:\\.|[^\"\\])*)\"\s*,\s*\"((?:\\.|[^\"\\])*)\"\s*,\s*\"((?:\\.|[^\"\\])*)\"",
            m.group(1)):
        key, title, guide = unescape(key), unescape(title), unescape(guide)
        frag["help"]["topic_" + key + "_title"] = title
        frag["help"]["topic_" + key + "_text"] = guide
    # 2e. create-worker KINDS labels.
    cw = head("create-worker-ui.js")
    m = re.search(r"var KINDS = \[(.*?)\];", cw, re.S)
    for val, label in re.findall(r"\[\s*\"((?:\\.|[^\"\\])*)\"\s*,\s*\"((?:\\.|[^\"\\])*)\"\s*\]", m.group(1)):
        frag["createworker"]["kind_" + unescape(val)] = unescape(label)

    frag = {ns: dict(sorted(sec.items())) for ns, sec in sorted(frag.items())}
    total = sum(len(v) for v in frag.values())
    ndyn = (20 + 3 + 13 + 11 + 8 + 42 + 3)
    print("fragment keys: %d (%d dynamic-from-HEAD) across %d sections"
          % (total, ndyn, len(frag)))
    if apply:
        with open(FRAG, "w", encoding="utf-8") as fh:
            json.dump(frag, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        print("wrote %s" % FRAG)


if __name__ == "__main__":
    main()
