/* gateway.js — adapter registry + health + deposit fetchers + cache.
 *
 * Owns: the four slice-15 adapters (XBTSX, IOB, GDEX, BIT20), coin-list
 * normalization (raw ints stay raw strings), deposit-address HTTP fetchers,
 * withdraw-prefill derivation, health probing with timestamped cache, and
 * the namespaced localStorage address cache (gw_addr_/gw_last_/gw_health_/
 * gw_list_ keys). One purpose: gateway I/O. Consumes: platform fetch +
 * AbortController only. Chain.db is used at VIEW time, never here —
 * withdrawPrefill returns account NAMES, never objects. Side effects: the
 * localStorage keys above; one `Gateway` global; Node guard via
 * module.exports. Created by: building-vanilla-slices skill,
 * slice-15-gateways plan Task 1. Signs nothing, broadcasts nothing, touches
 * no DOM. QR/RSA OMITTED: qrcode.react + node-rsa are npm-only in #1, no
 * zero-dep source on disk. Provenance (shapes ported, never imported):
 * XbtsxMethods.js:5-89 + apiConfig.js:94-97 (XBTSX); apiConfig.js:3-9 +
 * gatewayMethods.js:496-542 (IOB initiate-trade); apiConfig.js:66-87 +
 * gdexMethods.js:50-131 (GDEX envelope/timeout); gateways.js:91-232
 * (registry, GDEX manual-only, memo prefixes); XbtsxMethods.js:91-117 +
 * gdexMethods.js:168-194 (cache key shapes).
 */
var Gateway = (function () {
  "use strict";
  var TIMEOUT_MS = 10000; // per-request budget (gdexMethods.js 10s timeout)
  var HEALTH_STALE_MS = 15 * 60 * 1000; // stale health re-probes on next call
  var CACHE_V = 1; // localStorage envelope version (bump = invalidate)
  var XBTSX_BASE = "https://apis.xbts.io/api/v2";
  var IOB_BASE = "https://api.ioxbank.com/bitshares";
  var GDEX_BASE = "https://api.52bts.net";
  var GDEX2_BASE = "https://openapi.52bts.net/adjust";
  var mem = {}; // in-memory cache (Node + fresh-tab fallback)

  /* namedError: named Errors the views switch on (unknown-gateway /
   * gateway-down / gateway-rejected / bad-account / bad-coin / disabled /
   * unproven). health() never throws — it returns {ok:false, ...}. */
  function namedError(name, detail) {
    var e = new Error(detail ? name + ": " + detail : name);
    e.name = name;
    return e;
  }
  function hasStorage() {
    try {
      return typeof localStorage !== "undefined" && !!localStorage.getItem;
    } catch (e) {
      return false;
    }
  }
  /* cacheGet/cacheSet: THE ONLY cache accessors. Envelope {v, at, data};
   * version mismatch or corrupt JSON reads as a miss (null). */
  function cacheGet(key) {
    if (mem[key]) return mem[key];
    if (!hasStorage()) return null;
    try {
      var env = JSON.parse(localStorage.getItem(key));
      if (!env || env.v !== CACHE_V) return null;
      mem[key] = env;
      return env;
    } catch (e) {
      return null;
    }
  }
  function cacheSet(key, data) {
    var env = { v: CACHE_V, at: Date.now(), data: data };
    mem[key] = env;
    if (hasStorage()) {
      try {
        localStorage.setItem(key, JSON.stringify(env));
      } catch (e) { /* full/blocked: memory copy serves this session */ }
    }
    return env;
  }
  /* Namespaced keys (port of #1: history_address_{wallet}, gdex_...). */
  function addrKey(id, a, c) {
    return "gw_addr_" + id + "_" + String(a).toLowerCase() + "_" + String(c).toUpperCase();
  }
  function lastKey(id, a) {
    return "gw_last_" + id + "_" + String(a).toLowerCase();
  }
  function healthKey(id) {
    return "gw_health_" + id;
  }
  /* timedFetch: one fetch with AbortController timeout. Resolves
   * {status, ms, text} for HTTP statuses; throws gateway-down only on
   * network failure / timeout / abort. */
  function timedFetch(url, opts) {
    opts = opts || {};
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, opts.timeoutMs || TIMEOUT_MS);
    var started = Date.now();
    var fetchOpts = { method: opts.method || "GET", signal: controller.signal };
    if (opts.body !== undefined) {
      fetchOpts.headers = { "Content-Type": "application/json" };
      fetchOpts.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
    }
    return fetch(url, fetchOpts).then(function (res) {
      return res.text().then(function (text) {
        clearTimeout(timer);
        return { status: res.status, ms: Date.now() - started, text: text };
      });
    }).catch(function (e) {
      clearTimeout(timer);
      throw namedError("gateway-down", String((e && e.name) || e));
    });
  }
  function parseJson(text) {
    try {
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  }
  /* rawStr: host ints stay strings — formatting is the view's job via
   * Format (principle #6); this module never divides by a precision. */
  function rawStr(v) {
    if (v === null || v === undefined) return null;
    return String(v);
  }
  function pick(r, a, b) {
    return r[a] !== undefined ? r[a] : r[b];
  }
  /* gdexEnvelope: GDEX POST body envelope (gdexMethods.js:80-131 shape). */
  function gdexEnvelope(extra) {
    var body = { requestChannel: 0, version: "1.0", timestamp: Date.now(), outerChannel: "Bitshares" };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) body[k] = extra[k];
    return body;
  }
  /* normalizeRow: host coin row -> vanilla row. Defensive fallbacks — host
   * names drift; unknowns stay null instead of throwing. */
  function normalizeRow(r) {
    var symbol = r.symbol || r.receive_coin_type || r.outputCoinType || r.coinType;
    if (!symbol) return null;
    return {
      symbol: String(symbol).toUpperCase(), backingCoin: (r.backingCoin || r.deposit_coin_type) ? String(r.backingCoin || r.deposit_coin_type).toUpperCase() : null,
      depositAllowed: r.depositAllowed !== false, withdrawalAllowed: r.withdrawalAllowed !== false,
      precision: r.precision === undefined ? null : Number(r.precision),
      issuer: r.issuer || r.issuerName || null, issuerId: r.issuerId || r.issuer_id || null,
      gatewayWallet: r.gatewayWallet || r.gateway_wallet || null, walletType: r.deposit_wallet_type || r.walletType || r.wallet_type || null,
      minAmountRaw: rawStr(pick(r, "minAmount", "min_amount")), withdrawFeeRaw: rawStr(pick(r, "withdrawFee", "withdraw_fee")), gateFeeRaw: rawStr(pick(r, "gateFee", "gate_fee")),
      memoSupport: r.memoSupport !== undefined ? !!r.memoSupport : true
    };
  }
  /* Heterogeneous coin-list body -> normalized rows (bare array or {coins,data,list} envelope). Returns: rows, or null (caller falls through to the next source). */
  function normalizeList(data) {
    var arr = Array.isArray(data) ? data : data && (data.coins || data.data || data.list);
    if (!Array.isArray(arr)) return null;
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var row = normalizeRow(arr[i]);
      if (row) out.push(row);
    }
    return out;
  }
  /* listOk: accept a 2xx coin-list response or return null (caller falls
   * through). Records the winning method for the parity note. */
  function listOk(id, r, method) {
    var rows = r.status >= 200 && r.status < 300 ? normalizeList(parseJson(r.text)) : null;
    if (!rows) return null;
    cacheSet("gw_list_" + id, { method: method, count: rows.length });
    return rows;
  }
  /* xbtsxList: ambiguity-A procedure — POST-first (code shape per
   * XbtsxMethods.js:5-15) with GET-fallback (live probe: POST 404s, GET
   * 200s). Winner recorded in gw_list_XBTSX. */
  function xbtsxList() {
    return timedFetch(XBTSX_BASE + "/coin", { method: "POST", body: {} }).then(function (r) {
      var rows = listOk("XBTSX", r, "POST");
      if (rows) return rows;
      return timedFetch(XBTSX_BASE + "/coin").then(function (g) {
        var grows = listOk("XBTSX", g, "GET");
        if (!grows) throw namedError("gateway-rejected", "XBTSX coin list HTTP " + g.status);
        return grows;
      });
    });
  }
  /* IOB coin list via GET /coins (2xx + rows, else gateway-rejected). Returns: Promise of rows. */
  function iobList() {
    return timedFetch(IOB_BASE + "/coins").then(function (r) {
      var rows = listOk("IOB", r, "GET");
      if (!rows) throw namedError("gateway-rejected", "IOB coin list HTTP " + r.status);
      return rows;
    });
  }
  /* GDEX asset list via POST assetList (code 0 wins), GET-fallback on failure. Disabled adapters throw before any fetch. Returns: Promise of rows. */
  function gdexList() {
    assertEnabled("GDEX");
    return timedFetch(GDEX_BASE + "/gateway/asset/assetList", { method: "POST", body: gdexEnvelope() }).then(function (r) {
      var body = parseJson(r.text);
      var rows = r.status >= 200 && r.status < 300 && body && body.code === 0 ? normalizeList(body) : null;
      if (rows) {
        cacheSet("gw_list_GDEX", { method: "POST", count: rows.length });
        return rows;
      }
      return timedFetch(GDEX2_BASE + "/coins").then(function (g) {
        var grows = listOk("GDEX", g, "GET-fallback");
        if (!grows) throw namedError("gateway-rejected", "GDEX coin list unreachable");
        return grows;
      });
    });
  }
  var REGISTRY = [
    { id: "XBTSX", name: "XBTS Native Chains", landing: "https://xbts.io/", wallet: "https://ex.xbts.io/", enabled: true, reason: null },
    { id: "IOB", name: "ioxbank", landing: "https://ioxbank.com", wallet: "https://dex.iobanker.com/", enabled: true, reason: null },
    { id: "GDEX", name: "GDEX", landing: "https://bitsharestalk.org/index.php?topic=33861", wallet: "Only manual deposit / withdraw", enabled: false, reason: "API unreachable from last probe — manual deposit/withdraw only (per the gateway's own status in #1)" },
    { id: "BIT20", name: "BIT20", landing: null, wallet: null, enabled: false, reason: "no public deposit API discovered — discovery procedure pending (see parity note)" }
  ];
  function entry(id) {
    for (var i = 0; i < REGISTRY.length; i++) if (REGISTRY[i].id === id) return REGISTRY[i];
    return null;
  }
  /* assertEnabled: disabled adapters throw before any fetch (BIT20 never
   * fetched until ambiguity-B discovery proves a host; GDEX only after a
   * 200 re-probe flips it in health()). */
  function assertEnabled(id) {
    var e = entry(id);
    if (!e) throw namedError("unknown-gateway", id);
    if (!e.enabled) throw namedError("disabled", e.reason || id);
    return e;
  }
  function findRow(rows, coin) {
    var want = String(coin).toUpperCase();
    for (var i = 0; i < rows.length; i++) if (rows[i].symbol === want) return rows[i];
    return null;
  }
  /* rowFor: live coin row for a symbol, or a bad-coin throw. Withdraw
   * accounts come from these LIVE rows, never hardcoded (ambiguity E). */
  function rowFor(fetcher, coin) {
    return fetcher().then(function (rows) {
      var row = findRow(rows, coin);
      if (!row) throw namedError("bad-coin", coin);
      return row;
    });
  }
  /* mapDepositResponse: success carries inputAddress (+optional inputMemo);
   * host {error} or an empty body becomes gateway-rejected with the VERBATIM
   * host message (never a forged address). */
  function mapDepositResponse(body, status) {
    if (body && body.error) throw namedError("gateway-rejected", String(body.error));
    var address = body && (body.inputAddress || body.address);
    if (!address) throw namedError("gateway-rejected", "empty deposit response HTTP " + status);
    var memo = body.inputMemo || body.memo;
    return { address: String(address), memo: memo ? String(memo) : null };
  }
  /* Cache a deposit address + last-coin marker. Params: gateway id, account, coin, res ({address, memo}). Returns: {address, memo, cached:false}. */
  function storeDeposit(id, account, coin, res) {
    cacheSet(addrKey(id, account, coin), res);
    cacheSet(lastKey(id, account), { coin: String(coin).toUpperCase(), at: Date.now() });
    return { address: res.address, memo: res.memo, cached: false };
  }
  /* XBTSX deposit address for (account, coin): live row -> wallet-type endpoint, GET-fallback per ambiguity A. Returns: Promise of the storeDeposit shape. */
  function xbtsxDeposit(account, coin) {
    return rowFor(xbtsxList, coin).then(function (row) {
      if (!row.walletType) throw namedError("unproven", "no walletType in XBTSX row for " + coin);
      var url = XBTSX_BASE + "/wallets/" + encodeURIComponent(row.walletType) + "/new-deposit-address";
      var body = { inputCoinType: row.backingCoin || row.symbol, outputCoinType: row.symbol, outputAddress: account };
      return timedFetch(url, { method: "POST", body: body }).then(function (r) {
        if (r.status >= 200 && r.status < 300) return r;
        var q = "?inputCoinType=" + encodeURIComponent(body.inputCoinType) + "&outputCoinType=" + encodeURIComponent(body.outputCoinType) + "&outputAddress=" + encodeURIComponent(account);
        return timedFetch(url + q); // GET-fallback per ambiguity A
      }).then(function (done) {
        return storeDeposit("XBTSX", account, row.symbol, mapDepositResponse(parseJson(done.text), done.status));
      });
    });
  }
  function iobDeposit(account, coin) {
    return rowFor(iobList, coin).then(function (row) {
      var body = { inputCoinType: row.backingCoin || row.symbol, outputCoinType: row.symbol, outputAddress: account, inputMemo: "" };
      return timedFetch(IOB_BASE + "/simple-api/initiate-trade", { method: "POST", body: body }).then(function (r) {
        return storeDeposit("IOB", account, row.symbol, mapDepositResponse(parseJson(r.text), r.status));
      });
    });
  }
  /* GDEX deposit address for (account, coin) via getAddress (code 0 + VERBATIM host errors). Asserts enabled first. Returns: Promise of the storeDeposit shape. */
  function gdexDeposit(account, coin) {
    assertEnabled("GDEX");
    return rowFor(gdexList, coin).then(function (row) {
      return timedFetch(GDEX_BASE + "/gateway/address/getAddress", {
        method: "POST", body: gdexEnvelope({ account: account, coin: row.symbol })
      }).then(function (r) {
        var parsed = parseJson(r.text);
        if (!parsed || parsed.code !== 0) throw namedError("gateway-rejected", parsed && parsed.msg ? String(parsed.msg) : "GDEX getAddress HTTP " + r.status);
        return storeDeposit("GDEX", account, row.symbol, mapDepositResponse(parsed.data || parsed, r.status));
      });
    });
  }
  /* probeList: health check for one list endpoint — 2xx + parseable rows
   * is ok, anything else is a reason. Never throws. */
  function probeList(url, opts, label) {
    return timedFetch(url, opts).then(function (r) {
      var rows = r.status >= 200 && r.status < 300 ? normalizeList(parseJson(r.text)) : null;
      return rows
        ? { ok: true, ms: r.ms, status: r.status, at: Date.now() }
        : { ok: false, status: r.status, ms: r.ms, reason: "unexpected " + label + " coin list HTTP " + r.status, at: Date.now() };
    });
  }
  var api = {
    /* list: static registry + live enabled flags + cached health times. */
    list: function () {
      return REGISTRY.map(function (e) {
        var h = cacheGet(healthKey(e.id));
        return { id: e.id, name: e.name, landing: e.landing, wallet: e.wallet, enabled: e.enabled, reason: e.reason, healthCachedAt: h ? h.at : null };
      });
    },
    /* health: one fetch per adapter, 10s timeout. NEVER throws — every
     * failure returns {ok:false, reason, at}. Fresh cache (<15 min) wins
     * unless {force:true} (views' Retry). A GDEX 200 flips it enabled
     * (ambiguity D); BIT20 is never fetched (ambiguity B). */
    health: function (id, opts) {
      var e = entry(id);
      if (!e) return Promise.resolve({ ok: false, reason: "unknown-gateway: " + id, at: Date.now() });
      var cached = cacheGet(healthKey(id));
      if (cached && !((opts || {}).force) && Date.now() - cached.at < HEALTH_STALE_MS) return Promise.resolve(cached.data);
      var job;
      if (id === "BIT20") job = Promise.resolve({ ok: false, reason: "disabled: " + (e.reason || id), at: Date.now() });
      else if (id === "XBTSX") job = probeList(XBTSX_BASE + "/coin", null, "XBTSX");
      else if (id === "IOB") job = probeList(IOB_BASE + "/coins", null, "IOB");
      else if (id === "GDEX") {
        job = timedFetch(GDEX_BASE + "/gateway/asset/assetList", { method: "POST", body: gdexEnvelope() }).then(function (r) {
          var body = parseJson(r.text);
          if (r.status >= 200 && r.status < 300 && body && body.code === 0) return { ok: true, ms: r.ms, status: r.status, at: Date.now() };
          return probeList(GDEX2_BASE + "/coins", null, "GDEX");
        });
      } else job = Promise.resolve({ ok: false, reason: "unknown-gateway: " + id, at: Date.now() });
      return job.catch(function (err) {
        return { ok: false, reason: String((err && err.message) || err), at: Date.now() };
      }).then(function (res) {
        if (id === "GDEX" && res.ok) {
          e.enabled = true;
          e.reason = null;
        }
        cacheSet(healthKey(id), res);
        return res;
      });
    },
    /* coins: normalized rows; raw ints stay raw strings for Format. */
    coins: function (id) {
      if (id === "XBTSX") return xbtsxList();
      if (id === "IOB") return iobList();
      if (id === "GDEX") return gdexList();
      if (id === "BIT20") return Promise.reject(namedError("disabled", entry("BIT20").reason));
      return Promise.reject(namedError("unknown-gateway", id));
    },
    /* depositAddress: {address, memo, cached}. Empty account throws
     * bad-account BEFORE any fetch; cache hits return cached:true without
     * minting a new address; successes cached per Reference #9. */
    depositAddress: function (id, params) {
      params = params || {};
      var account = String(params.account || "").trim();
      var coin = String(params.coin || "").trim();
      if (!account) return Promise.reject(namedError("bad-account", "output account name required"));
      if (!coin) return Promise.reject(namedError("bad-coin", "coin required"));
      var hit = cacheGet(addrKey(id, account, coin));
      if (hit) return Promise.resolve({ address: hit.data.address, memo: hit.data.memo, cached: true });
      if (id === "XBTSX") return xbtsxDeposit(account, coin);
      if (id === "IOB") return iobDeposit(account, coin);
      if (id === "GDEX") return gdexDeposit(account, coin);
      if (id === "BIT20") return Promise.reject(namedError("disabled", entry("BIT20").reason));
      return Promise.reject(namedError("unknown-gateway", id));
    },
    /* validateWithdrawAddress: thin passthrough of host check-address
     * shapes where one exists; host down -> named error, never a block. */
    validateWithdrawAddress: function (id, params) {
      params = params || {};
      var address = String(params.address || "").trim();
      if (!address) return Promise.reject(namedError("bad-account", "address required"));
      if (id === "XBTSX") {
        if (!params.walletType) return Promise.reject(namedError("unproven", "walletType required"));
        return timedFetch(XBTSX_BASE + "/wallets/" + encodeURIComponent(params.walletType) + "/check-address", {
          method: "POST", body: { address: address }
        }).then(function (r) {
          var body = parseJson(r.text);
          if (!body || r.status < 200 || r.status >= 300) throw namedError("gateway-rejected", "XBTSX check-address HTTP " + r.status);
          return { valid: !!body.isValid, raw: body };
        });
      }
      if (id === "GDEX") {
        assertEnabled("GDEX");
        return timedFetch(GDEX_BASE + "/gateway/address/checkAddress", {
          method: "POST", body: gdexEnvelope({ address: address })
        }).then(function (r) {
          var body = parseJson(r.text);
          if (!body || body.code !== 0) throw namedError("gateway-rejected", "GDEX checkAddress HTTP " + r.status);
          return { valid: true, raw: body };
        });
      }
      if (id === "IOB" || id === "BIT20") return Promise.reject(namedError("unproven", "no host validate shape for " + id));
      return Promise.reject(namedError("unknown-gateway", id));
    },
    /* withdrawPrefill: issuer/intermediate account + memo prefix from the
     * LIVE coin row (ambiguity E — never hardcoded). Returns data for the
     * slice-4 form; no signing, no broadcast. */
    withdrawPrefill: function (id, coinSymbol) {
      return api.coins(id).then(function (rows) {
        var row = findRow(rows, coinSymbol || "");
        if (!row) throw namedError("bad-coin", coinSymbol);
        var to = row.gatewayWallet || row.issuer;
        if (!to) throw namedError("unproven", "no withdraw account in coin row for " + row.symbol);
        var prefix = id === "XBTSX" ? (row.backingCoin || row.symbol) + ":" : id === "IOB" ? "dex:" : "";
        return { to: to, memoPrefix: prefix, assetSymbol: row.symbol, note: "gateway-stated withdraw target from live coin list" };
      });
    },
    cacheGet: cacheGet,
    cacheSet: cacheSet
  };
  return api;
})();

if (typeof module !== "undefined" && module.exports) module.exports = Gateway;
