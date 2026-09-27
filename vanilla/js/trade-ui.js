/* TradeUI: stable entry points for DEX trading (thin shell).
 * Owns: NOTHING but delegation — renderPanels/orderCancelBox/cancelAllBox
 *   keep the exact names the desk (market-desk.js) and the orders list
 *   (market-orders.js) use. Bodies live in the slice-18 split files: order
 *   forms + review + send in trade-form.js (TradeForm), cancel boxes +
 *   result screen in trade-cancel.js (TradeCancel). Missing-backend paths
 *   render honest inline errors, never blank.
 * Consumes: TradeForm.renderPanels, TradeCancel.orderCancelBox/
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

  /* Desk entry: renderPanels(doc, mount, ctx). Delegates to the form side. */
  function renderPanels(doc, mount, ctx) {
    if (typeof TradeForm !== "undefined" && TradeForm &&
        typeof TradeForm.renderPanels === "function") {
      TradeForm.renderPanels(doc, mount, ctx);
      return;
    }
    if (!mount) return;
    showError(doc, mount, "Trade backend missing: js/trade-form.js failed to load.");
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
    renderPanels: renderPanels,
    orderCancelBox: orderCancelBox,
    cancelAllBox: cancelAllBox
  };
})();

if (typeof module !== "undefined") { module.exports = TradeUI; }
