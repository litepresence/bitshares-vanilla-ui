/* TradeUI: stable entry points for DEX trading (thin shell).
 * Owns: NOTHING but delegation — renderDual/orderCancelBox/cancelAllBox
 *   keep the exact names the desk (market-desk.js) and the orders list
 *   (market-orders.js) use. Bodies live in the slice-18 split files: order
 *   forms + review + send in trade-form.js (TradeForm), cancel boxes +
 *   result screen in trade-cancel.js (TradeCancel). Missing-backend paths
 *   render honest inline errors, never blank.
 * Consumes: TradeForm.renderDual, TradeCancel.orderCancelBox/
 *   cancelAllBox (lazy — honest error when absent).
 * Globals/side effects: DOM error panel only on the missing-backend path;
 *   global TradeUI only (unchanged).
 * Created by: building-vanilla-slices skill, slice-06-trading plan Task 2.
 * Reshaped by: slice-18 audit (trade-ui split — shell + two owners).
 */
var TradeUI = (function () {
  "use strict";

  /* Inline error panel that is never blank (missing-backend path only). */
  function showError(doc, wrap, e, fallback) {
    var err = doc.createElement("div");
    err.className = "error";
    err.setAttribute("aria-live", "polite");
    var msg = (e && typeof e.message === "string" && e.message)
      ? e.message
      : String(e || fallback || "Unexpected error");
    err.textContent = msg;
    wrap.appendChild(err);
    return err;
  }

  /* Desk entry: renderDual(doc, buyMount, sellMount, ctx). Delegates to the
   * form side (retro 2x3 row-1 Buy + Sell panels). */
  function renderDual(doc, buyMount, sellMount, ctx) {
    if (typeof TradeForm !== "undefined" && TradeForm &&
        typeof TradeForm.renderDual === "function") {
      TradeForm.renderDual(doc, buyMount, sellMount, ctx);
      return;
    }
    if (!buyMount && !sellMount) return;
    showError(doc, buyMount || sellMount, "Trade backend missing: js/trade-form.js failed to load.");
  }

  /* Inline per-order cancel confirm. Delegates to the cancel side. */
  function orderCancelBox(doc, box, order, assets, onDone) {
    if (typeof TradeCancel !== "undefined" && TradeCancel &&
        typeof TradeCancel.orderCancelBox === "function") {
      TradeCancel.orderCancelBox(doc, box, order, assets, onDone);
      return;
    }
    if (!box) return;
    showError(doc, box, "Trade backend missing: js/trade-cancel.js failed to load.");
  }

  /* Cancel-all box. Delegates to the cancel side. */
  function cancelAllBox(doc, box, orders, assets, onDone) {
    if (typeof TradeCancel !== "undefined" && TradeCancel &&
        typeof TradeCancel.cancelAllBox === "function") {
      TradeCancel.cancelAllBox(doc, box, orders, assets, onDone);
      return;
    }
    if (!box) return;
    showError(doc, box, "Trade backend missing: js/trade-cancel.js failed to load.");
  }

  return {
    renderDual: renderDual,
    orderCancelBox: orderCancelBox,
    cancelAllBox: cancelAllBox
  };
})();

if (typeof module !== "undefined") { module.exports = TradeUI; }
