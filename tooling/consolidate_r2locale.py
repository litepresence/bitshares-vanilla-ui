#!/usr/bin/env python3
"""R2-LOCALE: consolidate top-15 duplicated locale strings into common.*.

Deterministic, batchable (run --batch 1|2|3). Per batch, for each cluster:
  1. Discover old keys in en.json by EXACT whole-value match (aborts on
     count mismatch -- see EXPECTED table below).
  2. Per-locale new value = most-frequent variant among old keys
     (Counter, ties -> first-seen in en.json order). Never invents
     translations; stubs keep == en automatically (their values ARE en).
  3. Delete old keys from all 12 dicts; set common.<new> (section appended
     at end if missing -- top-level sections are NOT alphabetical, so no
     alpha insert); fix _meta.translated (drop olds, add new iff an old
     was listed; list kept sorted iff it already was).
  4. Static call sites: t("old.key", <default>) -> t("common.new",
     <identical default>) -- key prefix only, defaults byte-identical.
     Dynamic sites (proposal-ui.js ERRMAP/innerph) are NOT touched here;
     they get explicit remap edits alongside their batch.

Usage: python3 tooling/consolidate_r2locale.py --batch N   (from /workspace)

Deviations from the brief (verified at runtime, see task report):
  D1 common.account_name value is "Account name " WITH trailing space --
     all 4 old keys carry it verbatim; the brief's "Account name" matches
     zero keys, so verbatim wins (drift gate requires byte-identity).
  D2 No transfer/failed-check key exists (transfer-ui.js has no such call);
     common.failed_check_state reuses the 5-key cluster value verbatim.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "vanilla", "locales")
JSROOT = os.path.join(HERE, "..", "vanilla", "js")
INDEX_HTML = os.path.join(HERE, "..", "vanilla", "index.html")
CODES = ["en", "de", "es", "fr", "hi", "it", "ja", "ko", "pt", "ru", "tr", "zh"]

# (batch, new subkey, exact en value, expected old-key count)
CLUSTERS = [
    (1, "network_unavailable",
     "Network unavailable. Check Settings \u2192 Nodes and retry.", 20),
    (1, "status_broadcasting", "Broadcasting\u2026", 15),
    (1, "unexpected_error", "Unexpected error", 16),
    (1, "wallet_locked", "Wallet is locked.", 10),
    (1, "status_connecting", "Connecting to network\u2026", 10),
    (2, "sign_send", "Sign & Send", 9),
    (2, "unknown_account", "Unknown account.", 8),
    (2, "fee_live", "Fee (live)", 7),
    (2, "network_unavailable_short", "Network unavailable.", 7),
    (2, "account_name", "Account name ", 4),  # D1: trailing space verbatim
    (3, "name_or_id_hint", "name or 1.2.N", 12),
    (3, "symbol_or_id_hint", "symbol or 1.3.x", 6),
    (3, "import_existing", "Import existing account", 4),
    (3, "failed_check_state",  # D2: 5-key cluster value, no transfer key
     "Failed. Check state before retrying (do NOT blindly rebroadcast).", 5),
    (3, "status_signing", "Signing\u2026", 8),
]


def load(code):
    with open(os.path.join(LOCALES, code + ".json"), encoding="utf-8") as f:
        return json.load(f)


def dump(code, data):
    with open(os.path.join(LOCALES, code + ".json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def flatten_sections(data):
    """(section, subkey) -> value, section order + key order preserved."""
    out = []
    for sec, val in data.items():
        if sec == "_meta" or not isinstance(val, dict):
            continue
        for sub, text in val.items():
            out.append(((sec, sub), text))
    return out


def main():
    batch = int(sys.argv[sys.argv.index("--batch") + 1])
    work = [c for c in CLUSTERS if c[0] == batch]
    assert len(work) == 5, "batch %d must hold exactly 5 clusters" % batch

    dicts = {code: load(code) for code in CODES}
    en_flat = flatten_sections(dicts["en"])

    # 1-2. Discover + vote.
    plan = []  # (newkey, en_value, old dotted keys, {code: value})
    for _, new, en_value, expected in work:
        olds = [sec + "." + sub for (sec, sub), v in en_flat if v == en_value]
        if len(olds) != expected:
            print("ABORT: %r matched %d keys (expected %d): %s"
                  % (en_value, len(olds), expected, olds))
            return 1
        per_locale = {}
        for code in CODES:
            seen = []
            for dotted in olds:
                sec, sub = dotted.split(".", 1)
                seen.append(dicts[code][sec][sub])
            counts = {}
            for v in seen:
                counts[v] = counts.get(v, 0) + 1
            best = max(counts.values())
            per_locale[code] = next(v for v in seen if counts[v] == best)
        plan.append((new, en_value, olds, per_locale))
        print("cluster common.%s: %d old keys, es=%r en=%r"
              % (new, len(olds), per_locale["es"], per_locale["en"]))

    # 3. Dict edits.
    for code in CODES:
        d = dicts[code]
        for new, _en_value, olds, per_locale in plan:
            listed = False
            for dotted in olds:
                sec, sub = dotted.split(".", 1)
                del d[sec][sub]
                if dotted in d["_meta"]["translated"]:
                    d["_meta"]["translated"].remove(dotted)
                    listed = True
            if "common" not in d:
                d["common"] = {}
            d["common"][new] = per_locale[code]
            if listed and "common." + new not in d["_meta"]["translated"]:
                d["_meta"]["translated"].append("common." + new)
        tr = d["_meta"]["translated"]
        if tr == sorted(tr):
            d["_meta"]["translated"] = sorted(tr)
        dump(code, d)

    # 4. Static call-site swaps (key only; defaults untouched).
    js_files = []
    for root, _dirs, files in os.walk(JSROOT):
        for fn in files:
            if fn.endswith(".js"):
                js_files.append(os.path.join(root, fn))
    js_files.append(INDEX_HTML)
    swaps = 0
    for new, _en_value, olds, _per in plan:
        for dotted in olds:
            # t( and tt( (offline.js local alias wraps the caller t).
            pat = re.compile(r'(\btt?\(\s*)"' + re.escape(dotted) + r'"(\s*,)')
            for path in js_files:
                with open(path, encoding="utf-8") as f:
                    src = f.read()
                src2, n = pat.subn(r'\1"common.' + new + r'"\2', src)
                if n:
                    with open(path, "w", encoding="utf-8") as f:
                        f.write(src2)
                    swaps += n
    print("static call-site swaps: %d" % swaps)

    # 5. Zero-ref verification (quoted dotted keys; excludes this script,
    # which holds no old-key literals -- discovery is runtime).
    leftovers = []
    scan_roots = [os.path.join(HERE, "..", "vanilla"),
                  os.path.join(HERE, "..", "docs"),
                  HERE]
    self_path = os.path.abspath(__file__)
    for _, new, olds, _per in plan:
        for dotted in olds:
            needle = '"' + dotted + '"'
            for root in scan_roots:
                for dirpath, _dirs, files in os.walk(root):
                    for fn in files:
                        if not fn.endswith((".js", ".html", ".json", ".md", ".py")):
                            continue
                        p = os.path.join(dirpath, fn)
                        if os.path.abspath(p) == self_path:
                            continue
                        with open(p, encoding="utf-8") as f:
                            if needle in f.read():
                                leftovers.append("%s in %s" % (dotted, p))
    if leftovers:
        print("LEFTOVER REFS (%d):" % len(leftovers))
        print("\n".join(sorted(set(leftovers))[:20]))
        return 1
    print("OK batch %d: no quoted refs to old keys remain in vanilla/ docs/" % batch)
    return 0


if __name__ == "__main__":
    sys.exit(main())
