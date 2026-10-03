/* EsLabRun: execution half of the es-lab catalog (resolveAccount/run/runPaged).
 * Owns: name->id resolution (read-only Chain lookup) and template execution
 *   (single + capped search_after walk) — everything that touches a socket.
 *   Shapes (build/parse) stay owned by es-lab.js; transport stays owned by
 *   HistoryCap.esSearch. Split per §3.7 (one job per file).
 * Consumes: EsLab.byKey/build/parse (+ ES_SIZE/ES_MAX_PAGES/ES_TIMEOUT_MS),
 *   HistoryCap.esSearch (the ONLY ES transport), Chain.db/call (name
 *   resolution + precision reads elsewhere — read-only, canonical two-step
 *   pool.js _dbCall pattern).
 * Globals/side effects: exposes global EsLabRun only.
 * Created by: es-lab design 2026-10-03 Task 6 (catalog split), AFK build.
 */
var EsLabRun = (function () {
  "use strict";

  /* cat: the shape catalog (global in browsers via script order; required
   * in node tests via `global.EsLab = require("./es-lab.js")` first). */
  function cat() {
    if (typeof EsLab !== "undefined" && EsLab) return EsLab;
    throw new Error("es-bad-key: catalog missing");
  }

  /* run: execute one template once (first page). Params: tplKey, values,
   * opts {timeoutMs}. Returns a Promise for {rows, json} (parsed rows plus
   * the raw ES response — the desk always shows raw). Fails: rejects
   * es-bad-key, coerce errors, or the HistoryCap errors (es-disabled /
   * es-unavailable / es-timeout). */
  function run(tplKey, values, opts) {
    var C = cat();
    var tpl = C.byKey(tplKey);
    if (!tpl) return Promise.reject(new Error("es-bad-key: " + tplKey));
    var req;
    try { req = C.build(tpl, values); } catch (e) { return Promise.reject(e); }
    var timeoutMs = (opts && typeof opts.timeoutMs === "number" && opts.timeoutMs > 0) ?
      opts.timeoutMs : C.ES_TIMEOUT_MS;
    return HistoryCap.esSearch(req.index, req.body, { timeoutMs: timeoutMs }).then(function (json) {
      return { rows: C.parse(tpl, json), json: json };
    });
  }

  /* resolveAccount: display input -> exact 1.2.x id for term queries.
   * Params: nameOrId string (id passes through; names resolve via the
   *   canonical two-step Chain.db() -> Chain.call(dbId,
   *   "get_account_by_name", [name]) — pool.js _dbCall pattern; the api-lab
   *   lookup). Returns a Promise for the id. Fails: rejects "missing:
   *   account" (blank), "unknown account: <name>" (no such account, or no
   *   Chain in unit tests — fail closed), "not-connected" (socket down —
   *   the desk renders the offline panel, never "unknown"). */
  function resolveAccount(nameOrId) {
    var v = String(nameOrId === undefined || nameOrId === null ? "" : nameOrId);
    if (/^1\.2\.\d+$/.test(v)) return Promise.resolve(v);
    if (!v.length) return Promise.reject(new Error("missing: account"));
    var hasChain = false;
    try {
      hasChain = (typeof Chain !== "undefined" && Chain &&
        typeof Chain.db === "function" && typeof Chain.call === "function");
    } catch (e) { hasChain = false; }
    if (!hasChain) return Promise.reject(new Error("unknown account: " + v));
    return Chain.db().then(function (dbId) {
      return Chain.call(dbId, "get_account_by_name", [v]);
    }, function () { throw new Error("not-connected"); }).then(function (a) {
      if (a && a.id) return a.id;
      throw new Error("unknown account: " + v);
    }, function (e) {
      if (e && e.message === "not-connected") throw e;
      var sock = /not connected|socket closed|connect timeout/i
        .test(String((e && e.message) || ""));
      throw new Error(sock ? "not-connected" : ("unknown account: " + v));
    });
  }

  /* runPaged: search_after walk with the adapter caps (500/page, max 2 pages,
   * 15s TOTAL deadline — market-fills-history.js:168-211 pattern). Params:
   * tplKey, values, opts {want, timeoutMs}. Returns a Promise for
   * {rows, json} (concatenated parsed rows capped at min(want, 1000), plus
   * the LAST page's raw response for the raw pane). Fails: rejects
   * es-bad-key, coerce errors, es-no-page (agg kind has no hits to walk),
   * es-timeout (deadline lapsed), or the HistoryCap errors. Never fires
   * match_all: every paged template carries a filter term by construction. */
  function runPaged(tplKey, values, opts) {
    var C = cat();
    var tpl = C.byKey(tplKey);
    if (!tpl) return Promise.reject(new Error("es-bad-key: " + tplKey));
    if (tpl.kind !== "ops" && tpl.kind !== "holders") {
      return Promise.reject(new Error("es-no-page: " + tplKey));
    }
    var req;
    try { req = C.build(tpl, values); } catch (e) { return Promise.reject(e); }
    var want = (opts && typeof opts.want === "number" && opts.want > 0) ?
      Math.min(opts.want, C.ES_SIZE * C.ES_MAX_PAGES) : C.ES_SIZE * C.ES_MAX_PAGES;
    var budget = (opts && typeof opts.timeoutMs === "number" && opts.timeoutMs > 0) ?
      opts.timeoutMs : C.ES_TIMEOUT_MS;
    var deadline = Date.now() + budget;
    var out = [];
    var pages = 0;
    var lastJson = null;
    function page(searchAfter) {
      var body = req.body;
      if (searchAfter) body.search_after = searchAfter;
      else if (body.search_after) delete body.search_after;
      var remain = deadline - Date.now();
      if (remain <= 0) return Promise.reject(new Error("es-timeout"));
      return HistoryCap.esSearch(req.index, body, { timeoutMs: remain }).then(function (json) {
        lastJson = json;
        var rows = C.parse(tpl, json);
        for (var i = 0; i < rows.length && out.length < want; i++) out.push(rows[i]);
        pages++;
        var hits = json && json.hits && json.hits.hits;
        var pageSize = req.body.size || C.ES_SIZE;
        var last = (hits && hits.length) ? hits[hits.length - 1] : null;
        if (!last || !last.sort || hits.length < pageSize ||
            pages >= C.ES_MAX_PAGES || out.length >= want) return { rows: out, json: lastJson };
        return page(last.sort);
      });
    }
    return page(null);
  }

  /* precMap: batched asset-precision map for holder rows. Params: tplKey,
   * vals, rows (parsed holder rows with .asset). Returns a Promise for
   * {assetId: prec|null} — ONE get_objects round trip for every distinct
   * 1.3.x id (holders-by-asset: usually one; balances: up to 50), non-ids
   * and unknown assets skipped, never requested. Fail-soft: any failure
   * (offline, unknown asset, non-holder kind) resolves {} — cells render
   * raw with the prec_unknown title. Never rejects (the desk must never
   * lose rows to a precision lookup). */
  function precMap(tplKey, vals, rows) {
    function empty() { return Promise.resolve({}); }
    var C = null;
    try { C = cat(); } catch (e) { return empty(); }
    var tpl = C.byKey(tplKey);
    if (!tpl || tpl.kind !== "holders") return empty();
    var ids = [];
    function take(id) {
      if (typeof id === "string" && /^1\.3\.\d+$/.test(id) &&
          ids.indexOf(id) === -1 && ids.length < 50) ids.push(id);
    }
    if (tplKey === "holders-by-asset") take(vals && vals[0]);
    else (rows || []).forEach(function (r) { take(r && r.asset); });
    var hasChain = false;
    try {
      hasChain = (typeof Chain !== "undefined" && Chain &&
        typeof Chain.db === "function" && typeof Chain.call === "function");
    } catch (e) { hasChain = false; }
    if (!ids.length || !hasChain) return empty();
    return Chain.db().then(function (dbId) {
      return Chain.call(dbId, "get_objects", [ids]);
    }).then(function (objs) {
      var map = {};
      (objs || []).forEach(function (o, i) {
        if (ids[i]) map[ids[i]] = (o && typeof o.precision === "number") ? o.precision : null;
      });
      return map;
    }, function () { return {}; });
  }

  return { run: run, resolveAccount: resolveAccount, runPaged: runPaged, precMap: precMap };
})();

if (typeof module !== "undefined") { module.exports = EsLabRun; }
