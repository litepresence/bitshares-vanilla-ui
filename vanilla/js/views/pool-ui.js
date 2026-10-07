/* pool-ui.js — #/pools pools list + create form + shared _ui helpers.
 * Owns: pool table + filters + my-pools, op-59 create form with orientation
 *   preview, and the shared DOM/confirm helpers (PoolUI._ui) reused by
 *   pool-detail-ui.js (#/pools/:id desk). No money
 *   math here (Pool builders do it); no serializers (tx.js owns bytes). WIFs
 *   are JS values, never DOM. Unknown ids -> empty state, never blank.
 *   PUBLIC-FIRST: routeReady never gates on unlock (list/detail/quote render
 *   locked); reviewSection gates write reviews at click with an unlock notice;
 *   locked account reads default to committee-account 1.2.0 with a notice.
 * Consumes: Pool (list/mine/buildCreate/fee/sendAndProve/percent helpers),
 *   Tx.buildTx, Format (human strings only), Account (resolve/myAccountId),
 *   Asset.describe (symbols + precisions), Wallet (unlock + memory WIF),
 *   Chain/Store (status). Created by: building-vanilla-slices skill,
 *   slice-12-pools plan Task 3 (split: detail desk lives in pool-detail-ui.js
 *   so every file stays <=400 lines).
 * CHAIN TRUTH (#4 wins): op fields <- protocol/liquidity_pool.hpp; validate traps
 *   (a<b id order, withdrawal->0-only) enforced by builders client-side; percents
 *   u16 hundredths (150 -> 1.5%) via Pool.pctUnitsToHuman; fees live via Tx.fee.
 */
var PoolUI = (function () {
  "use strict";

  /* Batch-2d i18n (slice-17 precedent): display strings resolve via I18n.t with
   * the pre-conversion literal kept verbatim as enDefault (English-identical on any
   * transport, incl. file:// where dict fetch fails). Falls back to the default
   * when i18n.js failed to load: never blank, never throws. Dynamic sentences keep
   * their code structure (batch-2b precedent): only complete static literals and
   * word-bearing segments are wrapped, values and punctuation glue stay raw, so
   * every default below is byte-verbatim in the HEAD blob. vars fills %(name)s
   * placeholders; without I18n the raw default returns unfilled. */
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
  var openSubs = [];
  /* Pool-net selection bridge (Task 5 installs, Task 6 consumes): renderPools
   * installs a live closure getter each render; the exported getSelection
   * delegates to the latest installed getter, defaulting to BTS/empty when
   * never rendered (headless calls, pre-route). Raw strings until Format
   * renders; ids refresh on every loaded page. */
  var selectionGetter = null;
  /** Current pool filter selection for the pool-net canvas.
   * WHY here: Task 6 mounts PoolNetUI with a getSelection callback; the
   * inputs live in the renderPools closure, so this delegates to the
   * installed getter. Order-free: a/b is an unordered pair downstream.
   * @returns {{a:string,b:string,s:string,aId:(string|null),bId:(string|null)}}
   *   trimmed raw inputs + last resolved asset ids (null unresolved). */
  function getSelection() {
    try {
      if (typeof selectionGetter === "function") return selectionGetter();
    } catch (e) { /* default below */ }
    return { a: "BTS", b: "", s: "", aId: null, bId: null };
  }
  /* Page-sort (honest scope): the chain offers no sorted pool endpoint, so
   * sortable headers reorder the LOADED page only, never the chain. */
  var sortKey = "id", sortDir = 1;
  /* No local el — use DOM.el */
  /* clearBox removed — use DOM.clear */
  function showError(doc, wrap, e, fallback) {
    var m = (e && e.message) ? e.message : String(e || fallback || t("common.unexpected_error", "Unexpected error"));
    if (m.indexOf("not-connected") !== -1) m = t("common.network_unavailable", "Network unavailable. Check Settings → Nodes and retry.");
    if (m.indexOf("wallet-locked") !== -1) m = t("common.wallet_locked", "Wallet is locked.");
    if (m.indexOf("unknown-pool") !== -1) m = t("pool.unknown_pool", "Unknown pool.");
    var err = DOM.error(wrap, m); return err;
  }
  function showStatus(doc, wrap, text) {
    var p = DOM.status(wrap, text); return p;
  }
  /* Offline backend: the shared Offline helper (js/api/offline.js) owns the
   * handshake, failure counts, and Settings link. Present when loaded;
   * absent (script load failure) falls back to the plain re-render below so
   * the panel never goes dead. */
  function offlineBackend() {
    try {
      if (typeof Offline !== "undefined" && Offline) return Offline;
    } catch (e) { /* fallback below */ }
    return null;
  }
  function offlineState() {
    var off = offlineBackend();
    if (off && typeof off.state === "function") {
      try { return off.state(); } catch (e) { /* unknown below */ }
    }
    try {
      if (typeof Chain !== "undefined" && Chain && Chain.status) return Chain.status().state || "unknown";
    } catch (e) { /* unknown below */ }
    return "unknown";
  }
  function offlineEnsure() {
    var off = offlineBackend();
    if (off && typeof off.ensure === "function") {
      try { off.ensure(); } catch (e) { /* manual Retry remains */ }
      return;
    }
  }
  function offlineBox(doc, wrap, retryFn) { /* Offline panel: copy depends on
    * actual connection (unknown-id failures while connected must not claim
    * the network is down). Retry handshakes via the shared Offline helper
    * (old behavior only re-rendered, so a dropped socket left the button
    * dead); Open Settings links to #/settings for node failover. A
    * background autoRetry subscription (routeReady) still re-renders on any
    * "open" event, so a successful handshake paints via both paths
    * harmlessly. */
    var open = offlineState() === "open";
    wrap.appendChild(DOM.el(doc, "p", open
      ? t("pool.retry_load", "Retry loading.")
      : t("common.network_unavailable", "Network unavailable. Check Settings → Nodes and retry."), "muted"));
    var status = DOM.el(doc, "p", "", "muted");
    try { status.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
    wrap.appendChild(status);
    var row = DOM.el(doc, "div", null, "pools-offline-row");
    wrap.appendChild(row);
    var b = touchable(DOM.el(doc, "button", t("fees.retry", "Retry"))); b.type = "button"; b.className = "btn-ghost";
    row.appendChild(b);
    var off = offlineBackend();
    if (off && typeof off.wire === "function") {
      try { off.wire(b, status, retryFn, t); } catch (e) { b.addEventListener("click", retryFn); }
    } else {
      b.addEventListener("click", retryFn);
    }
    var settingsLink = null;
    if (off && typeof off.settingsLink === "function") {
      try { settingsLink = off.settingsLink(doc, t); } catch (e) { settingsLink = null; }
    }
    if (!settingsLink) {
      try {
        if (typeof HistoryNotice !== "undefined" && HistoryNotice && typeof HistoryNotice.actionLink === "function") {
          settingsLink = HistoryNotice.actionLink(doc, t, "settings");
        }
      } catch (e) { settingsLink = null; }
    }
    if (!settingsLink) {
      settingsLink = DOM.el(doc, "a", t("notice.open_settings", "Open Settings"));
      try { settingsLink.setAttribute("href", "#/settings"); } catch (e) { /* label stands */ }
      settingsLink.className = "subtle-btn";
    }
    row.appendChild(settingsLink);
  }
  function unlockBox(doc, wrap, retry) {
    wrap.appendChild(DOM.el(doc, "p", t("barter.wallet_is_locked_enter_your_password_to_conti", "Wallet is locked. Enter your password to continue."), "muted"));
    var inp = doc.createElement("input"); inp.type = "password"; touchable(inp); wrap.appendChild(inp);
    var b = touchable(DOM.el(doc, "button", t("account.s6", "Unlock"))); b.type = "button"; wrap.appendChild(b);
    b.addEventListener("click", function () { b.disabled = true;
      /* H2: wipe the password local + input on either outcome. */
      var pw = inp.value;
      Wallet.unlock(pw).then(function () { inp.value = ""; pw = null; retry(); }).catch(function (e) { inp.value = ""; pw = null; b.disabled = false; showError(doc, wrap,e,t("common.unlock_failed", "Unlock failed.")); });
    });
  }
  /* Default viewing account while locked: committee-account 1.2.0 (a public
   * chain object on testnet+mainnet). Reads stay public under it; writes gate
   * at review click (reviewSection). Never throws — locked render is normal. */
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
  function dropSubs() { openSubs.forEach(function (off) { try { off(); } catch (e) {} }); openSubs = []; }
  function autoRetry(myGen, retryFn) {
    try {
      var hashAtEntry = (typeof location !== "undefined" && location.hash) || "", settled = false;
      var off = Store.subscribe("connection", function (st) {
        if (settled || myGen !== gen) { settled = true; try { off(); } catch (e) {} return; }
        if (st && st.state === "open") { settled = true; try { off(); } catch (e) {}
          if (typeof location === "undefined" || location.hash === hashAtEntry) retryFn(); }
      });
      openSubs.push(off);
    } catch (e) { /* manual Retry remains */ }
  }
  function routeReady(root, title, retry) {
    var doc = root.ownerDocument || document, myGen = ++gen, miss = null;
    dropSubs(); root.innerHTML = "";
    ["Pool", "Tx", "Account", "Wallet", "Format", "Asset", "Chain", "Store"].forEach(function (g) {
      if (typeof globalThis[g] === "undefined") miss = g; });
    var wrap = DOM.el(doc, "div", null, "wrap"); root.appendChild(wrap);
    wrap.appendChild(DOM.pageHead(doc, title, "pools"));
    if (miss) { showError(doc, wrap, title + " backend missing: " + miss + " failed to load."); return null; }
    if (Chain.status().state !== "open") {
      offlineBox(doc, wrap, retry);
      autoRetry(myGen, retry);
      /* Automated handshake: a dropped socket almost always just needs a
       * fresh login->database handshake against the active node. Fire one
       * attempt on entry (no-op when already connecting); success re-renders
       * via the autoRetry "open" subscription above. Manual Retry covers
       * further attempts; Open Settings covers node failover. */
      offlineEnsure();
      return null;
    }
    /* PUBLIC-FIRST: no wallet gate here — list/detail/quote render locked.
     * Write paths gate at review click (reviewSection) with an unlock notice. */
    return { doc: doc, wrap: wrap, myGen: myGen };
  }
  function routeFail(root, title, e, retry) {
    root.innerHTML = "";
    var doc = root.ownerDocument || document, box = DOM.el(doc, "div", null, "wrap");
    root.appendChild(box); box.appendChild(DOM.pageHead(doc, title, "pools"));
    showError(doc, box,e,t("pool.load_failed", "Could not load pools.")); offlineBox(doc, box, retry);
  }
  /* No local confirm builder — use ConfirmDialog.show (title/rows/feeHuman/
   * Back/Sign&Send). Fee rows ride inside rows (embedded by rows-builder
   * closures); unlock gates + status + sendAndProve stay in onSend below. */
  /* field: labeled touch-sized input row (Forms-delegating _ui export).
   * The row shell comes from Forms.labeledInput (no local DOM duplication);
   * retained under this name/signature because PoolUI._ui.field is consumed
   * by pool-detail-ui.js (sibling-batch file). Returns
   * {row, input, suffix} — suffix stays null (no unit-wrap site remains). */
  function field(doc, labelText, opts) {
    opts = opts || {};
    var built = Forms.labeledInput(doc, labelText + " ", {
      type: opts.type, value: opts.value,
      placeholder: opts.placeholder || undefined, inputmode: opts.inputmode || undefined
    });
    return { row: built.row, input: built.input, suffix: null };
  }
  function tableHead(doc, titles) {
    var hr = doc.createElement("tr");
    titles.forEach(function (t) { hr.appendChild(DOM.el(doc, "th", t)); });
    var thead = doc.createElement("thead"); thead.appendChild(hr); return thead;
  }
  async function feeText(fee) { /* live fee -> human + raw title (lookup miss stays honest) */
    try {
      var a = await Asset.describe(fee.asset_id);
      return { text: Format.formatAmount(fee.amount, a.precision) + " " + a.symbol, raw: String(fee.amount) };
    } catch (e) { return { text: String(fee.amount) + " (" + fee.asset_id + ")", raw: String(fee.amount) }; }
  }
  async function headBlock() {
    return (await Chain.call(await Chain.db(), "get_dynamic_global_properties", [])).head_block_number || 0;
  }
  function amtText(raw, assetId, prec, sym) { /* raw int -> human + raw title; unknown prec stays honest */
    if (typeof prec === "number" && /^\d+$/.test(String(raw)))
      return { text: Format.formatAmount(String(raw), prec) + (sym ? " " + sym : ""), raw: String(raw) };
    return { text: String(raw) + " (" + assetId + ")", raw: String(raw) };
  }
  function pctText(u) { return Pool.pctUnitsToHuman(u) + "%"; } /* u16 hundredths -> "1.5%" */
  function whoText(me) { return me.name + " (" + me.id + ")"; }
  /* Network label from Store (sole settings owner); mainnet when unreadable.
   * WHY a verbatim copy (trade-panels.js:110 precedent — doctrine prefers
   * duplication over a shared import for two files): the confirm Network row
   * must name the live network, never a hardcoded "testnet" (P0 :653 fix).
   * Params: none. Returns "testnet"|"mainnet" (mainnet default). Never throws.
   * @returns {string} */
  function networkName() {
    try {
      if (typeof Store !== "undefined" && Store && typeof Store.loadSettings === "function") {
        var s = Store.loadSettings();
        if (s && (s.network === "testnet" || s.network === "mainnet")) return s.network;
      }
    } catch (e) { /* default stands */ }
    return "mainnet";
  }
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
        if (!wif) { out.removeChild(status); showError(doc, out, new Error("wallet-locked")); sendB.disabled = false; backB.disabled = false; return; }
        Promise.resolve().then(cfg.makeUnsigned).then(function (unsigned) {
          status.textContent = t("common.status_broadcasting", "Broadcasting…");
          return Pool.sendAndProve(unsigned, wif, cfg.prove);
        }).then(async function (res) {
          if (myGen !== gen) return; DOM.clear(out);
          out.appendChild(DOM.el(doc, "p", cfg.okText, "xfer-ok"));
          out.appendChild(DOM.el(doc, "p", "Observed at head block #" + String(await headBlock()) + " (" + res.via + ").", "muted"));
        }).catch(function (e) {
          if (myGen !== gen) return; out.removeChild(status);
          showError(doc, out,e,t("common.failed_check_state", "Failed. Check state before retrying (do NOT blindly rebroadcast)."));
          sendB.disabled = false; backB.disabled = false;
        });
      } });
    /* Principle #6 (raw in title): rows carry native r[2] raw titles
     * (ConfirmDialog.show sets dd.title); no post-show restore needed. */
    /* TxBuilder outlet (additive): stake only ([61, opData]) — queue the
     * deposit without broadcasting. Create/unstake/swap confirms render no
     * outlet. The pair passes as JS values only (never into the DOM); the
     * one-shot Sign & Send below is untouched. */
    try {
      if (cfg && cfg.pair && cfg.pair[0] === 61 && cfg.pair[1] &&
          typeof TxBuilder !== "undefined" && TxBuilder && typeof TxBuilder.addOp === "function") {
        var tbDep = touchable(DOM.el(doc, "button", t("txbuilder.add_deposit", "Add deposit to TxBuilder")));
        tbDep.type = "button";
        tbDep.addEventListener("click", function () {
          var tbSrc = "pool:deposit " + String(cfg.pair[1].pool || "");
          TxBuilder.addOp(cfg.pair[0], cfg.pair[1], tbSrc);
          try {
            if (typeof Notify !== "undefined" && Notify && typeof Notify.push === "function") {
              Notify.push("info", t("txbuilder.added_title", "Added to TxBuilder"), t("txbuilder.added_body_tpl", "%(src)s (op %(op)s) — %(n)s in queue", { src: tbSrc, op: 61, n: TxBuilder.count() }), {});
            }
          } catch (e2) { /* toast optional; the desk badge is the record */ }
          location.hash = "#/txbuilder";
        });
        dlg.appendChild(tbDep);
      }
    } catch (e) { /* outlet never breaks the one-shot path */ }
    out.appendChild(dlg);
  }
  /** build {pair,fee,prove} + live fee -> rows -> sendConfirm.
   * TYPE NOTE: the cfg.build promise resolves {pair, fee, prove} but tsc
   * reads the chain as Promise<void>; member casts pin each field to any.
   * No shared types.js yet (group 1 owns it); local casts only.
   * @param {Document} doc owner document
   * @param {HTMLElement} out output box (cleared + rebuilt)
   * @param {number} myGen route generation (liveness token)
   * @param {any} cfg {build, rows, title, ok, fail, btn?}
   * @returns {void} */
  function reviewPaid(doc, out, myGen, cfg) {
    DOM.clear(out); if (cfg.btn) cfg.btn.disabled = true;
    showStatus(doc, out,t("account.resolving_fee", "Resolving and estimating fee…"));
    function done() { if (cfg.btn) cfg.btn.disabled = false; }
    Promise.resolve().then(cfg.build).then(function (built) {
      if (myGen !== gen) return done();
      feeText((/** @type {any} */ (built).fee)).then(function (f) {
        if (myGen !== gen) return done();
        sendConfirm(doc, out, { title: cfg.title, rows: cfg.rows(built, f), pair: (/** @type {any} */ (built).pair),
          makeUnsigned: function () { return Tx.buildTx([(/** @type {any} */ (built).pair)]); },
          prove: (/** @type {any} */ (built).prove), okText: cfg.ok(built) }, myGen);
        done();
      }).catch(function (e) { if (myGen === gen) { DOM.clear(out); showError(doc, out,e,t("barter.fee_lookup_failed", "Fee lookup failed.")); } done(); });
    }).catch(function (e) {
      if (myGen !== gen) return done();
      DOM.clear(out); showError(doc, out, e, cfg.fail || t("credit.could_not_prepare_the_transaction", "Could not prepare the transaction.")); done();
    });
  }
  /** Live delete-readiness check for a liquidity pool (shared pre-check).
   * WHY live, WHY fail-closed: the static "withdraw all liquidity first"
   * warning trusts the render-time row; balances/supply move after every
   * deposit/withdraw, so the Review delete gate must re-read at click time.
   * Delete is owner-only cleanup valid only when share supply AND both legs
   * read 0 — any non-zero or unreadable leg blocks with the leg named.
   * CHAIN TRUTH: balances <- Pool.get (liquidity_pool_object), supply <-
   * Asset.describe share_asset current_supply (dynamic join; null when
   * offline/join-miss -> blocked as unverified, never enabled blind).
   * NEW I18N KEY (follow-up mirrors to 12 locales): pool.delete_not_empty
   * ("Not empty — %(legs)s must read 0 before delete.").
   * @param {string} poolId pool object id (1.19.x)
   * @param {string} shareId share asset id (1.3.x)
   * @returns {Promise<{ok:boolean, note:(string|null), legs:Array<string>}>}
   *   ok true + note null when empty; ok false + localized note otherwise.
   *   Never throws — read failures return ok:false with an honest note. */
  async function deleteCheck(poolId, shareId) {
    var legs = [];
    try {
      var row = await Pool.get(String(poolId));
      var sid = String(shareId || row.share_id || "");
      var supplyRaw = null, supplyPrec = null, supplySym = sid;
      try {
        var desc = await Asset.describe(sid);
        if (desc) {
          if (desc.supply_raw !== null && desc.supply_raw !== undefined) supplyRaw = String(desc.supply_raw);
          supplyPrec = (typeof desc.precision === "number") ? desc.precision : null;
          supplySym = desc.symbol || sid;
        }
      } catch (e) { supplyRaw = null; }
      var balA = (row.balance_a_raw !== null && row.balance_a_raw !== undefined) ? String(row.balance_a_raw) : null;
      var balB = (row.balance_b_raw !== null && row.balance_b_raw !== undefined) ? String(row.balance_b_raw) : null;
      /* Name each non-zero leg with its human amount (raw in amtText title
       * path — display text stays human per #6); unknown reads block too. */
      if (balA === null) legs.push("A ?");
      else if (balA !== "0") {
        var hA = amtText(balA, row.asset_a_id, (typeof row.prec_a === "number") ? row.prec_a : null, row.sym_a || row.asset_a_id);
        legs.push("A " + hA.text);
      }
      if (balB === null) legs.push("B ?");
      else if (balB !== "0") {
        var hB = amtText(balB, row.asset_b_id, (typeof row.prec_b === "number") ? row.prec_b : null, row.sym_b || row.asset_b_id);
        legs.push("B " + hB.text);
      }
      if (supplyRaw === null) legs.push("supply ?");
      else if (supplyRaw !== "0") {
        var hS = amtText(supplyRaw, sid, supplyPrec, supplySym);
        legs.push("supply " + hS.text);
      }
      var empty = (balA === "0" && balB === "0" && supplyRaw === "0");
      if (empty) return { ok: true, note: null, legs: [] };
      return { ok: false, note: t("pool.delete_not_empty", "Not empty — %(legs)s must read 0 before delete.", { legs: legs.length ? legs.join(", ") : "?" }), legs: legs };
    } catch (e) {
      return { ok: false, note: t("common.failed_check_state", "Failed. Check state before retrying (do NOT blindly rebroadcast)."), legs: legs };
    }
  }
  /** Review-button section with optional live readiness gate.
   * WHY the gate: destructive confirms (pool delete) must not offer Sign &
   * Send while the chain still shows value inside — the button stays disabled
   * until cfg.checkReady resolves ok. Existing callers without checkReady
   * behave byte-identically (enabled immediately); delete callers pass
   * function () { return PoolUI._ui.deleteCheck(poolId, shareId); } (detail
   * wiring belongs to the pool-detail-actions worker — this file only owns
   * the gate + check).
   * @param {Document} doc owner document
   * @param {HTMLElement} box mount element for button + output
   * @param {number} myGen route generation (liveness token)
   * @param {string} label button label
   * @param {any} cfg {build, rows, title, ok, fail, btn?, checkReady?}
   * @returns {HTMLButtonElement} the review button */
  function reviewSection(doc, box, myGen, label, cfg) {
    var btn = touchable(DOM.el(doc, "button", label)); btn.type = "button"; box.appendChild(btn);
    var out = DOM.el(doc, "div", null, "xfer-out"); box.appendChild(out);
    cfg.btn = btn;
    /* LIVE GATE (delete pre-check): when cfg.checkReady is present the button
     * starts disabled with a checking note; it enables only on ok:true. The
     * blocked note names the remaining legs (deleteCheck above). Stale gens
     * never enable. No gate -> immediate enable (all current callers). */
    if (cfg && typeof cfg.checkReady === "function") {
      btn.disabled = true;
      var gateNote = DOM.el(doc, "p", t("pool.loading", "Loading pools…"), "muted");
      try { gateNote.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
      box.appendChild(gateNote);
      /* TYPE NOTE: cfg is any (seam without shared types — group 1 owns
       * types.js); pin the gate fn + result to any so member reads never
       * narrow to never under checkJs. */
      var gateFn = /** @type {any} */ ((cfg && cfg.checkReady));
      Promise.resolve().then(function () { return gateFn(); }).then(function (res) {
        var resAny = /** @type {any} */ (res);
        if (myGen !== gen) return;
        var ok = !!(resAny && resAny.ok);
        if (ok) {
          btn.disabled = false;
          try { if (gateNote.parentNode) gateNote.parentNode.removeChild(gateNote); } catch (e2) { /* gone */ }
        } else {
          btn.disabled = true;
          try { gateNote.textContent = (resAny && resAny.note) ? String(resAny.note) : t("common.failed_check_state", "Failed. Check state before retrying (do NOT blindly rebroadcast)."); } catch (e3) { /* checking text stands */ }
        }
      }).catch(function () {
        if (myGen !== gen) return;
        btn.disabled = true;
        try { gateNote.textContent = t("common.failed_check_state", "Failed. Check state before retrying (do NOT blindly rebroadcast)."); } catch (e4) { /* checking text stands */ }
      });
    }
    /* SIGN-TIME GATE: password asked only here, never at render. A locked
     * click shows an honest notice + inline unlock; success flows into review
     * (read-only until the user presses Sign & Send). */
    btn.addEventListener("click", function () {
      if (myGen !== gen) return;
      if (!isUnlockedNow()) {
        DOM.clear(out);
        out.appendChild(DOM.el(doc, "p", t("pool.unlock_notice", "Unlock to act — signing needs your wallet password."), "muted"));
        unlockBox(doc, out, function () { if (myGen === gen) reviewPaid(doc, out, myGen, cfg); });
        return;
      }
      reviewPaid(doc, out, myGen, cfg);
    });
    return btn;
  }
  /* assetLink: symbol -> #/asset/:symbol anchor (existing route; join misses
   * link by bare id, which the asset view also resolves). textContent only. */
  function assetLink(doc, sym) {
    var a = DOM.el(doc, "a", sym);
    a.setAttribute("href", "#/asset/" + sym);
    return a;
  }
  /** Pool table (dense dexux-ref columns + optional per-owned-row Unstake link).
   * WHY the extra column lives only on the mine table (opts.mine): the main
   * list is strangers' pools (Swap/Stake ⇄ already opens the desk); owned rows
   * get a 1-tap Unstake deep link to the detail desk whose Review unstake is
   * already 1-tap there — this restores 1-tap unstake from the list.
   * WHY the href stays clean "#/pools/<id>" (no literal "#unstake" fragment):
   * Router.currentPath would fold a second "#" into the :id segment
   * ("1.19.7#unstake" fails Pool POOL_RE -> unknown-pool); the unstake intent
   * rides in the click handler below, which navigates cleanly then focuses
   * the detail's Review unstake button (middle-click/copy-link stay safe).
   * @param {Document} doc owner document
   * @param {Array<any>} rows joined pool rows (Pool.list/mine shape)
   * @param {{mine?:boolean}} [opts] when mine true, append the Unstake column
   * @returns {HTMLElement} table, or empty-state paragraph */
  function poolTable(doc, rows, opts) { /* dexux-ref density: POOL ID / EXCHANGE /
    *   SHARE / A / A QTY / B / B QTY / TAKER / WITHDRAWAL (+ UNSTAKE on mine).
    *   EXCHANGE opens the detail desk (#/pools/:id), which owns the inline
    *   swap and stake panels — the list stays a list (no separate STAKE
    *   column: same destination).
    *   Sort: Pool ID / Taker / Withdrawal headers toggle page-sort. */
    var mine = !!(opts && opts.mine);
    if (!rows.length) return DOM.el(doc, "p", t("pool.no_pools", "No pools found.") + t("pool.zero_supply_hint", " Create one from the Stake form on this desk — it needs a zero-supply share asset from #/assets/create first."), "muted");
    var view = rows.slice();
    function sortVal(r) {
      if (sortKey === "taker") return Number(r.taker_units) || 0;
      if (sortKey === "withdrawal") return Number(r.withdrawal_units) || 0;
      return String(r.id || "");
    }
    view.sort(function (a, b) {
      var x = sortVal(a), y = sortVal(b);
      if (x < y) return -1 * sortDir;
      if (x > y) return 1 * sortDir;
      return 0;
    });
    var table = doc.createElement("table"); table.className = "node-table pools-table";
    var hr = doc.createElement("tr");
    var cols = [
      { key: "id", label: t("pool.id_col", "Pool ID"), sortable: true },
      { key: null, label: t("pool.swap_stake_col", "Swap/Stake") },
      { key: null, label: t("pool.share_asset_field", "Share asset") },
      { key: null, label: t("pool.asset_a_field", "Asset A") },
      { key: null, label: t("pool.asset_a_qty_col", "Asset A qty") },
      { key: null, label: t("pool.asset_b_field", "Asset B") },
      { key: null, label: t("pool.asset_b_qty_col", "Asset B qty") },
      { key: "taker", label: t("pool.taker_row", "Taker fee"), sortable: true },
      { key: "withdrawal", label: t("pool.withdrawal_row", "Withdrawal fee"), sortable: true }
    ];
    /* Owned-row Unstake header (existing key pool.stake_unstake_col, default
     * "Stake/Unstake" — reused, no new copy). Main list keeps 9 columns. */
    if (mine) cols.push({ key: null, label: t("pool.stake_unstake_col", "Stake/Unstake") });
    cols.forEach(function (c) {
      var th = doc.createElement("th");
      if (c.sortable) {
        var b = doc.createElement("button");
        b.type = "button";
        b.className = "th-sort";
        b.textContent = c.label + (sortKey === c.key ? (sortDir === 1 ? " ▲" : " ▼") : "");
        b.setAttribute("aria-label", t("pool.sort_by", "Sort by ") + c.label);
        if (sortKey === c.key) th.setAttribute("aria-sort", sortDir === 1 ? "ascending" : "descending");
        touchable(b); b.className = "th-sort subtle-btn";
        b.addEventListener("click", function () {
          if (sortKey === c.key) sortDir = -1 * sortDir;
          else { sortKey = c.key; sortDir = 1; }
          /* TYPE NOTE: th widens under doc:Document (was any before the
           * poolTable JSDoc); pin to any so the TABLE walk assigns freely. */
          var box = /** @type {any} */ (th);
          while (box && box.tagName !== "TABLE") box = box.parentElement;
          if (box && box.parentElement) {
            var fresh = poolTable(doc, rows, opts);
            box.parentElement.replaceChild(fresh, box);
          }
        });
        th.appendChild(b);
      } else {
        th.textContent = c.label;
      }
      hr.appendChild(th);
    });
    var thead = doc.createElement("thead"); thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = doc.createElement("tbody");
    view.forEach(function (r) {
      var tr = doc.createElement("tr");
      /* Qty cells are bare numbers (the A/B columns already name the
       * assets — dexux-ref density); raw integers stay in title. */
      var aA = amtText(r.balance_a_raw, r.asset_a_id, r.prec_a, null);
      var aB = amtText(r.balance_b_raw, r.asset_b_id, r.prec_b, null);
      tr.appendChild(DOM.el(doc, "td", r.id));
      /* EXCHANGE second: ⇄ text link in link blue (#1 shows ⇄ here; the
       * vendored swap.svg <img> cannot inherit link color, so text keeps
       * the column blue like every other link). href, aria-label, title
       * unchanged — skin only. */
      var tdX = doc.createElement("td");
      var xl = DOM.el(doc, "a", "⇄", "pools-xlink");
      xl.setAttribute("href", "#/pools/" + r.id);
      xl.setAttribute("aria-label", t("pool.swap_title", "Swap in pool") + " " + r.id);
      xl.title = t("pool.swap_title_attr", "Swap in this pool");
      tdX.appendChild(xl); tr.appendChild(tdX);
      var tdS = doc.createElement("td"); tdS.appendChild(assetLink(doc, r.sym_share)); tr.appendChild(tdS);
      var tdA = doc.createElement("td"); tdA.appendChild(assetLink(doc, r.sym_a)); tr.appendChild(tdA);
      var cA = DOM.el(doc, "td", aA.text, "num"); cA.title = t("account.raw_prefix", "raw ") + aA.raw; tr.appendChild(cA);
      var tdB = doc.createElement("td"); tdB.appendChild(assetLink(doc, r.sym_b)); tr.appendChild(tdB);
      var cB = DOM.el(doc, "td", aB.text, "num"); cB.title = t("account.raw_prefix", "raw ") + aB.raw; tr.appendChild(cB);
      tr.appendChild(DOM.el(doc, "td", pctText(r.taker_units), "num"));
      tr.appendChild(DOM.el(doc, "td", pctText(r.withdrawal_units), "num"));
      /* Per-owned-row Unstake deep link (mine only): visible text + aria reuse
       * pool.review_unstake ("Review unstake" — no new copy). Click navigates
       * to the clean detail hash, then focuses the detail's Review unstake
       * button (poll ≤1s, best-effort — the desk is usable without the focus
       * when the poll misses). Never throws outward. */
      if (mine) {
        var tdU = doc.createElement("td");
        var ul = DOM.el(doc, "a", t("pool.review_unstake", "Review unstake"));
        try { ul.setAttribute("href", "#/pools/" + r.id); } catch (e) { /* label stands */ }
        try {
          ul.setAttribute("aria-label", t("pool.review_unstake", "Review unstake") + " " + r.id);
          ul.title = t("pool.review_unstake", "Review unstake") + " " + r.id;
        } catch (e2) { /* label stands */ }
        touchable(ul);
        (function (poolId, link) {
          link.addEventListener("click", function () {
            try {
              var want = "#/pools/" + poolId;
              var go = function () {
                try {
                  if (typeof window !== "undefined" && window.location && window.location.hash !== want) {
                    window.location.hash = want;
                  }
                } catch (e) { /* href fallback navigates */ }
                var tries = 0;
                var timer = setInterval(function () {
                  tries += 1;
                  try {
                    var btns = (typeof document !== "undefined" && document.querySelectorAll)
                      ? document.querySelectorAll("button") : [];
                    for (var i = 0; i < btns.length; i++) {
                      var label = String(btns[i].textContent || "").trim();
                      if (label === t("pool.review_unstake", "Review unstake")) {
                        try {
                          if (btns[i].scrollIntoView) btns[i].scrollIntoView();
                          if (btns[i].focus) btns[i].focus({ preventScroll: true });
                        } catch (e2) { /* landed anyway */ }
                        clearInterval(timer);
                        return;
                      }
                    }
                  } catch (e3) { /* next tick */ }
                  if (tries >= 20) { try { clearInterval(timer); } catch (e4) { /* done */ } }
                }, 50);
              };
              /* Let the href update the hash first (middle-click/copy-link use
               * the clean href above); the focus poll runs either way. */
              setTimeout(go, 0);
            } catch (e) { /* detail desk still opens via href */ }
          });
        })(r.id, ul);
        tdU.appendChild(ul); tr.appendChild(tdU);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); return table;
  }
  /** Route entry: #/pools — filters + pool table + my-pools + create form.
   * Pager: page-size select (10/25/50, default 10 like the ref) + Prev/Next +
   * "Page N". No numbered pages: the chain exposes no pool count, so totals
   * are not invented — hasNext comes from fetching one row over the page.
   * startId paging is inclusive on most nodes, so a leading duplicate of the
   * previous page's last row is dropped (over-fetch of 2 covers it).
   * @param {HTMLElement} root router mount element */
  function renderPools(root) {
    if (!root) return;
    var ctx = routeReady(root, t("pools.selector_title", "Pool Selector"), function () { renderPools(root); });
    if (!ctx) return;
    var doc = ctx.doc, myGen = ctx.myGen;
    /* Wide (viewport-gaps fix 2026-09-28): the 10-col dense table
     * needs full-bleed room; replaces mkt-wrap. Children span full width
     * via the app.css .wide contract; the table keeps its scroll region. */
    ctx.wrap.className = "wrap wide";
    ctx.wrap.appendChild(DOM.el(doc, "p", t("pool.list_sub", "CPMM pools (x*y=k). Stake is a deposit of both legs for LP shares."), "muted"));
    var pager = { page: 0, size: 10, starts: ["1.19.0"] };
    /* Last resolved leg ids for getSelection (Task 6 filterGraph {aId,bId});
     * refreshed on every loaded page, null when unresolved/cleared. */
    var lastResolved = { aId: null, bId: null };
    var POOL_ID_RE = /^1\.19\.\d+$/;
    /* Query seed (back-button-safe deep link, market-desk-query precedent):
     * filters + size + page + page startId restore from Router.query();
     * searches write back via history.replaceState (no re-render — leaving
     * for a pool detail and pressing Back restores this URL with filters). */
    function readQuery() {
      var q = {};
      try {
        if (typeof Router !== "undefined" && Router && typeof Router.query === "function") q = Router.query() || {};
      } catch (e) { q = {}; }
      return q;
    }
    function writeQuery() {
      try {
        if (typeof history === "undefined" || typeof history.replaceState !== "function") return;
        if (typeof window === "undefined" || !window.location) return;
        var parts = [];
        function put(k, v) {
          v = String(v === undefined || v === null ? "" : v).trim();
          if (v) parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
        }
        put("a", fA.input.value); put("b", fB.input.value); put("s", fS.input.value);
        if (pager.size !== 10) put("size", String(pager.size));
        if (pager.page > 0) {
          put("page", String(pager.page));
          if (pager.starts[pager.page]) put("start", pager.starts[pager.page]);
        }
        var base = String(window.location.href).split("#")[0];
        history.replaceState(null, "", base + "#/pools" + (parts.length ? "?" + parts.join("&") : ""));
      } catch (e) { /* URL stays unshared — list still works */ }
    }
    /* Pool-net band (Task 5 mount; Task 6 paints its canvas into netBody):
     * collapsible section above the filters. Open state persists in
     * localStorage "poolNetOpen" ("0" closed, anything else open; default
     * open; storage failure keeps the in-memory default). Shared DOM helpers
     * only — no local el(). */
    var netOpen = true;
    try {
      if (typeof localStorage !== "undefined" && localStorage.getItem("poolNetOpen") === "0") netOpen = false;
    } catch (e) { /* default open stands */ }
    var band = DOM.el(doc, "section", null, "pool-net-band");
    try { band.setAttribute("id", "pool-net-band"); } catch (eBand) { band.id = "pool-net-band"; }
    var bandHead = DOM.el(doc, "div", null, "pool-net-head");
    bandHead.appendChild(DOM.el(doc, "h2", t("pool_net.title", "Pool network")));
    var netToggle = DOM.el(doc, "button", netOpen ? t("pool_net.collapse", "Collapse") : t("pool_net.expand", "Expand"));
    netToggle.type = "button";
    netToggle.className = "subtle-btn";
    try {
      netToggle.setAttribute("aria-expanded", netOpen ? "true" : "false");
      netToggle.setAttribute("aria-controls", "pool-net-body");
    } catch (eAria) { /* label stands */ }
    touchable(netToggle);
    bandHead.appendChild(netToggle);
    band.appendChild(bandHead);
    var netBody = DOM.el(doc, "div", null, "pool-net-body");
    try { netBody.setAttribute("id", "pool-net-body"); } catch (eBody) { netBody.id = "pool-net-body"; }
    netBody.appendChild(DOM.el(doc, "p", t("pool_net.loading", "Loading network…"), "muted"));
    if (!netOpen) { try { netBody.style.display = "none"; } catch (eHide) { /* visible fallback */ } }
    band.appendChild(netBody);
    netToggle.addEventListener("click", function () {
      netOpen = !netOpen;
      try {
        netBody.style.display = netOpen ? "" : "none";
        netToggle.textContent = netOpen ? t("pool_net.collapse", "Collapse") : t("pool_net.expand", "Expand");
        netToggle.setAttribute("aria-expanded", netOpen ? "true" : "false");
      } catch (eTog) { /* visual state stands */ }
      try {
        if (typeof localStorage !== "undefined") localStorage.setItem("poolNetOpen", netOpen ? "1" : "0");
      } catch (eSave) { /* memory-only session */ }
    });
    ctx.wrap.appendChild(band);
    var filters = DOM.el(doc, "div", null, "pools-filters");
    /* Order-free labels (Task 5): either input matches either leg (Task 4
     * searches by_one / both-orders), so positional "Asset A/B" would lie
     * here — "Asset 1/2 (any leg)" tells the truth. The create form below
     * keeps pool.asset_a/b_field ("Asset A/B": op-59 orientation IS
     * positional there). Query keys stay ?a=/?b=. */
    var fA = Forms.labeledInput(doc, t("pool.asset_1_field", "Asset 1 (any leg)") + " ", { placeholder: t("common.symbol_or_id_hint", "symbol or 1.3.x") });
    var fB = Forms.labeledInput(doc, t("pool.asset_2_field", "Asset 2 (any leg)") + " ", { placeholder: t("common.symbol_or_id_hint", "symbol or 1.3.x") });
    var fS = Forms.labeledInput(doc, t("pool.share_asset_field", "Share asset") + " ", { placeholder: t("pool.share_or_pool_hint", "symbol, 1.3.x, or pool 1.19.x") });
    [fA, fB, fS].forEach(function (f) { filters.appendChild(f.row); });
    var sizeLab = DOM.el(doc, "label", t("pool.per_page", "Per page "));
    var sizeSel = doc.createElement("select");
    ["10", "25", "50"].forEach(function (n) {
      var o = doc.createElement("option");
      o.value = n; o.textContent = n;
      if (n === "10") o.selected = true;
      sizeSel.appendChild(o);
    });
    touchable(sizeSel);
    sizeLab.appendChild(sizeSel);
    var sizeWrap = DOM.el(doc, "div", null, "xfer-field");
    sizeWrap.appendChild(sizeLab);
    filters.appendChild(sizeWrap);
    var go = touchable(DOM.el(doc, "button", t("pool.list_btn", "List pools"))); go.type = "button";
    /* Clearable (Task 5): one tap empties all three legs (incl. the BTS
     * default) and reloads unfiltered — empty omits ?a=/?b= in writeQuery. */
    var clearBtn = touchable(DOM.el(doc, "button", t("pool.clear_btn", "Clear"))); clearBtn.type = "button"; clearBtn.className = "subtle-btn";
    filters.appendChild(go);
    filters.appendChild(clearBtn);
    ctx.wrap.appendChild(filters);
    var listBox = DOM.el(doc, "div"); ctx.wrap.appendChild(listBox);
    var mineBox = DOM.el(doc, "div");
    ctx.wrap.appendChild(DOM.el(doc, "h2", t("pool.mine_title", "My pools")));
    ctx.wrap.appendChild(mineBox);
    ctx.wrap.appendChild(DOM.el(doc, "h2", t("pool.create_title", "Create pool")));
    ctx.wrap.appendChild(DOM.el(doc, "p", t("pool.share_help", "Needs a zero-supply non-smartcoin share asset. Create one at #/assets/create first."), "muted"));
    createBox(doc, ctx.wrap, myGen);
    async function resolveOpt(v) {
      v = String(v || "").trim(); if (!v) return null;
      return Asset.describe(v);
    }
    /* pagerBar: Prev / "Page N" / Next. Next stores the page's last id as
     * the following page's startId (list_* paging has no offsets). */
    function pagerBar(pageRows, hasNext) {
      var bar = DOM.el(doc, "div", null, "pools-pager");
      var prev = touchable(DOM.el(doc, "button", t("pool.prev_btn", "‹ Prev"))); prev.type = "button"; prev.className = "subtle-btn";
      prev.disabled = pager.page === 0;
      var note = DOM.el(doc, "span", "Page " + (pager.page + 1), "pools-page");
      var next = touchable(DOM.el(doc, "button", t("pool.next_btn", "Next ›"))); next.type = "button"; next.className = "subtle-btn";
      next.disabled = !hasNext;
      prev.addEventListener("click", function () {
        if (myGen !== gen || pager.page === 0) return;
        pager.page -= 1;
        writeQuery();
        loadPage();
      });
      next.addEventListener("click", function () {
        if (myGen !== gen || !hasNext || !pageRows.length) return;
        pager.page += 1;
        pager.starts[pager.page] = pageRows[pageRows.length - 1].id;
        writeQuery();
        loadPage();
      });
      bar.appendChild(prev); bar.appendChild(note); bar.appendChild(next);
      return bar;
    }
    function loadPage() {
      if (myGen !== gen) return; go.disabled = true; DOM.clear(listBox);
      showStatus(doc, listBox,t("pool.loading", "Loading pools…"));
      Promise.resolve().then(async function () {
        /* Direct pool-id lookup: a 1.19.x in Share asset fetches the pool
         * itself (Pool.get returns joined rows like list) — no asset
         * describe, no pager. Unknown ids surface honestly, never blank. */
        var rawS = String(fS.input.value || "").trim();
        if (POOL_ID_RE.test(rawS)) return { direct: true, rows: [await Pool.get(rawS)] };
        var a = await resolveOpt(fA.input.value), b = await resolveOpt(fB.input.value), s = await resolveOpt(fS.input.value);
        lastResolved.aId = a ? a.id : null;
        lastResolved.bId = b ? b.id : null;
        var rows = await Pool.list({ assetA: a ? a.id : null, assetB: b ? b.id : null,
          share: s ? s.id : null, limit: pager.size + 2, startId: pager.starts[pager.page] });
        return { direct: false, rows: rows || [] };
      }).then(function (res) {
        if (myGen !== gen) return; DOM.clear(listBox);
        var rows = res.rows;
        if (res.direct) {
          var scroller = DOM.el(doc, "div", null, "pools-scroll");
          scroller.appendChild(poolTable(doc, rows));
          listBox.appendChild(scroller);
          listBox.appendChild(DOM.el(doc, "p", t("pool.direct_hit", "Direct pool lookup — pager hidden."), "muted"));
          return;
        }
        /* Drop the inclusive-start duplicate of the previous page's tail. */
        if (pager.page > 0 && rows.length && rows[0].id === pager.starts[pager.page]) rows.shift();
        var hasNext = rows.length > pager.size;
        var pageRows = hasNext ? rows.slice(0, pager.size) : rows;
        var scroller2 = DOM.el(doc, "div", null, "pools-scroll");
        scroller2.appendChild(poolTable(doc, pageRows));
        listBox.appendChild(scroller2);
        listBox.appendChild(pagerBar(pageRows, hasNext));
      }).catch(function (e) {
        if (myGen !== gen) return; DOM.clear(listBox); showError(doc, listBox,e,t("pool.load_failed", "Could not load pools."));
      }).then(function () { go.disabled = false; netRedraw(); });
    }
    function resetAndLoad() {
      if (myGen !== gen) return;
      pager.page = 0; pager.starts = ["1.19.0"];
      writeQuery();
      loadPage();
    }
    go.addEventListener("click", resetAndLoad);
    clearBtn.addEventListener("click", function () {
      if (myGen !== gen) return;
      fA.input.value = "";
      fB.input.value = "";
      fS.input.value = "";
      resetAndLoad();
    });
    /* Enter in any filter field runs the search (plain div, no form —
     * implicit submission does not exist here). */
    [fA, fB, fS].forEach(function (f) {
      f.input.addEventListener("keydown", function (e) {
        if ((e.key === "Enter" || e.keyCode === 13) && myGen === gen) {
          if (e.preventDefault) e.preventDefault();
          resetAndLoad();
        }
      });
    });
    sizeSel.addEventListener("change", function () {
      var n = parseInt(sizeSel.value, 10);
      pager.size = (n === 25 || n === 50) ? n : 10;
      resetAndLoad();
    });
    /* Restore a deep-linked search (Back from a pool detail lands here with
     * the query intact): filters + size + page + page startId. Bad values
     * fall back to defaults — never throw, never blank. */
    (function restoreQuery() {
      var q = readQuery();
      /* BTS default (Task 5): Asset 1 starts at BTS when ?a= is absent; an
       * explicit ?a= (even empty — the Clear path) wins so Back/clear
       * round-trips stay honest. Clearable: empty inputs omit ?a=/?b= in
       * writeQuery and resolve to null (unfiltered) in loadPage. */
      /* Seed precedence (spec §2.2): a shared ?a=/?b= deep link wins, then
       * the global pair the last desk visit wrote (PairContext, session
       * memory), then the BTS default. An EXPLICIT ?a=/?b= (even empty —
       * the Clear path) still wins so Back/clear round-trips stay honest. */
      var hasDeep = Object.prototype.hasOwnProperty.call(q, "a") || Object.prototype.hasOwnProperty.call(q, "b");
      var legs = [];
      if (!hasDeep) {
        try {
          if (typeof PairContext !== "undefined" && PairContext && typeof PairContext.get === "function") legs = PairContext.get() || [];
        } catch (e) { legs = []; }
      }
      if (Object.prototype.hasOwnProperty.call(q, "a")) fA.input.value = String(q.a || "").slice(0, 64);
      else fA.input.value = String(legs[0] || "BTS").slice(0, 64);
      if (Object.prototype.hasOwnProperty.call(q, "b")) fB.input.value = String(q.b || "").slice(0, 64);
      else if (legs[1]) fB.input.value = String(legs[1]).slice(0, 64);
      if (Object.prototype.hasOwnProperty.call(q, "s")) fS.input.value = String(q.s || "").slice(0, 64);
      var n = parseInt(q.size, 10);
      if (n === 25 || n === 50) {
        pager.size = n;
        for (var i = 0; i < sizeSel.options.length; i++) {
          if (sizeSel.options[i].value === String(n)) { sizeSel.selectedIndex = i; break; }
        }
      }
      var p = parseInt(q.page, 10);
      if (Number.isInteger(p) && p > 0 && p < 1000 && POOL_ID_RE.test(String(q.start || ""))) {
        pager.page = p;
        pager.starts[p] = String(q.start);
      }
    })();
    /* Selection bridge install (Task 5 -> Task 6): live raw inputs + last
     * resolved ids. Task 6 calls PoolUI.getSelection() on filter changes. */
    selectionGetter = function () {
      var a = "", b = "", s = "";
      try {
        if (fA && fA.input) a = String(fA.input.value || "").trim();
        if (fB && fB.input) b = String(fB.input.value || "").trim();
        if (fS && fS.input) s = String(fS.input.value || "").trim();
      } catch (eSel) { /* last values stand */ }
      return { a: a, b: b, s: s, aId: lastResolved.aId, bId: lastResolved.bId };
    };
    /* Pool-net canvas (Task 6): paint PoolNetUI into the band when the script
     * loaded; absent leaves the loading note standing. Redraws after every
     * table page so star/union follows the resolved inputs; destroy rides
     * dropSubs so route-leave stops the rAF loop and observer. */
    var netHandle = null;
    try {
      if (typeof PoolNetUI !== "undefined" && PoolNetUI && typeof PoolNetUI.mount === "function") {
        netHandle = PoolNetUI.mount(doc, netBody, getSelection);
        openSubs.push(function () { try { if (netHandle) netHandle.destroy(); } catch (eNet) { /* down */ } });
      }
    } catch (eNetMount) { netHandle = null; }
    function netRedraw() {
      try { if (netHandle && netHandle.redraw) netHandle.redraw(); } catch (e) { /* view stands */ }
    }
    /* Public list loads locked or not. Mine resolves the wallet account when
     * unlocked, else defaults to committee-account 1.2.0 with an honest
     * notice — both are public get_liquidity_pools_by_owner reads, never throws. */
    loadPage();
    (function () {
      var locked = !isUnlockedNow();
      var idP = locked ? Promise.resolve((typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0") : Account.myAccountId();
      idP.then(function (id) { return Account.resolve(id); }).then(function (me) {
        if (myGen !== gen) return;
        if (locked) mineBox.appendChild(viewingAsNotice(doc));
        Pool.mine(me.id).then(function (rows) {
          if (myGen !== gen) return; mineBox.appendChild(poolTable(doc, rows, { mine: true }));
        }).catch(function () { if (myGen === gen) { mineBox.appendChild(DOM.el(doc, "p", t("pool.no_mine", "No owned pools.") + t("pool.owned_hint", " Stake both legs in any pool above — owned pools list here."), "muted")); } });
      }).catch(function (e) { if (myGen === gen) showError(doc, ctx.wrap,e,t("trade.fail_account", "Could not load your account.")); });
    })();
  }
  function createBox(doc, box, myGen) { /* op-59 create: a/b/share resolves, human percents, orientation preview */
    var fA = Forms.labeledInput(doc, t("pool.asset_a_field", "Asset A") + " ", { placeholder: "BTS" });
    var fB = Forms.labeledInput(doc, t("pool.asset_b_field", "Asset B") + " ", { placeholder: "CNY" });
    var fSh = Forms.labeledInput(doc, t("pool.share_asset_field", "Share asset") + " ", { placeholder: t("pool.share_ph", "fresh UIA symbol") });
    var fT = Forms.labeledInput(doc, t("pool.taker_pct_field", "Taker fee %") + " ", { value: "0.5", inputmode: "decimal" });
    var fW = Forms.labeledInput(doc, t("pool.withdrawal_pct_field", "Withdrawal fee %") + " ", { value: "0", inputmode: "decimal" });
    [fA, fB, fSh, fT, fW].forEach(function (f) { box.appendChild(f.row); });
    /* Virgin-mint rule (slice-12 proven: max(raw)): first deposit into an
     * empty pool mints the larger leg — inline so nobody learns it by failing. */
    box.appendChild(DOM.el(doc, "p", t("pool.virgin_note", "First deposit into an empty pool mints shares equal to the larger leg — fund both legs accordingly."), "muted"));
    reviewSection(doc, box, myGen, t("credit.review_create", "Review create"), {
      build: async function () {
        var me = await Account.resolve(await Account.myAccountId());
        var a = await Asset.describe(fA.input.value.trim()), b = await Asset.describe(fB.input.value.trim());
        var sh = await Asset.describe(fSh.input.value.trim());
        var pair = Pool.buildCreate({ accountId: me.id, assetAId: a.id, assetBId: b.id,
          shareId: sh.id, takerHuman: fT.input.value.trim(), withdrawalHuman: fW.input.value.trim() });
        return { pair: pair, fee: await Pool.fee(pair, "1.3.0"), me: me, a: a, b: b, sh: sh,
          prove: async function () {
            try {
              var rows = await Pool.list({ share: sh.id });
              return rows.length ? rows[0] : null;
            } catch (e) { return null; } } };
      },
      rows: function (R, fee) {
        var op = R.pair[1];
        return [[t("account.card_account", "Account"),  whoText(R.me)], [t("pool.asset_a_field", "Asset A"),  R.a.symbol + " (" + R.a.id + ")"],
          [t("pool.asset_b_field", "Asset B"),  R.b.symbol + " (" + R.b.id + ")"], [t("pool.share_asset_field", "Share asset"),  R.sh.symbol + " (" + R.sh.id + ")"],
          [t("pool.orientation_row", "Orientation"),  "A < B by id: " + op.asset_a + " / " + op.asset_b],
          [t("pool.taker_row", "Taker fee"),  pctText(op.taker_fee_percent), "raw " + op.taker_fee_percent],
          [t("pool.withdrawal_row", "Withdrawal fee"),  pctText(op.withdrawal_fee_percent), "raw " + op.withdrawal_fee_percent],
          [t("borrow.fee", "Fee"),  fee.text, "raw " + fee.raw], [t("borrow.network", "Network"),  networkName()]];
      },
      title: t("pool.confirm_create", "Confirm pool create"), ok: function () { return "Pool created."; }, fail: t("credit.could_not_prepare_the_create", "Could not prepare the create.") });
  }
  return { renderPools: renderPools, getSelection: getSelection,
    _ui: { el: DOM.el, touchable: touchable, clearBox: DOM.clear, showError: showError, showStatus: showStatus,
      offlineBox: offlineBox, unlockBox: unlockBox, field: field, tableHead: tableHead,
      feeText: feeText, headBlock: headBlock, amtText: amtText, pctText: pctText, networkName: networkName,
      sendConfirm: sendConfirm, reviewPaid: reviewPaid, reviewSection: reviewSection, deleteCheck: deleteCheck,
      routeReady: routeReady, routeFail: routeFail, autoRetry: autoRetry, dropSubs: dropSubs,
      isUnlockedNow: isUnlockedNow, viewingAsNotice: viewingAsNotice, viewingAsId: VIEWING_AS_ID,
      getSelection: getSelection,
      live: function (g) { return g === gen; } } };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.PoolUI === "undefined") { globalThis.PoolUI = PoolUI; }
if (typeof module !== "undefined") { module.exports = PoolUI; }
