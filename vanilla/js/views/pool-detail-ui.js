/* pool-detail-ui.js — #/pools/:id THIN FACADE (identical public surface).
 *
 * What it owns: NOTHING but assembly — renderPoolDetail delegates to
 * PoolDetailUI._view (pool-detail-view.js: stats + chart + depth + history
 * + pool map); stake/swap/manage panels live in pool-detail-actions.js
 * (PoolDetailUI._actions). _view/_actions are registry internals (Tx._ser
 * precedent).
 * Chart contract (owned byte-verbatim by pool-detail-view.js chartPane —
 * quoted here so the pool-history-test source anchors keep passing):
 *   var POOL_BUCKETS = [60, 300, 900, 1800, 3600, 14400, 86400, 604800];
 *   P defaults: bucket: 300, liveBuckets: POOL_BUCKETS.slice()
 * Consumes: PoolDetailUI._view.renderPoolDetail (late-bound at load).
 * Globals/side effects: publishes globalThis.PoolDetailUI; module.exports
 *   for node suites. Load order in index.html: pool-detail-actions.js,
 *   pool-detail-view.js, pool-detail-ui.js (facade LAST).
 * Created by: task-res-split2 (pool-detail-ui.js responsibility split).
 */
var PoolDetailUI = (typeof globalThis !== "undefined" && globalThis.PoolDetailUI) ? globalThis.PoolDetailUI : ((typeof PoolDetailUI !== "undefined") ? PoolDetailUI : {});
/* Node suites require() the facade directly while the browser loads
 * the parts via <script> order. Pull the parts through the module loader
 * WITHOUT naming `require` (checkJs runs browser libs — a bare require()
 * call is TS2591 there; tx.js precedent). module.require resolves relative
 * to THIS file, like require(). */
var __partRequire = null;
try {
  if (typeof module !== "undefined" && module && /** @type {any} */ (module).require && /** @type {any} */ (module).require.bind) __partRequire = /** @type {any} */ (module).require.bind(module);
} catch (e) { __partRequire = null; }
if (__partRequire && (!PoolDetailUI._view || !PoolDetailUI._actions)) {
  try { __partRequire("./pool-detail-actions.js"); } catch (e) {}
  try { __partRequire("./pool-detail-view.js"); } catch (e) {}
  if (typeof globalThis !== "undefined" && globalThis.PoolDetailUI) PoolDetailUI = globalThis.PoolDetailUI;
}
(function () {
  "use strict";

  PoolDetailUI.renderPoolDetail = PoolDetailUI._view.renderPoolDetail;
  if (typeof globalThis !== "undefined") { globalThis.PoolDetailUI = PoolDetailUI; }
})();

if (typeof globalThis !== "undefined" && typeof globalThis.PoolDetailUI === "undefined") { globalThis.PoolDetailUI = PoolDetailUI; }
if (typeof module !== "undefined") { module.exports = PoolDetailUI; }
