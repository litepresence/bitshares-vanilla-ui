/* create-worker-ui.js — worker creation form + preview + direct op-34 broadcast.
 * Owns: /create-worker (owner, dates, daily pay, name, url, initializer kind
 *   + vesting days, preview with human-readable rows, live fee, confirm with
 *   Back / Sign & Send, publish, re-read proof, result). Workers are created
 *   by a DIRECT worker_create op (op 34) — NOT enclosed in a proposal (op
 *   22): #4 operations.hpp:90 lists it as a standalone op and worker.cpp
 *   validate() runs on the op itself. So the preview offers broadcast of
 *   [34, opData] with the confirm + fee + re-read proof pattern.
 * Consumes: Account (owner resolve, public), Format (daily-pay string<->raw),
 *   Tx (OP 34 id, fee, buildTx, serializer readiness probe), AssetOps
 *   (sendAndProve: sign-inside + callback/fallback + re-read poll),
 *   Wallet (fresh active WIF at send time, never stored), Chain (db reads:
 *   get_workers_by_account baseline + proof, head-block marker), Store
 *   (connection subscribe). Global CreateWorkerUI only; gen counter tears
 *   down stale work.
 * Refs: App.jsx:612 (CreateWorker); op id + fields <- operations.hpp:90
 *   (/* 34 *\/) + worker.hpp:79-93 + FC :106-107 (wire order); variant order
 *   refund(0)/vesting(1)/burn(2) <- worker.hpp:69-72; rules <-
 *   worker.cpp:30-38 (end > begin, 0 < pay < 1e15, name < 63B, url < 127B);
 *   pay unit = core asset BTS precision 5 (config.hpp:29-30; assumption
 *   stated in the preview); worker reads <- database_api.hpp:1196-1213
 *   (get_workers_by_account takes a name or id); the returned object names
 *   its owner worker_account <- worker_object.hpp:111.
 * Created by: stub-queue build (matrix §A row A27); op-34 serializer +
 *   direct-broadcast wiring by the worker-create gap task.
 */
var CreateWorkerUI = (function () {
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
  var CORE_PRECISION = 5, CORE_SYMBOL = "BTS";
  var CORE_ASSET = "1.3.0";
  /* Initializer kinds: [value, label]. Labels double as the preview wording
   * (kindLabel) so the select and the rows can never disagree. */
  var KINDS = [["refund", "Refund — unspent pay returns to the reserve pool"],
    ["vesting", "Vesting — pay accrues in a vesting balance"],
    ["burn", "Burn — unspent pay is destroyed"]];
  function kindLabel(kind) {
    for (var i = 0; i < KINDS.length; i++) if (KINDS[i][0] === kind) return KINDS[i][1];
    return String(kind);
  }
  /* No local el/clearRoot — use DOM.el, DOM.clear */
  /* Touch floor (#7): interactive elements >= 44px one dimension. */
  // using global touchable from js/utils/touchable.js
  /* clearRoot removed — use DOM.clear */
  function makeWrap(doc, root) {
    var w = doc.createElement("div"); w.className = "wrap"; root.appendChild(w); return w; }
  /* Inline error panel, never blank: any thrown value maps to a sentence. */
  function showError(doc, wrap, e, fallback) {
    var msg = (e && typeof e.message === "string" && e.message) ? e.message : String(e || fallback || t("createworker.unexpected_error", "Unexpected error"));
    if (msg.indexOf("not connected") !== -1) msg = t("createworker.network_unavailable_check_settings_nodes_and", "Network unavailable. Check Settings → Nodes and retry.");
    else if (msg.indexOf("unknown-account") !== -1) msg = t("createworker.unknown_owner_account", "Unknown owner account.");
    var err = DOM.error(wrap, msg);
    return err;
  }
  /* Status line for multi-step flows (resolving -> preview). */
  function showStatus(doc, wrap, text) {
    var p = DOM.status(wrap, text);
    return p; }
  /* Labeled input row with its own inline error slot (Forms builds the
   * row; the err div stays per-view — Forms.fieldRow returns row only). */
  function setFieldError(f, msg) { f.err.textContent = msg || ""; f.err.style.display = msg ? "" : t("createworker.none", "none"); }

  /* Readiness: can this bundle broadcast op 34 today? True when the OP id
   * maps to 34, the serializer exists in tx.js, and the fee/build/sign
   * entry points exist in tx-send.js (supports stale cached bundles: the
   * preview then shows the honest backend message, nothing broadcasts). */
  function op34Ready() {
    try {
      if (typeof Tx === "undefined" || !Tx || !Tx.OP || Tx.OP.worker_create !== 34) return false;
      if (!Tx._ser || typeof Tx._ser.serializeWorkerCreateOp !== "function") return false;
      if (typeof Tx.fee !== "function" || typeof Tx.buildTx !== "function" ||
          typeof Tx.sign !== "function") return false;
      return true;
    } catch (e) { return false; }
  }

  /* Route entry. Gates backends, waits for the shared socket (transfer-ui.js
   * connect-wait pattern), then paints the form. */
  function renderCreateWorker(root) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    var myGen = ++gen;
    DOM.clear(root);
    var wrap = makeWrap(doc, root);
    if (typeof Account === "undefined" || !Account ||
        typeof Format === "undefined" || !Format) {
      showError(doc, wrap, t("createworker.worker_backend_missing_js_account_js_or_js_fo", "Worker backend missing: js/account.js or js/format.js failed to load."));
      return;
    }
    if (typeof Chain !== "undefined" && Chain && Chain.status().state !== "open") {
      wrap.appendChild(DOM.el(doc, "h1", t("createworker.create_worker", "Create Worker")));
      wrap.appendChild(DOM.el(doc, "p", t("createworker.connecting_to_network", "Connecting to network…"), "muted"));
      var hashAtEntry = (typeof location !== "undefined" && location.hash) || "", settled = false;
      var off = Store.subscribe("connection", function (st) {
        if (settled || myGen !== gen) return;
        if (st && st.state === "open") {
          settled = true; off(); clearTimeout(timer);
          if (typeof location === "undefined" || location.hash === hashAtEntry) renderCreateWorker(root);
        }
      });
      var timer = setTimeout(function () {
        if (settled || myGen !== gen) return;
        settled = true; off();
        if (typeof location !== "undefined" && location.hash !== hashAtEntry) return;
        DOM.clear(root);
        var failWrap = makeWrap(doc, root);
        failWrap.appendChild(DOM.el(doc, "h1", t("createworker.create_worker", "Create Worker")));
        showError(doc, failWrap, new Error("not connected"), t("createworker.network_unavailable", "Network unavailable."));
        var cwstat = DOM.el(doc, "p", "", "muted");
        try { cwstat.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
        failWrap.appendChild(cwstat);
        var cwrow = DOM.el(doc, "div", null, "pools-offline-row");
        failWrap.appendChild(cwrow);
    var cwretry = touchable(DOM.el(doc, "button", t("fees.retry", "Retry"))); cwretry.type = "button"; cwretry.className = "btn-ghost";
        cwretry.type = "button";
        cwrow.appendChild(cwretry);
        var cwoff = null;
        try { cwoff = (typeof Offline !== "undefined" && Offline) ? Offline : null; } catch (e) { cwoff = null; }
        if (cwoff && typeof cwoff.wire === "function") {
          try { cwoff.wire(cwretry, cwstat, function () { renderCreateWorker(root); }, t); } catch (e) { cwretry.addEventListener("click", function () { renderCreateWorker(root); }); }
        } else {
          cwretry.addEventListener("click", function () { renderCreateWorker(root); });
        }
        var cwlink = null;
        if (cwoff && typeof cwoff.settingsLink === "function") {
          try { cwlink = cwoff.settingsLink(doc, t); } catch (e) { cwlink = null; }
        }
        if (!cwlink) {
          cwlink = DOM.el(doc, "a", t("notice.open_settings", "Open Settings"));
          try { cwlink.setAttribute("href", "#/settings"); } catch (e) { /* label stands */ }
          cwlink.className = "subtle-btn";
        }
        cwrow.appendChild(cwlink);
      }, 15000);
      /* Automated handshake on entry (shared Offline helper owns the throttle). */
      try { if (typeof Offline !== "undefined" && Offline && typeof Offline.ensure === "function") Offline.ensure(); } catch (e) { /* wait above covers */ }
      return;
    }
    paintForm(doc, root, myGen, { owner: "", begin: "", end: "", pay: "", name: "", url: "", kind: "refund", days: "" });
  }

  /* Creation form: owner + dates + pay + name/url + initializer kind + Preview.
   * State survives Back via P. */
  function paintForm(doc, root, myGen, P) {
    if (myGen !== gen) return;
    DOM.clear(root);
    var wrap = makeWrap(doc, root);
    wrap.appendChild(DOM.el(doc, "h1", t("createworker.create_worker", "Create Worker")));
    wrap.appendChild(DOM.el(doc, "p", t("createworker.draft_a_worker_op_34_preview_is_live_review_q", "Draft a worker (op 34). Preview is live; review quotes the live fee, then Sign & Send broadcasts op 34 directly — workers are created by direct op, not by proposal."), "muted"));
    /* LOW punchlist: lifetime-member requirement note + per-field helper
     * texts (CreateWorker concept). Batch-3 i18n: keyed, no new routes. */
    wrap.appendChild(DOM.el(doc, "p", t("createworker.publishing_a_worker_requires_a_lifeti", "Publishing a worker requires a lifetime-member account — basic accounts cannot pay this fee. The owner below must already be upgraded."), "muted"));
    var ownerF = Forms.labeledInput(doc, t("createworker.owner_account", "Owner account ") + " ", { id: "cw-owner", value: P.owner, placeholder: "account-name", inputmode: "text" });
    ownerF.err = DOM.el(doc, "div", "", "error");
    ownerF.err.setAttribute("aria-live", "polite"); ownerF.err.style.display = "none"; ownerF.row.appendChild(ownerF.err);
    wrap.appendChild(ownerF.row);
    wrap.appendChild(DOM.el(doc, "p", t("createworker.owner_pays_the_fee_and_receives_the_", "Owner pays the fee and receives the worker pay — use a lifetime-member account you control."), "muted"));
    var beginF = Forms.labeledInput(doc, t("createworker.work_begins", "Work begins ") + " ", { id: "cw-begin", value: P.begin, type: "datetime-local" });
    beginF.err = DOM.el(doc, "div", "", "error");
    beginF.err.setAttribute("aria-live", "polite"); beginF.err.style.display = "none"; beginF.row.appendChild(beginF.err);
    wrap.appendChild(beginF.row);
    wrap.appendChild(DOM.el(doc, "p", t("createworker.start_date_must_be_before_the_end_da", "Start date must be before the end date (chain rule) — pick both in UTC."), "muted"));
    var endF = Forms.labeledInput(doc, t("createworker.work_ends", "Work ends ") + " ", { id: "cw-end", value: P.end, type: "datetime-local" });
    endF.err = DOM.el(doc, "div", "", "error");
    endF.err.setAttribute("aria-live", "polite"); endF.err.style.display = "none"; endF.row.appendChild(endF.err);
    wrap.appendChild(endF.row);
    wrap.appendChild(DOM.el(doc, "p", t("createworker.end_date_must_be_after_the_start_dat", "End date must be after the start date; pay accrues only inside this window."), "muted"));
    var payF = Forms.labeledInput(doc, t("createworker.daily_pay_tpl", "Daily pay (%(sym)s) ", { sym: CORE_SYMBOL }) + " ", { id: "cw-pay", value: P.pay, placeholder: "0.00", inputmode: "decimal" });
    payF.err = DOM.el(doc, "div", "", "error");
    payF.err.setAttribute("aria-live", "polite"); payF.err.style.display = "none"; payF.row.appendChild(payF.err);
    wrap.appendChild(payF.row);
    wrap.appendChild(DOM.el(doc, "p", t("createworker.daily_pay_in_core_asset_bts_precision", "Daily pay in core asset (BTS, precision 5), greater than zero and below the chain maximum."), "muted"));
    var nameF = Forms.labeledInput(doc, t("createworker.worker_name", "Worker name ") + " ", { id: "cw-name", value: P.name, placeholder: "2026-maintenance", inputmode: "text" });
    nameF.err = DOM.el(doc, "div", "", "error");
    nameF.err.setAttribute("aria-live", "polite"); nameF.err.style.display = "none"; nameF.row.appendChild(nameF.err);
    wrap.appendChild(nameF.row);
    wrap.appendChild(DOM.el(doc, "p", t("createworker.short_name_under_63_bytes_shown_on_th", "Short name under 63 bytes — shown on the voting page."), "muted"));
    var urlF = Forms.labeledInput(doc, t("createworker.proposal_url", "Proposal URL ") + " ", { id: "cw-url", value: P.url, placeholder: "https://…", inputmode: "url" });
    urlF.err = DOM.el(doc, "div", "", "error");
    urlF.err.setAttribute("aria-live", "polite"); urlF.err.style.display = "none"; urlF.row.appendChild(urlF.err);
    wrap.appendChild(urlF.row);
    wrap.appendChild(DOM.el(doc, "p", t("createworker.link_to_the_full_proposal_text_under_1", "Link to the full proposal text, under 127 bytes."), "muted"));
    var kindOpts = KINDS.map(function (o) { return [o[0], t("createworker.kind_" + o[0], o[1])]; });
    var kindBundle = Forms.labeledSelect(doc, t("createworker.pay_destination", "Pay destination "), kindOpts, P.kind);
    var kindRow = kindBundle.row, kindSel = kindBundle.select;
    wrap.appendChild(kindRow);
    var daysF = Forms.labeledInput(doc, "Vesting period (days)  ", { id: "cw-days", value: P.days, placeholder: "30", inputmode: "numeric" });
    daysF.err = DOM.el(doc, "div", "", "error");
    daysF.err.setAttribute("aria-live", "polite"); daysF.err.style.display = "none"; daysF.row.appendChild(daysF.err);
    wrap.appendChild(daysF.row);
    wrap.appendChild(DOM.el(doc, "p", t("createworker.vesting_choice_only_whole_days_0_6553", "Vesting choice only: whole days 0..65535 for the vesting pay destination; hidden otherwise."), "muted"));
    function syncDays() { daysF.row.style.display = (kindSel.value === "vesting") ? "" : t("createworker.none", "none"); }
    kindSel.addEventListener("change", syncDays); syncDays();
    var previewBtn = touchable(DOM.el(doc, "button", t("createworker.preview_worker", "Preview worker")));
    previewBtn.id = "cw-preview"; previewBtn.type = "button"; wrap.appendChild(previewBtn);
    var out = DOM.el(doc, "div"); wrap.appendChild(out);
    previewBtn.addEventListener("click", function () {
      [ownerF, beginF, endF, payF, nameF, urlF, daysF].forEach(function (f) { setFieldError(f, ""); });
      DOM.clear(out);
      P.owner = ownerF.input.value.trim().toLowerCase();
      P.begin = beginF.input.value; P.end = endF.input.value; P.pay = payF.input.value.trim();
      P.name = nameF.input.value.trim(); P.url = urlF.input.value.trim(); P.kind = kindSel.value;
      P.days = daysF.input.value.trim();
      previewBtn.disabled = true;
      var status = showStatus(doc, out, t("createworker.resolving_owner_and_checking_the_draft", "Resolving owner and checking the draft…"));
      previewDraft(P).then(function (R) {
        if (myGen === gen) paintPreview(doc, root, myGen, P, R);
      }).catch(function (e) {
        if (myGen !== gen) return;
        var msg = (e && e.message) ? e.message : String(e || t("createworker.could_not_preview_the_worker", "Could not preview the worker."));
        if (msg === "bad-owner") { msg = t("createworker.enter_the_owner_account_name", "Enter the owner account name."); setFieldError(ownerF, msg); }
        else if (msg === "bad-dates") { msg = t("createworker.work_end_must_be_after_work_begin", "Work end must be after work begin."); setFieldError(endF, msg); }
        else if (msg.indexOf("bad pay") === 0 || msg.indexOf("Pay must be") === 0) setFieldError(payF, msg);
        else if (msg === "bad-name") { msg = t("createworker.enter_a_worker_name", "Enter a worker name."); setFieldError(nameF, msg); }
        else if (msg === "bad-kind") { msg = t("createworker.pick_a_pay_destination_refund_vesting_or_burn", "Pick a pay destination (refund, vesting or burn)."); }
        else if (msg.indexOf("esting period") !== -1) setFieldError(daysF, msg);
        out.removeChild(status); previewBtn.disabled = false;
        showError(doc, out, msg, t("createworker.could_not_preview_the_worker", "Could not preview the worker."));
      });
    });
  }

  /* Validate + resolve: owner via Account.resolve, dates end > begin
   * (worker.cpp rule), pay string -> raw via Format (BTS precision 5),
   * initializer kind -> canonical [type, data] array form (vesting needs an
   * explicit whole-days period for pay_vesting_period_days — no silent 0).
   * Integers stay strings; no float touches money. */
  async function previewDraft(P) {
    if (!P.owner) throw new Error("bad-owner");
    var owner;
    try { owner = await Account.resolve(P.owner); }
    catch (e) { throw new Error((e && e.message) || "unknown-account"); }
    var beginSecs = Date.parse(P.begin) / 1000, endSecs = Date.parse(P.end) / 1000;
    if (!isFinite(beginSecs) || !isFinite(endSecs) || endSecs <= beginSecs) throw new Error("bad-dates");
    var payRaw;
    try { payRaw = Format.parseAmount(P.pay, CORE_PRECISION); }
    catch (e) { throw new Error(e && e.message ? e.message : "bad pay"); }
    if (!/[1-9]/.test(payRaw)) throw new Error("Pay must be greater than zero.");
    if (!P.name) throw new Error("bad-name");
    if (P.kind !== "refund" && P.kind !== "vesting" && P.kind !== "burn") throw new Error("bad-kind");
    var days = null;
    if (P.kind === "vesting") {
      if (!/^\d+$/.test(P.days)) throw new Error("Enter the vesting period in whole days (0..65535).");
      days = parseInt(P.days, 10);
      if (days > 65535) throw new Error("Vesting period must be 0..65535 days.");
    }
    var init = (P.kind === "refund") ? [0, {}] : (P.kind === "burn") ? [2, {}]
      : [1, { pay_vesting_period_days: days }];
    function wire(ms) { return new Date(ms).toISOString().slice(0, 19); }
    return { ownerId: owner.id, ownerName: owner.name,
      beginWire: wire(beginSecs * 1000), endWire: wire(endSecs * 1000),
      payRaw: payRaw, payHuman: Format.formatAmount(payRaw, CORE_PRECISION),
      days: days, init: init, kindWord: kindLabel(P.kind) };
  }

  /* Fresh op-34 JSON from the validated draft (fee placeholder filled live
   * at review time via get_required_fees in 1.3.0). daily_pay stays the raw
   * digit string; dates stay the UTC wire shape; initializer is the
   * canonical [type, data] array form. */
  function buildOpData(P, R) {
    return { fee: { amount: "0", asset_id: CORE_ASSET }, owner: R.ownerId,
      work_begin_date: R.beginWire, work_end_date: R.endWire, daily_pay: R.payRaw,
      name: P.name, url: P.url || "", initializer: R.init };
  }

  /* Object list -> id list (pre-broadcast baseline for the new-worker proof). */
  function workerIds(rows) {
    var out = [];
    if (Array.isArray(rows)) for (var i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i].id) out.push(rows[i].id);
    }
    return out;
  }

  /* Re-read proof: poll get_workers_by_account until a worker appears that
   * was NOT in the pre-broadcast baseline and matches owner + name + daily
   * pay. Returns the worker object or null. Chain objects name the owner
   * worker_account (worker_object.hpp:111), not owner. */
  async function proveWorker(ownerRef, ownerId, name, payRaw, beforeIds) {
    var dbId = await Chain.db();
    var rows = await Chain.call(dbId, "get_workers_by_account", [ownerRef]);
    if (!Array.isArray(rows)) return null;
    for (var i = 0; i < rows.length; i++) {
      var w = rows[i] || {};
      if (beforeIds.indexOf(w.id) !== -1) continue;
      if (String(w.worker_account) === String(ownerId) && String(w.name) === String(name) &&
          String(w.daily_pay) === String(payRaw)) return w;
    }
    return null;
  }

  /* Preview screen: human-readable op-34 rows + live-fee review. The review
   * quotes get_required_fees, then the confirm below offers Back /
   * Sign & Send for the DIRECT [34, opData] broadcast (worker_create is a
   * direct op, never enclosed in a proposal — see header). */
  function paintPreview(doc, root, myGen, P, R) {
    if (myGen !== gen) return;
    DOM.clear(root);
    var wrap = makeWrap(doc, root);
    wrap.appendChild(DOM.el(doc, "h1", t("createworker.worker_preview_op_34", "Worker preview (op 34)")));
    var list = DOM.el(doc, "dl", null, "xfer-confirm");
    function row(term, text, title) {
      list.appendChild(DOM.el(doc, "dt", term));
      var dd = DOM.el(doc, "dd", text); if (title) dd.title = title; list.appendChild(dd); }
    row(t("createworker.owner", "Owner"), R.ownerName + " (" + R.ownerId + ")");
    row(t("createworker.work_begins_2", "Work begins"), R.beginWire);
    row(t("createworker.work_ends_2", "Work ends"), R.endWire);
    row(t("createworker.daily_pay", "Daily pay"), R.payHuman + " " + CORE_SYMBOL, R.payRaw);
    row(t("createworker.name", "Name"), P.name);
    row(t("createworker.url", "URL"), P.url || "—");
    row(t("createworker.pay_destination_2", "Pay destination"), t("createworker.kind_" + P.kind, R.kindWord));
    if (P.kind === "vesting") row("Vesting period", String(R.days) + " days", String(R.days));
    wrap.appendChild(list);
    wrap.appendChild(DOM.el(doc, "p", t("createworker.pay_denom_note", "Daily pay is denominated in the core asset (%(sym)s, precision %(prec)s); the fee is quoted live at review time via get_required_fees.", { sym: CORE_SYMBOL, prec: CORE_PRECISION }), "muted"));
    var backBtn = touchable(DOM.el(doc, "button", t("createworker.back", "Back"))); backBtn.id = "cw-back"; backBtn.type = "button"; backBtn.className = "btn-ghost";
    backBtn.id = "cw-back"; backBtn.type = "button"; wrap.appendChild(backBtn);
    backBtn.addEventListener("click", function () { if (myGen === gen) paintForm(doc, root, myGen, P); });
    if (!op34Ready()) {
      wrap.appendChild(DOM.el(doc, "p", t("createworker.broadcast_unavailable_the_op_34_serializer_is", "Broadcast unavailable: the op-34 serializer is not loaded in this bundle (tx.js/tx-send.js). The preview above is exact — reload the app files and retry. Nothing was broadcast."), "error"));
      return;
    }
    var reviewBtn = touchable(DOM.el(doc, "button", t("createworker.review_fee_sign", "Review fee & sign")));
    reviewBtn.id = "cw-review"; reviewBtn.type = "button"; wrap.appendChild(reviewBtn);
    var out = DOM.el(doc, "div"); wrap.appendChild(out);
    reviewBtn.addEventListener("click", function () {
      if (myGen !== gen) return;
      reviewBtn.disabled = true; backBtn.disabled = true;
      DOM.clear(out);
      var status = showStatus(doc, out, t("createworker.estimating_fee", "Estimating fee…"));
      var opData = buildOpData(P, R);
      Promise.resolve().then(function () {
        return Tx.fee(34, opData, CORE_ASSET);
      }).then(function (f) {
        opData.fee = { amount: String(f.amount), asset_id: f.asset_id };
        if (myGen !== gen) return;
        out.removeChild(status);
        paintConfirm(doc, out, myGen, P, R, opData, function () {
          reviewBtn.disabled = false; backBtn.disabled = false; DOM.clear(out);
        }, function () { reviewBtn.disabled = true; });
      }).catch(function (e) {
        if (myGen !== gen) return;
        try { out.removeChild(status); } catch (x) { /* replaced */ }
        showError(doc, out, e, t("createworker.fee_lookup_failed", "Fee lookup failed."));
        reviewBtn.disabled = false; backBtn.disabled = false;
      });
    });
  }

  /* Confirm screen: named rows + live fee + Back / Sign & Send. Sign reads
   * the fresh WIF (never stored), builds [[34, opData]], and publishes via
   * AssetOps.sendAndProve with the get_workers_by_account re-read proof;
   * the result names the new worker id + head block. onBack restores the
   * review button; onSent locks it so a created worker can never be
   * double-signed from a stale confirm. */
  function paintConfirm(doc, box, myGen, P, R, opData, onBack, onSent) {
    box.appendChild(DOM.el(doc, "h2", t("createworker.confirm_worker_op_34", "Confirm worker (op 34)")));
    var list = DOM.el(doc, "dl", null, "xfer-confirm");
    function row(term, text, title) {
      list.appendChild(DOM.el(doc, "dt", term));
      var dd = DOM.el(doc, "dd", text); if (title) dd.title = title; list.appendChild(dd); }
    row(t("createworker.owner", "Owner"), R.ownerName + " (" + R.ownerId + ")");
    row(t("createworker.work_begins_2", "Work begins"), R.beginWire);
    row(t("createworker.work_ends_2", "Work ends"), R.endWire);
    row(t("createworker.daily_pay", "Daily pay"), R.payHuman + " " + CORE_SYMBOL, R.payRaw);
    row(t("createworker.name", "Name"), P.name);
    row(t("createworker.url", "URL"), P.url || "—");
    row(t("createworker.pay_destination_2", "Pay destination"), t("createworker.kind_" + P.kind, R.kindWord));
    if (P.kind === "vesting") row("Vesting period", String(R.days) + " days", String(R.days));
    var feeHuman;
    try { feeHuman = Format.formatAmount(String(opData.fee.amount), CORE_PRECISION) + " " + CORE_SYMBOL; }
    catch (e) { feeHuman = String(opData.fee.amount) + " (" + opData.fee.asset_id + ")"; }
    row(t("createworker.fee_live", "Fee (live)"), feeHuman + " (core)", String(opData.fee.amount));
    box.appendChild(list);
    var back = touchable(DOM.el(doc, "button", t("createworker.back", "Back"))); back.type = "button"; back.className = "btn-ghost";
    var send = touchable(DOM.el(doc, "button", t("createworker.sign_send", "Sign & Send"))); send.type = "button";
    box.appendChild(back); box.appendChild(send);
    back.addEventListener("click", function () { if (myGen === gen) onBack(); });
    send.addEventListener("click", function () {
      if (myGen !== gen) return;
      send.disabled = true; back.disabled = true;
      var status = showStatus(doc, box, t("createworker.preparing_transaction", "Preparing transaction…"));
      var wif = null, unsigned = null, beforeIds = [];
      Promise.resolve().then(function () {
        if (typeof AssetOps === "undefined" || !AssetOps ||
            typeof AssetOps.sendAndProve !== "function") {
          throw new Error(t("createworker.worker_backend_missing_js_asset_ops_js_failed", "Worker backend missing: js/asset-ops.js failed to load."));
        }
        wif = (typeof Wallet !== "undefined" && Wallet && Wallet.keys && Wallet.keys.active)
          ? Wallet.keys.active.wif : null;
        if (!wif) throw new Error("wallet-locked");
        status.textContent = t("createworker.building_transaction", "Building transaction…");
        return Tx.buildTx([[34, opData]]);
      }).then(function (u) {
        unsigned = u;
        if (myGen !== gen) throw new Error("stale-view");
        status.textContent = t("createworker.reading_existing_workers", "Reading existing workers…");
        return Chain.db();
      }).then(function (dbId) {
        return Chain.call(dbId, "get_workers_by_account", [R.ownerName]);
      }).then(function (rows) {
        beforeIds = workerIds(rows);
        if (myGen !== gen) throw new Error("stale-view");
        status.textContent = t("createworker.broadcasting", "Broadcasting…");
        return AssetOps.sendAndProve(unsigned, wif, function () {
          return proveWorker(R.ownerName, R.ownerId, P.name, R.payRaw, beforeIds);
        });
      }).then(function (res) {
        if (myGen !== gen) throw new Error("stale-view");
        return Chain.db().then(function (dbId) {
          return Chain.call(dbId, "get_dynamic_global_properties", []).then(function (props) {
            return { res: res, head: (props && props.head_block_number) || 0 };
          }, function () { return { res: res, head: 0 }; });
        });
      }).then(function (done) {
        if (!done || myGen !== gen) return;
        onSent();
        DOM.clear(box);
        var ok = DOM.el(doc, "p", "Worker " + done.res.proof.id + " created and re-read on chain.", "xfer-ok");
        ok.setAttribute("aria-live", "polite"); box.appendChild(ok);
        box.appendChild(DOM.el(doc, "p", "Observed at head block #" + String(done.head) +
          " (" + done.res.via + ").", "muted"));
        var a = doc.createElement("a");
        a.href = "#/account/" + encodeURIComponent(R.ownerName);
        a.textContent = t("account.open_prefix", "Open ") + R.ownerName; a.className = "subtle-btn"; touchable(a); box.appendChild(a);
      }).catch(function (e) {
        if (myGen !== gen) return;
        var msg = (e && e.message) ? e.message : String(e || t("createworker.send_failed", "Send failed."));
        if (msg === "stale-view") return;
        if (msg === "wallet-locked") msg = t("createworker.wallet_is_locked_unlock_it_first_then_retry_n", "Wallet is locked. Unlock it first, then retry — nothing was broadcast.");
        try { box.removeChild(status); } catch (x) { /* replaced */ }
        showError(doc, box, msg, t("createworker.send_failed_check_state_before_retrying_do_no", "Send failed. Check state before retrying (do NOT blindly rebroadcast)."));
        send.disabled = false; back.disabled = false;
      });
    });
  }

  return { renderCreateWorker: renderCreateWorker };
})();

if (typeof module !== "undefined") { module.exports = CreateWorkerUI; }
