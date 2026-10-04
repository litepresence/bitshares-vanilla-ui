/* transfer-preview.js — locked read-only transfer preview (op 0).
 *
 * What it owns: lockedPreview (recipient/asset/amount/fee read-only preview
 * + Unlock & Sign, password asked only at signing) plus its private chain
 * lookups (utf8HexLocal, lookupAssetLocal, fullAccountLocal,
 * networkNameLocal) — verbatim replicas of the transfer-confirm.js steps,
 * same node calls, same wire shapes (plain-memo path only).
 * Consumes: script-tag globals guarded at call time (DOM, Forms, touchable,
 * Tx, Account, Wallet, Crypto, Format, Chain, Store, ViewingAs, Offline,
 * TransferConfirm) + I18n.t via the private t() below; facade-owned DOM
 * helpers arrive as the trailing env ({showForm, makeWrap, showError,
 * showStatus} — same function objects as the pre-split file, threaded by
 * the facade so this module never reads the TransferUI global).
 * Globals/side effects: DOM under the given preview box only; global
 * TransferPreview only. No keys leave this module (WIFs pass as JS values
 * into Wallet.unlock only; the password input is wiped on either outcome).
 * Split from: vanilla/js/views/transfer-ui.js (mechanical move, zero
 * behavior change — called by showForm via the facade).
 * Created by: building-vanilla-slices skill, view-split task.
 */
var TransferPreview = (function () {
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

  /* Locked read-only preview. transfer-confirm.js is out of scope for this
   * repair, so its lookup/fee steps are replicated here verbatim (same node
   * calls, same wire shapes — plain-memo path only). Locked + encrypted
   * memos need wallet keys, so the memo stays OUT of the locked unsigned
   * envelope while From/To/Asset/Amount/Fee still preview (memo row shows
   * the locked-encrypted hint). After unlock the flow hands back to
   * TransferConfirm.review/showConfirm, which re-validates everything
   * (including the encrypted memo, via the passthrough below) against the
   * wallet account. */
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

  /* Locked preview: resolve From/To/asset, parse the amount, build the
   * unsigned op-0 envelope + live fee, render human rows, then offer
   * Unlock & Sign (password asked only here). Amounts stay integer strings. */
  function lockedPreview(doc, box, root, vals, reviewBtn, env) {
    DOM.clear(box);
    reviewBtn.disabled = true;
    env.showStatus(doc, box, t("transfer.checking", "Checking recipient, asset, and fee…"));
    function done() { reviewBtn.disabled = false; }
    Promise.resolve().then(async function () {
      if (!vals.to || !String(vals.to).trim()) throw new Error(t("transfer.recipient_required", "Recipient is required."));
      var fromAcc = await Account.resolve(String(vals.from || "").trim() || ((typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0"));
      var to = await Account.resolve(String(vals.to).trim());
      var asset = await lookupAssetLocal(vals.asset);
      var amountInt;
      try {
        amountInt = Format.parseAmount(vals.amount, asset.precision);
      } catch (e) {
        throw new Error(e && e.message ? e.message : "bad amount");
      }
      if (!/[1-9]/.test(amountInt)) throw new Error(t("transfer.amount_positive", "Amount must be greater than zero."));
      var memoText = String(vals.memo || ""), memoObj = null, memoKind = "none", lockedEnc = false;
      if (memoText) {
        var toFull = await fullAccountLocal(to.id);
        var toMemoKey = toFull && toFull.options ? toFull.options.memo_key : null;
        if (!toMemoKey) throw new Error("Recipient " + to.name + " has no memo key; clear the memo to continue.");
        if (vals.encrypted) {
          /* G7: locked keys cannot encrypt — exclude the memo from the
           * locked envelope, preview everything else with a placeholder row. */
          lockedEnc = true;
          memoKind = "locked-encrypted";
        } else {
          memoObj = { from: "", to: toMemoKey, nonce: "0", message: utf8HexLocal(memoText) };
          memoKind = "plain";
        }
      }
      /* Fee in the chosen asset (transfer asset by default): resolved to
       * id + precision here so the preview displays the right symbol at
       * the right decimals. An unresolvable choice fails loudly below —
       * never a wrong number. */
      var wantFeeSym = String(vals.feeAsset || asset.symbol).trim().toUpperCase() || asset.symbol;
      var feeId = asset.id, feePrec = asset.precision, feeSym = asset.symbol;
      if (wantFeeSym !== asset.symbol) {
        var feeAsset = await lookupAssetLocal(wantFeeSym);
        feeId = feeAsset.id;
        feePrec = feeAsset.precision;
        feeSym = feeAsset.symbol;
      }
      var unsigned = await Tx.buildTransfer({
        fromId: fromAcc.id, toId: to.id, amountInt: amountInt, assetId: asset.id, memoObj: memoObj
      });
      var fee = await Tx.fee(0, unsigned.operations[0][1], feeId);
      return { fromAcc: fromAcc, to: to, asset: asset, amountInt: amountInt,
        memoText: memoText, memoKind: memoKind, lockedEnc: lockedEnc,
        encrypted: !!vals.encrypted, fee: fee,
        feeSym: feeSym, feePrec: feePrec };
    }).then(function (P) {
      DOM.clear(box);
      box.appendChild(DOM.el(doc, "h2", t("transfer.preview_title", "Transfer preview (locked)")));
      var list = DOM.el(doc, "dl", null, "xfer-confirm");
      function row(term, text, title) {
        list.appendChild(DOM.el(doc, "dt", term));
        var dd = DOM.el(doc, "dd", text);
        if (title) dd.title = title;
        list.appendChild(dd);
      }
      row(t("confirm.from", "From"), P.fromAcc.name + " (" + P.fromAcc.id + ")");
      row(t("confirm.to", "To"), P.to.name + " (" + P.to.id + ")");
      row(t("confirm.amount", "Amount"),
        Format.formatAmount(P.amountInt, P.asset.precision) + " " + P.asset.symbol, P.amountInt);
      row(t("confirm.memo", "Memo"), P.memoKind === "plain" ? "Plain: " + P.memoText :
        (P.lockedEnc ? t("transfer.locked_encrypted_hint", "Encrypted memos need the wallet keys — unlock first, or switch the memo to plain.") : "(none)"));
      var feeHuman;
      try {
        feeHuman = Format.formatAmount(String(P.fee.amount), P.feePrec) + " " + P.feeSym;
      } catch (e) { feeHuman = String(P.fee.amount) + " " + P.feeSym; }
      row(t("confirm.fee", "Fee") + " (" + P.feeSym + ")", feeHuman, String(P.fee.amount));
      row(t("confirm.network", "Network"), networkNameLocal());
      box.appendChild(list);
      box.appendChild(DOM.el(doc, "p",
        t("common.locked_sign", "Wallet is locked — unlock to sign. The preview above stays visible; password is asked only here, at signing."), "muted"));
      var pwRow = DOM.el(doc, "div", null, "xfer-field");
      var pw = doc.createElement("input");
      pw.type = "password"; pw.setAttribute("autocomplete", "current-password");
      pw.setAttribute("aria-label", t("wallet.password", "Password")); touchable(pw); pwRow.appendChild(pw);
      var ub = touchable(DOM.el(doc, "button", t("transfer.unlock_sign", "Unlock & review")));
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
          .then(function (wid) {
            if (wid !== P.fromAcc.id) {
              throw new Error("Unlocked as " + wid + " but From is " +
                P.fromAcc.name + " (" + P.fromAcc.id + ") — switch From or unlock with that account's key.");
            }
            return TransferConfirm.review({
              to: P.to.name, asset: P.asset.symbol,
              amount: Format.formatAmount(P.amountInt, P.asset.precision),
              memo: P.memoText, encrypted: !!(P.encrypted && P.memoText),
              feeAsset: P.feeSym
            });
          })
          .then(function (ctx) {
            DOM.clear(root);
            TransferConfirm.showConfirm(doc, env.makeWrap(doc, root), root, P.fromAcc, ctx, function () {
              DOM.clear(root);
              env.showForm(doc, env.makeWrap(doc, root), root, P.fromAcc, {
                from: P.fromAcc.name, to: ctx.to.name, asset: ctx.asset.symbol,
                amount: Format.formatAmount(ctx.amountInt, ctx.asset.precision),
                memo: ctx.memoText, encrypted: ctx.memoKind !== "plain",
                feeAsset: P.feeSym, mode: (vals.mode || "send"),
                proposer: vals.proposer, expiration: vals.expiration,
                reviewPeriod: vals.reviewPeriod, error: null
              });
            });
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
      env.showError(doc, box, (e && e.message) ? e.message : String(e || "Could not prepare the transfer."),
        t("transfer.prepare_failed", "Could not prepare the transfer."));
      done();
    });
  }

  return {
    lockedPreview: lockedPreview
  };
})();

if (typeof module !== "undefined") { module.exports = TransferPreview; }
