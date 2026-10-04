/* market-ind-series.js — DEX indicator SERIES math (no DOM, no fetching).
 *
 * What it owns: the indicator lookup (ind, guarded — null means unavailable),
 * pixel converters (numOrNull/numOrNaN — chart-pixel inputs only), the
 * meshable price-overlay specs (OVERLAY_SPECS + legacy OVERLAY_FIXED), the
 * price-pane overlay builder (priceOverlays) and the stacked sub-pane series
 * builder (oscOne), plus the candle-slot reader (readSlot — verbatim
 * extraction of the maybeDraw loop body; raw integer money never enters,
 * volume Numbers are pixels-only from human strings). Pure series math:
 * every function takes values in and returns values out.
 * Consumes: Indicators.* (via ind(), guarded), nothing else. No DOM, no
 *   timers, no signing, no chain I/O. t() is a verbatim copy of the
 *   market-ind.js helper (overlayLabel labels only).
 * Globals/side effects: attaches MarketInd._series and republishes
 *   globalThis.MarketInd; no state of its own. market-ind-panes.js calls
 *   these at draw time via MarketInd._series (late-bound).
 * Created by: task-res-split2 (market-ind.js responsibility split —
 *   indicators half; bodies moved verbatim). Facade: market-ind.js.
 *   Load order in index.html: market-ind-series.js, market-ind-panes.js,
 *   market-ind.js (facade last).
 */
var MarketInd = (typeof globalThis !== "undefined" && globalThis.MarketInd) ? globalThis.MarketInd : ((typeof MarketInd !== "undefined") ? MarketInd : {});
MarketInd._series = MarketInd._series || {};
(function () {
  "use strict";

  /* Verbatim copy of market-ind.js t() (same per-file convention as the explorer/vote-slate splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared chart/vote abstraction. */
  /* Batch-2b i18n (slice-17): display strings resolve via I18n.t with
   * the pre-conversion literal kept verbatim as enDefault (English-identical
   * on any transport, incl. file:// where dict fetch fails). Falls back to
   * the default when i18n.js failed to load: never blank, never throws. */
  function t(key, dflt) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt);
    } catch (e) { /* default below */ }
    return dflt;
  }

  /* No local el — use DOM.el */

  /* Touch floor (principle #7): interactive elements >= 44px one dimension. */
/* Short label for a bucket size in seconds (label text only, not money). */

  /* Indicator lookup with availability guard. indicators.js (SMA/EMA/BB/PSAR)
   * and indicators-osc.js (RSI/MACD/Stoch/ATR/Fisher/...) are both wired in
   * index.html, so every picker key resolves in the browser — the null path
   * below is a robustness guard only (callers treat null as "unavailable",
   * never throw). */
  function ind(name) {
    try {
      if (typeof Indicators !== "undefined" && Indicators &&
          typeof Indicators[name] === "function") return Indicators[name];
    } catch (e) { /* unavailable */ }
    return null;
  }

  /* Finite Number or null (chart-pixel inputs only — OHLC human strings become
   * coordinates here; raw integer money never enters). Merged here with the
   * fill→chart path they serve (maybeDraw/priceOverlays below). */
  function numOrNull(v) {
    return (typeof v === "number" && isFinite(v)) ? v : null;
  }

  /* Null/non-finite -> NaN (Indicators warmup convention). */
  function numOrNaN(v) {
    return (typeof v === "number" && isFinite(v)) ? v : NaN;
  }

  /* Overlay specs (meshable price plots): exactly ONE adjustable number each
   * (period, deviation %, or PSAR step) — validated + clamped in the menu,
   * never trusted raw. kind selects the data legs; run() calls the indicator
   * fn and returns either one values array or [upper, mid, lower] when
   * lines: 3 (bands share the muted/accent/muted convention; single lines
   * rotate the theme palette so a 5/10/50 mesh reads apart). Fixed-param
   * overlays (vidya/aema/holtwinters — multi-knob fns) keep legacy single
   * checkbox rows in the menu (OVERLAY_FIXED). Defaults equal today's
   * hardcoded values, so the default desk (SMA 10 + EMA 50) is unchanged. */
  var OVERLAY_SPECS = {
    sma: { label: "SMA", fn: "sma", param: { name: "period", def: 10, min: 2, max: 500 },
      run: function (f, a, p) { return f(a.closes, Math.round(p)); } },
    ema: { label: "EMA", fn: "ema", param: { name: "period", def: 50, min: 2, max: 500 },
      run: function (f, a, p) { return f(a.closes, Math.round(p)); } },
    dema: { label: "DEMA", fn: "dema", param: { name: "period", def: 21, min: 2, max: 500 },
      run: function (f, a, p) { return f(a.closes, Math.round(p)); } },
    tema: { label: "TEMA", fn: "tema", param: { name: "period", def: 21, min: 2, max: 500 },
      run: function (f, a, p) { return f(a.closes, Math.round(p)); } },
    wma: { label: "WMA", fn: "wma", param: { name: "period", def: 9, min: 2, max: 500 },
      run: function (f, a, p) { return f(a.closes, Math.round(p)); } },
    kama: { label: "KAMA", fn: "kama", param: { name: "period", def: 10, min: 2, max: 500 },
      run: function (f, a, p) { return f(a.closes, Math.round(p)); } },
    linreg: { label: "LINREG", fn: "linreg", param: { name: "period", def: 14, min: 2, max: 500 },
      run: function (f, a, p) { return f(a.closes, Math.round(p)); } },
    tsf: { label: "TSF", fn: "tsf", param: { name: "period", def: 14, min: 2, max: 500 },
      run: function (f, a, p) { return f(a.closes, Math.round(p)); } },
    vwma: { label: "VWMA", fn: "vwma", param: { name: "period", def: 20, min: 2, max: 500 },
      run: function (f, a, p) { return f(a.closes, a.vols, Math.round(p)); } },
    bb: { label: "BB", fn: "bbands", lines: 3, param: { name: "period", def: 20, min: 2, max: 500 },
      run: function (f, a, p) { var r = f(a.closes, { period: Math.round(p), stddev: 2 }); return [r.upper, r.middle, r.lower]; } },
    psar: { label: "PSAR", fn: "psar", param: { name: "step", def: 0.02, min: 0.005, max: 0.5 },
      run: function (f, a, p) { return f(a.highs, a.lows, { step: p, max: 0.2 }); } },
    keltner: { label: "Keltner", fn: "keltner", lines: 3, param: { name: "period", def: 20, min: 2, max: 500 },
      run: function (f, a, p) { var r = f(a.highs, a.lows, a.closes, { atr: Math.round(p), ema: Math.round(p) }); return [r.upper, r.middle, r.lower]; } },
    donchian: { label: "Donchian", fn: "donchian", lines: 3, param: { name: "period", def: 20, min: 2, max: 500 },
      run: function (f, a, p) { var r = f(a.highs, a.lows, Math.round(p)); return [r.upper, r.middle, r.lower]; } },
    supertrend: { label: "Supertrend", fn: "supertrend", param: { name: "period", def: 14, min: 2, max: 500 },
      run: function (f, a, p) { return f(a.highs, a.lows, a.closes, { period: Math.round(p) }).trend; } },
    zigzag: { label: "ZigZag", fn: "zigzag", param: { name: "deviation %", def: 5, min: 0.5, max: 20 },
      run: function (f, a, p) { return f(a.closes, p).line; } },
    kagi: { label: "KAGI", fn: "kagi", param: { name: "deviation %", def: 2, min: 0.5, max: 20 },
      run: function (f, a, p) { return f(a.closes, p); } }
  };

  /* Fixed-param overlays: legacy single-checkbox rows (no mesh UI). */
  var OVERLAY_FIXED = ["vidya", "aema", "holtwinters"];

  /* Price-pane overlay lines from instance lists. state.over maps key ->
   * [{p: number}, ...] (mesh: several periods of one indicator); legacy
   * booleans (true = one default instance) are normalized, never thrown on.
   * Each entry is {name, color, values} aligned to the candle slots (warmup
   * nulls break the line, never dive to zero). Unavailable fns are skipped
   * (see ind()), never throw. */
  function priceOverlays(state, closes, highs, lows, vols, C) {
    var out = [];
    var over = (state && state.over) || {};
    /* Legacy booleans -> instance lists (pool/exchange inits already ship
     * lists; this only guards foreign states). */
    Object.keys(over).forEach(function (k) {
      if (over[k] === true) over[k] = [{}];
      else if (!Array.isArray(over[k])) over[k] = [];
    });
    var palette = [C.buy, C.sell, C.accent, C.warn, C.muted];
    var ci = 0;
    var legs = { closes: closes, highs: highs, lows: lows, vols: vols };
    /* nextColor: round-robin overlay leg color from the theme palette. */
    function nextColor() { var c = palette[ci % palette.length]; ci++; return c; }
    /* clampP: user period into the spec's [min,max] (non-numbers take the
     * spec default). Returns a finite number, never throws. */
    function clampP(spec, p) {
      var v = (typeof p === "number" && isFinite(p)) ? p : spec.param.def;
      if (v < spec.param.min) return spec.param.min;
      if (v > spec.param.max) return spec.param.max;
      return v;
    }
    try {
      Object.keys(OVERLAY_SPECS).forEach(function (key) {
        var spec = OVERLAY_SPECS[key];
        var list = over[key] || [];
        if (!list.length) return;
        var f = ind(spec.fn);
        if (!f) return;
        list.forEach(function (inst) {
          var p = clampP(spec, inst ? inst.p : null);
          var tag = spec.label + " " + p;
          try {
            if (spec.lines === 3) {
              var r3 = spec.run(f, legs, p);
              out.push({ name: tag + " upper", color: C.muted, values: r3[0] });
              out.push({ name: tag + " mid", color: C.accent, values: r3[1] });
              out.push({ name: tag + " lower", color: C.muted, values: r3[2] });
            } else {
              out.push({ name: tag, color: nextColor(), values: spec.run(f, legs, p) });
            }
          } catch (e) { /* one bad instance never kills the pane */ }
        });
      });
      var f;
      if (over.vidya && over.vidya.length && (f = ind("vidya"))) {
        out.push({ name: "VIDYA", color: C.muted, values: f(closes, {}) });
      }
      if (over.aema && over.aema.length && (f = ind("aema"))) {
        out.push({ name: "AEMA 14", color: C.muted, values: f(closes, {}) });
      }
      if (over.holtwinters && over.holtwinters.length && (f = ind("holtwinters"))) {
        out.push({ name: "HOLT", color: C.accent, values: f(closes, {}).smooth });
      }
    } catch (e) { /* one bad overlay must not kill the pane */ }
    return out;
  }

  /* ONE stacked sub-pane's series for a single key (Task 4b) -> line entries
   * for drawOscPane, or {missing: key} when the indicator fn is unavailable
   * in this build (drawCharts renders the note; see ind()). MACD/Stoch/
   * Fisher emit two lines each. Volume needs no indicator fn: its values are
   * the cached human baseVolume Numbers (pixels-only, prepared in maybeDraw
   * from market.js human strings) and histogram:true selects the
   * HistogramSeries LWC path (canvas fallback stays a line chart). */
  function oscOne(key, state, closesNaN, highsNaN, lowsNaN, vols, C, opensNaN) {
    if (key === "volume") {
      return {
        series: [{ name: "Volume", color: C.accent, values: vols || [] }],
        missing: null, histogram: true
      };
    }
    var f = ind(key);
    if (!f) return { series: [], missing: key, histogram: false };
    /* Single-line helper: one named series, no options. */
    function one(name, color, values) {
      return { series: [{ name: name, color: color, values: values }], missing: null, histogram: false };
    }
    try {
      if (key === "rsi") {
        return {
          series: [{ name: "RSI 14", color: C.accent, values: f(closesNaN, { period: 14 }) }],
          missing: null, histogram: false
        };
      }
      if (key === "macd") {
        var m = f(closesNaN, { short: 12, long: 26, signal: 9 });
        return {
          series: [
            { name: "MACD", color: C.accent, values: m.macd },
            { name: "Signal", color: C.muted, values: m.signal }
          ],
          missing: null, histogram: false
        };
      }
      if (key === "stoch") {
        var s = f(highsNaN, lowsNaN, closesNaN, { kPeriod: 5, kSlowing: 3, dPeriod: 3 });
        return {
          series: [
            { name: "%K", color: C.accent, values: s.k },
            { name: "%D", color: C.muted, values: s.d }
          ],
          missing: null, histogram: false
        };
      }
      if (key === "atr") {
        return {
          series: [{ name: "ATR 14", color: C.accent, values: f(highsNaN, lowsNaN, closesNaN, { period: 14 }) }],
          missing: null, histogram: false
        };
      }
      if (key === "fisher") {
        var fi = f(highsNaN, lowsNaN, { period: 9 });
        return {
          series: [
            { name: "Fisher", color: C.accent, values: fi.fisher },
            { name: "Trigger", color: C.muted, values: fi.signal }
          ],
          missing: null, histogram: false
        };
      }
      /* Parity-round panes (defaults = each fn's own defaults; multi-line
       * where the indicator is natively multi-line). */
      if (key === "stochrsi") return one("StochRSI 14", C.accent, f(closesNaN, 14));
      if (key === "adxr") return one("ADXR 14", C.accent, f(highsNaN, lowsNaN, 14));
      if (key === "cci") return one("CCI 20", C.accent, f(highsNaN, lowsNaN, closesNaN, 20));
      if (key === "cmo") return one("CMO 14", C.accent, f(closesNaN, 14));
      if (key === "dx") return one("DX 14", C.accent, f(highsNaN, lowsNaN, 14));
      if (key === "mom") return one("MOM 12", C.accent, f(closesNaN, 12));
      if (key === "roc") return one("ROC 12", C.accent, f(closesNaN, 12));
      if (key === "trix") return one("TRIX 15", C.accent, f(closesNaN, 15));
      if (key === "ultosc") {
        return one("UltOsc", C.accent, f(highsNaN, lowsNaN, closesNaN, {}));
      }
      if (key === "willr") return one("WillR 14", C.accent, f(highsNaN, lowsNaN, closesNaN, 14));
      if (key === "apo") return one("APO", C.accent, f(closesNaN, {}));
      if (key === "ppo") return one("PPO", C.accent, f(closesNaN, {}));
      if (key === "bop") {
        return one("BOP", C.accent, f(opensNaN || closesNaN, highsNaN, lowsNaN, closesNaN));
      }
      if (key === "qstick") {
        return one("QStick 8", C.accent, f(opensNaN || closesNaN, closesNaN, 8));
      }
      if (key === "obv") return one("OBV", C.accent, f(closesNaN, vols));
      if (key === "emv") return one("EMV", C.accent, f(highsNaN, lowsNaN, vols));
      if (key === "vosc") return one("VOSC", C.accent, f(vols, {}));
      if (key === "nvi") return one("NVI", C.accent, f(closesNaN, vols));
      if (key === "pvi") return one("PVI", C.accent, f(closesNaN, vols));
      if (key === "wad") return one("WAD", C.accent, f(highsNaN, lowsNaN, closesNaN));
      if (key === "ad") return one("AD", C.accent, f(highsNaN, lowsNaN, closesNaN, vols));
      if (key === "cvi") return one("CVI 10", C.accent, f(highsNaN, lowsNaN, 10));
      if (key === "natr") return one("NATR 14", C.accent, f(highsNaN, lowsNaN, closesNaN, 14));
      if (key === "mass") return one("Mass", C.accent, f(highsNaN, lowsNaN));
      if (key === "kvo") return one("KVO", C.accent, f(highsNaN, lowsNaN, closesNaN, vols, {}));
      if (key === "adosc") return one("ADOSC", C.accent, f(highsNaN, lowsNaN, closesNaN, vols, {}));
      if (key === "dpo") return one("DPO 21", C.accent, f(closesNaN, 21));
      if (key === "vhf") return one("VHF 28", C.accent, f(closesNaN, 28));
      if (key === "volatility") return one("Volatility 14", C.accent, f(closesNaN, 14));
      if (key === "aroon") {
        var ar = f(highsNaN, lowsNaN, 25);
        return {
          series: [
            { name: "Aroon Up", color: C.accent, values: ar.up },
            { name: "Aroon Down", color: C.muted, values: ar.down }
          ],
          missing: null, histogram: false
        };
      }
      if (key === "di") {
        var dd = f(highsNaN, lowsNaN, 14);
        return {
          series: [
            { name: "+DI", color: C.accent, values: dd.plus },
            { name: "-DI", color: C.muted, values: dd.minus }
          ],
          missing: null, histogram: false
        };
      }
      if (key === "vortex") {
        var vx = f(highsNaN, lowsNaN, closesNaN, 14);
        return {
          series: [
            { name: "+VI", color: C.accent, values: vx.plus },
            { name: "-VI", color: C.muted, values: vx.minus }
          ],
          missing: null, histogram: false
        };
      }
      if (key === "kst") {
        var ks = f(closesNaN, {});
        return {
          series: [
            { name: "KST", color: C.accent, values: ks.kst },
            { name: "Signal", color: C.muted, values: ks.signal }
          ],
          missing: null, histogram: false
        };
      }
      if (key === "ravi") return one("RAVI", C.accent, f(highsNaN, lowsNaN, closesNaN, {}));
      if (key === "tsi") return one("TSI", C.accent, f(closesNaN, {}));
      if (key === "smi") {
        var sm = f(highsNaN, lowsNaN, closesNaN, {});
        return {
          series: [
            { name: "SMI", color: C.accent, values: sm.smi },
            { name: "Signal", color: C.muted, values: sm.signal }
          ],
          missing: null, histogram: false
        };
      }
      if (key === "eri") {
        var er = f(highsNaN, lowsNaN, closesNaN, 13);
        return {
          series: [
            { name: "Bull", color: C.accent, values: er.bull },
            { name: "Bear", color: C.muted, values: er.bear }
          ],
          missing: null, histogram: false
        };
      }
      if (key === "awesome") return one("Awesome", C.accent, f(highsNaN, lowsNaN, {}));
      if (key === "arsi") return one("ARSI 14", C.accent, f(closesNaN, 14));
      if (key === "ulcer") return one("Ulcer 14", C.accent, f(closesNaN, 14));
      if (key === "earsi") return one("EARSI", C.accent, f(closesNaN, {}));
    } catch (e) {
      return { series: [], missing: key, histogram: false };
    }
    return { series: [], missing: null, histogram: false };
  }

  /* Read one candle bucket into the pixel-ready series arrays at index i
   * (verbatim extraction of the maybeDraw loop body — chart-pixel inputs
   * only; raw integer money never enters. Volume -> Number is PIXELS-ONLY:
   * the source is market.js buckets[].baseVolume, a human string already
   * scaled by Format.formatAmount — never a raw int, never float math). */
  function readSlot(buckets, i, into) {
    into.closes[i] = numOrNull(Number(buckets[i] ? buckets[i].close : NaN));
    into.highs[i] = numOrNull(Number(buckets[i] ? buckets[i].high : NaN));
    into.lows[i] = numOrNull(Number(buckets[i] ? buckets[i].low : NaN));
    into.opens[i] = numOrNull(Number(buckets[i] ? buckets[i].open : NaN));
    into.times[i] = Math.floor(((buckets[i] && buckets[i].timeMs) || 0) / 1000);
    var bv = buckets[i] ? buckets[i].baseVolume : null;
    into.vols[i] = bv === null || bv === undefined ? null : numOrNull(Number(bv));
  }
  MarketInd._series.ind = ind;
  MarketInd._series.numOrNull = numOrNull;
  MarketInd._series.numOrNaN = numOrNaN;
  MarketInd._series.OVERLAY_SPECS = OVERLAY_SPECS;
  MarketInd._series.OVERLAY_FIXED = OVERLAY_FIXED;
  MarketInd._series.priceOverlays = priceOverlays;
  MarketInd._series.oscOne = oscOne;
  MarketInd._series.readSlot = readSlot;
  if (typeof globalThis !== "undefined") { globalThis.MarketInd = MarketInd; }
})();

if (typeof module !== "undefined") { module.exports = MarketInd; }
