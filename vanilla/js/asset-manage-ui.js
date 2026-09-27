/* AssetManageUI: asset update + issue/reserve screens (ops 11/12/13/14/15).
 * Owns: #/assets/update/:symbol (op-11 common + op-12 bitasset + op-13
 *   producers), #/assets/issue (op-14 issue + op-15 reserve halves).
 * Consumes: Asset (describe reads), AssetOps (builders/fee/sendAndProve +
 *   pct helpers), Account, Wallet, Tx.buildTx, Format, Chain, Store.
 * Side effects: DOM under root, global AssetManageUI only. WIF never hits
 *   the DOM.
 * Created by: slice-10 audit fix B2 (split from asset-ui.js,
 *   behavior-identical). The small view chrome below (el/touch/wipe/wrap/
 *   err/status/netName/feePrec/head/noBackend/cold/lock/field/confirm/done/
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
  var CORE = "1.3.0", gen = 0;
  /* el: textContent-only element. touchable: >=44px floor. */
  function el(d, t, x, c) { var n = d.createElement(t); if (c) n.className = c; if (x !== undefined && x !== null) n.textContent = x; return n; }
  function touch(n) { n.style.minHeight = "44px"; return n; } function wipe(r) { while (r.firstChild) r.removeChild(r.firstChild); }
  function wrap(d, r) { var w = d.createElement("div"); w.className = "wrap"; r.appendChild(w); return w; }
  /* showError: never-blank human panel for named chain errors. */
  function err(d, w, e, fb) {
    var b = el(d, "div", null, "error"); b.setAttribute("aria-live", "polite");
    var m = (e && e.message) ? e.message : String(e || fb || "Unexpected error");
    if (m.indexOf("unknown-asset") !== -1) m = fb || "Unknown asset.";
    else if (m.indexOf("unknown-account") !== -1) m = fb || "Unknown account.";
    else if (m.indexOf("symbol-taken") !== -1) m = "Symbol is already taken.";
    else if (m.indexOf("not-issuer") !== -1) m = "Only the issuer can change this.";
    else if (m.indexOf("not-market-issued") !== -1) m = "Not a market-issued asset.";
    else if (m.indexOf("wallet-locked") !== -1) m = "Wallet is locked.";
    else if (m.indexOf("not-connected") !== -1 || m.indexOf("not connected") !== -1) m = "Network unavailable. Check Settings → Nodes and retry.";
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
    w.appendChild(el(d, "h1", "Assets")); err(d, w, new Error("not-connected"), "Network unavailable.");
    var b = touch(el(d, "button", "Retry")); b.type = "button"; w.appendChild(b);
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
  function lock(d, w, rerun) {
    w.appendChild(el(d, "h1", "Assets"));
    w.appendChild(el(d, "p", "Wallet is locked. Enter your password.", "muted"));
    var pw = d.createElement("input"); pw.type = "password"; touch(pw); w.appendChild(pw);
    var b = touch(el(d, "button", "Unlock")); b.type = "button"; w.appendChild(b); var box = el(d, "div", null, "error"); w.appendChild(box);
    b.addEventListener("click", function () { box.textContent = ""; b.disabled = true;
      Promise.resolve().then(function () { return Wallet.unlock(pw.value); }).then(rerun)
        .catch(function (e) { b.disabled = false; box.textContent = (e && e.message) ? e.message : "Unlock failed"; }); });
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
    dl.appendChild(el(d, "dt", "Fee")); var fd = el(d, "dd", fh + " (core)"); fd.title = String(feeRaw); dl.appendChild(fd);
    dl.appendChild(el(d, "dt", "Network")); dl.appendChild(el(d, "dd", netName())); w.appendChild(dl);
    var back = touch(el(d, "button", "Back")); back.type = "button"; w.appendChild(back);
    var send = touch(el(d, "button", "Sign & Send")); send.type = "button"; w.appendChild(send);
    back.addEventListener("click", onBack);
    send.addEventListener("click", function () { back.disabled = true; send.disabled = true;
      var st = status(d, w, "Signing…");
      onSend(function (t) { st.textContent = t; }).catch(function (e) {
        try { w.removeChild(st); } catch (x) { /* gone */ }
        err(d, w, e, "Send failed."); back.disabled = false; }); });
  }
  /* done: observed-head result panel (no fabricated txid). */
  function done(d, w, title, headN, via, sub, href, link) {
    w.appendChild(el(d, "h1", title)); var ok = el(d, "p", "Observed at head block #" + headN + " (" + via + ").", "xfer-ok");
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
  /* rawAsset: full chain object for op-11 cloning (describe is a subset). */
  async function rawAsset(s) {
    var r = await Chain.call(await Chain.db(), "lookup_asset_symbols", [[s]]);
    if (!r || !r[0]) throw new Error("unknown-asset"); return r[0];
  }
  /* renderUpdate: op-11 common + op-12 bitasset (MPA) + op-13 producers. */
  function renderUpdate(root, symbol) {
    if (!root) return;
    var d = root.ownerDocument || document, g = ++gen;
    wipe(root); var w = wrap(d, root);
    if (noBackend()) { err(d, w, "Asset backend missing."); return; }
    if (cold(d, w, root, function () { renderUpdate(root, symbol); })) return;
    if (!Wallet.isUnlocked()) { lock(d, w, function () { renderUpdate(root, symbol); }); return; }
    if (!symbol) { w.appendChild(el(d, "h1", "Update asset")); err(d, w, new Error("unknown-asset"), "Unknown asset."); return; }
    w.appendChild(el(d, "h1", "Update " + symbol)); status(d, w, "Loading asset…");
    (async function () {
      var info = await Asset.describe(symbol);
      var mine = await Account.myAccountId().catch(function () { return ""; });
      if (g !== gen) return; wipe(root);
      var v = wrap(d, root); v.appendChild(el(d, "h1", "Update " + info.symbol));
      if (info.issuer_id !== mine) {
        err(d, v, new Error("not-issuer"), "Only the issuer can edit this asset.");
        v.appendChild(el(d, "p", "Issuer: " + (info.issuer_name || info.issuer_id) + ". Read-only.", "muted")); return; }
      /* op-11 common */
      v.appendChild(el(d, "h3", "Common options (op 11)"));
      var fp = field(d, "Market fee % (now " + AssetOps.hundredthsToPct(info.market_fee_hundredths) + "%)", null, AssetOps.hundredthsToPct(info.market_fee_hundredths), "decimal");
      var ds = field(d, "Description", null, info.description || "", null, true);
      v.appendChild(fp.row); v.appendChild(ds.row);
      var r1 = touch(el(d, "button", "Review update")); r1.type = "button"; v.appendChild(r1);
      r1.addEventListener("click", function () { r1.disabled = true;
        (async function () {
          var raw = await rawAsset(info.symbol);
          var next = JSON.parse(JSON.stringify(raw.options));
          next.market_fee_percent = AssetOps.pctHumanToHundredths(fp.input.value);
          next.description = ds.input.value || ""; next.extensions = [];
          var pair = AssetOps.buildUpdate({ issuerId: info.issuer_id, assetId: info.id, newIssuerOrNull: null, newOptions: next });
          var f = await AssetOps.fee(pair, CORE); pair[1].fee = { amount: f.amount, asset_id: f.asset_id };
          if (g !== gen) return; wipe(root); var w2 = wrap(d, root), pp = await feePrec(f.asset_id);
          var rows = [["Asset", info.symbol + " (" + info.id + ")"],
            ["Market fee", AssetOps.hundredthsToPct(info.market_fee_hundredths) + "% → " + fp.input.value + "%", String(next.market_fee_percent)]];
          if ((info.description || "") !== (ds.input.value || "")) rows.push(["Description", "changed (verified by re-read)"]);
          confirm(d, w2, root, "Confirm asset update", rows, f.amount, pp,
            function () { renderUpdate(root, info.symbol); }, function (s) {
              return publish(root, d, g, pair, async function () {
                try { var n = await Asset.describe(info.symbol);
                  return (n.description === (ds.input.value || "") && n.market_fee_hundredths === next.market_fee_percent) ? n : null;
                } catch (e) { return null; } },
                "Asset updated", info.symbol + " re-read matches the new options.", "#/asset/" + info.symbol, "Open " + info.symbol, s); });
        })().catch(function (e) { r1.disabled = false; err(d, v, e, "Could not prepare the update."); }); });
      /* op-12 bitasset (MPA only) */
      if (info.is_smartcoin) {
        v.appendChild(el(d, "h3", "Bitasset options (op 12)"));
        var of = field(d, "Settlement offset %", null, "1", "decimal");
        var vf = field(d, "Max settlement vol %", null, "20", "decimal");
        v.appendChild(of.row); v.appendChild(vf.row);
        var r2 = touch(el(d, "button", "Review bitasset update")); r2.type = "button"; v.appendChild(r2);
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
            confirm(d, w3, root, "Confirm bitasset update",
              [["Asset", info.symbol], ["Offset", of.input.value + "%"], ["Max vol", vf.input.value + "%"]],
              f.amount, pp, function () { renderUpdate(root, info.symbol); }, function (s) {
                return publish(root, d, g, pair, async function () {
                  try { var o = await Chain.call(await Chain.db(), "get_objects", [[rawB.bitasset_data_id]]);
                    var n = o && o[0] && o[0].options;
                    return (n && n.force_settlement_offset_percent === pair[1].new_options.force_settlement_offset_percent) ? n : null;
                  } catch (e) { return null; } },
                  "Bitasset updated", info.symbol + " bitasset re-read matches.", "#/asset/" + info.symbol, "Open " + info.symbol, s); });
          })().catch(function (e) { r2.disabled = false; err(d, v, e, "Could not prepare the bitasset update."); }); });
      }
      /* op-13 producers */
      v.appendChild(el(d, "h3", "Feed producers (op 13)"));
      var pa = field(d, "Producers (one name or 1.2.N per line)", null, "", null, true);
      v.appendChild(pa.row);
      var r3 = touch(el(d, "button", "Review producers")); r3.type = "button"; v.appendChild(r3);
      r3.addEventListener("click", function () { r3.disabled = true;
        (async function () {
          var names = pa.input.value.split("\n").map(function (s) { return s.trim(); }).filter(function (s) { return !!s; });
          var ids = [];
          for (var i = 0; i < names.length; i++) ids.push((await Account.resolve(names[i])).id);
          var pair = AssetOps.buildUpdateProducers({ issuerId: info.issuer_id, assetId: info.id, producerIds: ids });
          var f = await AssetOps.fee(pair, CORE); pair[1].fee = { amount: f.amount, asset_id: f.asset_id };
          if (g !== gen) return; wipe(root); var w4 = wrap(d, root), pp = await feePrec(f.asset_id);
          confirm(d, w4, root, "Confirm feed producers",
            [["Asset", info.symbol], ["Producers", ids.length ? ids.join(", ") : "(empty)"]],
            f.amount, pp, function () { renderUpdate(root, info.symbol); }, function (s) {
              return publish(root, d, g, pair, async function () { return true; },
                "Producers updated", "Broadcast observed; verify on #/asset/" + info.symbol + ".",
                "#/asset/" + info.symbol, "Open " + info.symbol, s); });
        })().catch(function (e) { r3.disabled = false; err(d, v, e, "Could not prepare the producer update."); }); });
    })().catch(function (e) { if (g === gen) { wipe(root); var w2 = wrap(d, root);
      w2.appendChild(el(d, "h1", "Update " + symbol)); err(d, w2, e, "Unknown asset."); } });
  }
  /* half: one issue/reserve half-form wired to its builder + supply-delta proof. */
  function half(d, v, root, g, title, btnLabel, isReserve) {
    v.appendChild(el(d, "h3", title));
    if (isReserve) v.appendChild(el(d, "p", "Market-issued assets cannot be reserved.", "muted"));
    var s = field(d, "Symbol", null, "", null, false, "AFKTEST01");
    var t = isReserve ? null : field(d, "To (name or 1.2.N)", null, "");
    var a = field(d, "Amount (human)", null, "1", "decimal");
    v.appendChild(s.row); if (t) v.appendChild(t.row); v.appendChild(a.row);
    var r = touch(el(d, "button", btnLabel)); r.type = "button"; v.appendChild(r);
    r.addEventListener("click", function () { r.disabled = true;
      (async function () {
        var sym = s.input.value.trim().toUpperCase();
        var info = await Asset.describe(sym);
        if (isReserve && info.is_smartcoin) throw new Error("not-market-issued");
        var raw = Format.parseAmount(a.input.value, info.precision);
        if (!/[1-9]/.test(raw)) throw new Error("Amount must be greater than zero.");
        var me = await Account.resolve(await Account.myAccountId());
        if (isReserve && me.id !== info.issuer_id) throw new Error("not-issuer");
        var to = isReserve ? null : await Account.resolve(t.input.value.trim());
        var pair = isReserve
          ? AssetOps.buildReserve({ payerId: me.id, assetId: info.id, amountHuman: a.input.value, precision: info.precision })
          : AssetOps.buildIssue({ issuerId: info.issuer_id, assetId: info.id, toAccountId: to.id, amountHuman: a.input.value, precision: info.precision, memoOrNull: null });
        var f = await AssetOps.fee(pair, CORE); pair[1].fee = { amount: f.amount, asset_id: f.asset_id };
        var before = info.supply_raw;
        if (g !== gen) return; wipe(root); var w2 = wrap(d, root), pp = await feePrec(f.asset_id);
        var rows = [["Asset", info.symbol + " (" + info.id + ")"],
          ["Amount", Format.formatAmount(raw, info.precision) + " " + info.symbol, raw]];
        rows.push(isReserve ? ["Payer", me.name + " (" + me.id + ")"] : ["To", to.name + " (" + to.id + ")"]);
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
      })().catch(function (e) { r.disabled = false; err(d, v, e, isReserve ? "Could not prepare the reserve." : "Could not prepare the issue."); }); });
  }
  /* renderIssue: op-14 issue + op-15 reserve halves. */
  function renderIssue(root) {
    if (!root) return;
    var d = root.ownerDocument || document, g = ++gen;
    wipe(root); var v = wrap(d, root);
    if (noBackend()) { err(d, v, "Asset backend missing."); return; }
    if (cold(d, v, root, function () { renderIssue(root); })) return;
    if (!Wallet.isUnlocked()) { lock(d, v, function () { renderIssue(root); }); return; }
    v.appendChild(el(d, "h1", "Issue / reserve"));
    half(d, v, root, g, "Issue to account (op 14)", "Review issue", false);
    half(d, v, root, g, "Reserve / burn back (op 15)", "Review reserve", true);
  }
  return { renderUpdate: renderUpdate, renderIssue: renderIssue };
})();
if (typeof globalThis !== "undefined" && typeof globalThis.AssetManageUI === "undefined") { globalThis.AssetManageUI = AssetManageUI; }
if (typeof module !== "undefined") { module.exports = AssetManageUI; }
