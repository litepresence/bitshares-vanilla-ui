/* AssetManageUI: asset update + issue/reserve screens (ops 11/12/13/14/15).
 * Owns: #/assets/update/:symbol (op-11 common + op-12 bitasset + op-13
 *   producers), #/assets/issue (op-14 issue + op-15 reserve halves).
 * Consumes: Asset (describe reads), AssetOps (builders/fee/sendAndProve +
 *   pct helpers), Account, Wallet, Tx.buildTx, Format, Chain, Store.
 * Side effects: DOM under root, global AssetManageUI only. WIF never hits
 *   the DOM.
 * Created by: slice-10 audit fix B2 (split from asset-ui.js,
 *   behavior-identical). The small view chrome below (el/touch/wipe/wrap/
   *   err/status/netName/feePrec/head/noBackend/cold/field/confirm/done/
 *   publish) intentionally duplicates asset-ui.js verbatim — duplicated
 *   plain code over a shared import, per the anti-rot doctrine (no new
 *   load-bearing cross-file abstraction; each view file stays
 *   self-contained and readable alone).
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
  function t(key, dflt) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt);
    } catch (e) { /* default below */ }
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
    var b = touch(el(d, "button", t("fees.retry", "Retry"))); b.type = "button"; w.appendChild(b);
    var hashAtEntry = (typeof location !== "undefined" && location.hash) || "";
    var settled = false, off = function () {};
    if (typeof Store !== "undefined" && Store && typeof Store.subscribe === "function") {
      off = Store.subscribe("connection", function (st) {
        if (settled) return;
        if (st && st.state === "open") { settled = true; try { off(); } catch (e) { /* gone */ }
          if (typeof location === "undefined" || location.hash === hashAtEntry) rerun(); }
      });
    }
    b.addEventListener("click", function () {
      if (!settled) { settled = true; try { off(); } catch (e) { /* gone */ } } rerun(); });
    return true;
  }
  /* field: labeled input row. */
  function field(d, label, id, val, mode, area, ph) {
    var row = el(d, "div", null, "xfer-field"), lab = el(d, "label", label + " ");
    var inp = d.createElement(area ? "textarea" : "input");
    if (!area) { inp.type = "text"; if (mode) inp.setAttribute("inputmode", mode); }
    if (id) inp.id = id; if (val !== undefined) inp.value = val;
    if (ph) inp.setAttribute("placeholder", ph); inp.setAttribute("autocomplete", "off");
    touch(inp); lab.appendChild(inp); row.appendChild(lab); return { row: row, input: inp };
  }
  /* confirm: named rows + fee + network, Back / Sign&Send. Never raw JSON. */
  function confirm(d, w, root, title, rows, feeRaw, fp, onBack, onSend) {
    w.appendChild(el(d, "h1", title));
    var dl = el(d, "dl", null, "xfer-confirm");
    rows.forEach(function (r) { dl.appendChild(el(d, "dt", r[0])); var dd = el(d, "dd", r[1]); if (r[2]) dd.title = r[2]; dl.appendChild(dd); });
    var fh; try { fh = Format.formatAmount(String(feeRaw), fp); } catch (e) { fh = String(feeRaw); }
    dl.appendChild(el(d, "dt", t("borrow.fee", "Fee"))); var fd = el(d, "dd", fh + " (core)"); fd.title = String(feeRaw); dl.appendChild(fd);
    dl.appendChild(el(d, "dt", t("borrow.network", "Network"))); dl.appendChild(el(d, "dd", netName())); w.appendChild(dl);
    var back = touch(el(d, "button", t("barter.back", "Back"))); back.type = "button"; w.appendChild(back);
    var send = touch(el(d, "button", t("barter.sign_send", "Sign & Send"))); send.type = "button"; w.appendChild(send);
    back.addEventListener("click", onBack);
    send.addEventListener("click", function () { back.disabled = true; send.disabled = true;
      var st = status(d, w, "Signing…");
      onSend(function (t) { st.textContent = t; }).catch(function (e) {
        try { w.removeChild(st); } catch (x) { /* gone */ }
        err(d, w,e,t("createworker.send_failed", "Send failed.")); back.disabled = false; }); });
  }
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
      if (typeof Wallet === "undefined" || !Wallet.isUnlocked())
        w.appendChild(el(d, "p", t("misc.viewing_as", "Viewing as committee-account (1.2.0) — unlock to act as yourself."), "muted"));
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
        if (typeof Wallet === "undefined" || !Wallet.isUnlocked())
          v.appendChild(el(d, "p", t("misc.viewing_as", "Viewing as committee-account (1.2.0) — unlock to act as yourself."), "muted"));
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
      var fp = field(d, "Market fee % (now " + AssetOps.hundredthsToPct(info.market_fee_hundredths) + "%)", null, AssetOps.hundredthsToPct(info.market_fee_hundredths), "decimal");
      var ds = field(d, t("asset.description_row", "Description"), null, info.description || "", null, true);
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
          var rows = [[t("asset_ops.title", "Asset"),  info.symbol + " (" + info.id + ")"],
            [t("explorer.market_fee", "Market fee"),  AssetOps.hundredthsToPct(info.market_fee_hundredths) + "% → " + fp.input.value + "%", String(next.market_fee_percent)]];
          if ((info.description || "") !== (ds.input.value || "")) rows.push([t("asset.description_row", "Description"),  "changed (verified by re-read)"]);
          confirm(d, w2, root, t("asset.confirm_update", "Confirm asset update"), rows, f.amount, pp,
            function () { renderUpdate(root, info.symbol); }, function (s) {
              return publish(root, d, g, pair, async function () {
                try { var n = await Asset.describe(info.symbol);
                  return (n.description === (ds.input.value || "") && n.market_fee_hundredths === next.market_fee_percent) ? n : null;
                } catch (e) { return null; } },
                t("asset.updated", "Asset updated"), info.symbol + " re-read matches the new options.", "#/asset/" + info.symbol, "Open " + info.symbol, s); });
        })().catch(function (e) { r1.disabled = false; err(d, v,e,t("credit.could_not_prepare_the_update", "Could not prepare the update.")); }); });
      /* op-12 bitasset (MPA only) */
      if (info.is_smartcoin) {
        v.appendChild(el(d, "h3", t("asset.bitasset_op12_title", "Bitasset options (op 12)")));
        var of = field(d, t("asset.settle_offset_field", "Settlement offset %"), null, "1", "decimal");
        var vf = field(d, t("asset.max_settle_vol_field", "Max settlement vol %"), null, "20", "decimal");
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
            confirm(d, w3, root, t("asset.confirm_bitasset", "Confirm bitasset update"),
              [[t("asset_ops.title", "Asset"),  info.symbol], [t("asset.offset_row", "Offset"),  of.input.value + "%"], [t("asset.max_vol_row", "Max vol"),  vf.input.value + "%"]],
              f.amount, pp, function () { renderUpdate(root, info.symbol); }, function (s) {
                return publish(root, d, g, pair, async function () {
                  try { var o = await Chain.call(await Chain.db(), "get_objects", [[rawB.bitasset_data_id]]);
                    var n = o && o[0] && o[0].options;
                    return (n && n.force_settlement_offset_percent === pair[1].new_options.force_settlement_offset_percent) ? n : null;
                  } catch (e) { return null; } },
                  t("asset.bitasset_updated", "Bitasset updated"), info.symbol + " bitasset re-read matches.", "#/asset/" + info.symbol, "Open " + info.symbol, s); });
          })().catch(function (e) { r2.disabled = false; err(d, v,e,t("asset.bitasset_prepare_failed", "Could not prepare the bitasset update.")); }); });
      }
      /* op-13 producers */
      v.appendChild(el(d, "h3", t("asset.producers_title", "Feed producers (op 13)")));
      var pa = field(d, t("asset.producers_field", "Producers (one name or 1.2.N per line)"), null, "", null, true);
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
          confirm(d, w4, root, t("asset.confirm_producers", "Confirm feed producers"),
            [[t("asset_ops.title", "Asset"),  info.symbol], [t("asset.producers_row", "Producers"),  ids.length ? ids.join(", ") : "(empty)"]],
            f.amount, pp, function () { renderUpdate(root, info.symbol); }, function (s) {
              return publish(root, d, g, pair, async function () { return true; },
                t("asset.producers_updated", "Producers updated"), "Broadcast observed; verify on #/asset/" + info.symbol + ".",
                "#/asset/" + info.symbol, "Open " + info.symbol, s); });
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
    var s = field(d, t("explorer.th_symbol", "Symbol"), null, "", null, false, "AFKTEST01");
    var toF = isReserve ? null : field(d, t("asset.to_field", "To (name or 1.2.N)"), null, "");
    var a = field(d, t("asset.amount_field", "Amount (human)"), null, "1", "decimal");
    var who = field(d, isReserve ? t("asset.payer_field", "Payer (name or 1.2.N)") : t("asset.acting_field", "Acting account (name or 1.2.N)"), null, "1.2.0");
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
        var me = await Account.resolve(who.input.value.trim() || "1.2.0");
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
        rows.push(isReserve ? [t("asset.payer_row", "Payer"),  me.name + " (" + me.id + ")"] : [t("confirm.to", "To"),  to.name + " (" + to.id + ")"]);
        confirm(d, w2, root, isReserve ? "Confirm reserve" : "Confirm issue", rows, f.amount, pp,
          function () { renderIssue(root); }, function (st) {
            return publish(root, d, g, pair, async function () {
              try { var n = await Asset.describe(sym); if (before === null) return n;
                var have = BigInt(n.supply_raw || "0"), was = BigInt(before), want = BigInt(raw);
                return (isReserve ? (was - have === want) : (have - was === want)) ? n : null;
              } catch (e) { return null; } },
              isReserve ? "Assets reserved" : "Assets issued",
              Format.formatAmount(raw, info.precision) + " " + info.symbol + (isReserve ? " burned back." : " → " + to.name + "."),
              "#/asset/" + info.symbol, "Open " + info.symbol, st); });
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
      if (typeof Wallet === "undefined" || !Wallet.isUnlocked())
        v.appendChild(el(d, "p", t("asset.viewing_notice", "Viewing as committee-account (1.2.0) — unlock to sign."), "muted"));
    } catch (e) { /* notice is display-only */ }
    half(d, v, root, g, t("asset.issue_op14_title", "Issue to account (op 14)"), t("asset.review_issue", "Review issue"), false);
    half(d, v, root, g, t("asset.reserve_op15_title", "Reserve / burn back (op 15)"), t("asset.review_reserve", "Review reserve"), true);
  }
  return { renderUpdate: renderUpdate, renderIssue: renderIssue };
})();
if (typeof globalThis !== "undefined" && typeof globalThis.AssetManageUI === "undefined") { globalThis.AssetManageUI = AssetManageUI; }
if (typeof module !== "undefined") { module.exports = AssetManageUI; }
