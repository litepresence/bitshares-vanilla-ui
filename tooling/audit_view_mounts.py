#!/usr/bin/env python3
"""audit_view_mounts.py — the view-mount contract checker.

WHY: the Account Network page (2026-10-09) shipped a page that never cleared
the router mount, so arriving from another view stacked it UNDER the stale
page instead of replacing it (the Labs TOC stayed on screen above it), and it
discarded the DOM.pageHead() return value so the page had no <h1> at all.
Direct-URL proofs hid both, because a fresh #view is empty — the defect only
appears on in-app navigation. This script hunts that whole bug class.

THE CONTRACT, from the router's design (vanilla/js/router.js render()):
  1. A view that appends to the router mount (`root`) MUST clear it first.
     The router hands a view #view with the PREVIOUS page still in it, so a
     view that only appends stacks under the old page. Accepted clearing
     forms (see CLEAR_FORMS below).
  2. DOM.pageHead(doc, title, icon) RETURNS the h1 node. Discarding the
     return value silently drops the page heading and its icon.

RULE (file level, deliberately): a file is reported when it appends to `root`
anywhere and clears `root` NOWHERE. Per-function checking false-positives on
honest helpers like `makeWrap(doc, root)`, which append after their caller
cleared. LIMIT, stated honestly: this proves the clear is absent from the
file, not that every render path performs it — an in-file audit by eye still
backs the checker up, and the browser nav probe is the real gate.

Run: python3 tooling/audit_view_mounts.py   (exit 1 on any finding)
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JS_ROOT = ROOT / "vanilla" / "js"

APPENDS_ROOT = re.compile(r"\broot\.appendChild\s*\(")
CLEAR_FORMS = (
    re.compile(r"(?:DOM\.)?clear\s*\(\s*root\s*\)"),
    re.compile(r"clearRoot\s*\(\s*root\s*\)"),
    re.compile(r"root\.innerHTML\s*=\s*['\"]['\"]"),
    re.compile(r"while\s*\(\s*root\s*&&\s*root\.firstChild\s*\)"),
    re.compile(r"_\w*clear\w*\s*\(\s*root\s*\)", re.IGNORECASE),
    # A local forwarding helper: clearBox(root) etc. Taken at its word — the
    # one such helper in the app (market-net-ui.js:83) forwards to DOM.clear.
    re.compile(r"\b\w*[cC]lear\w*\s*\(\s*root\s*\)"),
)
# DOM.pageHead(...) as a bare expression statement — the node is built and dropped.
PAGEHEAD_DROPPED = re.compile(r"^\s*(?:\w+\.)?DOM\.pageHead\s*\([^;]*\)\s*;?\s*$")


def main() -> int:
    findings: list[str] = []
    files = sorted(JS_ROOT.rglob("*.js"))
    for path in files:
        text = path.read_text(encoding="utf-8")
        rel = str(path.relative_to(ROOT))
        if APPENDS_ROOT.search(text) and not any(c.search(text) for c in CLEAR_FORMS):
            findings.append(f"{rel}  appends to `root` but never clears it anywhere in the file")
        for n, line in enumerate(text.splitlines(), start=1):
            if PAGEHEAD_DROPPED.match(line) and "appendChild" not in line:
                findings.append(
                    f"{rel}:{n}  DOM.pageHead() return value discarded (page renders with no heading)"
                )
    if findings:
        print("view-mount contract findings:")
        for f in findings:
            print("  " + f)
        print(f"\n{len(findings)} finding(s) — see the header comment for the contract.")
        return 1
    print(f"audit_view_mounts: PASS — {len(files)} files: every root-appending file clears its mount, "
          "no discarded pageHead()")
    return 0


if __name__ == "__main__":
    sys.exit(main())
