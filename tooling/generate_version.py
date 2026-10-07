#!/usr/bin/env python3
"""Generate vanilla/version.json from local git (footer build-info).

Writes {repo, branch, commit, short, ahead_of_master, generated_at} for the footer-left
"commit + ahead/behind Master" display (spec
docs/superpowers/specs/2026-10-04-footer-build-info-design.md).
Optional dev/deploy tooling: the app runs without version.json (the static
skeleton stays). Safe to re-run. Verify with: git rev-parse HEAD.
Branch is pinned to "master" (not HEAD's ref) because the footer always
reports the build against Master (compare base + link label).
ahead_of_master counts HEAD vs origin/master at generation (null when origin is unknown); the footer shows it only for 404 builds, labeled with the build date.
Usage: python3 tooling/generate_version.py [--repo owner/name]
"""
import datetime
import json
import os
import subprocess
import sys

DEFAULT_REPO = "litepresence/bitshares-vanilla-ui"


def sh(args, cwd):
    """Run git and return stripped stdout (failures raise, caught in main)."""
    return subprocess.check_output(args, cwd=cwd, stderr=subprocess.DEVNULL).decode().strip()


def main():
    repo = DEFAULT_REPO
    args = sys.argv[1:]
    if len(args) == 0:
        pass
    elif len(args) == 2 and args[0] == "--repo" and "/" in args[1]:
        repo = args[1]
    else:
        print("usage: generate_version.py [--repo owner/name]", file=sys.stderr)
        return 2
    try:
        top = sh(["git", "rev-parse", "--show-toplevel"], os.getcwd())
        commit = sh(["git", "rev-parse", "HEAD"], top)
        branch = "master"
    except (subprocess.CalledProcessError, OSError) as e:
        print("generate_version: not a git checkout (%s)" % e, file=sys.stderr)
        return 1
    if len(commit) != 40:
        print("generate_version: unexpected HEAD %r" % commit, file=sys.stderr)
        return 1
    try:
        ahead = int(sh(["git", "rev-list", "--count", "origin/master..HEAD"], top))
        if ahead < 0:
            ahead = None
    except (subprocess.CalledProcessError, OSError, ValueError):
        ahead = None
    info = {"repo": repo, "branch": branch or "master", "commit": commit.lower(),
            "short": commit.lower()[:7], "ahead_of_master": ahead,
            "generated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
    out = os.path.join(top, "vanilla", "version.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(info, f, indent=2)
        f.write("\n")
    print("generate_version: wrote " + out)
    stamp_assets(top, info["short"])
    return 0


def stamp_assets(top, short):
    """Stamp local asset refs in vanilla/index.html with ?v=<short> (idempotent).

    Browsers cache version-agnostic script/css URLs indefinitely, so physics
    (or any shipped-JS) fixes silently never arrive ("buttons do nothing"
    after a deploy). Stamping at deploy/generation time busts the cache;
    stripping any prior ?v= first keeps re-runs stable. Local relative refs
    only (never http/CDN); served identically by any static server.
    """
    import re
    idx = os.path.join(top, "vanilla", "index.html")
    try:
        with open(idx, "r", encoding="utf-8") as f:
            html = f.read()
    except OSError as e:
        print("generate_version: skip asset stamp (%s)" % e, file=sys.stderr)
        return
    def repl(m):
        attr, url = m.group(1), m.group(2)
        if url.startswith(("http:", "https:", "//", "data:")):
            return m.group(0)
        base = url.split("?", 1)[0]
        return '%s="%s?v=%s"' % (attr, base, short)
    stamped, n = re.subn(r'(src|href)="([^"]+\.(?:js|css))[^"]*"', repl, html)
    if n == 0:
        print("generate_version: no local asset refs found", file=sys.stderr)
        return
    with open(idx, "w", encoding="utf-8") as f:
        f.write(stamped)
    print("generate_version: stamped %d asset refs ?v=%s" % (n, short))


if __name__ == "__main__":
    sys.exit(main())
