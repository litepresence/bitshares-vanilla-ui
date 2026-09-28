#!/usr/bin/env python3
"""Census aid for i18n batch-2d (asset/htlc/debit/pool views).

Lists every single/double-quoted string literal in the 8 batch-2d files
with line number + enclosing context, so the worker can curate
convert-vs-skip decisions without retyping (defaults stay byte-verbatim).

Usage: python3 tooling/i18n_batch2d_census.py [file...]
Read-only: never modifies sources.
"""
import re
import sys

FILES = ["asset-ui.js", "asset-manage-ui.js", "asset-feed-ui.js", "htlc-ui.js",
         "debit-ui.js", "pool-ui.js", "pool-detail-ui.js", "pool-swap-ui.js"]
BASE = "/workspace/vanilla/js/"

STR_RE = re.compile(r"""'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*?`""")


def main():
    want = sys.argv[1:] or FILES
    for f in want:
        try:
            src = open(BASE + f, encoding="utf-8").read().split("\n")
        except OSError as e:
            print("## %s: unreadable %s" % (f, e))
            continue
        print("=" * 100)
        print("## FILE %s (%d lines)" % (f, len(src)))
        for i, line in enumerate(src, 1):
            for m in STR_RE.finditer(line):
                lit = m.group(0)
                if lit.startswith("`"):
                    kind = "TPL"
                elif len(lit) < 4:
                    continue
                else:
                    kind = "STR"
                print("%s:%d [%s] %s" % (f, i, kind, lit.strip()[:150]))
                print("      ctx: %s" % line.strip()[:190])


if __name__ == "__main__":
    main()
