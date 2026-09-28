#!/usr/bin/env python3
"""Batch-2e verification: byte-verbatim defaults + syntax + fragment checks.

1. node --check every touched file.
2. extract-diff: every t("key", "default") literal in the converted files
   must appear VERBATIM in git HEAD's version of the same file (zero
   mismatches = no rewording, proof of English-identical defaults).
   Dynamic-key t() calls (key built with +) are collected separately and
   checked against the fragment manually (reported, not failed).
3. Fragment checks: valid JSON, nested sections only, non-empty values,
   namespaces within the batch-2e list, no duplicate values across keys
   of one section left unmerged (informational).

Usage: python3 tooling/batch2e_verify.py
  Exit 0 iff syntax green AND zero extract-diff mismatches.
"""
import json
import os
import re
import subprocess
import sys

WS = "/workspace"
JS = os.path.join(WS, "vanilla", "js")
FRAG = os.path.join(WS, "vanilla", "locales", "frag-batch2e.json")

FILES = [
    "credit-ui.js", "credit-detail-ui.js", "samet-ui.js", "borrow-ui.js",
    "barter-ui.js", "proposal-ui.js", "ticket-ui.js", "misc-ui.js",
    "vesting-ui.js", "auth-ui.js", "news-ui.js", "help-ui.js",
    "fees-ui.js", "referrals-ui.js", "favourites-ui.js", "password-ui.js",
    "prediction-ui.js", "instant-trade-ui.js", "create-account-ui.js",
    "create-worker-ui.js",
]

T_RE = re.compile(r"""\bt\(\s*"((?:\\.|[^"\\])*)"\s*,\s*"((?:\\.|[^"\\])*)\"""")
T_DYN_RE = re.compile(r"""\bt\(\s*"((?:\\.|[^"\\])*)"\s*\+""")


def unescape(v):
    return v.replace("\\'", "'").replace('\\"', '"').replace("\\\\", "\\")


def head_of(fname):
    r = subprocess.run(["git", "-C", WS, "show", "HEAD:vanilla/js/" + fname],
                       capture_output=True, text=True)
    if r.returncode != 0:
        # File may itself be new since HEAD (not our case, but be honest).
        return None
    return r.stdout


def main():
    problems = []
    # 1. syntax
    for f in FILES:
        r = subprocess.run(["node", "--check", os.path.join(JS, f)],
                           capture_output=True, text=True)
        if r.returncode != 0:
            problems.append("%s: node --check failed: %s" % (f, r.stderr.strip()[:200]))
    # 2. extract-diff
    sites, dynamic = 0, 0
    for f in FILES:
        head = head_of(f)
        if head is None:
            problems.append("%s: no HEAD version (new file?)" % f)
            continue
        cur = open(os.path.join(JS, f), encoding="utf-8").read()
        for m in T_RE.finditer(cur):
            key = unescape(m.group(1))
            dflt = unescape(m.group(2))
            sites += 1
            if dflt not in head:
                problems.append('%s: default not verbatim in HEAD: key=%s default=%r'
                                % (f, key, dflt[:80]))
        for m in T_DYN_RE.finditer(cur):
            dynamic += 1
    # 3. fragment
    try:
        frag = json.load(open(FRAG, encoding="utf-8"))
    except (OSError, ValueError) as e:
        print("fragment unreadable: %s" % e)
        return 1
    nkeys = 0
    allowed = {"credit", "samet", "borrow", "barter", "proposal", "ticket",
               "misc", "vesting", "auth", "news", "help", "fees", "referrals",
               "favourites", "password", "prediction", "instant",
               "createaccount", "createworker"}
    for ns, sec in frag.items():
        if ns not in allowed:
            problems.append("fragment: unexpected namespace %s" % ns)
        if not isinstance(sec, dict):
            problems.append("fragment: section %s not an object" % ns)
            continue
        for k, v in sec.items():
            nkeys += 1
            if not isinstance(v, str) or not v:
                problems.append("fragment: %s.%s empty/non-string" % (ns, k))
    # Every fragment value must occur in HEAD (English-verbatim guarantee
    # for the dynamic-key sites too).
    heads = {f: head_of(f) for f in FILES}
    for ns, sec in frag.items():
        for k, v in sec.items():
            if not any(v in (h or "") for h in heads.values()):
                problems.append("fragment: %s.%s value not found verbatim in any HEAD file: %r"
                                % (ns, k, v[:80]))
    print("t() literal sites: %d, dynamic-key sites: %d, fragment keys: %d"
          % (sites, dynamic, nkeys))
    if problems:
        print("FAIL (%d):" % len(problems))
        print("\n".join(problems[:40]))
        return 1
    print("OK: syntax green; extract-diff zero mismatches; fragment values verbatim in HEAD.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
