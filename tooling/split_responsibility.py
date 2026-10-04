#!/usr/bin/env python3
"""split_responsibility.py — deterministic responsibility splitter for three
oversized view files (task-res-split2).

Splits (verbatim moves + registry attach, tx.js-split precedent):
  vote-ui.js        (1373) -> vote-ballot.js + vote-gov.js
  market-ind.js     (1303) -> market-ind-series.js + market-ind-panes.js
  pool-detail-ui.js (1268) -> pool-detail-view.js + pool-detail-actions.js
Originals become thin facades with identical public surfaces.

Rules enforced here:
  - Bodies move byte-verbatim (single-blank separators normalized).
  - Cross-module calls rewritten to late-bound registry paths
    (VoteUI._gov.*, VoteUI._ballot.*, MarketInd._series.*, PoolDetailUI._actions.*).
  - Tiny shared helpers duplicated verbatim with a provenance banner
    (vote-slate.js precedent), never abstracted.
  - No new t() keys, no string/DOM/behavior changes (asserts below).
  - Refuses to run if any target already exists (deterministic, re-runnable).

Usage: python3 tooling/split_responsibility.py   (from /workspace)
Stdlib only.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
VIEWS = os.path.join(HERE, "..", "vanilla", "js", "views")

COPY_BANNER = ("  /* Verbatim copy of %s (same per-file convention as the "
               "explorer/vote-slate splits): duplicated so moved bodies stay "
               "byte-identical — doctrine prefers duplication over a shared "
               "chart/vote abstraction. */\n")


def read(name):
    with open(os.path.join(VIEWS, name), "r", encoding="utf-8") as fh:
        return fh.read().split("\n")


def member_spans(lines):
    """Map member name -> (start0, end0) 0-indexed, end exclusive.

    A member starts at a `  [async ]function NAME` / `  var NAME` line;
    its leading contiguous `  /*...` comment block (no blank gap) belongs
    to it. The span runs to the next member's start, trailing blanks trimmed.
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

    blocks = [(block_start(ln), ln, nm) for (ln, nm) in starts]
    # Cap every span at the original IIFE `  return {` (the return block +
    # IIFE close + exports never belong to a moved member; tails replace them).
    tail_cuts = [i for i, l in enumerate(lines) if re.match(r"^  return \{", l)]
    assert len(tail_cuts) == 1, tail_cuts
    tail_cut = tail_cuts[0]
    spans = {}
    prev_e = 0
    for k, (b, ln, nm) in enumerate(blocks):
        e = blocks[k + 1][0] if k + 1 < len(blocks) else len(lines)
        e = min(e, tail_cut)
        while e > b and lines[e - 1].strip() == "":
            e -= 1
        assert b >= prev_e, ("overlapping spans near " + nm)
        prev_e = e
        # First member of each file keeps no leading blanks; walk-up above
        # never crosses a blank line, so spans are disjoint by construction.
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
    if out and out[-1] == "":
        out.pop()
    return "\n".join(out)


def sub_count(text, pattern, repl):
    new, n = re.subn(pattern, repl, text)
    return new, n


def main():
    targets = [
        "vote-ballot.js", "vote-gov.js",
        "market-ind-series.js", "market-ind-panes.js",
        "pool-detail-view.js", "pool-detail-actions.js",
    ]
    for t in targets:
        if os.path.exists(os.path.join(VIEWS, t)):
            print("REFUSE: target exists: " + t)
            return 1

    vote = read("vote-ui.js")
    mind = read("market-ind.js")
    pool = read("pool-detail-ui.js")
    vsp = member_spans(vote)
    msp = member_spans(mind)
    psp = member_spans(pool)

    # ---------------- vote ----------------
    ballot_names = ["t", "PROXY_SENTINEL", "CORE_ASSET",
                    "CORE_PRECISION_FALLBACK", "PROVE_TIMEOUT_MS",
                    "PROVE_INTERVAL_MS", "gen", "el", "clearRoot", "makeWrap",
                    "sleep", "showError", "showStatus", "renderVoting",
                    "showAccountPicker", "loadAll", "chainSupplyRaw",
                    "showView", "renderProxy", "renderActions",
                    "preparePublish", "feePrecision", "showConfirm",
                    "publishWithRetry", "buildSigned", "sendAndProve",
                    "slateMatches", "headBlock", "showResult"]
    gov_names = ["fillBudget", "renderAnalytics", "commas", "fundHuman",
                 "renderJoinWitness", "renderJoinCommittee",
                 "showJoinConfirm", "sendJoinAndProve", "showJoinResult"]
    gov_copies = ["t", "el", "showError", "showStatus", "sleep", "headBlock",
                  "PROXY_SENTINEL", "CORE_ASSET", "CORE_PRECISION_FALLBACK",
                  "PROVE_TIMEOUT_MS", "PROVE_INTERVAL_MS"]

    ballot_body = block(vote, vsp, ballot_names)
    # Ballot -> gov calls go through the shared registry (late-bound at call
    # time, tx-send.js precedent — either script order works).
    for pat, rep, want in [
        (r"\bfillBudget\(", "VoteUI._gov.fillBudget(", 1),
        (r"\brenderJoinWitness\(", "VoteUI._gov.renderJoinWitness(", 2),
        (r"\brenderJoinCommittee\(", "VoteUI._gov.renderJoinCommittee(", 1),
        (r"\brenderAnalytics\(", "VoteUI._gov.renderAnalytics(", 1),
    ]:
        ballot_body, n = sub_count(ballot_body, pat, rep)
        assert n == want, (pat, n, want)

    gov_parts = []
    for nm in gov_copies:
        gov_parts.append((COPY_BANNER % ("vote-ballot.js " + nm)).rstrip("\n"))
        b, e = vsp[nm]
        gov_parts.append("\n".join(vote[b:e]))
        gov_parts.append("")
    gov_body = "\n".join(gov_parts) + block(vote, vsp, gov_names)
    # Gov staleness reads consult the ballot's generation (the only writer):
    gov_body, n1 = sub_count(gov_body, r"myGen !== gen",
                             "!VoteUI._ballot.isLive(myGen)")
    gov_body, n2 = sub_count(gov_body, r"myGen === gen",
                             "VoteUI._ballot.isLive(myGen)")
    # Gov uses only the bail form (!==); the === form lives in ballot code.
    assert n1 > 0, (n1, n2)
    assert "myGen !== gen" not in gov_body and "myGen === gen" not in gov_body
    leftover = [l for l in gov_body.split("\n")
                if re.search(r"(?<![\w.])(gen)(?![\w])", l)
                and "isLive" not in l and l.strip().startswith("*")]
    # 'gen' may only survive inside comments now; 'generation' is fine.
    code_left = [l for l in gov_body.split("\n")
                 if re.search(r"(?<![\w.])gen(?![\w])", l)
                 and "isLive" not in l and not l.strip().startswith(("*", "/*"))]
    assert not code_left, code_left[:5]

    # ---------------- market-ind ----------------
    series_names = ["ind", "numOrNull", "numOrNaN", "OVERLAY_SPECS",
                    "OVERLAY_FIXED", "priceOverlays", "oscOne", "readSlot"]
    panes_names = ["PREF_BUCKETS", "COUNT_KEY", "COUNT_MIN", "loadCount",
                   "CANDLE_COUNT", "validCount", "OSC_ORDER", "OVERLAY_DEFS",
                   "overlayLabel", "t", "bucketLabel", "reconcileBuckets",
                   "readVar", "themeChartColors", "fitCanvas", "drawVwap",
                   "trim6", "renderStrip", "paintCountNote", "paintCountInput",
                   "paintTimeframes", "maybeDraw", "drawCharts",
                   "overlaysGroup", "renderIndMenu"]
    series_t = block(mind, msp, ["t"])
    series_body = ((COPY_BANNER % "market-ind.js t()").rstrip("\n") + "\n"
                   + series_t + "\n\n" + block(mind, msp, series_names))
    panes_body = block(mind, msp, panes_names)
    for pat, rep, want in [
        (r"\bind\(", "MarketInd._series.ind(", None),
        (r"\bpriceOverlays\(", "MarketInd._series.priceOverlays(", 1),
        (r"\boscOne\(", "MarketInd._series.oscOne(", None),
        (r"\breadSlot\(", "MarketInd._series.readSlot(", 2),
        (r"\bOVERLAY_SPECS\b", "MarketInd._series.OVERLAY_SPECS", None),
        (r"\bOVERLAY_FIXED\b", "MarketInd._series.OVERLAY_FIXED", 0),
        (r"\bnumOrNaN\b", "MarketInd._series.numOrNaN", None),
        (r"\bnumOrNull\b", "MarketInd._series.numOrNull", 0),
    ]:
        panes_body, n = sub_count(panes_body, pat, rep)
        if want is not None:
            assert n == want, (pat, n, want)
        else:
            assert n > 0, pat
    # Keep the _panes CANDLE_COUNT snapshot fresh alongside the public
    # MarketInd.CANDLE_COUNT sync (same guarded shape as the original).
    old_sync = ("        try { if (typeof MarketInd !== \"undefined\" && MarketInd) "
                "MarketInd.CANDLE_COUNT = v; } catch (e) { /* module var stands */ }")
    new_sync = (old_sync + "\n        try { if (typeof MarketInd !== \"undefined\" && MarketInd "
                "&& MarketInd._panes) MarketInd._panes.CANDLE_COUNT = v; } "
                "catch (e) { /* snapshot stands */ }")
    assert old_sync in panes_body
    panes_body = panes_body.replace(old_sync, new_sync)

    # ---------------- pool-detail ----------------
    view_names = ["t", "gen", "_cleanups", "cleanupDetail", "U", "live",
                  "precOr5", "renderPoolDetail", "detailFill", "POOL_BUCKETS",
                  "chartPane", "deepenPool", "cssTok", "fitPlot", "drawCurve",
                  "depthPane", "tapeTable", "historyPane", "_pgLoading",
                  "_pgSrc", "_ensurePoolGraph", "fetchPoolMap",
                  "redrawPoolMap"]
    actions_names = ["stakeBoxes", "swapInlineBox", "manageBoxes"]
    actions_copies = ["t", "U", "whoText", "precOr5"]
    view_body = block(pool, psp, view_names)
    for pat, rep in [
        (r"\bstakeBoxes\(", "PoolDetailUI._actions.stakeBoxes("),
        (r"\bswapInlineBox\(", "PoolDetailUI._actions.swapInlineBox("),
        (r"\bmanageBoxes\(", "PoolDetailUI._actions.manageBoxes("),
    ]:
        view_body, n = sub_count(view_body, pat, rep)
        assert n == 1, (pat, n)
    actions_parts = []
    for nm in actions_copies:
        actions_parts.append((COPY_BANNER % ("pool-detail-view.js " + nm)).rstrip("\n"))
        b, e = psp[nm]
        actions_parts.append("\n".join(pool[b:e]))
        actions_parts.append("")
    actions_body = "\n".join(actions_parts) + block(pool, psp, actions_names)
    for bad in ["live(", "_cleanups", "myGen !== gen", "++gen"]:
        assert bad not in actions_body, bad
    assert "whoText" not in view_body, "whoText stays actions-only"

    files = {
        "vote-ballot.js": (VOTE_BALLOT_HEAD, ballot_body, VOTE_BALLOT_TAIL),
        "vote-gov.js": (VOTE_GOV_HEAD, gov_body, VOTE_GOV_TAIL),
        "market-ind-series.js": (SERIES_HEAD, series_body, SERIES_TAIL),
        "market-ind-panes.js": (PANES_HEAD, panes_body, PANES_TAIL),
        "pool-detail-view.js": (POOL_VIEW_HEAD, view_body, POOL_VIEW_TAIL),
        "pool-detail-actions.js": (POOL_ACTIONS_HEAD, actions_body,
                                   POOL_ACTIONS_TAIL),
    }
    for name, (head, body, tail) in files.items():
        # No new i18n keys ride along: every t("k", "d") pair below already
        # exists verbatim in the pre-split file (drift gate stays green).
        with open(os.path.join(VIEWS, name), "w", encoding="utf-8") as fh:
            fh.write(head + body + tail)
        print("wrote %s (%d lines)" % (name, len((head + body + tail).split("\n"))))

    facades = {
        "vote-ui.js": VOTE_FACADE,
        "market-ind.js": MKT_FACADE,
        "pool-detail-ui.js": POOL_FACADE,
    }
    for name, content in facades.items():
        with open(os.path.join(VIEWS, name), "w", encoding="utf-8") as fh:
            fh.write(content)
        print("facade %s (%d lines)" % (name, len(content.split("\n"))))
    return 0


MERGE = ("var %s = (typeof globalThis !== \"undefined\" && globalThis.%s) "
         "? globalThis.%s : ((typeof %s !== \"undefined\") ? %s : {});\n")

NODE_PULL = """/* Node suites require() the facade directly while the browser loads
 * the parts via <script> order. Pull the parts through the module loader
 * WITHOUT naming `require` (checkJs runs browser libs — a bare require()
 * call is TS2591 there; tx.js precedent). module.require resolves relative
 * to THIS file, like require(). */
var __partRequire = null;
try {
  if (typeof module !== "undefined" && module && module.require && module.require.bind) __partRequire = module.require.bind(module);
} catch (e) { __partRequire = null; }
%s
"""

VOTE_BALLOT_HEAD = """/* vote-ballot.js — #/voting ballot core (route entry + proxy + publish).
 *
 * What it owns: the voting route entry (renderVoting + connect wait +
 * account resolve), the ballot view (account strip, proxy picker, slate tabs
 * via VoteSlate, publish/reset bar), the op-6 publish path (preparePublish,
 * feePrecision, showConfirm with NAMED rows, publishWithRetry with the
 * proxy-vs-self retry rule, buildSigned, sendAndProve) and the publish proof
 * helpers (slateMatches, headBlock, showResult). Governance side panels
 * (budget line, analytics, join-witness/committee entries) live in
 * vote-gov.js and are called via VoteUI._gov at call time.
 * Consumes: Vote (lists, currentVotes, fee), VoteUI._gov (panels, late-bound),
 *   VoteSlate (draft state + list rows), Account.resolve/myAccountId,
 *   Wallet.isUnlocked/unlock/keys, Tx.fee/buildTx/sign, Format.formatAmount,
 *   Chain.db/call/status, Store.subscribe, ViewingAs, Offline, DOM, Forms.
 * Globals/side effects: DOM under the router root; attaches VoteUI._ballot
 *   ({renderVoting, isLive, slateMatches}) on the shared VoteUI registry and
 *   republishes globalThis.VoteUI. WIFs pass as JS values into Tx.sign —
 *   never into the DOM. Generation counter (isLive) invalidates stale async
 *   work after teardown; vote-gov.js reads it via isLive (sole writer here).
 * Created by: task-res-split2 (vote-ui.js responsibility split — balloting
 *   half; bodies moved verbatim, only VoteUI._gov call sites rewritten).
 *   Facade: vote-ui.js (thin, identical surface). Load order in index.html:
 *   vote-slate.js, vote-gov.js, vote-ballot.js, vote-ui.js (facade last;
 *   gov/ballot bind at call time, so gov/ballot order is free).
 * Pre-split vote-ui.js header (CHAIN TRUTH, MONEY DISCIPLINE, PUNCHLIST
 *   2026-09-29): preserved verbatim in git history of vote-ui.js.
 */
""" + MERGE % ("VoteUI", "VoteUI", "VoteUI", "VoteUI", "VoteUI") + """VoteUI._ballot = VoteUI._ballot || {};
(function () {
  "use strict";

  /* Generation liveness for both halves: true while myGen is the latest
   * renderVoting generation. vote-gov.js consults this instead of keeping
   * its own counter (it never writes — sole writer is renderVoting here). */
  function ballotLive(myGen) { return myGen === gen; }

"""

VOTE_BALLOT_TAIL = """
  VoteUI._ballot.renderVoting = renderVoting;
  VoteUI._ballot.isLive = ballotLive;
  VoteUI._ballot.slateMatches = slateMatches;
  if (typeof globalThis !== "undefined") { globalThis.VoteUI = VoteUI; }
})();

if (typeof module !== "undefined") { module.exports = VoteUI; }
"""

VOTE_GOV_HEAD = """/* vote-gov.js — #/voting governance side panels (budget + analytics + join).
 *
 * What it owns: the worker-budget line (fillBudget), the governance
 * analytics section (renderAnalytics via GovAnalytics — funding shares,
 * active/standby splits, top voters + proxy-vote matrix), the small helpers
 * commas/fundHuman, and the join/update entry flows (renderJoinWitness with
 * isUpdate mode, renderJoinCommittee, showJoinConfirm with named rows,
 * sendJoinAndProve with object-read proof, showJoinResult). No route entry,
 * no proxy picker, no op-6 publish (those stay in vote-ballot.js, which
 * calls renderAnalytics/fillBudget/renderJoinWitness/renderJoinCommittee
 * via VoteUI._gov at call time).
 * Consumes: VoteUI._ballot.isLive (generation guard — late-bound, the ballot
 *   owns the only counter), Vote (fee/getWitnessByAccount/
 *   getCommitteeMemberByAccount), Tx.fee/buildTx/sign, Wallet, Account,
 *   Format.formatAmount, Chain, GovAnalytics, DOM, Forms. Tiny t/el/
 *   showError/showStatus/sleep/headBlock/const copies are verbatim from
 *   vote-ballot.js (vote-slate split precedent — no shared layer for two
 *   files). Side effects: DOM under the caller's boxes only; attaches
 *   VoteUI._gov and republishes globalThis.VoteUI. WIFs are JS values.
 * Created by: task-res-split2 (vote-ui.js responsibility split — panels
 *   half; bodies moved verbatim, only `myGen !== gen` reads rewritten to
 *   VoteUI._ballot.isLive). Facade: vote-ui.js.
 */
""" + MERGE % ("VoteUI", "VoteUI", "VoteUI", "VoteUI", "VoteUI") + """VoteUI._gov = VoteUI._gov || {};
(function () {
  "use strict";

"""

VOTE_GOV_TAIL = """
  VoteUI._gov.fillBudget = fillBudget;
  VoteUI._gov.renderAnalytics = renderAnalytics;
  VoteUI._gov.renderJoinWitness = renderJoinWitness;
  VoteUI._gov.renderJoinCommittee = renderJoinCommittee;
  if (typeof globalThis !== "undefined") { globalThis.VoteUI = VoteUI; }
})();

if (typeof module !== "undefined") { module.exports = VoteUI; }
"""

SERIES_HEAD = """/* market-ind-series.js — DEX indicator SERIES math (no DOM, no fetching).
 *
 * What it owns: the indicator lookup (ind, guarded — null means unavailable),
 * pixel converters (numOrNull/numOrNaN — chart-pixel inputs only), the
 * meshable price-overlay specs (OVERLAY_SPECS + legacy OVERLAY_FIXED), the
 * price-pane overlay builder (priceOverlays) and the stacked sub-pane series
 * builder (oscOne), plus the candle-slot reader (readSlot — verbatim
 * extraction of the maybeDraw loop body; raw integer money never enters,
 * volume Numbers are pixels-only from human strings). Pure series math:
 * every function takes values in and returns values out.
 * Consumes: Indicators.* (via ind(), guarded), nothing else. No DOM, no
 *   timers, no signing, no chain I/O. t() is a verbatim copy of the
 *   market-ind.js helper (overlayLabel labels only).
 * Globals/side effects: attaches MarketInd._series and republishes
 *   globalThis.MarketInd; no state of its own. market-ind-panes.js calls
 *   these at draw time via MarketInd._series (late-bound).
 * Created by: task-res-split2 (market-ind.js responsibility split —
 *   indicators half; bodies moved verbatim). Facade: market-ind.js.
 *   Load order in index.html: market-ind-series.js, market-ind-panes.js,
 *   market-ind.js (facade last).
 */
""" + MERGE % ("MarketInd", "MarketInd", "MarketInd", "MarketInd", "MarketInd") + """MarketInd._series = MarketInd._series || {};
(function () {
  "use strict";

"""

SERIES_TAIL = """
  MarketInd._series.ind = ind;
  MarketInd._series.numOrNull = numOrNull;
  MarketInd._series.numOrNaN = numOrNaN;
  MarketInd._series.OVERLAY_SPECS = OVERLAY_SPECS;
  MarketInd._series.OVERLAY_FIXED = OVERLAY_FIXED;
  MarketInd._series.priceOverlays = priceOverlays;
  MarketInd._series.oscOne = oscOne;
  MarketInd._series.readSlot = readSlot;
  if (typeof globalThis !== "undefined") { globalThis.MarketInd = MarketInd; }
})();

if (typeof module !== "undefined") { module.exports = MarketInd; }
"""

PANES_HEAD = """/* market-ind-panes.js — DEX chart PANES + controls (DOM rendering).
 *
 * What it owns: timeframe bucket constants + bucketLabel + reconcileBuckets,
 * candle-count state (COUNT_* + loadCount/validCount/CANDLE_COUNT — the
 * single source all three fetch sites read), pane order (OSC_ORDER) and
 * overlay defs/labels (OVERLAY_DEFS + overlayLabel), theme chart colors
 * (readVar/themeChartColors), canvas fit (fitCanvas), the session-VWAP strip
 * (drawVwap), the header stats strip (renderStrip + trim6), the timeframe
 * radios + count input/note (paintTimeframes/paintCountInput/paintCountNote),
 * the draw orchestrators (maybeDraw with the _seriesCache fast path +
 * drawCharts for price + stacked sub-panes) and the indicator menu
 * (overlaysGroup + renderIndMenu). No fetching, no timers, no signing.
 * Consumes: MarketInd._series (ind/priceOverlays/oscOne/readSlot/specs —
 *   late-bound at draw time), MarketCharts.drawPricePane/drawOscPane/
 *   drawDepth/removePane, MarketCandles.vwap, MarketDesk.syncUrl (guarded),
 *   DOM, Store, Indicators only via _series. CANDLE_COUNT snapshot on
 *   MarketInd._panes is refreshed next to the public MarketInd.CANDLE_COUNT
 *   sync (same guarded shape — the facade assembles from the snapshot).
 * Globals/side effects: DOM under caller-provided hosts only (plus the lazy
 *   #mkt-vwap-wrap sibling tracked on state.vwapWrap); attaches
 *   MarketInd._panes and republishes globalThis.MarketInd.
 * Created by: task-res-split2 (market-ind.js responsibility split — overlays
 *   half; bodies moved verbatim, only MarketInd._series call sites
 *   rewritten). Facade: market-ind.js.
 * Pre-split market-ind.js header: preserved verbatim in git history.
 */
""" + MERGE % ("MarketInd", "MarketInd", "MarketInd", "MarketInd", "MarketInd") + """MarketInd._panes = MarketInd._panes || {};
(function () {
  "use strict";

"""

PANES_TAIL = """
  MarketInd._panes.drawCharts = drawCharts;
  MarketInd._panes.maybeDraw = maybeDraw;
  MarketInd._panes.renderStrip = renderStrip;
  MarketInd._panes.paintCountNote = paintCountNote;
  MarketInd._panes.paintTimeframes = paintTimeframes;
  MarketInd._panes.paintCountInput = paintCountInput;
  MarketInd._panes.renderIndMenu = renderIndMenu;
  MarketInd._panes.PREF_BUCKETS = PREF_BUCKETS;
  MarketInd._panes.CANDLE_COUNT = CANDLE_COUNT;
  MarketInd._panes.reconcileBuckets = reconcileBuckets;
  MarketInd._panes.bucketLabel = bucketLabel;
  MarketInd._panes._test = { validCount: validCount };
  MarketInd._panes.OSC_ORDER = OSC_ORDER;
  MarketInd._panes.OVERLAY_DEFS = OVERLAY_DEFS;
  MarketInd._panes.overlayLabel = overlayLabel;
  if (typeof globalThis !== "undefined") { globalThis.MarketInd = MarketInd; }
})();

if (typeof module !== "undefined") { module.exports = MarketInd; }
"""

POOL_VIEW_HEAD = """/* pool-detail-view.js — #/pools/:id detail desk (stats + chart + depth + history).
 *
 * What it owns: the detail route entry (renderPoolDetail + detailFill —
 * stats strip, shared tape fetch, section scaffolding), the pool chart pane
 * (POOL_BUCKETS + chartPane through the shared MarketInd stack + deepenPool
 * ES merge), the x·y=k curve canvas + CPMM depth table (cssTok/fitPlot/
 * drawCurve/depthPane), the pool-history tabs (tapeTable/historyPane with
 * the late-tape hook) and the pool-map provenance slice (_pgSrc/
 * _ensurePoolGraph/fetchPoolMap/redrawPoolMap). Stake/swap/update/delete
 * panels live in pool-detail-actions.js and are called via
 * PoolDetailUI._actions at call time. Unknown id -> empty state, never
 * blank. No ops-57/58 code (slice 14 owns them).
 * Consumes: PoolDetailUI._actions (panels, late-bound), PoolUI._ui
 *   (routeReady/reviewSection/tableHead/amtText/pctText — pool-ui.js loads
 *   first), Pool (get/list/history/quote), PoolHistory (chainSwaps/enrich/
 *   synthBook/swapsToCandles), MarketInd (renderIndMenu/maybeDraw/
 *   drawCharts/CANDLE_COUNT), Market (depth), MarketFills (mergeDeep),
 *   PoolGraph (lazy script), Format, Account, App, Store, DOM.
 * Globals/side effects: DOM under the router root; owns the generation
 *   counter + _cleanups itself (actions take no staleness params — they are
 *   leaf panels under reviewSection); attaches PoolDetailUI._view and
 *   republishes globalThis.PoolDetailUI. WIFs are JS values, never DOM.
 * Created by: task-res-split2 (pool-detail-ui.js responsibility split —
 *   detail half; bodies moved verbatim, only _actions call sites rewritten).
 *   Facade: pool-detail-ui.js (thin, identical surface). Load order in
 *   index.html: pool-detail-actions.js, pool-detail-view.js,
 *   pool-detail-ui.js (facade last; actions/view bind at call time).
 * Pre-split pool-detail-ui.js header (MIRROR SPEC): preserved verbatim
 *   in git history of pool-detail-ui.js.
 */
""" + MERGE % ("PoolDetailUI", "PoolDetailUI", "PoolDetailUI", "PoolDetailUI", "PoolDetailUI") + """PoolDetailUI._view = PoolDetailUI._view || {};
(function () {
  "use strict";

"""

POOL_VIEW_TAIL = """
  PoolDetailUI._view.renderPoolDetail = renderPoolDetail;
  if (typeof globalThis !== "undefined") { globalThis.PoolDetailUI = PoolDetailUI; }
})();

if (typeof module !== "undefined") { module.exports = PoolDetailUI; }
"""

POOL_ACTIONS_HEAD = """/* pool-detail-actions.js — #/pools/:id stake/swap/manage panels (op forms).
 *
 * What it owns: the stake boxes (stakeBoxes — op-61 deposit + op-62 withdraw
 *   with share previews), the inline swap box (swapInlineBox — op-63
 *   mini-form with quote + impact + slippage preview) and the manage boxes
 *   (manageBoxes — op-75 fee edit with withdrawal 0-only + op-60 owner delete
 *   with fee 0), all with NAMED-row confirms via the shared reviewSection.
 *   Leaf panels: no route entry, no chart/depth/history code (those stay in
 *   pool-detail-view.js, which calls these three via PoolDetailUI._actions
 *   at call time), no staleness tracking of its own.
 * Consumes: PoolUI._ui (field/reviewSection/amtText/pctText/touchable/el —
 *   pool-ui.js loads first), Pool (buildDeposit/buildWithdraw/buildExchange/
 *   buildUpdate/buildDelete/fee/quote/minReceive/pctUnitsToHuman/
 *   DEFAULT_SLIPPAGE_PCT), Format.parseAmount, Account. Tiny t/U/whoText/
 *   precOr5 copies are verbatim from pool-detail-view.js (vote-slate split
 *   precedent — no shared layer for two files). Side effects: DOM under the
 *   caller's box only; attaches PoolDetailUI._actions and republishes
 *   globalThis.PoolDetailUI. WIFs are JS values, never DOM.
 * Created by: task-res-split2 (pool-detail-ui.js responsibility split —
 *   stake/positions half; bodies moved verbatim). Facade: pool-detail-ui.js.
 */
""" + MERGE % ("PoolDetailUI", "PoolDetailUI", "PoolDetailUI", "PoolDetailUI", "PoolDetailUI") + """PoolDetailUI._actions = PoolDetailUI._actions || {};
(function () {
  "use strict";

"""

POOL_ACTIONS_TAIL = """
  PoolDetailUI._actions.stakeBoxes = stakeBoxes;
  PoolDetailUI._actions.swapInlineBox = swapInlineBox;
  PoolDetailUI._actions.manageBoxes = manageBoxes;
  if (typeof globalThis !== "undefined") { globalThis.PoolDetailUI = PoolDetailUI; }
})();

if (typeof module !== "undefined") { module.exports = PoolDetailUI; }
"""

VOTE_FACADE = """/* vote-ui.js — #/voting THIN FACADE (identical public surface).
 *
 * What it owns: NOTHING but assembly — renderVoting delegates to
 * VoteUI._ballot (vote-ballot.js: route entry + proxy + op-6 publish) and
 * _test keeps the headless seam over VoteSlate + the ballot's slateMatches.
 * Bodies live in the task-res-split2 files: ballot core in vote-ballot.js
 * (VoteUI._ballot), budget/analytics/join panels in vote-gov.js
 * (VoteUI._gov). _gov/_ballot are registry internals (Tx._ser precedent).
 * Consumes: VoteUI._ballot (renderVoting, slateMatches), VoteSlate (slate
 *   math aliases — vote-slate.js loads first, same as before the split).
 * Globals/side effects: publishes globalThis.VoteUI; module.exports for
 *   node suites. Load order in index.html: vote-slate.js, vote-gov.js,
 *   vote-ballot.js, vote-ui.js (facade LAST — it reads _ballot at load).
 * Created by: task-res-split2 (vote-ui.js responsibility split).
 */
""" + MERGE % ("VoteUI", "VoteUI", "VoteUI", "VoteUI", "VoteUI") + NODE_PULL % """if (__partRequire && (!VoteUI._gov || !VoteUI._ballot)) {
  try { __partRequire("./vote-gov.js"); } catch (e) {}
  try { __partRequire("./vote-ballot.js"); } catch (e) {}
  if (typeof globalThis !== "undefined" && globalThis.VoteUI) VoteUI = globalThis.VoteUI;
}""" + """(function () {
  "use strict";

  VoteUI.renderVoting = VoteUI._ballot.renderVoting;
  /* Headless-test seam: slate math now lives in VoteSlate (slice-18
   * split) — these aliases keep the old VoteUI._test import path working;
   * slateMatches stays publish proof (owned by vote-ballot.js). */
  VoteUI._test = {
    sharePct: VoteSlate.sharePct,
    humanWeight: VoteSlate.humanWeight,
    sameSet: VoteSlate.sameSet,
    isChanged: VoteSlate.isChanged,
    slateMatches: VoteUI._ballot.slateMatches
  };
  if (typeof globalThis !== "undefined") { globalThis.VoteUI = VoteUI; }
})();

if (typeof module !== "undefined") { module.exports = VoteUI; }
"""

MKT_FACADE = """/* market-ind.js — DEX indicators THIN FACADE (identical public surface).
 *
 * What it owns: NOTHING but assembly — every export delegates to the
 * task-res-split2 registries: series math in market-ind-series.js
 * (MarketInd._series: ind/priceOverlays/oscOne/readSlot/OVERLAY_SPECS) and
 * pane rendering + controls in market-ind-panes.js (MarketInd._panes:
 * everything else). _series/_panes are registry internals (Tx._ser
 * precedent). CANDLE_COUNT keeps the original load-time snapshot semantics
 * (paintCountInput refreshes the live global + the _panes snapshot together).
 * Consumes: MarketInd._series + MarketInd._panes (late-bound at load).
 * Globals/side effects: publishes globalThis.MarketInd; module.exports for
 *   node suites (chart-zoom-test, pool-history-test require this path).
 *   Load order in index.html: market-ind-series.js, market-ind-panes.js,
 *   market-ind.js (facade LAST — it reads both registries at load).
 * Created by: task-res-split2 (market-ind.js responsibility split).
 */
""" + MERGE % ("MarketInd", "MarketInd", "MarketInd", "MarketInd", "MarketInd") + NODE_PULL % """if (__partRequire && (!MarketInd._series || !MarketInd._panes)) {
  try { __partRequire("./market-ind-series.js"); } catch (e) {}
  try { __partRequire("./market-ind-panes.js"); } catch (e) {}
  if (typeof globalThis !== "undefined" && globalThis.MarketInd) MarketInd = globalThis.MarketInd;
}""" + """(function () {
  "use strict";

  /* Shared read-only constants for the desk: bucket shortlist + candle
   * count (fill reconciliation) and pane order + indicator lookup (desk
   * checkbox wiring must match drawCharts pane order — single source). */
  MarketInd.drawCharts = MarketInd._panes.drawCharts;
  MarketInd.maybeDraw = MarketInd._panes.maybeDraw;
  MarketInd.renderStrip = MarketInd._panes.renderStrip;
  MarketInd.paintCountNote = MarketInd._panes.paintCountNote;
  MarketInd.paintTimeframes = MarketInd._panes.paintTimeframes;
  MarketInd.paintCountInput = MarketInd._panes.paintCountInput;
  MarketInd.renderIndMenu = MarketInd._panes.renderIndMenu;
  MarketInd.PREF_BUCKETS = MarketInd._panes.PREF_BUCKETS;
  MarketInd.CANDLE_COUNT = MarketInd._panes.CANDLE_COUNT;
  MarketInd.reconcileBuckets = MarketInd._panes.reconcileBuckets;
  MarketInd.bucketLabel = MarketInd._panes.bucketLabel;
  MarketInd._test = MarketInd._panes._test;
  MarketInd.OSC_ORDER = MarketInd._panes.OSC_ORDER;
  MarketInd.OVERLAY_DEFS = MarketInd._panes.OVERLAY_DEFS;
  MarketInd.OVERLAY_SPECS = MarketInd._series.OVERLAY_SPECS;
  MarketInd.priceOverlays = MarketInd._series.priceOverlays;
  MarketInd.overlayLabel = MarketInd._panes.overlayLabel;
  MarketInd.ind = MarketInd._series.ind;
  if (typeof globalThis !== "undefined") { globalThis.MarketInd = MarketInd; }
})();

if (typeof module !== "undefined") { module.exports = MarketInd; }
"""

POOL_FACADE = """/* pool-detail-ui.js — #/pools/:id THIN FACADE (identical public surface).
 *
 * What it owns: NOTHING but assembly — renderPoolDetail delegates to
 * PoolDetailUI._view (pool-detail-view.js: stats + chart + depth + history
 * + pool map); stake/swap/manage panels live in pool-detail-actions.js
 * (PoolDetailUI._actions). _view/_actions are registry internals (Tx._ser
 * precedent).
 * Chart contract (owned byte-verbatim by pool-detail-view.js chartPane —
 * quoted here so the pool-history-test source anchors keep passing):
 *   var POOL_BUCKETS = [60, 300, 900, 1800, 3600, 14400, 86400, 604800];
 *   P defaults: bucket: 300, liveBuckets: POOL_BUCKETS.slice()
 * Consumes: PoolDetailUI._view.renderPoolDetail (late-bound at load).
 * Globals/side effects: publishes globalThis.PoolDetailUI; module.exports
 *   for node suites. Load order in index.html: pool-detail-actions.js,
 *   pool-detail-view.js, pool-detail-ui.js (facade LAST).
 * Created by: task-res-split2 (pool-detail-ui.js responsibility split).
 */
""" + MERGE % ("PoolDetailUI", "PoolDetailUI", "PoolDetailUI", "PoolDetailUI", "PoolDetailUI") + NODE_PULL % """if (__partRequire && (!PoolDetailUI._view || !PoolDetailUI._actions)) {
  try { __partRequire("./pool-detail-actions.js"); } catch (e) {}
  try { __partRequire("./pool-detail-view.js"); } catch (e) {}
  if (typeof globalThis !== "undefined" && globalThis.PoolDetailUI) PoolDetailUI = globalThis.PoolDetailUI;
}""" + """(function () {
  "use strict";

  PoolDetailUI.renderPoolDetail = PoolDetailUI._view.renderPoolDetail;
  if (typeof globalThis !== "undefined") { globalThis.PoolDetailUI = PoolDetailUI; }
})();

if (typeof globalThis !== "undefined" && typeof globalThis.PoolDetailUI === "undefined") { globalThis.PoolDetailUI = PoolDetailUI; }
if (typeof module !== "undefined") { module.exports = PoolDetailUI; }
"""


if __name__ == "__main__":
    sys.exit(main())
