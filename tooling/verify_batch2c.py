#!/usr/bin/env python3
"""Extract-diff proof for i18n batch-2c (vote + explorer + gateway + notify).

For each t("key", "default") call site in the batch-2c file set:
  1. the default MUST occur byte-verbatim in the git HEAD blob of that file
     (no rewording -- the call-site default is the English guarantee;
     batch-2b precedent: dynamic sentences keep code structure, only
     complete static literals are wrapped);
  2. the key MUST live under vote.* / explorer.* / gateway.* / notify.*
     and resolve to vanilla/locales/frag-batch2c.json with the same default
     (en.json is NOT touched by this batch);
  3. every frag-batch2c.json key MUST be consumed by >=1 site (no orphans).

Usage: python3 tooling/verify_batch2c.py  (exit 0 green, 1 with problems)
"""
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
VANILLA = os.path.join(HERE, "..", "vanilla")
JS = os.path.join(VANILLA, "js")

TOUCHED = ["vote-ui.js", "vote-slate.js", "explorer-ui.js",
           "explorer-blocks.js", "explorer-assets.js", "explorer-render.js",
           "gateway-ui.js", "notify-ui.js", "notify-host.js"]
SECTIONS = ("vote", "explorer", "gateway", "notify")

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
    frag_path = os.path.join(VANILLA, "locales", "frag-batch2c.json")
    if not os.path.exists(frag_path):
        print("frag-batch2c.json missing")
        return 1
    frag = json.load(open(frag_path, encoding="utf-8"))
    frag_flat = flatten(frag)

    for sec in [k for k in frag if k != "_meta"]:
        if sec not in SECTIONS:
            problems.append("fragment section %r outside vote.*/explorer.*/gateway.*/notify.*" % sec)

    sites = []
    per_file = {}
    for name in TOUCHED:
        src = open(os.path.join(JS, name), encoding="utf-8").read()
        found = [(unesc(m.group("key")), unesc(m.group("dflt")))
                 for m in T_CALL_RE.finditer(src)]
        per_file[name] = len(found)
        head = head_blob(name)
        for (key, dflt) in found:
            sites.append((name, key, dflt))
            if key.split(".")[0] not in SECTIONS or len(key.split(".")) != 2:
                problems.append("%s: key %r outside batch namespaces" % (name, key))
            if dflt not in head:
                problems.append("%s: default %r not verbatim in HEAD blob" % (name, dflt))
            if key in frag_flat:
                if frag_flat[key] != dflt:
                    problems.append("%s: default for %s != fragment value" % (name, key))
            else:
                problems.append("%s: key %r not in frag-batch2c.json" % (name, key))

    used = set(k for (_, k, _) in sites)
    for key in sorted(frag_flat):
        if key not in used:
            problems.append("fragment orphan (no call site): %s" % key)

    print("sites per file: " + ", ".join("%s=%d" % (n, per_file[n]) for n in TOUCHED))
    print("total sites: %d; fragment keys: %d" % (len(sites), len(frag_flat)))
    if problems:
        print("FAIL:")
        print("\n".join(problems))
        return 1
    print("OK: all defaults byte-verbatim vs HEAD; keys resolve; no orphans.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
