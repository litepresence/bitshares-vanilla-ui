#!/usr/bin/env node
/* robustness-fuzz-test: adversarial malformed-payload vectors (offline only).
 * Owns: NEVER-THROW-into-render + NEVER-wrong-money guards for every parser
 *   a malicious node can reach (Format, Market fills/candles, PoolHistory,
 *   Pool, Chain props/block-id, ES guards, tx integer writers).
 * Consumes: REAL vanilla sources (format/market/market-candles/market-fills/
 *   pool/pool-history/tx/chain via require + vm sandbox). No network, no
 *   broadcasts, no chain writes, stdlib only.
 * Globals/side effects: none (stubs Chain/Store/fetch in-process).
 * Created by: adversarial robustness round (offline unit vectors).
 * Method: each case asserts (a) never throws raw into render (null/dash/
 *   throws-named-error all acceptable; raw TypeError/SyntaxError/RangeError
 *   with stack to UI is FAIL) and (b) never produces wrong-money (positive
 *   numeric assertion on garbage, NaN/Infinity rendered, negative money
 *   from garbage amounts is FAIL).
 */
"use strict";
const fs = require("fs");
const vm = require("vm");

let pass = 0, fail = 0;
function ok(cond, name, detail) {
  if (cond) { pass++; }
  else { fail++; console.log("FAIL " + name + (detail ? " — " + detail : "")); }
}
function isNamedError(e) {
  if (!e || typeof e.message !== "string") return false;
  const m = e.message;
  return /bad-|unknown-|empty-|order-trap|zero-trap|history-unavailable|not-connected|bad-head|uint16|uint32|int64|varint|invalid object id|bad hex|bad amount|bad price|bad precision|bad places|bad bucket|bad-count|bad-market|bad-asset|bad pool|bad swaps|bad reserves|too many decimals|zero quote|no fetch|fee-/i.test(m);
}
function isRawError(e) { return !isNamedError(e); }
function throwsNamed(fn, name) {
  try { fn(); ok(false, name, "expected named throw, returned normally"); }
  catch (e) { ok(isNamedError(e), name, "raw throw: " + ((e && e.message) || e)); }
}
function neverRawThrow(fn, name) {
  try { fn(); ok(true, name); }
  catch (e) { ok(isNamedError(e), name, "raw throw: " + ((e && e.stack || e.message || e))); }
}
function isWrongMoneyString(s) {
  if (typeof s !== "string") return false;
  if (s === "NaN" || s === "Infinity" || s === "-Infinity") return true;
  if (/NaN|Infinity|undefined/.test(s)) return true;
  return false;
}

/* ---- load REAL sources ---- */
globalThis.Format = require("/workspace/vanilla/js/api/format.js");
const Tx = require("/workspace/vanilla/js/api/tx.js");
globalThis.Chain = { call: () => Promise.reject(new Error("no chain in vectors")), history: () => Promise.reject(new Error("no chain")), db: () => Promise.reject(new Error("no chain")) };
globalThis.Store = { loadSettings: () => ({ network: "mainnet" }) };
globalThis.Asset = { describe: () => Promise.reject(new Error("no chain")) };
globalThis.Pool = require("/workspace/vanilla/js/api/pool.js");
const MF = require("/workspace/vanilla/js/api/market-fills-history.js");
const PH = require("/workspace/vanilla/js/api/pool-history.js");
globalThis.MarketFills = MF;
const MC = require("/workspace/vanilla/js/api/market-candles.js");

/* ============ 1. Format.parseAmount ============ */
(function () {
  // huge ints must round-trip, never float
  try {
    const huge = "9".repeat(30);
    const raw = Format.parseAmount(huge + ".00001", 5);
    ok(raw === huge + "00001".slice(0, 0) + "00001" || typeof raw === "string", "parseAmount huge returns string");
    ok(/^\d+$/.test(raw), "parseAmount huge stays digit string", raw.slice(0, 40));
  } catch (e) { ok(false, "parseAmount huge no-throw", (e && e.message) || e); }
  // negatives must throw named (never fold to positive)
  throwsNamed(() => Format.parseAmount("-1.00", 5), "parseAmount negative throws named");
  throwsNamed(() => Format.parseAmount("-0", 5), "parseAmount -0 throws named");
  // non-strings must throw named, never coerce to money
  [null, undefined, NaN, Infinity, {}, [], "abc", "", "1.2.3", "1e5", ".5", "5.", "  "].forEach((v, i) => {
    throwsNamed(() => Format.parseAmount(v, 5), "parseAmount garbage[" + i + "]=" + JSON.stringify(String(v)).slice(0, 20) + " throws named");
  });
  // precision edges: must be int 0-12 else named throw (never silent pad)
  [-1, 13, 2.5, NaN, null, undefined, "5", Infinity].forEach((p, i) => {
    throwsNamed(() => Format.parseAmount("1.00", p), "parseAmount bad precision[" + i + "]=" + JSON.stringify(p) + " throws named");
  });
  // excess decimals must throw (never truncate money)
  throwsNamed(() => Format.parseAmount("1.000000", 5), "parseAmount excess decimals throws");
  // valid precisions 0..12 still work
  try {
    ok(Format.parseAmount("1", 0) === "1", "parseAmount prec 0");
    ok(Format.parseAmount("1.5", 2) === "150", "parseAmount prec 2");
    ok(Format.parseAmount("0.000000000001", 12) === "1", "parseAmount prec 12");
  } catch (e) { ok(false, "parseAmount valid precs", (e && e.message) || e); }
})();

/* ============ 2. Format.formatAmount ============ */
(function () {
  try {
    ok(Format.formatAmount("123456", 5) === "1.23456", "formatAmount basic");
    ok(Format.formatAmount("0", 5) === "0.00000", "formatAmount zero");
    const huge = "9".repeat(30);
    const h = Format.formatAmount(huge, 5);
    ok(typeof h === "string" && !/NaN|Infinity/.test(h), "formatAmount huge no NaN");
  } catch (e) { ok(false, "formatAmount basics", (e && e.message) || e); }
  [null, undefined, "abc", "", "1.5", "12x"].forEach((v, i) => {
    throwsNamed(() => Format.formatAmount(v, 5), "formatAmount garbage[" + i + "] throws named");
  });
  [-1, 13, 2.5, NaN, null, undefined, "5", Infinity].forEach((p, i) => {
    throwsNamed(() => Format.formatAmount("100", p), "formatAmount bad precision[" + i + "] throws named");
  });
  // never renders NaN/Infinity strings
  try {
    const r = Format.formatAmount("0", 5);
    ok(!isWrongMoneyString(r), "formatAmount never wrong-money string");
  } catch (e) { ok(isNamedError(e), "formatAmount zero no raw", (e && e.message) || e); }
})();

/* ============ 3. Format.formatPrice ============ */
(function () {
  try {
    ok(Format.formatPrice("100000", 5, "5000", 4, 8) === "2.00000000", "formatPrice basic 2.0");
  } catch (e) { ok(false, "formatPrice basic", (e && e.message) || e); }
  // zero quote must throw named (never divide)
  throwsNamed(() => Format.formatPrice("100", 5, "0", 5, 8), "formatPrice zero quote throws named");
  // negative legs must throw named (never render negative money from garbage)
  throwsNamed(() => Format.formatPrice("-100", 5, "5000", 4, 8), "formatPrice negative base throws named");
  throwsNamed(() => Format.formatPrice("100", 5, "-5000", 4, 8), "formatPrice negative quote throws named");
  // non-digit raws must throw named (never raw SyntaxError to UI)
  ["abc", "", "1.5", null, undefined, NaN, Infinity, {}, []].forEach((v, i) => {
    throwsNamed(() => Format.formatPrice(v, 5, "100", 5, 8), "formatPrice bad base[" + i + "] throws named");
    throwsNamed(() => Format.formatPrice("100", 5, v, 5, 8), "formatPrice bad quote[" + i + "] throws named");
  });
  // bad precisions / places must throw named (never raw RangeError)
  throwsNamed(() => Format.formatPrice("100", -1, "100", 5, 8), "formatPrice bad basePrec throws named");
  throwsNamed(() => Format.formatPrice("100", 13, "100", 5, 8), "formatPrice basePrec 13 throws named");
  throwsNamed(() => Format.formatPrice("100", 5, "100", -1, 8), "formatPrice bad quotePrec throws named");
  throwsNamed(() => Format.formatPrice("100", 5, "100", 5, -1), "formatPrice negative places throws named");
  throwsNamed(() => Format.formatPrice("100", 5, "100", 5, 2.5), "formatPrice float places throws named");
  throwsNamed(() => Format.formatPrice("100", "5", "100", 5, 8), "formatPrice string prec throws named");
  throwsNamed(() => Format.formatPrice("100", NaN, "100", 5, 8), "formatPrice NaN prec throws named");
  // huge ints must work, never NaN
  try {
    const r = Format.formatPrice("9".repeat(25), 5, "1", 5, 8);
    ok(typeof r === "string" && !isWrongMoneyString(r), "formatPrice huge no wrong-money");
  } catch (e) { ok(false, "formatPrice huge no-throw", (e && e.message) || e); }
})();

/* ============ 4. Format.parsePriceRatio ============ */
(function () {
  try {
    const r = Format.parsePriceRatio("100.5");
    ok(r.num === 1005n && r.den === 10n, "parsePriceRatio 100.5");
  } catch (e) { ok(false, "parsePriceRatio basic", (e && e.message) || e); }
  ["-1", "", ".5", "5.", "1.2.3", "1e5", null, undefined, NaN, {}, []].forEach((v, i) => {
    throwsNamed(() => Format.parsePriceRatio(v), "parsePriceRatio garbage[" + i + "] throws named");
  });
})();

/* ============ 5. tx integer writers: must throw, never fold ============ */
(function () {
  const S = Tx._ser;
  // writeUint16LE
  throwsNamed(() => S.writeUint16LE(NaN), "u16 NaN throws");
  throwsNamed(() => S.writeUint16LE(-1), "u16 negative throws");
  throwsNamed(() => S.writeUint16LE(0x10000), "u16 overflow throws");
  throwsNamed(() => S.writeUint16LE(1.5), "u16 float throws");
  throwsNamed(() => S.writeUint16LE("5"), "u16 string throws");
  // writeUint32LE
  throwsNamed(() => S.writeUint32LE(NaN), "u32 NaN throws");
  throwsNamed(() => S.writeUint32LE(-1), "u32 negative throws");
  throwsNamed(() => S.writeUint32LE(0x100000000), "u32 overflow throws");
  throwsNamed(() => S.writeUint32LE(1.5), "u32 float throws");
  throwsNamed(() => S.writeUint32LE("5"), "u32 string throws");
  throwsNamed(() => S.writeUint32LE(Infinity), "u32 Infinity throws");
  // writeInt64LE: digit strings + safe ints only; negatives/overflow throw named
  throwsNamed(() => S.writeInt64LE(NaN), "i64 NaN throws");
  throwsNamed(() => S.writeInt64LE(-1), "i64 negative number throws");
  throwsNamed(() => S.writeInt64LE("-5"), "i64 negative string throws");
  throwsNamed(() => S.writeInt64LE("1.5"), "i64 float string throws");
  throwsNamed(() => S.writeInt64LE("abc"), "i64 abc throws");
  throwsNamed(() => S.writeInt64LE(null), "i64 null throws");
  throwsNamed(() => S.writeInt64LE(undefined), "i64 undefined throws");
  throwsNamed(() => S.writeInt64LE(1.5), "i64 float number throws");
  throwsNamed(() => S.writeInt64LE(-5n), "i64 negative bigint throws named");
  throwsNamed(() => S.writeInt64LE(18446744073709551616n), "i64 overflow bigint throws named");
  throwsNamed(() => S.writeInt64LE("18446744073709551616"), "i64 overflow digit string throws named");
  // valid still work
  try {
    ok(S.writeInt64LE("0").length === 8, "i64 zero ok");
    ok(S.writeInt64LE("9223372036854775807").length === 8, "i64 max ok");
    ok(S.writeInt64LE(0).length === 8, "i64 number zero ok");
  } catch (e) { ok(false, "i64 valid", (e && e.message) || e); }
  // varintUint32: NaN/negatives/floats/non-strings throw NAMED (never raw)
  throwsNamed(() => S.varintUint32(NaN), "varint NaN throws named");
  throwsNamed(() => S.varintUint32(-1), "varint negative throws named");
  throwsNamed(() => S.varintUint32(1.5), "varint float throws named");
  throwsNamed(() => S.varintUint32("abc"), "varint abc throws named");
  throwsNamed(() => S.varintUint32(null), "varint null throws named");
  throwsNamed(() => S.varintUint32(undefined), "varint undefined throws named");
  throwsNamed(() => S.varintUint32("1.5"), "varint float-string throws named");
  throwsNamed(() => S.varintUint32(Infinity), "varint Infinity throws named");
  try {
    ok(S.varintUint32(0).length === 1, "varint zero ok");
    ok(S.varintUint32("300").length === 2, "varint 300 ok");
  } catch (e) { ok(false, "varint valid", (e && e.message) || e); }
})();

/* ============ 6. MarketFills guards ============ */
(function () {
  function hit(opType, pays, recv) {
    return { _source: { operation_type: opType, operation_history: { op_object: { pays, receives: recv } }, block_data: { block_time: "2026-09-01T10:15:00Z" } } };
  }
  // wrong op types reject (string + number forms)
  ok(MF.esFill(hit("63", { amount: "100", asset_id: "1.3.0" }, { amount: "200", asset_id: "1.3.113" }), "1.3.0", "1.3.113") === null, "esFill wrong op rejects");
  ok(MF.esFill(hit(63, { amount: "100", asset_id: "1.3.0" }, { amount: "200", asset_id: "1.3.113" }), "1.3.0", "1.3.113") === null, "esFill numeric wrong op rejects");
  ok(MF.esFill(hit("4", { amount: "100", asset_id: "1.3.0" }, { amount: "200", asset_id: "1.3.113" }), "1.3.0", "1.3.113") !== null, "esFill op-4 accepts");
  // cross-chain id collisions reject
  ok(MF.esFill(hit("4", { amount: "100", asset_id: "1.3.0" }, { amount: "200", asset_id: "1.3.999" }), "1.3.0", "1.3.113") === null, "esFill foreign leg rejects");
  // missing legs reject (never throw raw)
  neverRawThrow(() => MF.esFill({ _source: {} }, "1.3.0", "1.3.113"), "esFill empty source no raw");
  ok(MF.esFill({ _source: {} }, "1.3.0", "1.3.113") === null, "esFill empty source null");
  ok(MF.esFill(null, "1.3.0", "1.3.113") === null, "esFill null hit null");
  ok(MF.esFill(hit("4", null, null), "1.3.0", "1.3.113") === null, "esFill null legs null");
  // negative / non-digit amounts reject (never positive assertion on garbage)
  ok(MF.esFill(hit("4", { amount: "-100", asset_id: "1.3.0" }, { amount: "200", asset_id: "1.3.113" }), "1.3.0", "1.3.113") === null, "esFill negative amount rejects");
  ok(MF.esFill(hit("4", { amount: "abc", asset_id: "1.3.0" }, { amount: "200", asset_id: "1.3.113" }), "1.3.0", "1.3.113") === null, "esFill abc amount rejects");
  // priceHuman: zero amounts -> null (never divide, never throw raw)
  ok(MF.priceHuman({ paid: { amount: "0", asset: "1.3.0" }, received: { amount: "0", asset: "1.3.113" } }, "1.3.0", 5, 4, "1.3.113") === null, "priceHuman zero-zero null");
  ok(MF.priceHuman({ paid: { amount: "100", asset: "1.3.0" }, received: { amount: "0", asset: "1.3.113" } }, "1.3.0", 5, 4, "1.3.113") === null, "priceHuman zero quote leg null");
  // flipped pairs both orient to same base-per-quote price (valid, not null)
  try {
    const a = MF.priceHuman({ paid: { amount: "100000", asset: "1.3.0" }, received: { amount: "5000", asset: "1.3.113" } }, "1.3.0", 5, 4, "1.3.113");
    const b = MF.priceHuman({ paid: { amount: "5000", asset: "1.3.113" }, received: { amount: "100000", asset: "1.3.0" } }, "1.3.0", 5, 4, "1.3.113");
    ok(a !== null && a === b, "priceHuman flipped pairs agree", a + " vs " + b);
  } catch (e) { ok(false, "priceHuman flipped", (e && e.message) || e); }
  // missing legs -> null, never raw
  neverRawThrow(() => MF.priceHuman({ paid: null, received: null }, "1.3.0", 5, 4, "1.3.113"), "priceHuman null legs no raw");
  ok(MF.priceHuman({ paid: null, received: null }, "1.3.0", 5, 4, "1.3.113") === null, "priceHuman null legs null");
  ok(MF.priceHuman({ paid: { amount: "1", asset: "1.3.9" }, received: { amount: "1", asset: "1.3.8" } }, "1.3.0", 5, 4, "1.3.113") === null, "priceHuman foreign legs null");
  // fillsToCandles: empty -> [], single bucket, out-of-order sorted, future ok, bad timestamps skipped
  ok(JSON.stringify(MF.fillsToCandles([], 3600, "1.3.0", 5, 4, "1.3.113")) === "[]", "fillsToCandles empty -> []");
  throwsNamed(() => MF.fillsToCandles([], 0, "1.3.0", 5, 4, "1.3.113"), "fillsToCandles bad bucket throws named");
  throwsNamed(() => MF.fillsToCandles([], NaN, "1.3.0", 5, 4, "1.3.113"), "fillsToCandles NaN bucket throws named");
  try {
    const f1 = { time: "2026-09-01T10:45:00Z", paid: { amount: "10000", asset: "1.3.113" }, received: { amount: "200000", asset: "1.3.0" } };
    const f0 = { time: "2026-09-01T10:15:00Z", paid: { amount: "100000", asset: "1.3.0" }, received: { amount: "5000", asset: "1.3.113" } };
    const out = MF.fillsToCandles([f1, f0], 3600, "1.3.0", 5, 4, "1.3.113"); // out-of-order input
    ok(out.length === 1, "fillsToCandles out-of-order merges");
    const bad = MF.fillsToCandles([{ time: "not-a-time", paid: { amount: "1", asset: "1.3.0" }, received: { amount: "1", asset: "1.3.113" } }, f0], 3600, "1.3.0", 5, 4, "1.3.113");
    ok(bad.length === 1, "fillsToCandles bad timestamp skipped");
    const nul = MF.fillsToCandles([{ time: null, paid: { amount: "1", asset: "1.3.0" }, received: { amount: "1", asset: "1.3.113" } }], 3600, "1.3.0", 5, 4, "1.3.113");
    ok(nul.length === 0, "fillsToCandles null time -> []");
    const fut = MF.fillsToCandles([{ time: "2999-01-01T00:00:00Z", paid: { amount: "100000", asset: "1.3.0" }, received: { amount: "5000", asset: "1.3.113" } }], 3600, "1.3.0", 5, 4, "1.3.113");
    ok(fut.length === 1 && !isWrongMoneyString(fut[0].close), "fillsToCandles future buckets without wrong-money");
    const zero = MF.fillsToCandles([{ time: "2026-09-01T10:15:00Z", paid: { amount: "0", asset: "1.3.0" }, received: { amount: "0", asset: "1.3.113" } }], 3600, "1.3.0", 5, 4, "1.3.113");
    ok(zero.length === 0, "fillsToCandles zero-zero skipped (no divide)");
  } catch (e) { ok(false, "fillsToCandles vectors no raw", (e && e.stack || e)); }
})();

/* ============ 7. PoolHistory guards ============ */
(function () {
  // esSwap wrong op / wrong pool / missing legs -> null
  function swapHit(opType, pool, paid, recv) {
    return { _source: { operation_type: opType, block_data: { block_num: 1, block_time: "2026-09-28T20:12:24" }, operation_history: { op_object: { account: "1.2.1", pool }, operation_result_object: { data_object: { paid: [paid], received: [recv] } } } } };
  }
  ok(PH._test.esSwap(swapHit(63, "1.19.133", { amount: 1, asset_id: "1.3.0" }, { amount: 2, asset_id: "1.3.1" }), "1.19.133") !== null, "esSwap op-63 accepts");
  ok(PH._test.esSwap(swapHit(4, "1.19.133", { amount: 1, asset_id: "1.3.0" }, { amount: 2, asset_id: "1.3.1" }), "1.19.133") === null, "esSwap wrong op rejects");
  ok(PH._test.esSwap(swapHit("63", "1.19.133", { amount: 1, asset_id: "1.3.0" }, { amount: 2, asset_id: "1.3.1" }), "1.19.133") !== null, "esSwap string op-63 accepts");
  ok(PH._test.esSwap(swapHit(63, "1.19.999", { amount: 1, asset_id: "1.3.0" }, { amount: 2, asset_id: "1.3.1" }), "1.19.133") === null, "esSwap cross-pool rejects");
  ok(PH._test.esSwap({ _source: {} }, "1.19.133") === null, "esSwap empty source null");
  ok(PH._test.esSwap(null, "1.19.133") === null, "esSwap null hit null");
  // missing result legs -> null
  ok(PH._test.esSwap({ _source: { operation_type: 63, block_data: {}, operation_history: { op_object: { pool: "1.19.133" } } } }, "1.19.133") === null, "esSwap missing result legs null");
  // priceHuman zero / unknown -> null, never raw, never negative
  ok(PH.priceHuman({ paid: { amount: "0", asset: "1.3.1" }, received: { amount: "0", asset: "1.3.2" } }, 5, 4, "1.3.1", "1.3.2") === null, "pool priceHuman zero null");
  ok(PH.priceHuman({ paid: { amount: "1", asset: "1.3.9" }, received: { amount: "1", asset: "1.3.8" } }, 5, 4, "1.3.1", "1.3.2") === null, "pool priceHuman unknown null");
  neverRawThrow(() => PH.priceHuman({ paid: null, received: null }, 5, 4, "1.3.1", "1.3.2"), "pool priceHuman null legs no raw");
  // enrich: unknown assets keep null price, never throw raw
  try {
    const rows = [{ paid: { amount: "1", asset: "1.3.9" }, received: { amount: "1", asset: "1.3.8" } }];
    const e = PH.enrich(rows, "1.3.1", 5, "1.3.2", 4);
    ok(e[0].price === null, "enrich unknown legs null price");
  } catch (e2) { ok(false, "enrich unknown no raw", (e2 && e2.message) || e2); }
  neverRawThrow(() => PH.enrich("not-an-array", "1.3.1", 5, "1.3.2", 4), "enrich garbage no raw");
  // swapsToCandles: empty, single, out-of-order, future, null price, bad time
  ok(JSON.stringify(PH.swapsToCandles([], 300, "1.3.2", 4)) === "[]", "swapsToCandles empty -> []");
  throwsNamed(() => PH.swapsToCandles([], 0, "1.3.2", 4), "swapsToCandles bad bucket throws named");
  try {
    const sw = [
      { time: "2026-09-28T20:02:10Z", paid: { amount: "100000", asset: "1.3.1" }, received: { amount: "22000", asset: "1.3.2" }, price: "2.20000000" },
      { time: "2026-09-28T20:00:10Z", paid: { amount: "100000", asset: "1.3.1" }, received: { amount: "18000", asset: "1.3.2" }, price: "1.80000000" },
    ];
    const c = PH.swapsToCandles(sw.slice().reverse(), 86400, "1.3.2", 4);
    ok(c.length === 1, "swapsToCandles out-of-order merges");
    const withNull = PH.swapsToCandles([{ time: "2026-09-28T20:00:10Z", paid: { amount: "1", asset: "1.3.1" }, received: { amount: "1", asset: "1.3.2" }, price: null }], 86400, "1.3.2", 4);
    ok(withNull.length === 0, "swapsToCandles null price skipped");
    const withBadTime = PH.swapsToCandles([{ time: "garbage", paid: { amount: "1", asset: "1.3.1" }, received: { amount: "1", asset: "1.3.2" }, price: "1.00000000" }], 86400, "1.3.2", 4);
    ok(withBadTime.length === 0, "swapsToCandles bad time skipped");
    const fut = PH.swapsToCandles([{ time: "2999-01-01T00:00:00Z", paid: { amount: "1", asset: "1.3.1" }, received: { amount: "2", asset: "1.3.2" }, price: "2.00000000" }], 86400, "1.3.2", 4);
    ok(fut.length === 1, "swapsToCandles future buckets without throw");
  } catch (e) { ok(false, "swapsToCandles vectors no raw", (e && e.stack || e)); }
  // synthBook: zero reserves -> empty, dust skips, mixed precision honest, garbage -> named (never raw)
  ok(JSON.stringify(PH.synthBook({ balanceA_raw: "0", balanceB_raw: "5", precA: 5, precB: 5, taker_units: 0 })) === JSON.stringify({ bids: [], asks: [] }), "synthBook zero reserve empty");
  try {
    const dust = PH.synthBook({ balanceA_raw: "1", balanceB_raw: "1", precA: 5, precB: 5, taker_units: 0 });
    ok(Array.isArray(dust.asks) && Array.isArray(dust.bids), "synthBook dust no raw");
    dust.asks.concat(dust.bids).forEach((l) => { ok(!isWrongMoneyString(l.price), "synthBook dust price honest"); });
  } catch (e) { ok(isNamedError(e), "synthBook dust no raw", (e && e.message) || e); }
  try {
    const mixed = PH.synthBook({ balanceA_raw: "1000000", balanceB_raw: "20000", precA: 5, precB: 2, taker_units: 0 });
    ok(mixed.asks.length > 0 && Number(mixed.asks[0].price) > 19, "synthBook mixed precision scale honest");
  } catch (e) { ok(false, "synthBook mixed", (e && e.message) || e); }
  ["abc", null, undefined, "-5"].forEach((v, i) => {
    try { PH.synthBook({ balanceA_raw: v, balanceB_raw: "5", precA: 5, precB: 5, taker_units: 0 }); ok(false, "synthBook garbage[" + i + "] should throw named"); }
    catch (e) { ok(isNamedError(e), "synthBook garbage[" + i + "] named", "raw: " + ((e && e.message) || e)); }
  });
  // filterLegs: cross-chain collisions drop foreign swaps
  ok(PH._test.filterLegs([{ paid: { asset: "1.3.0" }, received: { asset: "1.3.5" } }], "1.3.0", "1.3.9").length === 0, "filterLegs drops foreign");
})();

/* ============ 8. async: Market.trades + MarketCandles + Chain ============ */
(async () => {
  // Market.trades exercises internal _fillPair: missing legs / zero / flipped / bad time / null price
  try {
    delete require.cache[require.resolve("/workspace/vanilla/js/api/market.js")];
    const Market = require("/workspace/vanilla/js/api/market.js");
    globalThis.Format = require("/workspace/vanilla/js/api/format.js");
    const rows = [
      { op: { fill_price: { base: { amount: "100000", asset_id: "1.3.0" }, quote: { amount: "5000", asset_id: "1.3.113" } } }, time: "2026-09-01T10:15:00Z" },
      { op: { fill_price: { base: { amount: "5000", asset_id: "1.3.113" }, quote: { amount: "100000", asset_id: "1.3.0" } } }, time: "2026-09-01T10:16:00Z" }, // flipped
      { op: {}, time: "2026-09-01T10:17:00Z" }, // missing legs
      { op: { fill_price: { base: { amount: "0", asset_id: "1.3.0" }, quote: { amount: "0", asset_id: "1.3.113" } } }, time: "2026-09-01T10:18:00Z" }, // zero-zero
      { op: { fill_price: { base: { amount: "-100", asset_id: "1.3.0" }, quote: { amount: "5000", asset_id: "1.3.113" } } }, time: "2026-09-01T10:19:00Z" }, // negative
      { op: { fill_price: { base: { amount: "abc", asset_id: "1.3.0" }, quote: { amount: "5000", asset_id: "1.3.113" } } }, time: "2026-09-01T10:20:00Z" }, // garbage
      { op: { fill_price: { base: { amount: "100", asset_id: "1.3.999" }, quote: { amount: "200", asset_id: "1.3.998" } } }, time: "2026-09-01T10:21:00Z" }, // foreign pair
    ];
    globalThis.Chain = {
      history: () => Promise.resolve(2),
      db: () => Promise.resolve(1),
      call: (api, m, p) => {
        if (m === "get_fill_order_history") return Promise.resolve(rows);
        if (m === "get_assets") return Promise.resolve([{ precision: 5 }, { precision: 4 }]);
        return Promise.reject(new Error("unexpected " + m));
      }
    };
    let out = null, threw = null;
    try { out = await Market.trades("1.3.0", "1.3.113", 30); } catch (e) { threw = e; }
    ok(threw === null || isNamedError(threw), "trades malicious rows never raw-reject", threw && (threw.stack || threw.message));
    if (out) {
      ok(out.length === rows.length, "trades keeps row count (nulls for bad)");
      ok(out[0].displayPrice !== null && !isWrongMoneyString(out[0].displayPrice), "trades row0 honest price");
      ok(out[1].displayPrice !== null && out[0].displayPrice === out[1].displayPrice, "trades flipped pair same oriented price");
      ok(out[2].displayPrice === null, "trades missing legs -> null (dash)");
      ok(out[3].displayPrice === null, "trades zero-zero -> null (no divide)");
      ok(out[4].displayPrice === null, "trades negative -> null (no negative money)");
      ok(out[5].displayPrice === null, "trades garbage -> null");
      ok(out[6].displayPrice === null, "trades foreign pair -> null");
      out.forEach((r, i) => {
        if (r.displayPrice !== null) ok(!isWrongMoneyString(r.displayPrice), "trades row" + i + " no wrong-money");
        if (r.baseAmount !== null) ok(!isWrongMoneyString(r.baseAmount), "trades row" + i + " base no wrong-money");
      });
    }
  } catch (e) { ok(false, "trades harness no raw", (e && e.stack || e)); }

  // MarketCandles interpolation: empty / single / out-of-order / future / bad timestamps
  try {
    delete require.cache[require.resolve("/workspace/vanilla/js/api/market-candles.js")];
    const MC2 = require("/workspace/vanilla/js/api/market-candles.js");
    const nowSlot = Math.floor(Date.now() / 3600000) * 3600000;
    const iso = (ms) => new Date(ms).toISOString().slice(0, -5);
    function chainWith(bucketRows) {
      return {
        history: () => Promise.resolve(2),
        db: () => Promise.resolve(1),
        call: (api, m) => {
          if (m === "get_market_history_buckets") return Promise.resolve([60, 3600]);
          if (m === "get_market_history") return Promise.resolve(bucketRows);
          if (m === "get_assets") return Promise.resolve([{ precision: 5 }, { precision: 4 }]);
          return Promise.resolve([]);
        }
      };
    }
    function mkRow(openMs, ob, oq, cb, cq) {
      return { key: { open: iso(openMs) }, open_base: ob, open_quote: oq, close_base: cb, close_quote: cq, high_base: cb, high_quote: cq, low_base: ob, low_quote: oq, base_volume: "100", quote_volume: "50" };
    }
    // empty arrays -> empty buckets (valid, renders "no history")
    globalThis.Chain = chainWith([]);
    let r = await MC2.candles("1.3.0", "1.3.113", 3600, 5);
    ok(Array.isArray(r.buckets) && r.buckets.length === 0, "candles empty rows -> []");
    // single bucket -> one painted row, leading gaps dropped
    globalThis.Chain = chainWith([mkRow(nowSlot, "100000", "5000", "100000", "5000")]);
    r = await MC2.candles("1.3.0", "1.3.113", 3600, 5);
    ok(r.buckets.length === 1, "candles single bucket paints one");
    // out-of-order rows still map by slot (no throw, no dup)
    globalThis.Chain = chainWith([mkRow(nowSlot, "100000", "5000", "200000", "5000"), mkRow(nowSlot - 3600000, "100000", "5000", "100000", "5000")].reverse());
    r = await MC2.candles("1.3.0", "1.3.113", 3600, 5);
    ok(r.buckets.length >= 1 && r.buckets.length <= 5, "candles out-of-order no throw");
    // future timestamps outside window are ignored (never render future)
    globalThis.Chain = chainWith([mkRow(nowSlot + 86400000 * 30, "100000", "5000", "100000", "5000")]);
    r = await MC2.candles("1.3.0", "1.3.113", 3600, 5);
    ok(r.buckets.length === 0, "candles far-future row dropped");
    // bad timestamps + zero-quote + negative rows treated as gaps (never reject whole)
    globalThis.Chain = chainWith([
      { key: { open: "not-a-time" }, open_base: "1", open_quote: "1", close_base: "1", close_quote: "1", high_base: "1", high_quote: "1", low_base: "1", low_quote: "1", base_volume: "1", quote_volume: "1" },
      { key: { open: iso(nowSlot) }, open_base: "100", open_quote: "0", close_base: "100", close_quote: "0", high_base: "100", high_quote: "0", low_base: "100", low_quote: "0", base_volume: "1", quote_volume: "1" },
      { key: { open: iso(nowSlot - 3600000) }, open_base: "-100", open_quote: "5000", close_base: "-100", close_quote: "5000", high_base: "-100", high_quote: "5000", low_base: "-100", low_quote: "5000", base_volume: "1", quote_volume: "1" },
      mkRow(nowSlot - 7200000, "100000", "5000", "100000", "5000"),
    ]);
    let threw2 = null;
    try { r = await MC2.candles("1.3.0", "1.3.113", 3600, 5); } catch (e) { threw2 = e; }
    ok(threw2 === null, "candles garbage rows never reject whole", threw2 && (threw2.stack || threw2.message));
    if (!threw2) {
      ok(r.buckets.every((b) => !isWrongMoneyString(b.close)), "candles garbage rows no wrong-money");
      ok(r.buckets.every((b) => b.close !== null && b.open !== null), "candles no null-OHLC entries");
    }
    // bad bucket / count throw named
    let badBucket = null; try { await MC2.candles("1.3.0", "1.3.113", 0, 5); } catch (e) { badBucket = e; }
    ok(badBucket && isNamedError(badBucket), "candles bad bucket named");
    let badCount = null; try { await MC2.candles("1.3.0", "1.3.113", 3600, 0); } catch (e) { badCount = e; }
    ok(badCount && isNamedError(badCount), "candles bad count named");
  } catch (e) { ok(false, "candles harness no raw", (e && e.stack || e)); }

  // Chain parsers: blockNumberFromId short/garbage via notice (tip never moves backwards, never throws)
  try {
    const CHAIN_SRC = fs.readFileSync("/workspace/vanilla/js/sdk/chain.js", "utf8");
    function noticeHeads(blockIds) {
      return new Promise((resolve) => {
        let sockets = [];
        class StubWS {
          constructor() { this.readyState = 0; sockets.push(this); }
          send(text) {
            let msg; try { msg = JSON.parse(text); } catch (e) { return; }
            const method = (msg.params || [])[1];
            const respond = (result) => { setImmediate(() => { if (this.onmessage) this.onmessage({ data: JSON.stringify({ id: msg.id, result }) }); }); };
            if (method === "login") respond(null);
            else if (method === "database") respond(2);
            else if (method === "set_block_applied_callback") respond(null);
            else if (method === "get_chain_id") respond("39f5e2ede1f8bc1a3a54a7914414e3779e33193f1f5693510e73cb7a87617447");
            else if (method === "get_dynamic_global_properties") respond({ head_block_number: 100, head_block_id: "060560c4c0d58ccb50f17443302bdc8096e7f34a", time: "2026-01-01T00:00:00" });
            else respond(null);
          }
          close() { this.readyState = 3; if (this.onclose) this.onclose(); }
          open() { this.readyState = 1; if (this.onopen) this.onopen(); }
        }
        const sandbox = { console, setTimeout, clearTimeout, setInterval, clearInterval, WebSocket: StubWS, localStorage: { getItem: () => null, setItem: () => {} }, document: { getElementById: () => null }, Store: { emitConnection: () => {} }, module: { exports: {} } };
        sandbox.globalThis = sandbox;
        vm.createContext(sandbox);
        vm.runInContext(CHAIN_SRC, sandbox, { filename: "sdk/chain.js" });
        const Chain = sandbox.Chain;
        const p = Chain.connect("wss://fake/ws", { timeoutMs: 4000, heartbeatMs: 60000 }).catch(() => null);
        setImmediate(() => { try { sockets[0].open(); } catch (e) {} });
        p.then(async () => {
          await new Promise((rr) => setTimeout(rr, 30));
          const before = Chain.status().headBlock;
          blockIds.forEach((id) => {
            try { sockets[0].onmessage({ data: JSON.stringify({ method: "notice", params: [1, [id]] }) }); } catch (e) {}
          });
          await new Promise((rr) => setTimeout(rr, 30));
          const after = Chain.status().headBlock;
          try { Chain.disconnect(); } catch (e) {}
          resolve({ before, after });
        });
        setTimeout(() => resolve({ before: null, after: null, timeout: true }), 6000);
      });
    }
    let rr = await noticeHeads(["short", "", null, undefined, 12345, "zzzzzzzz00000000000000000000000000000000", "0000000000000000000000000000000000000000"]);
    ok(rr.timeout !== true, "chain garbage block ids harness resolves");
    ok(rr.after === 100, "chain garbage block ids never move tip", "before=" + rr.before + " after=" + rr.after);
    rr = await noticeHeads(["060560c4c0d58ccb50f17443302bdc8096e7f34a"]); // block 0x060560c4 = 101015748
    ok(rr.after === 101015748, "chain good block id advances tip", "after=" + rr.after);
    // props shape: time with trailing Z must PASS (no double-Z reject); garbage must fail named
    function connectProps(props) {
      return new Promise((resolve) => {
        let sockets = [];
        class StubWS {
          constructor() { this.readyState = 0; sockets.push(this); }
          send(text) {
            let msg; try { msg = JSON.parse(text); } catch (e) { return; }
            const method = (msg.params || [])[1];
            const respond = (result) => { setImmediate(() => { if (this.onmessage) this.onmessage({ data: JSON.stringify({ id: msg.id, result }) }); }); };
            if (method === "login") respond(null);
            else if (method === "database") respond(2);
            else if (method === "set_block_applied_callback") respond(null);
            else if (method === "get_chain_id") respond("39f5e2ede1f8bc1a3a54a7914414e3779e33193f1f5693510e73cb7a87617447");
            else if (method === "get_dynamic_global_properties") respond(props);
            else respond(null);
          }
          close() { this.readyState = 3; if (this.onclose) this.onclose(); }
          open() { this.readyState = 1; if (this.onopen) this.onopen(); }
        }
        const sandbox = { console, setTimeout, clearTimeout, setInterval, clearInterval, WebSocket: StubWS, localStorage: { getItem: () => null, setItem: () => {} }, document: { getElementById: () => null }, Store: { emitConnection: () => {} }, module: { exports: {} } };
        sandbox.globalThis = sandbox;
        vm.createContext(sandbox);
        vm.runInContext(fs.readFileSync("/workspace/vanilla/js/sdk/chain.js", "utf8"), sandbox, { filename: "sdk/chain.js" });
        const Chain = sandbox.Chain;
        const pr = Chain.connect("wss://fake/ws", { timeoutMs: 4000, heartbeatMs: 60000 });
        setImmediate(() => { try { sockets[0].open(); } catch (e) {} });
        pr.then((okv) => { try { Chain.disconnect(); } catch (e) {} resolve({ ok: true }); }, (err) => { try { Chain.disconnect(); } catch (e) {} resolve({ ok: false, error: String((err && err.message) || err) }); });
        setTimeout(() => resolve({ ok: false, error: "harness timeout" }), 6000);
      });
    }
    const GOOD40 = "060560c4c0d58ccb50f17443302bdc8096e7f34a";
    let z = await connectProps({ head_block_number: 100, head_block_id: GOOD40, time: "2026-01-01T00:00:00Z" });
    ok(z.ok === true, "chain props time with Z passes (no double-Z bug)", z.error);
    z = await connectProps({ head_block_number: 100, head_block_id: GOOD40, time: "2026-01-01T00:00:00" });
    ok(z.ok === true, "chain props time without Z passes");
    z = await connectProps({ head_block_number: 0, head_block_id: GOOD40, time: "2026-01-01T00:00:00" });
    ok(z.ok === false && /bad-head-shape/.test(z.error), "chain props zero head named reject");
    z = await connectProps({ head_block_number: 100, head_block_id: "short", time: "2026-01-01T00:00:00" });
    ok(z.ok === false && /bad-head-shape/.test(z.error), "chain props short id named reject");
    z = await connectProps(null);
    ok(z.ok === false && /bad-head-shape/.test(z.error), "chain props null named reject");
  } catch (e) { ok(false, "chain harness no raw", (e && e.stack || e)); }

  console.log("robustness-fuzz: " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
})();
