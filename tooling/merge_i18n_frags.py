#!/usr/bin/env python3
"""Merge i18n batch fragments into the 10 locale dicts (director step).

New keys land in en.json as translated; the other 9 dicts receive the same
keys with ENGLISH values OUTSIDE their `translated` allowlists (honest
fallback, batch-1 stub precedent). Fragments are deleted after a successful
merge. Usage: python3 tooling/merge_i18n_frags.py frag-batch2a frag-batch2b ...
"""
import json
import os
import sys

LOCALES = ["en", "de", "es", "fr", "it", "ja", "ko", "ru", "tr", "zh", "hi", "pt"]
BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "vanilla", "locales")


def deep_set(tree, dotted, value):
    node = tree
    parts = dotted.split(".")
    for p in parts[:-1]:
        node = node.setdefault(p, {})
    node[parts[-1]] = value


def flat_keys(tree, prefix=""):
    out = {}
    for k, v in tree.items():
        if k == "_meta":
            continue
        if isinstance(v, dict):
            out.update(flat_keys(v, prefix + k + "."))
        else:
            out[prefix + k] = v
    return out


def main(names):
    merged = {}
    for name in names:
        path = os.path.join(BASE, "frag-" + name + ".json")
        frag = json.load(open(path))
        for key, val in flat_keys(frag).items():
            merged[key] = val
    dicts = {}
    for code in LOCALES:
        with open(os.path.join(BASE, code + ".json")) as f:
            dicts[code] = json.load(f)
    added = 0
    for key, val in sorted(merged.items()):
        cur = dicts["en"]
        node = cur
        parts = key.split(".")
        exists = True
        for p in parts[:-1]:
            node = node.get(p)
            if not isinstance(node, dict):
                exists = False
                break
        if exists and parts[-1] in node and node[parts[-1]] != val:
            print("CONFLICT en %s: %r vs frag %r" % (key, node[parts[-1]], val))
            continue
        deep_set(dicts["en"], key, val)
        if key not in dicts["en"].get("_meta", {}).get("translated", []):
            dicts["en"].setdefault("_meta", {}).setdefault("translated", []).append(key)
        for code in LOCALES[1:]:
            deep_set(dicts[code], key, val)  # en-copy, outside allowlist
        added += 1
    for code in LOCALES:
        with open(os.path.join(BASE, code + ".json"), "w") as f:
            json.dump(dicts[code], f, ensure_ascii=False, indent=2)
            f.write("\n")
    for name in names:
        os.remove(os.path.join(BASE, "frag-" + name + ".json"))
    print("merged %d keys from %s; fragments removed" % (added, ",".join(names)))


if __name__ == "__main__":
    main(sys.argv[1:])
