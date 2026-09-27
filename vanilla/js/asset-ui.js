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
  var CORE = "1.3.0", SYM_RE = /^[A-Z0-9.]+$/;
  var PERMS = [[1, "charge fee"], [2, "whitelist"], [4, "override"], [8, "restricted"], [16, "no force settle"], [32, "global settle"], [64, "no confidential"], [128, "witness-fed"], [256, "committee-fed"]];
  var FLAGS = [[1, "charge fee"], [2, "whitelist"], [4, "override"], [8, "restricted"], [16, "no force settle"], [64, "no confidential"], [128, "witness-fed"], [256, "committee-fed"]], gen = 0;
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
  /* field: labeled input row. bits: checkbox group with read(). */
  function field(d, label, id, val, mode, area, ph) {
    var row = el(d, "div", null, "xfer-field"), lab = el(d, "label", label + " ");
    var inp = d.createElement(area ? "textarea" : "input");
    if (!area) { inp.type = "text"; if (mode) inp.setAttribute("inputmode", mode); }
    if (id) inp.id = id; if (val !== undefined) inp.value = val;
    if (ph) inp.setAttribute("placeholder", ph); inp.setAttribute("autocomplete", "off");
    touch(inp); lab.appendChild(inp); row.appendChild(lab); return { row: row, input: inp };
  }
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
  /* nav: entry cards linking to the four asset screens. */
  function nav(d, w) {
    var n = el(d, "div", null, "asset-nav");
    n.style.display = "flex"; n.style.flexWrap = "wrap"; n.style.gap = "8px";
    [["Create asset", "#/assets/create"], ["Issue / reserve", "#/assets/issue"], ["Publish feed", "#/assets/feed"]].forEach(function (l) { var a = el(d, "a", l[0]); a.setAttribute("href", l[1]); touch(a); n.appendChild(a); });
    w.appendChild(n);
  }
  /* renderAssets: issued-by-account list + fee-schedule section (feed-ui owns). */
  function renderAssets(root) {
    if (!root) return;
    var d = root.ownerDocument || document, g = ++gen;
    wipe(root); var w = wrap(d, root);
    if (noBackend()) { err(d, w, "Asset backend missing."); return; }
    if (cold(d, w, root, function () { renderAssets(root); })) return;
    w.appendChild(el(d, "h1", "Assets")); nav(d, w);
    var f = field(d, "Issuer (name or 1.2.N)", "asset-issuer", ""); w.appendChild(f.row);
    var go = touch(el(d, "button", "Load issued assets")); go.type = "button"; w.appendChild(go);
    var list = el(d, "div", null, "asset-list"); w.appendChild(list);
    var fees = el(d, "div", null, "asset-fees"); w.appendChild(fees);
    if (typeof AssetFeedUI !== "undefined" && AssetFeedUI.feeSection) AssetFeedUI.feeSection(d, fees);
    Account.myAccountId().then(function (id) { return Account.resolve(id); }).then(function (me) {
      if (g === gen && !f.input.value) f.input.value = me.name; }).catch(function () { /* manual stands */ });
    go.addEventListener("click", function () {
      var v = f.input.value.trim(); if (!v) { err(d, list, "Enter an issuer account."); return; }
      wipe(list); status(d, list, "Loading issued assets…");
      Account.resolve(v).then(function (a) { return Asset.issuedBy(a.id, "1.3.0", 100); }).then(function (rows) {
        if (g !== gen) return; wipe(list);
        if (!rows.length) { list.appendChild(el(d, "p", "No assets issued by this account.", "muted")); return; }
        rows.forEach(function (r) {
          var card = el(d, "div", null, "asset-row");
          card.style.display = "flex"; card.style.flexWrap = "wrap"; card.style.gap = "8px";
          var t = el(d, "strong", r.symbol + " "); t.title = r.id; card.appendChild(t);
          var sup = "—"; try { sup = (r.supply_raw === null) ? "—" : Format.formatAmount(r.supply_raw, r.precision); } catch (e) { sup = String(r.supply_raw); } /* raw only pre-format */
          card.appendChild(el(d, "span", "p" + r.precision + " · supply " + sup + (r.is_smartcoin ? " · smartcoin" : ""), "muted"));
          var o = el(d, "a", "Open"); o.setAttribute("href", "#/asset/" + r.symbol); touch(o); card.appendChild(o);
          var u = el(d, "a", "Update"); u.setAttribute("href", "#/assets/update/" + r.symbol); touch(u); card.appendChild(u);
          list.appendChild(card); });
      }).catch(function (e) { if (g === gen) { wipe(list); err(d, list, e, "Could not load issued assets."); } });
    });
  }
  /* renderCreate: tabbed UIA/Smartcoin/NFT/PMA over one op-10 builder. */
  function renderCreate(root) {
    if (!root) return;
    var d = root.ownerDocument || document, g = ++gen;
    wipe(root); var w = wrap(d, root);
    if (noBackend()) { err(d, w, "Asset backend missing."); return; }
    if (cold(d, w, root, function () { renderCreate(root); })) return;
    if (!Wallet.isUnlocked()) { lock(d, w, function () { renderCreate(root); }); return; }
    w.appendChild(el(d, "h1", "Create asset"));
    var tab = "uia", bar = el(d, "div", null, "vote-tabs"); w.appendChild(bar);
    var body = el(d, "div", null, "asset-create"); w.appendChild(body);
    function draw() {
      if (g !== gen) return;
      wipe(bar); wipe(body);
      [["uia", "UIA"], ["smart", "Smartcoin"], ["nft", "NFT"], ["pma", "PMA"]].forEach(function (t) {
        var b = touch(el(d, "button", t[1], tab === t[0] ? "vote-tab active" : "vote-tab"));
        b.type = "button"; b.addEventListener("click", function () { tab = t[0]; draw(); }); bar.appendChild(b); });
      var smart = (tab === "smart" || tab === "pma"), nft = (tab === "nft");
      if (tab === "pma") body.appendChild(el(d, "p", "Prediction market: is_prediction_market locked ON.", "muted"));
      var sym = field(d, "Symbol (A-Z0-9.)", null, "", null, false, "AFKTEST01");
      var prec = field(d, "Precision (0–12)", null, "4", "numeric");
      var msup = field(d, "Max supply (human)", null, "1000000", "decimal");
      var fpct = field(d, "Market fee % (human)", null, "0", "decimal");
      var mfee = field(d, "Max market fee (human)", null, "1000000", "decimal");
      var cb = field(d, "CER base (human, core)", null, "1", "decimal");
      var cq = field(d, "CER quote (human, new asset)", null, "1", "decimal");
      var desc = field(d, "Description", null, "", null, true);
      [sym, prec, msup, fpct, mfee, cb, cq, desc].forEach(function (x) { body.appendChild(x.row); });
      body.appendChild(el(d, "h3", "Permissions")); var pg = bits(d, PERMS, 79); body.appendChild(pg.box);
      body.appendChild(el(d, "h3", "Flags")); var fg = bits(d, FLAGS, 0); body.appendChild(fg.box);
      var nt = null, nu = null, lh = null, mf = null, dl = null, op = null, mv = null, ba = null;
      if (nft) { body.appendChild(el(d, "h3", "NFT metadata (description nft_object)"));
        nt = field(d, "NFT title", null, ""); nu = field(d, "NFT URI", null, "");
        body.appendChild(nt.row); body.appendChild(nu.row); }
      if (smart) { body.appendChild(el(d, "h3", "Bitasset options"));
        lh = field(d, "Feed lifetime (hours)", null, "24", "numeric"); mf = field(d, "Minimum feeds", null, "1", "numeric");
        dl = field(d, "Settlement delay (sec)", null, "86400", "numeric"); op = field(d, "Settlement offset %", null, "1", "decimal");
        mv = field(d, "Max settlement vol %", null, "20", "decimal"); ba = field(d, "Backing (1.3.N)", null, "1.3.0");
        [lh, mf, dl, op, mv, ba].forEach(function (x) { body.appendChild(x.row); }); }
      var rev = touch(el(d, "button", "Review create")); rev.type = "button"; body.appendChild(rev);
      rev.addEventListener("click", function () {
        rev.disabled = true;
        (async function () {
          var symbol = sym.input.value.trim().toUpperCase();
          if (!SYM_RE.test(symbol)) throw new Error("bad-symbol (uppercased A-Z0-9.)");
          var precision = parseInt(prec.input.value.trim(), 10);
          if (!(precision >= 0 && precision <= 12)) throw new Error("precision must be 0-12");
          var db = await Chain.db();
          var taken = await Chain.call(db, "lookup_asset_symbols", [[symbol]]);
          if (taken && taken[0]) throw new Error("symbol-taken");
          var me = await Account.resolve(await Account.myAccountId());
          var perms = pg.read(), flags = fg.read();
          if (!smart) { perms &= ~(128 | 256 | 32); flags &= ~(128 | 256); }
          var nftObj = null;
          if (nft) { var t = nt.input.value.trim(), u = nu.input.value.trim();
            if (!t && !u) throw new Error("NFT needs a title or URI.");
            nftObj = { title: t || symbol, type: "nft", uri: u || "" }; }
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
          var rows = [["Issuer", me.name + " (" + me.id + ")"], ["Symbol", symbol], ["Precision", String(precision)],
            ["Max supply", msup.input.value],
            ["Market fee", AssetOps.hundredthsToPct(pair[1].common_options.market_fee_percent) + "%", String(pair[1].common_options.market_fee_percent)],
            ["Permissions", bitNames(PERMS, perms)], ["Flags", bitNames(FLAGS, flags)],
            ["CER", (cb.input.value || "1") + " CORE / " + (cq.input.value || "1") + " " + symbol]];
          if (bit) rows.push(["Bitasset", "feeds≥" + mf.input.value + ", backing " + bit.short_backing_asset]);
          if (nftObj) rows.push(["NFT", (nftObj.title || "") + " / nft"]);
          rows.push(["Prediction market", (tab === "pma") ? "yes" : "no"]);
          if (g !== gen) return; wipe(root);
          var w2 = wrap(d, root), fpp = await feePrec(f.asset_id);
          confirm(d, w2, root, "Confirm asset create", rows, f.amount, fpp,
            function () { renderCreate(root); }, function (onStep) {
              return publish(root, d, g, pair, async function () {
                try { return await Asset.describe(symbol); } catch (e) { return null; }
              }, "Asset created", symbol + " precision " + precision + " issued by " + me.name + ".",
                "#/asset/" + symbol, "Open " + symbol, onStep); });
        })().catch(function (e) { rev.disabled = false; err(d, body, e, "Could not prepare the create."); });
      });
    }
    draw();
  }
  return { renderAssets: renderAssets, renderCreate: renderCreate };
})();
if (typeof globalThis !== "undefined" && typeof globalThis.AssetUI === "undefined") { globalThis.AssetUI = AssetUI; }
if (typeof module !== "undefined") { module.exports = AssetUI; }
