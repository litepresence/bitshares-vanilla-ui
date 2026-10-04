/* htlc-ui.js — #/htlc + #/htlc/:id views + shared _ui helpers for debit-ui.js.
 * Owns: HTLC sent/received tables, create form (type-preimage or paste-hash),
 * detail panel, redeem form (live hash-match), extend form, NAMED-row confirms.
 * Consumes: Htlc (reads/builders/fee/sendAndProve/formatters), Tx (buildTx),
 * Format, Account, Asset, Wallet (unlock + memory WIF), Chain, Store (WIFs stay JS values).
 * Created by: building-vanilla-slices skill, slice-11-htlc plan Task 3 (generation counter drops stale work).
 * PUBLIC-FIRST (gate repair): routeReady never gates on unlock — tables/detail/
 * create-preview render locked under committee-account 1.2.0 with a viewing
 * notice (pool-ui.js precedent). Password is asked only at Sign & Send
 * (sendConfirm sign-time gate + inline unlock); reviews stay read-only.
 * CHAIN TRUTH (#4 wins): op 49 create / 50 redeem / 52 extend (protocol/
 * htlc.hpp); 51/53 VIRTUAL, never dispatched. Secrecy: HASH ONLY on screen;
 * plaintext lives only in the redeem password input; create clears secrets.
 */
var HtlcUI = (function () {
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
  var gen = 0;
  var PRESETS = [["1 hour", 3600], ["12 hours", 43200], ["1 day", 86400], ["7 days", 604800], ["30 days", 2592000]];
  /* No local el — use DOM.el */
/* touch floor: >=44px one dim */
  /* clearBox removed — use DOM.clear */
  function shortHash(hex) { hex = String(hex || ""); return hex.length > 18 ? hex.slice(0, 12) + "…" + hex.slice(-6) : hex; }
  function showError(doc, wrap, e, fallback) { /* any throw -> text, never blank */
    var m = (e && typeof e.message === "string" && e.message) ? e.message : String(e || fallback || t("common.unexpected_error", "Unexpected error"));
    var map = [["not-connected", t("common.network_unavailable", "Network unavailable. Check Settings → Nodes and retry.")], ["wallet-locked", t("common.wallet_locked", "Wallet is locked.")],
      ["unknown-htlc", t("htlc.unknown_contract", "Unknown HTLC contract.")], ["unknown-account", t("htlc.unknown_account", "Account not found.")],
      ["hash-mismatch", t("htlc.hash_mismatch", "Preimage does not match the locked hash.")], ["bad-preimage", t("htlc.enter_preimage", "Enter a non-empty preimage.")]], i;
    if (m.indexOf("not connected") !== -1) m = map[0][1];
    for (i = 0; i < map.length; i++) if (m.indexOf(map[i][0]) !== -1) { m = map[i][1]; break; }
    var err = DOM.error(wrap, m); return err;
  }
  /* Status line (aria-live, muted): progress text so panels never sit blank. Params: doc, wrap (appended to), text. Returns: the p. */
  function showStatus(doc, wrap, text) {
    var p = DOM.status(wrap, text); return p;
  }
  function offlineBox(doc, wrap, retryFn) { /* Offline panel: copy depends on
    * actual connection (unknown-id failures while connected must not claim
    * the network is down). Retry handshakes via the shared Offline helper
    * (js/api/offline.js); Open Settings links to #/settings for failover. */
    var open = (typeof Chain !== "undefined" && Chain && Chain.status && Chain.status().state === "open");
    wrap.appendChild(DOM.el(doc, "p", open
      ? t("htlc.retry_load", "Retry loading.")
      : t("common.network_unavailable", "Network unavailable. Check Settings → Nodes and retry."), "muted"));
    var status = DOM.el(doc, "p", "", "muted");
    try { status.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
    wrap.appendChild(status);
    var row = DOM.el(doc, "div", null, "pools-offline-row");
    wrap.appendChild(row);
    var b = touchable(DOM.el(doc, "button", t("fees.retry", "Retry"))); b.type = "button";
    row.appendChild(b);
    var off = null;
    try { off = (typeof Offline !== "undefined" && Offline) ? Offline : null; } catch (e) { off = null; }
    if (off && typeof off.wire === "function") {
      try { off.wire(b, status, retryFn, t); } catch (e) { b.addEventListener("click", retryFn); }
    } else {
      b.addEventListener("click", retryFn);
    }
    var link = null;
    if (off && typeof off.settingsLink === "function") {
      try { link = off.settingsLink(doc, t); } catch (e) { link = null; }
    }
    if (!link) {
      link = DOM.el(doc, "a", t("notice.open_settings", "Open Settings"));
      try { link.setAttribute("href", "#/settings"); } catch (e) { /* label stands */ }
      touchable(link);
    }
    row.appendChild(link);
  }
  /* Default viewing account while locked: committee-account 1.2.0 (a public
   * chain object on testnet+mainnet, verified live 2026-09-28). Reads stay
   * public under it; writes gate at Sign & Send (sendConfirm). Never throws
   * — locked render is normal. */
  var VIEWING_AS_ID = "1.2.0", VIEWING_AS_NAME = "committee-account";
  function isUnlockedNow() {
    try {
      if (typeof Wallet !== "undefined" && typeof Wallet.isUnlocked === "function") return !!Wallet.isUnlocked();
      return !!(typeof Wallet !== "undefined" && Wallet.keys);
    } catch (e) { return false; }
  }
  function viewingAsNotice(doc) {
    var v = (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.get === "function") ? ViewingAs.get() : { id: "1.2.0", name: "committee-account" };
    return DOM.el(doc, "p", t("viewing.notice_locked", "Viewing as %(name)s (%(id)s) — unlock to act as yourself.", { name: v.name, id: v.id }), "muted");
  }
  function signNotice(doc) {
    return DOM.el(doc, "p", t("barter.locked_preview_note", "Wallet locked — preview only. Password is asked at Sign & Send, never to view."), "muted");
  }
  function unlockInline(doc, parent, onUnlock) { /* in-place password row (no route re-render, so previews survive) */
    if (parent.querySelector && parent.querySelector(".xfer-unlock-row")) return;
    var row = DOM.el(doc, "div", null, "xfer-field xfer-unlock-row");
    var inp = doc.createElement("input");
    inp.type = "password"; inp.setAttribute("autocomplete", "current-password");
    inp.setAttribute("placeholder", t("barter.password", "password")); inp.setAttribute("aria-label", t("htlc.password_ph", "Password"));
    touchable(inp); row.appendChild(inp);
    var b = touchable(DOM.el(doc, "button", t("account.s6", "Unlock"))); b.type = "button"; row.appendChild(b);
    parent.appendChild(row);
    b.addEventListener("click", function () { b.disabled = true;
      /* H2: wipe the password local + input on either outcome. */
      var pw = inp.value;
      Wallet.unlock(pw).then(function () { inp.value = ""; pw = null; if (onUnlock) onUnlock(); })
        .catch(function (e) { inp.value = ""; pw = null; b.disabled = false; showError(doc, parent,e,t("barter.unlock_failed", "Unlock failed.")); });
    });
  }
  function missingBackends() { /* first missing backend id, or null */
    var need = ["Htlc", "Tx", "Account", "Wallet", "Format", "Asset", "Chain", "Store"], miss = null;
    need.forEach(function (g) { if (typeof globalThis[g] === "undefined") miss = g; });
    return miss;
  }
  var openSubs = []; /* pending connect watchers; drained on every entry so none leak */
  function dropOpenSubs() { openSubs.forEach(function (off) { try { off(); } catch (e) {} }); openSubs = []; }
  function autoRetryOnOpen(myGen, retryFn, isLive) { /* re-run entry when the socket opens (vote pattern); stale gens bail.
    isLive defaults to this module's gen check; cross-file callers (debit-ui owns its own gen) pass their own. */
    try {
      var live = isLive || function () { return myGen === gen; };
      var hashAtEntry = (typeof location !== "undefined" && location.hash) || "";
      var settled = false;
      var off = Store.subscribe("connection", function (st) {
        if (settled) return;
        if (!live()) { settled = true; try { off(); } catch (e) {} return; }
        if (st && st.state === "open") {
          settled = true; try { off(); } catch (e) {}
          if (typeof location === "undefined" || location.hash === hashAtEntry) retryFn();
        }
      });
      openSubs.push(off);
    } catch (e) { /* subscribe unavailable: manual Retry remains */ }
  }
  function routeReady(root, title, retry) { /* preamble (backends/offline); null = gate painted.
    PUBLIC-FIRST: no wallet gate here — lists/details/previews render locked. */
    var doc = root.ownerDocument || document, myGen = ++gen, miss = missingBackends();
    dropOpenSubs();
    DOM.clear(root);
    var wrap = DOM.el(doc, "div", null, "wrap"); root.appendChild(wrap);
    wrap.appendChild(DOM.pageHead(doc, title, "htlc"));
    if (miss) { showError(doc, wrap, title + " backend missing: " + miss + " failed to load."); return null; }
    if (Chain.status().state !== "open") { offlineBox(doc, wrap, retry); autoRetryOnOpen(myGen, retry); try { if (typeof Offline !== "undefined" && Offline && typeof Offline.ensure === "function") Offline.ensure(); } catch (e) { /* manual Retry remains */ } return null; }
    return { doc: doc, wrap: wrap, myGen: myGen };
  }
  function routeFail(root, title, e, fallback, retry) { /* shared load-failure page */
    DOM.clear(root);
    var doc = root.ownerDocument || document, failed = DOM.el(doc, "div", null, "wrap");
    root.appendChild(failed); failed.appendChild(DOM.pageHead(doc, title, "htlc"));
    showError(doc, failed, e, fallback); offlineBox(doc, failed, retry);
  }
  function loadAccount(myGen, loader) { /* wallet account when unlocked, else committee-account 1.2.0; stale gens bail */
    return Account.myAccountId().catch(function () { return (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0"; })
      .then(function (id) { return Account.resolve(id); }).then(function (me) {
      if (myGen !== gen) return null;
      return loader(me).then(function (data) { return { me: me, data: data }; }); });
  }
  function confirmList(doc, rows) { /* NAMED rows: human term + raw in title, never raw-only */
    var list = DOM.el(doc, "dl", null, "xfer-confirm");
    rows.forEach(function (r) {
      list.appendChild(DOM.el(doc, "dt", r[0]));
      var dd = DOM.el(doc, "dd", r[1]); if (r[2]) dd.title = r[2]; list.appendChild(dd);
    });
    return list;
  }
  /* Labeled touch-sized input row via the shared Forms seam (Task 2.2):
   * identical contract — div.xfer-field > label(text + " ") > input. */
  function field(doc, labelText, opts) {
    opts = opts || {};
    return Forms.labeledInput(doc, labelText + " ", {
      type: opts.type, value: opts.value,
      placeholder: opts.placeholder, inputmode: opts.inputmode });
  }
  function selectOpts(doc, sel, pairs) { /* [[value, title]] -> options */
    pairs.forEach(function (p) {
      var o = doc.createElement("option"); o.value = p[0]; o.textContent = p[1]; sel.appendChild(o);
    });
    return sel;
  }
  function secsPicker(doc, pairs, labelText) { /* preset + custom seconds; returns {row, secs()} */
    var sel = selectOpts(doc, touchable(doc.createElement("select")), pairs);
    var customOpt = doc.createElement("option"); customOpt.value = "custom"; customOpt.textContent = t("htlc.s1", "Custom…");
    sel.appendChild(customOpt);
    var custom = doc.createElement("input");
    custom.setAttribute("placeholder", t("vesting.seconds", "seconds")); custom.setAttribute("inputmode", "numeric");
    touchable(custom); custom.style.display = "none"; var row = DOM.el(doc, "div", null, "xfer-field");
    row.appendChild(DOM.el(doc, "span", labelText + ": ")); row.appendChild(sel); row.appendChild(custom);
    sel.addEventListener("change", function () { custom.style.display = sel.value === "custom" ? "" : "none"; });
    return { row: row, sel: sel, custom: custom, secs: function () {
      return sel.value === "custom" ? parseInt(String(custom.value).trim(), 10) : parseInt(sel.value, 10);
    } };
  }
  function tableHead(doc, titles) { /* shared thead builder */
    var hr = doc.createElement("tr");
    titles.forEach(function (t) { hr.appendChild(DOM.el(doc, "th", t)); });
    var thead = doc.createElement("thead"); thead.appendChild(hr); return thead;
  }
  async function feeText(fee) { /* fee -> human + raw (lookup failure falls back to raw) */
    try {
      var a = await Asset.describe(fee.asset_id);
      return { text: Format.formatAmount(fee.amount, a.precision) + " " + a.symbol, raw: String(fee.amount) };
    } catch (e) { return { text: String(fee.amount) + " (" + fee.asset_id + ")", raw: String(fee.amount) }; }
  }
  async function headBlock() { /* head # for result panels (observation marker, never a txid) */
    return (await Chain.call(await Chain.db(), "get_dynamic_global_properties", [])).head_block_number || 0;
  }
  function amtText(raw, assetId, prec) { /* raw int -> human + raw title (unknown prec stays honest) */
    if (typeof prec === "number" && /^\d+$/.test(String(raw))) {
      return { text: Format.formatAmount(String(raw), prec), raw: String(raw) };
    }
    return { text: String(raw) + " (" + assetId + ")", raw: String(raw) };
  }
  /* Confirm + publish through the shared ConfirmDialog (ui/confirm.js):
   * title + named rows render as div.confirm-dialog (h3 + dl.confirm with
   * Back carrying btn-ghost + Sign & Send in div.confirm-actions).
   * confirmList above stays for the read-only detail panel. The sign-time
   * gate (password asked only here, preview stays visible), fresh-WIF
   * sendAndProve, re-read proof, head-block result, and secret-field
   * clearing (cfg.clear) below are unchanged. */
  function sendConfirm(doc, out, cfg, myGen) { /* confirm + publish: fresh-WIF sign, re-read proof, result */
    DOM.clear(out);
    var dlg = ConfirmDialog.show({ title: cfg.title, rows: cfg.rows || [],
      backLabel: t("barter.back", "Back"), sendLabel: t("common.sign_send", "Sign & Send"),
      onBack: function () { DOM.clear(out); },
      onSend: function () {
        if (myGen !== gen) return;
        var btns = dlg.getElementsByTagName("button");
        var backB = btns[0], sendB = btns[1];
        sendB.disabled = true; backB.disabled = true;
        var status = showStatus(doc, out, "Signing…");
        var wif = Wallet.keys && Wallet.keys.active ? Wallet.keys.active.wif : null;
        if (!wif) { /* SIGN-TIME GATE: password asked only here — preview stays visible */
          out.removeChild(status);
          if (!out.querySelector || !out.querySelector(".xfer-sign-note"))
            out.appendChild(DOM.el(doc, "p", t("barter.locked_sign_note", "Wallet is locked — unlock to sign. The preview above stays visible; password is asked only here, at signing."), "muted")).className = "muted xfer-sign-note";
          unlockInline(doc, out, function () {
            out.appendChild(DOM.el(doc, "p", t("borrow.unlocked_rereview_note", "Unlocked — press Back and re-run Review so the transaction uses your account."), "muted"));
          });
          sendB.disabled = false; backB.disabled = false; return; }
        Promise.resolve().then(cfg.makeUnsigned).then(function (unsigned) {
          status.textContent = t("common.status_broadcasting", "Broadcasting…");
          return Htlc.sendAndProve(unsigned, wif, cfg.prove);
        }).then(async function (res) {
          if (myGen !== gen) return;
          DOM.clear(out);
          out.appendChild(DOM.el(doc, "p", cfg.okText, "xfer-ok"));
          out.appendChild(DOM.el(doc, "p", "Observed at head block #" + String(await headBlock()) + " (" + res.via + ").", "muted"));
          (cfg.clear || []).forEach(function (inp) { inp.value = ""; }); /* secrecy: drop secret fields */
        }).catch(function (e) {
          if (myGen !== gen) return;
          out.removeChild(status);
          showError(doc, out,e,t("common.failed_check_state", "Failed. Check state before retrying (do NOT blindly rebroadcast).")); sendB.disabled = false; backB.disabled = false;
        });
      } });
    /* Principle #6 (raw in title): rows carry native r[2] raw titles
     * (ConfirmDialog.show sets dd.title); no post-show restore needed. */
    out.appendChild(dlg);
  }
  /** review: build {pair,fee,prove} + live fee -> rows -> sendConfirm.
   * TYPE NOTE: the cfg.build promise resolves {pair, fee, prove} but tsc
   * reads the chain as Promise<void>; member casts pin each field to any.
   * No shared types.js yet (group 1 owns it); local casts only.
   * @param {Document} doc owner document
   * @param {HTMLElement} out output box (cleared + rebuilt)
   * @param {number} myGen route generation (liveness token)
   * @param {any} cfg {build, rows, title, ok, fail, clear?, btn?}
   * @returns {void} */
  function reviewPaid(doc, out, myGen, cfg) {
    DOM.clear(out); if (cfg.btn) cfg.btn.disabled = true;
    showStatus(doc, out,t("account.resolving_fee", "Resolving and estimating fee…"));
    function done() { if (cfg.btn) cfg.btn.disabled = false; }
    Promise.resolve().then(cfg.build).then(function (built) {
      if (myGen !== gen) return done();
      feeText((/** @type {any} */ (built).fee)).then(function (f) {
        if (myGen !== gen) return done();
        sendConfirm(doc, out, { title: cfg.title, rows: cfg.rows(built, f),
          makeUnsigned: function () { return Tx.buildTx([(/** @type {any} */ (built).pair)]); },
          prove: (/** @type {any} */ (built).prove), okText: cfg.ok(built), clear: cfg.clear || [] }, myGen);
        done();
      }).catch(function (e) { if (myGen === gen) { DOM.clear(out); showError(doc, out,e,t("barter.fee_lookup_failed", "Fee lookup failed.")); } done(); });
    }).catch(function (e) {
      if (myGen !== gen) return done();
      DOM.clear(out); showError(doc, out, e, cfg.fail || t("credit.could_not_prepare_the_transaction", "Could not prepare the transaction.")); done();
    });
  }
  function reviewSection(doc, box, myGen, label, cfg) { /* review button + output box + gen-checked wiring */
    var btn = touchable(DOM.el(doc, "button", label)); btn.type = "button"; box.appendChild(btn);
    var out = DOM.el(doc, "div", null, "xfer-out"); box.appendChild(out);
    cfg.btn = btn;
    btn.addEventListener("click", function () { if (myGen === gen) reviewPaid(doc, out, myGen, cfg); });
    return btn;
  }
  /** Route entry: #/htlc — sent + received tables + create form.
   * @param {HTMLElement} root router mount element */
  function renderHtlc(root) {
    if (!root) return;
    var ctx = routeReady(root, t("htlc.list_title", "Hashed Timelock Contracts"), function () { renderHtlc(root); });
    if (!ctx) return;
    var doc = ctx.doc, myGen = ctx.myGen; ctx.wrap.appendChild(DOM.el(doc, "p", t("htlc.loading", "Loading contracts…"), "muted"));
    if (!isUnlockedNow()) ctx.wrap.appendChild(viewingAsNotice(doc));
    loadAccount(myGen, function (me) { return Htlc.mine(me.id); }).then(function (found) {
      if (!found || myGen !== gen) return;
      DOM.clear(root);
      var box = DOM.el(doc, "div", null, "wrap"); root.appendChild(box);
       box.appendChild(DOM.pageHead(doc, t("htlc.list_title", "Hashed Timelock Contracts"), "htlc"));
      if (!isUnlockedNow()) box.appendChild(viewingAsNotice(doc));
      box.appendChild(DOM.el(doc, "p", t("htlc.list_sub", "Locked transfers redeemable with a secret preimage before expiry."), "muted"));
      box.appendChild(DOM.el(doc, "h2", t("htlc.sent_prefix", "Sent (") + found.data.sent.length + t("htlc.sent_received_mid", ") · Received (") + found.data.received.length + ")"));
      box.appendChild(htlcTable(doc, found.data.sent, found.data.received));
      box.appendChild(DOM.el(doc, "h2", t("htlc.new_title", "New HTLC")));
      createBox(doc, box, found.me, myGen);
    }).catch(function (e) {
      if (myGen !== gen) return; routeFail(root, "Hashed Timelock Contracts", e, t("htlc.load_failed", "Could not load contracts."), function () { renderHtlc(root); }); });
  }
  /* Unified contracts table (MED choice documented): a single table with a
   * Direction column ("Sent"/"Received") instead of two separate tables — one
   * filter input covers both sides, and the Sent/Received counts stay in the
   * h2 above so nothing is lost. FROM/TO columns carry the raw 1.2.x ids
   * (honest and filterable; names resolve on the detail page). The filter
   * matches id, from, to, and hash hex case-insensitively; an empty result is
   * an honest note, never blank. Plain literals only for new strings (no new
   * i18n keys per punchlist rules); pre-existing t() keys below are reused.
   * Batch-3 i18n: new strings keyed via t(). */
  function htlcTable(doc, sent, received) {
    var box = DOM.el(doc, "div", null, "htlc-all");
    var filter = doc.createElement("input");
    filter.type = "search";
    filter.setAttribute("placeholder", t("htlc.filter_ph", "Filter by id, account, or hash…"));
    filter.setAttribute("aria-label", t("htlc.filter_aria", "Filter contracts"));
    touchable(filter);
    box.appendChild(filter);
    var table = doc.createElement("table"); table.className = "node-table";
    table.appendChild(tableHead(doc, [t("htlc.contract_col", "Contract"), t("htlc.direction", "Direction"), t("htlc.from", "From"), t("htlc.to", "To"),
      t("confirm.amount", "Amount"), t("htlc.hashlock_col", "Hash lock"), t("proposal.expires", "Expires"), ""]));
    var tbody = doc.createElement("tbody");
    table.appendChild(tbody);
    box.appendChild(table);
    var note = DOM.el(doc, "p", "", "muted");
    note.setAttribute("aria-live", "polite");
    box.appendChild(note);
    var all = (Array.isArray(sent) ? sent : []).map(function (r) { return { r: r, dir: t("htlc.sent", "Sent") }; })
      .concat((Array.isArray(received) ? received : []).map(function (r) { return { r: r, dir: t("htlc.received", "Received") }; }));
    /* paint: repaint the HTLC sent/received table under the search filter q.
     * WHY helper: the filter input and the initial load share this render;
     * empty matches show an honest muted line, never blank. Param q; no return. */
    function paint(q) {
      DOM.clear(tbody);
      if (!all.length) {
        note.textContent = t("htlc.no_contracts", "No contracts.") + t("htlc.create_hint", " Create one from the New HTLC form below — sent and received contracts list here.");
        return;
      }
      var n = 0;
      all.forEach(function (item) {
        var r = item.r;
        var hay = String(r.id || "") + " " + String(r.from_id || "") + " " +
          String(r.to_id || "") + " " + String(r.hash_hex || "");
        if (q && hay.toLowerCase().indexOf(q) === -1) return;
        n++;
        var tr = doc.createElement("tr"), a = amtText(r.amount_raw, r.asset_id, r.precision), exp, link, td;
        var dirTd = DOM.el(doc, "td", item.dir);
        var fromTd = DOM.el(doc, "td", String(r.from_id || "—"));
        fromTd.title = String(r.from_id || "");
        var toTd = DOM.el(doc, "td", String(r.to_id || "—"));
        toTd.title = String(r.to_id || "");
        var ac = DOM.el(doc, "td", a.text); ac.title = t("account.raw_prefix", "raw ") + a.raw;
        var hc = DOM.el(doc, "td", r.algo + " — " + shortHash(r.hash_hex)); hc.title = r.hash_hex;
        try { exp = Htlc.formatDateTime(r.expiration_iso); } catch (e) { exp = String(r.expiration_iso || "unknown"); }
        link = DOM.el(doc, "a", t("credit.open", "Open")); link.setAttribute("href", "#/htlc/" + r.id);
        td = doc.createElement("td"); td.appendChild(link);
        tr.appendChild(DOM.el(doc, "td", r.id)); tr.appendChild(dirTd);
        tr.appendChild(fromTd); tr.appendChild(toTd); tr.appendChild(ac); tr.appendChild(hc);
        tr.appendChild(DOM.el(doc, "td", r.expired ? exp + t("htlc.expired_suffix", " (expired)") : exp)); tr.appendChild(td);
        tbody.appendChild(tr);
      });
      note.textContent = q ? (t("htlc.showing_prefix", "Showing ") + n + t("htlc.of_mid", " of ") + all.length + t("htlc.contracts_suffix", " contracts.")) : "";
    }
    filter.addEventListener("input", function () { paint(filter.value.trim().toLowerCase()); });
    paint("");
    return box;
  }
  function createBox(doc, box, me, myGen) { /* create form; fee RE-READ at review; no preimage echo */
    if (!isUnlockedNow()) box.appendChild(signNotice(doc));
    var fTo = field(doc, t("htlc.to_account", "To account"), { placeholder: t("common.name_or_id_hint", "name or 1.2.N") });
    var fAsset = field(doc, t("asset_ops.title", "Asset"), { value: "BTS" });
    var fAmount = field(doc, t("confirm.amount", "Amount"), { inputmode: "decimal", placeholder: "1.23456" });
    [fTo, fAsset, fAmount].forEach(function (f) { box.appendChild(f.row); });
    var algoSel = selectOpts(doc, touchable(doc.createElement("select")), [["sha256", "sha256"], ["ripemd160", "ripemd160"]]);
    var algoRow = DOM.el(doc, "div", null, "xfer-field");
    algoRow.appendChild(DOM.el(doc, "span", t("htlc.hash_label", "Hash: "))); algoRow.appendChild(algoSel);
    algoRow.appendChild(DOM.el(doc, "span", t("htlc.ripemd_note", " (ripemd160: paste a hash — hashing is sha256-only)"), "muted"));
    box.appendChild(algoRow);
    var modeSel = selectOpts(doc, touchable(doc.createElement("select")), [["type", t("htlc.secret_type", "Type a new preimage")], ["paste", t("htlc.secret_paste", "Paste an existing hash")]]);
    var modeRow = DOM.el(doc, "div", null, "xfer-field");
    modeRow.appendChild(DOM.el(doc, "span", t("htlc.secret_label", "Secret: "))); modeRow.appendChild(modeSel); box.appendChild(modeRow);
    var fSecret = field(doc, t("htlc.preimage_label", "Preimage"), { placeholder: t("htlc.secret_ph", "secret words") });
    var fHash = field(doc, t("htlc.hash_field", "Hash hex"), { placeholder: t("htlc.hash_ph", "hex of the preimage hash") });
    var fSize = field(doc, t("htlc.size_field", "Preimage size (bytes)"), { inputmode: "numeric" });
    box.appendChild(fSecret.row); box.appendChild(fHash.row); box.appendChild(fSize.row);
    var period = secsPicker(doc, PRESETS.map(function (p) { return [String(p[1]), p[0]]; }), t("htlc.locktime_label", "Lock time"));
    box.appendChild(period.row);
    /* Toggle preimage-vs-paste rows for the Secret mode select (type = preimage row; paste = hash + size rows). */
    function syncMode() {
      var paste = modeSel.value === "paste";
      fSecret.row.style.display = paste ? "none" : "";
      fHash.row.style.display = paste ? "" : "none"; fSize.row.style.display = paste ? "" : "none";
    }
    modeSel.addEventListener("change", syncMode); syncMode();
    reviewSection(doc, box, myGen, t("htlc.review_create", "Review HTLC"), {
        build: async function () {
          var to = await Account.resolve(fTo.input.value.trim());
          var asset = await Asset.describe(fAsset.input.value.trim() || "BTS"), paste = modeSel.value === "paste", hashHex;
          var pair = await Htlc.buildCreate({ fromId: me.id, toId: to.id, assetId: asset.id,
            amountHuman: fAmount.input.value.trim(), precision: asset.precision, algo: algoSel.value,
            preimageOrNull: paste ? null : fSecret.input.value,
            hashHexOrNull: paste ? fHash.input.value.trim() : null,
            sizeOrNull: paste ? parseInt(String(fSize.input.value).trim(), 10) : null, claimSeconds: period.secs() });
          hashHex = pair[1].preimage_hash[1];
          return { pair: pair, fee: await Htlc.fee(pair, "1.3.0"), asset: asset, to: to,
            prove: async function () {
              try {
                var lists = await Htlc.mine(me.id);
                return lists.sent.concat(lists.received).find(function (r) { return r.hash_hex === hashHex; }) || null;
              } catch (e) { return null; } } };
        },
        rows: function (R, fee) {
          var opData = R.pair[1], hashPair = opData.preimage_hash, secs = opData.claim_period_seconds, amtHuman, periodHuman,
            algoName = hashPair[0] === 2 ? "sha256" : (hashPair[0] === 0 ? "ripemd160" : "unknown(" + hashPair[0] + ")");
          try { amtHuman = Format.formatAmount(opData.amount.amount, R.asset.precision) + " " + R.asset.symbol; }
          catch (e) { amtHuman = String(opData.amount.amount); }
          try { periodHuman = Htlc.formatDuration(secs) + " (" + secs + " s)"; } catch (e) { periodHuman = secs + " s"; }
          var rows = [[t("confirm.from", "From"),  me.name + " (" + me.id + ")"], [t("confirm.to", "To"),  R.to.name + " (" + R.to.id + ")"],
            [t("confirm.amount", "Amount"),  amtHuman, "raw " + opData.amount.amount], [t("htlc.algo_row", "Hash algorithm"),  algoName],
            [t("htlc.hash_row", "Preimage hash"),  shortHash(hashPair[1]), hashPair[1]], [t("htlc.size_row", "Preimage size"),  opData.preimage_size + " bytes"],
            [t("htlc.period_row", "Claim period"),  periodHuman], [t("borrow.fee", "Fee"),  fee.text, "raw " + fee.raw]];
          if (secs > 86400) rows.push([t("htlc.netnote_row", "Network note"),  "Fee scales per day (fee_per_day)"]);
          rows.push([t("borrow.network", "Network"),  "testnet"]); return rows;
        },
        title: t("htlc.confirm_create", "Confirm HTLC"), ok: function () { return t("htlc.created", "HTLC created."); }, clear: [fSecret.input, fHash.input, fSize.input], fail: t("htlc.create_failed", "Could not prepare the HTLC.") });
  }
  /** Route entry: #/htlc/:id — detail + redeem + extend; unknown id is an empty state.
   * @param {HTMLElement} root router mount element
   * @param {string} id HTLC object id (1.16.x) */
  function renderHtlcDetail(root, id) {
    if (!root) return;
    var retry = function () { renderHtlcDetail(root, id); };
    var ctx = routeReady(root, "HTLC " + String(id || ""), retry);
    if (!ctx) return;
    var doc = ctx.doc, myGen = ctx.myGen;
    if (typeof id !== "string" || !/^1\.16\.\d+$/.test(id)) {
      ctx.wrap.appendChild(DOM.el(doc, "p", t("htlc.unknown_contract", "Unknown HTLC contract."), "muted"));
      var back = DOM.el(doc, "a", t("htlc.back_link", "Back to HTLCs")); back.setAttribute("href", "#/htlc"); ctx.wrap.appendChild(back); return;
    }
    ctx.wrap.appendChild(DOM.el(doc, "p", t("htlc.loading_detail", "Loading contract…"), "muted"));
    if (!isUnlockedNow()) ctx.wrap.appendChild(viewingAsNotice(doc));
    loadAccount(myGen, function () { return Htlc.htlc(id); }).then(function (found) {
      if (!found || myGen !== gen) return;
      var me = found.me, row = found.data, a = amtText(row.amount_raw, row.asset_id, row.precision), exp;
      DOM.clear(root);
      var box = DOM.el(doc, "div", null, "wrap"); root.appendChild(box);
       box.appendChild(DOM.pageHead(doc, "HTLC " + row.id, "htlc"));
      if (!isUnlockedNow()) box.appendChild(viewingAsNotice(doc));
      try { exp = Htlc.formatDateTime(row.expiration_iso); } catch (e) { exp = String(row.expiration_iso || "unknown"); }
      box.appendChild(confirmList(doc, [[t("htlc.contract_col", "Contract"),  row.id], [t("confirm.from", "From"),  row.from_id], [t("confirm.to", "To"),  row.to_id],
        [t("confirm.amount", "Amount"),  a.text, "raw " + a.raw], [t("htlc.algo_row", "Hash algorithm"),  row.algo], [t("htlc.hash_row", "Preimage hash"),  row.hash_hex],
        [t("htlc.size_row", "Preimage size"),  String(row.preimage_size) + " bytes"], [t("proposal.expires", "Expires"),  row.expired ? exp + " (expired)" : exp]]));
      if (row.expired) box.appendChild(DOM.el(doc, "p", t("htlc.expired_note", "Expired: the sender is refunded automatically; no redeem is possible."), "muted"));
      if (me.id === row.to_id && !row.expired) redeemBox(doc, box, me, row, myGen);
      else if (me.id === row.to_id) box.appendChild(DOM.el(doc, "p", t("htlc.receiver_expired_note", "You are the receiver, but this contract expired."), "muted"));
      if (me.id === row.from_id && !row.expired) extendBox(doc, box, me, row, myGen);
      else if (me.id !== row.from_id && me.id !== row.to_id) {
        box.appendChild(DOM.el(doc, "p", t("htlc.readonly_note", "You are neither sender nor receiver: read-only for you."), "muted"));
      }
      var back2 = DOM.el(doc, "a", t("htlc.back_link", "Back to HTLCs")); back2.setAttribute("href", "#/htlc"); box.appendChild(back2);
    }).catch(function (e) {
      if (myGen !== gen) return; routeFail(root, "HTLC " + String(id || ""), e, t("htlc.detail_failed", "Could not load the contract."), retry); });
  }
  function redeemBox(doc, box, me, row, myGen) { /* password input + LIVE hash-match; LENGTH ONLY in confirm */
    box.appendChild(DOM.el(doc, "h2", t("htlc.redeem_title", "Redeem")));
    if (!isUnlockedNow()) box.appendChild(signNotice(doc));
    var typeId = row.algo === "sha256" ? 2 : (row.algo === "ripemd160" ? 0 : -1);
    if (typeId < 0) { box.appendChild(DOM.el(doc, "p", "Unsupported hash (" + row.algo + "): redeem is disabled.", "muted")); return; }
    var inp = doc.createElement("input");
    inp.type = "password"; inp.setAttribute("placeholder", t("htlc.preimage_ph", "preimage")); inp.setAttribute("aria-label", t("htlc.preimage_label", "Preimage"));
    touchable(inp); box.appendChild(inp);
    var match = DOM.el(doc, "p", t("htlc.s4", "Type the preimage to check it against the locked hash."), "muted");
    match.setAttribute("aria-live", "polite"); box.appendChild(match);
    var timer = null, lastOk = "";
    inp.addEventListener("input", function () {
      if (myGen !== gen) return; reviewBtn.disabled = true; match.textContent = t("htlc.s3", "Checking…"); match.className = "muted";
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        if (myGen !== gen || !inp.value) { match.textContent = t("htlc.s4", "Type the preimage to check it against the locked hash."); return; }
        Htlc.checkPreimage(row.algo, inp.value, typeId, row.hash_hex).then(function (r) {
          if (myGen !== gen) return;
          lastOk = Array.from(new TextEncoder().encode(inp.value),
            function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join("");
          match.textContent = t("htlc.hash_match_prefix", "Hash match ✓ (") + r.size + " bytes)"; match.className = "xfer-ok"; reviewBtn.disabled = false;
        }).catch(function () {
          if (myGen !== gen) return;
          lastOk = ""; match.textContent = t("htlc.s5", "No match — the node would reject this preimage."); match.className = "error";
        });
      }, 400);
    });
    var reviewBtn = reviewSection(doc, box, myGen, t("htlc.review_redeem", "Review redeem"), {
        build: async function () {
          if (!lastOk) throw new Error("bad-preimage");
          var pair = Htlc.buildRedeem({ htlcId: row.id, redeemerId: me.id, preimageHex: lastOk });
          return { pair: pair, fee: await Htlc.fee(pair, "1.3.0"), preBytes: lastOk.length / 2,
            prove: async function () {
              try { await Htlc.htlc(row.id); return null; }
              catch (e) { return String((e && e.message) || "") === "unknown-htlc" ? { gone: true } : null; } } };
        },
        rows: function (R, fee) {
          return [[t("htlc.title", "HTLC"),  row.id], [t("htlc.redeemer_row", "Redeemer"),  me.name + " (" + me.id + ")"], [t("htlc.preimage_label", "Preimage"),  R.preBytes + " bytes, hash-match ✓"],
            [t("borrow.fee", "Fee"),  fee.text, "raw " + fee.raw], [t("borrow.network", "Network"),  "testnet"]];
        },
        title: t("htlc.confirm_redeem", "Confirm redeem"), ok: function () { return "Redeemed: contract " + row.id + " is gone."; }, clear: [inp], fail: t("htlc.redeem_fee_failed", "Could not estimate the redeem fee.") });
    reviewBtn.disabled = true;
  }
  function extendBox(doc, box, me, row, myGen) { /* presets + custom, new-expiry preview, live fee */
    box.appendChild(DOM.el(doc, "h2", t("htlc.extend_title", "Extend timelock")));
    if (!isUnlockedNow()) box.appendChild(signNotice(doc));
    var picker = secsPicker(doc, PRESETS.map(function (p) { return [String(p[1]), "+" + p[0]]; }), t("settings.add", "Add"));
    box.appendChild(picker.row);
    var preview = DOM.el(doc, "p", "", "muted"); preview.setAttribute("aria-live", "polite"); box.appendChild(preview);
    var oldSecs = Math.floor(new Date(row.expiration_iso + "Z").getTime() / 1000);
    function humanAdded(n) { var dur, when; /* {dur, when, line} for preview + confirm rows */
      try { dur = Htlc.formatDuration(n) + " (" + n + " s)"; } catch (e) { dur = n + " s"; }
      try { when = Htlc.formatDateTime(new Date((oldSecs + n) * 1000).toISOString().slice(0, 19)); } catch (e) { when = "unknown"; }
      return { dur: dur, when: when, line: "Adds " + dur + " → new expiry " + when + "." };
    }
    function refreshPreview() {
      var n = picker.secs();
      preview.textContent = (!Number.isInteger(n) || n < 1) ? t("htlc.enter_secs", "Enter extra seconds.") : humanAdded(n).line; }
    picker.sel.addEventListener("change", refreshPreview);
    picker.custom.addEventListener("input", refreshPreview); refreshPreview();
    reviewSection(doc, box, myGen, t("htlc.review_extend", "Review extend"), {
        build: async function () {
          var n = picker.secs(), h;
          if (!Number.isInteger(n) || n < 1) throw new Error(t("htlc.err_extra_secs", "Extra seconds must be a positive integer."));
          h = humanAdded(n);
          var pair = Htlc.buildExtend({ htlcId: row.id, issuerId: me.id, secondsToAdd: n });
          return { pair: pair, fee: await Htlc.fee(pair, "1.3.0"), h: h, n: n, prove: async function () {
            try {
              var curSecs = Math.floor(new Date((await Htlc.htlc(row.id)).expiration_iso + "Z").getTime() / 1000);
              return curSecs >= oldSecs + n - 5 ? { advanced: true } : null;
            } catch (e) { return null; } } };
        },
        rows: function (R, fee) {
          return [[t("htlc.title", "HTLC"),  row.id], [t("explorer.issuer_row", "Issuer"),  me.name + " (" + me.id + ")"], [t("htlc.added_row", "Added time"),  R.h.dur], [t("htlc.expiry_row", "New expiry"),  R.h.when],
            [t("borrow.fee", "Fee"),  fee.text, "raw " + fee.raw], [t("borrow.network", "Network"),  "testnet"]];
        },
        title: t("htlc.confirm_extend", "Confirm extend"), ok: function (R) { return "Extended by " + R.n + " seconds."; }, fail: t("htlc.extend_fee_failed", "Could not estimate the extend fee.") });
  }
  return { renderHtlc: renderHtlc, renderHtlcDetail: renderHtlcDetail, _ui: {
      el: DOM.el, touchable: touchable, clearBox: DOM.clear, shortHash: shortHash, showError: showError, showStatus: showStatus,
      offlineBox: offlineBox, confirmList: confirmList, field: field, selectOpts: selectOpts, tableHead: tableHead,
      feeText: feeText, headBlock: headBlock, sendConfirm: sendConfirm, reviewPaid: reviewPaid, reviewSection: reviewSection,
      routeReady: routeReady, routeFail: routeFail, loadAccount: loadAccount, amtText: amtText, secsPicker: secsPicker,
      autoRetryOnOpen: autoRetryOnOpen, dropOpenSubs: dropOpenSubs,
      isUnlockedNow: isUnlockedNow, viewingAsNotice: viewingAsNotice, signNotice: signNotice, unlockInline: unlockInline,
      viewingAsId: VIEWING_AS_ID,
      missingBackends: missingBackends, presets: PRESETS } };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.HtlcUI === "undefined") { globalThis.HtlcUI = HtlcUI; }
if (typeof module !== "undefined") { module.exports = HtlcUI; }
