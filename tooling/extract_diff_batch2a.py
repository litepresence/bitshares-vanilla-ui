#!/usr/bin/env python3
"""Extract-diff for the batch-2a i18n conversion (transfer + account views).

Proves English-identical-by-construction: every t("key", "default") default
in the touched files resolves to copy that already existed pre-conversion.

Method (recorded):
  - Extract t("key", "default") call sites with the same regex as
    tooling/check_i18n.py (plus an optional {vars} third arg).
  - For plain defaults: assert the default occurs verbatim (substring) in
    `git show HEAD:vanilla/js/<file>`.
  - For interpolated defaults ("...%(name)s..."): split on %(name)s and
    assert every non-empty static fragment occurs verbatim in HEAD.
    Single-char punctuation fragments (".", " ", "(", ")") match trivially
    but are still required to match — nothing is waived.
  - OP_LABELS values in account-ui.js are the t() enDefaults via OP_KEYS
    (non-literal call, invisible to the regex): assert each value is either
    an en.json value (op 0 "Transfer" -> transfer.title) or a fragment value.
  - Fragment check: every extracted default for a NEW key equals
    frag-batch2a.json[section][key]; every extracted default for a
    PRE-EXISTING key equals en.json's value (the check_i18n.py condition).

Exit 0 with zero mismatches, else 1 with the mismatch list.
"""
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
VANILLA = os.path.join(HERE, "..", "vanilla")
JS = os.path.join(VANILLA, "js")
FILES = ["transfer-ui.js", "transfer-confirm.js", "account-ui.js", "accounts-ui.js"]

T_CALL_RE = re.compile(
    r"""\bt\(\s*"(?P<key>(?:\\.|[^"\\])*)"\s*,\s*"(?P<dflt>(?:\\.|[^"\\])*)"\s*(?:,\s*\{[^}]*\})?\s*\)"""
)
VAR_RE = re.compile(r"%\([^)]+\)s")


def unescape(s):
    return s.replace('\\"', '"').replace("\\\\", "\\")


def head_of(path):
    rel = os.path.relpath(path, os.path.join(HERE, "..")).replace(os.sep, "/")
    out = subprocess.run(
        ["git", "show", "HEAD:" + rel], cwd=os.path.join(HERE, ".."),
        capture_output=True, text=True)
    if out.returncode != 0:
        raise SystemExit("cannot read HEAD:" + rel)
    return out.stdout


def main():
    problems = []
    en = json.load(open(os.path.join(VANILLA, "locales", "en.json"), encoding="utf-8"))
    frag = json.load(open(os.path.join(VANILLA, "locales", "frag-batch2a.json"), encoding="utf-8"))

    def en_lookup(key):
        node = en
        for part in key.split("."):
            if not isinstance(node, dict) or part not in node:
                return None
            node = node[part]
        return node if isinstance(node, str) else None

    def frag_lookup(key):
        node = frag
        for part in key.split("."):
            if not isinstance(node, dict) or part not in node:
                return None
            node = node[part]
        return node if isinstance(node, str) else None

    total = 0
    interp = 0
    for f in FILES:
        path = os.path.join(JS, f)
        src = open(path, encoding="utf-8").read()
        old = head_of(path)
        for m in T_CALL_RE.finditer(src):
            total += 1
            key = unescape(m.group("key"))
            dflt = unescape(m.group("dflt"))
            pieces = [p for p in VAR_RE.split(dflt) if p != ""]
            if VAR_RE.search(dflt):
                interp += 1
            for piece in pieces:
                if piece not in old:
                    problems.append("%s: fragment %r of default for %s not in HEAD" % (f, piece, key))
            fv = frag_lookup(key)
            ev = en_lookup(key)
            if fv is not None:
                if dflt != fv:
                    problems.append("%s: default for new key %s != frag-batch2a value" % (f, key))
            elif ev is not None:
                if dflt != ev:
                    problems.append("%s: default for existing key %s != en.json value" % (f, key))
            else:
                problems.append("%s: key %s in NEITHER en.json NOR frag-batch2a" % (f, key))

    # OP_LABELS non-literal path (account-ui.js opLabel via OP_KEYS).
    acc = open(os.path.join(JS, "account-ui.js"), encoding="utf-8").read()
    labels = dict(re.findall(r"^\s*(\d+):\s*\"((?:\\.|[^\"\\])*)\"", acc, re.M))
    if len(labels) != 11:
        problems.append("account-ui.js: OP_LABELS parsed %d entries, want 11" % len(labels))
    opnames = ["x", "op_limit_create", "op_limit_cancel", "op_call_update", "op_fill",
               "op_account_create", "op_account_update", "op_whitelist", "op_upgrade",
               "op_account_transfer", "op_asset_create"]
    for n, v in sorted(labels.items(), key=lambda kv: int(kv[0])):
        v = unescape(v)
        if n == "0":
            if v != en_lookup("transfer.title"):
                problems.append("OP_LABELS[0] != transfer.title value")
        else:
            fv = frag_lookup("account." + opnames[int(n)])
            if v != fv:
                problems.append("OP_LABELS[%s] != frag account.%s value" % (n, opnames[int(n)]))

    if problems:
        print("FAIL (%d call sites, %d interpolated):" % (total, interp))
        print("\n".join(problems))
        return 1
    print("OK: %d t() call sites (%d interpolated) all verbatim in HEAD; "
          "fragment + en.json defaults match; OP_LABELS(11) covered." % (total, interp))
    return 0


if __name__ == "__main__":
    sys.exit(main())
