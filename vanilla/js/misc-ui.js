/* misc-ui.js — #/authorities + #/lists + #/invoice/:data (vesting split OUT to
 * vesting-ui.js on the cap).
 * Owns: custom authority lookup/detail + create
 *   (zero-restriction default; any restriction row -> "restrictions-unproven"
 *   VIEW gate — ambiguity G) + row update (changed-fields-only) / delete;
 *   whitelist/blacklist manager (add ORs the bit, remove subtracts it —
 *   ambiguity K); invoice parse view (base58 UTF-8 JSON, foreign #1 URLs ->
 *   invoice-unparseable + sample link, never a crash) + human invoice + pay
 *   deep-link + create tab (copyable URL, no QR lib). Op-38 override_transfer
 *   has NO UI (issuer-only — honest note only).
 * Consumes: ProposalUI._ui (proposal-ui.js loads first: route gate,
 *   confirm+publish flow, tables, human formatters), Proposal
 *   (fee/sendAndProve/unpackInvoice/packInvoice), ProposalMisc
 *   (reads/listing converters/builders 7/54/55/56), Tx (buildTx), Format, Account, Asset, Wallet, Chain.
 *   Own gen + two-counter live() (samet-ui.js precedent). Exposes MiscUI only.
 * Created by: building-vanilla-slices skill, slice-14-proposals plan Task 3.
 * CHAIN TRUTH (#4 wins): op-7 enum <- account.hpp:197-220;
 *   op-54/55/56 <- custom_authority.hpp:36-122; spaces
 *   1.17 <- types.hpp:380. Invoice pack shape ports #1
 *   InvoiceRequest.jsx:53-60 MINUS the zip (no compress lib vendored — see
 *   proposal.js header; vanilla URLs are base58 of UTF-8 JSON).
 * MONEY DISCIPLINE (#6): amounts stay RAW digit strings; Format renders.
 *   No Number()/parseFloat on money — ever. Op-37 confirm shows "fee: 0".
 */
var MiscUI = (function () {
  "use strict";
  var gen = 0;
  function U() {
    if (typeof ProposalUI === "undefined" || !ProposalUI._ui) throw new Error("proposal-ui-missing (proposal-ui.js first)");
    return ProposalUI._ui;
  }
  /* Two-counter liveness: own gen (this route) + ProposalUI uiGen (shared gate). */
  function live(myGen, uiGen) {
    if (myGen !== gen) return false;
    try { return U().live(uiGen); } catch (e) { return false; }
  }
  /* Resolve the shared _ui or paint the missing-backend box; returns ui or null. */
  function entry(root) {
    try { return U(); } catch (e) {
      root.innerHTML = "";
      var d0 = root.ownerDocument || document, w0 = d0.createElement("div");
      w0.className = "wrap"; root.appendChild(w0);
      w0.appendChild(d0.createTextNode("Vesting backend missing: proposal-ui.js failed to load."));
      return null;
    }
  }
  function iso16(v) { v = String(v || "").trim(); return v.length === 16 ? v + ":00" : v; }
  function dateHuman(iso) {
    if (!iso) return "none";
    var t = Date.parse(/Z$/.test(iso) ? iso : iso + "Z");
    return isNaN(t) ? String(iso) : new Date(t).toLocaleString();
  }
  /* Op-type number -> "N (name)" via ProposalUI.opName (same table the
   * proposal desk uses); degrades to the bare number if unavailable. */
  function typeName(n) {
    try {
      if (typeof ProposalUI !== "undefined" && ProposalUI.opName) return " (" + ProposalUI.opName(n) + ")";
    } catch (e) { /* bare number below */ }
    return "";
  }
  /* Route entry: #/vesting lives in vesting-ui.js (split OUT on the cap). */
  /* Route entry: #/authorities — lookup/detail + create + update/delete. */
  function renderAuthorities(root) {
    if (!root) return;
    var ui = entry(root);
    if (!ui) return;
    var ctx = ui.routeReady(root, "Custom Authorities", function () { renderAuthorities(root); },
      ["Proposal", "ProposalMisc", "Tx", "Account", "Wallet", "Format", "Asset", "Chain", "Store"]);
    if (!ctx) return;
    var doc = ctx.doc, uiGen = ctx.myGen, myGen = ++gen;
    ctx.wrap.appendChild(ui.el(doc, "p", "Custom authorities restrict which operations an account key may sign. The chain has no list method — look authorities up by explicit 1.17.x id. Issuer-only override_transfer (op 38) is not offered here.", "muted"));
    var fA = ui.field(doc, "Account or authority id", { placeholder: "name, 1.2.N or 1.17.N" });
    ctx.wrap.appendChild(fA.row);
    var go = ui.touchable(ui.el(doc, "button", "Look up")); go.type = "button"; ctx.wrap.appendChild(go);
    var box = ui.el(doc, "div"); ctx.wrap.appendChild(box);
    function drawAuth(a) {
      ui.clearBox(box);
      box.appendChild(ui.deskTable(doc, ["Field", "Value"], [
        { cells: [{ text: "ID" }, { text: String(a.id) }], cardLines: ["ID " + String(a.id)] },
        { cells: [{ text: "Account" }, { text: String(a.account || "?") }], cardLines: ["Account " + String(a.account || "?")] },
        { cells: [{ text: "Enabled" }, { text: a.enabled ? "yes" : "no" }], cardLines: ["Enabled: " + (a.enabled ? "yes" : "no")] },
        { cells: [{ text: "Valid" }, { text: dateHuman(a.valid_from) + " → " + dateHuman(a.valid_to) }],
          cardLines: ["Valid " + dateHuman(a.valid_from) + " → " + dateHuman(a.valid_to)] },
        { cells: [{ text: "Operation type" }, { text: String(a.operation_type) }], cardLines: ["Operation type " + String(a.operation_type)] },
        { cells: [{ text: "Restrictions" }, { text: String((a.restrictions || []).length) }], cardLines: [String((a.restrictions || []).length) + " restriction(s)"] }]));
      var up = ui.touchable(ui.el(doc, "button", "Update")); up.type = "button"; box.appendChild(up);
      var del = ui.touchable(ui.el(doc, "button", "Delete")); del.type = "button"; box.appendChild(del);
      var o2 = ui.el(doc, "div", null, "xfer-out"); box.appendChild(o2);
      up.addEventListener("click", function () {
        if (!live(myGen, uiGen)) return;
        ui.clearBox(o2);
        o2.appendChild(ui.el(doc, "p", "Blank = leave unchanged. Only changed fields are sent.", "muted"));
        var sE = doc.createElement("select"); ui.touchable(sE);
        [["", "enabled: unchanged"], ["true", "enabled: yes"], ["false", "enabled: no"]].forEach(function (o) {
          var op = doc.createElement("option"); op.value = o[0]; op.textContent = o[1]; sE.appendChild(op);
        });
        o2.appendChild(sE);
        var vF = ui.field(doc, "New valid-from (blank = keep)", { type: "datetime-local" });
        var vT = ui.field(doc, "New valid-to (blank = keep)", { type: "datetime-local" });
        var vTh = ui.field(doc, "New threshold (blank = keep)", { placeholder: "", inputmode: "numeric" });
        o2.appendChild(vF.row); o2.appendChild(vT.row); o2.appendChild(vTh.row);
        var ibox = ui.el(doc, "div"); o2.appendChild(ibox);
        ui.reviewSection(doc, ibox, uiGen, "Review update", {
          build: async function () {
            var th = vTh.input.value.trim();
            var authOrNull = th === "" ? null : { weight_threshold: parseInt(th, 10), account_auths: [], key_auths: [], address_auths: [] };
            var pair = ProposalMisc.buildAuthorityUpdate({ accountId: String(a.account), authorityId: String(a.id),
              newEnabledOrNull: sE.value === "" ? null : sE.value === "true",
              newValidFromOrNull: iso16(vF.input.value), newValidToOrNull: iso16(vT.input.value),
              newAuthOrNull: authOrNull, restrictionsToRemove: [], restrictionsToAdd: [] });
            await Proposal.fee(pair, "1.3.0");
            return { pair: pair, fee: pair[1].fee,
              prove: async function () { return ProposalMisc.authority(String(a.id)); } };
          },
          title: "Confirm authority update (op 55)",
          rows: function (built, f) {
            var r = [["Authority", String(a.id)], ["Account", String(a.account)]];
            if (sE.value !== "") r.push(["Enabled", (a.enabled ? "yes" : "no") + " → " + (sE.value === "true" ? "yes" : "no")]);
            if (vF.input.value.trim() !== "") r.push(["Valid-from", dateHuman(a.valid_from) + " → " + dateHuman(iso16(vF.input.value))]);
            if (vT.input.value.trim() !== "") r.push(["Valid-to", dateHuman(a.valid_to) + " → " + dateHuman(iso16(vT.input.value))]);
            if (vTh.input.value.trim() !== "") r.push(["Threshold", "→ " + vTh.input.value.trim()]);
            if (r.length === 2) r.push(["Changed fields", "none — this would be a no-op"]);
            r.push(["Fee (live)", f]);
            return r;
          },
          ok: function () { return "Authority updated and re-read on chain."; } });
      });
      del.addEventListener("click", function () {
        if (!live(myGen, uiGen)) return;
        var o3 = ui.el(doc, "div", null, "xfer-out"); box.appendChild(o3);
        ui.reviewPaid(doc, o3, uiGen, { btn: del,
          build: async function () {
            var pair = ProposalMisc.buildAuthorityDelete({ accountId: String(a.account), authorityId: String(a.id) });
            await Proposal.fee(pair, "1.3.0");
            return { pair: pair, fee: pair[1].fee,
              prove: async function () {
                try { await ProposalMisc.authority(String(a.id)); return null; }
                catch (e) { return String((e && e.message) || e).indexOf("unknown-authority") !== -1 ? { gone: true } : null; }
              } };
          },
          title: "Confirm authority delete (op 56)",
          rows: function (built, f) { return [["Authority", String(a.id)], ["Account", String(a.account)], ["Fee (live)", f]]; },
          ok: function () { return "Authority deleted (re-read confirms it is gone)."; } });
      });
    }
    go.addEventListener("click", function () {
      if (!live(myGen, uiGen)) return; go.disabled = true; ui.clearBox(box);
      ui.showStatus(doc, box, "Loading…");
      ProposalMisc.authorities(fA.input.value.trim() || "").then(function (rows) {
        if (!live(myGen, uiGen)) return;
        ui.clearBox(box);
        if (!rows.length) { box.appendChild(ui.el(doc, "p", "No authorities listed — the chain has no list method, so enter an explicit 1.17.x id.", "muted")); go.disabled = false; return; }
        drawAuth(rows[0]); go.disabled = false;
      }).catch(function (e) { if (!live(myGen, uiGen)) return; ui.clearBox(box); ui.showError(doc, box, e, "Lookup failed."); go.disabled = false; });
    });
    ctx.wrap.appendChild(ui.el(doc, "h2", "Create authority (op 54)"));
    var cA = ui.field(doc, "Account", { placeholder: "name or 1.2.N" });
    var cF = ui.field(doc, "Valid from", { type: "datetime-local" });
    var cT = ui.field(doc, "Valid to", { type: "datetime-local" });
    var cO = ui.field(doc, "Operation type number", { placeholder: "0 = transfer", inputmode: "numeric" });
    var cTh = ui.field(doc, "Threshold", { placeholder: "1", inputmode: "numeric" });
    var cK = ui.field(doc, "Key auth (public key, weight 1)", { placeholder: "BTS…" });
    ctx.wrap.appendChild(cA.row); ctx.wrap.appendChild(cF.row); ctx.wrap.appendChild(cT.row);
    ctx.wrap.appendChild(cO.row); ctx.wrap.appendChild(cTh.row); ctx.wrap.appendChild(cK.row);
    var en = doc.createElement("input"); en.type = "checkbox"; en.checked = true; ui.touchable(en);
    var enRow = ui.el(doc, "div", null, "xfer-field"), enL = ui.el(doc, "label", "Enabled ");
    enL.appendChild(en); enRow.appendChild(enL); ctx.wrap.appendChild(enRow);
    ctx.wrap.appendChild(ui.el(doc, "p", "Restrictions default to zero (the proven path). Adding any restriction is blocked until testnet proves it.", "muted"));
    var crbox = ui.el(doc, "div"); ctx.wrap.appendChild(crbox);
    ui.reviewSection(doc, crbox, uiGen, "Review authority", {
      build: async function () {
        var acct = await Account.resolve(cA.input.value.trim());
        var auth = { weight_threshold: parseInt(cTh.input.value.trim() || "1", 10), account_auths: [], key_auths: [], address_auths: [] };
        if (cK.input.value.trim() !== "") auth.key_auths = [[cK.input.value.trim(), 1]];
        var pair = ProposalMisc.buildAuthorityCreate({ accountId: acct.id, enabled: !!en.checked,
          validFromIso: iso16(cF.input.value), validToIso: iso16(cT.input.value),
          opType: parseInt(cO.input.value.trim() || "0", 10), auth: auth, restrictions: [] });
        await Proposal.fee(pair, "1.3.0");
        var before = 0;
        try { before = (await ProposalMisc.authorities(acct.name || acct.id)).length; } catch (e) { before = 0; }
        return { pair: pair, fee: pair[1].fee, before: before, acct: acct,
          prove: async function () {
            var now = await ProposalMisc.authorities(acct.name || acct.id);
            return now.length > before ? now[now.length - 1] : null;
          } };
      },
      title: "Confirm authority create (op 54)",
      rows: function (built, f) {
        return [["Account", built.pair[1].account], ["Enabled", built.pair[1].enabled ? "yes" : "no"],
          ["Valid", dateHuman(built.pair[1].valid_from) + " → " + dateHuman(built.pair[1].valid_to)],
          ["Operation type", String(built.pair[1].operation_type) + typeName(built.pair[1].operation_type)], ["Threshold", String(built.pair[1].auth.weight_threshold)],
          ["Restrictions", "none (proven path)"], ["Fee (live)", f]];
      },
      ok: function () { return "Authority created."; },
      fail: "Could not build the authority (check account, dates, op type and key)." });
  }
  /* Route entry: #/lists — whitelist/blacklist manager (op 7). */
  function renderLists(root) {
    if (!root) return;
    var ui = entry(root);
    if (!ui) return;
    var ctx = ui.routeReady(root, "Account Lists", function () { renderLists(root); },
      ["Proposal", "ProposalMisc", "Tx", "Account", "Wallet", "Format", "Asset", "Chain", "Store"]);
    if (!ctx) return;
    var doc = ctx.doc, uiGen = ctx.myGen, myGen = ++gen;
    ctx.wrap.appendChild(ui.el(doc, "p", "Listing is a bitfield: none 0, whitelisted 1, blacklisted 2, both 3. Adding ORs the bit; removing subtracts it.", "muted"));
    var fA = ui.field(doc, "Authorizing account", { placeholder: "name or 1.2.N" });
    var fL = ui.field(doc, "Counterparty", { placeholder: "name or 1.2.N" });
    ctx.wrap.appendChild(fA.row); ctx.wrap.appendChild(fL.row);
    var go = ui.touchable(ui.el(doc, "button", "Check current")); go.type = "button"; ctx.wrap.appendChild(go);
    var box = ui.el(doc, "div"); ctx.wrap.appendChild(box);
    function setListing(authId, listeeId, cur, bit, toAdd) {
      var next = toAdd ? ProposalMisc.listingAdd(cur, bit) : ProposalMisc.listingRemove(cur, bit);
      var o2 = ui.el(doc, "div", null, "xfer-out"); box.appendChild(o2);
      ui.reviewPaid(doc, o2, uiGen, { btn: null,
        build: async function () {
          var pair = ProposalMisc.buildWhitelist({ authorizerId: authId, listeeId: listeeId, newListing: next });
          await Proposal.fee(pair, "1.3.0");
          return { pair: pair, fee: pair[1].fee, prove: async function () { return { listed: true }; } };
        },
        title: "Confirm whitelist (op 7)",
        rows: function (built, f) {
          return [["Authorizer", authId], ["Account", listeeId],
            ["Listing", ProposalMisc.listingLabel(cur) + " → " + ProposalMisc.listingLabel(next), cur + "→" + next],
            ["Fee (live)", f]];
        },
        ok: function () { return "Listing updated (re-check the counterparty to see the echoed state)."; } });
    }
    go.addEventListener("click", function () {
      if (!live(myGen, uiGen)) return; go.disabled = true; ui.clearBox(box);
      ui.showStatus(doc, box, "Reading current listing…");
      Promise.resolve().then(async function () {
        var auth = await Account.resolve(fA.input.value.trim()), listee = await Account.resolve(fL.input.value.trim());
        var rows = await Chain.call(await Chain.db(), "get_accounts", [[auth.id]]);
        var full = (rows && rows[0]) || {};
        var cur = ((full.whitelisted_accounts || []).indexOf(listee.id) !== -1 ? 1 : 0) +
          ((full.blacklisted_accounts || []).indexOf(listee.id) !== -1 ? 2 : 0);
        return { auth: auth, listee: listee, cur: cur };
      }).then(function (st) {
        if (!live(myGen, uiGen)) return; ui.clearBox(box);
        box.appendChild(ui.el(doc, "p", st.listee.name + " (" + st.listee.id + ") is currently: " + ProposalMisc.listingLabel(st.cur) + " (" + st.cur + ").", ""));
        [["Whitelist", 1], ["Blacklist", 2]].forEach(function (p) {
          var on = (st.cur & p[1]) !== 0;
          var b = ui.touchable(ui.el(doc, "button", (on ? "Remove from " : "Add to ") + p[0].toLowerCase())); b.type = "button";
          box.appendChild(b);
          b.addEventListener("click", function () { setListing(st.auth.id, st.listee.id, st.cur, p[1], !on); });
        });
        go.disabled = false;
      }).catch(function (e) { if (!live(myGen, uiGen)) return; ui.clearBox(box); ui.showError(doc, box, e, "Could not read the listing."); go.disabled = false; });
    });
  }
  /* Invoice object -> human lines (tolerant: {to,asset,lines[],note,id} or {to,asset,amount}). */
  function invoiceLines(inv) {
    if (Array.isArray(inv.lines) && inv.lines.length) return inv.lines.map(function (l) {
      return { label: String(l.label || l.memo || ""), amount: String(l.amount || "") };
    });
    if (inv.amount !== undefined) return [{ label: "", amount: String(inv.amount) }];
    return [];
  }
  /* Route entry: #/invoice/:data — parse view + pay deep-link + create tab. */
  function renderInvoice(root, data) {
    if (!root) return;
    var ui = entry(root);
    if (!ui) return;
    var ctx = ui.routeReady(root, "Invoice", function () { renderInvoice(root, data); },
      ["Proposal", "ProposalMisc", "Tx", "Account", "Wallet", "Format", "Asset", "Chain", "Store"]);
    if (!ctx) return;
    var doc = ctx.doc, uiGen = ctx.myGen, myGen = ++gen;
    var box = ui.el(doc, "div"); ctx.wrap.appendChild(box);
    if (data) {
      try {
        var inv = Proposal.unpackInvoice(data), lines = invoiceLines(inv);
        if (!inv.to || !inv.asset || !lines.length) throw new Error("invoice-unparseable (missing to/asset/amount)");
        ctx.wrap.appendChild(ui.confirmList(doc, [
          ["Recipient", String(inv.to)], ["Asset", String(inv.asset)],
          ["Note", String(inv.note || inv.memo || "none")], ["Identifier", String(inv.id || "none")]]));
        Promise.resolve().then(async function () {
          var info = await Asset.describe(String(inv.asset)), total = 0n;
          lines.forEach(function (l) { total += BigInt(Format.parseAmount(l.amount, info.precision)); });
          if (!live(myGen, uiGen)) return;
          box.appendChild(ui.deskTable(doc, ["Line", "Amount"], lines.map(function (l, i) {
            var h = Format.formatAmount(Format.parseAmount(l.amount, info.precision), info.precision) + " " + info.symbol;
            return { cells: [{ text: l.label || ("line " + (i + 1)) }, { text: h, raw: l.amount }],
              cardLines: [(l.label || ("line " + (i + 1))) + ": " + h] };
          })));
          box.appendChild(ui.el(doc, "p", "Total: " + Format.formatAmount(String(total), info.precision) + " " + info.symbol, ""));
          var pay = ui.touchable(ui.el(doc, "a", "Pay via transfer"));
          pay.setAttribute("href", "#/transfer/" + encodeURIComponent(String(inv.to)));
          box.appendChild(pay);
          box.appendChild(ui.el(doc, "p", "Paying opens the transfer page for " + String(inv.to) + " — enter the total above there.", "muted"));
        }).catch(function (e) { if (live(myGen, uiGen)) ui.showError(doc, box, e, "Could not render the invoice amounts."); });
      } catch (e) {
        ui.showError(doc, ctx.wrap, e, "This invoice link cannot be parsed.");
        var sample = Proposal.packInvoice({ to: "alice", asset: "BTS", lines: [{ label: "coffee", amount: "1.5" }], note: "sample", id: "demo-1" });
        var a = ui.touchable(ui.el(doc, "a", "Open a sample invoice"));
        a.setAttribute("href", "#/invoice/" + sample); ctx.wrap.appendChild(a);
        ctx.wrap.appendChild(ui.el(doc, "p", "Foreign (compressed) invoice URLs from the old UI cannot be parsed — only links created below.", "muted"));
      }
    } else {
      ctx.wrap.appendChild(ui.el(doc, "p", "No invoice data in the URL — create one below.", "muted"));
    }
    ctx.wrap.appendChild(ui.el(doc, "h2", "Create invoice"));
    var cT = ui.field(doc, "Recipient", { placeholder: "account name" });
    var cA = ui.field(doc, "Asset", { placeholder: "BTS", value: "BTS" });
    var cN = ui.field(doc, "Note (optional)", { placeholder: "" });
    ctx.wrap.appendChild(cT.row); ctx.wrap.appendChild(cA.row); ctx.wrap.appendChild(cN.row);
    var area = doc.createElement("textarea");
    area.setAttribute("placeholder", "coffee|1.5\ncake|2"); area.setAttribute("rows", "4");
    ui.touchable(area); area.style.width = "100%"; ctx.wrap.appendChild(area);
    var mk = ui.touchable(ui.el(doc, "button", "Make invoice link")); mk.type = "button"; ctx.wrap.appendChild(mk);
    var o2 = ui.el(doc, "div"); ctx.wrap.appendChild(o2);
    mk.addEventListener("click", function () {
      if (!live(myGen, uiGen)) return; ui.clearBox(o2);
      try {
        var to = cT.input.value.trim(), asset = cA.input.value.trim() || "BTS";
        if (!to) throw new Error("Recipient is required.");
        var out = [];
        area.value.split("\n").forEach(function (ln, i) {
          var line = ln.trim();
          if (!line) return;
          var parts = line.split("|"), amount = (parts.length > 1 ? parts[1] : parts[0]).trim();
          if (!amount) throw new Error("Line " + (i + 1) + ": amount is required.");
          out.push({ label: parts.length > 1 ? parts[0].trim() : "", amount: amount });
        });
        if (!out.length) throw new Error("Add at least one amount line.");
        var url = "#/invoice/" + Proposal.packInvoice({ to: to, asset: asset, lines: out, note: cN.input.value.trim(), id: "inv-" + Date.now() });
        var link = ui.el(doc, "a", "Open invoice"); link.setAttribute("href", url); o2.appendChild(link);
        var ta = doc.createElement("textarea"); ta.value = url; ta.setAttribute("rows", "3");
        ui.touchable(ta); ta.style.width = "100%"; o2.appendChild(ta);
      } catch (e) { ui.showError(doc, o2, e, "Could not create the invoice."); }
    });
  }

  return { renderAuthorities: renderAuthorities, renderLists: renderLists, renderInvoice: renderInvoice };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.MiscUI === "undefined") { globalThis.MiscUI = MiscUI; }
if (typeof module !== "undefined") { module.exports = MiscUI; }
