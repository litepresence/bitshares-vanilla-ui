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
  /* textContent-only element (user/chain strings never reach HTML). */
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n; }
  /* Touch floor (#7): interactive elements >= 44px one dimension. */
  function touchable(n) { n.style.minHeight = "44px"; return n; }
  function clearRoot(root) { while (root.firstChild) root.removeChild(root.firstChild); }
  function makeWrap(doc, root) {
    var w = doc.createElement("div"); w.className = "wrap"; root.appendChild(w); return w; }
  /* Inline error panel, never blank: any thrown value maps to a sentence. */
  function showError(doc, wrap, e, fallback) {
    var msg = (e && typeof e.message === "string" && e.message) ? e.message : String(e || fallback || "Unexpected error");
    if (msg.indexOf("not connected") !== -1) msg = "Network unavailable. Check Settings → Nodes and retry.";
    else if (msg.indexOf("unknown-account") !== -1) msg = "Unknown owner account.";
    var err = el(doc, "div", msg, "error");
    err.setAttribute("aria-live", "polite"); wrap.appendChild(err); return err;
  }
  /* Status line for multi-step flows (resolving -> preview). */
  function showStatus(doc, wrap, text) {
    var p = el(doc, "p", text, "muted"); p.setAttribute("aria-live", "polite");
    wrap.appendChild(p); return p; }
  /* Labeled input row with its own inline error slot. */
  function fieldRow(doc, labelText, opts) {
    opts = opts || {};
    var row = el(doc, "div", null, "xfer-field"), label = el(doc, "label", labelText + " ");
    var input = doc.createElement("input"); input.type = opts.type || "text";
    if (opts.inputmode) input.setAttribute("inputmode", opts.inputmode);
    if (opts.id) input.id = opts.id;
    if (opts.value !== undefined && opts.value !== null) input.value = opts.value;
    if (opts.placeholder) input.setAttribute("placeholder", opts.placeholder);
    touchable(input); label.appendChild(input); row.appendChild(label);
    var err = el(doc, "div", "", "error");
    err.setAttribute("aria-live", "polite"); err.style.display = "none"; row.appendChild(err);
    return { row: row, input: input, err: err }; }
  function setFieldError(f, msg) { f.err.textContent = msg || ""; f.err.style.display = msg ? "" : "none"; }

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
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    if (typeof Account === "undefined" || !Account ||
        typeof Format === "undefined" || !Format) {
      showError(doc, wrap, "Worker backend missing: js/account.js or js/format.js failed to load.");
      return;
    }
    if (typeof Chain !== "undefined" && Chain && Chain.status().state !== "open") {
      wrap.appendChild(el(doc, "h1", "Create Worker"));
      wrap.appendChild(el(doc, "p", "Connecting to network…", "muted"));
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
        clearRoot(root);
        showError(doc, makeWrap(doc, root), new Error("not connected"), "Network unavailable.");
      }, 15000);
      return;
    }
    paintForm(doc, root, myGen, { owner: "", begin: "", end: "", pay: "", name: "", url: "", kind: "refund", days: "" });
  }

  /* Creation form: owner + dates + pay + name/url + initializer kind + Preview.
   * State survives Back via P. */
  function paintForm(doc, root, myGen, P) {
    if (myGen !== gen) return;
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    wrap.appendChild(el(doc, "h1", "Create Worker"));
    wrap.appendChild(el(doc, "p", "Draft a worker (op 34). Preview is live; review quotes the live fee, then Sign & Send broadcasts op 34 directly — workers are created by direct op, not by proposal.", "muted"));
    var ownerF = fieldRow(doc, "Owner account ", { id: "cw-owner", value: P.owner, placeholder: "account-name", inputmode: "text" });
    wrap.appendChild(ownerF.row);
    var beginF = fieldRow(doc, "Work begins ", { id: "cw-begin", value: P.begin, type: "datetime-local" });
    wrap.appendChild(beginF.row);
    var endF = fieldRow(doc, "Work ends ", { id: "cw-end", value: P.end, type: "datetime-local" });
    wrap.appendChild(endF.row);
    var payF = fieldRow(doc, "Daily pay (" + CORE_SYMBOL + ") ", { id: "cw-pay", value: P.pay, placeholder: "0.00", inputmode: "decimal" });
    wrap.appendChild(payF.row);
    var nameF = fieldRow(doc, "Worker name ", { id: "cw-name", value: P.name, placeholder: "2026-maintenance", inputmode: "text" });
    wrap.appendChild(nameF.row);
    var urlF = fieldRow(doc, "Proposal URL ", { id: "cw-url", value: P.url, placeholder: "https://…", inputmode: "url" });
    wrap.appendChild(urlF.row);
    var kindRow = el(doc, "div", null, "xfer-field"), kindLab = el(doc, "label", "Pay destination ");
    var kindSel = doc.createElement("select");
    KINDS.forEach(function (o) {
      var opt = doc.createElement("option"); opt.value = o[0]; opt.textContent = o[1];
      if (o[0] === P.kind) opt.selected = true;
      kindSel.appendChild(opt);
    });
    touchable(kindSel); kindLab.appendChild(kindSel); kindRow.appendChild(kindLab);
    wrap.appendChild(kindRow);
    var daysF = fieldRow(doc, "Vesting period (days) ", { id: "cw-days", value: P.days, placeholder: "30", inputmode: "numeric" });
    wrap.appendChild(daysF.row);
    function syncDays() { daysF.row.style.display = (kindSel.value === "vesting") ? "" : "none"; }
    kindSel.addEventListener("change", syncDays); syncDays();
    var previewBtn = touchable(el(doc, "button", "Preview worker"));
    previewBtn.id = "cw-preview"; previewBtn.type = "button"; wrap.appendChild(previewBtn);
    var out = el(doc, "div"); wrap.appendChild(out);
    previewBtn.addEventListener("click", function () {
      [ownerF, beginF, endF, payF, nameF, urlF, daysF].forEach(function (f) { setFieldError(f, ""); });
      out.innerHTML = "";
      P.owner = ownerF.input.value.trim().toLowerCase();
      P.begin = beginF.input.value; P.end = endF.input.value; P.pay = payF.input.value.trim();
      P.name = nameF.input.value.trim(); P.url = urlF.input.value.trim(); P.kind = kindSel.value;
      P.days = daysF.input.value.trim();
      previewBtn.disabled = true;
      var status = showStatus(doc, out, "Resolving owner and checking the draft…");
      previewDraft(P).then(function (R) {
        if (myGen === gen) paintPreview(doc, root, myGen, P, R);
      }).catch(function (e) {
        if (myGen !== gen) return;
        var msg = (e && e.message) ? e.message : String(e || "Could not preview the worker.");
        if (msg === "bad-owner") { msg = "Enter the owner account name."; setFieldError(ownerF, msg); }
        else if (msg === "bad-dates") { msg = "Work end must be after work begin."; setFieldError(endF, msg); }
        else if (msg.indexOf("bad pay") === 0 || msg.indexOf("Pay must be") === 0) setFieldError(payF, msg);
        else if (msg === "bad-name") { msg = "Enter a worker name."; setFieldError(nameF, msg); }
        else if (msg === "bad-kind") { msg = "Pick a pay destination (refund, vesting or burn)."; }
        else if (msg.indexOf("esting period") !== -1) setFieldError(daysF, msg);
        out.removeChild(status); previewBtn.disabled = false;
        showError(doc, out, msg, "Could not preview the worker.");
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
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    wrap.appendChild(el(doc, "h1", "Worker preview (op 34)"));
    var list = el(doc, "dl", null, "xfer-confirm");
    function row(term, text, title) {
      list.appendChild(el(doc, "dt", term));
      var dd = el(doc, "dd", text); if (title) dd.title = title; list.appendChild(dd); }
    row("Owner", R.ownerName + " (" + R.ownerId + ")");
    row("Work begins", R.beginWire);
    row("Work ends", R.endWire);
    row("Daily pay", R.payHuman + " " + CORE_SYMBOL, R.payRaw);
    row("Name", P.name);
    row("URL", P.url || "—");
    row("Pay destination", R.kindWord);
    if (P.kind === "vesting") row("Vesting period", String(R.days) + " days", String(R.days));
    wrap.appendChild(list);
    wrap.appendChild(el(doc, "p", "Daily pay is denominated in the core asset (" + CORE_SYMBOL + ", precision " + CORE_PRECISION + "); the fee is quoted live at review time via get_required_fees.", "muted"));
    var backBtn = touchable(el(doc, "button", "Back"));
    backBtn.id = "cw-back"; backBtn.type = "button"; wrap.appendChild(backBtn);
    backBtn.addEventListener("click", function () { if (myGen === gen) paintForm(doc, root, myGen, P); });
    if (!op34Ready()) {
      wrap.appendChild(el(doc, "p", "Broadcast unavailable: the op-34 serializer is not loaded in this bundle (tx.js/tx-send.js). The preview above is exact — reload the app files and retry. Nothing was broadcast.", "error"));
      return;
    }
    var reviewBtn = touchable(el(doc, "button", "Review fee & sign"));
    reviewBtn.id = "cw-review"; reviewBtn.type = "button"; wrap.appendChild(reviewBtn);
    var out = el(doc, "div"); wrap.appendChild(out);
    reviewBtn.addEventListener("click", function () {
      if (myGen !== gen) return;
      reviewBtn.disabled = true; backBtn.disabled = true;
      out.innerHTML = "";
      var status = showStatus(doc, out, "Estimating fee…");
      var opData = buildOpData(P, R);
      Promise.resolve().then(function () {
        return Tx.fee(34, opData, CORE_ASSET);
      }).then(function (f) {
        opData.fee = { amount: String(f.amount), asset_id: f.asset_id };
        if (myGen !== gen) return;
        out.removeChild(status);
        paintConfirm(doc, out, myGen, P, R, opData, function () {
          reviewBtn.disabled = false; backBtn.disabled = false; out.innerHTML = "";
        }, function () { reviewBtn.disabled = true; });
      }).catch(function (e) {
        if (myGen !== gen) return;
        try { out.removeChild(status); } catch (x) { /* replaced */ }
        showError(doc, out, e, "Fee lookup failed.");
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
    box.appendChild(el(doc, "h3", "Confirm worker (op 34)"));
    var list = el(doc, "dl", null, "xfer-confirm");
    function row(term, text, title) {
      list.appendChild(el(doc, "dt", term));
      var dd = el(doc, "dd", text); if (title) dd.title = title; list.appendChild(dd); }
    row("Owner", R.ownerName + " (" + R.ownerId + ")");
    row("Work begins", R.beginWire);
    row("Work ends", R.endWire);
    row("Daily pay", R.payHuman + " " + CORE_SYMBOL, R.payRaw);
    row("Name", P.name);
    row("URL", P.url || "—");
    row("Pay destination", R.kindWord);
    if (P.kind === "vesting") row("Vesting period", String(R.days) + " days", String(R.days));
    var feeHuman;
    try { feeHuman = Format.formatAmount(String(opData.fee.amount), CORE_PRECISION) + " " + CORE_SYMBOL; }
    catch (e) { feeHuman = String(opData.fee.amount) + " (" + opData.fee.asset_id + ")"; }
    row("Fee (live)", feeHuman + " (core)", String(opData.fee.amount));
    box.appendChild(list);
    var back = touchable(el(doc, "button", "Back")); back.type = "button";
    var send = touchable(el(doc, "button", "Sign & Send")); send.type = "button";
    box.appendChild(back); box.appendChild(send);
    back.addEventListener("click", function () { if (myGen === gen) onBack(); });
    send.addEventListener("click", function () {
      if (myGen !== gen) return;
      send.disabled = true; back.disabled = true;
      var status = showStatus(doc, box, "Preparing transaction…");
      var wif = null, unsigned = null, beforeIds = [];
      Promise.resolve().then(function () {
        if (typeof AssetOps === "undefined" || !AssetOps ||
            typeof AssetOps.sendAndProve !== "function") {
          throw new Error("Worker backend missing: js/asset-ops.js failed to load.");
        }
        wif = (typeof Wallet !== "undefined" && Wallet && Wallet.keys && Wallet.keys.active)
          ? Wallet.keys.active.wif : null;
        if (!wif) throw new Error("wallet-locked");
        status.textContent = "Building transaction…";
        return Tx.buildTx([[34, opData]]);
      }).then(function (u) {
        unsigned = u;
        if (myGen !== gen) throw new Error("stale-view");
        status.textContent = "Reading existing workers…";
        return Chain.db();
      }).then(function (dbId) {
        return Chain.call(dbId, "get_workers_by_account", [R.ownerName]);
      }).then(function (rows) {
        beforeIds = workerIds(rows);
        if (myGen !== gen) throw new Error("stale-view");
        status.textContent = "Broadcasting…";
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
        box.innerHTML = "";
        var ok = el(doc, "p", "Worker " + done.res.proof.id + " created and re-read on chain.", "xfer-ok");
        ok.setAttribute("aria-live", "polite"); box.appendChild(ok);
        box.appendChild(el(doc, "p", "Observed at head block #" + String(done.head) +
          " (" + done.res.via + ").", "muted"));
        var a = doc.createElement("a");
        a.href = "#/account/" + encodeURIComponent(R.ownerName);
        a.textContent = "Open " + R.ownerName; touchable(a); box.appendChild(a);
      }).catch(function (e) {
        if (myGen !== gen) return;
        var msg = (e && e.message) ? e.message : String(e || "Send failed.");
        if (msg === "stale-view") return;
        if (msg === "wallet-locked") msg = "Wallet is locked. Unlock it first, then retry — nothing was broadcast.";
        try { box.removeChild(status); } catch (x) { /* replaced */ }
        showError(doc, box, msg, "Send failed. Check state before retrying (do NOT blindly rebroadcast).");
        send.disabled = false; back.disabled = false;
      });
    });
  }

  return { renderCreateWorker: renderCreateWorker };
})();

if (typeof module !== "undefined") { module.exports = CreateWorkerUI; }
