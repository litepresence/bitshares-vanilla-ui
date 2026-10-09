/* AccountNetES: the FETCH half of the account-network adapter.
 * Owns: the HistoryCap seam (the only raw-ES path in the app), the per-seed
 *   ES query + paged walk, the chunked chain get_objects join that resolves a
 *   credit line's lender, the index fallback for references the chain can no
 *   longer answer, and gather() — the one function that runs the whole
 *   pipeline for a set of seeds.
 * Consumes: AccountNet (the pure core: classify / dedupeKey / buildGraph /
 *   opUnion / enabled / MAX_SEEDS / SCAN_CAP), HistoryCap.esSearch,
 *   Chain.db/Chain.call (get_objects), Account.resolve (seed ids).
 *   Split from account-net.js 2026-10-09 for readability (§3.7: files past
 *   ~400 lines are split candidates; this file owns transport, the core owns
 *   the rules). The core re-exports these functions, so callers keep one
 *   import.
 * Side effects: one HTTPS POST per page to the community index + chain
 *   reads, both lazy. No signing, no storage, no tx build.
 * MONEY DISCIPLINE: nothing here touches amounts — they stay raw digit
 *   strings owned by the core.
 * ES TRUTH: see account-net.js's header (per-party duplicates, the op
 *   numbering hazard, the 10 000 size ceiling).
 * Graph shapes it returns (AccountNet.buildGraph) are documented once in
 * account-net.js as the AccountNetEdge / AccountNetGraph typedefs, and
 * referenced here by name rather than restated.
 * Global AccountNetES.
 */
var AccountNetES = (function () {
  "use strict";

  /* The core module, resolved at CALL time (the browser gets it via script
   * order; node suites get it through the facade's module.require, so there
   * is no load-time cycle).
   * @returns {any} AccountNet, or null when it is not loadable here. */
  function core() {
    try {
      if (typeof AccountNet !== "undefined" && AccountNet) return AccountNet;
    } catch (e) { /* fall through */ }
    try {
      if (typeof globalThis !== "undefined" && globalThis.AccountNet && globalThis.AccountNet) return globalThis.AccountNet;
    } catch (e2) { /* no core */ }
    return null;
  }

  /* HistoryCap seam (the ONLY raw-ES path). Classic-script global in the
   * browser, globalThis preload in node suites. Missing => null => scanSeed
   * rejects and the view shows the honest reason; never a direct fetch. */
  function _historyCap() {
    try {
      if (typeof HistoryCap !== "undefined" && HistoryCap && typeof HistoryCap.esSearch === "function") return HistoryCap;
    } catch (e) { /* fall through to globalThis */ }
    try {
      if (typeof globalThis !== "undefined" && globalThis.HistoryCap && typeof globalThis.HistoryCap.esSearch === "function") return globalThis.HistoryCap;
    } catch (e) { /* no seam */ }
    return null;
  }

  /* ES pref gate (esEnabled; missing HistoryCap reads as ON, then
   * scanSeed rejects on the missing seam anyway). */
  function _esOn() {
    try {
      var HC = _historyCap();
      if (HC && typeof HC.esAllowed === "function") return HC.esAllowed() !== false;
    } catch (e) { /* ON stands */ }
    return true;
  }

  /**
   * esQuery: one seed's indexed history for a set of ops, newest first.
   * account_history.account is an exact id term (verified 2026-10-08).
   * @param {string} seedId 1.2.x account id.
   * @param {number[]} opIds Operation types to request.
   * @param {Array<*>} [searchAfter] Previous page's last sort, verbatim.
   * @returns {Object} ES query body.
   */
  function esQuery(seedId, opIds, searchAfter) {
    var q = { track_total_hits: false,
      sort: [{ "block_data.block_time": { order: "desc", unmapped_type: "boolean" } }],
      size: limit("ES_SIZE", 1000),
      _source: ["account_history", "operation_history", "operation_type", "block_data"],
      query: { bool: { filter: [
        { term: { "account_history.account": seedId } },
        { terms: { operation_type: opIds } } ] } } };
    if (searchAfter) q.search_after = searchAfter;
    return q;
  }

  /**
   * scanSeed: paged walk of one account's indexed history, capped.
   * Resolves {hits, scanned, truncated}; rejects "es-disabled" /
   * "es-unavailable" / "bad-account-id" so the view can say WHY. A page that
   * fails mid-walk keeps what it fetched and reports truncated (the candle
   * deep walk's honesty rule).
   * @param {string} seedId 1.2.x account id.
   * @param {number[]} opIds Ops to request (opUnion).
   * @param {{cap?:number, maxPages?:number, timeoutMs?:number}} [opts]
   * @returns {Promise<{hits:Array, scanned:number, truncated:boolean}>}
   */
  function scanSeed(seedId, opIds, opts) {
    opts = opts || {};
    var cap = opts.cap === undefined ? limit("SCAN_CAP", 5000) : Math.max(1, Math.floor(opts.cap));
    var maxPages = opts.maxPages === undefined ? limit("SCAN_MAX_PAGES", 2) : Math.max(1, Math.floor(opts.maxPages));
    var budget = opts.timeoutMs === undefined ? limit("SCAN_TIMEOUT_MS", 30000) : Math.max(1000, Math.floor(opts.timeoutMs));
    return new Promise(function (resolve, reject) {
      if (!/^1\.2\.\d+$/.test(String(seedId))) { reject(new Error("bad-account-id")); return; }
      if (!_esOn()) { reject(new Error("es-disabled")); return; }
      var HC = _historyCap();
      if (!HC) { reject(new Error("es-unavailable")); return; }
      var deadline = Date.now() + budget;
      var hits = [], searchAfter = null, pages = 0, truncated = false, done = false;
      function finish() {
        if (done) return; done = true;
        resolve({ hits: hits, scanned: hits.length, truncated: truncated });
      }
      /* A mid-walk failure keeps the pages already fetched (the map still
       * draws) and reports truncation; only a page-1 failure rejects so the
       * view can show the reason. This settles ITSELF rather than calling
       * finish(): finish() guards on done, and fail() already claimed it. */
      function fail(e) {
        if (done) return;
        done = true;
        if (hits.length) {
          truncated = true;
          resolve({ hits: hits, scanned: hits.length, truncated: true });
          return;
        }
        reject(e instanceof Error ? e : new Error("es-unavailable"));
      }
      function page() {
        if (done) return;
        if (pages >= maxPages) { truncated = true; finish(); return; }
        var remain = deadline - Date.now();
        if (remain <= 0) { truncated = true; finish(); return; }
        HC.esSearch("bitshares-*", esQuery(seedId, opIds, searchAfter), { timeoutMs: remain }).then(function (data) {
          if (done) return;
          var got = (data && data.hits && data.hits.hits) || [];
          for (var i = 0; i < got.length && hits.length < cap; i++) hits.push(got[i]);
          pages++;
          if (hits.length >= cap) { truncated = true; finish(); return; }
          if (got.length < limit("ES_SIZE", 1000)) { finish(); return; }
          var last = got[got.length - 1];
          if (!last || !last.sort) { truncated = true; finish(); return; }
          searchAfter = last.sort;
          page();
        }).catch(fail);
      }
      page();
    });
  }

  /* Chunked get_objects: the chain caps arrays it will take, so ids go in
   * slices of 100 and the slices run in order. */
  var OBJECT_CHUNK = 100;
  function fetchObjects(ids) {
    var steps = [];
    for (var i = 0; i < ids.length; i += OBJECT_CHUNK) steps.push(ids.slice(i, i + OBJECT_CHUNK));
    return steps.reduce(function (p, chunk) {
      return p.then(function (acc) {
        return Chain.db().then(function (api) { return Chain.call(api, "get_objects", [chunk]); })
          .then(function (rows) { return acc.concat(rows || []); });
      });
    }, Promise.resolve([]));
  }

  /**
   * creditOwners: op 72 names a borrower + offer_id and op 73/76 an account
   * + deal_id, so the LENDER is the offer owner (deal -> offer -> owner).
   * One chunked get_objects pass each way. Missing objects land in
   * `missing` — the caller drops those lines and says so. Never guesses.
   * @param {{offerId?:string[], dealId?:string[]}} refs Referenced ids.
   * @returns {Promise<{offer:Object, deal:Object, missing:string[],
   *   viaIndex:{offers:number, deals:number}}>} viaIndex counts how many
   *   owners came from the index rather than a live chain object.
   */
  function creditOwners(refs) {
    refs = refs || {};
    var offerIds = (refs.offerId || []).filter(function (v) { return /^1\.21\.\d+$/.test(String(v)); });
    var dealIds = (refs.dealId || []).filter(function (v) { return /^1\.22\.\d+$/.test(String(v)); });
    var out = { offer: {}, deal: {}, missing: [], viaIndex: { offers: 0, deals: 0 } };
    if (!offerIds.length && !dealIds.length) return Promise.resolve(out);
    return fetchObjects(offerIds.concat(dealIds)).then(function (rows) {
      var dealOffer = {};
      (rows || []).forEach(function (o) {
        if (!o || !o.id) return;
        var id = String(o.id);
        /* credit_offer_object carries owner_account, NOT owner (verified live
         * 2026-10-09 against 1.21.79: {"owner_account":"1.2.1809211",...}).
         * Reading `owner` here reported every credit line missing. `owner` is
         * accepted as a fallback for index/shape drift. */
        if (/^1\.21\./.test(id)) {
          var own = o.owner_account || o.owner;
          if (own) out.offer[id] = String(own);
        } else if (/^1\.22\./.test(id)) {
          if (o.offer_id) dealOffer[id] = String(o.offer_id);
        }
      });
      var wanted = [];
      Object.keys(dealOffer).forEach(function (d) {
        if (out.offer[dealOffer[d]]) return;   // the offer came back in the first pass
        if (wanted.indexOf(dealOffer[d]) === -1) wanted.push(dealOffer[d]);
      });
      return fetchObjects(wanted).then(function (offers) {
        (offers || []).forEach(function (o) {
          if (!o || !o.id) return;
          var own = o.owner_account || o.owner;
          if (own) out.offer[String(o.id)] = String(own);
        });
        Object.keys(dealOffer).forEach(function (d) {
          var own = out.offer[dealOffer[d]];
          if (own) out.deal[d] = own;
        });
        /* Anything the chain could not answer (deleted object) gets one
         * index pass before it is called missing — see creditIndexOwners. */
        var stillMissingDeals = dealIds.filter(function (d) { return !out.deal[d]; });
        var stillMissingOffers = offerIds.filter(function (id) { return !out.offer[id]; });
        return creditIndexOwners({ offerId: stillMissingOffers, dealId: stillMissingDeals })
          .then(function (idx) {
            Object.keys(idx.deal).forEach(function (d) { if (!out.deal[d]) out.deal[d] = idx.deal[d]; });
            Object.keys(idx.offer).forEach(function (id) { if (!out.offer[id]) out.offer[id] = idx.offer[id]; });
            out.viaIndex = idx.viaIndex;
            /* Sweep the REQUESTED ids, not just the ones a pass returned: a
             * reference nobody can resolve must be REPORTED, never silently
             * dropped and never drawn with a guessed counterparty. */
            dealIds.forEach(function (d) { if (!out.deal[d]) out.missing.push(d); });
            offerIds.forEach(function (id) { if (!out.offer[id]) out.missing.push(id); });
            return out;
          });
      });
    }).catch(function () {
      /* A failed join resolves NO owners: every reference is reported
       * missing rather than guessed, and the lines are dropped. */
      offerIds.concat(dealIds).forEach(function (id) { out.missing.push(id); });
      return out;
    });
  }

  /* creditIndexOwners: resolve references the chain can NO LONGER answer.
   *
   * Why this exists (measured 2026-10-09): credit offers and deals are
   * deleted objects — `get_objects(["1.22.209"])` returns [null] on a live
   * node — while their operations live on forever in the history index. For
   * account 1.2.1804436 that left 49 of 52 credit lines unresolvable, i.e.
   * the Credit class drew almost nothing.
   *
   * The index can answer, because the create operation carries the id it
   * minted (both term-filterable, verified live 2026-10-09):
   *   op 69 (offer create): result_object.data_string = the offer id,
   *                          op_object.owner_account = the lender
   *   op 72 (offer accept): result_object.data_object.new_objects[0] = the
   *                          DEAL id, plus op_object.offer_id (the offer it
   *                          came from) and data_object.impacted_accounts[0]
   *                          (the lender)
   * One query per kind, with a terms filter over every referenced id, so the
   * whole batch costs two requests. Every line resolved this way is reported
   * as `viaIndex` so the page can disclose it — the lender is read from an
   * immutable operation, not guessed, but it is still not the live object.
   * @param {{offerId?:string[], dealId?:string[]}} refs Referenced ids.
   * @returns {Promise<{offer:Object, deal:Object, viaIndex:Object}>}
   */
  function creditIndexOwners(refs) {
    refs = refs || {};
    var dealIds = (refs.dealId || []).filter(function (v) { return /^1\.22\.\d+$/.test(String(v)); });
    var offerIds = (refs.offerId || []).filter(function (v) { return /^1\.21\.\d+$/.test(String(v)); });
    var out = { offer: {}, deal: {}, viaIndex: { offers: 0, deals: 0 } };
    if (!dealIds.length && !offerIds.length) return Promise.resolve(out);
    var HC = _historyCap();
    if (!HC || !_esOn()) return Promise.resolve(out);
    /* deal -> {offerId, lender} straight off the accept operation. */
    var dealQuery = {
      track_total_hits: false,
      size: limit("ES_SIZE", 1000),
      _source: ["operation_history", "operation_type"],
      query: { bool: { filter: [
        { term: { operation_type: 72 } },
        { terms: { "operation_history.operation_result_object.data_object.new_objects.keyword": dealIds } } ] } }
    };
    /* offer -> lender straight off the create operation. */
    var offerQuery = {
      track_total_hits: false,
      size: limit("ES_SIZE", 1000),
      _source: ["operation_history", "operation_type"],
      query: { bool: { filter: [
        { term: { operation_type: 69 } },
        { terms: { "operation_history.operation_result_object.data_string.keyword": offerIds } } ] } }
    };
    var step = function (q) {
      try { return HC.esSearch("bitshares-*", q, { timeoutMs: 10000 }); }
      catch (e) { return Promise.reject(e); }
    };
    return Promise.all([dealIds.length ? step(dealQuery).catch(function () { return null; }) : null,
      offerIds.length ? step(offerQuery).catch(function () { return null; }) : null])
      .then(function (both) {
        var dealRes = both[0], offerRes = both[1];
        var seenDeal = {}, seenOffer = {};
        if (dealRes && dealRes.hits) {
          (dealRes.hits.hits || []).forEach(function (h) {
            var s = (h && h._source) || {};
            var oh = s.operation_history || {};
            var oo = oh.op_object || {};
            var res = oh.operation_result_object || {};
            var data = res.data_object || {};
            var created = Array.isArray(data.new_objects) ? data.new_objects : [];
            var impacted = Array.isArray(data.impacted_accounts) ? data.impacted_accounts : [];
            var lender = acct2(impacted[0]);
            var offer = String(oo.offer_id || "");
            for (var i = 0; i < created.length; i++) {
              var dealId = String(created[i] || "");
              if (!/^1\.22\.\d+$/.test(dealId) || seenDeal[dealId]) continue;
              seenDeal[dealId] = 1;
              if (lender && /^1\.21\.\d+$/.test(offer)) {
                out.deal[dealId] = lender;
                if (!out.offer[offer]) out.offer[offer] = lender;
                out.viaIndex.deals++;
              } else if (lender) {
                /* the accept op gave us no offer id: keep the lender under a
                 * per-deal key so the caller can still draw the line */
                out.deal[dealId] = lender;
                out.viaIndex.deals++;
              }
            }
          });
        }
        if (offerRes && offerRes.hits) {
          (offerRes.hits.hits || []).forEach(function (h) {
            var s = (h && h._source) || {};
            var oh = s.operation_history || {};
            var oo = oh.op_object || {};
            var lender = acct2(oo.owner_account);
            if (!lender) return;
            var created = String((oh.operation_result_object || {}).data_string || "");
            if (!/^1\.21\.\d+$/.test(created) || seenOffer[created]) return;
            seenOffer[created] = 1;
            if (!out.offer[created]) { out.offer[created] = lender; out.viaIndex.offers++; }
          });
        }
        return out;
      })
      .catch(function () { return out; });   /* index down => stay honest, draw less */
  }

  /**
   * limit: core config read, so a budget can never be spelled two ways (and a
   * missing core reads as the documented fallback instead of throwing).
   * @param {string} name Constant name on AccountNet.
   * @param {number} fallback Value used when the core is unreachable.
   * @returns {number}
   */
  function limit(name, fallback) {
    var A = core();
    var v = fallback;
    if (A) {
      try {
        var raw = A[name];
        if (typeof raw === "number" && isFinite(raw)) v = raw;
      } catch (e) { /* the fallback stands */ }
    }
    return v;
  }

  /* acct: a strict 1.2.x reader, duplicated on purpose (doctrine prefers a
   * duplicated tiny helper over a cross-module import; the core's copy is
   * exercised by its own vectors).
   * @param {*} v Raw field value.
   * @returns {string|null} Canonical account id, or null. */
  function acct2(v) {
    var s = v === undefined || v === null ? "" : String(v);
    return /^1\.2\.\d+$/.test(s) ? s : null;
  }

  /**
   * collectRefs: route a pending credit edge's reference into the join set.
   * @param {Object} edge Edge carrying refs.
   * @param {{offerId:string[], dealId:string[]}} refs Accumulator (mutated).
   * @returns {void}
   */
  function collectRefs(edge, refs) {
    if (!edge || !edge.refs) return;
    if (edge.refs.offerId && refs.offerId.indexOf(edge.refs.offerId) === -1) refs.offerId.push(edge.refs.offerId);
    if (edge.refs.dealId && refs.dealId.indexOf(edge.refs.dealId) === -1) refs.dealId.push(edge.refs.dealId);
  }

  /**
   * gather: seeds -> scan -> classify -> credit join -> aggregate. Seeds are
   * scanned SEQUENTIALLY (the index is a courtesy) and opts.onSeed fires
   * after each so the page can paint as results land. One seed failing is
   * reported in `unknown` and never blanks the others.
   * @param {string[]} seedNames Raw names or ids typed by the user.
   * @param {string[]} enabledIds Enabled class ids.
   * @param {{onSeed?:Function, nodeCap?:number, edgeCap?:number,
   *   cap?:number, timeoutMs?:number}} [opts]
   * @returns {Promise<{graph:Object, seeds:Array, unknown:string[], stats:Object}>}
   *   the graph is AccountNetGraph (typedef lives in account-net.js).
   */
  function gather(seedNames, enabledIds, opts) {
    var A = core();
    if (!A) return Promise.reject(new Error("account-net-core-missing"));
    opts = opts || {};
    var en = A.enabled(enabledIds);
    var ops = A.opUnion(enabledIds);
    var names = (seedNames || []).map(function (s) { return String(s).trim(); })
      .filter(function (s) { return s.length; }).slice(0, A.MAX_SEEDS);
    var seeds = [], unknown = [], all = [], seen = {}, refs = { offerId: [], dealId: [] };
    var stats = { scanned: 0, truncated: false, droppedSelf: 0, droppedShape: 0, needsJoin: 0 };
    function resolveOne(n) {
      if (typeof Account === "undefined" || !Account || typeof Account.resolve !== "function") {
        return Promise.reject(new Error("unknown-account"));
      }
      return Account.resolve(n);
    }
    return names.reduce(function (p, n) {
      return p.then(function () {
        return resolveOne(n).then(function (r) {
          if (!r || !r.id || seen[r.id]) return null;
          seen[r.id] = 1;
          seeds.push({ id: r.id, name: r.name || n });
          return scanSeed(r.id, ops, opts).then(function (res) {
            stats.scanned += res.scanned;
            if (res.truncated) stats.truncated = true;
            var perSeed = {};
            res.hits.forEach(function (hit) {
              /* Per-party duplicates: one op, two docs when both ends are
               * seeds. Dedupe WITHIN this seed's page set. */
              var dk = A.dedupeKey(hit);
              if (dk) { if (perSeed[dk]) return; perSeed[dk] = 1; }
              var got = A.classify(hit, { enabled: en, seedId: r.id });
              if (got.skip === "self") stats.droppedSelf++;
              else if (got.skip === "shape") stats.droppedShape++;
              else if (got.skip === "needs-join") { stats.needsJoin++; all.push(got.edge); collectRefs(got.edge, refs); }
              else if (got.edge) all.push(got.edge);
            });
            if (typeof opts.onSeed === "function") { try { opts.onSeed(seeds.slice(), stats); } catch (e) { /* painter is optional */ } }
            return null;
          });
        }).catch(function () { unknown.push(n); return null; });
      });
    }, Promise.resolve([]))
      .then(function () { return creditOwners(refs); })
      .then(function (owners) {
        var edges = [];
        all.forEach(function (e) {
          if (!e.refs) { edges.push(e); return; }
          var own = e.refs.offerId ? owners.offer[e.refs.offerId] : owners.deal[e.refs.dealId];
          if (!own) return;                    /* unresolvable => dropped, counted as missing */
          if (!e.to) e.to = own; else if (!e.from) e.from = own;
          if (!e.from || !e.to || e.from === e.to) return;
          edges.push(e);
        });
        var graph = A.buildGraph(edges, seeds, { scanned: stats.scanned,
          droppedSelf: stats.droppedSelf, droppedShape: stats.droppedShape,
          needsJoin: stats.needsJoin, scanCapHit: stats.truncated,
          nodeCap: opts.nodeCap, edgeCap: opts.edgeCap });
        graph.stats.missingCredit = owners.missing.length;
        graph.stats.creditViaIndex = owners.viaIndex || { offers: 0, deals: 0 };
        graph.stats.unknown = unknown.slice();
        graph.stats.truncated = stats.truncated;
        return { graph: graph, seeds: seeds, unknown: unknown, stats: graph.stats };
      });
  }

  return {
    esQuery: esQuery, scanSeed: scanSeed,
    creditOwners: creditOwners, creditIndexOwners: creditIndexOwners,
    gather: gather, _historyCap: _historyCap
  };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.AccountNetES === "undefined") { globalThis.AccountNetES = AccountNetES; }
if (typeof module !== "undefined") { module.exports = AccountNetES; }
