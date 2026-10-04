/* market-ind.js — DEX indicators THIN FACADE (identical public surface).
 *
 * What it owns: NOTHING but assembly — every export delegates to the
 * task-res-split2 registries: series math in market-ind-series.js
 * (MarketInd._series: ind/priceOverlays/oscOne/readSlot/OVERLAY_SPECS) and
 * pane rendering + controls in market-ind-panes.js (MarketInd._panes:
 * everything else). _series/_panes are registry internals (Tx._ser
 * precedent). CANDLE_COUNT keeps the original load-time snapshot semantics
 * (paintCountInput refreshes the live global + the _panes snapshot together).
 * Consumes: MarketInd._series + MarketInd._panes (late-bound at load).
 * Globals/side effects: publishes globalThis.MarketInd; module.exports for
 *   node suites (chart-zoom-test, pool-history-test require this path).
 *   Load order in index.html: market-ind-series.js, market-ind-panes.js,
 *   market-ind.js (facade LAST — it reads both registries at load).
 * Created by: task-res-split2 (market-ind.js responsibility split).
 */
var MarketInd = (typeof globalThis !== "undefined" && globalThis.MarketInd) ? globalThis.MarketInd : ((typeof MarketInd !== "undefined") ? MarketInd : {});
/* Node suites require() the facade directly while the browser loads
 * the parts via <script> order. Pull the parts through the module loader
 * WITHOUT naming `require` (checkJs runs browser libs — a bare require()
 * call is TS2591 there; tx.js precedent). module.require resolves relative
 * to THIS file, like require(). */
var __partRequire = null;
try {
  if (typeof module !== "undefined" && module && module.require && module.require.bind) __partRequire = module.require.bind(module);
} catch (e) { __partRequire = null; }
if (__partRequire && (!MarketInd._series || !MarketInd._panes)) {
  try { __partRequire("./market-ind-series.js"); } catch (e) {}
  try { __partRequire("./market-ind-panes.js"); } catch (e) {}
  if (typeof globalThis !== "undefined" && globalThis.MarketInd) MarketInd = globalThis.MarketInd;
}
(function () {
  "use strict";

  /* Shared read-only constants for the desk: bucket shortlist + candle
   * count (fill reconciliation) and pane order + indicator lookup (desk
   * checkbox wiring must match drawCharts pane order — single source). */
  MarketInd.drawCharts = MarketInd._panes.drawCharts;
  MarketInd.maybeDraw = MarketInd._panes.maybeDraw;
  MarketInd.renderStrip = MarketInd._panes.renderStrip;
  MarketInd.paintCountNote = MarketInd._panes.paintCountNote;
  MarketInd.paintTimeframes = MarketInd._panes.paintTimeframes;
  MarketInd.paintCountInput = MarketInd._panes.paintCountInput;
  MarketInd.renderIndMenu = MarketInd._panes.renderIndMenu;
  MarketInd.PREF_BUCKETS = MarketInd._panes.PREF_BUCKETS;
  MarketInd.CANDLE_COUNT = MarketInd._panes.CANDLE_COUNT;
  MarketInd.reconcileBuckets = MarketInd._panes.reconcileBuckets;
  MarketInd.bucketLabel = MarketInd._panes.bucketLabel;
  MarketInd._test = MarketInd._panes._test;
  MarketInd.OSC_ORDER = MarketInd._panes.OSC_ORDER;
  MarketInd.OVERLAY_DEFS = MarketInd._panes.OVERLAY_DEFS;
  MarketInd.OVERLAY_SPECS = MarketInd._series.OVERLAY_SPECS;
  MarketInd.priceOverlays = MarketInd._series.priceOverlays;
  MarketInd.overlayLabel = MarketInd._panes.overlayLabel;
  MarketInd.ind = MarketInd._series.ind;
  if (typeof globalThis !== "undefined") { globalThis.MarketInd = MarketInd; }
})();

if (typeof module !== "undefined") { module.exports = MarketInd; }
