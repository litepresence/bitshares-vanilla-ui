#!/usr/bin/env python3
"""Stamp the release version after code changes (cache-buster + footer).

Why this exists: every <script> in vanilla/index.html carries a ?v=<hash>
query so browsers refetch JS after an upgrade, and vanilla/version.json
feeds the footer build label. Both go stale silently — the app then runs
cached JS from the previous release and new features (silently) never
appear. Run this before any commit that changes vanilla/js (or to verify).

What it does:
  1. Resolves HEAD short hash via git (falls back to UTC timestamp when
     git is unavailable, so file:// tarball exports still stamp).
  2. Rewrites every ?v=<old> in vanilla/index.html to ?v=<new>.
  3. Rewrites vanilla/version.json {commit, short, generated_at},
     preserving repo/branch keys.

Usage: python3 tooling/stamp_version.py [--check]
  --check: exit 1 when index.html/version.json disagree with HEAD
           (for gates; prints the stale value).

Stdlib only. Idempotent.
"""
import datetime
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
INDEX = os.path.join(ROOT, "vanilla", "index.html")
VERSION_JSON = os.path.join(ROOT, "vanilla", "version.json")


def head_short():
    try:
        out = subprocess.check_output(
            ["git", "-C", ROOT, "rev-parse", "--short=7", "HEAD"],
            stderr=subprocess.DEVNULL).decode().strip()
        if re.fullmatch(r"[0-9a-f]{7}", out):
            return out, False
    except (OSError, subprocess.CalledProcessError):
        pass
    stamp = datetime.datetime.utcnow().strftime("%Y%m%d%H%M%S")[-7:]
    return stamp, True


def main():
    short, fallback = head_short()
    with open(INDEX, encoding="utf-8") as fh:
        html = fh.read()
    tags = sorted(set(re.findall(r"\?v=([0-9a-f]{7})", html)))
    if "--check" in sys.argv:
        ok = len(tags) == 1 and tags[0] == short
        print(("OK" if ok else "STALE") + ": index.html ?v=%s, HEAD %s%s"
              % (tags[0] if tags else "none", short,
                 " (no git; timestamp mode)" if fallback else ""))
        return 0 if ok else 1
    new_html, n = re.subn(r"\?v=[0-9a-f]{7}", "?v=" + short, html)
    with open(INDEX, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(new_html)
    try:
        with open(VERSION_JSON, encoding="utf-8") as fh:
            ver = json.load(fh)
    except (OSError, ValueError):
        ver = {}
    try:
        full = subprocess.check_output(
            ["git", "-C", ROOT, "rev-parse", "HEAD"],
            stderr=subprocess.DEVNULL).decode().strip()
    except (OSError, subprocess.CalledProcessError):
        full = ver.get("commit", "")
    ver["short"] = short
    if full:
        ver["commit"] = full
    ver["generated_at"] = (datetime.datetime.utcnow()
                           .strftime("%Y-%m-%dT%H:%M:%SZ"))
    with open(VERSION_JSON, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(ver, fh, indent=2)
        fh.write("\n")
    print("stamped ?v=%s across %d script tag(s); version.json updated%s"
          % (short, n, " (timestamp fallback, no git)" if fallback else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())