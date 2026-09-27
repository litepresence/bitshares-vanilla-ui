#!/usr/bin/env python3
"""THE ANTI-ROT GATE (AGENTS.md section 8).

Fail if vanilla/ contains anything that could rot the way bitshares-ui
did (issue #3583): runtime manifests/lockfiles, framework imports, CDN
references, or files that need a build step to run.

Usage:  python3 tooling/check_rot.py   (run from /workspace)
Exit 0 = clean. Exit 1 = violations listed on stdout.

Stdlib only. No dependencies, ever.
"""

import os
import re
import sys

WORKSPACE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VANILLA = os.path.join(WORKSPACE, "vanilla")

# Files/dirs that must never exist inside vanilla/ (runtime manifests,
# lockfiles, build configs). Basenames, matched anywhere in the tree.
FORBIDDEN_NAMES = {
    "package.json",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lockb",
    "node_modules",
    "webpack.config.js",
    "vite.config.js",
    "vite.config.ts",
    "rollup.config.js",
    "esbuild.config.js",
    "tsconfig.json",
    ".babelrc",
    "babel.config.js",
    "Gemfile",
    "Cargo.toml",
}

# Source extensions that require a compile step: plain python http.server
# cannot serve these as a working app.
BUILD_REQUIRED_EXTS = {".ts", ".tsx", ".scss", ".sass", ".less", ".vue", ".svelte", ".coffee"}

# Content patterns (checked in text files only).
FRAMEWORK_IMPORT = re.compile(
    r"""(?:import\s+[^;]*?from\s*['"]|require\(\s*['"])"""
    r"""(?:react|react-dom|vue|svelte|angular|solid-js|preact|next|nuxt|@angular/)[/'"]""",
    re.IGNORECASE,
)
CDN_REF = re.compile(
    r"""(?:src\s*=\s*['"]https?://|<script[^>]+src\s*=\s*['"]https?://|"""
    r"""@import\s+(?:url\()?['"]https?://|from\s*['"]https?://|"""
    r"""unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare|ajax\.googleapis|fonts\.googleapis)""",
    re.IGNORECASE,
)

# Extensions worth scanning as text. Markdown/docs are EXCLUDED on purpose:
# provenance records MUST cite source URLs, and .md never executes.
TEXT_EXTS = {".html", ".htm", ".js", ".mjs", ".cjs", ".css", ".json"}


def iter_files(root):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d != ".git"]
        for name in filenames:
            yield os.path.join(dirpath, name)


def main():
    if not os.path.isdir(VANILLA):
        print("ROT CHECK PASSED (vanilla/ does not exist yet — nothing to rot).")
        return 0

    violations = []
    for path in iter_files(VANILLA):
        rel = os.path.relpath(path, VANILLA)
        base = os.path.basename(path)

        if base in FORBIDDEN_NAMES or "node_modules" in rel.split(os.sep):
            violations.append("%s: forbidden runtime/build artifact" % rel)
            continue

        _, ext = os.path.splitext(base)
        if ext.lower() in BUILD_REQUIRED_EXTS:
            violations.append(
                "%s: %s sources need a build step (ship plain .js/.css)" % (rel, ext)
            )
            continue

        if ext.lower() in TEXT_EXTS:
            try:
                with open(path, "r", encoding="utf-8", errors="strict") as fh:
                    content = fh.read()
            except (OSError, UnicodeError):
                continue
            if FRAMEWORK_IMPORT.search(content):
                violations.append("%s: framework import (react/vue/svelte/angular)" % rel)
            if CDN_REF.search(content):
                violations.append("%s: CDN/remote-script reference" % rel)

    if violations:
        print("ROT CHECK FAILED — %d violation(s):" % len(violations))
        for violation in violations:
            print("  - %s" % violation)
        return 1

    print("ROT CHECK PASSED — vanilla/ is dependency-free and static-servable.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
