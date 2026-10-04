#!/usr/bin/env python3
"""One-shot: split node-table columns Head + Chain + History (2026-10-04).

Delta on top of rename_latency_columns_i18n.py, all 12 vanilla/locales/*.json
as honest English stubs (principle #10 — translators verify later):
  ADD settings.th_head ("Head"), settings.th_chain ("Chain"),
      settings.th_history ("History")
  DROP settings.th_status (Status column split away, zero call sites left)
  SET settings.hist_yes -> "YES", settings.hist_no -> "NO" (own column now;
      the old " (History)"/" (No history)" paren wrap is gone from histInfo)

Exact string surgery only (no JSON round-trip, diffs stay minimal).
Safe to re-run: finished files match nothing and are left untouched.
Aborts a file on an unexpected hit count. Verify with:
  python3 tooling/check_i18n.py
"""
import glob
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "vanilla", "locales")

# (pattern, replacement, done_marker, missing_ok)
# done_marker present in src -> step already applied, skip.
# missing_ok + zero hits -> already removed, skip; else abort.
STEPS = [
    # _meta.translated, alpha order (th_chain, th_handshake, th_head,
    # th_history, th_node, ...). Phase-1 left th_handshake+th_history
    # adjacent; th_head goes between them.
    (re.compile(r'^(      "settings\.th_handshake",\n)(      "settings\.th_history",\n)',
                re.MULTILINE),
     '\\1      "settings.th_head",\n\\2',
     '"settings.th_head"', False),
    # settings dict: th_head between th_handshake and th_history.
    (re.compile(r'^(    "th_handshake": "Handshake",\n)(    "th_history": "History",\n)',
                re.MULTILINE),
     '\\1    "th_head": "Head",\n\\2',
     '"th_head"', False),
]


def main():
    fails = []
    for path in sorted(glob.glob(os.path.join(LOCALES, "*.json"))):
        name = os.path.basename(path)
        try:
            src = open(path, encoding="utf-8").read()
        except OSError as e:
            fails.append("%s unreadable: %s" % (name, e))
            continue
        changed = False
        for rx, new, done_marker, missing_ok in STEPS:
            if done_marker in src:
                continue
            hits = rx.findall(src)
            if len(hits) != 1:
                if missing_ok and not hits:
                    continue
                fails.append("%s: %r hits=%d (want 1)"
                             % (name, rx.pattern[:44], len(hits)))
                changed = None
                break
            src = rx.sub(new, src)
            changed = True
        if changed is None:
            continue
        if changed:
            open(path, "w", encoding="utf-8").write(src)
        print("checked %s%s" % (name, " (updated)" if changed else ""))
    if fails:
        print("\n".join(fails))
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
