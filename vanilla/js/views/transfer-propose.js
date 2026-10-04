/* transfer-propose.js — Send/Propose toggle backend (op 0 inside op 22).
 *
 * What it owns: proposeReviewUnlocked + lockedProposePreview (entry points
 * called by the transfer form) plus their private chain steps
 * (normaliseExpiration, parseReviewPeriod, resolveProposeLeg, feeHumanFor,
 * showProposeConfirm, showProposeResult) and private chain lookups
 * (utf8HexLocal, lookupAssetLocal, fullAccountLocal, networkNameLocal) —
 * verbatim replicas of the locked-preview steps, same node calls, same
 * wire shapes. CHAIN TRUTH (#4 wins): op-22 fields <- proposal.hpp:70-82;
 * nested op-0 bytes identical to top-level (barter-ui.js:269-270 path).
 * Consumes: script-tag globals guarded at call time (DOM, ConfirmDialog,
 * touchable, Tx, Account, Wallet, Format, Chain, Asset, Proposal,
 * ViewingAs) + I18n.t via the private t() below; facade-owned DOM helpers
 * arrive as the trailing env ({showForm, makeWrap, showError, showStatus} —
 * same function objects as the pre-split file, threaded by the facade and
 * passed through to showProposeConfirm, so this module never reads the
 * TransferUI global).
 * Globals/side effects: DOM under the given wrap/box only; global
 * TransferPropose only. Signs at Sign & Send only (active WIF from memory).
 * Split from: vanilla/js/views/transfer-ui.js (mechanical move, zero
 * behavior change — called by showForm via the facade).
 * Created by: building-vanilla-slices skill, view-split task.
 */
var TransferPropose = (function () {
  "use strict";

  /* Batch-2a i18n: display strings resolve via I18n.t with the
   * pre-conversion literal kept verbatim as enDefault (English-identical
   * on any transport, incl. file:// where dict fetch fails). Falls back
   * to the default when i18n.js failed to load: never blank, never throws.
   * vars fills %(name)s placeholders (Reference #6 shape); without I18n
   * the raw default returns unfilled — i18n.js is a local script tag,
   * absent only when the file itself is missing. */
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    if (vars && typeof dflt === "string") return dflt.replace(/%\(([^)]+)\)s/g, function (m, name) {
      return (vars && Object.prototype.hasOwnProperty.call(vars, name)) ? String(vars[name]) : m;
    });
    return dflt;
  }

  function utf8HexLocal(str) {
    var bytes = new TextEncoder().encode(str);
    var out = "";
    for (var i = 0; i < bytes.length; i++) {
      out += bytes[i].toString(16).padStart(2, "0");
    }
    return out;
  }

  /* Symbol (trimmed, uppercased) to {id, symbol, precision} — verbatim copy
   * of the transfer-confirm.js lookup (same per-file convention as the
   * market-ui split) so the locked preview resolves assets identically. */
  async function lookupAssetLocal(symbol) {
    var sym = String(symbol || "").trim().toUpperCase();
    if (!sym) throw new Error(t("transfer.asset_required", "Asset symbol is required."));
    var dbId = await Chain.db();
    var rows = await Chain.call(dbId, "lookup_asset_symbols", [[sym]]);
    if (!rows || !rows[0]) throw new Error(t("transfer.unknown_asset_prefix", "Unknown asset: ") + sym + ".");
    if (typeof rows[0].precision !== "number") throw new Error("bad-asset-shape");
    return { id: rows[0].id, symbol: rows[0].symbol, precision: rows[0].precision };
  }

  /* Full account row for the recipient memo key — verbatim copy of the
   * transfer-confirm.js original (Account.resolve returns id+name only). */
  async function fullAccountLocal(id) {
    var dbId = await Chain.db();
    var rows = await Chain.call(dbId, "get_accounts", [[id]]);
    if (!rows || !rows[0]) throw new Error("unknown-account");
    return rows[0];
  }

  /* networkNameLocal: settings network for the core-asset default
   * ("mainnet" when settings are unreadable). Never throws. */
  function networkNameLocal() {
    try {
      if (typeof Store !== "undefined" && Store && typeof Store.loadSettings === "function") {
        return Store.loadSettings().network;
      }
    } catch (e) { /* default stands */ }
    return "mainnet";
  }

  /* datetime-local (16 chars, no seconds) or full ISO -> chain ISO with
   * seconds. Throws plain "required"/"invalid" (gating shows them first,
   * so a throw here means a race, never a surprise). */
  function normaliseExpiration(v) {
    var s = String(v || "").trim();
    if (!s) throw new Error(t("transfer.proposal_expiration_required", "Proposal expiration is required."));
    var iso = (s.length === 16) ? s + ":00" : s;
    if (isNaN(Date.parse(iso))) throw new Error(t("transfer.proposal_expiration_invalid", "Proposal expiration is invalid."));
    return iso;
  }

  /* Blank (= none) or a non-negative integer. Returns null or the number. */
  function parseReviewPeriod(v) {
    var s = String(v === undefined || v === null ? "" : v).trim();
    if (s === "") return null;
    if (!/^\d+$/.test(s)) throw new Error(t("transfer.review_period_integer", "Review period must be a non-negative integer."));
    return parseInt(s, 10);
  }

  /* Resolve a propose leg (the enclosed op-0) from a form snapshot. Same
   * node calls + wire shapes as the locked send preview (plain-memo hex
   * path, encrypted via wallet keys when unlocked, locked-encrypted memos
   * excluded from the envelope with a hint row). Returns the human fields
   * plus opData for the {op: [0, opData]} nesting (the barter-ui.js
   * proposeBarter path — never reinvented). Amounts stay integer strings. */
  async function resolveProposeLeg(snap, isLocked) {
    if (!snap.to || !String(snap.to).trim()) {
      throw new Error(t("transfer.recipient_required", "Recipient is required."));
    }
    var fromAcc = await Account.resolve(String(snap.from || "").trim() || ((typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0"));
    var to = await Account.resolve(String(snap.to).trim());
    if (fromAcc.id === to.id) throw new Error(t("transfer.sender_recipient_different", "Sender and recipient must be different."));
    var asset = await lookupAssetLocal(snap.asset);
    var amountInt;
    try {
      amountInt = Format.parseAmount(snap.amount, asset.precision);
    } catch (e) {
      throw new Error(e && e.message ? e.message : "bad amount");
    }
    if (!/[1-9]/.test(amountInt)) {
      throw new Error(t("transfer.amount_positive", "Amount must be greater than zero."));
    }
    var memoText = String(snap.memo || ""), memoObj = null, memoKind = "none", lockedEnc = false;
    if (memoText) {
      var toFull = await fullAccountLocal(to.id);
      var toMemoKey = toFull && toFull.options ? toFull.options.memo_key : null;
      if (!toMemoKey) throw new Error(t("transfer.recipient_prefix", "Recipient ") + to.name + t("transfer.no_memo_key_suffix", " has no memo key; clear the memo to continue."));
      if (snap.encrypted) {
        if (isLocked) {
          lockedEnc = true;
          memoKind = "locked-encrypted";
        } else {
          if (!Wallet.keys || !Wallet.keys.memo || !Wallet.keys.memo.wif) throw new Error("wallet-locked");
          memoObj = await (/** @type {any} */ (Crypto).encryptMemo)(memoText, Wallet.keys.memo.wif, toMemoKey);
          memoKind = "encrypted";
        }
      } else {
        var fromPub = "";
        if (!isLocked && Wallet.keys && Wallet.keys.memo && Wallet.keys.memo.pub) {
          fromPub = Wallet.keys.memo.pub;
        }
        memoObj = { from: fromPub, to: toMemoKey, nonce: "0", message: utf8HexLocal(memoText) };
        memoKind = "plain";
      }
    }
    var unsigned0 = await Tx.buildTransfer({
      fromId: fromAcc.id, toId: to.id, amountInt: amountInt, assetId: asset.id, memoObj: memoObj
    });
    return { fromAcc: fromAcc, to: to, asset: asset, amountInt: amountInt,
      memoText: memoText, memoKind: memoKind, lockedEnc: lockedEnc,
      encrypted: !!snap.encrypted, opData: unsigned0.operations[0][1] };
  }

  /* Wrapper fee -> human text. Prefers Asset.describe (the barter feeText
   * pattern) with a Chain get_assets fallback; raw + id when both fail —
   * never a wrong number. Returns {text, sym}. */
  async function feeHumanFor(fee) {
    var id = String(fee.asset_id), raw = String(fee.amount);
    try {
      if (typeof Asset !== "undefined" && Asset && typeof Asset.describe === "function") {
        var d = await Asset.describe(id);
        return { text: Format.formatAmount(raw, d.precision) + " " + d.symbol, sym: d.symbol };
      }
    } catch (e) { /* fallback below */ }
    try {
      var dbId = await Chain.db();
      var rows = await Chain.call(dbId, "get_assets", [[id]]);
      if (rows && rows[0] && typeof rows[0].precision === "number") {
        return { text: Format.formatAmount(raw, rows[0].precision) + " " + rows[0].symbol, sym: rows[0].symbol };
      }
    } catch (e2) { /* raw fallback stands */ }
    return { text: raw + " (" + id + ")", sym: id };
  }

  /* Propose confirm: named rows (proposer + enclosed transfer + live
   * WRAPPER fee), raw op-22 JSON, Back + Sign & Send. Keys must already be
   * in memory here (the locked path unlocks first in lockedProposePreview,
   * so the password is asked only at signing, never to view). Broadcasts
   * via Proposal.sendAndProve with a proposalsFor + get_objects re-read
   * proof (the new proposal id observed on chain — the barter
   * confirmPropose pattern). built = {proposer, leg, pair, before, snap}. */
  function showProposeConfirm(doc, wrap, root, built, fh, onBack, env) {
    var leg = built.leg;
    var memoText;
    if (leg.memoKind === "encrypted") memoText = t("transfer.memo_encrypted", "Encrypted");
    else if (leg.memoKind === "plain") memoText = t("transfer.memo_plain_prefix", "Plain: ") + leg.memoText;
    else if (leg.lockedEnc) memoText =
      t("transfer.locked_encrypted_hint", "Encrypted memos need the wallet keys — unlock first, or switch the memo to plain.");
    else memoText = t("transfer.memo_none", "(none)");
    var rev = built.pair[1].review_period_seconds;
    var rows = [
      [t("transfer.proposer_label", "Proposer"), built.proposer.name + " (" + built.proposer.id + ")"],
      [t("transfer.expiration_label", "Expiration"), built.pair[1].expiration_time],
      [t("transfer.review_period_label", "Review period"), (rev === null || rev === undefined) ? t("transfer.review_period_none", "none") : Proposal.durToHuman(rev)],
      [t("confirm.from", "From"), leg.fromAcc.name + " (" + leg.fromAcc.id + ")"],
      [t("confirm.to", "To"), leg.to.name + " (" + leg.to.id + ")"],
      [t("confirm.amount", "Amount"),
        Format.formatAmount(leg.amountInt, leg.asset.precision) + " " + leg.asset.symbol, leg.amountInt],
      [t("confirm.memo", "Memo"), memoText],
      [t("confirm.network", "Network"), networkNameLocal()]];
    var dlg = ConfirmDialog.show({ title: t("transfer.confirm_proposal_title", "Confirm proposal (op %(op)s)", { op: 22 }),
      rows: rows, feeHuman: fh.text, feeTerm: t("common.fee_live", "Fee (live)"),
      backLabel: t("confirm.back", "Back"), sendLabel: t("common.sign_send", "Sign & Send"),
      onBack: function () { if (typeof onBack === "function") onBack(); },
      onSend: function () { doPropSend(); } });
    /* Enclosed-op note + raw op JSON ride inside the dialog above its
     * actions (old rows-then-notes-then-buttons order, textContent-only). */
    var noteEl = DOM.el(doc, "p", t("transfer.enclosed_op_note", "Enclosed op: transfer (op %(op)s) — executes only after approvals.", { op: 0 }), "muted");
    var detOp = doc.createElement("details");
    detOp.className = "raw";
    var sumOp = doc.createElement("summary");
    sumOp.setAttribute("aria-label", t("confirm.op_json_label", "Show unsigned operation JSON"));
    detOp.appendChild(sumOp);
    var preOp = doc.createElement("pre");
    try { preOp.textContent = JSON.stringify(built.pair, null, 2); }
    catch (e) { preOp.textContent = String(built.pair); }
    detOp.appendChild(preOp);
    /* Mount first so insertBefore has a parent, then slot notes above actions. */
    wrap.appendChild(dlg);
    (function () {
      try {
        var acts = dlg.querySelector ? dlg.querySelector(".confirm-actions") : null;
        if (acts && acts.parentNode) {
          acts.parentNode.insertBefore(noteEl, acts);
          acts.parentNode.insertBefore(detOp, acts);
          return;
        }
      } catch (e2) { /* fall through */ }
      wrap.appendChild(noteEl);
      wrap.appendChild(detOp);
    })();
    function doPropSend() {
      var btns = dlg.getElementsByTagName("button");
      var backBtn = btns[0], sendBtn = btns[1];
      backBtn.disabled = true;
      sendBtn.disabled = true;
      var status = env.showStatus(doc, wrap, t("common.status_signing", "Signing…"));
      var activeWIF = Wallet.keys && Wallet.keys.active ? Wallet.keys.active.wif : null;
      if (!activeWIF) {
        wrap.removeChild(status);
        env.showError(doc, wrap, new Error("wallet-locked"), t("common.wallet_locked", "Wallet is locked."));
        backBtn.disabled = false;
        sendBtn.disabled = false;
        return;
      }
      Promise.resolve().then(async function () {
        var wid = await Account.myAccountId();
        if (built.proposer.id !== wid) {
          throw new Error(t("transfer.proposer_mismatch_prefix", "Proposer must match the unlocked wallet account (fee-payer signs) — got ") +
            built.proposer.name + " (" + built.proposer.id + t("transfer.proposer_mismatch_wallet_mid", "), wallet is ") + wid + ".");
        }
        var unsigned = await Tx.buildTx([built.pair]);
        status.textContent = t("common.status_broadcasting", "Broadcasting…");
        return Proposal.sendAndProve(unsigned, activeWIF, async function () {
          var now = await Proposal.proposalsFor(built.proposer.name || built.proposer.id);
          if (!now || now.length <= built.before) return null;
          var cand = now[now.length - 1];
          try {
            var full = await Proposal.proposal(cand.id);
            return { slim: cand, full: full };
          } catch (e) {
            return { slim: cand, full: null };
          }
        });
      }).then(async function (res) {
        var head = 0;
        try {
          head = (await Chain.call(await Chain.db(), "get_dynamic_global_properties", [])).head_block_number || 0;
        } catch (e) { /* head stays 0 — never blocks the proof */ }
        DOM.clear(root);
        showProposeResult(doc, env.makeWrap(doc, root), root, built, fh, res, head);
      }).catch(function (e) {
        var msg = (e && e.message) ? e.message : t("transfer.could_not_build_proposal", "Could not build the proposal.");
        if (wrap.contains(status)) wrap.removeChild(status);
        env.showError(doc, wrap, msg, t("transfer.prepare_failed", "Could not prepare the transfer."));
        backBtn.disabled = false;
        sendBtn.disabled = false;
      });
    }
  }

  /* Proposal result: the re-read proposal id + head block + channel.
   * Links to the proposals page. Never blank. */
  function showProposeResult(doc, wrap, root, built, fh, res, head) {
    wrap.appendChild(DOM.pageHead(doc, t("transfer.proposal_sent_title", "Proposal sent"), "transfer"));
    var pid = "?";
    try {
      if (res && res.proof) {
        if (res.proof.slim && res.proof.slim.id) pid = res.proof.slim.id;
        else if (res.proof.id) pid = res.proof.id;
      }
    } catch (e) { /* "?" stands */ }
    var via = (res && res.via) ? res.via : "?";
    var ok = DOM.el(doc, "p", t("transfer.proposal_observed_prefix", "Proposal ") + pid + t("transfer.proposal_observed_mid", " observed at head block #") + String(head) + " (" + via + ").", "xfer-ok");
    ok.setAttribute("aria-live", "polite");
    wrap.appendChild(ok);
    wrap.appendChild(DOM.el(doc, "p",
      Format.formatAmount(built.leg.amountInt, built.leg.asset.precision) + " " +
      built.leg.asset.symbol + " → " + built.leg.to.name + t("transfer.enclosed_fee_mid", " enclosed; fee ") + fh.text + ".", "muted"));
    var link = DOM.el(doc, "a", t("transfer.view_proposals", "View proposals"));
    link.setAttribute("href", "#/proposals");
    touchable(link);
    wrap.appendChild(link);
  }

  /* Unlocked propose review: resolve the proposer (must EQUAL the wallet —
   * the fee-payer signs now) + the leg (From may differ: the inner
   * transfer authorizes later), wrap the [0, opData] pair via
   * Proposal.buildCreate, quote the WRAPPER fee live, then confirm.
   * Failures rebuild the form with every input preserved. */
  function proposeReviewUnlocked(doc, wrap, root, from, snap, reviewBtn, env) {
    reviewBtn.disabled = true;
    var status = env.showStatus(doc, wrap, t("transfer.checking", "Checking recipient, asset, and fee…"));
    function fail(msg) {
      if (wrap.contains(status)) wrap.removeChild(status);
      DOM.clear(root);
      env.showForm(doc, env.makeWrap(doc, root), root, from, {
        from: snap.from, to: snap.to, asset: snap.asset, amount: snap.amount,
        memo: snap.memo, encrypted: snap.encrypted, feeAsset: snap.feeAsset,
        mode: "propose", proposer: snap.proposer, expiration: snap.expiration,
        reviewPeriod: snap.reviewPeriod, error: msg
      });
    }
    Promise.resolve().then(async function () {
      if (typeof Proposal === "undefined" || !Proposal || typeof Proposal.buildCreate !== "function") {
        throw new Error(t("transfer.proposal_backend_missing", "Proposal backend missing: js/proposal.js failed to load."));
      }
      var wid = await Account.myAccountId();
      var proposer = await Account.resolve(String(snap.proposer || "").trim() || ((typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0"));
      if (proposer.id !== wid) {
        throw new Error(t("transfer.proposer_mismatch_prefix", "Proposer must match the unlocked wallet account (fee-payer signs) — got ") +
          proposer.name + " (" + proposer.id + t("transfer.proposer_mismatch_wallet_mid", "), wallet is ") + wid + ".");
      }
      var leg = await resolveProposeLeg(snap, false);
      var expIso = normaliseExpiration(snap.expiration);
      var rev = parseReviewPeriod(snap.reviewPeriod);
      var pair = Proposal.buildCreate({ feePayerId: proposer.id, expirationIso: expIso,
        reviewPeriodSecOrNull: rev, innerOps: [{ op: [0, leg.opData] }] });
      var before = (await Proposal.proposalsFor(proposer.name || proposer.id)).length;
      await Proposal.fee(pair, "1.3.0");
      return { proposer: proposer, leg: leg, pair: pair, before: before, snap: snap };
    }).then(function (built) {
      feeHumanFor(built.pair[1].fee).then(function (fh) {
        if (wrap.contains(status)) wrap.removeChild(status);
        DOM.clear(root);
        var w2 = env.makeWrap(doc, root);
        showProposeConfirm(doc, w2, root, built, fh, function () {
          DOM.clear(root);
          env.showForm(doc, env.makeWrap(doc, root), root, from, {
            from: built.snap.from, to: built.snap.to, asset: built.snap.asset,
            amount: built.snap.amount, memo: built.snap.memo, encrypted: built.snap.encrypted,
            feeAsset: built.snap.feeAsset, mode: "propose",
            proposer: built.snap.proposer, expiration: built.snap.expiration,
            reviewPeriod: built.snap.reviewPeriod, error: null
          });
        }, env);
      }).catch(function (e) {
        fail((e && e.message) ? e.message : t("transfer.could_not_build_proposal", "Could not build the proposal."));
      });
    }).catch(function (e) {
      fail((e && e.message) ? e.message : t("transfer.could_not_build_proposal", "Could not build the proposal."));
    });
  }

  /* Locked propose preview: read-only named rows + LIVE wrapper fee under
   * the form (proposer input defaults to 1.2.0 with the notice above);
   * the password is asked only at Unlock & Sign. After unlock the proposal
   * is REBUILT with the wallet as proposer (the fee-payer must sign) and
   * quoted again — a switch note names the change, so the preview never
   * signs something it did not show. */
  function lockedProposePreview(doc, box, root, vals, reviewBtn, env) {
    DOM.clear(box);
    reviewBtn.disabled = true;
    env.showStatus(doc, box, t("transfer.checking", "Checking recipient, asset, and fee…"));
    function done() { reviewBtn.disabled = false; }
    Promise.resolve().then(async function () {
      if (typeof Proposal === "undefined" || !Proposal || typeof Proposal.buildCreate !== "function") {
        throw new Error(t("transfer.proposal_backend_missing", "Proposal backend missing: js/proposal.js failed to load."));
      }
      var proposer = await Account.resolve(String(vals.proposer || "").trim() || ((typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0"));
      var leg = await resolveProposeLeg(vals, true);
      var expIso = normaliseExpiration(vals.expiration);
      var rev = parseReviewPeriod(vals.reviewPeriod);
      var pair = Proposal.buildCreate({ feePayerId: proposer.id, expirationIso: expIso,
        reviewPeriodSecOrNull: rev, innerOps: [{ op: [0, leg.opData] }] });
      await Proposal.fee(pair, "1.3.0");
      var fh = await feeHumanFor(pair[1].fee);
      return { proposer: proposer, leg: leg, pair: pair, fh: fh };
    }).then(function (P) {
      DOM.clear(box);
      box.appendChild(DOM.el(doc, "h2", t("transfer.propose_preview_title", "Proposal preview (locked)")));
      var list = DOM.el(doc, "dl", null, "xfer-confirm");
      function row(term, text, title) {
        list.appendChild(DOM.el(doc, "dt", term));
        var dd = DOM.el(doc, "dd", text);
        if (title) dd.title = title;
        list.appendChild(dd);
      }
      row(t("transfer.proposer_label", "Proposer"), P.proposer.name + " (" + P.proposer.id + ")");
      row(t("transfer.expiration_label", "Expiration"), P.pair[1].expiration_time);
      var rev = P.pair[1].review_period_seconds;
      row(t("transfer.review_period_label", "Review period"), (rev === null || rev === undefined) ? t("transfer.review_period_none", "none") : Proposal.durToHuman(rev));
      row(t("confirm.from", "From"), P.leg.fromAcc.name + " (" + P.leg.fromAcc.id + ")");
      row(t("confirm.to", "To"), P.leg.to.name + " (" + P.leg.to.id + ")");
      row(t("confirm.amount", "Amount"),
        Format.formatAmount(P.leg.amountInt, P.leg.asset.precision) + " " + P.leg.asset.symbol, P.leg.amountInt);
      row(t("confirm.memo", "Memo"), P.leg.memoKind === "plain" ? t("transfer.memo_plain_prefix", "Plain: ") + P.leg.memoText :
        (P.leg.lockedEnc ? t("transfer.locked_encrypted_hint", "Encrypted memos need the wallet keys — unlock first, or switch the memo to plain.") : t("transfer.memo_none", "(none)")));
      row(t("common.fee_live", "Fee (live)"), P.fh.text, String(P.pair[1].fee.amount));
      row(t("confirm.network", "Network"), networkNameLocal());
      box.appendChild(list);
      box.appendChild(DOM.el(doc, "p",
        t("transfer.locked_sign_hint", "Unlock to sign — the password is asked only here, at signing."), "muted"));
      var pwRow = DOM.el(doc, "div", null, "xfer-field");
      var pw = doc.createElement("input");
      pw.type = "password"; pw.setAttribute("autocomplete", "current-password");
      pw.setAttribute("aria-label", t("wallet.password", "Password")); touchable(pw); pwRow.appendChild(pw);
      var ub = touchable(DOM.el(doc, "button", t("transfer.unlock_sign", "Unlock & Sign")));
      ub.type = "button"; pwRow.appendChild(ub);
      box.appendChild(pwRow);
      ub.addEventListener("click", function () {
        ub.disabled = true;
        env.showStatus(doc, box, t("transfer.unlocking", "Unlocking…"));
        /* H2: wipe the password local + input on either outcome. */
        var pwStr = pw.value;
        Promise.resolve().then(function () { return Wallet.unlock(pwStr); })
          .then(function (r) { try { pw.value = ""; } catch (wipeErr) { /* input gone */ } pwStr = null; return r; })
          .then(function () { return Account.myAccountId(); })
          .then(async function (wid) {
            var proposer = await Account.resolve(wid);
            var snap2 = {
              from: vals.from, to: vals.to, asset: vals.asset, amount: vals.amount,
              memo: vals.memo, encrypted: vals.encrypted, feeAsset: vals.feeAsset,
              proposer: wid, expiration: vals.expiration, reviewPeriod: vals.reviewPeriod
            };
            var leg = await resolveProposeLeg(snap2, false);
            var pair = Proposal.buildCreate({ feePayerId: wid,
              expirationIso: normaliseExpiration(snap2.expiration),
              reviewPeriodSecOrNull: parseReviewPeriod(snap2.reviewPeriod),
              innerOps: [{ op: [0, leg.opData] }] });
            var before = (await Proposal.proposalsFor(proposer.name || wid)).length;
            await Proposal.fee(pair, "1.3.0");
            var fh = await feeHumanFor(pair[1].fee);
            var typed = String(vals.proposer || "").trim();
            var switched = typed !== "" && typed !== wid && typed !== proposer.name;
            return { proposer: proposer, leg: leg, pair: pair, before: before,
              snap: snap2, fh: fh, switched: switched };
          })
          .then(function (built) {
            DOM.clear(root);
            var w2 = env.makeWrap(doc, root);
            if (built.switched) {
              w2.appendChild(DOM.el(doc, "p",
                t("transfer.unlocked_rebuilt_prefix", "Unlocked — proposal rebuilt with you (") + built.proposer.name + t("transfer.unlocked_rebuilt_suffix", ") as proposer."), "muted"));
            }
            showProposeConfirm(doc, w2, root, built, built.fh, function () {
              DOM.clear(root);
              env.showForm(doc, env.makeWrap(doc, root), root, built.proposer, {
                from: built.snap.from, to: built.snap.to, asset: built.snap.asset,
                amount: built.snap.amount, memo: built.snap.memo, encrypted: built.snap.encrypted,
                feeAsset: built.snap.feeAsset, mode: "propose",
                proposer: built.snap.proposer, expiration: built.snap.expiration,
                reviewPeriod: built.snap.reviewPeriod, error: null
              });
            }, env);
          })
          .catch(function (e2) {
            try { pw.value = ""; } catch (wipeErr2) { /* input gone */ }
            pwStr = null;
            ub.disabled = false;
            env.showError(doc, box, e2, t("common.unlock_failed", "Unlock failed."));
          });
      });
      done();
    }).catch(function (e) {
      DOM.clear(box);
      env.showError(doc, box, (e && e.message) ? e.message : t("transfer.could_not_build_proposal", "Could not build the proposal."),
        t("transfer.prepare_failed", "Could not prepare the transfer."));
      done();
    });
  }

  return {
    proposeReviewUnlocked: proposeReviewUnlocked,
    lockedProposePreview: lockedProposePreview
  };
})();

if (typeof module !== "undefined") { module.exports = TransferPropose; }
