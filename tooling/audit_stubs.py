#!/usr/bin/env python3
"""Stub-sweep auditor (skills/stub-sweep/SKILL.md).

Scans the four evidence sources for pending/stub/deferred items:
1. code state (dead-text + placeholder greps, oversize files, git status)
2. git history (defer/stub/pending commits)
3. meta docs (SLICES markers + boxes, op-matrix STUB/DEFERRED/MISSING, parity PENDING)
4. origin-story dialog markers (stale-collation warning + no-reply/DROPPED/defer prompts)

Usage: python3 tooling/audit_stubs.py [--recollate]   (run from /workspace)
Exit 0 = scan ran (findings listed even on 0). Exit 2 = script error.

Stdlib only. Read-only, except --recollate reruns collate_vanilla_prompts.py.
"""

import os
import re
import subprocess
import sys

WORKSPACE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Dead-text markers that must never ship in vanilla code (AGENTS.md 3.7).
DEAD_TEXT = re.compile(r"TODO|FIXME|XXX|HACK", re.IGNORECASE)
# Placeholder/deferral markers: honest deferrals use these words.
DEFER_TEXT = re.compile(
    r"placeholder\(|STUB|not implemented|not yet|deferred|pending",
    re.IGNORECASE,
)
# Local-helper copies forbidden by AGENTS.md rule 9.
LOCAL_HELPER = re.compile(
    r"function el\(|function clearRoot|function showStatus"
    r"|function confirmList|function fieldRow",
)
# SLICES.md in-progress/waiting markers.
SLICE_OPEN = re.compile(r"[🔨⬜⏳🔒]")
UNCHECKED_BOX = re.compile(r"^- \[ \]", re.MULTILINE)
# Op-matrix status words.
MATRIX_WORD = re.compile(r"\b(STUB|DEFERRED|MISSING)\b")
# Dialog incompleteness markers.
NO_REPLY = re.compile(r"no reply recorded", re.IGNORECASE)
DESIGNER_DEFER = re.compile(r"defer|stub|later|pending|TODO|follow-up|next round",
                            re.IGNORECASE)

SCAN_DIRS = ("vanilla/js", "vanilla/css", "extension-wrapper")

# Vendored wordlist: dictionary words contain "hack"/"chack" substrings —
# never a dead-text marker. Excluded from the dead-text scan on purpose.
# (Known residual false positive: txbuilder.js "tb-NNNN-xxxx" matches XXX
# case-insensitively — read the hit before filing it.)
VENDORED_EXCLUDE = ("brainkey-dict.js", "extension-wrapper/dist/")


def _run(cmd):
    """Run cmd list in WORKSPACE, return stdout text (empty on failure)."""
    try:
        out = subprocess.run(cmd, cwd=WORKSPACE, capture_output=True,
                             text=True, timeout=120)
        return out.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def _walk_files():
    """Yield text-file paths under SCAN_DIRS that exist on disk."""
    for d in SCAN_DIRS:
        root = os.path.join(WORKSPACE, d)
        if not os.path.isdir(root):
            continue
        for dirpath, _, names in os.walk(root):
            for n in names:
                if n.endswith((".js", ".css", ".html", ".json")):
                    yield os.path.join(dirpath, n)


def code_state():
    """Grep the tree for dead text, deferrals, local helpers; list oversize JS."""
    dead, defer, helper, sizes = [], [], [], []
    for path in _walk_files():
        try:
            with open(path, encoding="utf-8", errors="replace") as fh:
                text = fh.read()
        except OSError:
            continue
        rel = os.path.relpath(path, WORKSPACE)
        if any(v in rel for v in VENDORED_EXCLUDE):
            continue
        if DEAD_TEXT.search(text):
            dead.append(rel)
        if DEFER_TEXT.search(text):
            defer.append(rel)
        if "/views/" in rel and LOCAL_HELPER.search(text):
            helper.append(rel)
        if rel.endswith(".js"):
            sizes.append((text.count("\n") + 1, rel))
    sizes.sort(reverse=True)
    return dead, defer, helper, sizes[:8]


def git_state():
    """Collect git status, defer-grep log, and recent stat summary."""
    status = _run(["git", "status", "--short"])
    defer_log = _run(["git", "log", "--oneline", "--grep",
                      "defer\\|stub\\|pending\\|TODO\\|placeholder",
                      "-i", "--", "."])
    # Untracked skill dirs are uncommitted deferrals of the skill program.
    untracked_skills = [l for l in status.splitlines()
                        if l.startswith("??") and "skills/" in l]
    return status, defer_log, untracked_skills


def meta_docs():
    """Scan SLICES.md, op-matrix, AGENTS/README counts vs disk."""
    out = {}
    slices = os.path.join(WORKSPACE, "SLICES.md")
    try:
        with open(slices, encoding="utf-8") as fh:
            text = fh.read()
        out["slice_open_rows"] = [l.strip() for l in text.splitlines()
                                  if SLICE_OPEN.search(l)][:20]
        out["unchecked_boxes"] = UNCHECKED_BOX.findall(text)
    except OSError:
        out["slice_open_rows"] = []
        out["unchecked_boxes"] = []
    matrix = os.path.join(WORKSPACE, "docs/parity/op-coverage-matrix.md")
    try:
        with open(matrix, encoding="utf-8") as fh:
            mtext = fh.read()
        out["matrix_counts"] = dict((w, len(re.findall(r"\b%s\b" % w, mtext)))
                                    for w in ("STUB", "DEFERRED", "MISSING"))
        unjust = re.search(r"MISSING \(unjustified\):\s*(\d+)", mtext)
        out["matrix_unjustified"] = unjust.group(1) if unjust else "?"
    except OSError:
        out["matrix_counts"] = {}
        out["matrix_unjustified"] = "?"
    loc = os.path.join(WORKSPACE, "vanilla/locales")
    try:
        out["locale_files"] = len([n for n in os.listdir(loc)
                                   if n.endswith(".json")])
    except OSError:
        out["locale_files"] = -1
    # Parity PENDING-class markers across docs/parity.
    parity_dir = os.path.join(WORKSPACE, "docs/parity")
    pend = 0
    try:
        for n in os.listdir(parity_dir):
            if not n.endswith(".md"):
                continue
            with open(os.path.join(parity_dir, n),
                      encoding="utf-8", errors="replace") as fh:
                pend += len(re.findall(
                    r"PENDING|tester-queued|browser pass|human tester|"
                    r"morning questions", fh.read(), re.IGNORECASE))
    except OSError:
        pass
    out["parity_pending_hits"] = pend
    return out


def story_state():
    """Scan the collated dialog for no-reply, DROPPED, and designer deferrals."""
    dlg = os.path.join(WORKSPACE, "docs/vanilla-ui-dialog.md")
    try:
        with open(dlg, encoding="utf-8", errors="replace") as fh:
            text = fh.read()
    except OSError:
        return {"error": "dialog file missing"}
    lines = text.splitlines()
    head = lines[4] if len(lines) > 4 else ""
    return {
        "header": head[:160],
        "no_reply": len(NO_REPLY.findall(text)),
        "dropped": text.count("DROPPED"),
        "designer_defer_prompts": len(DESIGNER_DEFER.findall(text)),
        "mismatch_hint": ("re-run collate" if "413" not in head else "ok"),
    }


def main():
    """Run all four scans and print the findings table."""
    recollate = "--recollate" in sys.argv
    if recollate:
        print(_run([sys.executable, "tooling/collate_vanilla_prompts.py"]))
    dead, defer, helper, big = code_state()
    status, defer_log, untracked_skills = git_state()
    meta = meta_docs()
    story = story_state()

    print("== stub-sweep: code state ==")
    print("dead-text files (want none): %s"
          % (dead if dead else "none"))
    print("defer-word files: %s" % (defer if defer else "none"))
    print("local-helper hits (want none): %s"
          % (helper if helper else "none"))
    print("largest JS files (split candidate past ~400 lines):")
    for n, p in big:
        print("  %d %s" % (n, p))
    print("== stub-sweep: git ==")
    print("--- status ---\n%s" % (status if status else "(clean)"))
    print("--- defer-grep log ---\n%s" % (defer_log if defer_log else "(none)"))
    print("untracked skills (uncommitted skill work): %s"
          % (untracked_skills if untracked_skills else "none"))
    print("== stub-sweep: meta docs ==")
    print("SLICES open rows:")
    for r in meta.get("slice_open_rows", []):
        print("  %s" % r[:150])
    print("SLICES unchecked boxes: %d" % len(meta.get("unchecked_boxes", [])))
    print("op-matrix counts: %s unjustified=%s"
          % (meta.get("matrix_counts"), meta.get("matrix_unjustified")))
    print("locale files on disk: %s" % meta.get("locale_files"))
    print("parity PENDING-class hits: %s" % meta.get("parity_pending_hits"))
    print("== stub-sweep: origin story ==")
    for k, v in story.items():
        print("  %s: %s" % (k, v))
    print("freshness: rerun was '%s' this invocation"
          % ("fresh --recollate" if recollate else "NOT rerun (pass --recollate)"))


if __name__ == "__main__":
    main()
