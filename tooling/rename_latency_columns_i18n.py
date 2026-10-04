#!/usr/bin/env python3
"""One-shot: node-table columns Handshake + Ping + Participation (2026-10-04).

Renames settings.th_latency -> settings.th_handshake ("Handshake") and adds
settings.th_ping ("Ping") + settings.th_participation ("Participation") in all
12 vanilla/locales/*.json, as honest English stubs (principle #10: unverified
strings never masquerade as translations — check_i18n.py enforces key
equality + allowlist exactness, translators verify later).

Exact string surgery only (no JSON round-trip, diffs stay minimal):
  _meta.translated:  "settings.th_latency", -> "settings.th_handshake",
                     + th_participation/th_ping after th_node (alpha order)
  settings dict:     "th_node"/"th_latency" pair -> th_node + th_handshake +
                     th_participation + th_ping ("Handshake"/"Participation"/"Ping")

Aborts a file unless every replacement hits exactly once. Verify with:
  python3 tooling/check_i18n.py
"""
import glob
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "vanilla", "locales")

MAN_LAT = ('      "settings.th_latency",\n', '      "settings.th_handshake",\n')
MAN_NODE = ('      "settings.th_node",\n',
            '      "settings.th_node",\n'
            '      "settings.th_participation",\n'
            '      "settings.th_ping",\n')
DICT_RE = re.compile(
    r'^(    "th_node": ".*",\n)(    "th_latency": ".*",\n)', re.MULTILINE)
DICT_NEW = ('\\1'
            '    "th_handshake": "Handshake",\n'
            '    "th_participation": "Participation",\n'
            '    "th_ping": "Ping",\n')


def main():
    fails = []
    for path in sorted(glob.glob(os.path.join(LOCALES, "*.json"))):
        name = os.path.basename(path)
        try:
            src = open(path, encoding="utf-8").read()
        except OSError as e:
            fails.append("%s unreadable: %s" % (name, e))
            continue
        if src.count(MAN_LAT[0]) != 1:
            fails.append("%s: manifest th_latency hits=%d (want 1)"
                         % (name, src.count(MAN_LAT[0])))
            continue
        if src.count(MAN_NODE[0]) != 1:
            fails.append("%s: manifest th_node hits=%d (want 1)"
                         % (name, src.count(MAN_NODE[0])))
            continue
        if len(DICT_RE.findall(src)) != 1:
            fails.append("%s: dict th_node/th_latency pair hits=%d (want 1)"
                         % (name, len(DICT_RE.findall(src))))
            continue
        src = src.replace(MAN_LAT[0], MAN_LAT[1])
        src = src.replace(MAN_NODE[0], MAN_NODE[1])
        src = DICT_RE.sub(DICT_NEW, src)
        open(path, "w", encoding="utf-8").write(src)
        print("updated %s" % name)
    if fails:
        print("\n".join(fails))
        return 1
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
