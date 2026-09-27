/* barter-ui.js — #/barter two-sided barter form + atomic preview (split OUT of credit-ui.js).
 * Owns: peer A / peer B account inputs + N asset rows per side (mirrors #1
 *   Showcases/Barter.jsx add-asset pattern) + optional escrow leg + per-side
 *   balance warnings (integer math, port the SHAPE of Barter.jsx
 *   checkAmountsTotal) + human-readable atomic preview ("A gives X → B; B
 *   gives Y → A") + live leg-fee hints (each leg fee-estimated as a transfer;
 *   the op-22 fee itself lands with slice 14) + PROPOSE button
 *   DISABLED with an honest slice-14 note. ZERO new serializers for barter —
 *   ever: #1 builds a transfer_list handed to op-22 create, and
 *   op-22 wiring is slice 14's. This form places zero transactions. Offline
 *   shows Retry plus auto-resubscribe on reconnect (htlc-ui pattern).
 * Consumes: Format (parse/format, string math only), Account (resolve/balances),
 *   Asset.describe, Tx.fee (leg hints only — never broadcast), Chain/Store,
 *   Wallet (unlock gate only). Created by: building-vanilla-slices skill,
 *   slice-13-credit plan Task 3 (pre-authorized split — credit-ui.js cap).
 * CHAIN TRUTH (#4 wins): barter = op-22 UI over transfer lists
 *   (bitshares-ui Showcases/Barter.jsx:335-450, App.jsx:159-162 route). No
 *   chain call is made here except reads (resolve/describe/balances/fee hints).
 */
var BarterUI = (function () {
  "use strict";
  var gen = 0;
  var openSubs = []; /* pending connect watchers; drained on every entry so none leak */
  function dropOpenSubs() { openSubs.forEach(function (off) { try { off(); } catch (e) {} }); openSubs = []; }
  /* Re-run the entry when the socket opens (htlc-ui autoRetryOnOpen pattern).
   * Barter owns its gen, so the isLive gate is passed spotlight-style
   * (debit-ui precedent): a closure over this entry's gen. */
  function autoRetryOnOpen(myGen, retryFn, isLive) {
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
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text; return n;
  }
  function touchable(n) { n.style.minHeight = "44px"; return n; }
  function clearBox(b) { while (b.firstChild) b.removeChild(b.firstChild); }
  function showError(doc, wrap, e, fallback) {
    var m = (e && e.message) ? e.message : String(e || fallback || "Unexpected error");
    if (m.indexOf("not-connected") !== -1) m = "Network unavailable. Check Settings → Nodes and retry.";
    else if (m.indexOf("wallet-locked") !== -1) m = "Wallet is locked.";
    else if (m.indexOf("unknown-account") !== -1) m = "Unknown account.";
    else if (m.indexOf("unknown-asset") !== -1) m = "Unknown asset.";
    var err = el(doc, "div", m, "error"); err.setAttribute("aria-live", "polite");
    wrap.appendChild(err); return err;
  }
  function showStatus(doc, wrap, text) {
    var p = el(doc, "p", text, "muted"); p.setAttribute("aria-live", "polite"); wrap.appendChild(p); return p;
  }
  function field(doc, labelText, opts) {
    opts = opts || {};
    var row = el(doc, "div", null, "xfer-field"), label = el(doc, "label", labelText + " ");
    var input = doc.createElement("input");
    if (opts.value !== undefined) input.value = opts.value;
    if (opts.placeholder) input.setAttribute("placeholder", opts.placeholder);
    if (opts.inputmode) input.setAttribute("inputmode", opts.inputmode);
    touchable(input); label.appendChild(input); row.appendChild(label); return { row: row, input: input };
  }
  /* One barter leg row: asset + human amount (empty asset rows are skipped). */
  function legRow(doc, box) {
    var r = el(doc, "div", null, "xfer-field");
    var fa = doc.createElement("input"); fa.setAttribute("placeholder", "asset (symbol or 1.3.x)"); touchable(fa);
    var fq = doc.createElement("input"); fq.setAttribute("placeholder", "amount"); fq.setAttribute("inputmode", "decimal"); touchable(fq);
    r.appendChild(fa); r.appendChild(fq); box.appendChild(r);
    return { asset: fa, amount: fq };
  }
  /* Route entry: #/barter — two-sided form + escrow + preview; PROPOSE disabled. */
  function renderBarter(root) {
    if (!root) return;
    var doc = root.ownerDocument || document, myGen = ++gen;
    dropOpenSubs();
    root.innerHTML = "";
    ["Tx", "Account", "Wallet", "Format", "Asset", "Chain", "Store"].forEach(function () { /* checked below */ });
    var wrap = el(doc, "div", null, "wrap"); root.appendChild(wrap);
    wrap.appendChild(el(doc, "h1", "Barter"));
    var miss = ["Tx", "Account", "Wallet", "Format", "Asset", "Chain", "Store"].filter(function (g) {
      return typeof globalThis[g] === "undefined"; });
    if (miss.length) { showError(doc, wrap, "Barter backend missing: " + miss.join(", ") + " failed to load."); return; }
    if (Chain.status().state !== "open") {
      wrap.appendChild(el(doc, "p", "Network unavailable. Check Settings → Nodes and retry.", "muted"));
      var retry = touchable(el(doc, "button", "Retry")); retry.type = "button";
      retry.addEventListener("click", function () { if (myGen === gen) renderBarter(root); });
      wrap.appendChild(retry);
      autoRetryOnOpen(myGen, function () { renderBarter(root); }, function () { return myGen === gen; });
      return;
    }
    if (!Wallet.isUnlocked()) {
      wrap.appendChild(el(doc, "p", "Wallet is locked. Enter your password to continue.", "muted"));
      var inp = doc.createElement("input"); inp.type = "password"; touchable(inp); wrap.appendChild(inp);
      var u = touchable(el(doc, "button", "Unlock")); u.type = "button"; wrap.appendChild(u);
      u.addEventListener("click", function () { u.disabled = true;
        Wallet.unlock(inp.value).then(function () { if (myGen === gen) renderBarter(root); })
          .catch(function (e) { u.disabled = false; showError(doc, wrap, e, "Unlock failed."); });
      });
      return;
    }
    wrap.appendChild(el(doc, "p", "Two-sided atomic swap preview. Nothing here broadcasts: proposing lands with op-22 support in slice 14.", "muted"));
    var fA = field(doc, "Peer A account", { placeholder: "name or 1.2.N" });
    wrap.appendChild(fA.row);
    wrap.appendChild(el(doc, "h2", "A gives"));
    var boxA = el(doc, "div"); wrap.appendChild(boxA);
    var legsA = [legRow(doc, boxA)];
    var addA = touchable(el(doc, "button", "Add asset row (A)")); addA.type = "button"; wrap.appendChild(addA);
    addA.addEventListener("click", function () { legsA.push(legRow(doc, boxA)); });
    var fB = field(doc, "Peer B account", { placeholder: "name or 1.2.N" });
    wrap.appendChild(fB.row);
    wrap.appendChild(el(doc, "h2", "B gives"));
    var boxB = el(doc, "div"); wrap.appendChild(boxB);
    var legsB = [legRow(doc, boxB)];
    var addB = touchable(el(doc, "button", "Add asset row (B)")); addB.type = "button"; wrap.appendChild(addB);
    addB.addEventListener("click", function () { legsB.push(legRow(doc, boxB)); });
    var fEsc = field(doc, "Escrow account (optional)", { placeholder: "blank = none" });
    wrap.appendChild(fEsc.row);
    var check = touchable(el(doc, "button", "Preview barter")); check.type = "button"; wrap.appendChild(check);
    var out = el(doc, "div", null, "xfer-out"); wrap.appendChild(out);
    var propose = touchable(el(doc, "button", "Propose (lands in slice 14)"));
    propose.type = "button"; propose.disabled = true;
    propose.title = "Disabled: proposal broadcast (op 22) lands in slice 14.";
    wrap.appendChild(propose);
    wrap.appendChild(el(doc, "p", "Proposing is disabled until proposal broadcast lands in slice 14 (op-22 serializer owner). This form never sends a transaction.", "muted"));
    check.addEventListener("click", function () {
      if (myGen !== gen) return;
      clearBox(out); check.disabled = true;
      showStatus(doc, out, "Resolving and checking balances…");
      preview(doc, out, myGen, fA.input.value.trim(), legsA, fB.input.value.trim(), legsB, fEsc.input.value.trim())
        .then(function () { check.disabled = false; })
        .catch(function (e) {
          if (myGen !== gen) return; clearBox(out);
          showError(doc, out, e, "Could not preview the barter."); check.disabled = false;
        });
    });
  }
  /* Resolve one side: account + per-leg asset/precision + raw amounts + balance warnings. */
  async function readSide(acctV, legs, sideName) {
    if (!acctV) throw new Error(sideName + ": set the account.");
    var acct = await Account.resolve(acctV);
    var bals = [];
    try { bals = await Account.balances(acct.id); } catch (e) { bals = []; }
    var byId = {};
    bals.forEach(function (b) { byId[b.asset_id] = b.raw; });
    var items = [], warnings = [];
    for (var i = 0; i < legs.length; i++) {
      var av = legs[i].asset.value.trim(), qv = legs[i].amount.value.trim();
      if (!av && !qv) continue;
      if (!av || !qv) throw new Error(sideName + " row " + (i + 1) + ": asset and amount are both required.");
      var info = await Asset.describe(av);
      var raw = Format.parseAmount(qv, info.precision);
      if (BigInt(raw) <= 0n) throw new Error(sideName + " row " + (i + 1) + ": amount must be > 0.");
      var have = byId[info.id];
      if (have === undefined) warnings.push(sideName + " has no " + info.symbol + " balance.");
      else if (BigInt(raw) > BigInt(have))
        warnings.push(sideName + " wants " + Format.formatAmount(raw, info.precision) + " " + info.symbol +
          " but holds " + Format.formatAmount(have, info.precision) + ".");
      items.push({ symbol: info.symbol, id: info.id, prec: info.precision, raw: raw });
    }
    if (!items.length) throw new Error(sideName + ": add at least one asset row.");
    return { acct: acct, items: items, warnings: warnings };
  }
  /* Preview: per-side lines + warnings + atomic sentence + live leg-fee hints. */
  async function preview(doc, out, myGen, acctA, legsA, acctB, legsB, escV) {
    var A = await readSide(acctA, legsA, "Side A");
    if (myGen !== gen) return;
    var B = await readSide(acctB, legsB, "Side B");
    if (myGen !== gen) return;
    var esc = null;
    if (escV) { esc = await Account.resolve(escV); if (myGen !== gen) return; }
    clearBox(out);
    out.appendChild(el(doc, "h3", "Atomic preview"));
    function sideLines(side, givesTo) {
      side.items.forEach(function (it) {
        out.appendChild(el(doc, "p", side.acct.name + " gives " + Format.formatAmount(it.raw, it.prec) +
          " " + it.symbol + " → " + givesTo, ""));
      });
    }
    sideLines(A, B.acct.name); sideLines(B, A.acct.name);
    if (esc) out.appendChild(el(doc, "p", "Escrow leg via " + esc.name + " (" + esc.id + ").", "muted"));
    var warns = A.warnings.concat(B.warnings);
    if (warns.length) warns.forEach(function (w) { out.appendChild(el(doc, "p", "Warning: " + w, "error")); });
    else out.appendChild(el(doc, "p", "Both sides hold every leg amount (integer check).", "muted"));
    var status = showStatus(doc, out, "Estimating leg fees…");
    var hints = [];
    async function legFee(fromId, toId, it) {
      var op = { fee: { amount: "0", asset_id: "1.3.0" }, from: fromId, to: toId,
        amount: { amount: it.raw, asset_id: it.id }, memo: { from: null, to: null, nonce: "0", message: null }, extensions: [] };
      try {
        var f = await Tx.fee(0, op, "1.3.0");
        hints.push(it.symbol + ": " + String(f.amount) + " (" + String(f.asset_id) + ")");
      } catch (e) { hints.push(it.symbol + ": fee hint unavailable"); }
    }
    for (var i = 0; i < A.items.length; i++) { await legFee(A.acct.id, B.acct.id, A.items[i]); if (myGen !== gen) return; }
    for (var k = 0; k < B.items.length; k++) { await legFee(B.acct.id, A.acct.id, B.items[k]); if (myGen !== gen) return; }
    out.removeChild(status);
    out.appendChild(el(doc, "p", "Leg fee hints (transfer-rate estimate; op-22 fee lands slice 14): " + hints.join("; "), "muted"));
  }

  return { renderBarter: renderBarter };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.BarterUI === "undefined") { globalThis.BarterUI = BarterUI; }
if (typeof module !== "undefined") { module.exports = BarterUI; }
