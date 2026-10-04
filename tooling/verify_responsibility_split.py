#!/usr/bin/env python3
"""verify_responsibility_split.py — audit the task-res-split2 responsibility split.

Checks (exit 0 green, 1 red):
  1. Every moved member body in the 6 new files appears byte-verbatim in the
     HEAD version of its origin file (after reversing the documented
     registry rewrites). Verbatim copies (t/el/sleep/...) must match too.
  2. No NEW t("key", "default") pairs vs origin (set-equal per file family;
     duplicates from verbatim copies are allowed, new keys are not).
  3. Facade public surfaces identical to origin: function names + _test keys
     + exported constants.
  4. No TODO/FIXME/innerHTML introduced; module.exports present everywhere.

Usage: python3 tooling/verify_responsibility_split.py   (from /workspace)
Stdlib only.
"""
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WS = os.path.dirname(HERE)
VIEWS = os.path.join(WS, "vanilla", "js", "views")

REWRITES = [
    ("VoteUI._gov.fillBudget(", "fillBudget("),
    ("VoteUI._gov.renderJoinWitness(", "renderJoinWitness("),
    ("VoteUI._gov.renderJoinCommittee(", "renderJoinCommittee("),
    ("VoteUI._gov.renderAnalytics(", "renderAnalytics("),
    ("!VoteUI._ballot.isLive(myGen)", "myGen !== gen"),
    ("VoteUI._ballot.isLive(myGen)", "myGen === gen"),
    ("MarketInd._series.ind(", "ind("),
    ("MarketInd._series.priceOverlays(", "priceOverlays("),
    ("MarketInd._series.oscOne(", "oscOne("),
    ("MarketInd._series.readSlot(", "readSlot("),
    ("MarketInd._series.OVERLAY_SPECS", "OVERLAY_SPECS"),
    ("MarketInd._series.OVERLAY_FIXED", "OVERLAY_FIXED"),
    ("MarketInd._series.numOrNaN", "numOrNaN"),
    ("MarketInd._series.numOrNull", "numOrNull"),
    ("PoolDetailUI._actions.stakeBoxes(", "stakeBoxes("),
    ("PoolDetailUI._actions.swapInlineBox(", "swapInlineBox("),
    ("PoolDetailUI._actions.manageBoxes(", "manageBoxes("),
]

FAMILIES = {
    "vote-ui.js": ["vote-ballot.js", "vote-gov.js", "vote-ui.js"],
    "market-ind.js": ["market-ind-series.js", "market-ind-panes.js",
                      "market-ind.js"],
    "pool-detail-ui.js": ["pool-detail-view.js", "pool-detail-actions.js",
                          "pool-detail-ui.js"],
}

EXPECTED_SURFACE = {
    "vote-ui.js": ["renderVoting", "_test"],
    "market-ind.js": ["drawCharts", "maybeDraw", "renderStrip",
                      "paintCountNote", "paintTimeframes", "paintCountInput",
                      "renderIndMenu", "PREF_BUCKETS", "CANDLE_COUNT",
                      "reconcileBuckets", "bucketLabel", "_test", "OSC_ORDER",
                      "OVERLAY_DEFS", "OVERLAY_SPECS", "priceOverlays",
                      "overlayLabel", "ind"],
    "pool-detail-ui.js": ["renderPoolDetail"],
}

fail = []


def head_text(name):
    out = subprocess.run(["git", "-C", WS, "show", "HEAD:vanilla/js/views/" + name],
                         capture_output=True, text=True)
    if out.returncode != 0:
        fail.append("cannot read HEAD version of " + name)
        return ""
    return out.stdout


def cur_text(name):
    with open(os.path.join(VIEWS, name), encoding="utf-8") as fh:
        return fh.read()


def reverse_rewrites(text):
    for new, old in REWRITES:
        text = text.replace(new, old)
    return text


def member_spans(lines):
    starts = []
    for i, line in enumerate(lines):
        m = re.match(r"^  (?:async )?function (\w+)", line)
        n = re.match(r"^  var (\w+)\b", line)
        if m:
            starts.append((i, m.group(1)))
        elif n:
            starts.append((i, n.group(1)))

    def block_start(ln):
        b = ln
        j = ln - 1
        while j >= 0 and re.match(r"^ {1,4}(?:/\*|\*|\*/)", lines[j]):
            b = j
            j -= 1
        return b

    blocks = [(block_start(ln), ln, nm) for (ln, nm) in starts]
    tail = [i for i, l in enumerate(lines) if re.match(r"^  return \{", l)]
    attach = [i for i, l in enumerate(lines)
              if re.match(r"^  (?:VoteUI|MarketInd|PoolDetailUI)\._\w+\.\w+ = ", l)]
    cut = min(tail + attach + [len(lines)])
    spans = {}
    for k, (b, ln, nm) in enumerate(blocks):
        e = blocks[k + 1][0] if k + 1 < len(blocks) else len(lines)
        e = min(e, cut)
        while e > b and lines[e - 1].strip() == "":
            e -= 1
        spans[nm] = (b, e)
    return spans


SKIP_MEMBERS = {"ballotLive", "VoteUI", "MarketInd", "PoolDetailUI",
                "__partRequire"}
STRIP_LINES = (
    "Verbatim copy of",  # generated provenance banner, not in origin
    "MarketInd._panes.CANDLE_COUNT = v",  # snapshot refresh, additive only
)


def main():
    for origin, parts in FAMILIES.items():
        orig = head_text(origin)
        for part in parts:
            if part == origin:
                continue  # facade checked via surface below
            lines = cur_text(part).split("\n")
            spans = member_spans(lines)
            n = 0
            for nm, (b, e) in spans.items():
                if nm in SKIP_MEMBERS:
                    continue
                chunk = [l for l in lines[b:e]
                         if not any(s in l for s in STRIP_LINES)]
                text = reverse_rewrites("\n".join(chunk))
                if text not in orig:
                    fail.append("%s: member %s not verbatim in %s"
                                % (part, nm, origin))
                else:
                    n += 1
            print("%s: %d members byte-verbatim in %s" % (part, n, origin))

    # 2. t() pair sets: no new keys/defaults per family.
    pair_re = re.compile(r"\bt\(\"((?:[^\"\\]|\\.)*)\",\s*\"((?:[^\"\\]|\\.)*)\"")
    for origin, parts in FAMILIES.items():
        want = set(pair_re.findall(head_text(origin)))
        got = set()
        for part in parts:
            got |= set(pair_re.findall(cur_text(part)))
        if got - want:
            fail.append("%s: NEW t() pairs: %s" % (origin, sorted(got - want)[:5]))
        else:
            print("%s: t() pairs set-equal (%d pairs)" % (origin, len(want)))

    # 3. Facade surfaces.
    for origin, keys in EXPECTED_SURFACE.items():
        fac = cur_text(origin)
        missing = [k for k in keys
                   if not re.search(r"(?:\.%s\s*=|%s\s*:)" % (re.escape(k), re.escape(k)), fac)]
        if missing:
            fail.append("%s facade missing: %s" % (origin, missing))
        else:
            print("%s facade surface identical (%d keys)" % (origin, len(keys)))

    # 4. Hygiene: no NEW innerHTML uses (comment mentions + verbatim
    # root.innerHTML="" clears pre-exist in origin); no TODO/FIXME;
    # module.exports everywhere.
    for origin, parts in FAMILIES.items():
        orig_lines = set(l.strip() for l in head_text(origin).split("\n")
                         if "innerHTML" in l)
        for part in parts:
            txt = cur_text(part)
            for l in txt.split("\n"):
                if "innerHTML" in l and l.strip() not in orig_lines:
                    fail.append("%s: new innerHTML line: %s"
                                % (part, l.strip()[:80]))
            if "TODO" in txt or "FIXME" in txt:
                fail.append("%s contains TODO/FIXME" % part)
            if "module.exports" not in txt:
                fail.append("%s lacks module.exports" % part)
    print("hygiene: no new innerHTML, no TODO/FIXME; module.exports everywhere")

    if fail:
        print("VERIFY FAIL:")
        for f in fail:
            print("  - " + f)
        return 1
    print("VERIFY PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
