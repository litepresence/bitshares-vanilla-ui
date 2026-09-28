#!/usr/bin/env python3
"""Extract-diff proof for i18n batch-2b (market + trade views).

For each t("key", "default") call site in the batch-2b file set:
  1. the default MUST occur byte-verbatim in the git HEAD blob of that file
     (no rewording -- the call-site default is the English guarantee);
  2. the key MUST live under market.* / trade.* and resolve either to
     vanilla/locales/en.json (reused batch-1/stub keys) or to
     vanilla/locales/frag-batch2b.json (new batch keys, same default);
  3. every frag-batch2b.json key MUST be consumed by >=1 site (no orphans).

Files with zero expected sites (market-candles.js: no DOM; market-charts.js:
canvas-fillText only) assert zero t() sites.

Usage: python3 tooling/verify_batch_i18n.py  (exit 0 green, 1 with problems)
"""
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
VANILLA = os.path.join(HERE, "..", "vanilla")
JS = os.path.join(VANILLA, "js")

TOUCHED = ["market-desk.js", "market-picker.js", "market-ind.js",
           "market-book.js", "market-orders.js", "charts-lwc.js",
           "trade-form.js", "trade-cancel.js"]
ZERO_SITE = ["market-candles.js", "market-charts.js"]

T_CALL_RE = re.compile(
    r"""\bt\(\s*"(?P<key>(?:\\.|[^"\\])*)"\s*,\s*"(?P<dflt>(?:\\.|[^"\\])*)"\s*(?:,\s*\{[^}]*\})?\s*\)"""
)


def unesc(s):
    return s.replace('\\"', '"').replace("\\\\", "\\")


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


def head_blob(name):
    return subprocess.run(["git", "show", "HEAD:vanilla/js/" + name],
                          cwd=os.path.join(HERE, ".."),
                          capture_output=True, text=True).stdout


def main():
    problems = []
    en = json.load(open(os.path.join(VANILLA, "locales", "en.json"), encoding="utf-8"))
    en_flat = flatten(en)
    frag_path = os.path.join(VANILLA, "locales", "frag-batch2b.json")
    if not os.path.exists(frag_path):
        print("frag-batch2b.json missing")
        return 1
    frag = json.load(open(frag_path, encoding="utf-8"))
    frag_flat = flatten(frag)

    for sec in [k for k in frag if k != "_meta"]:
        if sec not in ("market", "trade"):
            problems.append("fragment section %r outside market.*/trade.*" % sec)

    sites = []  # (file, key, default)
    per_file = {}
    for name in TOUCHED + ZERO_SITE:
        src = open(os.path.join(JS, name), encoding="utf-8").read()
        found = [(unesc(m.group("key")), unesc(m.group("dflt")))
                 for m in T_CALL_RE.finditer(src)]
        per_file[name] = len(found)
        head = head_blob(name)
        for (key, dflt) in found:
            sites.append((name, key, dflt))
            if key in en_flat:
                pass  # reused pre-existing key (batch-1/stub): section predates us
            elif not (key.startswith("market.") or key.startswith("trade.")):
                problems.append("%s: NEW key %r outside market.*/trade.*" % (name, key))
            if dflt not in head:
                problems.append("%s: default %r not verbatim in HEAD blob" % (name, dflt))
            if key in en_flat:
                if en_flat[key] != dflt:
                    problems.append("%s: default for %s != en.json value" % (name, key))
            elif key in frag_flat:
                if frag_flat[key] != dflt:
                    problems.append("%s: default for %s != fragment value" % (name, key))
            else:
                problems.append("%s: key %r in neither en.json nor fragment" % (name, key))

    for name in ZERO_SITE:
        if per_file[name] != 0:
            problems.append("%s: expected zero t() sites, found %d" % (name, per_file[name]))

    used = set(k for (_, k, _) in sites)
    for key in sorted(frag_flat):
        if key not in used and key not in en_flat:
            problems.append("fragment orphan (no call site): %s" % key)

    print("sites per file: " + ", ".join("%s=%d" % (n, per_file[n]) for n in TOUCHED + ZERO_SITE))
    print("total sites: %d; fragment keys: %d; reused en keys: %d" % (
        len(sites), len(frag_flat), len(set(k for (_, k, _) in sites if k in en_flat))))
    if problems:
        print("FAIL:")
        print("\n".join(problems))
        return 1
    print("OK: all defaults byte-verbatim vs HEAD; keys resolve; no orphans.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
