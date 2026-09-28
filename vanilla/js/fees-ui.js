/* fees-ui.js — standalone network fee-schedule page (matrix C31).
 * Owns: #/fees (read-only table of every op fee, live from the chain).
 *   Reuses AssetFeedUI.feeSection (the same renderer #/assets embeds) — no
 *   duplicated table code, no new chain logic. All money math stays inside
 *   feeSection/Format (raw ints in title attributes, human strings on screen).
 * Consumes: AssetFeedUI.feeSection (js/asset-feed-ui.js), Chain (status),
 *   Store (connection subscribe). No wallet, no signing, no broadcasts.
 * Globals/side effects: DOM under root only; global FeesUI. Gen counter
 *   tears down stale reconnect work.
 * Refs: astro-ui NetworkFees.jsx (per-op fee + per-kB + LTM columns — LTM
 *   math needs network_percent_of_fee which Asset.feeSchedule does not return,
 *   so this page shows standard fees only and says so); #4
 *   database_api.hpp get_global_properties (fee source, via Asset.feeSchedule).
 * Created by: deferred-matrix close-out (C30/C31/C34/C35 batch).
 */
var FeesUI = (function () {
  "use strict";

  /* Batch-2e i18n (slice-17 precedent): display strings resolve via I18n.t with the
   * pre-conversion literal kept verbatim as enDefault (English-identical on any
   * transport, incl. file:// where dict fetch fails). Falls back to the default
   * when i18n.js failed to load: never blank, never throws. vars supports
   * %(name)s templates at a few asset/named-count labels. */
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    if (vars && typeof dflt === "string") return dflt.replace(/%\(([^)]+)\)s/g, function (m, name) {
      return (vars && Object.prototype.hasOwnProperty.call(vars, name)) ? String(vars[name]) : m;
    });
    return dflt;
  }
  var gen = 0;
  /* textContent-only element (chain strings never reach HTML). */
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n; }
  /* Touch floor (principle #7): interactive elements >= 44px one dimension. */
  function touchable(n) { n.style.minHeight = "44px"; return n; }
  function clearRoot(root) { while (root.firstChild) root.removeChild(root.firstChild); }
  function makeWrap(doc, root) {
    var w = doc.createElement("div"); w.className = "wrap"; root.appendChild(w); return w; }
  /* Inline error panel, never blank. */
  function showError(doc, wrap, e, fallback) {
    var msg = (e && typeof e.message === "string" && e.message) ? e.message : String(e || fallback || t("fees.unexpected_error", "Unexpected error"));
    if (msg.indexOf("not connected") !== -1) msg = t("fees.network_unavailable_check_settings_nodes_and", "Network unavailable. Check Settings → Nodes and retry.");
    var err = el(doc, "div", msg, "error");
    err.setAttribute("aria-live", "polite"); wrap.appendChild(err); return err;
  }

  /* Route entry: title + scope note, then the shared feeSection table.
   * Offline renders Retry + auto-reruns on reconnect (transfer-ui.js
   * connect-wait pattern, gen-guarded). */
  function renderFees(root) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    var myGen = ++gen;
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    if (typeof AssetFeedUI === "undefined" || !AssetFeedUI ||
        typeof AssetFeedUI.feeSection !== "function") {
      showError(doc, wrap, t("fees.fee_backend_missing_js_asset_feed_ui_js_faile", "Fee backend missing: js/asset-feed-ui.js failed to load."));
      return;
    }
    wrap.appendChild(el(doc, "h1", t("fees.network_fees", "Network fees")));
    wrap.appendChild(el(doc, "p", t("fees.scope_note", "Every operation fee charged by the network, fetched live from the chain's fee schedule. Fees are shown in the core asset; hover (or long-press the title) for raw values. Lifetime-member rebates are not shown here — this is the standard schedule."),
      "muted"));
    if (typeof Chain !== "undefined" && Chain && typeof Chain.status === "function" &&
        Chain.status().state !== "open") {
      wrap.appendChild(el(doc, "p", t("fees.connecting_to_network", "Connecting to network…"), "muted"));
      var retry = touchable(el(doc, "button", t("fees.retry", "Retry")));
      retry.type = "button"; wrap.appendChild(retry);
      var hashAtEntry = (typeof location !== "undefined" && location.hash) || "", settled = false;
      var off = function () {};
      if (typeof Store !== "undefined" && Store && typeof Store.subscribe === "function") {
        off = Store.subscribe("connection", function (st) {
          if (settled || myGen !== gen) return;
          if (st && st.state === "open") {
            settled = true; try { off(); } catch (e) {}
            if (typeof location === "undefined" || location.hash === hashAtEntry) renderFees(root);
          }
        });
      }
      retry.addEventListener("click", function () {
        if (!settled) { settled = true; try { off(); } catch (e) {} }
        if (myGen === gen) renderFees(root);
      });
      var timer = setTimeout(function () {
        if (settled || myGen !== gen) return;
        settled = true; try { off(); } catch (e) {}
      }, 15000);
      return;
    }
    var box = doc.createElement("div");
    wrap.appendChild(box);
    AssetFeedUI.feeSection(doc, box);
    var more = el(doc, "p", null, "muted");
    var a = doc.createElement("a");
    a.href = "#/assets"; a.textContent = t("fees.back_to_assets", "Back to Assets");
    more.appendChild(a); wrap.appendChild(more);
  }

  return { renderFees: renderFees };
})();

if (typeof module !== "undefined") { module.exports = FeesUI; }
