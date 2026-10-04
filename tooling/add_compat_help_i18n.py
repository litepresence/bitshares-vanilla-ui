#!/usr/bin/env python3
"""One-shot: compat insecure-context hint + help browser article
(tester-report follow-up).

1. compat.insecure_hint ("Your browser is current but this page is not in
   a secure context ...") in all 12 vanilla/locales/*.json as honest
   English stubs (principle #10).
2. help.topic_browser_{title,text,body} likewise (the compat banner links
   to #/help/browser; bodies stay English until verified, per the
   tester-manual §19 stub rule).

Exact string surgery only (no JSON round-trip, diffs stay minimal).
Safe to re-run. Verify with: python3 tooling/check_i18n.py
"""
import glob
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "vanilla", "locales")

HINT = "This address is not a secure context, so the browser withholds WebCrypto. The browser is current — serve over https or localhost, or open the file directly."
TITLE = "Browser support"
TEXT = "Which browsers run the wallet, and what the compatibility notice means."
BODY = (
    "# Detected features, never brand names\n"
    "This wallet never asks which browser you use — it probes the four platform features it genuinely needs: "
    "WebSocket (chain data), WebCrypto (keystore), BigInt (money math), and local storage (settings). "
    "Silence is a pass: no banner on a modern browser means everything is present.\n"
    "# The most common cause: insecure context\n"
    "Modern browsers expose WebCrypto only in secure contexts: https pages, localhost, and opened files. "
    "The same up-to-date browser served over plain http (for example a LAN address) reports WebCrypto missing — "
    "the browser is fine, the address is not. Serve the folder over https or localhost, or open index.html directly.\n"
    "# What still works\n"
    "Browsing always works: balances, markets, explorer, and voting read public chain data with no wallet features. "
    "Only local signing needs the missing piece. Dismissing the notice hides it on this machine; it never blocks a page."
)


def esc(s):
    # JSON-encode then strip the surrounding quotes: newlines, quotes,
    # and backslashes all escape correctly (literal newlines are invalid
    # in JSON strings — the 2026-10-04 compat run learned this the hard way).
    # Callers splice the result into a re.sub FUNCTION replacement (never a
    # template: backslashes in templates re-escape and corrupt the output).
    return json.dumps(s, ensure_ascii=False)[1:-1]


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

        def once(rx, new, done_marker):
            global_src = [src]
            if done_marker in global_src[0]:
                return True
            hits = rx.findall(global_src[0])
            if len(hits) != 1:
                fails.append("%s: %r hits=%d" % (name, rx.pattern[:50], len(hits)))
                return False
            global_src[0] = rx.sub(new, global_src[0])
            return global_src[0]

        # 1a. registry: insecure_hint between compat.dismiss and compat.msg.
        rx = re.compile(r'^(      "compat\.dismiss",\n)', re.MULTILINE)
        if '"compat.insecure_hint"' not in src:
            hits = rx.findall(src)
            if len(hits) != 1:
                fails.append("%s: compat registry anchor hits=%d" % (name, len(hits)))
                continue
            src = rx.sub('\\1      "compat.insecure_hint",\n', src)
            changed = True
        # 1b. compat dict after the msg line ("msg" is unique across dicts).
        if '"insecure_hint": "%s"' % esc(HINT) not in src:
            rx = re.compile(r'^(    "msg": ".*",\n)', re.MULTILINE)
            hits = rx.findall(src)
            if len(hits) != 1:
                fails.append("%s: compat dict anchor hits=%d" % (name, len(hits)))
                continue
            ins = esc(HINT)
            src = rx.sub(lambda m: m.group(1) + '    "insecure_hint": "%s",\n' % ins, src)
            changed = True
        # 2a. registry: browser trio before charts_body (alpha: browser < charts).
        rx = re.compile(r'^(      "help\.topic_charts_body",\n)', re.MULTILINE)
        if '"help.topic_browser_body"' not in src:
            hits = rx.findall(src)
            if len(hits) != 1:
                fails.append("%s: help registry anchor hits=%d" % (name, len(hits)))
                continue
            src = rx.sub(
                '      "help.topic_browser_body",\n'
                '      "help.topic_browser_text",\n'
                '      "help.topic_browser_title",\n\\1', src)
            changed = True
        # 2b/c. help dict title+text before the glossary_text line (key-only match).
        if '"topic_browser_title": "%s"' % esc(TITLE) not in src:
            rx = re.compile(r'^(    "topic_glossary_text": ".*",\n)', re.MULTILINE)
            hits = rx.findall(src)
            if len(hits) != 1:
                fails.append("%s: help dict text anchor hits=%d" % (name, len(hits)))
                continue
            ins_t, ins_x = esc(TEXT), esc(TITLE)
            src = rx.sub(
                lambda m: '    "topic_browser_text": "%s",\n'
                '    "topic_browser_title": "%s",\n%s' % (ins_t, ins_x, m.group(1)), src)
            changed = True
        # 2d. help dict body before charts_body (key-only match).
        if '"topic_browser_body": ' not in src:
            rx = re.compile(r'^(    "topic_charts_body": )', re.MULTILINE)
            hits = rx.findall(src)
            if len(hits) != 1:
                fails.append("%s: help dict body anchor hits=%d" % (name, len(hits)))
                continue
            ins_b = esc(BODY)
            src = rx.sub(lambda m: '    "topic_browser_body": "%s",\n%s' % (ins_b, m.group(1)), src)
            changed = True
        if changed:
            open(path, "w", encoding="utf-8").write(src)
            print("updated %s" % name)
    if fails:
        print("FAILURES:")
        for f in fails:
            print("  " + f)
        raise SystemExit(1)
    print("done")


if __name__ == "__main__":
    main()
