/* Account: read-only account data layer (resolve, balances, history, my-account).
 * Owns: BitShares account lookups and balance joining; no rendering, no signing.
 * Consumes: Chain.db/.history/.call, Format.formatAmount, Wallet.keys/
 *   .isUnlocked/.getBrainkey (in-memory unlocked keys), Crypto.
 *   brainPrivateKeyHex/.keypairFromPrivateHex (active seq1 pub derivation).
 * Globals/side effects: exposes global Account only; no DOM, no storage writes.
 * Created by: building-vanilla-slices skill, slice-03 Task 3.
 */
"use strict";

var Account = (function () {
  var ID_RE = /^1\.2\.\d+$/;
  var FIRST_HISTORY_OP = "1.11.0";

  /* True when the string is an account object id (1.2.N). */
  function _isId(s) {
    return typeof s === "string" && ID_RE.test(s);
  }

  /* Resolve an account name or 1.2.N id to {id, name}.
   * Params: nameOrId non-empty string.
   * Returns: Promise of {id, name}.
   * Fails: "unknown-account" when the node returns null/empty. */
  async function resolve(nameOrId) {
    if (typeof nameOrId !== "string" || !nameOrId) {
      throw new Error("unknown-account");
    }
    var dbId = await Chain.db();
    if (_isId(nameOrId)) {
      var rows = await Chain.call(dbId, "get_accounts", [[nameOrId]]);
      if (!rows || !rows[0]) throw new Error("unknown-account");
      return { id: rows[0].id, name: rows[0].name };
    }
    var acct = await Chain.call(dbId, "get_account_by_name", [nameOrId]);
    if (!acct) throw new Error("unknown-account");
    return { id: acct.id, name: acct.name };
  }

  /* List spendable balances for an account id with human display strings.
   * Params: id account id string ("1.2.N").
   * Returns: Promise of [{asset_id, symbol, precision, raw, display}],
   *   where raw is the integer-amount string and display is
   *   Format.formatAmount(raw, precision). Empty balances yield [].
   * Fails: "bad-asset-shape" when any asset lacks a numeric precision. */
  async function balances(id) {
    var dbId = await Chain.db();
    var rows = await Chain.call(dbId, "get_account_balances", [id, []]);
    if (!rows || rows.length === 0) return [];
    var ids = [];
    var i;
    for (i = 0; i < rows.length; i++) {
      var aid = rows[i].asset_id;
      if (typeof aid === "string") ids.push(aid);
    }
    if (ids.length === 0) return [];
    var assets = await Chain.call(dbId, "get_assets", [ids]);
    var byId = {};
    for (i = 0; i < assets.length; i++) {
      var a = assets[i];
      if (!a) continue;
      if (typeof a.precision !== "number") throw new Error("bad-asset-shape");
      byId[a.id] = a;
    }
    var out = [];
    for (i = 0; i < rows.length; i++) {
      var e = rows[i];
      var assetId = e.asset_id;
      var meta = byId[assetId];
      if (!meta) throw new Error("bad-asset-shape");
      if (typeof meta.precision !== "number") throw new Error("bad-asset-shape");
      var raw = String(e.amount !== undefined ? e.amount : e.balance);
      out.push({
        asset_id: assetId,
        symbol: meta.symbol,
        precision: meta.precision,
        raw: raw,
        display: Format.formatAmount(raw, meta.precision)
      });
    }
    return out;
  }

  /* Fetch raw operation history for an account id (newest first, opaque rows).
   * Params: id account id string; limit positive int (default 20).
   * Returns: Promise of the raw get_account_history array.
   * Fails: "history-unavailable" when the history plugin/api is missing. */
  async function history(id, limit) {
    if (limit === undefined) limit = 20;
    var histId;
    try {
      histId = await Chain.history();
    } catch (e) {
      throw new Error("history-unavailable");
    }
    var rows;
    try {
      rows = await Chain.call(histId, "get_account_history", [id, FIRST_HISTORY_OP, limit, FIRST_HISTORY_OP]);
    } catch (e) {
      throw new Error("history-unavailable");
    }
    return rows;
  }

  /* Return the account id bound to the unlocked wallet's active (seq1) key.
   * Params: none (reads Wallet in-memory keys + brainkey).
   * Returns: Promise of the account id string.
   * Fails: "wallet-locked" unless unlocked; "no-account" when the active
   *   pub has no key reference on chain. */
  async function myAccountId() {
    var unlocked = typeof Wallet.isUnlocked === "function" ? Wallet.isUnlocked() : !!Wallet.keys;
    if (!unlocked || !Wallet.keys) throw new Error("wallet-locked");
    var brainkey = Wallet.getBrainkey();
    var privHex = await Crypto.brainPrivateKeyHex(brainkey, 1);
    var kp = await Crypto.keypairFromPrivateHex(privHex);
    var dbId = await Chain.db();
    var refs = await Chain.call(dbId, "get_key_references", [[kp.pub]]);
    if (refs && refs[0] && refs[0][0]) return refs[0][0];
    throw new Error("no-account");
  }

  /* List open limit orders for ANY account id — public chain data, no wallet
   * needed (mirrors #1, where only cancel requires ownership).
   * Params: id account id string ("1.2.N").
   * Returns: Promise of [{id, expiration, sell:{...}, buy:{...}, priceDisplay}]
   *   with human display strings (base-per-quote, Format helpers). Empty book
   *   yields [] (renders an empty state downstream, never throws). */
  async function openOrders(id) {
    var dbId = await Chain.db();
    var rows = await Chain.call(dbId, "get_limit_orders_by_account", [id, 100]);
    if (!rows || rows.length === 0) return [];
    var ids = {}, i, sp;
    for (i = 0; i < rows.length; i++) {
      sp = rows[i].sell_price || {};
      if (sp.base && sp.base.asset_id) ids[sp.base.asset_id] = 1;
      if (sp.quote && sp.quote.asset_id) ids[sp.quote.asset_id] = 1;
    }
    var assets = await Chain.call(dbId, "get_assets", [Object.keys(ids)]);
    var byId = {};
    for (i = 0; i < assets.length; i++) {
      var a = assets[i];
      if (!a) continue;
      if (typeof a.precision !== "number") throw new Error("bad-asset-shape");
      byId[a.id] = a;
    }
    function leg(side) {
      var meta = byId[side.asset_id];
      if (!meta || typeof meta.precision !== "number") throw new Error("bad-asset-shape");
      var raw = String(side.amount);
      return {asset_id: side.asset_id, symbol: meta.symbol, precision: meta.precision,
        raw: raw, display: Format.formatAmount(raw, meta.precision)};
    }
    var out = [];
    for (i = 0; i < rows.length; i++) {
      var sell = leg(rows[i].sell_price.base), buy = leg(rows[i].sell_price.quote);
      out.push({id: rows[i].id, expiration: rows[i].expiration, sell: sell, buy: buy,
        priceDisplay: Format.formatPrice(sell.raw, sell.precision, buy.raw, buy.precision, 8)});
    }
    return out;
  }

  return {
    resolve: resolve,
    balances: balances,
    history: history,
    openOrders: openOrders,
    myAccountId: myAccountId
  };
})();

if (typeof module !== "undefined") { module.exports = Account; }
