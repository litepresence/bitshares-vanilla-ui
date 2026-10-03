/* Content-script relay: isolated-world postMessage bridge (Tier 2, P4).
 * Owns: injecting content/inpage.js as a FILE script tag (page world;
 *   inline injection would die on strict page CSPs), relaying page
 *   requests to the SW with the platform-provided event.origin attached
 *   (unforgeable — the SW trusts THIS field, never page claims), and
 *   posting SW replies back to the page.
 * Touches no storage API, no Wallet, no crypto — zero key access by
 * construction (unchanged from Tier 1). Page->relay requests carry
 * {vbBridge:true, dir:"req", id, type, payload}; relay->SW carries
 * {type, id, payload, origin}. Replies reverse the path by id.
 * Consumes: window.postMessage (page side), chrome/browser.runtime
 *   (SW side). Side effects: one <script> tag + two listeners.
 * Patterns (not code) from #3 pi314x inpage provider (proposal §2.2);
 *   written fresh here — nothing copied from reference/wallet-extension/.
 * Created by: extension-wrapper Tier 1 (surface); rewired by Tier 2 (P4).
 */
(function () {
  "use strict";

  /* Namespace compat: Firefox/Safari expose `browser`, Chromium `chrome`. */
  var ext = (typeof browser !== "undefined" && browser) ||
    (typeof chrome !== "undefined" && chrome) || null;

  /* Inject the page-world provider as a file (never inline). Strict-CSP
   * pages may refuse the tag — then the page simply has no provider
   * (honest absence) rather than a broken half-bridge. */
  try {
    if (typeof document !== "undefined" && document.documentElement &&
        !document.documentElement.getAttribute("data-vb-bridge")) {
      document.documentElement.setAttribute("data-vb-bridge", "1");
      var src = null;
      try {
        if (ext && ext.runtime && typeof ext.runtime.getURL === "function") {
          src = ext.runtime.getURL("content/inpage.js");
        }
      } catch (e) { src = null; }
      if (src) {
        var s = document.createElement("script");
        s.src = src;
        s.onload = function () { try { s.remove(); } catch (e) {} };
        s.onerror = function () { try { s.remove(); } catch (e) {} };
        (document.head || document.documentElement).appendChild(s);
      }
    }
  } catch (e) { /* provider simply absent */ }

  /* Page -> SW relay. event.origin is platform-provided (the field the SW
   * gate trusts); any origin claimed inside the payload is ignored there. */
  try {
    window.addEventListener("message", function (ev) {
      try {
        if (!ev || ev.source !== window) return;
        var d = ev.data;
        if (!d || d.vbBridge !== true || d.dir !== "req") return;
        if (!ext || !ext.runtime || typeof ext.runtime.sendMessage !== "function") {
          window.postMessage({ vbBridge: true, dir: "res", id: d.id,
            ok: false, error: "bitsharesWallet unavailable: extension runtime missing" }, "*");
          return;
        }
        var origin = null;
        try { origin = (typeof ev.origin === "string" && ev.origin) ? ev.origin : null; } catch (e) { origin = null; }
        ext.runtime.sendMessage({ type: d.type, id: d.id, payload: d.payload, origin: origin },
          function (reply) {
            var out = { vbBridge: true, dir: "res", id: d.id, ok: false, error: "no reply" };
            try {
              if (ext.runtime && ext.runtime.lastError) {
                out = { vbBridge: true, dir: "res", id: d.id, ok: false,
                  error: ext.runtime.lastError.message || "extension error" };
              } else if (reply && typeof reply === "object" && reply.id === d.id) {
                out = { vbBridge: true, dir: "res", id: d.id, ok: !!reply.ok,
                  payload: (reply.payload === undefined ? null : reply.payload),
                  error: (reply.error === undefined ? null : reply.error) };
              }
            } catch (e) { /* default out stands */ }
            try { window.postMessage(out, "*"); } catch (e2) { /* page gone */ }
          });
      } catch (e) { /* relay best-effort */ }
    });
  } catch (e) { /* relay simply absent */ }
})();
