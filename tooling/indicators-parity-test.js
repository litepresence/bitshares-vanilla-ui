#!/usr/bin/env node
/* Indicator parity vectors, round 2 (Tulip gap + QX add-ons).
 * Loads the 6 indicator files in index.html order, checks hand-computed
 * vectors (exact where integer-clean, 1e-9 approx otherwise).
 * Exit 0 green, 1 red. */
"use strict";
const I = require("/workspace/vanilla/js/api/indicators.js");
require("/workspace/vanilla/js/api/indicators-osc.js");
require("/workspace/vanilla/js/api/indicators-tulip.js");
require("/workspace/vanilla/js/api/indicators-tmom.js");
require("/workspace/vanilla/js/api/indicators-tvol.js");
require("/workspace/vanilla/js/api/indicators-qx.js");

let pass = 0, fail = 0;
function eq(got, want, name) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else { fail++; console.log("FAIL " + name + "\n  got  " + JSON.stringify(got) + "\n  want " + JSON.stringify(want)); }
}
function approx(got, want, name, tol) {
  tol = tol || 1e-9;
  const ok = Array.isArray(got) && got.length === want.length && got.every((v, i) => {
    if (v === null && want[i] === null) return true;
    if (v === null || want[i] === null) return false;
    return Math.abs(v - want[i]) <= tol;
  });
  if (ok) pass++;
  else { fail++; console.log("FAIL " + name + "\n  got  " + JSON.stringify(got) + "\n  want " + JSON.stringify(want)); }
}
function bounds(got, lo, hi, name) {
  const ok = got.every((v) => v === null || (v >= lo && v <= hi));
  if (ok) pass++;
  else { fail++; console.log("FAIL " + name + " out of [" + lo + "," + hi + "]: " + JSON.stringify(got)); }
}
function nonNullTail(got, name) {
  const ok = got.length > 0 && got[got.length - 1] !== null;
  if (ok) pass++;
  else { fail++; console.log("FAIL " + name + " tail null: " + JSON.stringify(got)); }
}

const ramp = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const flat40 = [];
for (let i = 0; i < 40; i++) flat40.push(5);
const flat = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5];
const hi = ramp.map((v) => v + 1), lo = ramp.map((v) => v - 1);
const vol = ramp.map(() => 10);

// --- tulip overlap ---
eq(I.dema([1, 2, 3, 4, 5], 3), [null, null, null, null, 5], "dema ramp");
eq(I.tema(flat, 3).slice(-1), [5], "tema flat");
approx(I.wma([1, 2, 3], 3), [null, null, 14 / 6], "wma");
eq(I.wilders([10, 10, 10, 10], 3), [10, 10, 10, 10], "wilders flat");
approx(I.vwma([1, 2, 3], [1, 1, 1], 3), [null, null, 2], "vwma");
approx(I.linreg([1, 2, 3, 4], 4), [null, null, null, 4], "linreg");
approx(I.linregslope([1, 2, 3, 4], 4), [null, null, null, 1], "linregslope");
approx(I.tsf([1, 2, 3, 4], 4), [null, null, null, 4], "tsf==linreg");
eq(I.kama(flat, 3).slice(-1), [5], "kama flat");
approx(I.md([1, 2, 3], 3), [null, null, 2 / 3], "md");
eq(I.vidya(flat, { short: 2, long: 3 }).slice(-1), [5], "vidya flat");

// --- tmom ---
eq(I.mom([1, 2, 3, 4, 5, 6], 5).slice(-1), [5], "mom");
eq(I.roc([10, 20], 1).slice(-1), [1], "roc");
eq(I.rocr([10, 20], 1).slice(-1), [2], "rocr");
approx(I.willr([1, 2, 3], [1, 1, 1], [1, 2, 3], 3), [null, null, 0], "willr top");
approx(I.cci([2, 2, 2], [1, 1, 1], [1.5, 1.5, 1.5], 3), [null, null, 0], "cci flat");
eq(I.cmo([1, 2, 3, 4], 3).slice(-1), [100], "cmo all-up");
bounds(I.stochrsi(ramp, 5), 0, 100, "stochrsi bounds");
bounds(I.ultosc(hi, lo, ramp, {}), 0, 100, "ultosc bounds");
bounds(I.rsi ? I.stochrsi(ramp, 14) : [], 0, 100, "stochrsi14 bounds");
nonNullTail(I.trix(ramp, 5), "trix tail");
approx(I.bop([1, 1], [3, 3], [1, 1], [2, 2]), [0.5, 0.5], "bop");
eq(I.qstick(flat, flat, 3).slice(-1), [0], "qstick flat");
approx(I.apo(flat40, {}).slice(-1), [0], "apo flat");
approx(I.ppo(flat40, {}).slice(-1), [0], "ppo flat");
nonNullTail(I.aroon(hi, lo, 5).up, "aroon up tail");
nonNullTail(I.dx(hi, lo, 5), "dx tail");
(function () {
  const d = I.di(hi, lo, 5);
  (d.plus[d.plus.length - 1] > d.minus[d.minus.length - 1] ? pass++ : (fail++, console.log("FAIL di trend")));
})();
nonNullTail(I.adxr(hi, lo, 5), "adxr tail");

// --- tvol ---
eq(I.obv([1, 2, 3], [10, 10, 10]), [0, 10, 20], "obv");
eq(I.ad([2, 2], [1, 1], [1.5, 1.5], [10, 10]), [0, 0], "ad flat");
eq(I.nvi(ramp.slice(0, 6), [10, 10, 10, 10, 10, 10]).slice(-1), [1000], "nvi const-vol");
eq(I.pvi(ramp.slice(0, 6), [10, 10, 10, 10, 10, 10]).slice(-1), [1000], "pvi const-vol");
approx(I.vosc([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10], {}).slice(-1), [0], "vosc flat");
eq(I.wad(flat, [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4], flat).slice(-1), [0], "wad flat");
eq(I.cvi(flat, flat.map(() => 4), 3).slice(-1), [0], "cvi flat");
eq(I.vhf(flat, 3).slice(-1), [0], "vhf flat");
eq(I.volatility(flat, 3).slice(-1), [0], "vol flat");
nonNullTail(I.natr(hi, lo, ramp, 5), "natr tail");
nonNullTail(I.emv(hi, lo, vol.slice(0, 20)), "emv tail");
nonNullTail(I.kvo(hi, lo, ramp, vol, { fast: 3, slow: 5 }), "kvo tail");
nonNullTail(I.adosc(hi, lo, ramp, vol, {}), "adosc tail");
nonNullTail(I.dpo(ramp, 5), "dpo tail");
(function () {
  const c50 = [];
  for (let i = 1; i <= 50; i++) c50.push(i);
  const m = I.mass(c50.map((v) => v + 1), c50.map((v) => v - 1));
  ((m[m.length - 1] !== null && Math.abs(m[m.length - 1] - 25) < 1e-9) ? pass++ : (fail++, console.log("FAIL mass tail " + JSON.stringify(m.slice(-1)))));
})();

// --- qx ---
(function () {
  const v = I.vortex(hi, lo, ramp, 5);
  ((v.plus.every((x) => x === null || x >= 0) && v.minus.every((x) => x === null || x >= 0)) ? pass++ : (fail++, console.log("FAIL vortex sign")));
})();
nonNullTail(I.kst(ramp, { r1: 2, r2: 3, r3: 4, r4: 5, sig: 2 }).kst, "kst tail");
eq(I.zigzag(flat, 5).line.slice(-1), [5], "zigzag flat");
nonNullTail(I.ravi(hi, lo, ramp, { short: 3, long: 5 }), "ravi tail");
eq(I.aema(flat, {}).slice(-1), [5], "aema flat");
(function () {
  const r40 = [];
  for (let i = 1; i <= 40; i++) r40.push(i);
  const t = I.tsi(r40, {});
  ((t[t.length - 1] !== null && t[t.length - 1] > 0) ? pass++ : (fail++, console.log("FAIL tsi sign " + JSON.stringify(t))));
})();
(function () {
  const s = I.smi(hi, lo, ramp, {});
  nonNullTail(s.smi, "smi tail"); nonNullTail(s.signal, "smi signal tail");
})();
(function () {
  const e = I.eri(hi, lo, ramp, 5);
  nonNullTail(e.bull, "eri bull tail"); nonNullTail(e.minus || e.bear, "eri bear tail");
})();
eq(I.awesome(flat, flat.map(() => 4), { short: 2, long: 4 }).slice(-1), [0], "awesome flat");
(function () {
  const st = I.supertrend(hi, lo, ramp, {});
  nonNullTail(st.trend, "supertrend tail");
})();
bounds(I.arsi(ramp, 5), 0, 100, "arsi bounds");
(function () {
  const k = I.keltner(hi, lo, ramp, {});
  ((k.upper[k.upper.length - 1] >= k.middle[k.middle.length - 1] && k.middle[k.middle.length - 1] >= k.lower[k.lower.length - 1]) ? pass++ : (fail++, console.log("FAIL keltner order")));
})();
(function () {
  const d = I.donchian(hi, lo, 5);
  const i = d.upper.length - 1;
  ((d.upper[i] >= d.middle[i] && d.middle[i] >= d.lower[i]) ? pass++ : (fail++, console.log("FAIL donchian order")));
})();
eq(I.ulcer(flat, 3).slice(-1), [0], "ulcer flat");
bounds(I.earsi(ramp, {}), 0, 100, "earsi bounds");
(function () {
  const h = I.holtwinters(flat, {});
  (h.smooth[h.smooth.length - 1] === 5 ? pass++ : (fail++, console.log("FAIL holt flat")));
})();
eq(I.kagi(flat, 2).slice(-1), [5], "kagi flat");

console.log("Vectors: " + pass + " pass, " + fail + " fail");
process.exit(fail ? 1 : 0);
