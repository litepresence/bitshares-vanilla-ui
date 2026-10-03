/* EsLab: curated Elasticsearch query catalog for the #/es-lab index browser.
 * Owns: the query-template catalog (index/fields per entry), body builders
 *   (curated strings -> ES Query-DSL bodies), response parsers (ES JSON ->
 *   display rows), and run()/runPaged() — the only call paths the desk uses.
 *   No DOM, no signing, no key material, no fetch of its own.
 * Consumes: HistoryCap.esSearch (the ONLY ES transport — pref-gated,
 *   index-allowlisted, timed; vanilla/js/api/history-cap.js), Explorer.opName
 *   (agg bucket ids -> display names), Format.pct1 (agg shares).
 * Globals/side effects: exposes global EsLab only.
 * Created by: es-lab design 2026-10-03 (api-lab twin), AFK build.
 *
 * CALL TRUTH (every body below is verbatim from a recorded source):
 * - holders-by-asset: astro TopAssetHolders.ts:28-37 (match asset_type,
 *   balance desc, size N) — same body the asset top-holders panel sends
 *   (views/explorer-assets.js:907-908).
 * - fills-by-market: api/market-fills-history.js:83-92 (op-4 match +
 *   base/quote multi_match, block_time desc sort, capped _source).
 * - pool-swaps: api/pool-history.js:65-72 (op-63 match + pool-id
 *   multi_match, same envelope).
 * - top-ops-agg: astro TopOperations.ts:47-64 (size 0 + block_time range
 *   filter + terms agg on operation_type).
 * MONEY DISCIPLINE (#6): balances/amounts stay strings here; the VIEW adds
 *   human hints via Format — this file formats nothing except agg shares
 *   (counts, never money).
 */
var EsLab = (function () {
  "use strict";

  var GROUPS = ["Operations", "Holders & balances"];

  /* ES_SIZE/ES_MAX_PAGES/ES_TIMEOUT_MS: pagination caps, verbatim from the
   * market-fills adapter (api/market-fills-history.js:41-50: 500/page, max 2
   * pages = 1000 events, 15s TOTAL budget across pages). */
  var ES_SIZE = 500;
  var ES_MAX_PAGES = 2;
  var ES_TIMEOUT_MS = 15000;

  /* F: one field descriptor. Params: name, type, o (optional extras:
   * required, example, hint, max). Returns the descriptor. Fails: never. */
  function F(name, type, o) {
    var e = o || {};
    return { name: name, type: type, required: e.required !== false,
      example: e.example || "", hint: e.hint || "", max: e.max || null };
  }

  /* TEMPLATES: the curated catalog. kind drives the desk renderer
   * (ops|holders|agg). build/parse are module functions keyed by tpl.key —
   * no closures, everything unit-testable. */
  var TEMPLATES = [
    { key: "fills-by-market", group: "Operations", kind: "ops", index: "bitshares-*",
      title: "Market fills",
      desc: "Fill-order ops (type 4) for a base/quote pair, newest first. Text-matched, then leg-checked in parse.",
      sourceRef: "vanilla/js/api/market-fills-history.js:83-92",
      fields: [F("base", "string", { example: "BTS" }),
        F("quote", "string", { example: "USD" })] },
    { key: "pool-swaps", group: "Operations", kind: "ops", index: "bitshares-*",
      title: "Pool swaps",
      desc: "Liquidity-pool exchange ops (type 63) for one pool id, newest first.",
      sourceRef: "vanilla/js/api/pool-history.js:65-72",
      fields: [F("pool", "string", { example: "1.19.66", hint: "Pool id, text-matched." })] },
    { key: "top-ops-agg", group: "Operations", kind: "agg", index: "bitshares-*",
      title: "Top operations",
      desc: "Count of ops by type over a rolling day window (aggregation — no per-op rows).",
      sourceRef: "astro-ui TopOperations.ts:47-64",
      fields: [F("days", "uint", { example: "30", max: 90, hint: "Lookback window, days." })] },
    { key: "holders-by-asset", group: "Holders & balances", kind: "holders", index: "objects-balance",
      title: "Top holders",
      desc: "Largest balances of one asset, descending. Same query the asset page panel sends.",
      sourceRef: "astro-ui TopAssetHolders.ts:28-37",
      fields: [F("asset", "string", { example: "1.3.0", hint: "Asset id (1.3.x)." }),
        F("limit", "uint", { example: "25", max: 100 })] }
  ];

  /* byKey: find one template by key. Params: key string. Returns the entry
   * or null. Fails: never throws. */
  function byKey(key) {
    for (var i = 0; i < TEMPLATES.length; i++) {
      if (TEMPLATES[i].key === key) return TEMPLATES[i];
    }
    return null;
  }

  /* coerce: curated strings -> per-field values. Params: tpl, values
   * (string array aligned with tpl.fields). Returns the string array
   * (validated). Fails: throws a named Error (missing-required, bad uint,
   * over-max). Bodies are assembled in build(); coerce only validates. */
  function coerce(tpl, values) {
    var out = [];
    var fs = tpl.fields || [];
    for (var i = 0; i < fs.length; i++) {
      var f = fs[i];
      var v = (values && i < values.length && typeof values[i] === "string") ? values[i] : "";
      if ((!v || !v.length) && f.required) throw new Error("missing: " + f.name);
      if ((v || "").length && f.type === "uint") {
        if (!/^[0-9]+$/.test(v)) throw new Error("bad uint: " + f.name);
        if (f.max !== null && parseInt(v, 10) > f.max) throw new Error("over max " + f.max + ": " + f.name);
      }
      out.push(v || "");
    }
    return out;
  }

  /* filled: blank-value guard for raw-console parity. Params: tpl, values.
   * Returns true when every required field is non-blank. Fails: never. */
  function filled(tpl, values) {
    try { coerce(tpl, values); return true; } catch (e) { return false; }
  }

  /* build: curated strings -> {index, body}. Params: tpl (entry), values
   * (string array). Returns the transport-ready pair. Fails: throws the
   * coerce errors, or es-bad-key for a null tpl. */
  function build(tpl, values) {
    if (!tpl) throw new Error("es-bad-key");
    var v = coerce(tpl, values);
    var body = null;
    if (tpl.key === "holders-by-asset") {
      body = { query: { bool: { must: [{ match: { asset_type: { query: v[0] } } }] } },
        track_total_hits: false, size: parseInt(v[1] || "25", 10),
        sort: [{ balance: { order: "desc" } }] };
    } else if (tpl.key === "fills-by-market") {
      body = { sort: [{ "block_data.block_time": { order: "desc", unmapped_type: "boolean" } }],
        size: ES_SIZE,
        _source: ["account_history", "operation_history", "operation_type", "block_data"],
        query: { bool: { must: [
          { match: { operation_type: "4" } },
          { multi_match: { type: "best_fields", query: v[0], lenient: true } },
          { multi_match: { type: "best_fields", query: v[1], lenient: true } } ] } } };
    } else if (tpl.key === "pool-swaps") {
      body = { sort: [{ "block_data.block_time": { order: "desc", unmapped_type: "boolean" } }],
        size: ES_SIZE,
        _source: ["account_history", "operation_history", "operation_type", "block_data"],
        query: { bool: { must: [
          { match: { operation_type: "63" } },
          { multi_match: { type: "best_fields", query: v[0], lenient: true } } ] } } };
    } else if (tpl.key === "top-ops-agg") {
      var hours = Math.max(1, parseInt(v[0] || "30", 10) * 24);
      body = { size: 0,
        query: { bool: { filter: [{ range: { "block_data.block_time":
          { gte: "now-" + hours + "h", lte: "now" } } }] } },
        aggs: { by_op_type: { terms: { field: "operation_type", size: 200 } } } };
    } else {
      throw new Error("es-bad-key: " + tpl.key);
    }
    return { index: tpl.index, body: body };
  }

  /* opName: template-local alias for Explorer.opName (stub-safe).
   * Params: id. Returns the display name. Fails: never. */
  function opName(id) {
    try {
      if (typeof Explorer !== "undefined" && Explorer && typeof Explorer.opName === "function") {
        return Explorer.opName(id);
      }
    } catch (e) { /* fallback below */ }
    return "Operation #" + String(id);
  }

  /* parseOpsHits: shared shape for fills/swaps hit lists. Params: json.
   * Returns rows {time, block, type, name}. Null-tolerant on leaves;
   * throws es-shape only when the hits array itself is absent. */
  function parseOpsHits(json) {
    var hits = json && json.hits && json.hits.hits;
    if (!Array.isArray(hits)) throw new Error("es-shape: hits.hits missing");
    return hits.map(function (h) {
      var s = (h && h._source) || {};
      var bd = s.block_data || {};
      var t = (s.operation_type === undefined || s.operation_type === null) ? null : s.operation_type;
      return { time: bd.block_time || null, block: (bd.block_num === undefined ? null : bd.block_num),
        type: t, name: (t === null ? "?" : opName(t)) };
    });
  }

  /* parse: ES JSON -> display rows. Params: tpl (entry), json (parsed ES
   * response). Returns a row array (shape depends on tpl.kind). Fails:
   * throws es-shape on unexpected envelopes — the desk renders it as an
   * honest panel, never a blank. */
  function parse(tpl, json) {
    if (!tpl) throw new Error("es-bad-key");
    if (tpl.kind === "holders") {
      var hits = json && json.hits && json.hits.hits;
      if (!Array.isArray(hits)) throw new Error("es-shape: hits.hits missing");
      var out = [];
      for (var i = 0; i < hits.length; i++) {
        var s = (hits[i] && hits[i]._source) || {};
        var owner = s.owner_ || "";
        if (!owner) continue;
        var bal = (s.balance === undefined || s.balance === null) ? "0" : String(s.balance);
        out.push({ owner: owner, balance: bal });
      }
      return out;
    }
    if (tpl.kind === "agg") {
      var buckets = json && json.aggregations && json.aggregations.by_op_type &&
        json.aggregations.by_op_type.buckets;
      if (!Array.isArray(buckets)) throw new Error("es-shape: aggregations missing");
      var total = 0, j;
      for (j = 0; j < buckets.length; j++) total += (buckets[j].doc_count || 0);
      var rows = [];
      for (j = 0; j < buckets.length; j++) {
        if (!buckets[j].doc_count) continue;
        rows.push({ type: buckets[j].key, name: opName(buckets[j].key),
          count: buckets[j].doc_count, share: pct(buckets[j].doc_count, total) });
      }
      rows.sort(function (a, b) { return b.count - a.count; });
      return rows;
    }
    if (tpl.kind === "ops") return parseOpsHits(json);
    throw new Error("es-bad-key: " + tpl.key);
  }

  /* pct: agg share via the single percent formatter. Params: count, total.
   * Returns "x.x%". Fails: never (Format absent in bare-node reads as 0). */
  function pct(count, total) {
    try {
      if (typeof Format !== "undefined" && Format && typeof Format.pct1 === "function") {
        return Format.pct1(count, total);
      }
    } catch (e) { /* fallback below */ }
    return "0.0%";
  }

  /* run: execute one template once (first page). Params: tplKey, values,
   * opts {timeoutMs}. Returns a Promise for the parsed rows. Fails: rejects
   * es-bad-key, coerce errors, or the HistoryCap errors (es-disabled /
   * es-unavailable / es-timeout). */
  function run(tplKey, values, opts) {
    var tpl = byKey(tplKey);
    if (!tpl) return Promise.reject(new Error("es-bad-key: " + tplKey));
    var req;
    try { req = build(tpl, values); } catch (e) { return Promise.reject(e); }
    var timeoutMs = (opts && typeof opts.timeoutMs === "number" && opts.timeoutMs > 0) ?
      opts.timeoutMs : ES_TIMEOUT_MS;
    return HistoryCap.esSearch(req.index, req.body, { timeoutMs: timeoutMs }).then(function (json) {
      return parse(tpl, json);
    });
  }

  /* runPaged: search_after walk with the adapter caps (Task 3 fills the
   * loop; single-page run() above stays for agg + small lookups). */
  function runPaged(tplKey, values, opts) {
    return Promise.reject(new Error("es-todo-paged"));
  }

  return { GROUPS: GROUPS, TEMPLATES: TEMPLATES, ES_SIZE: ES_SIZE,
    ES_MAX_PAGES: ES_MAX_PAGES, ES_TIMEOUT_MS: ES_TIMEOUT_MS,
    byKey: byKey, coerce: coerce, filled: filled, build: build, parse: parse,
    run: run, runPaged: runPaged };
})();

if (typeof module !== "undefined") { module.exports = EsLab; }
