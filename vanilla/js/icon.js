/* icon.js — vendored SVG icon helper (zero-dep, platform fetch only).
 * Owns: mapping logical icon names to vanilla/assets/icons/*.svg (byte-copies
 *   of bitshares-ui/app/assets/icons/, icons-loader.js excluded correctly),
 *   fetch-once warming, and <img> construction with a text fallback that can
 *   never render a broken-image glyph or a blank button.
 * Consumes: nothing (no Store/Chain/I18n — safe to load first). DOM only.
 * Globals/side effects: single global Icon (+ module.exports); one best-effort
 *   fetch() per icon name to warm the HTTP cache; no writes, no listeners.
 * Created by: building-vanilla-slices skill, style-worker icon-wiring task.
 * Reference names (bitshares-ui, read-only): the name list is verbatim
 *   bitshares-ui/app/assets/icons/icons-loader.js:1-85 (84 names); nav mapping
 *   follows app/components/Layout/MenuDataStructure.js:182-299 (dashboard,
 *   trade, poolmart, deployment-unit, server, transfer, cogs).
 * Deliberate deviation: #1 inlines SVG markup into spans (Icon.jsx:38-58);
 *   vanilla uses <img src> instead — no innerHTML anywhere (page-origin XSS
 *   ceiling: SVG files stay inert images, never executable markup). Recolor
 *   limitation is honest: monochrome glyphs follow themes via a CSS invert
 *   filter (css/themes.css --icon-filter); colored glyphs are unwired until
 *   an inline-SVG pass justifies the XSS review. */
var Icon = (function () {
  "use strict";

  /* BASE: relative to vanilla/index.html (and any hash route — relative URLs
   * resolve against the document, never the hash, so this holds everywhere). */
  var BASE = "assets/icons/";

  /* VALID: file-name guard — names reach a URL, so anything outside
   * [a-z0-9_-] is rejected before a request is built (no path traversal). */
  var VALID = /^[a-z0-9][a-z0-9_-]*$/i;

  /* KNOWN: the 84 icons-loader.js names (bitshares-ui read-only) plus
   *   shield-check (Tier 2 original art, see assets/PROVENANCE.md). Unknown
   *   names skip the network entirely and render the text fallback directly. */
  var KNOWN = {
    "photo-camera": 1, adjust: 1, alarm: 1, assets: 1, autolock: 1,
    barter: 1, borrow: 1, "checkmark-circle": 1, "chevron-down": 1,
    clippy: 1, clock: 1, cog: 1, cogs: 1, coming_soon: 1, connected: 1,
    connect: 1, "cross-circle": 1, dashboard: 1, delete: 1, deposit: 1,
    disconnected: 1, direct_debit: 1, "dollar-green": 1, dollar: 1,
    download: 1, excel: 1, eye: 1, "eye-striked": 1, "fi-star": 1,
    folder: 1, grouping: 1, "hamburger-x": 1, hamburger: 1, htlc: 1,
    hourglass: 1, key: 1, list: 1, locked: 1, "minus-circle": 1, news: 1,
    "plus-circle": 1, power: 1, "question-circle": 1, server: 1, settle: 1,
    share: 1, showcases: 1, shuffle: 1, text: 1, "thumb-tack": 1,
    "thumb-untack": 1, "thumbs-up": 1, times: 1, trade: 1, transfer: 1,
    unlocked: 1, user: 1, voting: 1, warning: 1, withdraw: 1, filter: 1,
    "shield-check": 1,
    "info-circle-o": 1, zoom: 1, people: 1, fire: 1, "question-in-circle": 1,
    attention: 1, checkmark: 1, paperclip: 1, wallet: 1, prediction: 1,
    "prediction-large": 1, merchant: 1, insight: 1, create_account: 1,
    swap: 1, "instant-trade": 1, poolmart: 1, "arrow-down-1": 1,
    "arrow-up-down": 1, pools: 1, "qr-scan": 1, "deployment-unit": 1
  };

  /* warmed: fetch-once Map (name -> true). The <img> load itself is the real
   * fetch; this one-time fetch() only warms the HTTP cache ahead of first
   * paint. Best-effort: file:// and offline failures are swallowed — the
   * <img> src below is always assigned, so icons still resolve normally. */
  var warmed = new Map();

  /* url: name -> asset path. Params: name string. Returns path string.
   * Fails: never throws — invalid names fall back to "question-circle". */
  function url(name) {
    var n = String(name || "");
    if (!VALID.test(n) || !KNOWN[n]) return BASE + "question-circle.svg";
    return BASE + n + ".svg";
  }

  /* known: is this a wired vendored name? Params: name. Returns bool. */
  function known(name) {
    var n = String(name || "");
    return VALID.test(n) && !!KNOWN[n];
  }

  /* fallback: text node shown when an icon cannot load. Params: doc, text.
   * Returns a <span class="icon-fallback">. Never blank: empty text uses ●. */
  function fallback(doc, text) {
    var s = doc.createElement("span");
    s.className = "icon-fallback";
    s.textContent = text || "●";
    s.setAttribute("aria-hidden", "true");
    return s;
  }

  /* img: build an <img> for a vendored icon.
   *   Params: name (icons-loader.js name), cls (extra CSS class, optional),
   *     alt (alt text; "" = decorative, default "").
   *   Returns the <img>, or a text fallback <span> when there is no DOM or
   *   the name is unknown (no network attempted). Fails: never throws.
   *   Load failure (onerror): the img hides itself and a fallback span is
   *   inserted in its place — never a broken-image glyph, and inside a
   *   <button>/<a> the control keeps its aria-label so never a blank button.
   *   Async-safety: fully synchronous DOM — callers' toggle/repaint logic is
   *   untouched (star/bell state still flips on click + repaint, as before). */
  function img(name, cls, alt) {
    if (typeof document === "undefined") return null;
    var doc = document;
    if (!known(name)) return fallback(doc, alt || String(name || "●"));
    var el = doc.createElement("img");
    el.className = "icon-img" + (cls ? " " + cls : "");
    el.alt = (alt === undefined || alt === null) ? "" : String(alt);
    if (el.alt === "") el.setAttribute("aria-hidden", "true");
    el.decoding = "async";
    var src = url(name);
    el.setAttribute("src", src);
    el.onerror = function () {
      try {
        var fb = fallback(doc, alt || null);
        if (el.parentNode) el.parentNode.replaceChild(fb, el);
        else el.style.display = "none";
      } catch (e) {
        try { el.style.display = "none"; } catch (e2) { /* never break host */ }
      }
    };
    /* Fetch-once warm (platform fetch only, no deps). Failure is normal on
     * file:// — swallowed; the <img> above still loads via its src. */
    try {
      if (!warmed.has(src)) {
        warmed.set(src, true);
        if (typeof fetch === "function") {
          fetch(src, { cache: "force-cache" }).catch(function () { /* offline ok */ });
        }
      }
    } catch (e) { /* warming never blocks icons */ }
    return el;
  }

  return { url: url, known: known, img: img, fallback: fallback };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.Icon === "undefined") { globalThis.Icon = Icon; }
if (typeof module !== "undefined") { module.exports = Icon; }
