/* trade-form.js — DEX buy/sell/scaled order forms entry (FACADE).
 * Owns: NOTHING but delegation — renderDual keeps the exact name the desk
 *   (market-desk.js via trade-ui.js) uses. Bodies live in the res-split1
 *   files: exact math + expiry + fee primitives + send/prove in
 *   trade-core.js (TradeCore) and all dual-panel DOM (locked quotes, forms,
 *   confirms, scaled) in trade-panels.js (TradePanels).
 * Load order: any — renderDual resolves TradePanels at CALL time, and node
 *   suites resolve it through module.require below (tx.js precedent:
 *   module.require, never a bare require, so checkJs stays TS2591-clean).
 *   Browser <script> order (wired by the controller): trade-core.js,
 *   trade-panels.js, then this facade.
 * Surface: renderDual (identical to the pre-split file — same global, same
 *   signature).
 */
var __splRequire = null;
try {
  if (typeof module !== "undefined" && module && (/** @type {any} */ (module)).require && (/** @type {any} */ (module)).require.bind) __splRequire = (/** @type {any} */ (module)).require.bind(module);
} catch (e) { __splRequire = null; }

var __tradePanels = null;
function __tradepanels() {
  if (__tradePanels) return __tradePanels;
  try { if (typeof TradePanels !== "undefined" && TradePanels) { __tradePanels = TradePanels; return __tradePanels; } } catch (e) {}
  try { if (typeof globalThis !== "undefined" && globalThis.TradePanels) { __tradePanels = globalThis.TradePanels; return __tradePanels; } } catch (e) {}
  if (__splRequire) { try { __tradePanels = __splRequire("./trade-panels.js"); } catch (e) { __tradePanels = null; } }
  return __tradePanels;
}

var TradeForm = (function () {
  "use strict";

  function renderDual(doc, buyMount, sellMount, ctx) {
    var V = __tradepanels();
    return V.renderDual(doc, buyMount, sellMount, ctx);
  }

  return {
    renderDual: renderDual
  };
})();

if (typeof module !== "undefined") { module.exports = TradeForm; }
