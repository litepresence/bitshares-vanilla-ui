#!/usr/bin/env python3
"""apply_audit_patch.py — apply an auditor's flat repair patch to a dict.

Reads /tmp/i18n-audit-<lang>.json ({full.dotted.key: fixed value}), verifies
every key exists in en.json (no extras) and every value is a non-empty string,
applies to vanilla/locales/<lang>.json, then runs validate_translations.py.
Refuses on any violation. Stdlib only.

Usage: python3 tooling/apply_audit_patch.py <lang>
"""
import io
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def flat(d, prefix=""):
    out = {}
    for k, v in d.items():
        if k == "_meta":
            continue
        kk = prefix + "." + k if prefix else k
        if isinstance(v, dict):
            out.update(flat(v, kk))
        else:
            out[kk] = v
    return out


def main():
    if len(sys.argv) < 2:
        print("usage: apply_audit_patch.py <lang>")
        return 2
    lang = sys.argv[1]
    with io.open("/tmp/i18n-audit-%s.json" % lang, encoding="utf-8") as f:
        patch = json.load(f)
    with io.open(os.path.join(HERE, "..", "vanilla", "locales", "en.json"),
                 encoding="utf-8") as f:
        en = json.load(f)
    en_flat = flat(en)
    for key, val in patch.items():
        if key not in en_flat:
            print("extra key %r (not in en) — refusing" % key)
            return 1
        if not isinstance(val, str) or not val.strip():
            print("empty value for %r — refusing" % key)
            return 1
    dest = os.path.join(HERE, "..", "vanilla", "locales", lang + ".json")
    with io.open(dest, encoding="utf-8") as f:
        data = json.load(f)
    for key, val in patch.items():
        sec, sub = key.split(".", 1)
        data[sec][sub] = val
    with io.open(dest, "w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("patched %s (%d keys)" % (dest, len(patch)))
    r = subprocess.run([sys.executable, os.path.join(HERE, "validate_translations.py"),
                        lang], capture_output=True, text=True)
    print((r.stdout or "").strip() or (r.stderr or "").strip())
    return r.returncode


if __name__ == "__main__":
    sys.exit(main())
