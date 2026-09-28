/* proposal-ui.js — #/proposals + #/proposals/:id + nested-op human renderer + op-22/23/24 confirms.
 * Owns: proposal desk (table + my-proposals filter + create form with a
 *   transfer/whitelist/ticket inner-op builder), proposal detail (named fields,
 *   countdown, approval sets, NESTED human inner-op table via renderInnerOp),
 *   approve/unapprove/delete panels, NAMED-row confirms (never bare ids where
 *   a name/symbol exists, never raw JSON), and the shared DOM/confirm helpers
 *   (ProposalUI._ui) reused by ticket-ui.js + misc-ui.js (credit-ui.js _ui
 *   precedent: route gate, confirm+publish flow, tables, human formatters).
 *   No serializers here (tx.js Task-1 owner), no signing (WIF passes opaquely
 *   to Proposal.sendAndProve).
 * Consumes: Proposal (reads/builders/fee/sendAndProve/durToHuman),
 *   ProposalTicket (lock WORDS, optional), ProposalMisc (listing WORDS,
 *   optional), Tx (buildTx), Format (string money math only), Account
 *   (resolve), Asset (describe), Wallet (unlock + memory WIF), Chain, Store.
 *   Exposes global ProposalUI only.
 * Created by: building-vanilla-slices skill, slice-14-proposals plan Task 3.
 * CHAIN TRUTH (#4 wins): op-22/23/24 fields <- proposal.hpp:70-82/:119-165;
 *   display WORDS <- ProposedOperation.jsx:185 + Transaction.jsx:1703-1888
 *   (port the WORDS, not the files); unknown inner type -> honest fallback row.
 * MONEY DISCIPLINE (#6): amounts stay RAW digit strings until Format renders
 *   them at THEIR asset precision (joined via lookup_asset_symbols). No
 *   Number()/parseFloat on money — ever. Timestamps use Date only.
 */
var ProposalUI = (function () {
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
  var gen = 0, subs = [];
  var OP_NAMES = { 0: "transfer", 1: "limit order create", 2: "limit order cancel", 5: "account create",
    6: "account update", 7: "whitelist", 10: "asset create", 14: "asset issue",
    22: "proposal create", 23: "proposal update", 24: "proposal delete", 32: "vesting create",
    33: "vesting withdraw", 37: "balance claim", 54: "authority create", 55: "authority update",
    56: "authority delete", 57: "ticket create", 58: "ticket update" };
  /* Op index -> short name (unknown indexes stay "operation type N", never blank). */
  function opName(t) {
    if (OP_NAMES[t]) return t("proposal.op_" + t, OP_NAMES[t]);
    return t("proposal.op_unknown", "operation type %(n)s", { n: t });
  }
  var ERRMAP = [["not-connected", "Network unavailable. Check Settings → Nodes and retry."], ["wallet-locked", "Wallet is locked."],
    ["unknown-proposal", "Unknown proposal."], ["unknown-ticket", "Unknown ticket."], ["unknown-vesting", "Unknown vesting balance."],
    ["unknown-authority", "Unknown custom authority."], ["unknown-account", "Unknown account."], ["unknown-asset", "Unknown asset."],
    ["bad-lock-type", "Bad lock type — pick one of the five."], ["no-claimables", "Nothing claimable for this account."],
    ["invoice-unparseable", "This invoice link cannot be parsed."], ["downgrade-unproven", "Ticket downgrades are unproven — pick the current lock or a longer one."],
    ["restrictions-unproven", "Restrictions are unproven — create with zero restrictions until testnet proves them."],
    ["blind-disabled", "Blind transfers are disabled: they need vendored commitment/range-proof crypto (read-only lookup only)."],
    ["method-missing", "This node lacks the read method. Try another node."]];
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text; return n;
  }
  function touchable(n) { n.style.minHeight = "44px"; return n; }
  function clearBox(b) { while (b.firstChild) b.removeChild(b.firstChild); }
  function showError(doc, wrap, e, fallback) {
    var m = (e && e.message) ? e.message : String(e || fallback || t("proposal.unexpected_error", "Unexpected error"));
    ERRMAP.forEach(function (p) { if (m.indexOf(p[0]) !== -1) m = t("proposal.err_" + p[0].replace(/-/g, "_"), p[1]); });
    var err = el(doc, "div", m, "error"); err.setAttribute("aria-live", "polite"); wrap.appendChild(err); return err;
  }
  function showStatus(doc, wrap, text) {
    var p = el(doc, "p", text, "muted"); p.setAttribute("aria-live", "polite"); wrap.appendChild(p); return p;
  }
  function offlineBox(doc, wrap, retryFn) { /* Retry panel: copy depends on
    * actual connection (unknown-id failures while connected must not claim
    * the network is down). */
    var open = (typeof Chain !== "undefined" && Chain && Chain.status && Chain.status().state === "open");
    wrap.appendChild(el(doc, "p", open
      ? t("proposal.retry_load", "Retry loading.")
      : t("proposal.network_unavailable_check_settings_nodes_and", "Network unavailable. Check Settings → Nodes and retry."), "muted"));
    var b = touchable(el(doc, "button", t("proposal.retry", "Retry"))); b.type = "button";
    b.addEventListener("click", retryFn); wrap.appendChild(b);
  }
  function unlockBox(doc, wrap, retry) {
    wrap.appendChild(el(doc, "p", t("proposal.wallet_is_locked_enter_your_password_to_conti", "Wallet is locked. Enter your password to continue."), "muted"));
    var inp = doc.createElement("input"); inp.type = "password"; touchable(inp); wrap.appendChild(inp);
    var b = touchable(el(doc, "button", t("proposal.unlock", "Unlock"))); b.type = "button"; wrap.appendChild(b);
    b.addEventListener("click", function () { b.disabled = true;
      Wallet.unlock(inp.value).then(retry).catch(function (e) { b.disabled = false; showError(doc, wrap, e, t("proposal.unlock_failed", "Unlock failed.")); });
    });
  }
  function dropSubs() { subs.forEach(function (off) { try { off(); } catch (e) {} }); subs = []; }
  /* Gate a route: backend globals + online (panel+Retry+auto-retry). PUBLIC
   * reads render LOCKED by design (gate-repair: password only at signing) —
   * the sign gate lives in sendConfirm (WIF check), never here. */
  function routeReady(root, title, retry, need) {
    var doc = root.ownerDocument || document, myGen = ++gen, miss = null;
    dropSubs(); root.innerHTML = "";
    (need || ["Proposal", "Tx", "Account", "Wallet", "Format", "Asset", "Chain", "Store"]).forEach(function (g) {
      if (typeof globalThis[g] === "undefined") miss = g; });
    var wrap = el(doc, "div", null, "wrap"); root.appendChild(wrap);
    wrap.appendChild(el(doc, "h1", title));
    if (miss) { showError(doc, wrap, title + " backend missing: " + miss + " failed to load."); return null; }
    if (Chain.status().state !== "open") {
      offlineBox(doc, wrap, retry);
      try {
        var h = (typeof location !== "undefined" && location.hash) || "", done = false;
        subs.push(Store.subscribe("connection", function (st) {
          if (done || myGen !== gen) { done = true; return; }
          if (st && st.state === "open") { done = true;
            if (typeof location === "undefined" || location.hash === h) retry(); }
        }));
      } catch (e) { /* manual Retry remains */ }
      return null;
    }
    /* No unlock gate here: public chain data renders locked; signing gates
     * in sendConfirm (fresh-WIF check). unlockBox stays for sign-time use. */
    return { doc: doc, wrap: wrap, myGen: myGen };
  }
  function confirmList(doc, rows) {
    var list = el(doc, "dl", null, "confirm");
    rows.forEach(function (r) {
      list.appendChild(el(doc, "dt", r[0]));
      var dd = el(doc, "dd", r[1]); if (r[2]) dd.title = "raw: " + r[2]; list.appendChild(dd);
    });
    return list;
  }
  function field(doc, labelText, opts) {
    opts = opts || {};
    var row = el(doc, "div", null, "xfer-field"), label = el(doc, "label", labelText + " ");
    var input = doc.createElement("input");
    if (opts.type) input.type = opts.type; if (opts.value !== undefined) input.value = opts.value;
    if (opts.placeholder) input.setAttribute("placeholder", opts.placeholder);
    if (opts.inputmode) input.setAttribute("inputmode", opts.inputmode);
    touchable(input); label.appendChild(input); row.appendChild(label); return { row: row, input: input };
  }
  /* Table (desktop) + cards (phone) with sticky-first-col CSS; href links col 0, action buttons ride cards. */
  function deskTable(doc, headers, rows) {
    var box = el(doc, "div");
    if (!rows.length) { box.appendChild(el(doc, "p", t("proposal.nothing_here_yet", "Nothing here yet."), "muted")); return box; }
    var table = doc.createElement("table"); table.className = "node-table";
    var hr = doc.createElement("tr");
    headers.forEach(function (t) { hr.appendChild(el(doc, "th", t)); });
    var thead = doc.createElement("thead"); thead.appendChild(hr); table.appendChild(thead);
    var tbody = doc.createElement("tbody"), cards = el(doc, "div", null, "node-cards");
    rows.forEach(function (r) {
      var tr = doc.createElement("tr"), card = el(doc, "div", null, "node-card");
      r.cells.forEach(function (c, i) {
        var td = el(doc, "td", c.text); if (c.raw) td.title = "raw: " + c.raw;
        if (i === 0 && r.href) { td.innerHTML = ""; var a = doc.createElement("a"); a.setAttribute("href", r.href); a.textContent = c.text; td.appendChild(a); }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
      r.cardLines.forEach(function (ln) { card.appendChild(el(doc, "div", ln)); });
      if (r.href) { var a2 = doc.createElement("a"); a2.setAttribute("href", r.href); a2.textContent = t("proposal.open", "Open"); card.appendChild(a2); }
      if (r.action) card.appendChild(r.action);
      cards.appendChild(card);
    });
    table.appendChild(tbody); box.appendChild(table); box.appendChild(cards); return box;
  }
  /* lookup_asset_symbols join -> {id: {sym, prec}}; misses degrade to bare ids. */
  async function symJoin(ids) {
    var out = {}, uniq = [];
    (ids || []).forEach(function (id) { if (typeof id === "string" && id && !out[id]) { out[id] = null; uniq.push(id); } });
    if (uniq.length) {
      var rows = await Chain.call(await Chain.db(), "lookup_asset_symbols", [uniq]);
      (rows || []).forEach(function (a) { if (a && a.id) out[a.id] = { sym: a.symbol, prec: a.precision }; });
    }
    uniq.forEach(function (id) { if (!out[id]) out[id] = { sym: String(id), prec: null }; });
    return out;
  }
  /* Raw amount -> human + sym via the symbol join (missing precision stays "raw (id)", never blank). Params: raw, aid, join. */
  function amtText(raw, aid, join) {
    var j = (join && join[aid]) || null;
    if (j && typeof j.prec === "number" && /^\d+$/.test(String(raw)))
      return Format.formatAmount(String(raw), j.prec) + " " + j.sym;
    return String(raw) + " (" + aid + ")";
  }
  /* Fee object -> human + symbol (Asset.describe; raw + id fallback). Returns: Promise of string. */
  async function feeText(fee) {
    try {
      var a = await Asset.describe(fee.asset_id);
      return Format.formatAmount(String(fee.amount), a.precision) + " " + a.symbol;
    } catch (e) { return String(fee.amount) + " (" + fee.asset_id + ")"; }
  }
  /* Chain head block number (observation marker for result panels, never a txid). Returns: Promise of int. */
  async function headBlock() {
    return (await Chain.call(await Chain.db(), "get_dynamic_global_properties", [])).head_block_number || 0;
  }
  /* "2026-09-30T12:00:00" -> locale words + "in N days/hours" countdown. Date only, never money. */
  function timeHuman(iso) {
    if (!iso) return t("proposal.none", "none");
    var ts = Date.parse(/Z$/.test(iso) ? iso : iso + "Z");
    if (isNaN(ts)) return String(iso);
    var words = new Date(ts).toLocaleString(), delta = Math.floor((ts - Date.now()) / 1000);
    if (delta <= 0) return words + " (expired)";
    if (delta % 86400 === 0) return words + " (in " + Proposal.durToHuman(delta) + ")";
    var d = Math.floor(delta / 86400), h = Math.floor((delta % 86400) / 3600), m = Math.floor((delta % 3600) / 60), bits = [];
    if (d) bits.push(d + " day" + (d === 1 ? "" : "s"));
    if (h) bits.push(h + " hour" + (h === 1 ? "" : "s"));
    if (!d && m) bits.push(m + " minute" + (m === 1 ? "" : "s"));
    return words + " (in " + bits.join(", ") + ")";
  }
  /* Generic publish: named rows -> Back/Sign -> fresh-WIF sendAndProve -> re-read proof -> result.
   * SIGN GATE (gate-repair): this is the ONLY password gate on proposal-family
   *   routes — reads render locked; Send requires an unlocked WIF here.
   * cfg.extra(doc), when present, appends DOM after the named rows (the
   * op-22 create confirm uses it for per-inner nested rows via renderInnerOp). */
  function sendConfirm(doc, out, cfg, myGen) {
    clearBox(out);
    out.appendChild(el(doc, "h3", cfg.title)); out.appendChild(confirmList(doc, cfg.rows));
    if (cfg.extra) {
      try { var ex = cfg.extra(doc); if (ex) out.appendChild(ex); }
      catch (e) { out.appendChild(el(doc, "p", "Enclosed-op detail unavailable (" + String((e && e.message) || e) + ") — the count row above still holds.", "muted")); }
    }
    var back = touchable(el(doc, "button", t("proposal.back", "Back"))); back.type = "button";
    var send = touchable(el(doc, "button", t("proposal.sign_send", "Sign & Send"))); send.type = "button";
    out.appendChild(back); out.appendChild(send);
    /* Sign-time gate note: visible while locked so headless/returning users
     * see browsing is public and only signing needs the password. */
    try {
      if (typeof Wallet === "undefined" || !Wallet.isUnlocked())
        out.appendChild(el(doc, "p", t("proposal.locked_sign_note", "Wallet is locked — browsing is public; unlock to sign."), "muted"));
    } catch (e) { /* note is display-only */ }
    back.addEventListener("click", function () { clearBox(out); });
    send.addEventListener("click", function () {
      if (myGen !== gen) return; send.disabled = true; back.disabled = true;
      var status = showStatus(doc, out, t("proposal.signing", "Signing…"));
      var wif = Wallet.keys && Wallet.keys.active ? Wallet.keys.active.wif : null;
      if (!wif) { out.removeChild(status); showError(doc, out, new Error("wallet-locked")); send.disabled = false; back.disabled = false; return; }
      Promise.resolve().then(cfg.makeUnsigned).then(function (unsigned) {
        status.textContent = t("proposal.broadcasting", "Broadcasting…");
        return Proposal.sendAndProve(unsigned, wif, cfg.prove);
      }).then(async function (res) {
        if (myGen !== gen) return; clearBox(out);
        out.appendChild(el(doc, "p", cfg.okText, "xfer-ok"));
        out.appendChild(el(doc, "p", "Observed at head block #" + String(await headBlock()) + " (" + res.via + ").", "muted"));
      }).catch(function (e) {
        if (myGen !== gen) return; out.removeChild(status);
        showError(doc, out, e, t("proposal.failed_check_state_before_retrying_do_not_bli", "Failed. Check state before retrying (do NOT blindly rebroadcast)."));
        send.disabled = false; back.disabled = false;
      });
    });
  }
  /* build {pair|ops, fee, prove} + live fee -> named rows -> sendConfirm. */
  function reviewPaid(doc, out, myGen, cfg) {
    clearBox(out); if (cfg.btn) cfg.btn.disabled = true;
    showStatus(doc, out, t("proposal.resolving_and_estimating_fee", "Resolving and estimating fee…"));
    function done() { if (cfg.btn) cfg.btn.disabled = false; }
    Promise.resolve().then(cfg.build).then(function (built) {
      if (myGen !== gen) return done();
      feeText(built.fee).then(function (f) {
        if (myGen !== gen) return done();
        sendConfirm(doc, out, { title: cfg.title, rows: cfg.rows(built, f),
          extra: (typeof cfg.extra === "function" ? function (d) { return cfg.extra(d, built); } : null),
          makeUnsigned: function () { return Tx.buildTx(built.ops || [built.pair]); },
          prove: built.prove, okText: cfg.ok(built) }, myGen);
        done();
      }).catch(function (e) { if (myGen === gen) { clearBox(out); showError(doc, out, e, t("proposal.fee_lookup_failed", "Fee lookup failed.")); } done(); });
    }).catch(function (e) {
      if (myGen !== gen) return done();
      clearBox(out); showError(doc, out, e, cfg.fail || t("proposal.could_not_prepare_the_transaction", "Could not prepare the transaction.")); done();
    });
  }
  /* Review button + output box wiring reviewPaid (gen-checked; cfg.btn disabled while building). Params: doc, box, myGen, label, cfg. */
  function reviewSection(doc, box, myGen, label, cfg) {
    var btn = touchable(el(doc, "button", label)); btn.type = "button"; box.appendChild(btn);
    var out = el(doc, "div", null, "xfer-out"); box.appendChild(out);
    cfg.btn = btn;
    btn.addEventListener("click", function () { if (myGen === gen) reviewPaid(doc, out, myGen, cfg); });
  }
  /* Ticket lock type -> WORD (unknown types stay "lock type N", never a bare int). */
  function lockWord(t) {
    try { return ProposalTicket.lockLabel(t); } catch (e) { return t("proposal.lock_type_tpl", "lock type %(n)s", { n: t }); }
  }
  /* Listing u8 -> word via ProposalMisc (falls back to "listing N" when the backend is missing). */
  function listingWord(n) {
    try { return ProposalMisc.listingLabel(n); } catch (e) { return t("proposal.listing_tpl", "listing %(n)s", { n: n }); }
  }
  /* THE nested-op human renderer: each proposed_ops entry -> named rows.
   * Unknown inner type -> honest fallback row, never raw JSON, never blank. */
  function renderInnerOp(doc, type, data, join) {
    var box = el(doc, "div", null, "inner-op");
    box.appendChild(el(doc, "h4", opName(type) + " (op " + type + ")"));
    function row(k, v, raw) { box.appendChild(confirmList(doc, [[k, v, raw]])); }
    if (type === 0) {
      var a = (data.amount && typeof data.amount === "object") ? data.amount : {};
      row(t("proposal.from", "From"), String(data.from || "?")); row(t("proposal.to", "To"), String(data.to || "?"));
      row(t("proposal.amount", "Amount"), amtText(a.amount, String(a.asset_id || "?"), join), String(a.amount));
      row(t("proposal.memo", "Memo"), (data.memo && data.memo.message) ? String(data.memo.message) : t("proposal.none", "none"));
    } else if (type === 7) {
      row(t("proposal.authorizing_account", "Authorizing account"), String(data.authorizing_account || "?"));
      row(t("proposal.account_to_list", "Account to list"), String(data.account_to_list || "?"));
      row(t("proposal.new_listing", "New listing"), listingWord(data.new_listing), String(data.new_listing));
    } else if (type === 57 || type === 58) {
      var amt = (data.amount && typeof data.amount === "object") ? data.amount
        : ((data.amount_for_new_target && typeof data.amount_for_new_target === "object") ? data.amount_for_new_target : null);
      row(t("proposal.account", "Account"), String(data.account || "?"));
      row(t("proposal.lock", "Lock"), lockWord(data.target_type), String(data.target_type));
      row(t("proposal.amount", "Amount"), amt ? amtText(amt.amount, String(amt.asset_id || "?"), join) : t("proposal.unchanged", "unchanged"), amt ? String(amt.amount) : null);
      if (type === 58) row(t("proposal.ticket", "Ticket"), String(data.ticket || "?"));
    } else if (type === 14) {
      var ia = (data.asset_to_issue && typeof data.asset_to_issue === "object") ? data.asset_to_issue : {};
      row(t("proposal.issuer", "Issuer"), String(data.issuer || "?")); row(t("proposal.recipient", "Recipient"), String(data.issue_to_account || "?"));
      row(t("proposal.amount", "Amount"), amtText(ia.amount, String(ia.asset_id || "?"), join), String(ia.amount));
    } else {
      box.appendChild(el(doc, "p", "Type " + type + " has no human renderer yet — approve or reject it from its own page.", "muted"));
    }
    return box;
  }
  /* Inner-op asset ids for one symbol-join round trip (transfer/ticket/issue legs only). */
  function innerAssetIds(entries) {
    var ids = [];
    (entries || []).forEach(function (e) {
      var pair = (e && e.op !== undefined) ? e.op : e;
      if (!pair || !pair[1]) return;
      ["amount", "amount_for_new_target", "asset_to_issue"].forEach(function (k) {
        var o = pair[1][k];
        if (o && typeof o === "object" && o.asset_id) ids.push(String(o.asset_id));
      });
    });
    return ids;
  }
  /* First enclosed op -> op name for the proposals table (empty list -> "empty"). */
  function firstWords(entries) {
    if (!entries || !entries.length) return t("proposal.empty", "empty");
    var pair = (entries[0] && entries[0].op !== undefined) ? entries[0].op : entries[0];
    return pair ? opName(pair[0]) : t("proposal.empty", "empty");
  }
  /* Inner-op builder field descriptors: [label, placeholder, inputmode]. */
  var INNER_DEFS = {
    transfer: [["From", "name or 1.2.N"], ["To", "name or 1.2.N"], ["Asset", "symbol or 1.3.x"], ["Amount", "1.5", "decimal"], ["Memo (optional)", ""]],
    whitelist: [["Authorizing account", "name or 1.2.N"], ["Account to list", "name or 1.2.N"], ["Listing (white / black)", "white"]],
    ticket: [["Account", "name or 1.2.N"], ["Lock (liquid / 180 / 360 / 720 / forever)", "180"], ["Asset", "symbol or 1.3.x"], ["Amount", "1.5", "decimal"]] };
  /* UTF-8 string to lowercase hex (plain-memo message path — slice-4
   * transfer-ui precedent: the node's message field is bytes-as-hex, and a
   * present-but-null {from,to} memo object is rejected at fee time,
   * types.cpp:49 base58 assert. Byte loop, not money.) */
  function utf8Hex(str) {
    var bytes = new TextEncoder().encode(str);
    var out = "";
    for (var i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
    return out;
  }
  /* Full account row (recipient/sender memo keys — Account.resolve returns
   * id/name only, same reason as transfer-ui's fullAccount). */
  async function fullAccount(id) {
    var rows = await Chain.call(await Chain.db(), "get_accounts", [[id]]);
    if (!rows || !rows[0]) throw new Error("unknown-account");
    return rows[0];
  }
  /* Resolve one inner-op descriptor row into a canonical [opId, opData] pair (raw amounts). */
  async function resolveInner(kind, v) {
    if (kind === "transfer") {
      var from = await Account.resolve(v[0]), to = await Account.resolve(v[1]);
      if (from.id === to.id) throw new Error(t("proposal.inner_transfer_needs_two_different_accounts_c", "Inner transfer needs two different accounts (chain rejects from == to — transfer.cpp:42)."));
      var info = await Asset.describe(v[2]), raw = Format.parseAmount(v[3], info.precision);
      if (BigInt(raw) <= 0n) throw new Error(t("proposal.inner_transfer_amount_must_be_0", "Inner transfer amount must be > 0."));
      var memoObj = null;
      if (v[4]) {
        var ff = await fullAccount(from.id), tt = await fullAccount(to.id);
        var fk = (ff && ff.options) ? ff.options.memo_key : null;
        var tk = (tt && tt.options) ? tt.options.memo_key : null;
        if (!fk || !tk) throw new Error(t("proposal.inner_memo_needs_both_accounts_to_have_a_memo", "Inner memo needs both accounts to have a memo key; clear the memo to continue."));
        memoObj = { from: fk, to: tk, nonce: "0", message: utf8Hex(v[4]) };
      }
      return [0, { fee: { amount: "0", asset_id: "1.3.0" }, from: from.id, to: to.id,
        amount: { amount: raw, asset_id: info.id },
        memo: memoObj,
        extensions: [] }];
    }
    if (kind === "whitelist") {
      var auth = await Account.resolve(v[0]), listee = await Account.resolve(v[1]);
      return ProposalMisc.buildWhitelist({ authorizerId: auth.id, listeeId: listee.id,
        newListing: ProposalMisc.listingFromHuman(v[2] || "white") });
    }
    var acct = await Account.resolve(v[0]), ainfo = await Asset.describe(v[2]);
    var traw = Format.parseAmount(v[3], ainfo.precision);
    if (BigInt(traw) <= 0n) throw new Error(t("proposal.inner_ticket_amount_must_be_0", "Inner ticket amount must be > 0."));
    return ProposalTicket.buildTicketCreate({ accountId: acct.id,
      targetType: ProposalTicket.lockFromHuman(v[1] || "180"), amountRaw: traw, assetId: ainfo.id });
  }
  /* One-line enclosed-op summary for the create-form list ("transfer 1 BTS (a → b)"). Params: kind, vals (descriptor inputs). */
  function innerSummary(kind, vals) {
    if (kind === "transfer") return "transfer " + vals[3] + " " + vals[2] + " (" + vals[0] + " → " + vals[1] + ")";
    if (kind === "whitelist") return "whitelist " + vals[1] + " → " + vals[2];
    return "ticket " + vals[3] + " " + vals[2] + " → " + vals[1];
  }
  /* Route entry: #/proposals — table + my-proposals filter + create form. */
  function renderProposals(root) {
    if (!root) return;
    var ctx = routeReady(root, t("proposal.proposals", "Proposals"), function () { renderProposals(root); });
    if (!ctx) return;
    var doc = ctx.doc, myGen = ctx.myGen;
    ctx.wrap.appendChild(el(doc, "p", t("proposal.proposals_need_approvals_before_they_execute", "Proposals need approvals before they execute. Anyone can propose enclosed operations; approvers sign op 23, vetoes use op 24."), "muted"));
    /* Public-by-default (gate-repair): locked viewers browse as the
     * committee-account until they unlock and act as themselves. */
    try {
      if (typeof Wallet === "undefined" || !Wallet.isUnlocked())
        ctx.wrap.appendChild(el(doc, "p", t("proposal.viewing_as", "Viewing as committee-account (1.2.0) — unlock to act as yourself."), "muted"));
    } catch (e) { /* notice is display-only */ }
    var fA = field(doc, t("proposal.account_for_approvals", "Account for approvals"), { placeholder: t("proposal.name_or_1_2_n", "name or 1.2.N"), value: "1.2.0" });
    ctx.wrap.appendChild(fA.row);
    var go = touchable(el(doc, "button", t("proposal.list_proposals", "List proposals"))); go.type = "button"; ctx.wrap.appendChild(go);
    var listBox = el(doc, "div"); ctx.wrap.appendChild(listBox);
    ctx.wrap.appendChild(el(doc, "h2", t("proposal.create_proposal", "Create proposal")));
    var fP = field(doc, t("proposal.fee_payer_proposer", "Fee payer (proposer)"), { placeholder: t("proposal.name_or_1_2_n", "name or 1.2.N"), value: "1.2.0" });
    var fE = field(doc, t("proposal.expiration", "Expiration"), { type: "datetime-local" });
    var fR = field(doc, t("proposal.review_period_seconds_optional", "Review period seconds (optional)"), { placeholder: t("proposal.blank_none", "blank = none"), inputmode: "numeric" });
    ctx.wrap.appendChild(fP.row); ctx.wrap.appendChild(fE.row); ctx.wrap.appendChild(fR.row);
    var kindSel = doc.createElement("select"); touchable(kindSel);
    Object.keys(INNER_DEFS).forEach(function (k) {
      var o = doc.createElement("option"); o.value = k; o.textContent = "Inner op: " + k; kindSel.appendChild(o);
    });
    ctx.wrap.appendChild(kindSel);
    var innerBox = el(doc, "div"), addedBox = el(doc, "div"), inners = [];
    ctx.wrap.appendChild(innerBox); ctx.wrap.appendChild(addedBox);
    /* Repaint the enclosed-ops list with per-row Remove buttons. */
    function drawInners() {
      clearBox(addedBox);
      addedBox.appendChild(el(doc, "h3", "Enclosed ops (" + inners.length + ")"));
      inners.forEach(function (en, i) {
        var p = el(doc, "p", (i + 1) + ". " + innerSummary(en.kind, en.vals));
        var rm = touchable(el(doc, "button", t("proposal.remove", "Remove"))); rm.type = "button";
        rm.addEventListener("click", function () { inners.splice(i, 1); drawInners(); });
        p.appendChild(rm); addedBox.appendChild(p);
      });
    }
    /* Inner-op descriptor form for one kind (fields from INNER_DEFS + Add button). Params: kind. */
    function innerForm(kind) {
      clearBox(innerBox);
      var inputs = INNER_DEFS[kind].map(function (d, i) {
        // Placeholder tokens ("", "1.5", "180", "white") and inputmodes stay
        // untranslated: they are example values / input types, not language.
        var ph = d[1] || "";
        if (ph !== "" && ph !== "1.5" && ph !== "180" && ph !== "white") ph = t("proposal.innerph_" + kind + "_" + i, ph);
        var x = field(doc, t("proposal.inner_" + kind + "_" + i, d[0]), { placeholder: ph, inputmode: d[2] || null });
        innerBox.appendChild(x.row); return x.input;
      });
      var btn = touchable(el(doc, "button", "Add " + kind + " inner op")); btn.type = "button"; innerBox.appendChild(btn);
      btn.addEventListener("click", function () {
        var vals = inputs.map(function (n) { return n.value.trim(); });
        if (!vals[0] || !vals[1] || (kind !== "whitelist" && !vals[2]) || (kind === "transfer" && !vals[3]) || (kind === "ticket" && (!vals[2] || !vals[3]))) {
          showError(doc, innerBox, t("proposal.fill_every_required_inner_op_field_first", "Fill every required inner-op field first.")); return;
        }
        if (kind === "whitelist" && !vals[2]) vals[2] = "white";
        if (kind === "ticket" && !vals[1]) vals[1] = "180";
        inners.push({ kind: kind, vals: vals }); drawInners(); innerForm(kind);
      });
    }
    kindSel.addEventListener("change", function () { innerForm(kindSel.value); });
    innerForm("transfer"); drawInners();
    var cfgBox = el(doc, "div"); ctx.wrap.appendChild(cfgBox);
    reviewSection(doc, cfgBox, myGen, t("proposal.review_proposal", "Review proposal"), {
      build: async function () {
        if (!inners.length) throw new Error(t("proposal.add_at_least_one_enclosed_op_first", "Add at least one enclosed op first."));
        /* Null-tolerant at render: blank resolves to the public 1.2.0
         * default; signing still needs the unlocked WIF in sendConfirm. */
        var payer = await Account.resolve(fP.input.value.trim() || fA.input.value.trim() || "1.2.0");
        if (!fE.input.value.trim()) throw new Error(t("proposal.expiration_must_be_set", "Expiration must be set."));
        var rev = (fR.input.value.trim() === "") ? null : parseInt(fR.input.value.trim(), 10);
        if (rev !== null && (!Number.isInteger(rev) || rev < 0)) throw new Error(t("proposal.review_period_must_be_a_non_negative_integer", "Review period must be a non-negative integer."));
        var pairs = [];
        for (var i = 0; i < inners.length; i++) pairs.push(await resolveInner(inners[i].kind, inners[i].vals));
        var pair = Proposal.buildCreate({ feePayerId: payer.id,
          expirationIso: fE.input.value.trim().length === 16 ? fE.input.value.trim() + ":00" : fE.input.value.trim(),
          reviewPeriodSecOrNull: rev, innerOps: pairs.map(function (p) { return { op: p }; }) });
        var before = (await Proposal.proposalsFor(payer.name || payer.id)).length;
        await Proposal.fee(pair, "1.3.0");
        var join = await symJoin(innerAssetIds(pair[1].proposed_ops));
        return { pair: pair, fee: pair[1].fee, join: join,
          prove: async function () {
            var now = await Proposal.proposalsFor(payer.name || payer.id);
            return now.length > before ? now[now.length - 1] : null;
          } };
      },
      title: t("proposal.confirm_proposal_create_op_22", "Confirm proposal create (op 22)"),
      rows: function (built, f) {
        return [[t("proposal.fee_payer", "Fee payer"), built.pair[1].fee_paying_account], [t("proposal.expiration", "Expiration"), timeHuman(built.pair[1].expiration_time)],
          [t("proposal.review_period", "Review period"), (built.pair[1].review_period_seconds === null ? t("proposal.none", "none") : Proposal.durToHuman(built.pair[1].review_period_seconds))],
          [t("proposal.enclosed_ops", "Enclosed ops"), String(built.pair[1].proposed_ops.length)], [t("proposal.fee_live", "Fee (live)"), f]];
      },
      extra: function (doc, built) {
        var box = doc.createElement("div");
        (built.pair[1].proposed_ops || []).forEach(function (e) {
          var pr = (e && e.op !== undefined) ? e.op : e;
          if (pr && pr[1]) box.appendChild(renderInnerOp(doc, pr[0], pr[1], built.join || {}));
        });
        return box;
      },
      ok: function () { return t("proposal.proposal_created_and_re_read_on_chain", "Proposal created and re-read on chain."); },
      fail: t("proposal.could_not_build_the_proposal_check_accounts_a", "Could not build the proposal (check accounts, assets and amounts).") });
    go.addEventListener("click", function () {
      if (myGen !== gen) return; go.disabled = true; clearBox(listBox);
      showStatus(doc, listBox, t("proposal.loading_proposals", "Loading proposals…"));
      Proposal.proposalsFor(fA.input.value.trim() || "1.2.0").then(function (rows) {
        if (myGen !== gen) return;
        clearBox(listBox);
        listBox.appendChild(deskTable(doc, [t("proposal.id", "ID"), t("proposal.fee_payer", "Fee payer"), t("proposal.expires", "Expires"), t("proposal.review", "Review"), t("proposal.enclosed", "Enclosed")], rows.map(function (r) {
          return { href: "#/proposals/" + r.id,
            cells: [{ text: r.id }, { text: r.fee_paying_account }, { text: timeHuman(r.expiration_time) },
              { text: r.review_period ? Proposal.durToHuman(r.review_period) : t("proposal.none", "none") },
              { text: r.proposed_ops_count + " × (" + firstWords(r.proposed_ops || []) + ")" }],
            cardLines: [r.id + " · payer " + r.fee_paying_account, "Expires " + timeHuman(r.expiration_time),
              (r.proposed_ops_count || 0) + " enclosed op(s), first: " + firstWords(r.proposed_ops || [])] };
        })));
        go.disabled = false;
      }).catch(function (e) { if (myGen !== gen) return; clearBox(listBox); showError(doc, listBox, e, t("proposal.could_not_load_proposals", "Could not load proposals.")); go.disabled = false; });
    });
  }
  /* Route entry: #/proposals/:id — detail + nested table + approve/unapprove/delete. */
  function renderProposalDetail(root, id) {
    if (!root) return;
    var ctx = routeReady(root, "Proposal " + id, function () { renderProposalDetail(root, id); });
    if (!ctx) return;
    var doc = ctx.doc, myGen = ctx.myGen;
    try {
      if (typeof Wallet === "undefined" || !Wallet.isUnlocked())
        ctx.wrap.appendChild(el(doc, "p", t("proposal.viewing_as", "Viewing as committee-account (1.2.0) — unlock to act as yourself."), "muted"));
    } catch (e) { /* notice is display-only */ }
    showStatus(doc, ctx.wrap, t("proposal.loading_proposal", "Loading proposal…"));
    Proposal.proposal(id).then(function (p) {
      if (myGen !== gen) return;
      ctx.wrap.removeChild(ctx.wrap.lastChild);
      var tx = p.proposed_transaction || {}, entries = tx.operations || p.proposed_ops || [];
      ctx.wrap.appendChild(confirmList(doc, [
        [t("proposal.proposal", "Proposal"), String(p.id)], [t("proposal.fee_payer", "Fee payer"), String(p.proposer || p.fee_paying_account || "?")],
        [t("proposal.expiration", "Expiration"), timeHuman(p.expiration_time)],
        [t("proposal.review_period", "Review period"), (p.review_period_time || p.review_period_seconds) ? Proposal.durToHuman(p.review_period_time || p.review_period_seconds) : t("proposal.none", "none")],
        [t("proposal.required_active", "Required active"), (p.required_active_approvals || []).length ? p.required_active_approvals.join(", ") : t("proposal.none", "none")],
        [t("proposal.required_owner", "Required owner"), (p.required_owner_approvals || []).length ? p.required_owner_approvals.join(", ") : t("proposal.none", "none")],
        [t("proposal.active_approvals", "Active approvals"), (p.available_active_approvals || []).length ? p.available_active_approvals.join(", ") : t("proposal.none_yet", "none yet")],
        [t("proposal.owner_approvals", "Owner approvals"), (p.available_owner_approvals || []).length ? p.available_owner_approvals.join(", ") : t("proposal.none_yet", "none yet")]]));
      ctx.wrap.appendChild(el(doc, "h2", "Enclosed operations (" + entries.length + ")"));
      if (!entries.length) ctx.wrap.appendChild(el(doc, "p", t("proposal.no_enclosed_operations", "No enclosed operations."), "muted"));
      symJoin(innerAssetIds(entries)).then(function (join) {
        if (myGen !== gen) return;
        entries.forEach(function (e) {
          var pair = (e && e.op !== undefined) ? e.op : e;
          if (pair) ctx.wrap.appendChild(renderInnerOp(doc, pair[0], pair[1], join));
        });
      }).catch(function (e) { if (myGen === gen) showError(doc, ctx.wrap, e, t("proposal.could_not_join_asset_symbols", "Could not join asset symbols.")); });
      ctx.wrap.appendChild(el(doc, "h2", t("proposal.approve_reject", "Approve / reject")));
      var fW = field(doc, t("proposal.approver_account", "Approver account"), { placeholder: t("proposal.name_or_1_2_n", "name or 1.2.N"), value: "1.2.0" });
      var fP2 = field(doc, t("proposal.fee_payer", "Fee payer"), { placeholder: t("proposal.name_or_1_2_n", "name or 1.2.N"), value: "1.2.0" });
      ctx.wrap.appendChild(fW.row); ctx.wrap.appendChild(fP2.row);
      var ow = doc.createElement("select"); touchable(ow);
      ["active", "owner"].forEach(function (k) { var o = doc.createElement("option"); o.value = k; o.textContent = k + " authority"; ow.appendChild(o); });
      ctx.wrap.appendChild(ow);
      [[t("proposal.approve", "Approve"), false], [t("proposal.reject_approval", "Reject approval"), true]].forEach(function (ab) {
        var box = el(doc, "div"); ctx.wrap.appendChild(box);
        reviewSection(doc, box, myGen, ab[0] + " (op 23)", {
          build: async function () {
            var who = await Account.resolve(fW.input.value.trim() || "1.2.0");
            var payer = await Account.resolve(fP2.input.value.trim() || fW.input.value.trim() || "1.2.0");
            var args = { feePayerId: payer.id, proposalId: String(p.id), accountId: who.id, ownerNotActive: ow.value === "owner" };
            var pair = ab[1] ? Proposal.buildUnapprove(args) : Proposal.buildApprove(args);
            await Proposal.fee(pair, "1.3.0");
            return { pair: pair, fee: pair[1].fee, who: who.name || who.id,
              prove: async function () {
                var cur = await Proposal.proposal(String(p.id));
                var set = (ow.value === "owner" ? (cur.available_owner_approvals || []) : (cur.available_active_approvals || []));
                return (!!ab[1]) === (set.indexOf(who.id) === -1) ? cur : null;
              } };
          },
          title: "Confirm " + ab[0].toLowerCase() + " (op 23)",
          rows: function (built, f) {
            return [[t("proposal.proposal", "Proposal"), String(p.id)], [(ab[1] ? t("proposal.removed", "Removed") : t("proposal.added", "Added")) + " approval", built.who + " (" + ow.value + ")"],
              [t("proposal.fee_payer", "Fee payer"), built.pair[1].fee_paying_account], [t("proposal.fee_live", "Fee (live)"), f]];
          },
          ok: function () { return "Approval " + (ab[1] ? "removed" : "recorded") + " and re-read on chain."; } });
      });
      ctx.wrap.appendChild(el(doc, "h2", t("proposal.delete_proposal_op_24", "Delete proposal (op 24)")));
      var fD = field(doc, t("proposal.fee_payer", "Fee payer"), { placeholder: t("proposal.name_or_1_2_n", "name or 1.2.N"), value: "1.2.0" });
      ctx.wrap.appendChild(fD.row);
      var chk = doc.createElement("input"); chk.type = "checkbox"; touchable(chk);
      var chkRow = el(doc, "div", null, "xfer-field"), chkL = el(doc, "label", t("proposal.use_owner_authority_veto_path", "Use owner authority (veto path) "));
      chkL.appendChild(chk); chkRow.appendChild(chkL); ctx.wrap.appendChild(chkRow);
      var dbox = el(doc, "div"); ctx.wrap.appendChild(dbox);
      reviewSection(doc, dbox, myGen, t("proposal.delete_proposal_op_24", "Delete proposal (op 24)"), {
        build: async function () {
          var payer = await Account.resolve(fD.input.value.trim() || "1.2.0");
          var pair = Proposal.buildDelete({ feePayerId: payer.id, proposalId: String(p.id), usingOwner: !!chk.checked });
          await Proposal.fee(pair, "1.3.0");
          return { pair: pair, fee: pair[1].fee,
            prove: async function () {
              try { await Proposal.proposal(String(p.id)); return null; }
              catch (e) { return (String((e && e.message) || e).indexOf("unknown-proposal") !== -1) ? { gone: true } : null; }
            } };
        },
        title: t("proposal.confirm_proposal_delete_op_24", "Confirm proposal delete (op 24)"),
        rows: function (built, f) {
          return [[t("proposal.proposal", "Proposal"), String(p.id)], [t("proposal.owner_authority", "Owner authority"), chk.checked ? t("proposal.yes_veto", "yes (veto)") : t("proposal.no", "no")], [t("proposal.fee_live", "Fee (live)"), f]];
        },
        ok: function () { return t("proposal.proposal_deleted_re_read_confirms_it_is_gone", "Proposal deleted (re-read confirms it is gone)."); } });
    }).catch(function (e) {
      if (myGen !== gen) return;
      ctx.wrap.removeChild(ctx.wrap.lastChild);
      showError(doc, ctx.wrap, e, t("proposal.could_not_load_the_proposal", "Could not load the proposal."));
      if (String((e && e.message) || e).indexOf("unknown-proposal") !== -1)
        ctx.wrap.appendChild(el(doc, "p", t("proposal.check_the_id_proposals_look_like_1_10_n", "Check the id — proposals look like 1.10.N."), "muted"));
    });
  }

  return { renderProposals: renderProposals, renderProposalDetail: renderProposalDetail, renderInnerOp: renderInnerOp, opName: opName,
    live: function (g) { return g === gen; },
    _ui: { el: el, touchable: touchable, clearBox: clearBox, showError: showError, showStatus: showStatus,
      confirmList: confirmList, field: field, deskTable: deskTable, symJoin: symJoin, amtText: amtText,
      feeText: feeText, headBlock: headBlock, timeHuman: timeHuman,
      sendConfirm: sendConfirm, reviewPaid: reviewPaid, reviewSection: reviewSection,
      routeReady: routeReady, live: function (g) { return g === gen; } } };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.ProposalUI === "undefined") { globalThis.ProposalUI = ProposalUI; }
if (typeof module !== "undefined") { module.exports = ProposalUI; }
