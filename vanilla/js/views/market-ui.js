/* MarketUI: stable entry points for the /market/:marketID route (thin shell).
 * Owns: NOTHING but delegation — renderMarket/homeTarget/defaultMarket keep
 *   the exact names the router uses (router.js calls only these three).
 *   Bodies live in the slice-18 split files: desk skeleton + fill in
 *   market-desk.js (MarketDesk), picker in market-picker.js (MarketPicker),
 *   strip/timeframes/charts in market-ind.js (MarketInd). homeTarget +
 *   defaultMarket stay implemented here (verbatim from the pre-split file)
 *   so the "/" redirect never depends on the desk; the last-market read half
 *   (loadLast) pairs with MarketDesk's saveLast under the same LAST_KEY.
 * Consumes: MarketDesk.renderMarket (lazy — honest error when absent),
 *   Market.parseId (homeTarget validation), Store.loadSettings (network).
 * Globals/side effects: DOM error panel only on the missing-backend path;
 *   localStorage last-market read; global MarketUI only (unchanged).
 * Created by: building-vanilla-slices skill, slice-05-exchange-read plan Task 3.
 * Reshaped by: slice-18 audit (market-ui split — shell + three owners).
 *
 * DEFAULT MARKET (no guessing): bitshares-ui/app/branding.js:98-108
 *   getDefaultMarket() returns "USD_TEST" on testnet, "BTS_CNY" on mainnet
 *   (wired at Header.jsx:415). "/" redirects to the last-visited market when
 *   stored and valid, else that network default.
 */
var MarketUI = (function () {
  "use strict";

  var LAST_KEY = "bts-vanilla-last-market-v1";

  /* No local el/clearRoot — use DOM.el, DOM.clear */

  function makeWrap(doc, root) {
    var wrap = doc.createElement("div");
    wrap.className = "wrap";
    root.appendChild(wrap);
    return wrap;
  }

  /* Network from Store (sole settings owner); mainnet when unreadable. */
  function network() {
    try {
      if (typeof Store !== "undefined" && Store && typeof Store.loadSettings === "function") {
        var s = Store.loadSettings();
        if (s && (s.network === "testnet" || s.network === "mainnet")) return s.network;
      }
    } catch (e) { /* default stands */ }
    return "mainnet";
  }

  /* Canonical default market per bitshares-ui/app/branding.js:98-108. */
  function defaultMarket() {
    return network() === "testnet" ? "USD_TEST" : "BTS_CNY";
  }

  /* Last-visited market id (own key: Store.saveSettings drops unknown keys,
   * so view state lives here, never in settings). Null when absent. */
  function loadLast() {
    try {
      if (typeof localStorage === "undefined") return null;
      var v = localStorage.getItem(LAST_KEY);
      return (typeof v === "string" && v) ? v : null;
    } catch (e) {
      return null;
    }
  }

  /* Resolve the "/" redirect target: stored id when it still parses, else
   * the network default. Exposed for the router (single purpose). */
  function homeTarget() {
    var last = loadLast();
    if (typeof last === "string" && last &&
        typeof Market !== "undefined" && Market && typeof Market.parseId === "function") {
      try {
        Market.parseId(last);
        return last.toUpperCase();
      } catch (e) { /* fall through to default */ }
    }
    return defaultMarket();
  }

  /* Inline error panel (aria-live); missing-backend path only. */
  function showError(doc, wrap, e, fallback) {
    var msg = (e && typeof e.message === "string" && e.message)
      ? e.message
      : String(e || fallback || "Unexpected error");
    var err = DOM.error(wrap, msg);
    return err;
  }

  /* Route entry: delegates to the desk (missing script tag -> honest panel,
   * never blank). Signature and exports are unchanged by the split. */
  function renderMarket(root, marketID) {
    if (typeof MarketDesk !== "undefined" && MarketDesk &&
        typeof MarketDesk.renderMarket === "function") {
      MarketDesk.renderMarket(root, marketID);
      return;
    }
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    DOM.clear(root);
    var wrap = makeWrap(doc, root);
    showError(doc, wrap, "Market backend missing: js/market-desk.js failed to load.");
  }

  return {
    renderMarket: renderMarket,
    homeTarget: homeTarget,
    defaultMarket: defaultMarket
  };
})();

if (typeof module !== "undefined") { module.exports = MarketUI; }
