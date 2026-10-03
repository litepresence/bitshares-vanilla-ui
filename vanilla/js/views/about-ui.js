/* about-ui.js — the marketing-layered About page (#/about).
 * Owns: static DOM for the About route (hero + CTAs + six philosophy
 *   blocks + honest-limits block + links row). Consumes: I18n.t via the
 *   local t() fallback (verbatim English defaults, slice-17 batch pattern).
 *   No chain, no wallet, no amounts — no Format vectors apply, no failure
 *   modes: the page renders with the node down (which is the pitch).
 *   Styling reuses .wrap/.menu-grid/.menu-card (no new CSS).
 *   Globals/side effects: DOM under the router root; single global AboutUI
 *   (+ module.exports). Static renders.
 * Created by: building-vanilla-slices skill, about spec
 *   (docs/superpowers/specs/2026-10-04-about-design.md).
 * Copy bounds: AGENTS.md §3.8 — no fabricated stats, volumes, or counts;
 *   the only live things here are links to live pages. */
var AboutUI = (function () {
  "use strict";

  /* Batch-pattern i18n (slice-17 precedent): display strings resolve via
   * I18n.t with the pre-conversion literal kept verbatim as enDefault.
   * Falls back to the default when i18n.js failed to load: never blank,
   * never throws. */
  function t(key, dflt) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt);
    } catch (e) { /* default below */ }
    return dflt;
  }

  /* textContent-only element (about strings never reach HTML). */
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function clearRoot(root) { while (root.firstChild) root.removeChild(root.firstChild); }

  /* cta: one full-card link button. Params: doc, href, label. Returns the
   * anchor. Never throws. */
  function cta(doc, href, label) {
    var a = doc.createElement("a");
    a.className = "menu-card";
    a.setAttribute("href", href);
    var b = doc.createElement("b");
    b.textContent = label;
    a.appendChild(b);
    return a;
  }

  /* section: one h2 + paragraph block from already-resolved strings
   * (call sites pass t() literals so the i18n drift gate sees every
   * default verbatim). Params: doc, wrap, title, body (strings).
   * Returns nothing. Never throws. */
  function section(doc, wrap, title, body) {
    wrap.appendChild(el(doc, "h2", title));
    wrap.appendChild(el(doc, "p", body));
  }

  /* renderAbout: #/about — hero, CTAs, philosophy, limits, links.
   * Params: root (element). Returns nothing. A missing root is a no-op. */
  function renderAbout(root) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    clearRoot(root);
    var wrap = doc.createElement("div");
    wrap.className = "wrap";
    root.appendChild(wrap);
    wrap.appendChild(el(doc, "h1", t("about.hero_title", "BitShares, in your browser. Nothing to install.")));
    wrap.appendChild(el(doc, "p",
      t("about.hero_lede", "A complete wallet for the BitShares blockchain — markets, accounts, governance, and exploration — running as plain web files. No framework, no installer, no account with us. Your keys never leave this browser."),
      "muted"));
    var grid = doc.createElement("div");
    grid.className = "menu-grid";
    grid.appendChild(cta(doc, "#/market/BTS_USD", t("about.cta_trade", "Open the exchange")));
    grid.appendChild(cta(doc, "#/help", t("about.cta_guides", "Read the guides")));
    wrap.appendChild(grid);
    section(doc, wrap,
      t("about.s1_title", "Your keys never leave this browser"),
      t("about.s1_body", "Accounts live in an encrypted vault on your device, and every transaction is signed locally before broadcast. The nodes you connect to never see your secrets — which is also why backups are yours alone: lose the brainkey and nobody can recover your funds."));
    section(doc, wrap,
      t("about.s2_title", "A real exchange, not a screenshot"),
      t("about.s2_body", "Order books, liquidity pools, swaps, borrowing, credit, prediction markets, and voting all settle on-chain. What you see is the chain itself — books you can trade against, not pictures of books."));
    section(doc, wrap,
      t("about.s3_title", "Built to outlive its builders"),
      t("about.s3_body", "The wallet it replaces died under a hundred stale packages and a toolchain nobody can reproduce. This one depends on nothing with a release cycle: no framework, no package manager, no build step. If everyone walks away for ten years, it still runs in a browser."));
    section(doc, wrap,
      t("about.s4_title", "Familiar, but alive"),
      t("about.s4_body", "Returning users feel at home instantly — the same pages, panels, and words as the classic wallet — while balances, books, and connection status update live in place. Fast forgiving search everywhere, three themes, and layouts that work from a 360px phone to a 4K trading desk."));
    section(doc, wrap,
      t("about.s5_title", "Numbers you can trust"),
      t("about.s5_body", "The chain speaks integers; you never see them. Every amount sits at its asset's decimals, every percent at its true value, and every fee is previewed from the live chain before you sign — never estimated, never guessed."));
    section(doc, wrap,
      t("about.s6_title", "Honest limits"),
      t("about.s6_body", "Gateways are custodians holding your outside coins — read their terms as the custody deal it is. The history index is run by the community, not by this wallet. Some features have no testnet data by nature, and there is no in-app news feed by decision. Where this wallet cannot know, it says so instead of guessing."));
    wrap.appendChild(el(doc, "h2", t("about.links_title", "Go further")));
    var ul = doc.createElement("ul");
    [["#/help", t("help.help", "Help")],
     ["#/community", t("help.community_title", "Community")],
     ["https://github.com/bitshares/bitshares-vanilla-ui", t("about.link_source", "Source code")]].forEach(function (pair) {
      var li = doc.createElement("li"), a = doc.createElement("a");
      a.setAttribute("href", pair[0]);
      a.textContent = pair[1];
      if (pair[0].indexOf("https://") === 0) {
        try { a.target = "_blank"; a.rel = "noopener"; } catch (e) { /* same-tab fallback */ }
      }
      li.appendChild(a); ul.appendChild(li);
    });
    wrap.appendChild(ul);
  }

  return { renderAbout: renderAbout };
})();

if (typeof module !== "undefined") { module.exports = AboutUI; }
