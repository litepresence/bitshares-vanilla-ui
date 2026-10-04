/* AssetUI: asset list + create screens (ops 10).
 * Owns: #/assets (issued-by-account list; fee-schedule section embedded from
 *   AssetFeedUI), #/assets/create (tabbed UIA/Smartcoin/NFT/PMA over one
 *   op-10 builder). Update/issue/reserve live in asset-manage-ui.js
 *   (global AssetManageUI, loaded after this file).
 * Consumes: Asset (issuedBy/describe reads), AssetOps (buildCreate/fee/
 *   sendAndProve + pct helpers), Account, Wallet, Tx.buildTx, Format,
 *   Chain, Store. Side effects: DOM under root, global AssetUI only. WIF
 *   never hits the DOM.
 * Created by: building-vanilla-slices skill, slice-10 plan Task 3.
 * Repaired by: slice-10 audit fix B2 (update/issue split to asset-manage-ui.js,
 *   behavior-identical; builder/helper refs moved Asset -> AssetOps).
 * TRUTH: op fields <- asset_ops.hpp; hundredths vs ratio/1000 via AssetOps
 *   only; CER quote "1.3.1" re-read-proven; symbol uniqueness via the lookup
 *   pre-check.
 */
var AssetUI = (function () {
  "use strict";

  /* Batch-2d i18n (slice-17 precedent): display strings resolve via I18n.t with
   * the pre-conversion literal kept verbatim as enDefault (English-identical on any
   * transport, incl. file:// where dict fetch fails). Falls back to the default
   * when i18n.js failed to load: never blank, never throws. Dynamic sentences keep
   * their code structure (batch-2b precedent): only complete static literals and
   * word-bearing segments are wrapped, values and punctuation glue stay raw, so
   * every default below is byte-verbatim in the HEAD blob. */
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    if (vars && typeof dflt === "string") return dflt.replace(/%\(([^)]+)\)s/g, function (m, name) {
      return (vars && Object.prototype.hasOwnProperty.call(vars, name)) ? String(vars[name]) : m;
    });
    return dflt;
  }
  var CORE = "1.3.0", SYM_RE = /^[A-Z0-9.]+$/;
  /* feeTierForSymbol: full symbol string -> op-10 fee-schedule param key.
   * FEE TRUTH (slice-10 live vectors: op-10 {symbol3, symbol4, long_symbol,
   * price_per_kbyte}; NO PMO discount exists — a sub-asset like ORG.MARKET
   * is cheap/expensive purely by its FULL length incl. dots): length 3 ->
   * "symbol3", length 4 -> "symbol4", length >= 5 -> "long_symbol", anything
   * shorter -> null (chain minimum is 3; the review gate rejects it with
   * bad-symbol). Trims + uppercases, never throws. Params: sym (string).
   * Returns the key or null. */
  function feeTierForSymbol(sym) {
    var s = (sym === undefined || sym === null) ? "" : String(sym).trim().toUpperCase();
    if (s.length === 3) return "symbol3";
    if (s.length === 4) return "symbol4";
    if (s.length >= 5) return "long_symbol";
    return null;
  }
  /* isSubAssetOf: "ORG.MARKET" belongs to "ORG". Value-copy of the canonical
   * PredictionUI helper (OP_NAMES precedent — copied, not imported, so this
   * file stays self-contained per the doctrine): same contract, same
   * edge cases ("ORG" is not its own child; prefix-without-dot is false). */
  function isSubAssetOf(sym, parent) {
    var s = (sym === undefined || sym === null) ? "" : String(sym).trim().toUpperCase();
    var p = (parent === undefined || parent === null) ? "" : String(parent).trim().toUpperCase();
    if (!s || !p) return false;
    if (p.charAt(p.length - 1) === ".") p = p.slice(0, -1);
    if (!p) return false;
    var prefix = p + ".";
    return s.length > prefix.length && s.indexOf(prefix) === 0 &&
      /^[A-Z0-9.]+$/.test(s) && s.charAt(s.length - 1) !== ".";
  }
  /* pmoTemplate: blank PMO org description (empty pmo_object per the
   * BTS-CM/pma schema — type fixed, every human field empty for the issuer
   * to complete). 2-space JSON so the textarea stays readable. No chain
   * state, pure string. */
  function pmoTemplate() {
    return JSON.stringify({ main: "", pmo_object: { type: "PMO/ORGANIZATION@1.0",
      identity: { name: "", website: "", manifest: "" },
      governance: { resolution_policy: "", dispute_mechanism: "", onchain_account: "" },
      attestation: "" } }, null, 2);
  }
  /* hashSubParent: "?sub=PARENT" from the current hash query (router strips
   * the query before matching, so the view reads location.hash itself).
   * Returns the uppercased parent symbol or "" (absent/invalid/harmless).
   * Never throws. */
  function hashSubParent() {
    try {
      var h = (typeof location !== "undefined" && location.hash) || "";
      var q = h.indexOf("?");
      if (q === -1) return "";
      var parts = h.slice(q + 1).split("&");
      for (var i = 0; i < parts.length; i++) {
        var kv = parts[i].split("=");
        if (kv[0] === "sub" && kv[1]) {
          var v = decodeURIComponent(kv[1]).trim().toUpperCase();
          if (/^[A-Z0-9.]+$/.test(v) && v.charAt(v.length - 1) !== ".") return v;
          return "";
        }
      }
    } catch (e) { /* no prefill */ }
    return "";
  }
  var PERMS = [[1, "charge fee"], [2, "whitelist"], [4, "override"], [8, "restricted"], [16, "no force settle"], [32, "global settle"], [64, "no confidential"], [128, "witness-fed"], [256, "committee-fed"]];
  var FLAGS = [[1, "charge fee"], [2, "whitelist"], [4, "override"], [8, "restricted"], [16, "no force settle"], [64, "no confidential"], [128, "witness-fed"], [256, "committee-fed"]], gen = 0;
  /* el: textContent-only element. touchable: >=44px floor. */
  function el(d, t, x, c) { var n = d.createElement(t); if (c) n.className = c; if (x !== undefined && x !== null) n.textContent = x; return n; }
  function touch(n) { n.style.minHeight = "44px"; return n; } function wipe(r) { while (r.firstChild) r.removeChild(r.firstChild); }
  function wrap(d, r) { var w = d.createElement("div"); w.className = "wrap"; r.appendChild(w); return w; }
  /* showError: never-blank human panel for named chain errors. */
  function err(d, w, e, fb) {
    var b = el(d, "div", null, "error"); b.setAttribute("aria-live", "polite");
    var m = (e && e.message) ? e.message : String(e || fb || t("common.unexpected_error", "Unexpected error"));
    if (m.indexOf("unknown-asset") !== -1) m = fb || t("barter.unknown_asset", "Unknown asset.");
    else if (m.indexOf("unknown-account") !== -1) m = fb || t("barter.unknown_account", "Unknown account.");
    else if (m.indexOf("symbol-taken") !== -1) m = t("asset.symbol_taken", "Symbol is already taken.");
    else if (m.indexOf("not-issuer") !== -1) m = t("asset.only_issuer", "Only the issuer can change this.");
    else if (m.indexOf("not-market-issued") !== -1) m = t("asset.not_market_issued", "Not a market-issued asset.");
    else if (m.indexOf("wallet-locked") !== -1) m = t("common.wallet_locked", "Wallet is locked.");
    else if (m.indexOf("not-connected") !== -1 || m.indexOf("not connected") !== -1) m = t("common.network_unavailable", "Network unavailable. Check Settings → Nodes and retry.");
    b.textContent = m; w.appendChild(b); return b;
  }
  function status(d, w, t) { var p = el(d, "p", t, "muted"); p.setAttribute("aria-live", "polite"); w.appendChild(p); return p; }
  /* netName: display-only network label. feePrec: human-fee precision. */
  function netName() { try { return Store.loadSettings().network || "mainnet"; } catch (e) { return "mainnet"; } }
  async function feePrec(id) {
    try { var r = await Chain.call(await Chain.db(), "get_assets", [[id || CORE]]); if (r && r[0]) return r[0].precision; } catch (e) { /* p5 */ } return 5;
  }
  async function head() { try { var p = await Chain.call(await Chain.db(), "get_dynamic_global_properties", []); return p.head_block_number || 0; } catch (e) { return 0; } }
  function noBackend() { return (typeof Asset === "undefined" || typeof AssetOps === "undefined" || typeof Tx === "undefined" || typeof Account === "undefined" || typeof Wallet === "undefined" || typeof Format === "undefined"); }
  /* cold: offline panel + Retry, plus auto-rerun on reconnect (transfer/
   * vote/explorer Store.subscribe("connection",…) pattern — without it the
   * stale offline panel survives after connect). true = caller stops. */
  function cold(d, w, root, rerun) {
    if (Chain.status && Chain.status().state === "open") return false;
    w.appendChild(DOM.pageHead(d, t("assets.title", "Assets"), "assets")); err(d, w,new Error("not-connected"),t("createaccount.network_unavailable", "Network unavailable."));
    var cstat = el(d, "p", "", "muted");
    try { cstat.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
    w.appendChild(cstat);
    var crow = el(d, "div", null, "pools-offline-row");
    w.appendChild(crow);
    var b = touch(el(d, "button", t("fees.retry", "Retry"))); b.type = "button"; crow.appendChild(b);
    var coff = null;
    try { coff = (typeof Offline !== "undefined" && Offline) ? Offline : null; } catch (e) { coff = null; }
    var crerun = function () {
      if (!settled) { settled = true; try { off(); } catch (e) { /* gone */ } } rerun(); };
    if (coff && typeof coff.wire === "function") {
      try { coff.wire(b, cstat, crerun, t); } catch (e) { b.addEventListener("click", crerun); }
    } else {
      b.addEventListener("click", crerun);
    }
    var clink = null;
    if (coff && typeof coff.settingsLink === "function") {
      try { clink = coff.settingsLink(d, t); } catch (e) { clink = null; }
    }
    if (!clink) {
      clink = el(d, "a", t("notice.open_settings", "Open Settings"));
      try { clink.setAttribute("href", "#/settings"); } catch (e) { /* label stands */ }
      touch(clink);
    }
    crow.appendChild(clink);
    var hashAtEntry = (typeof location !== "undefined" && location.hash) || "";
    var settled = false, off = function () {};
    if (typeof Store !== "undefined" && Store && typeof Store.subscribe === "function") {
      off = Store.subscribe("connection", function (st) {
        if (settled) return;
        if (st && st.state === "open") { settled = true; try { off(); } catch (e) { /* gone */ }
          if (typeof location === "undefined" || location.hash === hashAtEntry) rerun(); }
      });
    }
    try { if (coff && typeof coff.ensure === "function") coff.ensure(); } catch (e) { /* wait above covers */ }
    return true;
  }
  /* No local field builder — use Forms.labeledInput (row + input) or
   * Forms.labeledTextarea for the description box (plus autocomplete off).
   * bits stays local (checkbox group, not a labeled row). */
  /* bits: permission-bit checkbox group. Params: doc, [bit,label] list,
   * current mask. Returns {box, read()} where read() ORs checked bits. */
  function bits(d, list, cur) {
    var box = el(d, "div", null, "asset-bits");
    box.style.display = "flex"; box.style.flexWrap = "wrap"; box.style.gap = "8px";
    var cs = list.map(function (p) {
      var lab = el(d, "label", p[1] + " "), c = d.createElement("input");
      c.type = "checkbox"; c.value = String(p[0]); c.checked = !!((cur || 0) & p[0]); touch(c);
      lab.insertBefore(c, lab.firstChild); box.appendChild(lab); return c;
    });
    return { box: box, read: function () { var v = 0; cs.forEach(function (c) { if (c.checked) v |= parseInt(c.value, 10); }); return v; } };
  }
  /* bitNames: bit int -> "a, b" label list for confirm rows. */
  function bitNames(list, v) { var o = []; list.forEach(function (p) { if (v & p[0]) o.push(p[1]); }); return o.length ? o.join(", ") : "(none)"; }
  /* No local confirm builder — use ConfirmDialog.show (title/rows/feeHuman/
   * Back/Sign&Send). Fee/network rows are built at the call site; unlock
   * gates + status + sendAndProve stay in the caller's onSend. */
  /* done: observed-head result panel (no fabricated txid). */
  function done(d, w, title, headN, via, sub, href, link) {
    w.appendChild(DOM.pageHead(d, title, "assets")); var ok = el(d, "p", "Observed at head block #" + headN + " (" + via + ").", "xfer-ok");
    ok.setAttribute("aria-live", "polite"); w.appendChild(ok); w.appendChild(el(d, "p", sub, "muted"));
    var a = el(d, "a", link); a.setAttribute("href", href); touch(a); w.appendChild(a);
  }
  /* publish: buildTx + fresh-WIF sendAndProve + head-marked result. No auto-retry. */
  async function publish(root, d, g, pair, prove, title, sub, href, link, onStep) {
    var unsigned = await Tx.buildTx([pair]);
    var wif = (Wallet.keys && Wallet.keys.active) ? Wallet.keys.active.wif : null;
    if (!wif) throw new Error("wallet-locked"); onStep("Broadcasting…");
    var r = await AssetOps.sendAndProve(unsigned, wif, prove);
    var h = await head(); if (g !== gen) return;
    wipe(root); done(d, wrap(d, root), title, h, r.via, sub, href, link);
  }
  /* nav: entry cards linking to the four asset screens. */
  function nav(d, w) {
    var n = el(d, "div", null, "asset-nav");
    n.style.display = "flex"; n.style.flexWrap = "wrap"; n.style.gap = "8px";
    [[t("asset.create_title", "Create asset"),  "#/assets/create"], [t("asset.issue_title", "Issue / reserve"),  "#/assets/issue"], [t("asset.feed_title", "Publish feed"),  "#/assets/feed"]].forEach(function (l) { var a = el(d, "a", l[0]); a.setAttribute("href", l[1]); touch(a); n.appendChild(a); });
    w.appendChild(n);
  }
  /* renderAssets: issued-by-account list + fee-schedule section (feed-ui owns). */
  function renderAssets(root) {
    if (!root) return;
    var d = root.ownerDocument || document, g = ++gen;
    wipe(root); var w = wrap(d, root);
    if (noBackend()) { err(d, w,t("asset.backend_missing", "Asset backend missing.")); return; }
    if (cold(d, w, root, function () { renderAssets(root); })) return;
    w.appendChild(DOM.pageHead(d, t("assets.title", "Assets"), "assets")); nav(d, w);
    var f = Forms.labeledInput(d, t("asset.issuer_field", "Issuer (name or 1.2.N)") + " ", { id: "asset-issuer", value: "", autocomplete: "off" }); w.appendChild(f.row);
    var go = touch(el(d, "button", t("asset.load_issued", "Load issued assets"))); go.type = "button"; w.appendChild(go);
    /* Punchlist MED: default table without a manual LOAD — the explorer
     * all-assets table is one link away, and the wallet account's issued
     * list auto-loads once the prefill below resolves. Plain literals only. */
    (function browseAll() {
      var p = el(d, "p", null, "muted");
      var a = d.createElement("a"); a.setAttribute("href", "#/explorer/assets"); a.textContent = t("asset.browse_all", "Browse all assets"); touch(a);
      p.appendChild(a); w.appendChild(p);
    })();
    var list = el(d, "div", null, "asset-list"); w.appendChild(list);
    var fees = el(d, "div", null, "asset-fees"); w.appendChild(fees);
    if (typeof AssetFeedUI !== "undefined" && AssetFeedUI.feeSection) AssetFeedUI.feeSection(d, fees);
    Account.myAccountId().then(function (id) { return Account.resolve(id); }).then(function (me) {
      if (g === gen && !f.input.value) { f.input.value = me.name; try { go.click(); } catch (e) { /* manual LOAD stands */ } } }).catch(function () { /* manual stands */ });
    go.addEventListener("click", function () {
      var v = f.input.value.trim(); if (!v) { err(d, list,t("asset.enter_issuer", "Enter an issuer account.")); return; }
      wipe(list); status(d, list, t("asset.loading_issued", "Loading issued assets…"));
      Account.resolve(v).then(function (a) { return Asset.issuedBy(a.id, "1.3.0", 100); }).then(function (rows) {
        if (g !== gen) return; wipe(list);
        if (!rows.length) { list.appendChild(el(d, "p", t("asset.no_issued", "No assets issued by this account.") + t("asset.create_hint", " Create one at #/assets/create — issued assets list here."), "muted")); return; }
        rows.forEach(function (r) {
          var card = el(d, "div", null, "asset-row");
          card.style.display = "flex"; card.style.flexWrap = "wrap"; card.style.gap = "8px";
          var nm = el(d, "strong", r.symbol + " "); nm.title = r.id; card.appendChild(nm);
          var sup = "—"; try { sup = (r.supply_raw === null) ? "—" : Format.formatAmount(r.supply_raw, r.precision); } catch (e) { sup = String(r.supply_raw); } /* raw only pre-format */
          card.appendChild(el(d, "span", "p" + r.precision + " · supply " + sup + (r.is_smartcoin ? " · smartcoin" : ""), "muted"));
          var o = el(d, "a", t("credit.open", "Open")); o.setAttribute("href", "#/asset/" + r.symbol); touch(o); card.appendChild(o);
          var u = el(d, "a", t("misc.update", "Update")); u.setAttribute("href", "#/assets/update/" + r.symbol); touch(u); card.appendChild(u);
          /* LOW punchlist: inline Issue action per row (op-14 lives at
           * #/assets/issue — cross-link, no new route). Batch-3 i18n: keyed. */
          var isl = d.createElement("a"); isl.href = "#/assets/issue"; isl.textContent = t("asset.issue", "Issue"); touch(isl); card.appendChild(isl);
          list.appendChild(card); });
      }).catch(function (e) { if (g === gen) { wipe(list); err(d, list,e,t("asset.issued_failed", "Could not load issued assets.")); } });
    });
  }
  /* renderCreate: tabbed UIA/Smartcoin/NFT/PMA over one op-10 builder. */
  function renderCreate(root) {
    if (!root) return;
    var d = root.ownerDocument || document, g = ++gen;
    wipe(root); var w = wrap(d, root);
    if (noBackend()) { err(d, w,t("asset.backend_missing", "Asset backend missing.")); return; }
    if (cold(d, w, root, function () { renderCreate(root); })) return;
    /* No entry unlock gate (G1 repair): tabs + builder render locked with an
     * explicit issuer input (public 1.2.0 default, never myAccountId at
     * render — asset-manage-ui.js half() pattern); the password stays ONLY
     * at publish() via the fresh-WIF throw. Fee stays live (AssetOps.fee ->
     * get_required_fees) at review time in both states. */
    w.appendChild(DOM.pageHead(d, t("asset.create_title", "Create asset"), "assets"));
    try {
      if (typeof Wallet === "undefined" || !Wallet.isUnlocked()) {
        var _v = (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.get === "function") ? ViewingAs.get() : { id: "1.2.0", name: "committee-account" };
        w.appendChild(el(d, "p", t("viewing.notice_locked", "Viewing as %(name)s (%(id)s) — unlock to act as yourself.", { name: _v.name, id: _v.id }), "muted"));
      }
    } catch (e) { /* notice is display-only */ }
    var issuerDef = (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0";
    var issuer = Forms.labeledInput(d, t("asset.issuer_field", "Issuer (name or 1.2.N)") + " ", { value: issuerDef, autocomplete: "off" });
    w.appendChild(issuer.row);
    /* LOW punchlist: account-detached flow honesty — this page defaults to
     * the viewing-as account; opening it from an account page keeps context.
     * Batch-3 i18n: keyed. */
    (function issuerNote() {
      var p = el(d, "p", t("asset.issuer_defaults_to_the_viewing_as_accoun", "Issuer defaults to the viewing-as account (1.2.0 locked, your account unlocked) — type any issuer you control. Opened from an account page, paste that account name here."), "muted");
      var a = el(d, "a", t("asset.open_an_account", "Open an account"));
      a.setAttribute("href", "#/accounts");
      touch(a);
      p.appendChild(d.createTextNode(" · "));
      p.appendChild(a);
      w.appendChild(p);
    })();
    /* Unlocked prefill: swap the public 1.2.0 default for the wallet account
     * (locked viewers keep 1.2.0). Null-tolerant, gen-guarded — manual stands. */
    Account.myAccountId().then(function (id) { return Account.resolve(id); }).then(function (me) {
      if (g === gen && issuer.input.value.trim() === issuerDef) issuer.input.value = me.name; }).catch(function () { /* manual stands */ });
    var tab = "uia", bar = el(d, "div", null, "vote-tabs"); w.appendChild(bar);
    var body = el(d, "div", null, "asset-create"); w.appendChild(body);
    function draw() {
      if (g !== gen) return;
      wipe(bar); wipe(body);
      [["uia", t("asset.tab_uia", "UIA")], ["smart", t("asset.smartcoin_row", "Smartcoin")], ["nft", t("asset.nft_row", "NFT")], ["pma", t("asset.tab_pma", "PMA")]].forEach(function (t) {
        var b = touch(el(d, "button", t[1], tab === t[0] ? "vote-tab active" : "vote-tab"));
        b.type = "button"; b.addEventListener("click", function () { tab = t[0]; draw(); }); bar.appendChild(b); });
      var smart = (tab === "smart" || tab === "pma"), nft = (tab === "nft");
      if (tab === "pma") body.appendChild(el(d, "p", t("asset.pma_note", "Prediction market: is_prediction_market locked ON."), "muted"));
      var sym = Forms.labeledInput(d, t("asset.symbol_field", "Symbol (A-Z0-9.)") + " ", { value: "", placeholder: "AFKTEST01", autocomplete: "off" });
      var prec = Forms.labeledInput(d, t("asset.precision_field", "Precision (0–12)") + " ", { value: "4", inputmode: "numeric", autocomplete: "off" });
      var msup = Forms.labeledInput(d, t("asset.max_supply_field", "Max supply (human)") + " ", { value: "1000000", inputmode: "decimal", autocomplete: "off" });
      var fpct = Forms.labeledInput(d, t("asset.market_fee_field", "Market fee % (human)") + " ", { value: "0", inputmode: "decimal", autocomplete: "off" });
      var mfee = Forms.labeledInput(d, t("asset.max_market_fee_field", "Max market fee (human)") + " ", { value: "1000000", inputmode: "decimal", autocomplete: "off" });
      var cb = Forms.labeledInput(d, t("asset.cer_base_field", "CER base (human, core)") + " ", { value: "1", inputmode: "decimal", autocomplete: "off" });
      var cq = Forms.labeledInput(d, t("asset.cer_quote_field", "CER quote (human, new asset)") + " ", { value: "1", inputmode: "decimal", autocomplete: "off" });
      var desc = Forms.labeledTextarea(d, t("asset.description_row", "Description") + " ", { value: "" });
      desc.input.setAttribute("autocomplete", "off");
      /* Sub-asset prefill (?sub=PARENT from the PMO org detail): the symbol
       * starts as "PARENT." with the cursor left for the child name; manual
       * typing always wins (only applied when the box is still empty). */
      var subParent = hashSubParent();
      if (subParent) sym.input.value = subParent + ".";
      body.appendChild(sym.row);
      /* Fee-tier line: tier name by FULL symbol length next to the schedule
       * param it will charge (Asset.feeSchedule, same reader fees-ui.js
       * uses — the live get_required_fees fee still lands at review time in
       * confirm()). Schedule fill is gen-guarded best-effort: tier name
       * paints synchronously, the param amount joins when the schedule
       * resolves; a schedule miss leaves the honest tier-only line. */
      var tierP = el(d, "p", "", "muted"); body.appendChild(tierP);
      var schedTier = null;
      function tierWords(key) {
        if (key === "symbol3") return t("asset.tier_symbol3", "3-char symbols");
        if (key === "symbol4") return t("asset.tier_symbol4", "4-char symbols");
        return t("asset.tier_long", "Long symbols (5+)");
      }
      function paintTier() {
        var key = feeTierForSymbol(sym.input.value);
        var label = t("asset.fee_tier", "Fee tier") + ": ";
        if (!key) {
          tierP.textContent = label + "—";
          return;
        }
        var txt = label + tierWords(key) + " (" + key + ")";
        if (sym.input.value.indexOf(".") !== -1) txt += " · " + t("asset.sub_symbol_hint", "Dotted symbol: keep the parent prefix and dot.");
        if (schedTier && schedTier[key]) txt += " · " + schedTier[key];
        txt += " · " + t("asset.fee_no_pmo_discount", "No PMO discount: the create fee follows the full symbol length.");
        tierP.textContent = txt;
      }
      sym.input.addEventListener("input", paintTier);
      paintTier();
      if (typeof Asset !== "undefined" && Asset && typeof Asset.feeSchedule === "function") {
        Asset.feeSchedule().then(function (s) {
          if (g !== gen) return;
          var found = null;
          (s.fees || []).forEach(function (f) { if (f.opId === 10) found = f; });
          if (!found) return;
          var precFee = s.fee_asset_precision, out = {};
          ["symbol3", "symbol4", "long_symbol"].forEach(function (k) {
            var raw = (found.scaled && found.scaled[k] !== undefined) ? found.scaled[k]
              : ((found.raw && found.raw[k] !== undefined) ? found.raw[k] : null);
            if (raw === null) return;
            try { out[k] = "schedule " + k + " = " + Format.formatAmount(String(raw), precFee) + " core"; }
            catch (e) { out[k] = "schedule " + k + " = " + String(raw); }
          });
          schedTier = out;
          paintTier();
        }).catch(function () { /* tier-only line stands */ });
      }
      [prec, msup, fpct, mfee, cb, cq, desc].forEach(function (x) { body.appendChild(x.row); });
      /* PMO create prefill: fills the description with the empty pmo_object
       * template (issuer completes identity/governance). Overwrites only
       * with explicit click; the hint confirms the fill landed. */
      (function pmoPrefill() {
        var rowB = touch(el(d, "button", t("asset.prefill_pmo", "Prefill PMO template"))); rowB.type = "button";
        body.appendChild(rowB);
        if (subParent) body.appendChild(el(d, "p", t("asset.sub_symbol_hint", "Dotted symbol: keep the parent prefix and dot."), "muted"));
        var filled = el(d, "p", "", "muted"); body.appendChild(filled);
        rowB.addEventListener("click", function () {
          desc.input.value = pmoTemplate();
          filled.textContent = t("asset.pmo_template_hint", "PMO template filled — complete the identity and governance fields.");
        });
      })();
      /* LOW punchlist: structured-description guidance — one textarea carries
       * the whole description object; main/title/short/market go inside as
       * JSON-ish text. Batch-3 i18n: keyed. */
      body.appendChild(el(d, "p", t("asset.description_is_one_text_box_write_the_fu", "Description is one text box: write the full description here (main, short name, market pair and details as plain text)."), "muted"));
      body.appendChild(el(d, "h2", t("help.topic_accounts-permissions_title", "Permissions"))); var pg = bits(d, PERMS, 79); body.appendChild(pg.box);
      body.appendChild(el(d, "h2", t("asset.flags_title", "Flags"))); var fg = bits(d, FLAGS, 0); body.appendChild(fg.box);
      var nt = null, nu = null, lh = null, mf = null, dl = null, op = null, mv = null, ba = null;
      if (nft) { body.appendChild(el(d, "h2", t("asset.nft_meta_title", "NFT metadata (description nft_object)")));
        nt = Forms.labeledInput(d, t("asset.nft_title_field", "NFT title") + " ", { value: "", autocomplete: "off" }); nu = Forms.labeledInput(d, t("asset.nft_uri_field", "NFT URI") + " ", { value: "", autocomplete: "off" });
        body.appendChild(nt.row); body.appendChild(nu.row); }
      if (smart) { body.appendChild(el(d, "h2", t("asset.bitasset_title", "Bitasset options")));
        lh = Forms.labeledInput(d, t("asset.feed_lifetime_field", "Feed lifetime (hours)") + " ", { value: "24", inputmode: "numeric", autocomplete: "off" }); mf = Forms.labeledInput(d, t("explorer.min_feeds", "Minimum feeds") + " ", { value: "1", inputmode: "numeric", autocomplete: "off" });
        dl = Forms.labeledInput(d, t("asset.settle_delay_field", "Settlement delay (sec)") + " ", { value: "86400", inputmode: "numeric", autocomplete: "off" }); op = Forms.labeledInput(d, t("asset.settle_offset_field", "Settlement offset %") + " ", { value: "1", inputmode: "decimal", autocomplete: "off" });
        mv = Forms.labeledInput(d, t("asset.max_settle_vol_field", "Max settlement vol %") + " ", { value: "20", inputmode: "decimal", autocomplete: "off" }); ba = Forms.labeledInput(d, t("asset.backing_field", "Backing (1.3.N)") + " ", { value: "1.3.0", autocomplete: "off" });
        [lh, mf, dl, op, mv, ba].forEach(function (x) { body.appendChild(x.row); }); }
      var rev = touch(el(d, "button", t("credit.review_create", "Review create"))); rev.type = "button"; body.appendChild(rev);
      rev.addEventListener("click", function () {
        rev.disabled = true;
        (async function () {
          var symbol = sym.input.value.trim().toUpperCase();
          if (!SYM_RE.test(symbol)) throw new Error(t("asset.err_bad_symbol", "bad-symbol (uppercased A-Z0-9.)"));
          var precision = parseInt(prec.input.value.trim(), 10);
          if (!(precision >= 0 && precision <= 12)) throw new Error(t("asset.err_precision", "precision must be 0-12"));
          var db = await Chain.db();
          var taken = await Chain.call(db, "lookup_asset_symbols", [[symbol]]);
          if (taken && taken[0]) throw new Error("symbol-taken");
          var me = await Account.resolve(issuer.input.value.trim() || issuerDef);
          var perms = pg.read(), flags = fg.read();
          if (!smart) { perms &= ~(128 | 256 | 32); flags &= ~(128 | 256); }
          var nftObj = null;
          if (nft) { var ntT = nt.input.value.trim(), u = nu.input.value.trim();
            if (!ntT && !u) throw new Error(t("asset.err_nft_meta", "NFT needs a title or URI."));
            nftObj = { title: ntT || symbol, type: "nft", uri: u || "" }; }
          var bit = null;
          if (smart) bit = { feed_lifetime_sec: parseInt(lh.input.value.trim(), 10) * 3600,
            minimum_feeds: parseInt(mf.input.value.trim(), 10),
            force_settlement_delay_sec: parseInt(dl.input.value.trim(), 10),
            offset_hundredths: AssetOps.pctHumanToHundredths(op.input.value),
            max_settle_vol_hundredths: AssetOps.pctHumanToHundredths(mv.input.value),
            short_backing_asset: ba.input.value.trim() };
          var bm = await Chain.call(db, "get_assets", [[CORE]]);
          var bp = (bm && bm[0]) ? bm[0].precision : 5;
          var pair = AssetOps.buildCreate({ issuerId: me.id, symbol: symbol, precision: precision,
            maxSupplyHuman: msup.input.value, marketFeePctHuman: fpct.input.value || "0",
            maxMarketFeeHuman: mfee.input.value, permissions: perms, flags: flags,
            cerBaseRaw: Format.parseAmount(cb.input.value || "1", bp),
            cerQuoteRaw: Format.parseAmount(cq.input.value || "1", precision),
            cerBaseId: CORE, description: desc.input.value || "", nft: nftObj, bitasset: bit,
            is_prediction_market: (tab === "pma") });
          var f = await AssetOps.fee(pair, CORE); pair[1].fee = { amount: f.amount, asset_id: f.asset_id };
          var rows = [[t("explorer.issuer_row", "Issuer"),  me.name + " (" + me.id + ")"], [t("explorer.th_symbol", "Symbol"),  symbol], [t("explorer.precision_row", "Precision"),  String(precision)],
            [t("explorer.max_supply", "Max supply"),  msup.input.value],
            [t("explorer.market_fee", "Market fee"),  AssetOps.hundredthsToPct(pair[1].common_options.market_fee_percent) + "%", String(pair[1].common_options.market_fee_percent)],
            [t("help.topic_accounts-permissions_title", "Permissions"),  bitNames(PERMS, perms)], [t("asset.flags_title", "Flags"),  bitNames(FLAGS, flags)],
            [t("asset.cer_row", "CER"),  (cb.input.value || "1") + " CORE / " + (cq.input.value || "1") + " " + symbol]];
          if (bit) rows.push([t("asset.bitasset_row", "Bitasset"),  "feeds≥" + mf.input.value + ", backing " + bit.short_backing_asset]);
          if (nftObj) rows.push([t("asset.nft_row", "NFT"),  (nftObj.title || "") + " / nft"]);
          rows.push([t("asset.pma_row", "Prediction market"),  (tab === "pma") ? "yes" : "no"]);
          /* Fee-tier cell next to the live get_required_fees fee: tier name
           * + which schedule param applied (from the draw-time feeSchedule
           * fill when it resolved). The fee itself stays the live chain
           * answer — this row only names the tier behind it. */
          (function tierRow() {
            var tierKey = feeTierForSymbol(symbol);
            if (!tierKey) { rows.push([t("asset.fee_tier", "Fee tier"), "—"]); return; }
            var cell = tierWords(tierKey) + " (" + tierKey + ")";
            if (schedTier && schedTier[tierKey]) cell += " · " + schedTier[tierKey];
            rows.push([t("asset.fee_tier", "Fee tier"), cell,
              t("asset.fee_no_pmo_discount", "No PMO discount: the create fee follows the full symbol length.")]);
          })();
          if (g !== gen) return; wipe(root);
          var w2 = wrap(d, root), fpp = await feePrec(f.asset_id);
          var feeHuman;
          try { feeHuman = Format.formatAmount(String(f.amount), fpp) + " (core)"; }
          catch (feeErr) { feeHuman = String(f.amount) + " (core)"; }
          rows.push([t("borrow.network", "Network"), netName()]);
          var dlg = ConfirmDialog.show({ title: t("asset.confirm_create", "Confirm asset create"),
            rows: rows, feeHuman: feeHuman, feeTerm: t("borrow.fee", "Fee"),
            backLabel: t("barter.back", "Back"), sendLabel: t("barter.sign_send", "Sign & Send"),
            onBack: function () { renderCreate(root); },
            onSend: function () {
              var btns = dlg.getElementsByTagName("button");
              var backB = btns[0], sendB = btns[1];
              backB.disabled = true; sendB.disabled = true;
              var st = status(d, w2, "Signing…");
              publish(root, d, g, pair, async function () {
                try { return await Asset.describe(symbol); } catch (e) { return null; }
              }, t("asset.created", "Asset created"), symbol + " precision " + precision + " issued by " + me.name + ".",
                "#/asset/" + symbol, "Open " + symbol, function (x) { st.textContent = x; }).catch(function (e) {
                try { w2.removeChild(st); } catch (x) { /* gone */ }
                err(d, w2, e, t("createworker.send_failed", "Send failed.")); backB.disabled = false; });
            } });
          w2.appendChild(dlg);
        })().catch(function (e) { rev.disabled = false; err(d, body,e,t("credit.could_not_prepare_the_create", "Could not prepare the create.")); });
      });
    }
    draw();
  }
  return { renderAssets: renderAssets, renderCreate: renderCreate,
    _test: { feeTierForSymbol: feeTierForSymbol, isSubAssetOf: isSubAssetOf, pmoTemplate: pmoTemplate } };
})();
if (typeof globalThis !== "undefined" && typeof globalThis.AssetUI === "undefined") { globalThis.AssetUI = AssetUI; }
if (typeof module !== "undefined") { module.exports = AssetUI; }
