/* favourites-ui.js — favourites dashboard (matrix C35).
 * Owns: #/favourites (favourite markets + assets + accounts with links,
 *   counts, add forms, and remove buttons). Picker-level market stars shipped
 *   slice-05 (MarketPicker under MARKETS_KEY); this page AGGREGATES them with
 *   two new local-only collections (assets, accounts). All three are
 *   localStorage view state — never settings, never chain writes. Adds query
 *   the chain only to validate (market pair / asset symbol / account name);
 *   lists render offline from storage.
 * Consumes: Chain.db/.call (add-time validation only), Market.parseId/.assets
 *   (market validation, guarded), Account.resolve (account validation,
 *   guarded), Store (connection subscribe for the offline gate, guarded).
 *   No wallet, no signing, no amounts (ids + names + symbols only, so no
 *   Format vectors apply).
 * Globals/side effects: DOM under root only; three localStorage keys;
 *   global FavouritesUI. Gen counter tears down stale async adds.
 * Refs: astro-ui Favourites.jsx + favourites.ts (per-chain asset/user/pair
 *   stores — vanilla keeps one network-agnostic set of three lists; pairs map
 *   to #/market/QUOTE_BASE, assets to #/asset/SYMBOL, users to #/account/NAME).
 * Spelling: "favourites" (route + file, matches astro page); the picker's
 *   older "favorites" key name is left untouched.
 * Created by: deferred-matrix close-out (C30/C31/C34/C35 batch).
 */
var FavouritesUI = (function () {
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
  /* Market stars live here (owned by market-picker.js — read/remove here,
   * never renamed). Assets/accounts are new keys owned by this file. */
  var MARKETS_KEY = "bts-vanilla-fav-markets-v1";
  var ASSETS_KEY = "bts-vanilla-fav-assets-v1";
  var ACCOUNTS_KEY = "bts-vanilla-fav-accounts-v1";
  /* textContent-only element (user/chain strings never reach HTML). */
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

  /* String-list load/save (markets). Object-list load/save (assets/accounts,
   * filtered to {symbol|name,id} string pairs; broken storage -> []). */
  function loadStrings(key) {
    try {
      if (typeof localStorage === "undefined") return [];
      var arr = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(arr) ? arr.filter(function (x) { return typeof x === "string"; }) : [];
    } catch (e) { return []; }
  }
  function saveStrings(key, list) {
    try { if (typeof localStorage !== "undefined") localStorage.setItem(key, JSON.stringify(list)); }
    catch (e) { /* private mode: session only */ }
  }
  function loadPairs(key, first) {
    try {
      if (typeof localStorage === "undefined") return [];
      var arr = JSON.parse(localStorage.getItem(key) || "[]");
      if (!Array.isArray(arr)) return [];
      return arr.filter(function (x) {
        return x && typeof x === "object" && typeof x[first] === "string" && typeof x.id === "string";
      });
    } catch (e) { return []; }
  }
  function savePairs(key, list) {
    try { if (typeof localStorage !== "undefined") localStorage.setItem(key, JSON.stringify(list)); }
    catch (e) { /* private mode: session only */ }
  }

  /* One database-API round trip; "not-connected" when no socket is open. */
  async function dbCall(method, params) {
    var dbId;
    try { dbId = await Chain.db(); } catch (e) { throw new Error("not-connected"); }
    try { return await Chain.call(dbId, method, params || []); } catch (e) {
      var m = (e && e.message) ? e.message : String(e || "");
      if (m.indexOf("not connected") !== -1) throw new Error("not-connected");
      throw e;
    }
  }
  /* True when the shared socket is open (adds need validation reads). */
  function online() {
    try {
      return typeof Chain !== "undefined" && Chain && typeof Chain.status === "function" &&
        Chain.status().state === "open";
    } catch (e) { return false; }
  }

  /* Route entry: three sections (markets, assets, accounts). Lists always
   * render from storage; only adds need the network. */
  function renderFavourites(root) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    var myGen = ++gen;
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    wrap.appendChild(el(doc, "h1", t("favourites.favourites", "Favourites")));
    wrap.appendChild(el(doc, "p", t("favourites.intro", "Your starred markets, assets, and accounts on this device. Star a market from any market page picker; add assets and accounts below. Stored locally — never synced, never broadcast."),
      "muted"));
    marketSection(doc, wrap, myGen, root);
    assetSection(doc, wrap, myGen, root);
    accountSection(doc, wrap, myGen, root);
  }

  /* Row: link + remove button (tap-sized, never hover-dependent). */
  function row(doc, ul, href, label, sub, onRemove) {
    var li = doc.createElement("li");
    li.className = "mkt-picker-row";
    var a = el(doc, "a", label);
    a.setAttribute("href", href); touchable(a);
    li.appendChild(a);
    if (sub) li.appendChild(el(doc, "span", " " + sub, "muted"));
    var rm = touchable(el(doc, "button", t("favourites.remove", "Remove")));
    rm.type = "button";
    rm.setAttribute("aria-label", "Remove " + label);
    rm.addEventListener("click", onRemove);
    li.appendChild(rm);
    ul.appendChild(li);
  }
  /* Empty state for a section (never a blank list). */
  function empty(doc, section, text) {
    section.appendChild(el(doc, "p", text, "muted"));
  }
  /* Add-form row: text input + button + inline error slot. */
  function addForm(doc, section, inputId, btnId, btnText, placeholder) {
    var form = doc.createElement("form");
    form.className = "mkt-direct";
    var input = doc.createElement("input");
    input.id = inputId; input.type = "text";
    input.setAttribute("placeholder", placeholder);
    input.setAttribute("autocomplete", "off");
    input.setAttribute("autocapitalize", "characters");
    input.setAttribute("spellcheck", "false");
    touchable(input); form.appendChild(input);
    var btn = touchable(el(doc, "button", btnText));
    btn.id = btnId; btn.type = "submit"; form.appendChild(btn);
    section.appendChild(form);
    var err = el(doc, "div", null, "error");
    err.setAttribute("aria-live", "polite"); err.style.display = "none";
    section.appendChild(err);
    return { form: form, input: input, btn: btn, err: err };
  }
  function formError(f, msg) {
    f.err.textContent = msg || ""; f.err.style.display = msg ? "" : t("favourites.none", "none");
  }
  function refresh(root, myGen) {
    if (myGen === gen) renderFavourites(root);
  }

  /* Markets: reads the picker-owned key; stars are toggled on market pages,
   * added here by QUOTE_BASE (validated), removed here per row. */
  function marketSection(doc, wrap, myGen, root) {
    var section = doc.createElement("section");
    var list = loadStrings(MARKETS_KEY);
    section.appendChild(el(doc, "h3", "Markets" + (list.length ? " (" + list.length + ")" : "")));
    if (!list.length) {
      empty(doc, section, t("favourites.no_favourite_markets_yet_star_one_from_any_ma", "No favourite markets yet. Star one from any market page picker, or add a pair below."));
    } else {
      var ul = doc.createElement("ul");
      ul.className = "mkt-picker-list";
      list.slice().sort().forEach(function (id) {
        row(doc, ul, "#/market/" + encodeURIComponent(id), id, null, function () {
          var cur = loadStrings(MARKETS_KEY).filter(function (x) { return x !== id; });
          saveStrings(MARKETS_KEY, cur);
          refresh(root, myGen);
        });
      });
      section.appendChild(ul);
    }
    var f = addForm(doc, section, "fav-market-input", "fav-market-add", "Add market", "QUOTE_BASE, e.g. BTS_USD");
    f.form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      formError(f, "");
      var typed = String(f.input.value || "").trim().toUpperCase();
      var parts = typed.split("_");
      if (parts.length !== 2 || !parts[0] || !parts[1] || parts[0] === parts[1]) {
        formError(f, t("favourites.use_quote_base_with_two_different_symbols_e_g", "Use QUOTE_BASE with two different symbols (e.g. BTS_USD).")); return;
      }
      if (!online()) { formError(f, t("favourites.network_unavailable_new_pairs_are_validated_l", "Network unavailable — new pairs are validated live. Check Settings → Nodes.")); return; }
      f.btn.disabled = true;
      validateMarket(parts[0], parts[1]).then(function () {
        if (myGen !== gen) return;
        var cur = loadStrings(MARKETS_KEY);
        if (cur.indexOf(typed) === -1) { cur.push(typed); saveStrings(MARKETS_KEY, cur); }
        f.btn.disabled = false;
        refresh(root, myGen);
      }).catch(function (e) {
        if (myGen !== gen) return;
        f.btn.disabled = false;
        formError(f, "Unknown market: " + typed + ".");
      });
    });
    wrap.appendChild(section);
  }

  /* Market pair exists when both assets resolve (Market.assets when loaded,
   * else raw lookup_asset_symbols). Rejects unknown pairs. */
  async function validateMarket(quote, base) {
    if (typeof Market !== "undefined" && Market && typeof Market.assets === "function") {
      await Market.assets(quote, base);
      return;
    }
    var rows = await dbCall("lookup_asset_symbols", [[quote, base]]);
    if (!rows || !rows[0] || !rows[1]) throw new Error("unknown-market");
  }

  /* Assets: {symbol,id} pairs validated by symbol lookup, linked to #/asset. */
  function assetSection(doc, wrap, myGen, root) {
    var section = doc.createElement("section");
    var list = loadPairs(ASSETS_KEY, "symbol");
    section.appendChild(el(doc, "h3", "Assets" + (list.length ? " (" + list.length + ")" : "")));
    if (!list.length) {
      empty(doc, section, t("favourites.no_favourite_assets_yet_add_one_by_symbol_bel", "No favourite assets yet. Add one by symbol below."));
    } else {
      var ul = doc.createElement("ul");
      ul.className = "mkt-picker-list";
      list.slice().sort(function (a, b) { return a.symbol < b.symbol ? -1 : (a.symbol > b.symbol ? 1 : 0); }).forEach(function (it) {
        row(doc, ul, "#/asset/" + encodeURIComponent(it.symbol), it.symbol, it.id, function () {
          savePairs(ASSETS_KEY, loadPairs(ASSETS_KEY, "symbol").filter(function (x) { return x.id !== it.id; }));
          refresh(root, myGen);
        });
      });
      section.appendChild(ul);
    }
    var f = addForm(doc, section, "fav-asset-input", "fav-asset-add", "Add asset", "Symbol, e.g. BTS");
    f.form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      formError(f, "");
      var sym = String(f.input.value || "").trim().toUpperCase();
      if (!sym) { formError(f, t("favourites.enter_an_asset_symbol", "Enter an asset symbol.")); return; }
      if (!online()) { formError(f, t("favourites.network_unavailable_symbols_are_validated_liv", "Network unavailable — symbols are validated live. Check Settings → Nodes.")); return; }
      f.btn.disabled = true;
      dbCall("lookup_asset_symbols", [[sym]]).then(function (rows) {
        if (myGen !== gen) return;
        f.btn.disabled = false;
        if (!rows || !rows[0]) { formError(f, "Unknown asset: " + sym + "."); return; }
        var cur = loadPairs(ASSETS_KEY, "symbol");
        if (!cur.some(function (x) { return x.id === rows[0].id; })) {
          cur.push({ symbol: rows[0].symbol, id: rows[0].id });
          savePairs(ASSETS_KEY, cur);
        }
        refresh(root, myGen);
      }).catch(function () {
        if (myGen !== gen) return;
        f.btn.disabled = false;
        formError(f, "Could not validate " + sym + " — network unavailable.");
      });
    });
    wrap.appendChild(section);
  }

  /* Accounts: {name,id} pairs validated by Account.resolve, linked to #/account. */
  function accountSection(doc, wrap, myGen, root) {
    var section = doc.createElement("section");
    var list = loadPairs(ACCOUNTS_KEY, "name");
    section.appendChild(el(doc, "h3", "Accounts" + (list.length ? " (" + list.length + ")" : "")));
    if (!list.length) {
      empty(doc, section, t("favourites.no_favourite_accounts_yet_add_one_by_name_bel", "No favourite accounts yet. Add one by name below."));
    } else {
      var ul = doc.createElement("ul");
      ul.className = "mkt-picker-list";
      list.slice().sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); }).forEach(function (it) {
        row(doc, ul, "#/account/" + encodeURIComponent(it.name), it.name, it.id, function () {
          savePairs(ACCOUNTS_KEY, loadPairs(ACCOUNTS_KEY, "name").filter(function (x) { return x.id !== it.id; }));
          refresh(root, myGen);
        });
      });
      section.appendChild(ul);
    }
    var f = addForm(doc, section, "fav-account-input", "fav-account-add", "Add account", "Account name");
    f.form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      formError(f, "");
      var name = String(f.input.value || "").trim().toLowerCase();
      if (!name) { formError(f, t("favourites.enter_an_account_name", "Enter an account name.")); return; }
      if (!online()) { formError(f, t("favourites.network_unavailable_names_are_validated_live", "Network unavailable — names are validated live. Check Settings → Nodes.")); return; }
      f.btn.disabled = true;
      resolveAccount(name).then(function (found) {
        if (myGen !== gen) return;
        f.btn.disabled = false;
        var cur = loadPairs(ACCOUNTS_KEY, "name");
        if (!cur.some(function (x) { return x.id === found.id; })) {
          cur.push(found);
          savePairs(ACCOUNTS_KEY, cur);
        }
        refresh(root, myGen);
      }).catch(function () {
        if (myGen !== gen) return;
        f.btn.disabled = false;
        formError(f, "Unknown account: " + name + ".");
      });
    });
    wrap.appendChild(section);
  }

  /* Account name -> {name,id} via Account.resolve when loaded, else direct
   * get_account_by_name. Rejects unknown names. */
  async function resolveAccount(name) {
    if (typeof Account !== "undefined" && Account && typeof Account.resolve === "function") {
      return Account.resolve(name);
    }
    var acct = await dbCall("get_account_by_name", [name]);
    if (!acct) throw new Error("unknown-account");
    return { name: acct.name, id: acct.id };
  }

  return { renderFavourites: renderFavourites };
})();

if (typeof module !== "undefined") { module.exports = FavouritesUI; }
