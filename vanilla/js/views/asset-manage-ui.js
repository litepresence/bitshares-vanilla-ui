/* AssetManageUI: asset update + issue/reserve/settle/claim/issuer screens
 *   (ops 11/12/13/14/15/17/43/47/48).
 * Owns: #/assets/update/:symbol (op-11 common incl. perms/flags/max-supply/
 *   new-issuer + op-12 bitasset + op-13 producers),
 *   #/assets/issue (op-14 issue incl. optional plaintext memo + op-15 reserve
 *   + op-17 force-settle + op-43 claim-fees + op-47 claim-pool + op-48
 *   update-issuer halves).
 * Consumes: Asset (describe reads), AssetOps (builders/fee/sendAndProve +
 *   pct helpers), Account, Wallet, Tx.buildTx, Format, Chain, Store.
 * Side effects: DOM under root, global AssetManageUI only. WIF never hits
 *   the DOM.
 * Created by: slice-10 audit fix B2 (split from asset-ui.js,
 *   behavior-identical). The small view chrome below (el/touch/wipe/wrap/
 *   err/status/netName/feePrec/head/noBackend/cold/confirm/done/
 *   publish/bits/bitNames/utf8Hex/fullAccount) intentionally duplicates
 *   asset-ui.js (el/touch/bits/bitNames) and transfer-confirm.js
 *   (utf8Hex/fullAccount) verbatim — duplicated plain code over a shared
 *   import, per the anti-rot doctrine (no new load-bearing cross-file
 *   abstraction; each view file stays self-contained and readable alone).
 *   Labeled rows use shared Forms.
 * TRUTH: op fields <- asset_ops.hpp (per-op ranges in builders/asset-ops.js
 *   header); hundredths via AssetOps only; op-11 clones the live chain object
 *   (rawAsset) so untouched fields pass through; market-issued reserve is
 *   client-blocked (not-market-issued); claim halves read the dynamic leg
 *   directly (describe omits accumulated_fees/fee_pool); op-48 signs with
 *   the OWNER key (active wif builds chain-rejected bytes).
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
    var m = (e && e.message) ? e.message : String(e || fb || t("common.unexpected_error", "Unexpected error"));
    if (m.indexOf("unknown-asset") !== -1) m = fb || t("barter.unknown_asset", "Unknown asset.");
    else if (m.indexOf("unknown-account") !== -1) m = fb || t("common.unknown_account", "Unknown account.");
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
    w.appendChild(DOM.pageHead(d, t("assets.title", "Assets"), "assets")); err(d, w,new Error("not-connected"),t("common.network_unavailable_short", "Network unavailable."));
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
    w.appendChild(DOM.pageHead(d, title, "assets")); var ok = el(d, "p", "Observed at head block #" + headN + " (" + via + ").", "xfer-ok");
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
  /* PERMS/FLAGS: issuer-permission + flag bit tables, value-copied verbatim
   * from asset-ui.js (create-tab source of truth for bit meanings; chain
   * order <- protocol/asset_ops.hpp option bits). Copied, not imported —
   * this file stays self-contained per the header doctrine. */
  var PERMS = [[1, "charge fee"], [2, "whitelist"], [4, "override"], [8, "restricted"], [16, "no force settle"], [32, "global settle"], [64, "no confidential"], [128, "witness-fed"], [256, "committee-fed"]];
  var FLAGS = [[1, "charge fee"], [2, "whitelist"], [4, "override"], [8, "restricted"], [16, "no force settle"], [64, "no confidential"], [128, "witness-fed"], [256, "committee-fed"]];
  /* bits: permission-bit checkbox group (verbatim shape from asset-ui.js).
   * @param {Document} d host document
   * @param {Array} list [bit, label] pairs
   * @param {number} cur current mask (checked = mask & bit)
   * @returns {{box: HTMLElement, read: function(): number}} box to append,
   *   read() ORs the checked bits. Failure modes: none (pure DOM). */
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
  /* bitNames: bit int -> "a, b" label list for confirm rows (verbatim from
   * asset-ui.js — keeps update confirms reading like create confirms).
   * @param {Array} list [bit, label] pairs
   * @param {number} v mask to name
   * @returns {string} comma list or "(none)". */
  function bitNames(list, v) { var o = []; list.forEach(function (p) { if (v & p[0]) o.push(p[1]); }); return o.length ? o.join(", ") : "(none)"; }
  /* utf8Hex: UTF-8 string to lowercase hex (plain-memo message path, verbatim
   * from transfer-confirm.js). Byte loop, not money — no precision involved.
   * @param {string} str memo text
   * @returns {string} hex bytes. */
  function utf8Hex(str) {
    var bytes = new TextEncoder().encode(str);
    var out = "";
    for (var i = 0; i < bytes.length; i++) {
      out += bytes[i].toString(16).padStart(2, "0");
    }
    return out;
  }
  /* fullAccount: full chain account row (needed for memo keys, which
   * Account.resolve intentionally does not return; verbatim shape from
   * transfer-confirm.js).
   * @param {string} id 1.2.N account id
   * @returns {Promise<any>} chain account object. Fails "unknown-account". */
  async function fullAccount(id) {
    var dbId = await Chain.db();
    var rows = await Chain.call(dbId, "get_accounts", [[id]]);
    if (!rows || !rows[0]) throw new Error("unknown-account");
    return rows[0];
  }
  /* dynOf: dynamic asset leg for claim/pool proofs. WHY a second read:
   * Asset.describe() omits accumulated_fees + fee_pool (not in its shape),
   * and those counters are exactly what op-43/47 move — so the halves read
   * the dynamic object directly (lookup -> dynamic_asset_data_id ->
   * get_objects, same join asset.js performs internally).
   * @param {string} symbolOrId symbol or 1.3.x id
   * @returns {Promise<{dynamicId: string, dyn: any}>} dynamic object.
   *   Fails "unknown-asset" / "not-connected". */
  async function dynOf(symbolOrId) {
    var sym = String(symbolOrId || "").trim();
    if (!sym) throw new Error("unknown-asset");
    var key = (/^\d+\.\d+\.\d+$/.test(sym)) ? sym : sym.toUpperCase();
    var db = await Chain.db();
    var found = null;
    if (/^1\.3\.\d+$/.test(key)) {
      var byId = await Chain.call(db, "get_objects", [[key]]);
      found = byId && byId[0];
    } else {
      var rows = await Chain.call(db, "lookup_asset_symbols", [[key]]);
      found = rows && rows[0];
    }
    if (!found || !found.dynamic_asset_data_id) throw new Error("unknown-asset");
    var objs = await Chain.call(db, "get_objects", [[found.dynamic_asset_data_id]]);
    if (!objs || !objs[0]) throw new Error("unknown-asset");
    return { dynamicId: found.dynamic_asset_data_id, dyn: objs[0] };
  }
  /* issueMemoOrNull: optional plaintext issue memo (op-14 memoOrNull leg).
   * WHY plaintext: v1 has no memo encryption (builders/asset-ops.js scope
   * note) — same honest-plaintext precedent as debit claim memos
   * (Htlc.buildDebitClaim): blank -> null (both references pass memo:null);
   * non-blank -> full memo object {from,to,nonce:"0",message:hex} built from
   * both parties' on-chain memo_keys, nonce 0 marking it unencrypted. The
   * confirm dialog carries the plaintext warning row so nobody mistakes it
   * for encrypted. Missing memo keys throw the clear-the-memo message
   * (transfer precedent) instead of producing sign-time rejects.
   * @param {string} issuerId 1.2.N asset issuer (memo from)
   * @param {string} toId 1.2.N recipient (memo to)
   * @param {string} memoText raw input ("" = no memo)
   * @returns {Promise<any>} null or the memo object. Fails with the
   *   no-memo-key note (asset.issue_memo_no_key) when a memo key is missing. */
  async function issueMemoOrNull(issuerId, toId, memoText) {
    var text = String(memoText || "");
    if (!text) return null;
    var db = await Chain.db();
    var rows = await Chain.call(db, "get_accounts", [[issuerId, toId]]);
    var fromAcc = rows && rows[0], toAcc = rows && rows[1];
    var fromKey = fromAcc && fromAcc.options ? fromAcc.options.memo_key : null;
    var toKey = toAcc && toAcc.options ? toAcc.options.memo_key : null;
    if (!toKey) throw new Error(t("asset.issue_memo_no_key", "No memo key on file for this account."));
    if (!fromKey) throw new Error(t("asset.issue_memo_no_key", "No memo key on file for this account."));
    return { from: fromKey, to: toKey, nonce: "0", message: utf8Hex(text) };
  }
  /* multisigNote: shared-issuer propose path (multisig-ux skill, asset spec).
   * Static text + two links only: no chain call, no unlock gate. Mounted on
   * update (both the read-only guard and below the direct forms) and on
   * issue/reserve so multisig issuers never hit a dead end. */
  function multisigNote(d, v) {
    v.appendChild(el(d, "h2", t("asset.multisig_title", "Shared issuer? Propose it")));
    v.appendChild(el(d, "p", t("asset.multisig_body", "If this asset needs more than one approval, direct Sign fails — propose the change instead and ask co-owners to approve (op 23)."), "muted"));
    var p = el(d, "p", null, "muted");
    var a1 = el(d, "a", t("asset.multisig_open_proposals", "View proposals")); a1.setAttribute("href", "#/proposals"); touch(a1); p.appendChild(a1);
    p.appendChild(d.createTextNode(" · "));
    var a2 = el(d, "a", t("asset.multisig_open_txbuilder", "Open transaction builder")); a2.setAttribute("href", "#/txbuilder"); touch(a2); p.appendChild(a2);
    v.appendChild(p);
  }
  /* renderUpdate: op-11 common (fee/desc/perms/flags/max-supply/new-issuer)
   * + op-12 bitasset (MPA) + op-13 producers.
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
    if (!symbol) { w.appendChild(DOM.pageHead(d, t("asset.update_title", "Update asset"), "assets")); err(d, w,new Error("unknown-asset"),t("barter.unknown_asset", "Unknown asset.")); return; }
    w.appendChild(DOM.pageHead(d, "Update " + symbol, "assets")); status(d, w, t("explorer.loading_asset", "Loading asset…"));
    (async function () {
      var info = await Asset.describe(symbol);
      /* Null-tolerant at render: locked viewers get "" (never the issuer),
       * so they see the public read panel below and no edit forms; the
       * password stays loud only at sign time in publish(). */
      var mine = await Account.myAccountId().catch(function () { return ""; });
      if (g !== gen) return; wipe(root);
      var v = wrap(d, root); v.appendChild(DOM.pageHead(d, "Update " + info.symbol, "assets"));
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
        v.appendChild(el(d, "p", "Issuer: " + (info.issuer_name || info.issuer_id) + ". Read-only.", "muted"));
        v.appendChild(el(d, "p", t("asset.multisig_coowner_hint", "Co-owner? Propose the change on the proposals page and ask co-owners to approve (op 23)."), "muted"));
        multisigNote(d, v);
        return; }
      /* op-11 common (fee + description + perms/flags + max-supply +
       * optional new-issuer; untouched legs pass through via the rawAsset
       * clone, so the confirm only names what this form can change). */
      v.appendChild(el(d, "h2", t("asset.common_title", "Common options (op 11)")));
      var fp = Forms.labeledInput(d, "Market fee % (now " + AssetOps.hundredthsToPct(info.market_fee_hundredths) + "%)" + " ", { value: AssetOps.hundredthsToPct(info.market_fee_hundredths), inputmode: "decimal", autocomplete: "off" });
      var ds = Forms.labeledTextarea(d, t("asset.description_row", "Description") + " ", { value: info.description || "" });
      ds.input.setAttribute("autocomplete", "off");
      var maxHuman = info.max_supply_raw;
      try { maxHuman = Format.formatAmount(String(info.max_supply_raw), info.precision); }
      catch (e) { maxHuman = String(info.max_supply_raw); }
      var ms = Forms.labeledInput(d, t("asset.max_supply_field", "Max supply (human)") + " ", { value: maxHuman, inputmode: "decimal", autocomplete: "off" });
      var ni = Forms.labeledInput(d, t("asset.new_issuer_field", "New issuer"), { value: "", autocomplete: "off" });
      v.appendChild(fp.row); v.appendChild(ds.row); v.appendChild(ms.row); v.appendChild(ni.row);
      v.appendChild(el(d, "h2", t("help.topic_accounts-permissions_title", "Permissions")));
      var pg = bits(d, PERMS, info.permissions); v.appendChild(pg.box);
      v.appendChild(el(d, "h2", t("asset.flags_title", "Flags")));
      var fg = bits(d, FLAGS, info.flags); v.appendChild(fg.box);
      var r1 = touch(el(d, "button", t("credit.review_update", "Review update"))); r1.type = "button"; v.appendChild(r1);
      r1.addEventListener("click", function () { r1.disabled = true;
        (async function () {
          var raw = await rawAsset(info.symbol);
          var next = JSON.parse(JSON.stringify(raw.options));
          next.market_fee_percent = AssetOps.pctHumanToHundredths(fp.input.value);
          next.description = ds.input.value || ""; next.extensions = [];
          next.issuer_permissions = pg.read(); next.flags = fg.read();
          next.max_supply = Format.parseAmount(ms.input.value, info.precision);
          var newIssuerId = null, newIssuerName = "";
          var niText = ni.input.value.trim();
          if (niText) { var nu = await Account.resolve(niText); newIssuerId = nu.id; newIssuerName = nu.name || nu.id; }
          var pair = AssetOps.buildUpdate({ issuerId: info.issuer_id, assetId: info.id, newIssuerOrNull: newIssuerId, newOptions: next });
          var f = await AssetOps.fee(pair, CORE); pair[1].fee = { amount: f.amount, asset_id: f.asset_id };
          if (g !== gen) return; wipe(root); var w2 = wrap(d, root), pp = await feePrec(f.asset_id);
          var rows = [[t("asset_ops.title", "Asset"), info.symbol + " (" + info.id + ")"],
            [t("explorer.market_fee", "Market fee"), AssetOps.hundredthsToPct(info.market_fee_hundredths) + "% → " + fp.input.value + "%", String(next.market_fee_percent)]];
          if ((info.description || "") !== (ds.input.value || "")) rows.push([t("asset.description_row", "Description"), "changed (verified by re-read)"]);
          if ((info.permissions || 0) !== next.issuer_permissions) rows.push([t("help.topic_accounts-permissions_title", "Permissions"), bitNames(PERMS, info.permissions || 0) + " → " + bitNames(PERMS, next.issuer_permissions), (info.permissions || 0) + "→" + next.issuer_permissions]);
          if ((info.flags || 0) !== next.flags) rows.push([t("asset.flags_title", "Flags"), bitNames(FLAGS, info.flags || 0) + " → " + bitNames(FLAGS, next.flags), (info.flags || 0) + "→" + next.flags]);
          if (String(info.max_supply_raw) !== String(next.max_supply)) {
            var maxNewHuman = ms.input.value.trim();
            try { maxNewHuman = Format.formatAmount(String(next.max_supply), info.precision) + " " + info.symbol; }
            catch (e) { maxNewHuman = ms.input.value.trim(); }
            rows.push([t("explorer.max_supply", "Max supply"), maxHuman + " " + info.symbol + " → " + maxNewHuman, String(next.max_supply)]);
          }
          if (newIssuerId) rows.push([t("explorer.issuer_row", "Issuer"), (info.issuer_name || info.issuer_id) + " → " + newIssuerName + " (" + newIssuerId + ")"]);
          rows.push([t("borrow.network", "Network"), netName()]);
          var updFee;
          try { updFee = Format.formatAmount(String(f.amount), pp) + " (core)"; }
          catch (feeErr) { updFee = String(f.amount) + " (core)"; }
          var updDlg = ConfirmDialog.show({ title: t("asset.confirm_update", "Confirm asset update"),
            rows: rows, feeHuman: updFee, feeTerm: t("borrow.fee", "Fee"),
            backLabel: t("barter.back", "Back"), sendLabel: t("common.sign_send", "Sign & Send"),
            onBack: function () { renderUpdate(root, info.symbol); },
            onSend: function () {
              var btns = updDlg.getElementsByTagName("button");
              var backB = btns[0], sendB = btns[1];
              backB.disabled = true; sendB.disabled = true;
              var st = status(d, w2, "Signing…");
              publish(root, d, g, pair, async function () {
                try { var n = await Asset.describe(info.symbol);
                  if (!n) return null;
                  var okDesc = (n.description === (ds.input.value || ""));
                  var okFee = (n.market_fee_hundredths === next.market_fee_percent);
                  var okPerms = ((n.permissions || 0) === next.issuer_permissions);
                  var okFlags = ((n.flags || 0) === next.flags);
                  var okMax = (String(n.max_supply_raw) === String(next.max_supply));
                  var okIssuer = (!newIssuerId || n.issuer_id === newIssuerId);
                  return (okDesc && okFee && okPerms && okFlags && okMax && okIssuer) ? n : null;
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
        v.appendChild(el(d, "h2", t("asset.bitasset_op12_title", "Bitasset options (op 12)")));
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
              backLabel: t("barter.back", "Back"), sendLabel: t("common.sign_send", "Sign & Send"),
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
      v.appendChild(el(d, "h2", t("asset.producers_title", "Feed producers (op %(op)s)", { op: 13 })));
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
            backLabel: t("barter.back", "Back"), sendLabel: t("common.sign_send", "Sign & Send"),
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
      multisigNote(d, v);
    })().catch(function (e) { if (g === gen) { wipe(root); var w2 = wrap(d, root);
      w2.appendChild(DOM.pageHead(d, "Update " + symbol, "assets")); err(d, w2,e,t("barter.unknown_asset", "Unknown asset.")); } });
  }
  /* half: one issue/reserve half-form wired to its builder + supply-delta proof.
   * The issue leg carries an optional plaintext memo (memoOrNull); reserve
   * has no memo leg on chain, so no memo box renders there.
   * PUBLIC preview (gate-repair): the acting account is an explicit input
   * defaulting to 1.2.0 (never Account.myAccountId at render); Sign & Send
   * still needs the unlocked WIF in publish(). */
  function half(d, v, root, g, title, btnLabel, isReserve) {
    v.appendChild(el(d, "h2", title));
    if (isReserve) v.appendChild(el(d, "p", t("asset.no_reserve_mpa", "Market-issued assets cannot be reserved."), "muted"));
    var s = Forms.labeledInput(d, t("explorer.th_symbol", "Symbol") + " ", { value: "", placeholder: "AFKTEST01", autocomplete: "off" });
    var toF = isReserve ? null : Forms.labeledInput(d, t("asset.to_field", "To (name or 1.2.N)") + " ", { value: "", autocomplete: "off" });
    var a = Forms.labeledInput(d, t("asset.amount_field", "Amount (human)") + " ", { value: "1", inputmode: "decimal", autocomplete: "off" });
    var memoF = isReserve ? null : Forms.labeledInput(d, t("transfer.memo_label", "Memo (optional) ") + " ", { value: "", placeholder: t("debit.plaintext_ph", "stored in PLAINTEXT"), autocomplete: "off" });
    var who = Forms.labeledInput(d, (isReserve ? t("asset.payer_field", "Payer (name or 1.2.N)") : t("asset.acting_field", "Acting account (name or 1.2.N)")) + " ", { value: (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0", autocomplete: "off" });
    v.appendChild(s.row); if (toF) v.appendChild(toF.row); v.appendChild(a.row); if (memoF) v.appendChild(memoF.row); v.appendChild(who.row);
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
        /* Optional plaintext memo (issue only — op-15 carries no memo leg):
         * blank stays null (both references pass memo:null); non-blank
         * resolves both memo keys into the full memo object the builder
         * passes through (issueMemoOrNull WHY above). */
        var memoText = (!isReserve && memoF) ? String(memoF.input.value || "") : "";
        var memoObj = isReserve ? null : await issueMemoOrNull(info.issuer_id, to.id, memoText);
        var pair = isReserve
          ? AssetOps.buildReserve({ payerId: me.id, assetId: info.id, amountHuman: a.input.value, precision: info.precision })
          : AssetOps.buildIssue({ issuerId: info.issuer_id, assetId: info.id, toAccountId: to.id, amountHuman: a.input.value, precision: info.precision, memoOrNull: memoObj });
        var f = await AssetOps.fee(pair, CORE); pair[1].fee = { amount: f.amount, asset_id: f.asset_id };
        var before = info.supply_raw;
        if (g !== gen) return; wipe(root); var w2 = wrap(d, root), pp = await feePrec(f.asset_id);
        var rows = [[t("asset_ops.title", "Asset"),  info.symbol + " (" + info.id + ")"],
          [t("confirm.amount", "Amount"),  Format.formatAmount(raw, info.precision) + " " + info.symbol, raw]];
        rows.push(isReserve ? [t("asset.payer_row", "Payer"), me.name + " (" + me.id + ")"] : [t("confirm.to", "To"), to.name + " (" + to.id + ")"]);
        if (!isReserve) {
          rows.push([t("confirm.memo", "Memo"), memoText ? t("confirm.memo_plain", "Plain: %(text)s", { text: memoText }) : t("confirm.memo_none", "(none)")]);
          if (memoText) rows.push([t("debit.memo_warning_row", "Memo warning"), t("asset.issue_memo_warning", "Attach a memo — it is stored on-chain in plaintext.")]);
        }
        rows.push([t("borrow.network", "Network"), netName()]);
        var halfFee;
        try { halfFee = Format.formatAmount(String(f.amount), pp) + " (core)"; }
        catch (feeErr4) { halfFee = String(f.amount) + " (core)"; }
        var halfDlg = ConfirmDialog.show({ title: isReserve ? "Confirm reserve" : "Confirm issue",
          rows: rows, feeHuman: halfFee, feeTerm: t("borrow.fee", "Fee"),
          backLabel: t("barter.back", "Back"), sendLabel: t("common.sign_send", "Sign & Send"),
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
  /* settleHalf: op-17 general force-settle half beside the issue/reserve
   * halves. WHY its own half: settle is signed and paid by the HOLDER (an
   * explicit acting account, never the issuer default of half()), takes the
   * amount at the BITASSET precision, and is chain-valid only on
   * market-issued assets (client-blocked with not-market-issued, same code
   * as the reserve MPA gate). Builder call mirrors prediction-flows.js
   * settleReview (buildSettle + live AssetOps.fee); proof is the supply
   * delta (settled units burn), same BigInt shape as half().
   * @param {Document} d host document
   * @param {HTMLElement} v wrap to append the form to
   * @param {HTMLElement} root route root (wiped at review time)
   * @param {number} g generation guard for this render
   * @returns {void} */
  function settleHalf(d, v, root, g) {
    v.appendChild(el(d, "h2", t("account.op_asset_settle", "Asset settle") + " (op 17)"));
    var s = Forms.labeledInput(d, t("explorer.th_symbol", "Symbol") + " ", { value: "", placeholder: "AFKTEST01", autocomplete: "off" });
    var who = Forms.labeledInput(d, t("asset.acting_field", "Acting account (name or 1.2.N)") + " ", { value: (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0", autocomplete: "off" });
    var a = Forms.labeledInput(d, t("asset.amount_field", "Amount (human)") + " ", { value: "1", inputmode: "decimal", autocomplete: "off" });
    v.appendChild(s.row); v.appendChild(who.row); v.appendChild(a.row);
    var r = touch(el(d, "button", t("prediction.settle", "Settle"))); r.type = "button"; v.appendChild(r);
    r.addEventListener("click", function () { r.disabled = true;
      (async function () {
        var sym = s.input.value.trim().toUpperCase();
        var info = await Asset.describe(sym);
        if (!info.is_smartcoin) throw new Error("not-market-issued");
        var raw = Format.parseAmount(a.input.value, info.precision);
        if (!/[1-9]/.test(raw)) throw new Error(t("transfer.amount_positive", "Amount must be greater than zero."));
        var me = await Account.resolve(who.input.value.trim() || ((typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0"));
        var pair = AssetOps.buildSettle({ accountId: me.id, assetId: info.id, amountHuman: a.input.value, precision: info.precision });
        var f = await AssetOps.fee(pair, CORE); pair[1].fee = { amount: f.amount, asset_id: f.asset_id };
        var before = info.supply_raw;
        if (g !== gen) return; wipe(root); var w2 = wrap(d, root), pp = await feePrec(f.asset_id);
        var rows = [[t("asset_ops.title", "Asset"), info.symbol + " (" + info.id + ")"],
          [t("borrow.account", "Account"), me.name + " (" + me.id + ")"],
          [t("confirm.amount", "Amount"), Format.formatAmount(raw, info.precision) + " " + info.symbol, raw]];
        rows.push([t("borrow.network", "Network"), netName()]);
        var settleFee;
        try { settleFee = Format.formatAmount(String(f.amount), pp) + " (core)"; }
        catch (feeErr5) { settleFee = String(f.amount) + " (core)"; }
        var settleDlg = ConfirmDialog.show({ title: t("prediction.confirm_settle", "Confirm settle"),
          rows: rows, feeHuman: settleFee, feeTerm: t("borrow.fee", "Fee"),
          backLabel: t("barter.back", "Back"), sendLabel: t("common.sign_send", "Sign & Send"),
          onBack: function () { renderIssue(root); },
          onSend: function () {
            var btns = settleDlg.getElementsByTagName("button");
            var backB = btns[0], sendB = btns[1];
            backB.disabled = true; sendB.disabled = true;
            var st = status(d, w2, "Signing…");
            publish(root, d, g, pair, async function () {
              try { var n = await Asset.describe(sym); if (before === null) return n;
                var have = BigInt(n.supply_raw || "0"), was = BigInt(before), want = BigInt(raw);
                return (was - have === want) ? n : null;
              } catch (e) { return null; } },
              t("prediction.settle_broadcast", "Settle broadcast."),
              Format.formatAmount(raw, info.precision) + " " + info.symbol + " settled by " + me.name + ".",
              "#/asset/" + info.symbol, "Open " + info.symbol,
              function (x) { st.textContent = x; }).catch(function (e) {
              try { w2.removeChild(st); } catch (x) { /* gone */ }
              err(d, w2, e, t("createworker.send_failed", "Send failed.")); backB.disabled = false; });
          } });
        w2.appendChild(settleDlg);
      })().catch(function (e) { r.disabled = false; err(d, v, e, t("prediction.could_not_prepare_settle", "Could not prepare the settle.")); }); });
  }
  /* claimFeesHalf: op-43 issuer fee-claim half. WHY the dynamic leg: the
   * claimed counter (accumulated_fees) lives on the dynamic object, which
   * describe() omits — so the form shows the live counter from dynOf() and
   * the proof re-reads it (before - after === claim raw). Only the issuer
   * can claim (client-gated with not-issuer; the chain re-enforces).
   * @param {Document} d host document
   * @param {HTMLElement} v wrap to append the form to
   * @param {HTMLElement} root route root (wiped at review time)
   * @param {number} g generation guard for this render
   * @returns {void} */
  function claimFeesHalf(d, v, root, g) {
    v.appendChild(el(d, "h2", t("account.op_claim_fees", "Claim fees") + " (op 43)"));
    var s = Forms.labeledInput(d, t("explorer.th_symbol", "Symbol") + " ", { value: "", placeholder: "AFKTEST01", autocomplete: "off" });
    var who = Forms.labeledInput(d, t("asset.issuer_field", "Issuer (name or 1.2.N)") + " ", { value: (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0", autocomplete: "off" });
    var a = Forms.labeledInput(d, t("debit.claim_amount_field", "Claim amount (claim only)") + " ", { value: "1", inputmode: "decimal", autocomplete: "off" });
    v.appendChild(s.row); v.appendChild(who.row); v.appendChild(a.row);
    var r = touch(el(d, "button", t("vesting.review_claim", "Review claim"))); r.type = "button"; v.appendChild(r);
    r.addEventListener("click", function () { r.disabled = true;
      (async function () {
        var sym = s.input.value.trim().toUpperCase();
        var info = await Asset.describe(sym);
        var raw = Format.parseAmount(a.input.value, info.precision);
        if (!/[1-9]/.test(raw)) throw new Error(t("transfer.amount_positive", "Amount must be greater than zero."));
        var me = await Account.resolve(who.input.value.trim() || ((typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0"));
        if (me.id !== info.issuer_id) throw new Error("not-issuer");
        var beforeDyn = await dynOf(sym);
        var before = (beforeDyn.dyn.accumulated_fees !== undefined && beforeDyn.dyn.accumulated_fees !== null) ? String(beforeDyn.dyn.accumulated_fees) : null;
        var pair = AssetOps.buildClaimFees({ issuerId: me.id, assetId: info.id, amountHuman: a.input.value, precision: info.precision, claimFromAssetIdOrNull: null });
        var f = await AssetOps.fee(pair, CORE); pair[1].fee = { amount: f.amount, asset_id: f.asset_id };
        if (g !== gen) return; wipe(root); var w2 = wrap(d, root), pp = await feePrec(f.asset_id);
        var amtHuman = Format.formatAmount(raw, info.precision) + " " + info.symbol;
        var rows = [[t("asset_ops.title", "Asset"), info.symbol + " (" + info.id + ")"],
          [t("explorer.issuer_row", "Issuer"), me.name + " (" + me.id + ")"],
          [t("confirm.amount", "Amount"), amtHuman, raw]];
        if (before !== null) {
          var beforeHuman = before;
          try { beforeHuman = Format.formatAmount(before, info.precision) + " " + info.symbol; }
          catch (e) { beforeHuman = before; }
          rows.push([t("explorer.accumulated_fees", "Accumulated fees"), beforeHuman, before]);
        }
        rows.push([t("borrow.network", "Network"), netName()]);
        var claimFee;
        try { claimFee = Format.formatAmount(String(f.amount), pp) + " (core)"; }
        catch (feeErr6) { claimFee = String(f.amount) + " (core)"; }
        var claimDlg = ConfirmDialog.show({ title: t("debit.confirm_claim", "Confirm claim"),
          rows: rows, feeHuman: claimFee, feeTerm: t("borrow.fee", "Fee"),
          backLabel: t("barter.back", "Back"), sendLabel: t("common.sign_send", "Sign & Send"),
          onBack: function () { renderIssue(root); },
          onSend: function () {
            var btns = claimDlg.getElementsByTagName("button");
            var backB = btns[0], sendB = btns[1];
            backB.disabled = true; sendB.disabled = true;
            var st = status(d, w2, "Signing…");
            publish(root, d, g, pair, async function () {
              try { var n = await dynOf(sym); if (before === null) return n;
                var have = BigInt(String(n.dyn.accumulated_fees)), was = BigInt(before), want = BigInt(raw);
                return (was - have === want) ? n : null;
              } catch (e) { return null; } },
              t("account.sum_claim_fees", "Claimed %(amount)s in fees", { amount: amtHuman }),
              info.symbol + " fee claim re-read matches the dynamic counter.",
              "#/asset/" + info.symbol, "Open " + info.symbol,
              function (x) { st.textContent = x; }).catch(function (e) {
              try { w2.removeChild(st); } catch (x) { /* gone */ }
              err(d, w2, e, t("createworker.send_failed", "Send failed.")); backB.disabled = false; });
          } });
        w2.appendChild(claimDlg);
      })().catch(function (e) { r.disabled = false; err(d, v, e, t("debit.claim_failed", "Could not prepare the claim.")); }); });
  }
  /* claimPoolHalf: op-47 issuer fee-pool drain half. WHY core units: the
   * pool holds CORE (asset_object.hpp:65), so the amount parses at the CORE
   * precision, not the pool asset's — and the fee must ride an asset OTHER
   * than the pool asset (chain rule; core works whenever the pool asset is
   * a UIA, per the builder header). Proof is the fee_pool delta via dynOf().
   * @param {Document} d host document
   * @param {HTMLElement} v wrap to append the form to
   * @param {HTMLElement} root route root (wiped at review time)
   * @param {number} g generation guard for this render
   * @returns {void} */
  function claimPoolHalf(d, v, root, g) {
    v.appendChild(el(d, "h2", t("account.op_claim_pool", "Claim pool") + " (op 47)"));
    var s = Forms.labeledInput(d, t("explorer.th_symbol", "Symbol") + " ", { value: "", placeholder: "AFKTEST01", autocomplete: "off" });
    var who = Forms.labeledInput(d, t("asset.issuer_field", "Issuer (name or 1.2.N)") + " ", { value: (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0", autocomplete: "off" });
    var a = Forms.labeledInput(d, t("asset.amount_field", "Amount (human)") + " ", { value: "1", inputmode: "decimal", autocomplete: "off" });
    v.appendChild(s.row); v.appendChild(who.row); v.appendChild(a.row);
    var r = touch(el(d, "button", t("vesting.review_claim", "Review claim"))); r.type = "button"; v.appendChild(r);
    r.addEventListener("click", function () { r.disabled = true;
      (async function () {
        var sym = s.input.value.trim().toUpperCase();
        var info = await Asset.describe(sym);
        var coreP = await feePrec(CORE);
        var raw = Format.parseAmount(a.input.value, coreP);
        if (!/[1-9]/.test(raw)) throw new Error(t("transfer.amount_positive", "Amount must be greater than zero."));
        var me = await Account.resolve(who.input.value.trim() || ((typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0"));
        if (me.id !== info.issuer_id) throw new Error("not-issuer");
        var beforeDyn = await dynOf(sym);
        var before = (beforeDyn.dyn.fee_pool !== undefined && beforeDyn.dyn.fee_pool !== null) ? String(beforeDyn.dyn.fee_pool) : null;
        var pair = AssetOps.buildClaimPool({ issuerId: me.id, assetId: info.id, amountHuman: a.input.value, corePrecision: coreP });
        var f = await AssetOps.fee(pair, CORE); pair[1].fee = { amount: f.amount, asset_id: f.asset_id };
        if (g !== gen) return; wipe(root); var w2 = wrap(d, root), pp = await feePrec(f.asset_id);
        var amtHuman = Format.formatAmount(raw, coreP) + " (core)";
        var rows = [[t("asset_ops.title", "Asset"), info.symbol + " (" + info.id + ")"],
          [t("explorer.issuer_row", "Issuer"), me.name + " (" + me.id + ")"],
          [t("confirm.amount", "Amount"), amtHuman, raw]];
        if (before !== null) {
          var beforeHuman = before;
          try { beforeHuman = Format.formatAmount(before, coreP) + " (core)"; }
          catch (e) { beforeHuman = before; }
          rows.push([t("explorer.fee_pool", "Fee pool"), beforeHuman, before]);
        }
        rows.push([t("borrow.network", "Network"), netName()]);
        var poolFee;
        try { poolFee = Format.formatAmount(String(f.amount), pp) + " (core)"; }
        catch (feeErr7) { poolFee = String(f.amount) + " (core)"; }
        var poolDlg = ConfirmDialog.show({ title: t("debit.confirm_claim", "Confirm claim"),
          rows: rows, feeHuman: poolFee, feeTerm: t("borrow.fee", "Fee"),
          backLabel: t("barter.back", "Back"), sendLabel: t("common.sign_send", "Sign & Send"),
          onBack: function () { renderIssue(root); },
          onSend: function () {
            var btns = poolDlg.getElementsByTagName("button");
            var backB = btns[0], sendB = btns[1];
            backB.disabled = true; sendB.disabled = true;
            var st = status(d, w2, "Signing…");
            publish(root, d, g, pair, async function () {
              try { var n = await dynOf(sym); if (before === null) return n;
                var have = BigInt(String(n.dyn.fee_pool)), was = BigInt(before), want = BigInt(raw);
                return (was - have === want) ? n : null;
              } catch (e) { return null; } },
              t("account.op_claim_pool", "Claim pool"),
              amtHuman + " claimed from the " + info.symbol + " fee pool (re-read delta matches).",
              "#/asset/" + info.symbol, "Open " + info.symbol,
              function (x) { st.textContent = x; }).catch(function (e) {
              try { w2.removeChild(st); } catch (x) { /* gone */ }
              err(d, w2, e, t("createworker.send_failed", "Send failed.")); backB.disabled = false; });
          } });
        w2.appendChild(poolDlg);
      })().catch(function (e) { r.disabled = false; err(d, v, e, t("debit.claim_failed", "Could not prepare the claim.")); }); });
  }
  /* updateIssuerHalf: op-48 hand-the-asset-to-a-new-issuer half. WHY a
   * separate op from the op-11 new-issuer box above: op-48 carries ONLY the
   * handover (no options payload) and demands the OWNER key — passing the
   * active wif builds valid bytes the chain rejects with an authority error
   * (builder header). The notice names the gate up front; the proof re-reads
   * the issuer (no supply or counter moves on a handover).
   * @param {Document} d host document
   * @param {HTMLElement} v wrap to append the form to
   * @param {HTMLElement} root route root (wiped at review time)
   * @param {number} g generation guard for this render
   * @returns {void} */
  function updateIssuerHalf(d, v, root, g) {
    v.appendChild(el(d, "h2", t("account.op_issuer_update", "Issuer update") + " (op 48)"));
    /* WHY owner_key_note (not only_issuer): op-48 demands the OWNER active key
     * (active-wif bytes get an authority reject — builder header), so the gate
     * names the key, not just the role. */
    v.appendChild(el(d, "p", t("asset.owner_key_note", "Requires the asset owner's active key."), "muted"));
    var s = Forms.labeledInput(d, t("explorer.th_symbol", "Symbol") + " ", { value: "", placeholder: "AFKTEST01", autocomplete: "off" });
    var who = Forms.labeledInput(d, t("asset.acting_field", "Acting account (name or 1.2.N)") + " ", { value: (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0", autocomplete: "off" });
    var nu = Forms.labeledInput(d, t("asset.new_issuer_field", "New issuer"), { value: "", autocomplete: "off" });
    v.appendChild(s.row); v.appendChild(who.row); v.appendChild(nu.row);
    var r = touch(el(d, "button", t("credit.review_update", "Review update"))); r.type = "button"; v.appendChild(r);
    r.addEventListener("click", function () { r.disabled = true;
      (async function () {
        var sym = s.input.value.trim().toUpperCase();
        var info = await Asset.describe(sym);
        var me = await Account.resolve(who.input.value.trim() || ((typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0"));
        if (me.id !== info.issuer_id) throw new Error("not-issuer");
        var to = await Account.resolve(nu.input.value.trim());
        var pair = AssetOps.buildUpdateIssuer({ issuerId: me.id, assetId: info.id, newIssuerId: to.id });
        var f = await AssetOps.fee(pair, CORE); pair[1].fee = { amount: f.amount, asset_id: f.asset_id };
        if (g !== gen) return; wipe(root); var w2 = wrap(d, root), pp = await feePrec(f.asset_id);
        var rows = [[t("asset_ops.title", "Asset"), info.symbol + " (" + info.id + ")"],
          [t("explorer.issuer_row", "Issuer"), (info.issuer_name || info.issuer_id) + " → " + to.name + " (" + to.id + ")"]];
        rows.push([t("borrow.network", "Network"), netName()]);
        var issuerFee;
        try { issuerFee = Format.formatAmount(String(f.amount), pp) + " (core)"; }
        catch (feeErr8) { issuerFee = String(f.amount) + " (core)"; }
        var issuerDlg = ConfirmDialog.show({ title: t("asset.confirm_update", "Confirm asset update"),
          rows: rows, feeHuman: issuerFee, feeTerm: t("borrow.fee", "Fee"),
          backLabel: t("barter.back", "Back"), sendLabel: t("common.sign_send", "Sign & Send"),
          onBack: function () { renderIssue(root); },
          onSend: function () {
            var btns = issuerDlg.getElementsByTagName("button");
            var backB = btns[0], sendB = btns[1];
            backB.disabled = true; sendB.disabled = true;
            var st = status(d, w2, "Signing…");
            publish(root, d, g, pair, async function () {
              try { var n = await Asset.describe(sym);
                return (n && n.issuer_id === to.id) ? n : null;
              } catch (e) { return null; } },
              t("account.sum_issuer_update", "New issuer for %(asset)s: %(issuer)s", { asset: info.symbol, issuer: to.name + " (" + to.id + ")" }),
              info.symbol + " issuer handover re-read matches " + to.name + ".",
              "#/asset/" + info.symbol, "Open " + info.symbol,
              function (x) { st.textContent = x; }).catch(function (e) {
              try { w2.removeChild(st); } catch (x) { /* gone */ }
              err(d, w2, e, t("createworker.send_failed", "Send failed.")); backB.disabled = false; });
          } });
        w2.appendChild(issuerDlg);
      })().catch(function (e) { r.disabled = false; err(d, v, e, t("credit.could_not_prepare_the_update", "Could not prepare the update.")); }); });
  }
  /* renderIssue: op-14 issue (+memo) + op-15 reserve + op-17 settle +
   * op-43 claim-fees + op-47 claim-pool + op-48 update-issuer halves.
   * PUBLIC preview renders LOCKED (gate-repair); Sign & Send gates in
   * publish() via fresh WIF. */
  function renderIssue(root) {
    if (!root) return;
    var d = root.ownerDocument || document, g = ++gen;
    wipe(root); var v = wrap(d, root);
    if (noBackend()) { err(d, v,t("asset.backend_missing", "Asset backend missing.")); return; }
    if (cold(d, v, root, function () { renderIssue(root); })) return;
    /* No entry unlock gate: reads/preview are public; signing gates in publish(). */
    v.appendChild(DOM.pageHead(d, t("asset.issue_title", "Issue / reserve"), "assets"));
    try {
      if (typeof Wallet === "undefined" || !Wallet.isUnlocked()) {
        var _v3 = (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.get === "function") ? ViewingAs.get() : { id: "1.2.0", name: "committee-account" };
        v.appendChild(el(d, "p", t("viewing.notice_locked", "Viewing as %(name)s (%(id)s) — unlock to act as yourself.", { name: _v3.name, id: _v3.id }), "muted"));
      }
    } catch (e) { /* notice is display-only */ }
    half(d, v, root, g, t("asset.issue_op14_title", "Issue to account (op 14)"), t("asset.review_issue", "Review issue"), false);
    half(d, v, root, g, t("asset.reserve_op15_title", "Reserve / burn back (op 15)"), t("asset.review_reserve", "Review reserve"), true);
    settleHalf(d, v, root, g);
    claimFeesHalf(d, v, root, g);
    claimPoolHalf(d, v, root, g);
    updateIssuerHalf(d, v, root, g);
  }
  return { renderUpdate: renderUpdate, renderIssue: renderIssue };
})();
if (typeof globalThis !== "undefined" && typeof globalThis.AssetManageUI === "undefined") { globalThis.AssetManageUI = AssetManageUI; }
if (typeof module !== "undefined") { module.exports = AssetManageUI; }
