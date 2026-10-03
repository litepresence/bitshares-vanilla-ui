#!/usr/bin/env python3
"""Collect t() keys missing from en.json and merge them (director tool).

Scans vanilla/js for t("key", "default") call sites, finds keys absent from
en.json, and merges them: en.json gets the verbatim default INSIDE the
translated allowlist; the other 9 dicts get en-copies OUTSIDE allowlists.
Fails loudly on default-vs-default conflicts for the same key.
Usage: python3 tooling/collect_i18n_orphans.py [--write]
  (default dry-run: prints keys that WOULD merge)
"""
import json
import os
import re
import sys

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "vanilla")
LOCALES = ["en", "de", "es", "fr", "it", "ja", "ko", "ru", "tr", "zh", "hi", "pt"]
Q = chr(34)
CALL = re.compile("(?<![A-Za-z0-9_$])t" + chr(92) + chr(40) + chr(92) + "s*" + Q + "([^" + Q + "]+)" + Q)


def find_calls(src):
    out = []
    for m in CALL.finditer(src):
        key = m.group(1)
        rest = src[m.end():].lstrip()
        if not rest.startswith(","):
            continue
        rest = rest[1:].lstrip()
        if not rest.startswith(Q):
            continue
        i, buf, esc = 1, [], False
        while i < len(rest):
            c = rest[i]
            if esc:
                buf.append(c)
                esc = False
            elif c == chr(92):
                esc = True
            elif c == Q:
                break
            else:
                buf.append(c)
            i += 1
        else:
            continue
        out.append((key, "".join(buf)))
    return out


def deep_get(tree, dotted):
    node = tree
    for p in dotted.split("."):
        if not isinstance(node, dict) or p not in node:
            return None
        node = node[p]
    return node if isinstance(node, str) else None


def deep_set(tree, dotted, value):
    node = tree
    parts = dotted.split(".")
    for p in parts[:-1]:
        node = node.setdefault(p, {})
    node[parts[-1]] = value


def main(write):
    found = {}
    for root, _, files in os.walk(os.path.join(BASE, "js")):
        for fn in sorted(files):
            if not fn.endswith(".js"):
                continue
            src = open(os.path.join(root, fn), encoding="utf-8").read()
            for key, val in find_calls(src):
                found.setdefault(key, set()).add(val)
    conflicts = {k: v for k, v in found.items() if len(v) > 1}
    if conflicts:
        for k, v in sorted(conflicts.items()):
            print("CONFLICT %s: %s" % (k, sorted(v)))
        sys.exit(1)
    en = json.load(open(os.path.join(BASE, "locales", "en.json")))
    orphans = {k: next(iter(v)) for k, v in found.items() if deep_get(en, k) is None}
    print("%d orphans" % len(orphans))
    for k in sorted(orphans):
        print("  %s = %r" % (k, orphans[k][:60]))
    if not write or not orphans:
        return
    dicts = {}
    for code in LOCALES:
        with open(os.path.join(BASE, "locales", code + ".json")) as f:
            dicts[code] = json.load(f)
    for key in sorted(orphans):
        deep_set(dicts["en"], key, orphans[key])
        tr = dicts["en"].setdefault("_meta", {}).setdefault("translated", [])
        if key not in tr:
            tr.append(key)
        for code in LOCALES[1:]:
            deep_set(dicts[code], key, orphans[key])
    for code in LOCALES:
        with open(os.path.join(BASE, "locales", code + ".json"), "w") as f:
            json.dump(dicts[code], f, ensure_ascii=False, indent=2)
            f.write("\n")
    print("merged")


if __name__ == "__main__":
    main("--write" in sys.argv)
