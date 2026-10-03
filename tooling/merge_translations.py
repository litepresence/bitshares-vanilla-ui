#!/usr/bin/env python3
"""merge_translations.py — assemble translator chunks into a locale dict.

Translator workers write nested {section: {key: translation}} chunks to
/tmp/i18n-<lang>-<chunk>.json (chunks a/b/c/d per the wave plan). This script
deep-merges them onto the en.json structure, validates, and writes
vanilla/locales/<lang>.json.

- Default: REFUSES unless every en key is covered (lists missing keys).
- --partial: writes English-filled output but keeps an honest stub
  (_meta.untranslated=true, translated=[]) — for inspection only.
- Full merge flips _meta to {version:1, untranslated:false,
  translated:sorted(all keys)} and runs validate_translations.py.

Extra keys (not in en) are always an error. Stdlib only.

Usage: python3 tooling/merge_translations.py <lang> [--partial]
"""
import io
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CHUNKS = ["a", "b", "c", "d"]


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
        print("usage: merge_translations.py <lang> [--partial]")
        return 2
    lang, partial = sys.argv[1], "--partial" in sys.argv
    with io.open(os.path.join(HERE, "..", "vanilla", "locales", "en.json"),
                 encoding="utf-8") as f:
        en = json.load(f)
    en_flat = flat(en)
    got = {}
    for ch in CHUNKS:
        path = "/tmp/i18n-%s-%s.json" % (lang, ch)
        if not os.path.exists(path):
            if partial:
                continue
            print("missing chunk file: %s" % path)
            return 1
        with io.open(path, encoding="utf-8") as f:
            chunk = json.load(f)
        for sec, pairs in chunk.items():
            if not isinstance(pairs, dict):
                print("chunk %s: section %r is not an object" % (ch, sec))
                return 1
            for k, v in pairs.items():
                full = sec + "." + k
                if full not in en_flat:
                    print("chunk %s: extra key %r (not in en)" % (ch, full))
                    return 1
                if not isinstance(v, str) or not v.strip():
                    print("chunk %s: empty value for %r" % (ch, full))
                    return 1
                got[full] = v
    missing = sorted(set(en_flat) - set(got))
    out = json.loads(json.dumps(en))  # deep copy of structure
    for full in en_flat:
        sec, sub = full.split(".", 1)
        out[sec][sub] = got.get(full, en_flat[full])
    if missing and not partial:
        print("missing %d keys (first 10): %s" % (len(missing), missing[:10]))
        return 1
    if missing or partial:
        out["_meta"] = {"version": 1, "untranslated": True, "translated": []}
    else:
        out["_meta"] = {"version": 1, "untranslated": False,
                        "translated": sorted(en_flat)}
    dest = os.path.join(HERE, "..", "vanilla", "locales", lang + ".json")
    with io.open(dest, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("wrote %s (%d translated, %d English-filled)"
          % (dest, len(got), len(missing)))
    if not missing and not partial:
        r = subprocess.run([sys.executable,
                            os.path.join(HERE, "validate_translations.py"),
                            lang], capture_output=True, text=True)
        print(r.stdout.strip() or r.stderr.strip())
        return r.returncode
    return 0


if __name__ == "__main__":
    sys.exit(main())
