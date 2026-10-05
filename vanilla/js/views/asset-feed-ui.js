/* AssetFeedUI: feed publish + producer editor + fee-schedule section.
 * Owns: #/assets/feed and the fee-schedule table (AssetUI list embeds it).
 * Consumes: Asset (describe/feeSchedule reads), AssetOps (buildFeed/
 *   buildUpdateProducers/fee/sendAndProve + ratio helpers), Account, Wallet, Tx.buildTx, Format,
 *   Chain, Store. Side effects: DOM under root, global AssetFeedUI only.
 * Created by: building-vanilla-slices skill, slice-10 plan Task 3.
 * TRUTH: op-19 feed = (settlement)(MCR u16)(MSSR u16)(CER) <- asset_ops.hpp
 *   :462-480; ratios over 1000 (1750 = 175%) vs hundredths via Asset only;
 *   legs: settlement base MPA/quote backing, CER base MPA/quote backing
 *   (asset_ops.cpp:178 settlement.base == CER.base; asset.cpp:266 is_for
 *   checks the base leg).
 */
var AssetFeedUI = (function () {
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
  var CORE = "1.3.0", PLACES = 8;
  var gen = 0, feeGen = 0;
  function el(d, t, x, c) { var n = d.createElement(t); if (c) n.className = c; if (x !== undefined && x !== null) n.textContent = x; return n; }
  function touch(n) { n.style.minHeight = "44px"; return n; }
  function wipe(r) { while (r.firstChild) r.removeChild(r.firstChild); }
  function wrap(d, r) { var w = d.createElement("div"); w.className = "wrap"; r.appendChild(w); return w; }
  /* showError: never-blank human panel for named chain errors. */
  function err(d, w, e, fb) {
    var b = el(d, "div", null, "error"); b.setAttribute("aria-live", "polite");
    var m = (e && e.message) ? e.message : String(e || fb || t("common.unexpected_error", "Unexpected error"));
    if (m.indexOf("unknown-asset") !== -1) m = fb || t("barter.unknown_asset", "Unknown asset.");
    else if (m.indexOf("unknown-account") !== -1) m = fb || t("common.unknown_account", "Unknown account.");
    else if (m.indexOf("not-market-issued") !== -1) m = t("asset.not_mpa_feed", "Not a market-issued asset — feeds exist only on smartcoins.");
    else if (m.indexOf("wallet-locked") !== -1) m = t("common.wallet_locked", "Wallet is locked.");
    else if (m.indexOf("not-connected") !== -1 || m.indexOf("not connected") !== -1) m = t("common.network_unavailable", "Network unavailable. Check Settings → Nodes and retry.");
    b.textContent = m; w.appendChild(b); return b;
  }
  function status(d, w, t) { var p = el(d, "p", t, "muted"); p.setAttribute("aria-live", "polite"); w.appendChild(p); return p; }
  function netName() { try { return Store.loadSettings().network || "mainnet"; } catch (e) { return "mainnet"; } }
  /* feePrec: fee-asset precision for human fee rows (get_assets read).
   * Params: id (asset id string, defaults to CORE 1.3.0). Returns a Promise
   * for the precision number (5 on lookup miss — honest fallback). Fails: never
   * rejects (catch returns the fallback). */
  async function feePrec(id) {
    try { var r = await Chain.call(await Chain.db(), "get_assets", [[id || CORE]]); if (r && r[0]) return r[0].precision; } catch (e) { /* p5 */ } return 5;
  }
  /* head: current head-block number for staleness guards. Params: none.
   * Returns a Promise for the number (0 when the node is unreachable).
   * Fails: never rejects (catch returns 0). */
  async function head() { try { var p = await Chain.call(await Chain.db(), "get_dynamic_global_properties", []); return p.head_block_number || 0; } catch (e) { return 0; } }
  function noBackend() { return (typeof Asset === "undefined" || typeof AssetOps === "undefined" || typeof Tx === "undefined" || typeof Account === "undefined" || typeof Wallet === "undefined" || typeof Format === "undefined"); }
  /* cold: offline panel + Retry, plus auto-rerun on reconnect (transfer/
   * vote/explorer Store.subscribe("connection",…) pattern — without it the
   * stale offline panel survives after connect). */
  function cold(d, w, root, rerun) {
    if (Chain.status && Chain.status().state === "open") return false;
    w.appendChild(DOM.pageHead(d, t("asset.feed_title", "Publish feed"), "assets")); err(d, w,new Error("not-connected"),t("common.network_unavailable_short", "Network unavailable."));
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
   * Forms.labeledTextarea for the producers box (plus autocomplete off). */
  /* No local confirm builder — use ConfirmDialog.show (title/rows/feeHuman/
   * Back/Sign&Send). Fee/network rows are built at the call site; status +
   * sendAndProve stay in the caller's onSend. */
  /* feeSection: read-only fee-schedule table (slice-9 deferral, Ref #20).
   * Own per-call token (separate from renderFeed's gen): AssetUI's list
   * embeds this section but owns a different gen counter, so comparing the
   * caller's gen against this module's gen never matched and the table
   * never rendered. The token only guards this box's own async fill, on a
   * separate counter so it never disturbs renderFeed's gen. */
  function feeSection(d, box) {
    var my = ++feeGen;
    box.appendChild(el(d, "h2", t("fees.network_fees", "Network fees")));
    status(d, box, t("asset.loading_fees", "Loading fee schedule…"));
    Asset.feeSchedule().then(function (s) {
      if (my !== feeGen) return; wipe(box);
      box.appendChild(el(d, "h2", t("fees.network_fees", "Network fees")));
      if (!s.fees.length) { box.appendChild(el(d, "p", t("asset.no_fee_rows", "No fee rows returned.") + t("asset.schedule_hint", " The node sent an empty schedule — retry or check Settings → Nodes."), "muted")); return; }
      var sc = el(d, "div", null, "xplore-scroll"); sc.style.overflowX = "auto";
      var tb = d.createElement("table"), th = d.createElement("thead"), hr = d.createElement("tr");
      tb.setAttribute("aria-label", t("fees.network_fees", "Network fees"));
      [t("asset.op_col", "Op"),  "Fee"].forEach(function (h) { var thc = el(d, "th", h); thc.setAttribute("scope", "col"); hr.appendChild(thc); });
      th.appendChild(hr); tb.appendChild(th);
      var tb2 = d.createElement("tbody");
      s.fees.forEach(function (f) {
        var tr = d.createElement("tr");
        var td0 = d.createElement("td"); td0.textContent = f.opId + " · " + f.name; tr.appendChild(td0);
        var td1 = d.createElement("td");
        if (f.fee_raw === null) td1.textContent = "—";
        else { try { td1.textContent = Format.formatAmount(f.fee_raw, s.fee_asset_precision); } catch (e) { td1.textContent = String(f.fee_raw); } td1.title = String(f.fee_raw); }
        if (f.price_per_kbyte !== undefined) td1.title = (td1.title ? td1.title + " " : "") + "+/kB " + f.price_per_kbyte;
        tr.appendChild(td1); tb2.appendChild(tr); });
      tb.appendChild(tb2); sc.appendChild(tb); box.appendChild(sc);
    }).catch(function (e) { if (my === feeGen) { wipe(box); box.appendChild(el(d, "h2", t("fees.network_fees", "Network fees"))); err(d, box,e,t("asset.fees_failed", "Could not load fees.")); } });
  }
  /* feedPrice: settlement/CER pair -> 4-sf human string with BOTH
   * precisions (global price rule). Display-only; raw legs stay on the
   * callers' dd titles. */
  function feedPrice(pair, bp, qp) {
    try {
      var human = Format.formatPrice(String(pair.base.amount), bp, String(pair.quote.amount), qp, PLACES);
      try {
        if (typeof Format.priceSig === "function") {
          var sig = Format.priceSig(human);
          if (typeof sig === "string" && sig) human = sig;
        }
      } catch (e) { /* 8-place stands */ }
      return human;
    }
    catch (e) { return "unavailable"; }
  }
  /* renderFeed: symbol loader + live read-back + publish + producer forms.
   * PUBLIC reads render LOCKED (gate-repair): the symbol loader and live
   * feed read-back need no wallet; publish/producers gate at sign time via
   * the fresh-WIF throw in their confirm send paths. */
  function renderFeed(root) {
    if (!root) return;
    var d = root.ownerDocument || document, g = ++gen;
    wipe(root); var w = wrap(d, root);
    if (noBackend()) { err(d, w,t("asset.backend_missing", "Asset backend missing.")); return; }
    if (cold(d, w, root, function () { renderFeed(root); })) return;
    /* No entry unlock gate: reads are public; signing gates at send time. */
    w.appendChild(DOM.pageHead(d, t("asset.feed_title", "Publish feed"), "assets"));
    try {
      if (typeof Wallet === "undefined" || !Wallet.isUnlocked()) {
        var _v = (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.get === "function") ? ViewingAs.get() : { id: "1.2.0", name: "committee-account" };
        w.appendChild(el(d, "p", t("asset.viewing_notice", "Viewing as %(name)s (%(id)s) — unlock to sign.", { name: _v.name, id: _v.id }), "muted"));
      }
    } catch (e) { /* notice is display-only */ }
    var s = Forms.labeledInput(d, t("asset.smartcoin_field", "Smartcoin symbol") + " ", { id: "af-sym", value: "", placeholder: "e.g. TESTMPA", autocomplete: "off" });
    w.appendChild(s.row);
    var go = touch(el(d, "button", t("asset.load_feed", "Load feed"))); go.type = "button"; w.appendChild(go);
    var body = el(d, "div", null, "asset-feed"); w.appendChild(body);
    go.addEventListener("click", function () {
      var sym = s.input.value.trim().toUpperCase();
      if (!sym) { err(d, body,t("asset.enter_symbol", "Enter a symbol.")); return; }
      wipe(body); status(d, body, t("asset.loading_feed", "Loading feed…"));
      loadFeed(d, body, root, g, sym);
    });
  }
  /* loadFeed: describe + raw bitasset join; MPA gate; read-back; sub-forms. */
  async function loadFeed(d, body, root, g, sym) {
    var info;
    try { info = await Asset.describe(sym); }
    catch (e) { if (g === gen) { wipe(body); err(d, body,e,t("barter.unknown_asset", "Unknown asset.")); } return; }
    if (g !== gen) return; wipe(body);
    if (!info.is_smartcoin || !info.bitasset || !info.bitasset.short_backing_asset) {
      err(d, body,new Error("not-market-issued"),t("asset.not_market_issued", "Not a market-issued asset."));
      body.appendChild(el(d, "p", t("asset.feed_help", "Feeds exist only on smartcoins. To test publishing, create your own testnet MPA, add yourself as a feed producer, then publish here."), "muted"));
      return;
    }
    var backing = info.bitasset.short_backing_asset, db = await Chain.db();
    var bMeta = await Chain.call(db, "get_assets", [[backing]]);
    var backingPrec = (bMeta && bMeta[0]) ? bMeta[0].precision : 5;
    body.appendChild(el(d, "h2", info.symbol + " · current feed"));
    try {
      var raw = await Chain.call(db, "lookup_asset_symbols", [[info.symbol]]);
      var bId = raw && raw[0] && raw[0].bitasset_data_id;
      var objs = bId ? await Chain.call(db, "get_objects", [[bId]]) : null;
      var cur = objs && objs[0] && objs[0].current_feed;
      var dl = el(d, "dl", null, "xplore-fields");
      if (cur && cur.settlement_price) {
        dl.appendChild(el(d, "dt", t("explorer.th_settlement", "Settlement"))); var sd = el(d, "dd", feedPrice(cur.settlement_price, info.precision, backingPrec));
        sd.title = t("explorer.price_base", "base ") + cur.settlement_price.base.amount + t("explorer.price_quote", " / quote ") + cur.settlement_price.quote.amount; dl.appendChild(sd);
        dl.appendChild(el(d, "dt", t("asset.cer_row", "Core exchange rate (CER)"))); var cd = el(d, "dd", feedPrice(cur.core_exchange_rate, info.precision, backingPrec));
        cd.title = t("explorer.price_base", "base ") + cur.core_exchange_rate.base.amount + t("explorer.price_quote", " / quote ") + cur.core_exchange_rate.quote.amount; dl.appendChild(cd);
      } else body.appendChild(el(d, "p", t("asset.no_live_feed", "No live feed published yet.") + t("asset.feed_hint", " Feeds appear once publishers publish for this asset."), "muted"));
      dl.appendChild(el(d, "dt", t("asset.mcr_row", "MCR"))); var m1 = el(d, "dd", AssetOps.ratioToPct(info.bitasset.mcr) + "%"); m1.title = String(info.bitasset.mcr); dl.appendChild(m1);
      dl.appendChild(el(d, "dt", t("explorer.th_mssr", "MSSR"))); var m2 = el(d, "dd", AssetOps.ratioToPct(info.bitasset.mssr) + "%"); m2.title = String(info.bitasset.mssr); dl.appendChild(m2);
      body.appendChild(dl);
    } catch (e) { body.appendChild(el(d, "p", t("asset.feed_unavailable", "Feed read-back unavailable."), "muted")); }
    publishForm(d, body, root, g, info, backing, backingPrec);
    producerForm(d, body, root, g, info);
  }
  /* publishForm: op-19 inputs with ratio previews (helpers only, no /1000).
   * Publisher defaults to public 1.2.0 (gate-repair); blank also falls back
   * to 1.2.0 — never myAccountId at render; the WIF throw at send is the gate. */
  function publishForm(d, body, root, g, info, backing, backingPrec) {
    body.appendChild(el(d, "h2", t("asset.publish_op19_title", "Publish feed (op %(op)s)", { op: 19 })));
    var pub = Forms.labeledInput(d, t("asset.publisher_field", "Publisher (name or 1.2.N)") + " ", { value: "1.2.0", autocomplete: "off" });
    var sb = Forms.labeledInput(d, "Settlement base (human, " + info.symbol + ")" + " ", { value: "1", inputmode: "decimal", autocomplete: "off" });
    var sq = Forms.labeledInput(d, t("asset.settle_quote_field", "Settlement quote (human, backing)") + " ", { value: "1", inputmode: "decimal", autocomplete: "off" });
    var mcr = Forms.labeledInput(d, t("asset.mcr_field", "MCR % (human, e.g. 175)") + " ", { value: "175", inputmode: "decimal", autocomplete: "off" });
    var mssr = Forms.labeledInput(d, t("asset.mssr_field", "MSSR % (human, e.g. 150)") + " ", { value: "150", inputmode: "decimal", autocomplete: "off" });
    var cb = Forms.labeledInput(d, "CER base (human, " + info.symbol + ")" + " ", { value: "1", inputmode: "decimal", autocomplete: "off" });
    var cq = Forms.labeledInput(d, t("asset.cer_quote_backing_field", "CER quote (human, backing)") + " ", { value: "1", inputmode: "decimal", autocomplete: "off" });
    [pub, sb, sq, mcr, mssr, cb, cq].forEach(function (x) { body.appendChild(x.row); });
    var prev = el(d, "p", "", "muted"); body.appendChild(prev);
    /* paintPrev: live MCR/MSSR % preview from the raw inputs. Never throws
     * (bad input shows a hint, never a blank). */
    function paintPrev() {
      var txt;
      try { txt = "MCR " + AssetOps.ratioToPct(AssetOps.pctHumanToRatio(mcr.input.value)) + "% · MSSR " + AssetOps.ratioToPct(AssetOps.pctHumanToRatio(mssr.input.value)) + "%"; }
      catch (e) { txt = "MCR/MSSR preview unavailable — check the % inputs."; }
      prev.textContent = txt;
    }
    mcr.input.addEventListener("input", paintPrev); mssr.input.addEventListener("input", paintPrev); paintPrev();
    /* Unlocked prefill: swap the public 1.2.0 default for the wallet
     * account (locked viewers keep 1.2.0). Null-tolerant — manual stands. */
    Account.myAccountId().then(function (id) { return Account.resolve(id); }).then(function (me) {
      if (g === gen && pub.input.value.trim() === "1.2.0") pub.input.value = me.name; }).catch(function () { /* manual stands */ });
    var rev = touch(el(d, "button", t("asset.review_feed", "Review feed"))); rev.type = "button"; body.appendChild(rev);
    rev.addEventListener("click", function () {
      rev.disabled = true;
      (async function () {
        var who = await Account.resolve(pub.input.value.trim() || "1.2.0");
        var pair = await AssetOps.buildFeed({ publisherId: who.id, assetId: info.id,
          settleBaseRaw: Format.parseAmount(sb.input.value, info.precision),
          settleQuoteRaw: Format.parseAmount(sq.input.value, backingPrec),
          mcr: AssetOps.pctHumanToRatio(mcr.input.value), mssr: AssetOps.pctHumanToRatio(mssr.input.value),
          cerBaseRaw: Format.parseAmount(cb.input.value, info.precision),
          cerQuoteRaw: Format.parseAmount(cq.input.value, backingPrec),
          basePrec: info.precision, quotePrec: backingPrec });
        var f = await AssetOps.fee(pair, CORE); pair[1].fee = { amount: f.amount, asset_id: f.asset_id };
        if (g !== gen) return; wipe(root); var w2 = wrap(d, root), pp = await feePrec(f.asset_id);
        var stl = sb.input.value + " " + info.symbol + " / " + sq.input.value + " backing";
        var cer = cb.input.value + " " + info.symbol + " / " + cq.input.value + " backing";
        var feedRows = [[t("asset.publisher_row", "Publisher"), who.name + " (" + who.id + ")"], [t("asset_ops.title", "Asset"), info.symbol + " (" + info.id + ")"],
          [t("explorer.th_settlement", "Settlement"), stl], [t("asset.mcr_row", "MCR"), mcr.input.value + "%", String(pair[1].feed.maintenance_collateral_ratio)],
          [t("explorer.th_mssr", "MSSR"), mssr.input.value + "%", String(pair[1].feed.maximum_short_squeeze_ratio)], [t("asset.cer_row", "Core exchange rate (CER)"), cer]];
        feedRows.push([t("borrow.network", "Network"), netName()]);
        var feedFee;
        try { feedFee = Format.formatAmount(String(f.amount), pp) + " (core)"; }
        catch (feeErr) { feedFee = String(f.amount) + " (core)"; }
        var feedDlg = ConfirmDialog.show({ title: t("asset.confirm_feed", "Confirm feed"),
          rows: feedRows, feeHuman: feedFee, feeTerm: t("borrow.fee", "Fee"),
          backLabel: t("barter.back", "Back"), sendLabel: t("common.sign_send", "Sign & Send"),
          onBack: function () { renderFeed(root); },
          onSend: function () {
            var btns = feedDlg.getElementsByTagName("button");
            var backB = btns[0], sendB = btns[1];
            backB.disabled = true; sendB.disabled = true;
            var st = status(d, w2, "Signing…");
            (async function () {
              var unsigned = await Tx.buildTx([pair]);
              var wif = (Wallet.keys && Wallet.keys.active) ? Wallet.keys.active.wif : null;
              if (!wif) throw new Error("wallet-locked"); st.textContent = "Broadcasting…";
              var r = await AssetOps.sendAndProve(unsigned, wif, async function () {
                try { var n = await Asset.describe(info.symbol);
                  return (n.bitasset && n.bitasset.mcr === pair[1].feed.maintenance_collateral_ratio &&
                    n.bitasset.mssr === pair[1].feed.maximum_short_squeeze_ratio) ? n : null;
                } catch (e) { return null; } });
              var h = await head(); if (g !== gen) return; wipe(root);
              var w3 = wrap(d, root);
              w3.appendChild(DOM.pageHead(d, t("asset.feed_published", "Feed published"), "assets"));
              var ok = el(d, "p", "Observed at head block #" + h + " (" + r.via + ").", "xfer-ok");
              ok.setAttribute("aria-live", "polite"); w3.appendChild(ok);
              w3.appendChild(el(d, "p", info.symbol + " feed re-read matches MCR " + mcr.input.value + "% / MSSR " + mssr.input.value + "%.", "muted"));
              var a = el(d, "a", "Open " + info.symbol); a.setAttribute("href", "#/asset/" + info.symbol); touch(a); w3.appendChild(a);
            })().catch(function (e) {
              try { w2.removeChild(st); } catch (x) { /* gone */ }
              err(d, w2, e, t("createworker.send_failed", "Send failed.")); backB.disabled = false; });
          } });
        w2.appendChild(feedDlg);
      })().catch(function (e) { rev.disabled = false; err(d, body,e,t("asset.feed_prepare_failed", "Could not prepare the feed.")); });
    });
  }
  /* producerForm: op-13 set editor (one account per line, resolved).
   * Acting account is explicit (public 1.2.0 default, gate-repair) — never
   * myAccountId at render; issuer check + WIF throw gate the write path. */
  function producerForm(d, body, root, g, info) {
    body.appendChild(el(d, "h2", t("asset.producers_title", "Feed producers (op %(op)s)", { op: 13 })));
    var whoF = Forms.labeledInput(d, t("asset.acting_field", "Acting account (name or 1.2.N)") + " ", { value: "1.2.0", autocomplete: "off" });
    body.appendChild(whoF.row);
    var pa = Forms.labeledTextarea(d, t("asset.producers_field", "Producers (one name or 1.2.N per line)") + " ", { value: "" });
    pa.input.setAttribute("autocomplete", "off");
    body.appendChild(pa.row);
    var rev = touch(el(d, "button", t("asset.review_producers", "Review producers"))); rev.type = "button"; body.appendChild(rev);
    rev.addEventListener("click", function () {
      rev.disabled = true;
      (async function () {
        var names = pa.input.value.split("\n").map(function (x) { return x.trim(); }).filter(function (x) { return !!x; });
        var ids = [];
        for (var i = 0; i < names.length; i++) ids.push((await Account.resolve(names[i])).id);
        var me = await Account.resolve(whoF.input.value.trim() || "1.2.0");
        if (me.id !== info.issuer_id) throw new Error(t("asset.only_issuer_producers", "Only the issuer can set producers."));
        var pair = AssetOps.buildUpdateProducers({ issuerId: info.issuer_id, assetId: info.id, producerIds: ids });
        var f = await AssetOps.fee(pair, CORE); pair[1].fee = { amount: f.amount, asset_id: f.asset_id };
        if (g !== gen) return; wipe(root); var w2 = wrap(d, root), pp = await feePrec(f.asset_id);
        var prodRows = [[t("asset_ops.title", "Asset"), info.symbol + " (" + info.id + ")"], [t("asset.producers_row", "Producers"), ids.length ? ids.join(", ") : "(empty)"]];
        prodRows.push([t("borrow.network", "Network"), netName()]);
        var prodFee;
        try { prodFee = Format.formatAmount(String(f.amount), pp) + " (core)"; }
        catch (feeErr2) { prodFee = String(f.amount) + " (core)"; }
        var prodDlg = ConfirmDialog.show({ title: t("asset.confirm_producers", "Confirm feed producers"),
          rows: prodRows, feeHuman: prodFee, feeTerm: t("borrow.fee", "Fee"),
          backLabel: t("barter.back", "Back"), sendLabel: t("common.sign_send", "Sign & Send"),
          onBack: function () { renderFeed(root); },
          onSend: function () {
            var btns = prodDlg.getElementsByTagName("button");
            var backB = btns[0], sendB = btns[1];
            backB.disabled = true; sendB.disabled = true;
            var st = status(d, w2, "Signing…");
            (async function () {
              var unsigned = await Tx.buildTx([pair]);
              var wif = (Wallet.keys && Wallet.keys.active) ? Wallet.keys.active.wif : null;
              if (!wif) throw new Error("wallet-locked"); st.textContent = "Broadcasting…";
              var r = await AssetOps.sendAndProve(unsigned, wif, async function () { return true; });
              var h = await head(); if (g !== gen) return; wipe(root);
              var w3 = wrap(d, root);
              w3.appendChild(DOM.pageHead(d, t("asset.producers_updated", "Producers updated"), "assets"));
              var ok = el(d, "p", "Observed at head block #" + h + " (" + r.via + ").", "xfer-ok");
              ok.setAttribute("aria-live", "polite"); w3.appendChild(ok);
              var a = el(d, "a", "Open " + info.symbol); a.setAttribute("href", "#/asset/" + info.symbol); touch(a); w3.appendChild(a);
            })().catch(function (e) {
              try { w2.removeChild(st); } catch (x) { /* gone */ }
              err(d, w2, e, t("createworker.send_failed", "Send failed.")); backB.disabled = false; });
          } });
        w2.appendChild(prodDlg);
      })().catch(function (e) { rev.disabled = false; err(d, body,e,t("asset.producers_prepare_failed", "Could not prepare the producer update.")); });
    });
  }
  return { renderFeed: renderFeed, feeSection: feeSection };
})();
if (typeof globalThis !== "undefined" && typeof globalThis.AssetFeedUI === "undefined") { globalThis.AssetFeedUI = AssetFeedUI; }
if (typeof module !== "undefined") { module.exports = AssetFeedUI; }
