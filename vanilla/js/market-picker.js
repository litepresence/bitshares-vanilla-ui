/* MarketPicker: market picker list for the DEX desk (search + type filter +
 *   favorites star + typed QUOTE_BASE entry).
 * Owns: curated list, favorites load/save/toggle under FAV_KEY, asset-kind
 *   classification via one batched lookup_asset_symbols call (cached per
 *   session, fails OPEN), and renderPicker(doc, section, currentID, root).
 *   No charting, no timers, no signing.
 * Consumes: Market.parseId/.assets (read-only, via global), Chain.db/.call
 *   (single chain-facing module), Store.loadSettings (network only, via
 *   private network()/defaultMarket() copies — same per-file convention as
 *   market-orders.js).
 * Globals/side effects: DOM under the given section only; favorites in
 *   localStorage; global MarketPicker only.
 * Created by: building-vanilla-slices skill, slice-18 audit (market-ui split —
 *   moved verbatim from market-ui.js renderPicker + fav/kind helpers; desk
 *   calls MarketPicker.renderPicker via lazy global).
 */
var MarketPicker = (function () {
  "use strict";

  var CURATED = {
    mainnet: ["BTS_USD", "BTS_CNY", "BTS_BTC", "BTS_ETH"],
    testnet: ["USD_TEST"]
  };
  /* Favorites star: own localStorage key (view state, never settings — same
   * rule as the desk's LAST_KEY). Value: JSON array of "QUOTE_BASE" ids. */
  var FAV_KEY = "bts-vanilla-fav-markets-v1";

  /* Batch-2b i18n (slice-17): display strings resolve via I18n.t with
   * the pre-conversion literal kept verbatim as enDefault (English-identical
   * on any transport, incl. file:// where dict fetch fails). Falls back to
   * the default when i18n.js failed to load: never blank, never throws. */
  function t(key, dflt) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt);
    } catch (e) { /* default below */ }
    return dflt;
  }

  /* Element helper: textContent only, user/chain strings never reach HTML. */
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /* Touch floor (principle #7): interactive elements >= 44px one dimension. */
  function touchable(n) {
    n.style.minHeight = "44px";
    return n;
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

  /* Inline error panel (aria-live); chain error shapes map to sentences. */
  function showError(doc, wrap, e, fallback) {
    var err = el(doc, "div", null, "error");
    err.setAttribute("aria-live", "polite");
    var msg = (e && typeof e.message === "string" && e.message)
      ? e.message
      : String(e || fallback || t("market.err_unexpected", "Unexpected error"));
    if (msg.indexOf("bad-market") !== -1) {
      msg = "Unknown market. Check the QUOTE_BASE pair (e.g. " + defaultMarket() + ").";
    } else if (msg.indexOf("bad-asset-shape") !== -1) {
      msg = t("market.err_asset_shape", "Unexpected asset data from the node; stopped instead of guessing.");
    } else if (msg.indexOf("history-unavailable") !== -1) {
      msg = t("market.err_history", "History unavailable on this node (fills and charts need the history plugin).");
    } else if (msg.indexOf("wallet-locked") !== -1) {
      msg = t("market.err_locked", "Wallet is locked.");
    } else if (msg.indexOf("no-account") !== -1) {
      msg = t("market.err_no_account", "No on-chain account found for the wallet's active key.");
    } else if (msg.indexOf("not connected") !== -1) {
      msg = t("market.err_offline", "Network unavailable. Check Settings → Nodes and retry.");
    }
    err.textContent = msg;
    wrap.appendChild(err);
    return err;
  }

  /* Favorites: string array under FAV_KEY ([] when absent/broken). */
  function loadFavs() {
    try {
      if (typeof localStorage === "undefined") return [];
      var raw = localStorage.getItem(FAV_KEY);
      var arr = JSON.parse(raw || "[]");
      return Array.isArray(arr) ? arr.filter(function (x) { return typeof x === "string"; }) : [];
    } catch (e) {
      return [];
    }
  }

  function saveFavs(list) {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(FAV_KEY, JSON.stringify(list));
      }
    } catch (e) { /* private mode: stars work for the session only */ }
  }

  function isFav(list, id) {
    return list.indexOf(id) !== -1;
  }

  function toggleFav(list, id) {
    var i = list.indexOf(id);
    if (i === -1) list.push(id);
    else list.splice(i, 1);
    saveFavs(list);
    return list;
  }

  /* Asset kind for one picker symbol, from a full lookup_asset_symbols record:
   * BTS when the symbol is the core asset; MPA when the record carries a
   * bitasset_data_id (prediction/bitasset family); else UIA. Null when the
   * record is missing (callers fail OPEN: unknown kinds stay visible). */
  function kindOf(symbol, record) {
    if (String(symbol || "").toUpperCase() === "BTS") return "BTS";
    if (!record || typeof record !== "object") return null;
    if (record.bitasset_data_id) return "MPA";
    return "UIA";
  }

  /* LPT/POOL verdict (slice-07 Task 4 — recorded deferral, not implemented):
   * POOL is not an asset type at all: pools are liquidity_pool_objects, not
   * assets (bitshares-core .../protocol/liquidity_pool.hpp — the create op
   * takes asset_a/asset_b plus a share_asset LP token). LPT (that share_asset)
   * IS live-matchable by enumerating pools, but pool enumeration for a
   * curated-pair picker is market-discovery scope, not this slice. So the
   * radios below are MPA/UIA/BTS only; revisit LPT with live pair discovery.
   *
   * Picker: search-filtered curated links + asset-type radios + favorites
   * star + typed QUOTE_BASE entry validated via lookup_asset_symbols
   * (unknown symbols fail inline, never navigate). Kind classification comes
   * from ONE batched lookup_asset_symbols call over the picker's unique
   * symbols (via Chain, the single chain-facing module — cached per desk in
   * _kindCache); when the lookup fails the filter fails OPEN (all rows stay
   * visible) instead of hiding markets on missing data. */
  var _kindCache = {};
  var _kindFilter = "ALL";

  function ensureKinds(symbols) {
    var missing = [];
    var i;
    for (i = 0; i < symbols.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(_kindCache, symbols[i])) {
        missing.push(symbols[i]);
      }
    }
    if (missing.length === 0) return Promise.resolve(_kindCache);
    if (typeof Chain === "undefined" || !Chain ||
        typeof Chain.db !== "function" || typeof Chain.call !== "function") {
      return Promise.resolve(_kindCache);
    }
    return Chain.db().then(function (dbId) {
      return Chain.call(dbId, "lookup_asset_symbols", [missing]);
    }).then(function (rows) {
      for (var j = 0; j < missing.length; j++) {
        _kindCache[missing[j]] = (rows && rows[j]) || null;
      }
      return _kindCache;
    }).catch(function () {
      return _kindCache;
    });
  }

  /* Paint the market picker list (search + kind radios + favorites + typed entry). */
  function renderPicker(doc, section, currentID, root) {
    section.appendChild(el(doc, "h2", t("market.picker_title", "Markets")));
    var list = (CURATED[network()] || CURATED.mainnet).slice();
    if (list.indexOf(currentID) === -1 && currentID) list.unshift(currentID);
    var favs = loadFavs();

    var kinds = doc.createElement("div");
    kinds.className = "mkt-kinds";
    kinds.setAttribute("role", "radiogroup");
    kinds.setAttribute("aria-label", t("market.kind_filter_label", "Asset type filter"));
    var kindDefs = [["ALL", t("market.kind_all", "All")], ["BTS", "BTS"], ["MPA", "MPA"], ["UIA", "UIA"]];
    kindDefs.forEach(function (def) {
      var lab = doc.createElement("label");
      lab.className = "mkt-kind";
      var radio = doc.createElement("input");
      radio.type = "radio";
      radio.name = "mkt-kind";
      radio.value = def[0];
      radio.checked = (_kindFilter === def[0]);
      touchable(radio);
      lab.appendChild(radio);
      lab.appendChild(el(doc, "span", def[1]));
      kinds.appendChild(lab);
    });
    section.appendChild(kinds);

    var search = doc.createElement("input");
    search.id = "mkt-search";
    search.type = "search";
    search.setAttribute("placeholder", t("market.search_placeholder", "Search markets…"));
    search.setAttribute("aria-label", t("market.search_label", "Search markets"));
    touchable(search);
    section.appendChild(search);
    var ul = doc.createElement("ul");
    ul.className = "mkt-picker-list";
    section.appendChild(ul);

    /* Unique symbols across the picker list for the batched kind lookup. */
    function pickerSymbols() {
      var seen = {}, out = [];
      list.forEach(function (id) {
        try {
          var p = Market.parseId(id);
          [p.quote, p.base].forEach(function (s) {
            if (!seen[s]) { seen[s] = true; out.push(s); }
          });
        } catch (e) { /* malformed curated id: kind unknown, still listed */ }
      });
      return out;
    }

    function rowKind(id) {
      var rec = null, sym = null;
      try {
        var p = Market.parseId(id);
        sym = p.quote;
        rec = Object.prototype.hasOwnProperty.call(_kindCache, sym)
          ? _kindCache[sym] : null;
      } catch (e) { return null; }
      /* No record (lookup pending/failed) or null row (unknown symbol):
       * kind unknown — shown always (fail OPEN). Only a present record
       * classifies (BTS by symbol, MPA by bitasset_data_id, else UIA). */
      if (rec === null || rec === undefined) return null;
      return kindOf(sym, rec);
    }

    function paint(filter) {
      while (ul.firstChild) ul.removeChild(ul.firstChild);
      var f = String(filter || "").trim().toUpperCase();
      var rows = [];
      list.forEach(function (id) {
        if (f && id.toUpperCase().indexOf(f) === -1) return;
        var k = rowKind(id);
        /* Fail OPEN: unknown kinds ignore the kind filter, never vanish. */
        if (_kindFilter !== "ALL" && k !== null && k !== _kindFilter) return;
        rows.push(id);
      });
      rows.sort(function (a, b) {
        var fa = isFav(favs, a) ? 0 : 1, fb = isFav(favs, b) ? 0 : 1;
        if (fa !== fb) return fa - fb;
        return a < b ? -1 : (a > b ? 1 : 0);
      });
      if (rows.length === 0) {
        ul.appendChild(el(doc, "li", t("market.no_match", "No markets match."), "muted"));
        return;
      }
      rows.forEach(function (id) {
        var li = doc.createElement("li");
        li.className = "mkt-picker-row";
        var fav = isFav(favs, id);
        /* Icon wiring (fi-star.svg; #1 market sidebar shows ★ only on
         * starred rows — same prefix rule kept). fav state cue changes from
         * gold color to full-vs-dimmed opacity (SVG <img> cannot take the
         * --warn text color); aria-pressed, sort-first, and the click ->
         * toggleFav -> repaint toggle logic are byte-identical in behavior.
         * Without Icon the previous ★/☆ text renders. */
        var a = doc.createElement("a");
        try {
          if (typeof Icon !== "undefined" && Icon && typeof Icon.img === "function") {
            if (fav) a.appendChild(Icon.img("fi-star", "star-icon", ""));
            a.appendChild(doc.createTextNode((fav ? " " : "") + id));
          } else {
            a.textContent = (fav ? "★ " : "") + id;
          }
        } catch (e) {
          a.textContent = (fav ? "★ " : "") + id;
        }
        a.setAttribute("href", "#/market/" + id);
        touchable(a);
        if (id === currentID) a.setAttribute("aria-current", "page");
        li.appendChild(a);
        var star = touchable(doc.createElement("button"));
        star.className = "mkt-star";
        try {
          if (typeof Icon !== "undefined" && Icon && typeof Icon.img === "function") {
            star.appendChild(Icon.img("fi-star", fav ? "star-icon" : "star-icon star-off", ""));
          } else {
            star.textContent = fav ? "★" : "☆";
          }
        } catch (e) {
          star.textContent = fav ? "★" : "☆";
        }
        star.type = "button";
        star.setAttribute("aria-pressed", fav ? "true" : "false");
        star.setAttribute("aria-label", "Favorite " + id);
        star.addEventListener("click", function () {
          favs = toggleFav(loadFavs(), id);
          paint(search.value);
        });
        li.appendChild(star);
        ul.appendChild(li);
      });
    }
    kinds.addEventListener("change", function (ev) {
      var t = ev && ev.target;
      if (t && t.value) { _kindFilter = t.value; paint(search.value); }
    });
    search.addEventListener("input", function () { paint(search.value); });
    paint("");
    ensureKinds(pickerSymbols()).then(function () { paint(search.value); });

    var form = doc.createElement("form");
    form.className = "mkt-direct";
    var go = doc.createElement("input");
    go.id = "mkt-direct-input";
    go.type = "text";
    go.setAttribute("placeholder", "QUOTE_BASE, e.g. " + defaultMarket());
    go.setAttribute("aria-label", t("market.direct_label", "Open market QUOTE_BASE directly"));
    go.setAttribute("autocapitalize", "characters");
    go.setAttribute("spellcheck", "false");
    touchable(go);
    form.appendChild(go);
    var btn = touchable(el(doc, "button", t("market.open_market", "Open market")));
    btn.type = "submit";
    btn.id = "mkt-direct-go";
    form.appendChild(btn);
    var ferr = el(doc, "div", null, "error");
    ferr.setAttribute("aria-live", "polite");
    ferr.style.display = "none";
    section.appendChild(form);
    section.appendChild(ferr);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      ferr.style.display = "none";
      ferr.textContent = "";
      var typed = String(go.value || "").trim().toUpperCase();
      var pair;
      try {
        pair = Market.parseId(typed);
      } catch (e) {
        ferr.textContent = "Use QUOTE_BASE with two different symbols (e.g. " + defaultMarket() + ").";
        ferr.style.display = "";
        return;
      }
      btn.disabled = true;
      Market.assets(pair.quote, pair.base).then(function () {
        btn.disabled = false;
        if (typeof window !== "undefined" && window.location) {
          window.location.hash = "#/market/" + typed;
        }
      }).catch(function () {
        btn.disabled = false;
        ferr.textContent = "Unknown market: " + typed + ".";
        ferr.style.display = "";
      });
    });
  }

  return {
    renderPicker: renderPicker
  };
})();

if (typeof module !== "undefined") { module.exports = MarketPicker; }
