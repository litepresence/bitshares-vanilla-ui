#!/usr/bin/env python3
"""One-shot: Labs/Personal menu split keys (nav-pulldown Task 3, 2026-10-04).

Owner ruling: the old "Labs & Personal" section splits into Labs
(#/menu/labs: api-lab, es-lab, txbuilder) + Personal (#/menu/personal:
trollbox, favourites, alerts, help, about, community, settings).

Delta in all 12 vanilla/locales/*.json, as honest English stubs
(principle #10 — translators verify later; check_i18n.py enforces key
equality + allowlist exactness):
  SET menu.section_labs -> "Labs" (was "Labs & Personal")
  SET menu.blurb_labs -> "Power tools for chain and node work."
      (was "Power tools, chat, and your setup.")
  ADD menu.section_personal ("Personal"), menu.blurb_personal
      ("Chat, alerts, and your setup.")

Exact string surgery only (no JSON round-trip, diffs stay minimal).
Safe to re-run: finished files match the done markers and are untouched.
Aborts a file on an unexpected hit count. Verify with:
  python3 tooling/check_i18n.py
"""
import glob
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "vanilla", "locales")

# (pattern, replacement, done_marker)
# done_marker present in src -> step already applied, skip.
STEPS = [
    # _meta.translated, alpha order: blurb_labs < blurb_personal < blurb_trade.
    (re.compile(r'^(      "menu\.blurb_labs",\n)(      "menu\.blurb_trade",\n)',
                re.MULTILINE),
     '\\1      "menu.blurb_personal",\n\\2',
     '"menu.blurb_personal"'),
    # _meta.translated, alpha order: section_more < section_personal < section_trade.
    (re.compile(r'^(      "menu\.section_more",\n)(      "menu\.section_trade",\n)',
                re.MULTILINE),
     '\\1      "menu.section_personal",\n\\2',
     '"menu.section_personal"'),
    # menu dict: section_labs/blurb_labs sit together (values differ per
    # locale, so match any value); reset both to the new English defaults
    # and append the personal pair right after (page keys stay put).
    (re.compile(r'^    "section_labs": "[^"\n]*",\n    "blurb_labs": "[^"\n]*",\n',
                re.MULTILINE),
     '    "section_labs": "Labs",\n'
     '    "blurb_labs": "Power tools for chain and node work.",\n'
     '    "section_personal": "Personal",\n'
     '    "blurb_personal": "Chat, alerts, and your setup.",\n',
     '"section_personal"'),
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
        for rx, new, done_marker in STEPS:
            if done_marker in src:
                continue
            hits = rx.findall(src)
            if len(hits) != 1:
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
