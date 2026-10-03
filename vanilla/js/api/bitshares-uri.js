/* BitsharesURI: BSIP-0060 bitshares: URI parser + opener (deep links / QR codes).
 * Owns: pure parse(uri) of the bitshares: scheme into vanilla routes, plus
 *   async open(uri) which navigates via location.hash (never auto-executes:
 *   transfer only pre-fills #/invoice?…; signing stays user-gated).
 * Consumes: Explorer.resolveTxHash (transaction kind ONLY, looked up lazily
 *   off globalThis so Node tests run without it — never duplicated here).
 * Globals/side effects: exposes global BitsharesURI; writes location.hash on
 *   open() success only (no location under Node = hash returned, not set).
 * Created by: building-vanilla-slices skill, bitshares-uri plan (ADAPT survey).
 * Chain truth (#4 wins): BSIP-0060 path/param grammar
 *   (https://raw.githubusercontent.com/bitshares/bsips/master/bsip-0060.md,
 *   Specifications: Protocol/Paths/Params + Discussion shortening table);
 *   op id 0 = transfer (operations.hpp FC_REFLECT order, same order as
 *   Explorer OP_NAMES); ripemd160 tx ids are 40 hex (protocol/types.hpp:304,
 *   same shape as Explorer TXHASH_RE — 1-line regex, not a copy of logic).
 * Money discipline (#6): amount stays a HUMAN decimal string end to end —
 *   never parsed, never Math.pow'd, never converted here. The invoice view
 *   validates it against the asset precision at pay time.
 */
var BitsharesURI = (function () {
  "use strict";

  /* Short path_type aliases (BSIP-0060 Discussion shortening table — the only
   * shorts the BSIP names; account/asset/market have no short form). */
  var SHORT_TYPES = { ob: "object", op: "operation", bl: "block", trx: "transaction" };

  /* Numeric operation ids accepted in operation/<id> position. Only transfer
   * (id 0) has a vanilla route; every other id errors as unsupported (the BSIP
   * operation_path BNF lists the full enum, we deliberately cover one). */
  var OP_IDS = { 0: "transfer" };

  /* Transfer query keys in the invoice-worker contract (fixed order). */
  var TRANSFER_KEYS = ["to", "asset", "amount", "memo", "fee_asset"];

  var ACCOUNT_ID_RE = /^1\.2\.\d+$/;
  var ACCOUNT_NAME_RE = /^[a-z]([a-z0-9-]*[a-z0-9])?(\.[a-z]([a-z0-9-]*[a-z0-9])?)*$/;
  var ASSET_ID_RE = /^1\.3\.\d+$/;
  var ASSET_SYMBOL_RE = /^[A-Z][A-Z0-9]*(\.[A-Z][A-Z0-9]*)*$/;
  var TXHASH_RE = /^[0-9a-fA-F]{40}$/;
  var UINT_RE = /^\d+$/;

  /**
   * Build an honest error result (never throws outward — module rule).
   * @param {string} code machine key (stable — tests assert it, never changed).
   * @param {string} message English template (%(n)s-style vars, dicts mint
   *   `uri.error_<code><suffix>` — suffix only where one code carries
   *   several defaults).
   * @param {any} [vars] interpolation vars (optional).
   * @param {string} [suffix] key suffix for ambiguous codes (optional).
   * @returns {any} {error, message}.
   */
  function err(code, message, vars, suffix) {
    var key = "uri.error_" + code + (suffix || "");
    return { error: code, message: tt(key, message, vars) };
  }

  /* Local t(): I18n-guarded with %(name)s interpolation (borrow-ui.js:50
   * precedent). Falls back to the English template when i18n is absent —
   * unit tests asserting messages keep passing un-minted. Never throws. */
  function tt(key, dflt, vars) {
    var s = dflt;
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") {
        var probe = I18n.t(key, dflt, vars);
        if (typeof probe === "string") return probe;
      }
    } catch (e) { /* default below */ }
    try {
      if (vars && typeof vars === "object") {
        s = String(s).replace(/%\(([^)]+)\)s/g, function (m, name) {
          return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m;
        });
      }
    } catch (e) { s = dflt; }
    return s;
  }

  /**
   * any-typed globalThis hop (this module adds no ambient declarations, so
   * cross-file seams stay `any` via cast — same shape as Router's _a11yWired).
   * @returns {any} globalThis or {} when absent. Never throws.
   */
  function _globals() {
    try {
      if (typeof globalThis !== "undefined") return /** @type {any} */ (globalThis);
    } catch (e) { /* {} below */ }
    return {};
  }

  /**
   * Validate an account ref (BSIP account_id_or_name: 1.2.x id or dotted
   * lowercase name per the account_path BNF — strict, no case folding).
   * @param {string} s decoded ref.
   * @returns {boolean} true when routable to #/account/.
   */
  function _isAccount(s) {
    return ACCOUNT_ID_RE.test(s) || ACCOUNT_NAME_RE.test(s);
  }

  /**
   * Validate an asset ref (BSIP asset_id_or_symbol: 1.3.x id or dotted
   * uppercase symbol per the asset_path BNF — strict, no case folding).
   * @param {string} s decoded ref.
   * @returns {boolean} true when routable to #/asset/.
   */
  function _isAsset(s) {
    return ASSET_ID_RE.test(s) || ASSET_SYMBOL_RE.test(s);
  }

  /**
   * Percent-decode one URI part, strict.
   * @param {string} s raw part.
   * @returns {{ok:boolean, value:string}} decoded or {ok:false} on bad %.
   */
  function _decode(s) {
    try {
      return { ok: true, value: decodeURIComponent(s) };
    } catch (e) {
      return { ok: false, value: s };
    }
  }

  /**
   * Parse the transfer query string into the invoice contract record.
   * Rules (contract §): keys must be exactly to/asset/amount/memo/fee_asset
   * (anything else, incl. BSIP extended amount[x] syntax, is unknown-param);
   * duplicates last-win; empty parts skipped; non-empty to/asset/fee_asset
   * re-validated as account/asset refs; amount/memo pass through untouched.
   * @param {string} qs raw query (no leading "?").
   * @returns {any} {to,asset,amount,memo,fee_asset?} or {error,message}.
   */
  function _parseTransferQuery(qs) {
    var out = { to: "", asset: "", amount: "", memo: "" };
    var seenFee = false, fee = "";
    if (!qs) return out;
    var parts = qs.split("&");
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (!part) continue;
      var eq = part.indexOf("=");
      var rk = eq === -1 ? part : part.slice(0, eq);
      var rv = eq === -1 ? "" : part.slice(eq + 1);
      var dk = _decode(rk), dv = _decode(rv);
      if (!dk.ok || !dv.ok) {
        return err("bad-encoding", "This transfer link has a broken % escape and cannot be parsed.", null, "-transfer");
      }
      var k = dk.value;
      if (k !== "to" && k !== "asset" && k !== "amount" && k !== "memo" && k !== "fee_asset") {
        return err("unknown-param", "This transfer link carries an unsupported field “%(n)s”. Supported: to, asset, amount, memo, fee_asset.", { n: k });
      }
      if (k === "fee_asset") { seenFee = true; fee = dv.value; } else { out[k] = dv.value; }
    }
    if (out.to && !_isAccount(out.to)) {
      return err("bad-account", "This transfer link names an invalid account “%(n)s”.", { n: out.to }, "-transfer");
    }
    if (out.asset && !_isAsset(out.asset)) {
      return err("bad-asset", "This transfer link names an invalid asset “%(n)s”.", { n: out.asset }, "-transfer");
    }
    if (seenFee) {
      if (!fee) return err("bad-asset", "This transfer link names an invalid fee asset.", null, "-fee");
      if (!_isAsset(fee)) {
        return err("bad-asset", "This transfer link names an invalid fee asset “%(n)s”.", { n: fee }, "-fee-named");
      }
      out.fee_asset = fee;
    }
    return out;
  }

  /**
   * Pure BSIP-0060 parse: bitshares: URI -> vanilla route record or error.
   * Kinds: account {name}, asset {symbol}, market {base, quote} (URI order is
   * base/quote per contract; the route flips to QUOTE_BASE), transfer
   * {to,asset,amount,memo,fee_asset?}, block {height,txIndex|null},
   * transaction {hash} (lowercased). Errors: {error,message} with English
   * literals (keys to mint: uri.error_<code> — reported, never written here).
   * Never throws outward, never touches location, never executes anything.
   * @param {any} uri candidate URI string.
   * @returns {any} route record or {error,message}.
   */
  function parse(uri) {
    try {
      return _parse(uri);
    } catch (e) {
      return err("bad-uri", "This BitShares link cannot be parsed.");
    }
  }

  /**
   * Inner parse (may throw URIError on pathological input — parse() guards).
   * @param {any} uri candidate URI string.
   * @returns {any} route record or {error,message}.
   */
  function _parse(uri) {
    if (typeof uri !== "string") return err("empty-uri", "No BitShares link was given.");
    var s = uri.trim();
    if (!s) return err("empty-uri", "No BitShares link was given.");
    var m = /^bitshares:/i.exec(s);
    if (!m) return err("bad-scheme", "Not a BitShares link (expected bitshares:…).");
    var rest = s.slice(m[0].length);
    if (rest.slice(0, 2) === "//") rest = rest.slice(2);
    var qi = rest.indexOf("?");
    var pathPart = qi === -1 ? rest : rest.slice(0, qi);
    var qs = qi === -1 ? "" : rest.slice(qi + 1);
    var rawSegs = pathPart.split("/");
    var segs = [];
    for (var i = 0; i < rawSegs.length; i++) {
      var d = _decode(rawSegs[i]);
      if (!d.ok) return err("bad-encoding", "This BitShares link has a broken % escape and cannot be parsed.");
      segs.push(d.value);
    }
    /* Forgive one trailing slash (paste artifact); interior empties are bad. */
    if (segs.length > 1 && segs[segs.length - 1] === "") segs.pop();
    if (segs.length < 1 || !segs[0]) {
      return {
        error: "unknown-type",
        message: tt("uri.error_unknown-type", "This BitShares link has no type.") + " " +
          tt("uri.error_supported-list", "Supported: account, asset, market, operation/transfer, block, transaction.") + " " + supportedShort()
      };
    }
    var type = segs[0].toLowerCase();
    if (Object.prototype.hasOwnProperty.call(SHORT_TYPES, type)) type = SHORT_TYPES[type];
    var tail = segs.slice(1);
    for (var t = 0; t < tail.length; t++) {
      if (!tail[t]) return err("unsupported-path", "This BitShares link has an empty path segment and cannot be parsed.", null, "-empty");
    }
    if (type === "account") {
      if (tail.length !== 1) return err("unsupported-path", "Account links look like bitshares:account/<name>.", null, "-account");
      if (!_isAccount(tail[0])) return err("bad-account", "This link names an invalid account “%(n)s”.", { n: tail[0] });
      return { kind: "account", name: tail[0] };
    }
    if (type === "asset") {
      if (tail.length !== 1) return err("unsupported-path", "Asset links look like bitshares:asset/<symbol>.", null, "-asset");
      if (!_isAsset(tail[0])) return err("bad-asset", "This link names an invalid asset “%(n)s”.", { n: tail[0] });
      return { kind: "asset", symbol: tail[0] };
    }
    if (type === "market") {
      var pair = null;
      if (tail.length === 2) pair = [tail[0], tail[1]];
      else if (tail.length === 1 && tail[0].indexOf("_") !== -1) {
        var us = tail[0].split("_");
        if (us.length === 2 && us[0] && us[1]) pair = [us[0], us[1]];
      }
      if (!pair) return err("bad-market", "Market links look like bitshares:market/<base>/<quote>.");
      if (!_isAsset(pair[0]) || !_isAsset(pair[1])) {
        return err("bad-market", "This link names an invalid market “%(a)s/%(b)s”.", { a: pair[0], b: pair[1] }, "-pair");
      }
      if (pair[0].toUpperCase() === pair[1].toUpperCase()) {
        return err("bad-market", "This link names a market with the same asset twice.", null, "-same");
      }
      return { kind: "market", base: pair[0], quote: pair[1] };
    }
    if (type === "operation") {
      if (tail.length !== 1) return err("unsupported-path", "Operation links look like bitshares:operation/transfer?….", null, "-operation");
      var opName = tail[0].toLowerCase();
      if (Object.prototype.hasOwnProperty.call(OP_IDS, opName)) opName = OP_IDS[/** @type {any} */ (opName)];
      if (opName !== "transfer") {
        return err("unknown-operation", "Only transfer links are supported (“%(n)s” is not).", { n: tail[0] });
      }
      var q = _parseTransferQuery(qs);
      if (q && q.error) return q;
      return { kind: "transfer", to: q.to, asset: q.asset, amount: q.amount, memo: q.memo,
        fee_asset: q.fee_asset };
    }
    if (type === "block") {
      if (tail.length < 1 || tail.length > 2) {
        return err("unsupported-path", "Block links look like bitshares:block/<number>.", null, "-block");
      }
      if (!UINT_RE.test(tail[0])) return err("bad-block", "This link names an invalid block “%(n)s”.", { n: tail[0] });
      var h = parseInt(tail[0], 10);
      if (!(h >= 1)) return err("bad-block", "This link names an invalid block “%(n)s”.", { n: tail[0] });
      var txIndex = null;
      if (tail.length === 2) {
        if (!UINT_RE.test(tail[1])) return err("bad-block", "This link names an invalid transaction index “%(n)s”.", { n: tail[1] }, "-index");
        txIndex = parseInt(tail[1], 10);
      }
      return { kind: "block", height: h, txIndex: txIndex };
    }
    if (type === "transaction") {
      if (tail.length !== 1) return err("unsupported-path", "Transaction links look like bitshares:transaction/<hash>.", null, "-transaction");
      if (!TXHASH_RE.test(tail[0])) {
        return err("bad-hash", "This link carries an invalid transaction hash (40 hex characters).");
      }
      return { kind: "transaction", hash: tail[0].toLowerCase() };
    }
    if (type === "object" || type === "public_key" || type === "blind_receipt") {
      /* Keyed prefix + raw supported-list glue (the list is data, never
       * translated — same split as histInfo parens in settings-nodes). */
      return {
        error: "unsupported-type",
        message: tt("uri.error_unsupported-type", "This BitShares link type (“%(n)s”) is recognized but not supported yet.", { n: segs[0] }) + " " + supportedShort()
      };
    }
    return {
      error: "unknown-type",
      message: (function () {
        var got = segs[0] || "";
        var pre = got
          ? tt("uri.error_unknown-type-named", "Unsupported link type “%(n)s”.", { n: got })
          : tt("uri.error_unknown-type", "This BitShares link has no type.");
        return pre + " " + tt("uri.error_supported-list", "Supported: account, asset, market, operation/transfer, block, transaction.") + " " + supportedShort();
      })()
    };
  }

  /**
   * Short-alias sentence shared by type errors (data fragment, appended raw
   * after the keyed prefix — same split as histInfo parens in settings).
   * @returns {string} message fragment.
   */
  function supportedShort() {
    return "Short forms ob/op/bl/trx work too (op/0 means transfer).";
  }

  /**
   * Build the #/invoice? hash for a transfer record (pure, URL-encoded;
   * amount passes through untouched — HUMAN string, never converted).
   * Canonical key order to/asset/amount/memo, fee_asset appended when set.
   * @param {any} t transfer record ({to,asset,amount,memo,fee_asset?}).
   * @returns {string} "#/invoice?…" hash.
   */
  function transferHash(t) {
    var rec = t || {};
    var pairs = [["to", rec.to || ""], ["asset", rec.asset || ""],
      ["amount", rec.amount || ""], ["memo", rec.memo || ""]];
    if (rec.fee_asset) pairs.push(["fee_asset", rec.fee_asset]);
    var parts = pairs.map(function (p) {
      return encodeURIComponent(p[0]) + "=" + encodeURIComponent(p[1]);
    });
    return "#/invoice?" + parts.join("&");
  }

  /**
   * Route target hash for non-transaction kinds (pure — open() sets it).
   * Market flips URI base/quote order into the QUOTE_BASE route id
   * (Market.parseId: quote = head); symbols uppercased like homeTarget ids.
   * @param {any} r parse-ok record (not transaction).
   * @returns {string} location.hash target.
   */
  function _targetHash(r) {
    if (r.kind === "account") return "#/account/" + encodeURIComponent(r.name);
    if (r.kind === "asset") return "#/asset/" + encodeURIComponent(r.symbol);
    if (r.kind === "market") {
      return "#/market/" + encodeURIComponent(String(r.quote).toUpperCase()) +
        "_" + encodeURIComponent(String(r.base).toUpperCase());
    }
    if (r.kind === "block") {
      var h = "#/block/" + String(r.height);
      if (r.txIndex !== null && r.txIndex !== undefined) h += "/" + String(r.txIndex);
      return h;
    }
    return transferHash(r);
  }

  /**
   * Set location.hash when a location exists (browser). No-op under Node.
   * @param {string} hash target including "#".
   * @returns {boolean} true when set. Never throws.
   */
  function _setHash(hash) {
    try {
      if (typeof window !== "undefined" && window && window.location) {
        window.location.hash = hash;
        return true;
      }
      if (typeof location !== "undefined" && location) {
        location.hash = hash;
        return true;
      }
    } catch (e) { /* unset below */ }
    return false;
  }

  /* Location-less tx handoff for the explorer view (consume-once): set when
   * open() resolves a hash via WS with no block context to deep-link to. */
  var _pendingTx = null;

  /**
   * Take (and clear) the pending location-less transaction, if any.
   * @returns {any} {hash, tx} or null. Never throws.
   */
  function takePendingTx() {
    var t = _pendingTx;
    _pendingTx = null;
    return t;
  }

  /**
   * Open a bitshares: URI: parse, then navigate via location.hash.
   * Read-only kinds navigate synchronously; transfer navigates to the
   * pre-filled #/invoice?… hash (never signs, never broadcasts — the invoice
   * view owns the form and the user gates signing); transaction resolves via
   * Explorer.resolveTxHash first (REUSED, never duplicated): block context ->
   * #/block/:h/:ix deep link, location-less WS tx -> #/explorer with the tx
   * stashed for takePendingTx(), miss/offline -> honest {error} with NO nav.
   * Always async (Promise); never throws outward, never navigates on error.
   * @param {any} uri candidate URI string.
   * @returns {Promise<any>} outcome record ({kind,hash,…} or {error,message}).
   */
  async function open(uri) {
    var r;
    try {
      r = _parse(uri);
    } catch (e) {
      return err("bad-uri", "This BitShares link cannot be parsed.");
    }
    if (r && r.error) return r;
    try {
      if (r.kind === "transaction") return await _openTransaction(r);
      var hash = _targetHash(r);
      _setHash(hash);
      r.hash = hash;
      return r;
    } catch (e) {
      return err("bad-uri", "This BitShares link cannot be parsed.");
    }
  }

  /**
   * Transaction-kind open (the ONLY async branch): reuse the explorer submit
   * path's resolver (explorer-ui.js submit txhash branch -> resolveTxHash).
   * @param {any} r {kind:"transaction", hash} (lowercased 40-hex).
   * @returns {Promise<any>} outcome (navigates only on resolvable states).
   */
  async function _openTransaction(r) {
    var g = _globals();
    var explorer = (g && g.Explorer) ? g.Explorer : null;
    if (!explorer || typeof explorer.resolveTxHash !== "function") {
      return err("unavailable", "Transaction lookup is unavailable right now.");
    }
    var res;
    try {
      res = await explorer.resolveTxHash(r.hash);
    } catch (e) {
      return err("unavailable", "Transaction lookup is unavailable right now.");
    }
    if (res && res.status === "block") {
      var hash = "#/block/" + String(res.block) + "/" + String(res.index);
      _setHash(hash);
      return { kind: "transaction", hash: hash, ref: r.hash, via: "block",
        block: res.block, index: res.index };
    }
    if (res && res.status === "tx" && res.tx) {
      try { _pendingTx = { hash: r.hash, tx: res.tx }; } catch (e) { _pendingTx = null; }
      _setHash("#/explorer");
      return { kind: "transaction", hash: "#/explorer", ref: r.hash, via: "recent",
        pending: true };
    }
    if (res && res.status === "offline") {
      return err("offline", "Network unavailable — the transaction cannot be looked up.");
    }
    return err("not-found", "Transaction not found on this node or the community index.");
  }

  return { parse: parse, open: open, transferHash: transferHash,
    takePendingTx: takePendingTx };
})();

/* Expose the single BitsharesURI global to Node for headless tests (no-op in browsers). */
if (typeof globalThis !== "undefined" && typeof /** @type {any} */ (globalThis).BitsharesURI === "undefined") {
  /** @type {any} */ (globalThis).BitsharesURI = BitsharesURI;
}
if (typeof module !== "undefined") { module.exports = BitsharesURI; }
