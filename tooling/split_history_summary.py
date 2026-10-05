#!/usr/bin/env python3
"""split_history_summary.py — mechanical facade+registry split for
vanilla/js/api/history-summary.js (~530 lines, past the ~400-line
split-candidate signal per history Task 4 review).

Produces (refuses if targets exist):
  history-families-trade.js — Task 3 daily-eight summarizers
  history-families-pools.js — Task 4 pool/asset/credit/samet/debit summarizers
and rewrites history-summary.js as a thin facade (helpers + collect/join/
cache + enrich + preserved-by-reference SUMMARIZERS registry).

Rules (split_responsibility.py precedent):
  - Moved bodies byte-verbatim (leading contiguous /* blocks travel).
  - Tiny shared helpers duplicated verbatim per family file with a provenance
    banner (market-desk split precedent) — never abstracted.
  - No new t() keys, no string/behavior changes (asserts below).
  - Node path: facade pulls family files via module.require (market-desk.js
    __partRequire precedent); browser path: family <script> tags BEFORE the
    facade tag in index.html (edit index.html by hand after running).
Stdlib only.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
API = os.path.join(HERE, "..", "vanilla", "js", "api")
SRC = os.path.join(API, "history-summary.js")
TRADE = os.path.join(API, "history-families-trade.js")
POOLS = os.path.join(API, "history-families-pools.js")

TRADE_FNS = ["sumTransfer", "sumOrderCreate", "sumOrderCancel", "sumOrderUpdate",
             "sumCallUpdate", "sumFill", "sumFeed", "sumAccountUpdate"]
POOLS_FNS = ["sumPoolCreate", "sumPoolDelete", "sumPoolDeposit",
             "sumPoolWithdraw", "sumPoolSwap", "sumPoolUpdate",
             "sumAssetCreate", "sumAssetUpdate", "sumIssuerUpdate",
             "sumSmartcoinUpdate", "sumFeedProducers", "sumAssetIssue",
             "sumAssetBurn", "sumFeePoolFund", "sumAssetSettle",
             "sumGlobalSettle", "sumSettleCancel", "sumClaimFees",
             "sumSametCreate", "sumSametDelete", "sumSametUpdate",
             "sumSametBorrow", "sumSametRepay", "sumOfferCreate",
             "sumOfferDelete", "sumOfferUpdate", "sumOfferAccept",
             "sumDealRepay", "sumDealExpired", "sumDealUpdate",
             "sumDebitCreate", "sumDebitUpdate", "sumDebitClaim",
             "sumDebitDelete"]
HELPERS_TRADE = ["t", "amount", "name", "isSide", "signed"]
HELPERS_POOLS = ["t", "amount", "name", "sym", "bare"]

COPY_BANNER = ("  /* Verbatim copies of history-summary.js %s (same per-file convention as the "
               "market-desk splits): duplicated so moved bodies stay "
               "byte-identical \u2014 doctrine prefers duplication over a shared "
               "helper abstraction. */\n")


def member_spans(lines):
    """Map member name -> (start0, end0), mirroring split_responsibility.py.

    A member starts at a `  [async ]function NAME` / `  var NAME` line; its
    leading contiguous `  /*...` comment block (no blank gap) belongs to it.
    Spans run to the next member start (capped at the IIFE `  return {`),
    trailing blanks trimmed.
    """
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

    tail_cuts = [i for i, l in enumerate(lines) if re.match(r"^  return \{", l)]
    assert len(tail_cuts) == 1, tail_cuts
    tail_cut = tail_cuts[0]
    spans = {}
    prev_e = 0
    blocks = [(block_start(ln), ln, nm) for (ln, nm) in starts]
    for k, (b, ln, nm) in enumerate(blocks):
        e = blocks[k + 1][0] if k + 1 < len(blocks) else len(lines)
        e = min(e, tail_cut)
        while e > b and lines[e - 1].strip() == "":
            e -= 1
        assert b >= prev_e, ("overlapping spans near " + nm)
        prev_e = e
        if nm in spans:
            raise SystemExit("duplicate member name: " + nm)
        spans[nm] = (b, e)
    return spans


def block(lines, spans, names):
    out = []
    for nm in names:
        b, e = spans[nm]
        out.extend(lines[b:e])
        out.append("")
    return out


ENSURE = ('var HistorySummary = (typeof globalThis !== "undefined" '
          '&& globalThis.HistorySummary) ? globalThis.HistorySummary : '
          '((typeof HistorySummary !== "undefined") ? HistorySummary : {});\n')

PART_REQUIRE = """/* Node suites require() the facade directly while the browser loads
 * the parts via <script> order. Pull the parts through the module loader
 * WITHOUT naming `require` (checkJs runs browser libs \u2014 a bare require()
 * call is TS2591 there; tx.js precedent). module.require resolves relative
 * to THIS file, like require(). */
var __partRequire = null;
try {
  if (typeof module !== "undefined" && module && /** @type {any} */ (module).require && /** @type {any} */ (module).require.bind) __partRequire = /** @type {any} */ (module).require.bind(module);
} catch (e) { __partRequire = null; }
if (__partRequire && (!HistorySummary.SUMMARIZERS || !HistorySummary.SUMMARIZERS[0])) {
  try { __partRequire("./history-families-trade.js"); } catch (e) {}
  try { __partRequire("./history-families-pools.js"); } catch (e) {}
  try { __partRequire("./history-families-gov.js"); } catch (e) {}
  if (typeof globalThis !== "undefined" && globalThis.HistorySummary) HistorySummary = globalThis.HistorySummary;
}
"""

FACADE_HEAD = """/* history-summary.js \u2014 THIN FACADE: enrich/collect/join/cache/helpers.
 * Owns: enrich() (collect ids -> 2 batch joins over a chain-keyed
 *   asset-meta cache boot-seeded from PoolAssets on matching chain_id ->
 *   per-family summarizers -> row._summary), shared amount()/name()/sym()/
 *   bare()/isSide()/signed() helpers (verbatim copies live in the family
 *   files so moved bodies stay byte-identical \u2014 market-desk split precedent).
 *   Per-family summarizers live in vanilla/js/api/history-families-*.js
 *   (trade = Task 3 daily-eight, pools = Task 4 pool/asset/credit/samet/debit,
 *   gov = Task 5 governance/HTLC/tickets/vesting/proposals/misc/blind), tagged
 *   BEFORE this file in index.html; this facade keeps their SUMMARIZERS
 *   registry by reference and reads it at call time. Label-only fallback for
 *   anything unrecognized; enrich never rejects (degraded rows render as
 *   today). No DOM, no signing.
 * Consumes: Chain.db/.call/.status, Format.formatAmount, PoolAssets (optional),
 *   I18n.t (guarded local copy). Exposes global HistorySummary.
 * Created by: history one-liners plan (spec docs/superpowers/specs/2026-10-04-history-one-liners-design.md);
 *   split by tooling/split_history_summary.py (facade + registry assembly). */
"""

REGISTRY = """  /* Family dispatch registry: populated by vanilla/js/api/history-families-*.js
   * (trade/pools/gov, tagged BEFORE this facade in index.html \u2014 market-desk.js
   * facade + fill files precedent). Preserved by reference \u2014 enrich reads it
   * at call time, so late-attached families resolve without re-wiring.
   * Unknown -> no summary. */
  var SUMMARIZERS = (typeof globalThis !== "undefined" && globalThis.HistorySummary &&
    globalThis.HistorySummary.SUMMARIZERS) ? globalThis.HistorySummary.SUMMARIZERS : {};
"""

TRADE_HEAD = """/* history-families-trade.js \u2014 Task 3 daily-eight summarizers (transfer direction,
 * limit orders 1/2/77, call update 3, fill 4, feed 19, account update 6).
 * Owns: sumTransfer/sumOrderCreate/sumOrderCancel/sumOrderUpdate/sumCallUpdate/
 *   sumFill/sumFeed/sumAccountUpdate + verbatim copies of the t/amount/name/
 *   isSide/signed helpers they call (same per-file convention as the
 *   market-desk splits: duplicated so moved bodies stay byte-identical \u2014
 *   doctrine prefers duplication over a shared helper abstraction).
 *   Attaches its entries to HistorySummary.SUMMARIZERS (created here if
 *   absent); the history-summary.js facade (tagged AFTER this file) keeps the
 *   registry by reference. No DOM, no signing.
 * Consumes: Format.formatAmount, I18n.t (both via the local verbatim copies).
 *   Globals/side effects: attaches HistorySummary.SUMMARIZERS[*] and
 *   republishes globalThis.HistorySummary.
 * Split from history-summary.js by tooling/split_history_summary.py (mechanical
 *   move, zero behavior change). Facade: history-summary.js. */
"""

POOLS_HEAD = """/* history-families-pools.js \u2014 Task 4 pool/asset/credit/Same-T/debit summarizers
 * (pools 59-63/75, assets 10-18/42/43/47/48, Same-T 64-68, credit 69-76,
 * debit 25-28).
 * Owns: the 34 per-tag summarizers + verbatim copies of the t/amount/name/
 *   sym/bare helpers they call (same per-file convention as the market-desk
 *   splits: duplicated so moved bodies stay byte-identical \u2014 doctrine prefers
 *   duplication over a shared helper abstraction). Field-path conflicts with
 *   the brief travel with the bodies below (#4 wins, Task 3 tag-77 style).
 *   Attaches its entries to HistorySummary.SUMMARIZERS (created here if
 *   absent); the history-summary.js facade (tagged AFTER this file) keeps the
 *   registry by reference. No DOM, no signing.
 * Consumes: Format.formatAmount, I18n.t (both via the local verbatim copies).
 *   Globals/side effects: attaches HistorySummary.SUMMARIZERS[*] and
 *   republishes globalThis.HistorySummary.
 * Split from history-summary.js by tooling/split_history_summary.py (mechanical
 *   move, zero behavior change). Facade: history-summary.js. */
"""


def family_file(head, helpers, fns, tags, lines, spans):
    out = [head + ENSURE]
    out.append("HistorySummary.SUMMARIZERS = HistorySummary.SUMMARIZERS || {};\n")
    out.append("(function () {\n")
    out.append('  "use strict";\n')
    out.append("\n")
    out.append(COPY_BANNER % "/".join(helpers))
    out.extend(l + "\n" for l in "\n".join(block(lines, spans, helpers)).split("\n"))
    for nm in fns:
        b, e = spans[nm]
        out.extend(l + "\n" for l in lines[b:e])
        out.append("\n")
    for tag, fn in tags:
        out.append("  HistorySummary.SUMMARIZERS[%s] = %s;\n" % (tag, fn))
    out.append("  if (typeof globalThis !== \"undefined\") { globalThis.HistorySummary = HistorySummary; }\n")
    out.append("})();\n")
    out.append("\n")
    out.append('if (typeof module !== "undefined") { module.exports = HistorySummary; }\n')
    return "".join(out)


def main():
    for p in (TRADE, POOLS):
        if os.path.exists(p):
            raise SystemExit("refuses: target exists: " + p)
    with open(SRC, "r", encoding="utf-8") as fh:
        src = fh.read()
    lines = src.split("\n")
    spans = member_spans(lines)
    for nm in TRADE_FNS + POOLS_FNS + HELPERS_TRADE + HELPERS_POOLS + ["SUMMARIZERS"]:
        assert nm in spans, "missing member: " + nm

    lit = "\n".join(lines[spans["SUMMARIZERS"][0]:spans["SUMMARIZERS"][1]])
    pairs = re.findall(r"^    (\d+): (\w+),?$", lit, re.MULTILINE)
    assert pairs, "no registry entries parsed"
    trade_tags = [(tag, fn) for tag, fn in pairs if fn in set(TRADE_FNS)]
    pools_tags = [(tag, fn) for tag, fn in pairs if fn in set(POOLS_FNS)]
    assert len(trade_tags) == 8 and len(pools_tags) == 35, (trade_tags, pools_tags)

    trade_src = family_file(TRADE_HEAD, HELPERS_TRADE, TRADE_FNS, trade_tags,
                            lines, spans)
    pools_src = family_file(POOLS_HEAD, HELPERS_POOLS, POOLS_FNS, pools_tags,
                            lines, spans)

    # Facade: drop moved spans + registry literal, splice registry keeper.
    drop = set(TRADE_FNS) | set(POOLS_FNS) | set(["SUMMARIZERS"])
    kept = []
    for nm in [n for _, n in
               sorted([(b, n) for n, (b, e) in spans.items()])]:
        if nm in drop:
            continue
        b, e = spans[nm]
        kept.append((b, e))
    # Rebuild IIFE body from kept spans in order (helpers/core/tagOf/enrich).
    body = []
    for b, e in kept:
        body.extend(lines[b:e])
        body.append("")
    facade = (FACADE_HEAD + ENSURE + PART_REQUIRE + "(function () {\n"
              + '  "use strict";\n' + "\n")
    inner = "\n".join(body).split("\n")
    # Kept spans already carry their 2-space IIFE depth; emit as-is.
    facade += "\n".join(inner)
    facade += REGISTRY
    # Tail: enrich is inside `body` already? No — enrich is a kept member
    # above; the return/export lines follow the tail cut and are re-emitted
    # here in augment style (identical public surface: { enrich, _test }).
    facade += ("  HistorySummary.enrich = enrich;\n"
               "  HistorySummary._test = { collect: collect, amount: amount, name: name, tagOf: tagOf, SUMMARIZERS: SUMMARIZERS };\n"
               "  if (typeof globalThis !== \"undefined\") { globalThis.HistorySummary = HistorySummary; }\n"
               "})();\n"
               "\n"
               'if (typeof globalThis !== "undefined" && typeof globalThis.HistorySummary === "undefined") { globalThis.HistorySummary = HistorySummary; }\n'
               'if (typeof module !== "undefined") { module.exports = HistorySummary; }\n')

    # Asserts: every moved body byte-present in its target; absent in facade
    # (bodies only — registry fn NAMES remain as assignments in targets).
    for nm in TRADE_FNS:
        b, e = spans[nm]
        blob = "\n".join(lines[b:e])
        assert blob in trade_src, nm
    for nm in POOLS_FNS:
        b, e = spans[nm]
        blob = "\n".join(lines[b:e])
        assert blob in pools_src, nm
    for nm in TRADE_FNS + POOLS_FNS:
        assert ("\n  function " + nm + "(") not in facade, nm
    for h in HELPERS_TRADE:
        assert h in trade_src
    for h in HELPERS_POOLS:
        assert h in pools_src
    assert "TODO" not in trade_src and "FIXME" not in trade_src
    assert "TODO" not in pools_src and "FIXME" not in pools_src
    assert "TODO" not in facade and "FIXME" not in facade

    with open(TRADE, "w", encoding="utf-8") as fh:
        fh.write(trade_src)
    with open(POOLS, "w", encoding="utf-8") as fh:
        fh.write(pools_src)
    with open(SRC, "w", encoding="utf-8") as fh:
        fh.write(facade)
    print("wrote %s (%d lines)" % (TRADE, trade_src.count("\n")))
    print("wrote %s (%d lines)" % (POOLS, pools_src.count("\n")))
    print("rewrote %s (%d lines)" % (SRC, facade.count("\n")))


if __name__ == "__main__":
    main()
