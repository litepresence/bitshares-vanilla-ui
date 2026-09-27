/* AssetOps: asset-op builders + percent/ratio helpers + sendAndProve.
 * Owns: pure op-data builders returning [opId, opData] with a
 *   zero-placeholder fee for live fee-fill at confirm time (ops 10/11/12/13/
 *   14/15/19), the hundredths-vs-ratio helper pairs (integer/string math
 *   only), live fee via Tx.fee, and sign+send+prove via Tx.sign (vote-pattern
 *   shape). No DOM, no broadcast strings — publishing lives in the views.
 * Consumes: Asset.describe (buildFeed backing-leg lookup — asset.js loads FIRST;
 *   throws "asset-unavailable" otherwise), Chain.net/.call (send path),
 *   Tx.fee/.sign/.buildTx (never duplicated here), Format.parseAmount (human -> raw ints).
 * Globals/side effects: exposes global AssetOps only; no DOM, storage, or
 *   key material (the WIF passes through sendAndProve opaquely to Tx.sign).
 * Created by: slice-10 audit fix B2 (split from asset.js, behavior-identical; B1: pctHumanToRatio pads "175" -> 1750).
 * CHAIN TRUTH (#4 wins): op-10 fields + symbol3/4/long_symbol tiers +
 *   price_per_kbyte <- asset_ops.hpp:192-226; op-11 + BSIP48 ext <- :351-382;
 *   op-12 (target MUST be market-issued) <- :398-411; op-13 <- :430-439;
 *   op-14 (payer = issuer, price_per_kbyte) <- :485-505; op-15 (never on
 *   MPAs) <- :513-524; op-19 + price_feed = (settlement)(MCR u16)(MSSR u16)
 *   (CER) <- :462-480 + asset.hpp:160-189; hundredths (10000 = 100%) vs
 *   ratio over 1000 (1750 = 175%) <- config.hpp:102-117. Op-data keys mirror
 *   #3 bitshares-api.js :2145-2204 + :2475-2618; CER create placeholder
 *   "1.3.1" <- #1 AssetActions:315 (chain overwrites, re-read-proven).
 * MONEY DISCIPLINE (#6): amounts stay RAW digit strings (parseAmount in, no float);
 *   hundredths + ratios stay RAW ints via the helpers below (views never divide ad-hoc).
 *   FEE RULES: create tier = symbol length, descriptions add price_per_kbyte — both
 *   OBSERVED live via AssetOps.fee, never estimated here. SCOPE: ops 16/17/18 OUT
 *   (slice 13); no memo encryption in v1 (views pass memoOrNull:null).
 * NAMED-ERROR HOMES: not-issuer (update gate, views enforce via describe);
 *   not-market-issued (buildFeed + reserve/feed gates); symbol-taken
 *   (create gate via the lookup pre-check in views).
 */
var AssetOps = (function () {
  "use strict";

  var CORE_ASSET = "1.3.0";
  var CER_QUOTE_PLACEHOLDER = "1.3.1"; /* chain overwrites with the new asset id */
  var PROVE_TIMEOUT_MS = 60000, PROVE_INTERVAL_MS = 2500;
  var PRECISION_MAX = 12;
  var ID_RE = /^\d+\.\d+\.\d+$/;
  var ACCOUNT_RE = /^1\.2\.\d+$/, ASSET_RE = /^1\.3\.\d+$/;
  var SYMBOL_RE = /^[A-Z0-9.]+$/; /* views uppercase before calling */
  var DIGITS_RE = /^\d+$/;

  function _sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
  function _assertId(id, name) {
    if (typeof id !== "string" || !ID_RE.test(id)) throw new Error(name + " must be N.N.N, got: " + JSON.stringify(id));
  }
  function _assertAccountId(id, name) {
    _assertId(id, name);
    if (!ACCOUNT_RE.test(id)) throw new Error(name + " must be 1.2.N, got: " + id);
  }
  function _assertAssetId(id, name) {
    _assertId(id, name);
    if (!ASSET_RE.test(id)) throw new Error(name + " must be 1.3.N, got: " + id);
  }
  /* Raw chain integer: digit string only (never a float). */
  function _assertDigits(raw, name) {
    if (typeof raw !== "string" || !DIGITS_RE.test(raw)) throw new Error(name + " must be a digit string, got: " + JSON.stringify(raw));
  }
  /* U16 wire int (permissions, flags, hundredths, ratios). */
  function _assertU16(n, name) {
    if (!Number.isInteger(n) || n < 0 || n > 0xFFFF) throw new Error(name + " must be u16, got: " + JSON.stringify(n));
  }
  /* Asset precision byte (chain allows 0-12). */
  function _assertPrecision(p, name) {
    if (!Number.isInteger(p) || p < 0 || p > PRECISION_MAX) throw new Error((name || "precision") + " must be 0-12, got: " + JSON.stringify(p));
  }
  function _needFormat() {
    if (typeof Format === "undefined" || !Format.parseAmount) throw new Error("format-unavailable (format.js first)");
  }
  /* Guard: Asset.describe must be loaded (builders resolving symbols need asset reads). Fails "asset-unavailable". */
  function _needReads() {
    if (typeof Asset === "undefined" || !Asset.describe) throw new Error("asset-unavailable (asset.js first)");
  }

  /* "2"/"2.5"/"0.01" -> 200/250/1 hundredths via string math (pct*100, no
   * float). Range 0-100%. Fails on malformed input, >2 decimals, overflow. */
  function pctHumanToHundredths(human) {
    var m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(human).trim());
    if (!m) throw new Error("bad percent (0-100, <=2 decimals): " + JSON.stringify(human));
    var frac = m[2] || "";
    while (frac.length < 2) frac += "0";
    var n = parseInt(((m[1] + frac).replace(/^0+(?=\d)/, "") || "0"), 10);
    if (n < 0 || n > 10000) throw new Error("percent out of range 0-100: " + JSON.stringify(human));
    return n;
  }

  /* 200 -> "2" via string math (the only "/ 100" divider; views use this). */
  function hundredthsToPct(raw) {
    _assertU16(raw, "hundredths");
    var s = String(raw);
    while (s.length < 3) s = "0" + s;
    var head = s.slice(0, -2).replace(/^0+(?=\d)/, ""), tail = s.slice(-2).replace(/0+$/, "");
    return tail ? head + "." + tail : head;
  }

  /* "175"/"175.5" -> 1750/1755 ratio ints via string math (pct*10; ratios
   * step in 0.1%). Integer input pads one trailing zero ("175" -> "1750"),
   * same pad approach as pctHumanToHundredths (B1 fix — the old code
   * concatenated the empty fraction and returned 175). Fails on malformed
   * input or u16 overflow. */
  function pctHumanToRatio(human) {
    var m = /^(\d+)(?:\.(\d))?$/.exec(String(human).trim());
    if (!m) throw new Error("bad ratio percent (<=1 decimal): " + JSON.stringify(human));
    var frac = m[2] || "";
    while (frac.length < 1) frac += "0";
    var n = parseInt(((m[1] + frac).replace(/^0+(?=\d)/, "") || "0"), 10);
    if (n < 0 || n > 0xFFFF) throw new Error("ratio out of u16 range: " + JSON.stringify(human));
    return n;
  }

  /* 1750 -> "175" via integer math (raw/10; the only "/ 1000"-family
   * divider — views must never divide ratios ad-hoc). */
  function ratioToPct(raw) {
    _assertU16(raw, "ratio");
    var q = (raw - (raw % 10)) / 10, r = raw % 10;
    return r ? q + "." + r : String(q);
  }

  /* Builder-shape bitasset fields -> chain bitasset_options keys. Extensions
   * stay EMPTY (BSIP74/75/77 ext only on proven testnet need). */
  function _bitassetOpts(b) {
    if (!b || typeof b !== "object") throw new Error("bitassetOpts must be an object");
    if (!Number.isInteger(b.feed_lifetime_sec) || b.feed_lifetime_sec < 0) throw new Error("feed_lifetime_sec must be a non-negative int");
    if (!Number.isInteger(b.minimum_feeds) || b.minimum_feeds < 0 || b.minimum_feeds > 255) throw new Error("minimum_feeds must be u8 (0-255)");
    if (!Number.isInteger(b.force_settlement_delay_sec) || b.force_settlement_delay_sec < 0) throw new Error("force_settlement_delay_sec must be a non-negative int");
    _assertU16(b.offset_hundredths, "offset_hundredths");
    _assertU16(b.max_settle_vol_hundredths, "max_settle_vol_hundredths");
    _assertAssetId(b.short_backing_asset, "short_backing_asset");
    return { feed_lifetime_sec: b.feed_lifetime_sec, minimum_feeds: b.minimum_feeds,
      force_settlement_delay_sec: b.force_settlement_delay_sec,
      force_settlement_offset_percent: b.offset_hundredths,
      maximum_force_settlement_volume: b.max_settle_vol_hundredths,
      short_backing_asset: b.short_backing_asset };
  }

  /* Validate + normalize a full asset_options object for op 11 (values pass
   * through untouched; extensions forced to [] per BSIP48-by-default). */
  function _assetOptions(o) {
    if (!o || typeof o !== "object") throw new Error("newOptions must be an asset_options object");
    _assertDigits(String(o.max_supply), "max_supply");
    _assertU16(o.market_fee_percent, "market_fee_percent");
    _assertDigits(String(o.max_market_fee), "max_market_fee");
    _assertU16(o.issuer_permissions, "issuer_permissions");
    _assertU16(o.flags, "flags");
    var cer = o.core_exchange_rate || {};
    if (!cer.base || !cer.quote) throw new Error("core_exchange_rate needs {base, quote}");
    _assertDigits(String(cer.base.amount), "cer.base.amount");
    _assertId(cer.base.asset_id, "cer.base.asset_id");
    _assertDigits(String(cer.quote.amount), "cer.quote.amount");
    _assertId(cer.quote.asset_id, "cer.quote.asset_id");
    if (typeof o.description !== "string") throw new Error("description must be a string");
    /* Optional id-array field -> [] when absent (whitelist/blacklist authorities + markets). Params: v, name (error label). Fails when present-but-not-an-array. */
    function arr(v, name) {
      if (v === undefined || v === null) return [];
      if (!Array.isArray(v)) throw new Error(name + " must be an array");
      return v;
    }
    return { max_supply: String(o.max_supply), market_fee_percent: o.market_fee_percent,
      max_market_fee: String(o.max_market_fee), issuer_permissions: o.issuer_permissions, flags: o.flags,
      core_exchange_rate: { base: { amount: String(cer.base.amount), asset_id: cer.base.asset_id },
        quote: { amount: String(cer.quote.amount), asset_id: cer.quote.asset_id } },
      whitelist_authorities: arr(o.whitelist_authorities, "whitelist_authorities"),
      blacklist_authorities: arr(o.blacklist_authorities, "blacklist_authorities"),
      whitelist_markets: arr(o.whitelist_markets, "whitelist_markets"),
      blacklist_markets: arr(o.blacklist_markets, "blacklist_markets"),
      description: o.description, extensions: [] };
  }

  /* Op-10 asset_create: UIA (bitasset null), smartcoin (bitasset set), NFT
   * (nft set -> description gains nft_object), PMA (is_prediction_market,
   * REQUIRES bitasset). marketFeePctHuman "2" -> 200 hundredths; supplies
   * via parseAmount (no float). CER quote = "1.3.1" placeholder (chain
   * overwrites, re-read-proven). Description fee grows per kbyte — always
   * read live via AssetOps.fee. Returns [10, opData] with zero-placeholder
   * fee. */
  function buildCreate(args) {
    args = args || {};
    _assertAccountId(args.issuerId, "issuerId");
    if (typeof args.symbol !== "string" || !SYMBOL_RE.test(args.symbol)) throw new Error("bad-symbol (uppercased A-Z0-9.): " + JSON.stringify(args.symbol));
    _assertPrecision(args.precision, "precision");
    _needFormat();
    var maxSupplyRaw = Format.parseAmount(args.maxSupplyHuman, args.precision);
    var maxFeeRaw = Format.parseAmount(args.maxMarketFeeHuman, args.precision);
    var feeHundredths = pctHumanToHundredths(args.marketFeePctHuman);
    _assertU16(args.permissions, "permissions");
    _assertU16(args.flags, "flags");
    _assertDigits(args.cerBaseRaw, "cerBaseRaw");
    _assertDigits(args.cerQuoteRaw, "cerQuoteRaw");
    _assertAssetId(args.cerBaseId, "cerBaseId");
    if (typeof args.description !== "string") throw new Error("description must be a string");
    var descStr = args.description;
    if (args.nft !== null && args.nft !== undefined) {
      if (typeof args.nft !== "object" || Array.isArray(args.nft)) throw new Error("nft must be a plain object or null");
      descStr = JSON.stringify({ main: args.description, nft_object: args.nft });
    }
    var bitassetOpts = null;
    if (args.bitasset !== null && args.bitasset !== undefined) bitassetOpts = _bitassetOpts(args.bitasset);
    var pma = !!args.is_prediction_market;
    if (pma && !bitassetOpts) throw new Error("prediction-market needs bitasset_opts");
    var opData = { fee: { amount: "0", asset_id: CORE_ASSET }, issuer: args.issuerId,
      symbol: args.symbol, precision: args.precision,
      common_options: { max_supply: maxSupplyRaw, market_fee_percent: feeHundredths, max_market_fee: maxFeeRaw,
        issuer_permissions: args.permissions, flags: args.flags,
        core_exchange_rate: { base: { amount: args.cerBaseRaw, asset_id: args.cerBaseId },
          quote: { amount: args.cerQuoteRaw, asset_id: CER_QUOTE_PLACEHOLDER } },
        whitelist_authorities: [], blacklist_authorities: [], whitelist_markets: [], blacklist_markets: [],
        description: descStr, extensions: [] },
      is_prediction_market: pma, extensions: [] };
    if (bitassetOpts) opData.bitasset_opts = bitassetOpts;
    return [10, opData];
  }

  /* Op-11 asset_update (common options + optional new issuer).
   * newOptions is a full asset_options object (validated, passed through);
   * extensions [] default. Returns [11, opData]. */
  function buildUpdate(args) {
    args = args || {};
    _assertAccountId(args.issuerId, "issuerId");
    _assertAssetId(args.assetId, "assetId");
    var next = null;
    if (args.newIssuerOrNull !== null && args.newIssuerOrNull !== undefined) {
      _assertAccountId(args.newIssuerOrNull, "newIssuerOrNull");
      next = args.newIssuerOrNull;
    }
    return [11, { fee: { amount: "0", asset_id: CORE_ASSET }, issuer: args.issuerId,
      asset_to_update: args.assetId, new_issuer: next,
      new_options: _assetOptions(args.newOptions), extensions: [] }];
  }

  /* Op-12 asset_update_bitasset (MPA-only; views gate via
   * Asset.describe().is_smartcoin). Extensions [] default. Returns
   * [12, opData]. */
  function buildUpdateBitasset(args) {
    args = args || {};
    _assertAccountId(args.issuerId, "issuerId");
    _assertAssetId(args.assetId, "assetId");
    return [12, { fee: { amount: "0", asset_id: CORE_ASSET }, issuer: args.issuerId,
      asset_to_update: args.assetId, new_options: _bitassetOpts(args.bitassetOpts), extensions: [] }];
  }

  /* Op-13 asset_update_feed_producers. producerIds[] sorted by instance and
   * deduped (flat_set wire order). Committee/cardinality rules are
   * chain-enforced. Returns [13, opData]. */
  function buildUpdateProducers(args) {
    args = args || {};
    _assertAccountId(args.issuerId, "issuerId");
    _assertAssetId(args.assetId, "assetId");
    if (!Array.isArray(args.producerIds)) throw new Error("producerIds must be an array");
    var seen = {}, i;
    for (i = 0; i < args.producerIds.length; i++) {
      _assertAccountId(args.producerIds[i], "producerIds[" + i + "]");
      seen[args.producerIds[i]] = 1;
    }
    var sorted = Object.keys(seen).sort(function (x, y) {
      return parseInt(x.split(".")[2], 10) - parseInt(y.split(".")[2], 10);
    });
    return [13, { fee: { amount: "0", asset_id: CORE_ASSET }, issuer: args.issuerId,
      asset_to_update: args.assetId, new_feed_producers: sorted, extensions: [] }];
  }

  /* Op-14 asset_issue (issuer must equal the asset issuer — chain-enforced).
   * memoOrNull: v1 views pass null (no memo encryption yet); a supplied
   * value passes through as the full memo object. Returns [14, opData]. */
  function buildIssue(args) {
    args = args || {};
    _assertAccountId(args.issuerId, "issuerId");
    _assertAssetId(args.assetId, "assetId");
    _assertAccountId(args.toAccountId, "toAccountId");
    _assertPrecision(args.precision, "precision");
    _needFormat();
    return [14, { fee: { amount: "0", asset_id: CORE_ASSET }, issuer: args.issuerId,
      asset_to_issue: { amount: Format.parseAmount(args.amountHuman, args.precision), asset_id: args.assetId },
      issue_to_account: args.toAccountId,
      memo: (args.memoOrNull === undefined) ? null : args.memoOrNull, extensions: [] }];
  }

  /* Op-15 asset_reserve (burn back to issuer). READ-SIDE GATES (views enforce
   * via Asset.describe() before building): payer is the issuer and the asset
   * is NOT market-issued (chain rejects reserve on MPAs). Returns
   * [15, opData]. */
  function buildReserve(args) {
    args = args || {};
    _assertAccountId(args.payerId, "payerId");
    _assertAssetId(args.assetId, "assetId");
    _assertPrecision(args.precision, "precision");
    _needFormat();
    return [15, { fee: { amount: "0", asset_id: CORE_ASSET }, payer: args.payerId,
      amount_to_reserve: { amount: Format.parseAmount(args.amountHuman, args.precision), asset_id: args.assetId },
      extensions: [] }];
  }

  /* Op-19 asset_publish_feed. ASYNC by necessity: the settlement-quote and
   * CER legs need the backing id from Asset.describe().bitasset (no safe
   * placeholder exists). mcr/mssr are explicit ratio ints — NO silent
   * 1750/1500 defaults (#3 || fallbacks not ported; tx.js throws when
   * missing). basePrec/quotePrec are settlement-pair validation context
   * only; raws pass through untouched. Leg convention (chain ground truth:
   * asset_ops.cpp:178 settlement.base == CER.base, asset.cpp:266 is_for
   * checks the base leg): settlement = base(MPA)/quote(backing); CER =
   * base(MPA)/quote(backing). Returns Promise of [19, opData]. Fails
   * "not-market-issued" / "unknown-asset" / "not-connected". */
  async function buildFeed(args) {
    args = args || {};
    _assertAccountId(args.publisherId, "publisherId");
    _assertAssetId(args.assetId, "assetId");
    _assertDigits(args.settleBaseRaw, "settleBaseRaw");
    _assertDigits(args.settleQuoteRaw, "settleQuoteRaw");
    _assertDigits(args.cerBaseRaw, "cerBaseRaw");
    _assertDigits(args.cerQuoteRaw, "cerQuoteRaw");
    _assertU16(args.mcr, "mcr");
    _assertU16(args.mssr, "mssr");
    _assertPrecision(args.basePrec, "basePrec");
    _assertPrecision(args.quotePrec, "quotePrec");
    _needReads();
    var info = await Asset.describe(args.assetId);
    if (!info.is_smartcoin || !info.bitasset || !info.bitasset.short_backing_asset) throw new Error("not-market-issued");
    var backing = info.bitasset.short_backing_asset;
    return [19, { fee: { amount: "0", asset_id: CORE_ASSET }, publisher: args.publisherId, asset_id: args.assetId,
      feed: { settlement_price: { base: { amount: args.settleBaseRaw, asset_id: args.assetId },
          quote: { amount: args.settleQuoteRaw, asset_id: backing } },
        maintenance_collateral_ratio: args.mcr, maximum_short_squeeze_ratio: args.mssr,
        core_exchange_rate: { base: { amount: args.cerBaseRaw, asset_id: args.assetId },
          quote: { amount: args.cerQuoteRaw, asset_id: backing } } },
      extensions: [] }];
  }

  /* Live fee for one asset op pair via Tx.fee (chain answers tier + kbyte
   * charges; never computed here). opPair [opId, opData] is fee-filled in
   * place. Returns Promise of {amount (raw string), asset_id}. Fails
   * "tx-unavailable" when Tx is not loaded. */
  async function fee(opPair, feeAssetId) {
    if (!Array.isArray(opPair) || !Number.isInteger(opPair[0]) || !opPair[1]) throw new Error("opPair must be [opId, opData]");
    if (typeof Tx === "undefined" || !Tx.fee) throw new Error("tx-unavailable");
    var ans = await Tx.fee(opPair[0], opPair[1], feeAssetId || CORE_ASSET);
    opPair[1].fee = { amount: String(ans.amount), asset_id: ans.asset_id };
    return { amount: String(ans.amount), asset_id: ans.asset_id };
  }

  /* Sign + send + prove (vote-pattern shape). Signs the envelope inside with
   * the fresh WIF, sends via broadcast_transaction_with_callback FIRST with
   * one plain-broadcast fallback, then re-reads via proveFn (async () ->
   * truthy match or falsy) until timeout. Returns {via, proof}. Send
   * rejections throw with sendRejected:true (safe to retry); an ACCEPTED but
   * unproven send throws WITHOUT it — check state, never blindly
   * rebroadcast. Fails "wallet-locked" / "tx-unavailable" / "not-connected". */
  async function sendAndProve(signedTx, wif, proveFn) {
    if (!signedTx || !Array.isArray(signedTx.operations) || !signedTx.operations.length) throw new Error("signedTx has no operations");
    if (typeof wif !== "string" || !wif) throw new Error("wallet-locked");
    if (typeof proveFn !== "function") throw new Error("proveFn must be a function");
    if (typeof Tx === "undefined" || !Tx.sign) throw new Error("tx-unavailable");
    var txSigned = await Tx.sign(signedTx, wif);
    var netId;
    try { netId = await Chain.net(); } catch (e) { throw new Error("not-connected"); }
    var via = "broadcast_transaction_with_callback";
    var callbackId = (Math.random() * 4294967296) >>> 0;
    try {
      await Chain.call(netId, "broadcast_transaction_with_callback", [callbackId, txSigned]);
    } catch (e) {
      via = "broadcast_transaction";
      try { await Chain.call(netId, "broadcast_transaction", [txSigned]); } catch (e2) {
        e2.sendRejected = true;
        throw e2;
      }
    }
    var deadline = Date.now() + PROVE_TIMEOUT_MS;
    for (;;) {
      var ok = null;
      try { ok = await proveFn(); } catch (e) { ok = null; }
      if (ok) return { via: via + "+re-read", proof: ok };
      if (Date.now() >= deadline) throw new Error("Sent (" + via + ") but the re-read proof was not observed within " +
        (PROVE_TIMEOUT_MS / 1000) + "s; check state before retrying (do NOT blindly rebroadcast).");
      await _sleep(PROVE_INTERVAL_MS);
    }
  }

  return { buildCreate: buildCreate, buildUpdate: buildUpdate, buildUpdateBitasset: buildUpdateBitasset,
    buildUpdateProducers: buildUpdateProducers, buildIssue: buildIssue, buildReserve: buildReserve, buildFeed: buildFeed,
    fee: fee, sendAndProve: sendAndProve, pctHumanToHundredths: pctHumanToHundredths, hundredthsToPct: hundredthsToPct,
    pctHumanToRatio: pctHumanToRatio, ratioToPct: ratioToPct };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.AssetOps === "undefined") { globalThis.AssetOps = AssetOps; }
if (typeof module !== "undefined") { module.exports = AssetOps; }
