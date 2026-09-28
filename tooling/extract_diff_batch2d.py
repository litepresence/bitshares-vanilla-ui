#!/usr/bin/env python3
"""Batch-2d extract-diff proof: every t() default is byte-verbatim in HEAD.

Proof (2) for the batch-2d i18n worker reply:
  1. Extract all t("key", "default") pairs from the 8 converted files.
  2. Assert each default occurs verbatim in `git show HEAD:<file>` (zero
     mismatches allowed).
  3. Structural check: reverse t("k","d")->"d", drop the helper block, undo
     the 3 documented renames, normalize whitespace -> must equal HEAD
     normalized the same way (proves nothing else changed).

Usage: python3 tooling/extract_diff_batch2d.py  (exit 0 green)
"""
import re
import subprocess
import sys

FILES = ["asset-ui.js", "asset-manage-ui.js", "asset-feed-ui.js", "htlc-ui.js",
         "debit-ui.js", "pool-ui.js", "pool-detail-ui.js", "pool-swap-ui.js"]

T_RE = re.compile(r"""\bt\(\s*"((?:\\.|[^"\\])*)"\s*,\s*"((?:\\.|[^"\\])*)"\s*\)""")

HELPER_START = "/* Batch-2d i18n (slice-17 precedent)"
REVERSES = [  # documented renames, batch2d script scope (new -> HEAD)
    ("asset-ui.js", "nm.title = r.id; card.appendChild(nm);", "t.title = r.id; card.appendChild(t);"),
    ("asset-ui.js", 'var nm = el(d, "strong"', 'var t = el(d, "strong"'),
    ("asset-ui.js", "if (nft) { var ntT = nt.input", "if (nft) { var t = nt.input"),
    ("asset-ui.js", "if (!ntT && !u) throw", "if (!t && !u) throw"),
    ("asset-ui.js", "nftObj = { title: ntT || symbol,", "nftObj = { title: t || symbol,"),
    ("asset-manage-ui.js", "var toF = isReserve ? null : field(", "var t = isReserve ? null : field("),
    ("asset-manage-ui.js", "v.appendChild(s.row); if (toF) v.appendChild(toF.row);",
     "v.appendChild(s.row); if (t) v.appendChild(t.row);"),
    ("asset-manage-ui.js", "await Account.resolve(toF.input.value.trim());",
     "await Account.resolve(t.input.value.trim());"),
    ("asset-feed-ui.js", "var txt;\n", "var t;\n"),
    ("asset-feed-ui.js", 'try { txt = "MCR', 'try { t = "MCR'),
    ("asset-feed-ui.js", 'catch (e) { txt = "MCR/MSSR', 'catch (e) { t = "MCR/MSSR'),
    ("asset-feed-ui.js", "prev.textContent = txt;", "prev.textContent = t;"),
]


def unesc(v):
    return v.replace('\\"', '"').replace("\\\\", "\\")


def preexisting_worktree(src, f):
    """Undo the ONE pre-existing working-tree hunk (viewport-gaps fix,
    present before batch-2d ran) so the structural check sees only batch-2d
    changes. Asserts exact presence on both sides — hides nothing else."""
    if f != "pool-ui.js":
        return src
    new = ("/* Wide (viewport-gaps fix 2026-09-28): the 10-col dense table\n"
           "     * needs full-bleed room; replaces mkt-wrap. Children span full width\n"
           "     * via the app.css .wide contract; the table keeps its scroll region. */")
    old = ("/* Wide wrap (mkt-wrap, detail-desk precedent): the 10-col dense table\n"
           "     * needs room; the plain 720px wrap would force scrolling at desktop. */")
    assert new in src, "pre-existing viewport hunk missing from work tree"
    src = src.replace(new, old)
    new2 = 'ctx.wrap.className = "wrap wide";'
    old2 = 'ctx.wrap.className = "wrap mkt-wrap";'
    assert new2 in src, "pre-existing className hunk missing from work tree"
    return src.replace(new2, old2)


def helper_dropped(src):
    i = src.find(HELPER_START)
    assert i != -1, "helper block missing"
    j = src.find("*/", i)
    block = src[i:j + 2]
    assert "function t(key, dflt)" in src[j:j + 400], "helper fn missing"
    tail = "\n    return dflt;\n  }\n"
    k = src.find(tail, j) + len(tail)
    assert k > len(tail), "helper tail missing"
    return src[:i] + src[k:]


def norm(s):
    return re.sub(r"\s+", "", s)


def main():
    fails = []
    total = 0
    for f in FILES:
        head = subprocess.run(["git", "-C", "/workspace", "show", "HEAD:vanilla/js/" + f],
                              capture_output=True, text=True).stdout
        work = open("/workspace/vanilla/js/" + f, encoding="utf-8").read()
        pairs = [(unesc(a), unesc(b)) for a, b in T_RE.findall(work)]
        total += len(pairs)
        for key, dflt in pairs:
            if dflt not in head:
                fails.append("%s: default %r not verbatim in HEAD" % (f, dflt[:80]))
        rev = T_RE.sub(lambda m: '"%s"' % m.group(2), work)
        rev = helper_dropped(rev)
        rev = preexisting_worktree(rev, f)
        for ff, new, old in REVERSES:
            if ff == f:
                assert new in rev, (f, new)
                rev = rev.replace(new, old)
        if norm(rev) != norm(head):
            # locate first divergence for the report
            a, b = norm(rev), norm(head)
            i = next((k for k in range(min(len(a), len(b))) if a[k] != b[k]), min(len(a), len(b)))
            fails.append("%s: structural drift at normalized offset %d: ...%r vs ...%r"
                         % (f, i, a[max(0, i - 40):i + 40], b[max(0, i - 40):i + 40]))
    if fails:
        print("FAIL:")
        print("\n".join(fails))
        return 1
    print("OK: %d t() defaults byte-verbatim in HEAD; 8 files structurally clean." % total)
    return 0


if __name__ == "__main__":
    sys.exit(main())
