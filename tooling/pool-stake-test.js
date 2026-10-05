#!/usr/bin/env node
/* pool-stake-test.js — pool-desk UX gaps offline vectors + DOM-shape asserts.
 * Covers FIX 3 ratio math (Pool.stakeCounterpart: A->B, B->A, mixed
 * precisions, zero-balance guard, dust flooring) + shareOut wiring, a
 * fake-DOM stakeBoxes behavior test (auto-fill both directions,
 * mirror-clear, share preview line via the REAL view + _ui code), and
 * source-shape asserts for the FIX 1 swap-flip button + FIX 2 chart-invert
 * toggle (ids, keyed aria-labels, BigInt-path orientation).
 * Fake DOM, no chain, no browser. Exit 0 green, 1 red. ES5-free zone:
 * tooling may use modern Node (pool-history-test.js precedent). */
"use strict";

const fs = require("fs");
const path = require("path");

const VANILLA = path.join(__dirname, "..", "vanilla");
const JS = (...segs) => path.join(VANILLA, "js", ...segs);

let pass = 0, fail = 0;
function eq(got, want, name) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else { fail++; console.log("FAIL " + name + "\n  got  " + JSON.stringify(got) + "\n  want " + JSON.stringify(want)); }
}
function ok(cond, name) {
  if (cond) pass++;
  else { fail++; console.log("FAIL " + name); }
}
function throwsRe(fn, re, name) {
  try { fn(); } catch (e) { ok(re.test(String((e && e.message) || e)), name + " (threw " + String((e && e.message) || e).slice(0, 60) + ")"); return; }
  fail++; console.log("FAIL " + name + " (did not throw)");
}

/* Real money modules (pool.js consumes Chain/Format/Account/Tx at call
 * time only — require-time is DOM-free, pool-history-test.js precedent). */
globalThis.Format = require(JS("api", "format.js"));
globalThis.Chain = { call: () => Promise.reject(new Error("no chain in vectors")) };
globalThis.Pool = require(JS("api", "pool.js"));
const Pool = globalThis.Pool;
const Format = globalThis.Format;

/* ---- 1. stakeCounterpart vectors (exact BigInt ratio, floor) ---- */
// A->B: 10.00000 / 20.00000 pool, 1.0 A -> 2.00000 B.
eq(Pool.stakeCounterpart({ srcHuman: "1.0", srcPrec: 5, dstPrec: 5,
  srcBalRaw: "1000000", dstBalRaw: "2000000" }), "2.00000", "ratio A->B");
// B->A: 4.0 B -> 2.00000 A.
eq(Pool.stakeCounterpart({ srcHuman: "4.0", srcPrec: 5, dstPrec: 5,
  srcBalRaw: "2000000", dstBalRaw: "1000000" }), "2.00000", "ratio B->A");
// Mixed precisions: A p5 / B p2, 1.0 A -> 20.00 B.
eq(Pool.stakeCounterpart({ srcHuman: "1.0", srcPrec: 5, dstPrec: 2,
  srcBalRaw: "1000000", dstBalRaw: "20000" }), "20.00", "ratio mixed precisions");
// Zero-balance guard: virgin/empty pool throws, never divides.
throwsRe(() => Pool.stakeCounterpart({ srcHuman: "1.0", srcPrec: 5, dstPrec: 5,
  srcBalRaw: "0", dstBalRaw: "2000000" }), /empty-pool/, "ratio zero src balance guard");
throwsRe(() => Pool.stakeCounterpart({ srcHuman: "1.0", srcPrec: 5, dstPrec: 5,
  srcBalRaw: "1000000", dstBalRaw: "0" }), /empty-pool/, "ratio zero dst balance guard");
// Dust flooring: 1 raw unit against a 1e12/1e6 pool floors to an honest zero.
eq(Pool.stakeCounterpart({ srcHuman: "0.00001", srcPrec: 5, dstPrec: 5,
  srcBalRaw: "1000000000000", dstBalRaw: "1000000" }), "0.00000", "ratio dust floors to zero");
// Floor-not-ceil pin: 1.00001 A against 10/20 floors the last digit down.
eq(Pool.stakeCounterpart({ srcHuman: "1.00001", srcPrec: 5, dstPrec: 5,
  srcBalRaw: "1000000", dstBalRaw: "2000000" }), "2.00002", "ratio floor exact");
// Bad input passes through (view keeps the typed value, preview reports).
throwsRe(() => Pool.stakeCounterpart({ srcHuman: "abc", srcPrec: 5, dstPrec: 5,
  srcBalRaw: "1000000", dstBalRaw: "2000000" }), /bad amount/, "ratio bad input passthrough");

/* ---- 2. shareOut wiring (the preview line's backend) ---- */
eq(Pool.shareOut({ balanceA_raw: "1000000", balanceB_raw: "2000000",
  supply_raw: "500000", inA_raw: "100000", inB_raw: "200000" }).share_raw,
  "50000", "shareOut funded min-of-ratios");
eq(Pool.shareOut({ balanceA_raw: "0", balanceB_raw: "0",
  supply_raw: "0", inA_raw: "100000", inB_raw: "200000" }).share_raw,
  "200000", "shareOut virgin max-raw");
throwsRe(() => Pool.shareOut({ balanceA_raw: "1000000", balanceB_raw: "2000000",
  supply_raw: "500000", inA_raw: "1", inB_raw: "200000" }).share_raw,
  /deposit-too-small/, "shareOut dust reports (never silent zero)");
// Counterpart -> shareOut round trip: auto-filled legs mint > 0.
(function () {
  const bH = Pool.stakeCounterpart({ srcHuman: "1.0", srcPrec: 5, dstPrec: 5,
    srcBalRaw: "1000000", dstBalRaw: "2000000" });
  const s = Pool.shareOut({ balanceA_raw: "1000000", balanceB_raw: "2000000",
    supply_raw: "500000",
    inA_raw: Format.parseAmount("1.0", 5), inB_raw: Format.parseAmount(bH, 5) });
  eq(s.share_raw, "50000", "counterpart legs mint (round trip)");
})();

/* ---- 3. Fake-DOM stakeBoxes behavior (REAL view + REAL _ui) ---- */
function mkEl(tag) {
  const el = {
    tag: String(tag), children: [], attributes: {}, style: {},
    textContent: "", value: "", type: "text", className: "", id: "",
    title: "", placeholder: "", disabled: false, parentNode: null,
    _listeners: {},
  };
  el.setAttribute = function (k, v) { this.attributes[k] = v; if (k === "id") this.id = String(v); };
  el.getAttribute = function (k) { return this.attributes[k]; };
  el.appendChild = function (c) { this.children.push(c); c.parentNode = this; return c; };
  el.removeChild = function (c) {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    return c;
  };
  el.addEventListener = function (t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); };
  el.click = function () { (this._listeners.click || []).slice().forEach((f) => f()); };
  el.fireInput = function () { (this._listeners.input || []).slice().forEach((f) => f()); };
  el.focus = function () {};
  Object.defineProperty(el, "firstChild", { get: function () { return this.children[0] || null; } });
  Object.defineProperty(el, "lastChild", { get: function () { return this.children[this.children.length - 1] || null; } });
  return el;
}
function fakeDoc() {
  return {
    createElement: (tag) => mkEl(tag),
    createTextNode: (text) => ({ nodeType: 3, textContent: String(text) }),
  };
}
function findById(root, id) {
  let found = null;
  (function walk(n) {
    if (!n || found) return;
    if (n.id === id) { found = n; return; }
    (n.children || []).forEach(walk);
  })(root);
  return found;
}
function collectInputs(root) {
  const out = [];
  (function walk(n) {
    if (!n) return;
    if (n.tag === "input") out.push(n);
    (n.children || []).forEach(walk);
  })(root);
  return out;
}

(async () => {
  // Real shared globals (browser script-tag order in index.html).
  globalThis.DOM = require(JS("utils", "dom.js"));
  globalThis.touchable = require(JS("utils", "touchable.js"));
  globalThis.Forms = require(JS("forms", "field.js"));
  const PoolUI = require(JS("views", "pool-ui.js"));
  globalThis.PoolUI = PoolUI;
  // u.touchable is the page wiring contract (FIX 1/2 buttons + existing
  // swap/detail call sites): the shared floor must be reachable via _ui.
  eq(typeof PoolUI._ui.touchable, "function", "_ui exposes touchable (page wiring contract)");
  // Chain-off Asset stub: share supply resolves once, like Asset.describe.
  globalThis.Asset = { describe: () => Promise.resolve({ supply_raw: "500000" }) };
  const DetailActions = require(JS("views", "pool-detail-actions.js"));

  const doc = fakeDoc();
  const box = mkEl("div");
  const r = { id: "1.19.1", asset_a_id: "1.3.0", asset_b_id: "1.3.1",
    balance_a_raw: "1000000", balance_b_raw: "2000000",
    prec_a: 5, prec_b: 5, prec_share: 5,
    sym_a: "BTS", sym_b: "CNY", sym_share: "POOL", share_id: "1.3.2",
    taker_units: 20 };
  DetailActions._actions.stakeBoxes(doc, box, r, 0);

  const ratioLine = findById(box, "pool-stake-ratio");
  const shareLine = findById(box, "pool-stake-shares");
  ok(!!ratioLine, "stake preview ratio line mounted (pool-stake-ratio)");
  ok(!!shareLine, "stake preview share line mounted (pool-stake-shares)");
  eq(ratioLine && ratioLine.textContent,
    "Ratio (spot): 1 BTS ≈ 2.000 CNY", "stake ratio line spot text (4-sf global price rule)");
  ok(shareLine && /Enter both amounts/.test(shareLine.textContent),
    "stake share line starts at need-both hint");

  const inputs = collectInputs(box);
  ok(inputs.length >= 2, "stake exposes Amount A/B inputs (found " + inputs.length + ")");
  const [inA, inB] = inputs;
  ok((inA._listeners.input || []).length === 1 && (inB._listeners.input || []).length === 1,
    "stake wires one input listener per leg (last-edited-wins)");

  // A -> B auto-fill.
  inA.value = "1.0"; inA.fireInput();
  eq(inB.value, "2.00000", "stake typing A auto-fills B at ratio");
  // B -> A auto-fill (last-edited-wins).
  inB.value = "4.0"; inB.fireInput();
  eq(inA.value, "2.00000", "stake typing B auto-fills A at ratio");
  // Mirror-clear.
  inA.value = ""; inA.fireInput();
  eq(inB.value, "", "stake clearing A mirror-clears B");
  // Share preview resolves through the async supply fetch.
  inA.value = "2.0"; inA.fireInput();
  await new Promise((res) => setTimeout(res, 20));
  ok(/Est\. LP shares: 1\.00000 POOL/.test(shareLine.textContent),
    "stake share preview estimates via Pool.shareOut (got " + JSON.stringify(shareLine.textContent) + ")");

  /* ---- 4. Source-shape asserts (FIX 1 flip + FIX 2 invert wiring) ---- */
  const swapSrc = fs.readFileSync(JS("views", "pool-swap-ui.js"), "utf8");
  ok(/id = "swap-flip"/.test(swapSrc), "swap flip button id shape");
  ok(/> "⇄" /.test(swapSrc) || /"⇄"/.test(swapSrc), "swap flip button glyph shape");
  ok(/pool\.swap_direction_label/.test(swapSrc), "swap flip aria-label keyed");
  ok(/find\.click\(\)/.test(swapSrc), "swap flip re-runs the Find-pools lookup");
  const viewSrc = fs.readFileSync(JS("views", "pool-detail-view.js"), "utf8");
  ok(/id = "pool-chart-invert"/.test(viewSrc), "chart invert toggle id shape");
  ok(/pool_detail\.invert/.test(viewSrc), "chart invert label keyed");
  ok(/pool_detail\.invert_label/.test(viewSrc), "chart invert aria-label keyed");
  ok(/aria-pressed/.test(viewSrc), "chart invert exposes pressed state");
  ok(/P\.inverted/.test(viewSrc), "chart invert threads orientation state");
  ok(/orient\.spotRepaint/.test(viewSrc), "chart invert repaints the spot line");
  ok(/orient\.bookRepaint/.test(viewSrc), "chart invert repaints the book");
  ok(/setTape\(P\.swaps/.test(viewSrc), "chart invert repaints the tape");
  // No 1/x float math in the invert path: orientation flows through the
  // swapped-legs BigInt helpers, never a reciprocal. (Comment text stripped
  // before matching; the one pre-existing `1 - Number(ppm)` canvas-pixel
  // line in drawCurve is parts-per-million ints, pixel-only by its own
  // documented contract — never money.)
  const codeOnly = viewSrc
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "");
  const reciprocals = codeOnly.split("\n").filter((ln) =>
    /1\s*\/\s*[a-zA-Z(]/.test(ln) && ln.indexOf("1000000") === -1);
  eq(reciprocals, [], "chart invert carries no reciprocal float math");
  const actSrc = fs.readFileSync(JS("views", "pool-detail-actions.js"), "utf8");
  ok(/stakeCounterpart/.test(actSrc), "stake auto-fill routes through Pool.stakeCounterpart");
  ok(/pool\.stake_autofill_hint/.test(actSrc), "stake auto-fill hint keyed");
  ok(/pool\.stake_shares_row/.test(actSrc), "stake share preview row keyed");
  // i18n: every new key lands in en.json (check_i18n.py owns drift).
  const en = JSON.parse(fs.readFileSync(path.join(VANILLA, "locales", "en.json"), "utf8"));
  const flat = {};
  (function walk(d, p) {
    Object.keys(d).forEach((k) => {
      if (k === "_meta") return;
      if (d[k] && typeof d[k] === "object") walk(d[k], p + k + ".");
      else flat[p + k] = d[k];
    });
  })(en, "");
  ["pool.swap_direction_label", "pool_detail.invert", "pool_detail.invert_label",
   "pool.stake_autofill_hint", "pool.stake_ratio_row", "pool.stake_ratio_empty",
   "pool.stake_shares_row", "pool.stake_preview_need_both",
   "pool.stake_preview_unavailable", "pool.stake_preview_bad",
  ].forEach((k) => ok(Object.prototype.hasOwnProperty.call(flat, k), "en.json carries " + k));

  console.log("Pool-stake vectors: " + pass + " pass, " + fail + " fail");
  process.exit(fail ? 1 : 0);
})().catch((e) => { fail++; console.log("FAIL harness\n " + (e && e.stack || e)); console.log("Pool-stake vectors: " + pass + " pass, " + fail + " fail"); process.exit(1); });
