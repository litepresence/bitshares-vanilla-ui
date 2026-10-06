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

  /* Discovery sample cap (database get_top_markets limit — experimental,
   * chain-capped at 100; we ask the same 20 the explorer markets tab uses).
   * WHY 20: the per-row tickData fetch below stays bounded (same N+1 bound
   * as the curated 20-row slice), and the sample note stays honestly "N=20".
   * Chain-sorted by base volume desc — kept verbatim, never re-sorted by
   * volume client-side, never summed (each row shows its own ticker Vol). */
  var DISCOVER_N = 20;

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

  /* No local el — use DOM.el */

  /* Touch floor (principle #7): interactive elements >= 44px one dimension. */
/* Display-only 6-decimal trim (retro round 2 D1 — same rule as the strip):
   * ticker latest strings can carry 16 decimals; the original table shows 6.
   * Pure string truncation at RENDER, full string stays on title. Plain
   * duplicate of the market-ind.js helper (doctrine: duplication). */
  function trim6(s) {
    s = String(s);
    var m = /^(-?\d+)\.(\d+)$/.exec(s);
    if (m && m[2].length > 6) return m[1] + "." + m[2].slice(0, 6);
    return s;
  }

  /* 4-sig-fig price display (global price rule, Format.priceSig): the PRICE
   * column only. VOL is an amount and CHANGE a percent — both stay on the
   * trim6/paintChg path, never ps. Guarded: absent Format renders trim6 as
   * today. Full strings stay on titles (paint below). */
  function ps(s) {
    try {
      if (typeof Format !== "undefined" && Format && typeof Format.priceSig === "function") return Format.priceSig(s);
    } catch (e) { /* fallback below */ }
    return trim6(s);
  }

  /* Session ticker cache (id -> {latest, chg, vol} or null-miss). Fail-open:
   * misses render "—", never an error. Vol is the SAME already-fetched
   * get_ticker row (raw.base_volume) — no added batch, no invented data
   * (dexux-plots.md N+1 ban: per-row ticker stays capped, see paint). */
  var _tickCache = {};
  /* In-flight ticker memo (perf: the kinds-arrived repaint re-fires tickData
   * for rows whose first fetch is still flying — one assets+stats pair per
   * id per tick, never two. Pending only: cleared on settle; resolved rows
   * still cache in _tickCache. Identical. */
  var _tickPending = {};
  function tickData(id, done) {
    if (Object.prototype.hasOwnProperty.call(_tickCache, id)) { done(_tickCache[id]); return; }
    if (Object.prototype.hasOwnProperty.call(_tickPending, id)) {
      _tickPending[id].then(function (row) { done(row); });
      return;
    }
    var pair = null;
    try {
      if (typeof Market === "undefined" || !Market) { done(null); return; }
      pair = Market.parseId(id);
    } catch (e) { _tickCache[id] = null; done(null); return; }
    var p = Market.assets(pair.quote, pair.base).then(function (a) {
      return Market.stats(a.base.id, a.quote.id);
    }).then(function (s) {
      var row = {
        latest: (s.latest !== null && s.latest !== undefined) ? String(s.latest) : null,
        chg: (s.raw && s.raw.percent_change !== undefined && s.raw.percent_change !== null)
          ? String(s.raw.percent_change) : null,
        vol: (s.raw && s.raw.base_volume !== undefined && s.raw.base_volume !== null)
          ? String(s.raw.base_volume) : null
      };
      _tickCache[id] = row;
      return row;
    }).catch(function () { _tickCache[id] = null; return null; });
    _tickPending[id] = p;
    p.then(function (row) { delete _tickPending[id]; done(row); },
      function () { delete _tickPending[id]; done(null); });
    return;
  }
  /* Change-sign class (retro round 3 — the original FIND MARKETS CHANGE
   * column reads red/green; ours stayed muted grey per the round-2 residual).
   * String-only sign test on the ticker percent_change text (display text,
   * never money — and float never touches it either): "+1.2"/"1.2" -> pos,
   * "-0.5" -> neg, "0"/"0.00"/"-0.00" -> zero, unparseable -> null (stays
   * muted). Params: s trimmed display string. Returns pos/neg/zero/null. */
  function chgSign(s) {
    var m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(s);
    if (!m) return null;
    var digits = (m[2] + (m[3] || "")).replace(/^0+/, "");
    if (digits === "") return "zero";
    return m[1] === "-" ? "neg" : "pos";
  }

  /* Paint one CHANGE cell: verbatim text (percents pass through untrimmed per
   * the D1 rule) + sign class for theme-token color (text only, no layout
   * shift). Non-interactive span — no touch target. Never throws. */
  function paintChg(cell, raw) {    if (raw === null || raw === undefined) return;
    cell.textContent = String(raw);
    var k = chgSign(String(raw).trim());
    if (k === null) return;
    try {
      cell.classList.remove("mkt-pk-chg-pos", "mkt-pk-chg-neg", "mkt-pk-chg-zero");
      if (k === "pos") {
        cell.classList.remove("muted");
        cell.classList.add("mkt-pk-chg-pos");
      } else if (k === "neg") {
        cell.classList.remove("muted");
        cell.classList.add("mkt-pk-chg-neg");
      } else {
        cell.classList.add("mkt-pk-chg-zero");
      }
    } catch (e) { /* text stands uncolored */ }
  }

  /* fuzzyScore: substring-or-subsequence match score for the picker filter
   * (P2 — bare indexOf hid "BTS_CNY" behind a "BTSCNY" typo with zero rows).
   * WHY score, not boolean: typo-tolerant search (principle #4) ranks the
   * near-miss below the exact hit instead of hiding either; pure string ops,
   * no dep, never Number-on-money (ids are symbols, not amounts).
   * @param {string} id QUOTE_BASE market id.
   * @param {string} f uppercased trimmed filter ("" matches everything).
   * @returns {number} lower ranks first: substring position (prefix = 0);
   *   subsequence hits sit above 1000 (start + gap penalty); Infinity hides
   *   the row. Never throws. */
  function fuzzyScore(id, f) {
    var s = String(id || "").toUpperCase();
    if (!f) return 0;
    var at = s.indexOf(f);
    if (at !== -1) return at;
    var si = 0, fi = 0, start = -1, last = -1;
    while (si < s.length && fi < f.length) {
      if (s.charAt(si) === f.charAt(fi)) {
        if (start === -1) start = si;
        last = si;
        fi++;
      }
      si++;
    }
    if (fi !== f.length) return Infinity;
    return 1000 + start + (last - start + 1 - f.length);
  }
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

  /* Inline error panel (aria-live); chain error shapes map to sentences.
   * History fallback keeps its byte-identical message key and gains a linked
   * "Open Settings" action (HistoryNotice.actionLink, pure DOM). */
  function showError(doc, wrap, e, fallback) {
    var raw = (e && typeof e.message === "string" && e.message)
      ? e.message
      : String(e || fallback || "");
    var isHist = raw.indexOf("history-unavailable") !== -1;
    var msg = (e && typeof e.message === "string" && e.message)
      ? e.message
      : String(e || fallback || t("common.unexpected_error", "Unexpected error"));
    if (msg.indexOf("bad-market") !== -1) {
      msg = "Unknown market. Check the QUOTE_BASE pair (e.g. " + defaultMarket() + ").";
    } else if (msg.indexOf("bad-asset-shape") !== -1) {
      msg = t("market.err_asset_shape", "Unexpected asset data from the node; stopped instead of guessing.");
    } else if (msg.indexOf("history-unavailable") !== -1) {
      msg = t("market.err_history", "History unavailable on this node (fills and charts need the history plugin).");
    } else if (msg.indexOf("wallet-locked") !== -1) {
      msg = t("common.wallet_locked", "Wallet is locked.");
    } else if (msg.indexOf("no-account") !== -1) {
      msg = t("market.err_no_account", "No on-chain account found for the wallet's active key.");
    } else if (msg.indexOf("not connected") !== -1) {
      msg = t("common.network_unavailable", "Network unavailable. Check Settings → Nodes and retry.");
    }
    var err = DOM.error(wrap, msg);
    if (isHist) {
      try {
        if (typeof HistoryNotice !== "undefined" && HistoryNotice && typeof HistoryNotice.actionLink === "function") {
          var link = HistoryNotice.actionLink(doc, t, "settings");
          if (link) wrap.appendChild(link);
        }
      } catch (e2) { /* error panel stands without the link */ }
    }
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

  /* saveFavs: persist starred QUOTE_BASE ids (session-only when storage
   * is blocked). Never throws. */
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

  /* toggleFav: star/unstar a market id in place, persist, return list. */
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
  /* In-flight kinds memo (perf: All/Starred renders fire ensureKinds in one
   * tick — one batched lookup per tick, never two. Pending only: cleared on
   * settle; resolved rows still cache in _kindCache. Identical. */
  var _kindPending = null;

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
    /* Share only when the same symbol set is already flying; a different
     * set waits, then re-runs (its missing rows are recomputed against the
     * filled cache, so it fetches just the remainder — never less data). */
    if (_kindPending !== null) {
      if (_kindPending.key === missing.join(",")) {
        return _kindPending.p.then(function () { return _kindCache; });
      }
      return _kindPending.p.then(function () { return ensureKinds(symbols); });
    }
    var fetchP = Chain.db().then(function (dbId) {
      return Chain.call(dbId, "lookup_asset_symbols", [missing]);
    }).then(function (rows) {
      for (var j = 0; j < missing.length; j++) {
        _kindCache[missing[j]] = (rows && rows[j]) || null;
      }
      return _kindCache;
    }).catch(function () {
      return _kindCache;
    });
    _kindPending = { key: missing.join(","), p: fetchP };
    fetchP.then(function () { if (_kindPending && _kindPending.p === fetchP) _kindPending = null; },
      function () { if (_kindPending && _kindPending.p === fetchP) _kindPending = null; });
    return fetchP;
  }

  /* Discovery ids from database get_top_markets (database_api.hpp:646 —
   * EXPERIMENTAL, chain-sorted by base volume desc; the explorer markets tab
   * calls it the same way). Legs resolve to symbols via ONE batched
   * get_objects (id -> symbol); legs already shaped like symbols pass through
   * uppercased. Malformed pairs drop; the curated list below always stands.
   * @returns {Promise<string[]>} QUOTE_BASE ids, chain order, capped at
   *   DISCOVER_N. Resolves [] on any failure (additive, never load-bearing);
   *   only non-empty wins are cached so a later picker open retries. */
  var _discoverCache = null;
  var _discoverPending = null;
  function fetchDiscover() {
    if (_discoverCache !== null) return Promise.resolve(_discoverCache);
    if (_discoverPending) return _discoverPending;
    if (typeof Chain === "undefined" || !Chain ||
        typeof Chain.db !== "function" || typeof Chain.call !== "function" ||
        typeof Market === "undefined" || !Market) {
      return Promise.resolve([]);
    }
    var p = Chain.db().then(function (dbId) {
      return Chain.call(dbId, "get_top_markets", [DISCOVER_N]);
    }).then(function (rows) {
      var legs = [], seen = {};
      (rows || []).forEach(function (r) {
        if (!r) return;
        ["quote", "base"].forEach(function (k) {
          var v = r[k];
          if (typeof v !== "string" || !v) return;
          if (!/^1\.3\.\d+$/.test(v)) return;
          if (!seen[v]) { seen[v] = true; legs.push(v); }
        });
      });
      if (!legs.length) return { rows: rows, byId: {} };
      return Chain.db().then(function (dbId2) {
        return Chain.call(dbId2, "get_objects", [legs]).then(function (objs) {
          var byId = {};
          (objs || []).forEach(function (o, idx) {
            if (o && typeof o.symbol === "string") byId[legs[idx]] = o.symbol;
          });
          return { rows: rows, byId: byId };
        });
      });
    }).then(function (shaped) {
      var out = [], have = {};
      (shaped.rows || []).forEach(function (r) {
        if (!r || out.length >= DISCOVER_N) return;
        function legSym(v) {
          if (typeof v !== "string" || !v) return null;
          if (/^1\.3\.\d+$/.test(v)) return shaped.byId[v] || null;
          return v.toUpperCase();
        }
        var q = legSym(r.quote), b = legSym(r.base);
        if (!q || !b || q === b) return;
        var id = q + "_" + b;
        try { Market.parseId(id); } catch (e) { return; }
        if (have[id]) return;
        have[id] = true;
        out.push(id);
      });
      if (out.length) _discoverCache = out;
      return out;
    }).catch(function () { return []; });
    _discoverPending = p;
    p.then(function () { _discoverPending = null; },
      function () { _discoverPending = null; });
    return p;
  }

  /* Paint the market picker list (search + kind radios + favorites + typed entry).
   * Retro round 2 D2: rows read as the original MY/FIND MARKETS table —
   * star first-column, MARKET/VOL/PRICE/CHANGE header, one row per pair.
   * All/Starred tabs mirror MY vs FIND (favs-first sort kept on All);
   * VOL/PRICE/CHANGE come from the same per-row ticker row (no new calls).
   * PRICE renders 4-sf with full precision on title (global price rule);
   * VOL (amount) and CHANGE (percent) are not prices and stay untouched. */
  function renderPicker(doc, section, currentID, root) {
    section.appendChild(DOM.el(doc, "h2", t("market.picker_title", "Markets")));
    var list = (CURATED[network()] || CURATED.mainnet).slice();
    if (list.indexOf(currentID) === -1 && currentID) list.unshift(currentID);
    var favs = loadFavs();
    var favOnly = false;
    /* Discovery ids (get_top_markets sample, chain volume order) fill in
     * async; the curated list above paints immediately so discovery never
     * blocks the 4-pair fallback. Excludes curated ids (no dup rows). */
    var discoverIds = [];

    var tabs = doc.createElement("div");
    tabs.className = "mkt-tabs";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", t("market.picker_title", "Markets"));
    var tabAll = doc.createElement("button");
    tabAll.type = "button";
    tabAll.textContent = t("market.kind_all", "All");
    tabAll.setAttribute("role", "tab");
    tabAll.setAttribute("aria-selected", "true");
    touchable(tabAll);
    var tabStar = doc.createElement("button");
    tabStar.type = "button";
    tabStar.textContent = "★ " + t("market.starred_tab", "Starred");
    tabStar.setAttribute("role", "tab");
    tabStar.setAttribute("aria-selected", "false");
    touchable(tabStar);
    tabs.appendChild(tabAll);
    tabs.appendChild(tabStar);
    section.appendChild(tabs);

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
      lab.appendChild(DOM.el(doc, "span", def[1]));
      kinds.appendChild(lab);
    });
    section.appendChild(kinds);

    /* Quote-button row (mirrors #1 market sidebar quote filters): tapping a
     * quote filters the list to pairs containing it; tapping again clears.
     * Plain buttons, 44px targets, aria-pressed carries state. */
    var QUOTES = ["BTS", "USD", "CNY", "BTC", "TEST", "USDT"];
    var quotes = doc.createElement("div");
    quotes.className = "mkt-quotes";
    var activeQuote = "";
    QUOTES.forEach(function (q) {
      var b = doc.createElement("button");
      b.type = "button";
      b.textContent = q;
      b.setAttribute("aria-pressed", "false");
      touchable(b);
      b.addEventListener("click", function () {
        if (activeQuote === q) {
          activeQuote = "";
          search.value = "";
        } else {
          activeQuote = q;
          search.value = q;
        }
        Array.prototype.forEach.call(quotes.querySelectorAll("button"), function (x) {
          x.setAttribute("aria-pressed", x.textContent === activeQuote ? "true" : "false");
        });
        paint(search.value);
        try { search.focus(); } catch (e) { /* focus stays */ }
      });
      quotes.appendChild(b);
    });
    section.appendChild(quotes);

    var search = doc.createElement("input");
    search.id = "mkt-search";
    search.type = "search";
    search.setAttribute("placeholder", t("market.search_placeholder", "Search markets…"));
    search.setAttribute("aria-label", t("market.search_label", "Search markets"));
    touchable(search);
    section.appendChild(search);
    /* Discovery block (sample note + rows) sits ABOVE the curated list and
     * starts empty — fetchDiscover fills it, never the typed QUOTE_BASE
     * fallback below (that form is untouched). */
    var discWrap = doc.createElement("div");
    discWrap.className = "mkt-discover";
    section.appendChild(discWrap);
    var ul = doc.createElement("ul");
    /* Fixed-height scroll region (desk-grid.css: 12-row fold); the curated
     * list scrolls in place like the original market sidebar. */
    ul.className = "mkt-picker-list picker-scroll";
    section.appendChild(ul);

    /* Unique symbols across the curated list AND the discovery sample for
     * the batched kind lookup (discovery resolves async — the union simply
     * grows on the repaint). */
    function pickerSymbols() {
      var seen = {}, out = [];
      list.concat(discoverIds).forEach(function (id) {
        try {
          var p = Market.parseId(id);
          [p.quote, p.base].forEach(function (s) {
            if (!seen[s]) { seen[s] = true; out.push(s); }
          });
        } catch (e) { /* malformed curated id: kind unknown, still listed */ }
      });
      return out;
    }

    /* rowKind: cached asset-kind for one market id (fails OPEN -> null
     * shows the row unfiltered). Never throws. */
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

    /* headLi: the MARKET/VOL/PRICE/CHANGE column header row (original table
     * language). Shared by the curated list and the discovery sample below.
     * @returns {HTMLElement} the header li. */
    function headLi() {
      var head = doc.createElement("li");
      head.className = "mkt-picker-row mkt-picker-head";
      head.setAttribute("aria-hidden", "true");
      head.appendChild(DOM.el(doc, "span", "", "mkt-pk-star"));
      head.appendChild(DOM.el(doc, "span", t("pool.market_col", "Market"), "mkt-pk-mkt"));
      head.appendChild(DOM.el(doc, "span", t("market.vol_label", "Vol"), "mkt-pk-num"));
      head.appendChild(DOM.el(doc, "span", t("market.th_price", "Price"), "mkt-pk-num"));
      head.appendChild(DOM.el(doc, "span", t("market.chg_label", "24h Δ"), "mkt-pk-num"));
      return head;
    }

    /* rowLi: one picker row (star + QUOTE_BASE link + VOL/PRICE/CHANGE cells
     * fed by the shared tickData cache). Shared by the curated list and the
     * discovery sample — discovery reuses this builder per row and never sums
     * volumes: each row shows its own ticker Vol cell, fail-open "—".
     * @param {string} id QUOTE_BASE market id.
     * @returns {HTMLElement} the row li. */
    function rowLi(id) {
      var li = doc.createElement("li");
      li.className = "mkt-picker-row";
      var fav = isFav(favs, id);
      /* Star FIRST column (original table language); the name link stays
       * plain text (no ★ prefix — the column owns the state). */
      var star = touchable(doc.createElement("button"));
      star.className = "mkt-star mkt-pk-star";
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
      star.setAttribute("aria-label", t("market.favorite_prefix", "Favorite ") + id);
      star.addEventListener("click", function () {
        favs = toggleFav(loadFavs(), id);
        paint(search.value);
        renderDiscover();
      });
      li.appendChild(star);
      /* Icon wiring (fi-star.svg; #1 market sidebar shows ★ only on
       * starred rows — the first-column button above carries that now). */
      var a = doc.createElement("a");
      a.className = "mkt-pk-mkt";
      a.textContent = id;
      a.setAttribute("href", "#/market/" + id);
      touchable(a);
      if (id === currentID) a.setAttribute("aria-current", "page");
      li.appendChild(a);
      /* VOL / PRICE / CHANGE columns (mirrors #1 FIND MARKETS columns):
       * same per-row ticker fetch as before, split into three cells;
       * fail-open "—", fills in when the lookup lands. */
      var volCell = DOM.el(doc, "span", "—", "muted mkt-pk-num");
      var priceCell = DOM.el(doc, "span", "—", "muted mkt-pk-num");
      var chgCell = DOM.el(doc, "span", "—", "muted mkt-pk-num");
      li.appendChild(volCell);
      li.appendChild(priceCell);
      li.appendChild(chgCell);
      tickData(id, function (r) {
        if (!r) return;
        if (r.vol !== null) {
          volCell.textContent = trim6(r.vol);
          try { volCell.title = r.vol; } catch (e) { /* text stands */ }
        }
        if (r.latest !== null) {
          priceCell.textContent = ps(r.latest);
          try { priceCell.title = r.latest; } catch (e) { /* text stands */ }
        }
        if (r.chg !== null) paintChg(chgCell, r.chg);
      });
      return li;
    }

    /* emitRows: header + rows into a host ul via one fragment append (the old
     * PERF shape: one paint instead of one per row).
     * @param {HTMLElement} hostUl the ul to fill. @param {string[]} ids row ids. */
    function emitRows(hostUl, ids) {
      var batch = null;
      try {
        if (doc && typeof doc.createDocumentFragment === "function") batch = doc.createDocumentFragment();
      } catch (e) { batch = null; }
      function emit(n) {
        if (batch) batch.appendChild(n);
        else hostUl.appendChild(n);
      }
      emit(headLi());
      ids.forEach(function (id) { emit(rowLi(id)); });
      if (batch) hostUl.appendChild(batch);
    }

    /* matchRow: shared search+kind+fav gate for one id (curated keeps its
     * fuzzy-score sort; discovery keeps chain volume order — both filter the
     * same way). Returns the fuzzy score, or Infinity when the row hides.
     * @param {string} id QUOTE_BASE id. @param {string} f uppercased filter.
     * @returns {number} fuzzy score or Infinity. Never throws. */
    function matchRow(id, f) {
      var score = fuzzyScore(id, f);
      if (score === Infinity) return Infinity;
      /* Starred tab = MY MARKETS (favs only). */
      if (favOnly && !isFav(favs, id)) return Infinity;
      var k = rowKind(id);
      /* Fail OPEN: unknown kinds ignore the kind filter, never vanish. */
      if (_kindFilter !== "ALL" && k !== null && k !== _kindFilter) return Infinity;
      return score;
    }

    /* paint: render the filtered curated rows (search + kind + fav-only).
     * Params: filter (raw search string, matched case-insensitively).
     * Sort is fuzzy-score first, then favs-first, then A–Z (empty filter
     * scores 0 everywhere, so the default order is favs-first as before).
     * Capped at 20 rows (N+1 guard: the per-row ticker fetch never grows
     * unbounded). Same nodes, same wiring as before. */
    function paint(filter) {
      DOM.clear(ul);
      var f = String(filter || "").trim().toUpperCase();
      var scored = [];
      list.forEach(function (id) {
        var score = matchRow(id, f);
        if (score === Infinity) return;
        scored.push({ id: id, score: score });
      });
      scored.sort(function (a, b) {
        if (a.score !== b.score) return a.score - b.score;
        var fa = isFav(favs, a.id) ? 0 : 1, fb = isFav(favs, b.id) ? 0 : 1;
        if (fa !== fb) return fa - fb;
        return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
      });
      /* N+1 guard (dexux-plots.md ban): curated lists are ≤5 rows, but the
       * per-row ticker fetch below must never grow unbounded — hard slice. */
      var rows = scored.map(function (r) { return r.id; }).slice(0, 20);
      if (rows.length === 0) {
        ul.appendChild(DOM.el(doc, "li", t("market.no_match", "No markets match.") + t("market.try_spelling_hint", " Try another spelling, or open any market from the picker."), "muted"));
        return;
      }
      /* Column header (original MARKET/VOL/PRICE/CHANGE language). */
      emitRows(ul, rows);
    }

    /* renderDiscover: the get_top_markets sample ABOVE the curated list —
     * chain volume order kept verbatim (never re-sorted, never summed), same
     * filter gate as curated, same row builders. The "N=… sample" prefix is
     * a technical size label (numbers, exempt per #10); the honesty note
     * reuses the explorer sample key verbatim (no new locale keys). Empty
     * while loading or on any fetch failure: the curated list stands alone. */
    function renderDiscover() {
      DOM.clear(discWrap);
      if (!discoverIds.length) return;
      var f = String(search.value || "").trim().toUpperCase();
      var rows = [];
      discoverIds.forEach(function (id) {
        if (list.indexOf(id) !== -1) return;
        if (matchRow(id, f) === Infinity) return;
        rows.push(id);
      });
      rows = rows.slice(0, DISCOVER_N);
      if (!rows.length) return;
      discWrap.appendChild(DOM.el(doc, "p",
        "N=" + String(DISCOVER_N) + " sample — " +
        t("explorer.markets_experimental", "Experimental get_top_markets sample — top 20 by base volume, chain-sorted desc; not a full market list. Values are chain human strings verbatim."),
        "muted"));
      var dul = doc.createElement("ul");
      dul.className = "mkt-picker-list picker-scroll";
      emitRows(dul, rows);
      discWrap.appendChild(dul);
    }
    /* paintTabs: All/Starred ARIA selection follows favOnly. */
    function paintTabs() {
      tabAll.setAttribute("aria-selected", favOnly ? "false" : "true");
      tabStar.setAttribute("aria-selected", favOnly ? "true" : "false");
    }
    tabAll.addEventListener("click", function () {
      favOnly = false; paintTabs(); paint(search.value); renderDiscover();
    });
    tabStar.addEventListener("click", function () {
      favOnly = true; paintTabs(); paint(search.value); renderDiscover();
    });
    kinds.addEventListener("change", function (ev) {
      var t = ev && ev.target;
      if (t && t.value) { _kindFilter = t.value; paint(search.value); renderDiscover(); }
    });
    search.addEventListener("input", function () { paint(search.value); renderDiscover(); });
    /* Keyboard nav (principle #4): arrows move through visible pairs,
     * Enter follows the focused link natively. Never throws. */
    ul.addEventListener("keydown", function (ev) {
      if (!ev || (ev.key !== "ArrowDown" && ev.key !== "ArrowUp")) return;
      try {
        var links = ul.querySelectorAll("li a");
        var vis = [];
        Array.prototype.forEach.call(links, function (a) {
          var li = a.parentElement;
          if (li && li.style.display === "none") return;
          if (a.style.display === "none") return;
          vis.push(a);
        });
        if (!vis.length) return;
        ev.preventDefault();
        var i = vis.indexOf(doc.activeElement);
        if (ev.key === "ArrowDown") i = (i + 1) % vis.length;
        else i = (i - 1 + vis.length) % vis.length;
        vis[i].focus();
      } catch (e) { /* keyboard nav skips */ }
    });
    paint("");
    renderDiscover();
    ensureKinds(pickerSymbols()).then(function () { paint(search.value); renderDiscover(); });
    /* Discovery arrives async (one get_top_markets + one batched get_objects):
     * curated ids win the dedupe, kinds cover the union, then both lists
     * repaint. Fail-open: any rejection leaves the curated list standing. */
    fetchDiscover().then(function (ids) {
      discoverIds = (ids || []).filter(function (id) { return list.indexOf(id) === -1; });
      renderDiscover();
      ensureKinds(pickerSymbols()).then(function () { paint(search.value); renderDiscover(); });
    });

    var form = doc.createElement("form");
    form.className = "mkt-direct";
    var go = doc.createElement("input");
    go.id = "mkt-direct-input";
    go.type = "text";
    go.setAttribute("placeholder", t("market.direct_placeholder_prefix", "QUOTE_BASE, e.g. ") + defaultMarket());
    go.setAttribute("aria-label", t("market.direct_label", "Open market QUOTE_BASE directly"));
    go.setAttribute("autocapitalize", "characters");
    go.setAttribute("spellcheck", "false");
    touchable(go);
    form.appendChild(go);
    var btn = touchable(DOM.el(doc, "button", t("market.open_market", "Open market")));
    btn.type = "submit";
    btn.id = "mkt-direct-go";
    form.appendChild(btn);
    var ferr = DOM.el(doc, "div", null, "error");
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
        ferr.textContent = t("market.use_quote_base_prefix", "Use QUOTE_BASE with two different symbols (e.g. ") + defaultMarket() + ").";
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
        ferr.textContent = t("market.unknown_market_prefix", "Unknown market: ") + typed + ".";
        ferr.style.display = "";
      });
    });
  }

  return {
    renderPicker: renderPicker
  };
})();

if (typeof module !== "undefined") { module.exports = MarketPicker; }
