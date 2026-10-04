/* AssetManageUI: asset update + issue/reserve screens (ops 11/12/13/14/15).
 * Owns: #/assets/update/:symbol (op-11 common + op-12 bitasset + op-13
 *   producers), #/assets/issue (op-14 issue + op-15 reserve halves).
 * Consumes: Asset (describe reads), AssetOps (builders/fee/sendAndProve +
 *   pct helpers), Account, Wallet, Tx.buildTx, Format, Chain, Store.
 * Side effects: DOM under root, global AssetManageUI only. WIF never hits
 *   the DOM.
 * Created by: slice-10 audit fix B2 (split from asset-ui.js,
 *   behavior-identical). The small view chrome below (el/touch/wipe/wrap/
 *   err/status/netName/feePrec/head/noBackend/cold/confirm/done/
 *   publish) intentionally duplicates asset-ui.js verbatim — duplicated
 *   plain code over a shared import, per the anti-rot doctrine (no new
 *   load-bearing cross-file abstraction; each view file stays
 *   self-contained and readable alone). Labeled rows use shared Forms.
 * TRUTH: op fields <- asset_ops.hpp; hundredths via AssetOps only; op-11
 *   clones the live chain object (rawAsset) so untouched fields pass
 *   through; market-issued reserve is client-blocked (not-market-issued).
 */
var AssetManageUI = (function () {
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
  var CORE = "1.3.0", gen = 0;
  /* el: textContent-only element. touchable: >=44px floor. */
  function el(d, t, x, c) { var n = d.createElement(t); if (c) n.className = c; if (x !== undefined && x !== null) n.textContent = x; return n; }
  function touch(n) { n.style.minHeight = "44px"; return n; } function wipe(r) { while (r.firstChild) r.removeChild(r.firstChild); }
  function wrap(d, r) { var w = d.createElement("div"); w.className = "wrap"; r.appendChild(w); return w; }
  /* showError: never-blank human panel for named chain errors. */
  function err(d, w, e, fb) {
    var b = el(d, "div", null, "error"); b.setAttribute("aria-live", "polite");
    var m = (e && e.message) ? e.message : String(e || fb || t("fees.unexpected_error", "Unexpected error"));
    if (m.indexOf("unknown-asset") !== -1) m = fb || t("barter.unknown_asset", "Unknown asset.");
    else if (m.indexOf("unknown-account") !== -1) m = fb || t("barter.unknown_account", "Unknown account.");
    else if (m.indexOf("symbol-taken") !== -1) m = t("asset.symbol_taken", "Symbol is already taken.");
    else if (m.indexOf("not-issuer") !== -1) m = t("asset.only_issuer", "Only the issuer can change this.");
    else if (m.indexOf("not-market-issued") !== -1) m = t("asset.not_market_issued", "Not a market-issued asset.");
    else if (m.indexOf("wallet-locked") !== -1) m = t("debit.s2", "Wallet is locked.");
    else if (m.indexOf("not-connected") !== -1 || m.indexOf("not connected") !== -1) m = t("fees.network_unavailable_check_settings_nodes_and", "Network unavailable. Check Settings → Nodes and retry.");
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
    w.appendChild(el(d, "h1", t("assets.title", "Assets"))); err(d, w,new Error("not-connected"),t("createaccount.network_unavailable", "Network unavailable."));
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
   * Forms.labeledTextarea for the description/producers boxes (plus
   * autocomplete off). */
  /* No local confirm builder — use ConfirmDialog.show (title/rows/feeHuman/
   * Back/Sign&Send). Fee/network rows are built at the call site; status +
   * sendAndProve stay in the caller's onSend. */
  /* done: observed-head result panel (no fabricated txid). */
  function done(d, w, title, headN, via, sub, href, link) {
    w.appendChild(el(d, "h1", title)); var ok = el(d, "p", "Observed at head block #" + headN + " (" + via + ").", "xfer-ok");
    ok.setAttribute("aria-live", "polite"); w.appendChild(ok); w.appendChild(el(d, "p", sub, "muted"));
    var a = el(d, "a", link); a.setAttribute("href", href); touch(a); w.appendChild(a);
  }
  /* publish: buildTx + fresh-WIF sendAndProve + head-marked result. No auto-retry.
   * SIGN GATE (gate-repair): the missing-WIF throw below is the ONLY password
   * gate on these routes — everything above it renders locked. */
  async function publish(root, d, g, pair, prove, title, sub, href, link, onStep) {
    var unsigned = await Tx.buildTx([pair]);
    var wif = (Wallet.keys && Wallet.keys.active) ? Wallet.keys.active.wif : null;
    if (!wif) throw new Error("wallet-locked"); onStep("Broadcasting…");
    var r = await AssetOps.sendAndProve(unsigned, wif, prove);
    var h = await head(); if (g !== gen) return;
    wipe(root); done(d, wrap(d, root), title, h, r.via, sub, href, link);
  }
  /* rawAsset: full chain object for op-11 cloning (describe is a subset). */
  async function rawAsset(s) {
    var r = await Chain.call(await Chain.db(), "lookup_asset_symbols", [[s]]);
    if (!r || !r[0]) throw new Error("unknown-asset"); return r[0];
  }
  /* renderUpdate: op-11 common + op-12 bitasset (MPA) + op-13 producers.
   * PUBLIC reads render LOCKED (gate-repair): asset info shows first for any
   * viewer; the edit forms only appear for the issuer and Sign & Send still
   * needs the unlocked WIF in publish(). */
  function renderUpdate(root, symbol) {
    if (!root) return;
    var d = root.ownerDocument || document, g = ++gen;
    wipe(root); var w = wrap(d, root);
    if (noBackend()) { err(d, w,t("asset.backend_missing", "Asset backend missing.")); return; }
    if (cold(d, w, root, function () { renderUpdate(root, symbol); })) return;
    /* No entry unlock gate: reads are public; signing gates in publish(). */
    try {
      if (typeof Wallet === "undefined" || !Wallet.isUnlocked()) {
        var _v = (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.get === "function") ? ViewingAs.get() : { id: "1.2.0", name: "committee-account" };
        w.appendChild(el(d, "p", t("viewing.notice_locked", "Viewing as %(name)s (%(id)s) — unlock to act as yourself.", { name: _v.name, id: _v.id }), "muted"));
      }
    } catch (e) { /* notice is display-only */ }
    if (!symbol) { w.appendChild(el(d, "h1", t("asset.update_title", "Update asset"))); err(d, w,new Error("unknown-asset"),t("barter.unknown_asset", "Unknown asset.")); return; }
    w.appendChild(el(d, "h1", "Update " + symbol)); status(d, w, t("explorer.loading_asset", "Loading asset…"));
    (async function () {
      var info = await Asset.describe(symbol);
      /* Null-tolerant at render: locked viewers get "" (never the issuer),
       * so they see the public read panel below and no edit forms; the
       * password stays loud only at sign time in publish(). */
      var mine = await Account.myAccountId().catch(function () { return ""; });
      if (g !== gen) return; wipe(root);
      var v = wrap(d, root); v.appendChild(el(d, "h1", "Update " + info.symbol));
      try {
        if (typeof Wallet === "undefined" || !Wallet.isUnlocked()) {
          var _v2 = (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.get === "function") ? ViewingAs.get() : { id: "1.2.0", name: "committee-account" };
          v.appendChild(el(d, "p", t("viewing.notice_locked", "Viewing as %(name)s (%(id)s) — unlock to act as yourself.", { name: _v2.name, id: _v2.id }), "muted"));
        }
      } catch (e) { /* notice is display-only */ }
      /* Public read panel first: symbol/id/issuer/precision/supply/fee. */
      (function () {
        var supH = info.supply_raw;
        try { supH = (info.supply_raw === null || info.supply_raw === undefined) ? "unavailable" : Format.formatAmount(String(info.supply_raw), info.precision) + " " + info.symbol; }
        catch (e) { supH = String(info.supply_raw); }
        var dl = d.createElement("dl"); dl.className = "xfer-confirm";
        [[t("asset_ops.title", "Asset"),  info.symbol + " (" + info.id + ")"], [t("explorer.issuer_row", "Issuer"),  (info.issuer_name || info.issuer_id)],
          [t("explorer.precision_row", "Precision"),  String(info.precision)], [t("explorer.th_supply", "Supply"),  supH, info.supply_raw === null ? null : String(info.supply_raw)],
          [t("explorer.market_fee", "Market fee"),  AssetOps.hundredthsToPct(info.market_fee_hundredths) + "%"],
          [t("asset.smartcoin_row", "Smartcoin"),  info.is_smartcoin ? "yes" : "no"]].forEach(function (r) {
          dl.appendChild(el(d, "dt", r[0])); var dd = el(d, "dd", r[1]); if (r[2]) dd.title = r[2]; dl.appendChild(dd);
        });
        v.appendChild(dl);
      })();
      if (info.issuer_id !== mine) {
        err(d, v,new Error("not-issuer"),t("asset.only_issuer_edit", "Only the issuer can edit this asset."));
        v.appendChild(el(d, "p", "Issuer: " + (info.issuer_name || info.issuer_id) + ". Read-only.", "muted")); return; }
      /* op-11 common */
      v.appendChild(el(d, "h3", t("asset.common_title", "Common options (op 11)")));
      var fp = Forms.labeledInput(d, "Market fee % (now " + AssetOps.hundredthsToPct(info.market_fee_hundredths) + "%)" + " ", { value: AssetOps.hundredthsToPct(info.market_fee_hundredths), inputmode: "decimal", autocomplete: "off" });
      var ds = Forms.labeledTextarea(d, t("asset.description_row", "Description") + " ", { value: info.description || "" });
      ds.input.setAttribute("autocomplete", "off");
      v.appendChild(fp.row); v.appendChild(ds.row);
      var r1 = touch(el(d, "button", t("credit.review_update", "Review update"))); r1.type = "button"; v.appendChild(r1);
      r1.addEventListener("click", function () { r1.disabled = true;
        (async function () {
          var raw = await rawAsset(info.symbol);
          var next = JSON.parse(JSON.stringify(raw.options));
          next.market_fee_percent = AssetOps.pctHumanToHundredths(fp.input.value);
          next.description = ds.input.value || ""; next.extensions = [];
          var pair = AssetOps.buildUpdate({ issuerId: info.issuer_id, assetId: info.id, newIssuerOrNull: null, newOptions: next });
          var f = await AssetOps.fee(pair, CORE); pair[1].fee = { amount: f.amount, asset_id: f.asset_id };
          if (g !== gen) return; wipe(root); var w2 = wrap(d, root), pp = await feePrec(f.asset_id);
          var rows = [[t("asset_ops.title", "Asset"), info.symbol + " (" + info.id + ")"],
            [t("explorer.market_fee", "Market fee"), AssetOps.hundredthsToPct(info.market_fee_hundredths) + "% → " + fp.input.value + "%", String(next.market_fee_percent)]];
          if ((info.description || "") !== (ds.input.value || "")) rows.push([t("asset.description_row", "Description"), "changed (verified by re-read)"]);
          rows.push([t("borrow.network", "Network"), netName()]);
          var updFee;
          try { updFee = Format.formatAmount(String(f.amount), pp) + " (core)"; }
          catch (feeErr) { updFee = String(f.amount) + " (core)"; }
          var updDlg = ConfirmDialog.show({ title: t("asset.confirm_update", "Confirm asset update"),
            rows: rows, feeHuman: updFee, feeTerm: t("borrow.fee", "Fee"),
            backLabel: t("barter.back", "Back"), sendLabel: t("barter.sign_send", "Sign & Send"),
            onBack: function () { renderUpdate(root, info.symbol); },
            onSend: function () {
              var btns = updDlg.getElementsByTagName("button");
              var backB = btns[0], sendB = btns[1];
              backB.disabled = true; sendB.disabled = true;
              var st = status(d, w2, "Signing…");
              publish(root, d, g, pair, async function () {
                try { var n = await Asset.describe(info.symbol);
                  return (n.description === (ds.input.value || "") && n.market_fee_hundredths === next.market_fee_percent) ? n : null;
                } catch (e) { return null; } },
                t("asset.updated", "Asset updated"), info.symbol + " re-read matches the new options.", "#/asset/" + info.symbol, "Open " + info.symbol,
                function (x) { st.textContent = x; }).catch(function (e) {
                try { w2.removeChild(st); } catch (x) { /* gone */ }
                err(d, w2, e, t("createworker.send_failed", "Send failed.")); backB.disabled = false; });
            } });
          w2.appendChild(updDlg);
        })().catch(function (e) { r1.disabled = false; err(d, v,e,t("credit.could_not_prepare_the_update", "Could not prepare the update.")); }); });
      /* op-12 bitasset (MPA only) */
      if (info.is_smartcoin) {
        v.appendChild(el(d, "h3", t("asset.bitasset_op12_title", "Bitasset options (op 12)")));
        var of = Forms.labeledInput(d, t("asset.settle_offset_field", "Settlement offset %") + " ", { value: "1", inputmode: "decimal", autocomplete: "off" });
        var vf = Forms.labeledInput(d, t("asset.max_settle_vol_field", "Max settlement vol %") + " ", { value: "20", inputmode: "decimal", autocomplete: "off" });
        v.appendChild(of.row); v.appendChild(vf.row);
        var r2 = touch(el(d, "button", t("asset.review_bitasset", "Review bitasset update"))); r2.type = "button"; v.appendChild(r2);
        r2.addEventListener("click", function () { r2.disabled = true;
          (async function () {
            var rawB = await rawAsset(info.symbol);
            var objs = await Chain.call(await Chain.db(), "get_objects", [[rawB.bitasset_data_id]]);
            var cur = objs && objs[0] && objs[0].options; if (!cur) throw new Error("not-market-issued");
            var pair = AssetOps.buildUpdateBitasset({ issuerId: info.issuer_id, assetId: info.id,
              bitassetOpts: { feed_lifetime_sec: cur.feed_lifetime_sec, minimum_feeds: cur.minimum_feeds,
                force_settlement_delay_sec: cur.force_settlement_delay_sec,
                offset_hundredths: AssetOps.pctHumanToHundredths(of.input.value),
                max_settle_vol_hundredths: AssetOps.pctHumanToHundredths(vf.input.value),
                short_backing_asset: cur.short_backing_asset } });
            var f = await AssetOps.fee(pair, CORE); pair[1].fee = { amount: f.amount, asset_id: f.asset_id };
            if (g !== gen) return; wipe(root); var w3 = wrap(d, root), pp = await feePrec(f.asset_id);
            var bitRows = [[t("asset_ops.title", "Asset"), info.symbol], [t("asset.offset_row", "Offset"), of.input.value + "%"], [t("asset.max_vol_row", "Max vol"), vf.input.value + "%"]];
            bitRows.push([t("borrow.network", "Network"), netName()]);
            var bitFee;
            try { bitFee = Format.formatAmount(String(f.amount), pp) + " (core)"; }
            catch (feeErr2) { bitFee = String(f.amount) + " (core)"; }
            var bitDlg = ConfirmDialog.show({ title: t("asset.confirm_bitasset", "Confirm bitasset update"),
              rows: bitRows, feeHuman: bitFee, feeTerm: t("borrow.fee", "Fee"),
              backLabel: t("barter.back", "Back"), sendLabel: t("barter.sign_send", "Sign & Send"),
              onBack: function () { renderUpdate(root, info.symbol); },
              onSend: function () {
                var btns = bitDlg.getElementsByTagName("button");
                var backB = btns[0], sendB = btns[1];
                backB.disabled = true; sendB.disabled = true;
                var st = status(d, w3, "Signing…");
                publish(root, d, g, pair, async function () {
                  try { var o = await Chain.call(await Chain.db(), "get_objects", [[rawB.bitasset_data_id]]);
                    var n = o && o[0] && o[0].options;
                    return (n && n.force_settlement_offset_percent === pair[1].new_options.force_settlement_offset_percent) ? n : null;
                  } catch (e) { return null; } },
                  t("asset.bitasset_updated", "Bitasset updated"), info.symbol + " bitasset re-read matches.", "#/asset/" + info.symbol, "Open " + info.symbol,
                  function (x) { st.textContent = x; }).catch(function (e) {
                  try { w3.removeChild(st); } catch (x) { /* gone */ }
                  err(d, w3, e, t("createworker.send_failed", "Send failed.")); backB.disabled = false; });
              } });
            w3.appendChild(bitDlg);
          })().catch(function (e) { r2.disabled = false; err(d, v,e,t("asset.bitasset_prepare_failed", "Could not prepare the bitasset update.")); }); });
      }
      /* op-13 producers */
      v.appendChild(el(d, "h3", t("asset.producers_title", "Feed producers (op 13)")));
      var pa = Forms.labeledTextarea(d, t("asset.producers_field", "Producers (one name or 1.2.N per line)") + " ", { value: "" });
      pa.input.setAttribute("autocomplete", "off");
      v.appendChild(pa.row);
      var r3 = touch(el(d, "button", t("asset.review_producers", "Review producers"))); r3.type = "button"; v.appendChild(r3);
      r3.addEventListener("click", function () { r3.disabled = true;
        (async function () {
          var names = pa.input.value.split("\n").map(function (s) { return s.trim(); }).filter(function (s) { return !!s; });
          var ids = [];
          for (var i = 0; i < names.length; i++) ids.push((await Account.resolve(names[i])).id);
          var pair = AssetOps.buildUpdateProducers({ issuerId: info.issuer_id, assetId: info.id, producerIds: ids });
          var f = await AssetOps.fee(pair, CORE); pair[1].fee = { amount: f.amount, asset_id: f.asset_id };
          if (g !== gen) return; wipe(root); var w4 = wrap(d, root), pp = await feePrec(f.asset_id);
          var prodRows = [[t("asset_ops.title", "Asset"), info.symbol], [t("asset.producers_row", "Producers"), ids.length ? ids.join(", ") : "(empty)"]];
          prodRows.push([t("borrow.network", "Network"), netName()]);
          var prodFee;
          try { prodFee = Format.formatAmount(String(f.amount), pp) + " (core)"; }
          catch (feeErr3) { prodFee = String(f.amount) + " (core)"; }
          var prodDlg = ConfirmDialog.show({ title: t("asset.confirm_producers", "Confirm feed producers"),
            rows: prodRows, feeHuman: prodFee, feeTerm: t("borrow.fee", "Fee"),
            backLabel: t("barter.back", "Back"), sendLabel: t("barter.sign_send", "Sign & Send"),
            onBack: function () { renderUpdate(root, info.symbol); },
            onSend: function () {
              var btns = prodDlg.getElementsByTagName("button");
              var backB = btns[0], sendB = btns[1];
              backB.disabled = true; sendB.disabled = true;
              var st = status(d, w4, "Signing…");
              publish(root, d, g, pair, async function () { return true; },
                t("asset.producers_updated", "Producers updated"), "Broadcast observed; verify on #/asset/" + info.symbol + ".",
                "#/asset/" + info.symbol, "Open " + info.symbol,
                function (x) { st.textContent = x; }).catch(function (e) {
                try { w4.removeChild(st); } catch (x) { /* gone */ }
                err(d, w4, e, t("createworker.send_failed", "Send failed.")); backB.disabled = false; });
            } });
          w4.appendChild(prodDlg);
        })().catch(function (e) { r3.disabled = false; err(d, v,e,t("asset.producers_prepare_failed", "Could not prepare the producer update.")); }); });
    })().catch(function (e) { if (g === gen) { wipe(root); var w2 = wrap(d, root);
      w2.appendChild(el(d, "h1", "Update " + symbol)); err(d, w2,e,t("barter.unknown_asset", "Unknown asset.")); } });
  }
  /* half: one issue/reserve half-form wired to its builder + supply-delta proof.
   * PUBLIC preview (gate-repair): the acting account is an explicit input
   * defaulting to 1.2.0 (never Account.myAccountId at render); Sign & Send
   * still needs the unlocked WIF in publish(). */
  function half(d, v, root, g, title, btnLabel, isReserve) {
    v.appendChild(el(d, "h3", title));
    if (isReserve) v.appendChild(el(d, "p", t("asset.no_reserve_mpa", "Market-issued assets cannot be reserved."), "muted"));
    var s = Forms.labeledInput(d, t("explorer.th_symbol", "Symbol") + " ", { value: "", placeholder: "AFKTEST01", autocomplete: "off" });
    var toF = isReserve ? null : Forms.labeledInput(d, t("asset.to_field", "To (name or 1.2.N)") + " ", { value: "", autocomplete: "off" });
    var a = Forms.labeledInput(d, t("asset.amount_field", "Amount (human)") + " ", { value: "1", inputmode: "decimal", autocomplete: "off" });
    var who = Forms.labeledInput(d, (isReserve ? t("asset.payer_field", "Payer (name or 1.2.N)") : t("asset.acting_field", "Acting account (name or 1.2.N)")) + " ", { value: (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0", autocomplete: "off" });
    v.appendChild(s.row); if (toF) v.appendChild(toF.row); v.appendChild(a.row); v.appendChild(who.row);
    var r = touch(el(d, "button", btnLabel)); r.type = "button"; v.appendChild(r);
    r.addEventListener("click", function () { r.disabled = true;
      (async function () {
        var sym = s.input.value.trim().toUpperCase();
        var info = await Asset.describe(sym);
        if (isReserve && info.is_smartcoin) throw new Error("not-market-issued");
        var raw = Format.parseAmount(a.input.value, info.precision);
        if (!/[1-9]/.test(raw)) throw new Error(t("transfer.amount_positive", "Amount must be greater than zero."));
        /* Explicit acting account (public default 1.2.0) — never
         * myAccountId at render; the wallet is proven only at sign time. */
        var me = await Account.resolve(who.input.value.trim() || ((typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0"));
        if (isReserve && me.id !== info.issuer_id) throw new Error("not-issuer");
        var to = isReserve ? null : await Account.resolve(toF.input.value.trim());
        var pair = isReserve
          ? AssetOps.buildReserve({ payerId: me.id, assetId: info.id, amountHuman: a.input.value, precision: info.precision })
          : AssetOps.buildIssue({ issuerId: info.issuer_id, assetId: info.id, toAccountId: to.id, amountHuman: a.input.value, precision: info.precision, memoOrNull: null });
        var f = await AssetOps.fee(pair, CORE); pair[1].fee = { amount: f.amount, asset_id: f.asset_id };
        var before = info.supply_raw;
        if (g !== gen) return; wipe(root); var w2 = wrap(d, root), pp = await feePrec(f.asset_id);
        var rows = [[t("asset_ops.title", "Asset"),  info.symbol + " (" + info.id + ")"],
          [t("confirm.amount", "Amount"),  Format.formatAmount(raw, info.precision) + " " + info.symbol, raw]];
        rows.push(isReserve ? [t("asset.payer_row", "Payer"), me.name + " (" + me.id + ")"] : [t("confirm.to", "To"), to.name + " (" + to.id + ")"]);
        rows.push([t("borrow.network", "Network"), netName()]);
        var halfFee;
        try { halfFee = Format.formatAmount(String(f.amount), pp) + " (core)"; }
        catch (feeErr4) { halfFee = String(f.amount) + " (core)"; }
        var halfDlg = ConfirmDialog.show({ title: isReserve ? "Confirm reserve" : "Confirm issue",
          rows: rows, feeHuman: halfFee, feeTerm: t("borrow.fee", "Fee"),
          backLabel: t("barter.back", "Back"), sendLabel: t("barter.sign_send", "Sign & Send"),
          onBack: function () { renderIssue(root); },
          onSend: function () {
            var btns = halfDlg.getElementsByTagName("button");
            var backB = btns[0], sendB = btns[1];
            backB.disabled = true; sendB.disabled = true;
            var st = status(d, w2, "Signing…");
            publish(root, d, g, pair, async function () {
              try { var n = await Asset.describe(sym); if (before === null) return n;
                var have = BigInt(n.supply_raw || "0"), was = BigInt(before), want = BigInt(raw);
                return (isReserve ? (was - have === want) : (have - was === want)) ? n : null;
              } catch (e) { return null; } },
              isReserve ? "Assets reserved" : "Assets issued",
              Format.formatAmount(raw, info.precision) + " " + info.symbol + (isReserve ? " burned back." : " → " + to.name + "."),
              "#/asset/" + info.symbol, "Open " + info.symbol,
              function (x) { st.textContent = x; }).catch(function (e) {
              try { w2.removeChild(st); } catch (x) { /* gone */ }
              err(d, w2, e, t("createworker.send_failed", "Send failed.")); backB.disabled = false; });
          } });
        w2.appendChild(halfDlg);
      })().catch(function (e) { r.disabled = false; err(d, v, e, isReserve ? t("asset.reserve_prepare_failed", "Could not prepare the reserve.") : t("asset.issue_prepare_failed", "Could not prepare the issue.")); }); });
  }
  /* renderIssue: op-14 issue + op-15 reserve halves. PUBLIC preview renders
   * LOCKED (gate-repair); Sign & Send gates in publish() via fresh WIF. */
  function renderIssue(root) {
    if (!root) return;
    var d = root.ownerDocument || document, g = ++gen;
    wipe(root); var v = wrap(d, root);
    if (noBackend()) { err(d, v,t("asset.backend_missing", "Asset backend missing.")); return; }
    if (cold(d, v, root, function () { renderIssue(root); })) return;
    /* No entry unlock gate: reads/preview are public; signing gates in publish(). */
    v.appendChild(el(d, "h1", t("asset.issue_title", "Issue / reserve")));
    try {
      if (typeof Wallet === "undefined" || !Wallet.isUnlocked()) {
        var _v3 = (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.get === "function") ? ViewingAs.get() : { id: "1.2.0", name: "committee-account" };
        v.appendChild(el(d, "p", t("viewing.notice_locked", "Viewing as %(name)s (%(id)s) — unlock to act as yourself.", { name: _v3.name, id: _v3.id }), "muted"));
      }
    } catch (e) { /* notice is display-only */ }
    half(d, v, root, g, t("asset.issue_op14_title", "Issue to account (op 14)"), t("asset.review_issue", "Review issue"), false);
    half(d, v, root, g, t("asset.reserve_op15_title", "Reserve / burn back (op 15)"), t("asset.review_reserve", "Review reserve"), true);
  }
  return { renderUpdate: renderUpdate, renderIssue: renderIssue };
})();
if (typeof globalThis !== "undefined" && typeof globalThis.AssetManageUI === "undefined") { globalThis.AssetManageUI = AssetManageUI; }
if (typeof module !== "undefined") { module.exports = AssetManageUI; }
