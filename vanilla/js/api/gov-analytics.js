/* GovAnalytics: bounded governance + chain-sample analytics (funding shares,
 *   active/standby splits, top voters + proxy-vote matrix, largest-in-sample
 *   blocks/txs).
 * Owns: pure ranking/math helpers (unit-tested) + thin bounded chain joins
 *   over ALREADY-VERIFIED reads. No rendering, no signing, no broadcast.
 * Consumes: Chain.db/.call (sole socket owner — never opens its own socket),
 *   Vote.getAllWorkers/lists (governance lists), Explorer.recentBlocks/
 *   opsFromBody (block sample), Format.formatRatioPct2dp/formatAmount (all
 *   money/percent math — never inline float, principle #6).
 * Globals/side effects: exposes global GovAnalytics only; no DOM, no storage,
 *   no key material. All chain fns are best-effort reads — failures propagate
 *   named errors ("not-connected", "unavailable") for honest view fallbacks.
 * Created by: building-vanilla-slices skill, gov-analytics extension 2026-10-02.
 *
 * CHAIN TRUTH (#4 wins; verified 2026-10-02 before build):
 * - get_all_workers(optional<bool> is_expired) -> vector<worker_object>
 *   (database_api.hpp:1201; registered :1582). lists use false (live only).
 * - worker_object{daily_pay share_type, total_votes_for/_against u64,
 *   vote_for/vote_against vote_id} (chain/worker_object.hpp:113-131).
 * - worker_budget_per_day (chain_parameters.hpp:75, reflected :156) read off
 *   the 2.0.0 global_property parameters — same get_objects call Vote.lists
 *   and vote-ui fillBudget already make (no new object space).
 * - get_witnesses / get_committee_members / get_witness_count /
 *   get_committee_count + lookup_* fallbacks (database_api.hpp:1129-1188);
 *   active sets on 2.0.0 active_witnesses / active_committee_members
 *   (chain/global_property_object.hpp:48-49). Vote.lists already joins the
 *   active flag per row — splits count it, no new chain surface.
 * - get_top_voters(uint32_t limit) -> vector<account_statistics_object>,
 *   "sorted by reverse vp_active" (database_api.hpp:313-319); limit capped by
 *   api_limit_get_top_voters = 200 (application.hpp:63). account_statistics_
 *   object{owner account_id, name, is_voting, vp_active/all} (chain/
 *   account_object.hpp:50,52,91,97-98). Vanilla caps limit 1..20 (default 10)
 *   — far under the node cap. Voter votes/proxy come from ONE batched
 *   get_accounts([ownerIds]) (database_api.hpp:287): account.options.
 *   voting_account (default GRAPHENE_PROXY_TO_SELF_ACCOUNT 1.2.5,
 *   protocol/account.hpp:48 + protocol/config.hpp:150) + votes "t:i" array.
 * - get_dynamic_global_properties() (database_api.hpp:229), get_block(h)
 *   (:182), get_block_header_batch([h], opt bool) (:173). Biggest-sample uses
 *   Explorer.recentBlocks(N<=50, withBodies) — the SAME two methods the
 *   explorer tip already calls (no new chain surface); ranking is pure.
 * - NO full-chain scan exists for "who proxies to X" (would need unbounded
 *   account enumeration: get_account_count + get_accounts pages over the whole
 *   registry). The matrix therefore reads top-N voters' OWN slates (bounded:
 *   1 get_top_voters + 1 batched get_accounts + Vote.lists) and labels itself
 *   a top-voter sample — never "all proxies". ES transport REFUSED (doctrine).
 *
 * MONEY DISCIPLINE (principle #6): daily_pay / budget / vp_* stay RAW integer
 *   strings until Format at render; funding % is exact BigInt ratio math via
 *   Format.formatRatioPct2dp (half-up, 2dp) + "%" suffix — never float.
 *   Counts (splits, tx/op counts, heights) are plain ints, never money.
 */
var GovAnalytics = (function () {
  "use strict";

  /* Caps: every chain join is bounded by construction (see header). */
  var TOP_VOTERS_DEFAULT = 10;
  var TOP_VOTERS_MAX = 20;
  var SAMPLE_DEFAULT = 30;
  var SAMPLE_MAX = 50;
  var TOP_K = 5;

  /* Single database-API round trip; "not-connected" when no socket is open. */
  async function _dbCall(method, params) {
    var dbId;
    try {
      dbId = await Chain.db();
    } catch (e) {
      throw new Error("not-connected");
    }
    try {
      return await Chain.call(dbId, method, params || []);
    } catch (e) {
      var m = (e && e.message) ? e.message : String(e || "");
      if (m.indexOf("not connected") !== -1) throw new Error("not-connected");
      throw e;
    }
  }

  /* Clamp helper: non-numeric/NaN yields the default (never throws). */
  function _clampN(v, dflt, lo, hi) {
    var n = parseInt(v, 10);
    if (!(n >= lo)) return dflt;
    return Math.min(n, hi);
  }

  /* One worker's share of the per-day budget as "X.XX%" (exact BigInt ratio
   * via Format.formatRatioPct2dp + "%" suffix). Params: payRaw, budgetRaw
   * (digit strings). Returns the percent string, or "—" when the budget is
   * missing/zero/malformed (a missing denominator is display-only — the pay
   * leg still renders human via Format at the view). Never throws. */
  function fundingShare(payRaw, budgetRaw) {
    try {
      if (!/^\d+$/.test(String(payRaw || ""))) return "—";
      if (!/^\d+$/.test(String(budgetRaw || ""))) return "—";
      if (BigInt(String(budgetRaw)) === 0n) return "—";
      return Format.formatRatioPct2dp(String(payRaw), String(budgetRaw)) + "%";
    } catch (e) {
      return "—";
    }
  }

  /* Rank worker entries by daily pay desc (BigInt compare, stable-ish via
   * slice). Params: workers (Vote.lists worker-entry shape: .extra.
   * daily_pay_raw digit string). Returns a NEW sorted array (input untouched).
   * Never throws (malformed legs sort as zero). */
  function fundingRows(workers) {
    var rows = Array.isArray(workers) ? workers.slice() : [];
    function payOf(w) {
      try {
        var r = w && w.extra && w.extra.daily_pay_raw;
        return /^\d+$/.test(String(r)) ? BigInt(String(r)) : 0n;
      } catch (e) { return 0n; }
    }
    rows.sort(function (a, b) {
      var pa = payOf(a), pb = payOf(b);
      if (pb > pa) return 1;
      if (pb < pa) return -1;
      return 0;
    });
    return rows;
  }

  /* Sum of daily_pay legs as a raw-int digit string (exact BigInt add).
   * Params: workers (same shape as fundingRows). Returns "0" for empty.
   * Never throws. */
  function fundingTotal(workers) {
    var total = 0n;
    (Array.isArray(workers) ? workers : []).forEach(function (w) {
      try {
        var r = w && w.extra && w.extra.daily_pay_raw;
        if (/^\d+$/.test(String(r))) total += BigInt(String(r));
      } catch (e) { /* leg skipped */ }
    });
    return total.toString();
  }

  /* Active/standby split over one Vote.lists tab. Params: rows (entry array
   * with boolean .active), no new reads. Returns {active, standby, total}
   * plain ints. Never throws. */
  function splitCounts(rows) {
    var list = Array.isArray(rows) ? rows : [];
    var active = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].active) active++;
    }
    return { active: active, standby: list.length - active, total: list.length };
  }

  /* Honest sample label for the largest-in-sample panel (never presented as
   * all-time — the task constraint). Params: n (sample size int), headNum
   * (head height int or null). Returns e.g. "Largest in last 30 blocks
   * (#99–#128) — sample, not all-time." Falls back to the unlabeled sample
   * sentence when heights are unknown. Never throws. */
  function sampleLabel(n, headNum) {
    var c = (typeof n === "number" && isFinite(n) && n >= 1) ? Math.floor(n) : 0;
    if (c >= 1 && typeof headNum === "number" && isFinite(headNum) && headNum >= 1) {
      var lo = Math.max(1, headNum - c + 1);
      return "Largest in last " + c + " blocks (#" + lo + "–#" + headNum + ") — sample, not all-time.";
    }
    if (c >= 1) return "Largest in last " + c + " blocks — sample, not all-time.";
    return "Largest in recent blocks — sample, not all-time.";
  }

  /* Top-k rows by tx_count desc (null/undefined counts sort last, never
   * dropped — a missing count is display-only). Params: rows ([{height,
   * tx_count}]), k (default TOP_K). Returns a NEW array. Never throws. */
  function biggestBlocks(rows, k) {
    var n = _clampN(k, TOP_K, 1, SAMPLE_MAX);
    var list = Array.isArray(rows) ? rows.slice() : [];
    list.sort(function (a, b) {
      var ta = (a && typeof a.tx_count === "number" && isFinite(a.tx_count)) ? a.tx_count : -1;
      var tb = (b && typeof b.tx_count === "number" && isFinite(b.tx_count)) ? b.tx_count : -1;
      return tb - ta;
    });
    return list.slice(0, n);
  }

  /* Top-k transactions by op count desc from fetched block bodies. Params:
   * bodies ([{height, body}] where body.transactions is the raw array — the
   * same bodies recentBlocks(withBodies) already fetched, zero new RPCs).
   * Returns [{height, txIndex, opCount}] (opCount 0 for malformed txs — never
   * dropped, never throws). Ties break by height desc (newest first). */
  function biggestTxs(bodies, k) {
    var n = _clampN(k, TOP_K, 1, SAMPLE_MAX);
    var out = [];
    (Array.isArray(bodies) ? bodies : []).forEach(function (entry) {
      var h = entry && entry.height;
      var txs = entry && entry.body && Array.isArray(entry.body.transactions)
        ? entry.body.transactions : [];
      for (var i = 0; i < txs.length; i++) {
        var ops = txs[i] && Array.isArray(txs[i].operations) ? txs[i].operations : [];
        out.push({ height: h, txIndex: i, opCount: ops.length });
      }
    });
    out.sort(function (a, b) {
      if (b.opCount !== a.opCount) return b.opCount - a.opCount;
      return (b.height || 0) - (a.height || 0);
    });
    return out.slice(0, n);
  }

  /* Pure proxy-vote matrix builder (no chain calls — inputs are already
   * fetched). Params: voterVotes ({voterId: [vote_id strings]}), candidateIds
   * (vote_id array, already capped by the caller). Returns [{voter,
   * cells: {voteId: bool}}] in voterVotes key order. Unknown vote shapes are
   * simply absent (false) — never throws. */
  function buildMatrix(voterVotes, candidateIds) {
    var cands = Array.isArray(candidateIds) ? candidateIds : [];
    var out = [];
    var map = (voterVotes && typeof voterVotes === "object") ? voterVotes : {};
    Object.keys(map).forEach(function (voter) {
      var have = {};
      (Array.isArray(map[voter]) ? map[voter] : []).forEach(function (v) { have[String(v)] = true; });
      var cells = {};
      cands.forEach(function (c) { cells[String(c)] = !!have[String(c)]; });
      out.push({ voter: voter, cells: cells });
    });
    return out;
  }

  /* Worker funding join (bounded: 1 get_all_workers(false) via Vote + 1
   * get_objects 2.0.0 for worker_budget_per_day). Returns {budgetRaw (digit
   * string or null when unreadable), workers (live entries), totalPayRaw}.
   * budgetRaw null renders shares as "—" (display-only) — never fatal.
   * Fails: "not-connected" only. */
  async function workerFunding() {
    var workers = await Vote.getAllWorkers(false);
    var list = Array.isArray(workers) ? workers : [];
    // Normalize: Vote.getAllWorkers returns RAW worker objects (not vote.js
    // list entries) — shape to {id,name,extra.daily_pay_raw} here so the pure
    // fundingRows/fundingTotal helpers hold for both shapes.
    var entries = list.map(function (w) {
      if (w && w.extra && w.extra.daily_pay_raw !== undefined) return w;
      return {
        id: (w && w.id) || "",
        name: (w && w.name) || "",
        vote_id: String((w && (w.vote_for !== undefined ? w.vote_for : w.vote_id)) || ""),
        total_raw: String((w && (w.total_votes_for !== undefined ? w.total_votes_for : 0)) || "0"),
        active: false,
        url: (w && w.url) || "",
        extra: { daily_pay_raw: String((w && w.daily_pay !== undefined && w.daily_pay !== null) ? w.daily_pay : "0") }
      };
    });
    var budgetRaw = null;
    try {
      var rows = await _dbCall("get_objects", [["2.0.0"]]);
      var params = rows && rows[0] && rows[0].parameters;
      var raw = params ? params.worker_budget_per_day : null;
      if (/^\d+$/.test(String(raw))) budgetRaw = String(raw);
    } catch (e) {
      if (e && e.message === "not-connected") throw e;
      budgetRaw = null; // display-only fallback
    }
    return { budgetRaw: budgetRaw, workers: entries, totalPayRaw: fundingTotal(entries) };
  }

  /* Active/standby splits (bounded: Vote.lists only — the active flag per row
   * is already joined there; no new chain surface). Returns
   * {witness: {active, standby, total}, committee: {...}}. Workers carry no
   * chain active flag (always false) and are excluded by construction.
   * Fails: "not-connected" / "empty-list" via Vote.lists. */
  async function splits() {
    var all = await Vote.lists();
    return {
      witness: splitCounts(all.witnesses),
      committee: splitCounts(all.committee)
    };
  }

  /* Top-N voters by vp_active (bounded: ONE get_top_voters call, limit clamped
   * 1..20, default 10 — far under the node cap 200). Returns the raw stat
   * rows [{owner, name, vp_active...}] verbatim (vp legs stay raw — Format at
   * render). Fails: "not-connected"; "unavailable" when the node lacks the
   * method (older nodes) — the view renders an honest panel, never a guess. */
  async function topVoters(limit) {
    var n = _clampN(limit, TOP_VOTERS_DEFAULT, 1, TOP_VOTERS_MAX);
    var rows;
    try {
      rows = await _dbCall("get_top_voters", [n]);
    } catch (e) {
      if (e && e.message === "not-connected") throw e;
      throw new Error("unavailable");
    }
    if (!Array.isArray(rows)) throw new Error("unavailable");
    return rows.slice(0, n);
  }

  /* Top-voter proxy matrix (bounded: 1 get_top_voters(N) + Vote.lists() +
   * ONE batched get_accounts(ownerIds)). Candidates default to the top 10
   * witnesses + top 10 committee by total_votes weight (already-fetched rows
   * — no extra reads). Returns {voters: [{id, name, vpRaw, proxy, votes}],
   * candidates: {witness: [voteIds], committee: [voteIds]}, matrix:
   * buildMatrix output}. The panel MUST label itself a top-N sample (never
   * "all proxies" — no bounded chain path enumerates proxy followers; see
   * header). Fail-open: "unavailable" when get_top_voters is missing (older
   * node); voter rows whose account read fails keep vp from stats with
   * votes [] (cells false, never a throw). */
  async function proxyMatrix(topN, candW, candC) {
    var n = _clampN(topN, TOP_VOTERS_DEFAULT, 1, TOP_VOTERS_MAX);
    var nw = _clampN(candW, TOP_K * 2, 1, 20);
    var nc = _clampN(candC, TOP_K * 2, 1, 20);
    var stats = await topVoters(n);
    var all = await Vote.lists();
    function topIds(rows, count) {
      var list = (Array.isArray(rows) ? rows.slice() : []).filter(function (r) {
        return r && r.vote_id;
      });
      list.sort(function (a, b) {
        var pa = 0n, pb = 0n;
        try { pa = /^\d+$/.test(String(a.total_raw)) ? BigInt(String(a.total_raw)) : 0n; } catch (e) { pa = 0n; }
        try { pb = /^\d+$/.test(String(b.total_raw)) ? BigInt(String(b.total_raw)) : 0n; } catch (e) { pb = 0n; }
        if (pb > pa) return 1;
        if (pb < pa) return -1;
        return 0;
      });
      return list.slice(0, count).map(function (r) { return String(r.vote_id); });
    }
    var wIds = topIds(all.witnesses, nw);
    var cIds = topIds(all.committee, nc);
    var ownerIds = stats.map(function (s) { return s && s.owner; }).filter(function (id) {
      return typeof id === "string" && /^1\.2\.\d+$/.test(id);
    });
    var byId = {};
    if (ownerIds.length > 0) {
      try {
        var accts = await _dbCall("get_accounts", [ownerIds]);
        (Array.isArray(accts) ? accts : []).forEach(function (a) {
          if (a && a.id) byId[a.id] = a;
        });
      } catch (e) {
        if (e && e.message === "not-connected") throw e;
        byId = {}; // rows fall back to stats-only below
      }
    }
    var voters = stats.map(function (s) {
      var id = (s && s.owner) || "";
      var a = byId[id] || null;
      var opts = (a && a.options) || {};
      return {
        id: id,
        name: (a && a.name) || (s && s.name) || id,
        vpRaw: String((s && s.vp_active !== undefined && s.vp_active !== null) ? s.vp_active : "0"),
        proxy: opts.voting_account || "",
        votes: Array.isArray(opts.votes) ? opts.votes.slice() : []
      };
    });
    var voterVotes = {};
    voters.forEach(function (v) { voterVotes[v.id] = v.votes; });
    return {
      voters: voters,
      candidates: { witness: wIds, committee: cIds },
      matrix: buildMatrix(voterVotes, wIds.concat(cIds))
    };
  }

  return {
    TOP_VOTERS_DEFAULT: TOP_VOTERS_DEFAULT,
    TOP_VOTERS_MAX: TOP_VOTERS_MAX,
    SAMPLE_MAX: SAMPLE_MAX,
    fundingShare: fundingShare,
    fundingRows: fundingRows,
    fundingTotal: fundingTotal,
    splitCounts: splitCounts,
    sampleLabel: sampleLabel,
    biggestBlocks: biggestBlocks,
    biggestTxs: biggestTxs,
    buildMatrix: buildMatrix,
    workerFunding: workerFunding,
    splits: splits,
    topVoters: topVoters,
    proxyMatrix: proxyMatrix
  };
})();

if (typeof module !== "undefined") { module.exports = GovAnalytics; }
