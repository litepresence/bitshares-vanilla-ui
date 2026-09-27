/* vesting-ui.js — #/vesting desk (split OUT of misc-ui.js on the cap).
 * Owns: vesting table + create (instant/cdd/linear) + row claim (over-claim
 *   blocked client-side — ambiguity E) + balance claim op 37 (fee 0, owner-key
 *   signature) + BLIND panel (get_blinded_balances read-only lookup + DISABLED
 *   transfer buttons with the vendoring reason — blind 39/40/41 downscoped,
 *   never serialized).
 * Consumes: ProposalUI._ui (proposal-ui.js loads first: route gate,
 *   confirm+publish flow, tables, human formatters), Proposal
 *   (fee/sendAndProve/durToHuman/blindedLookup/blindSend), ProposalMisc
 *   (reads/builders 32/33/37), Tx (buildTx), Format, Account, Asset, Wallet,
 *   Chain. Own gen + two-counter live() (ticket-ui.js precedent). Exposes
 *   global VestingUI only.
 * Created by: building-vanilla-slices skill, slice-14 cap-breach remedy.
 * CHAIN TRUTH (#4 wins): op-32/33 policies <- vesting.hpp:74-117 (ARRAY form
 *   [t,d] only); op-37 fee 0 + owner-KEY auth <- balance.hpp:40-57;
 *   spaces 1.13/1.15 <- types.hpp:376/:378.
 * MONEY DISCIPLINE (#6): amounts stay RAW digit strings; Format renders.
 *   No Number()/parseFloat on money — ever. Op-37 confirm shows "fee: 0".
 * NOTE: iso16/dateHuman duplicate the tiny copies in misc-ui.js on purpose
 *   (the authorities view still needs them there) — doctrine rule 5 prefers
 *   duplicated plain code over a shared helper with cross-file coupling.
 */
var VestingUI = (function () {
  "use strict";
  var gen = 0;
  /* Shared-_ui accessor: ProposalUI._ui (proposal-ui.js loads first); throws proposal-ui-missing otherwise. */
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
  /* Vesting policy -> human WORDS (amounts stay out — caller joins). */
  function policyWords(p) {
    if (p.kind === "linear") return "linear · begin " + p.beginHuman + " · cliff " +
      Proposal.durToHuman(p.cliff_sec) + " · duration " + Proposal.durToHuman(p.duration_sec);
    if (p.kind === "cdd") return "locked until claimed · start " + p.beginHuman + " · vests over " + Proposal.durToHuman(p.duration_sec);
    return "instant (fully vested)";
  }
  /* Vesting row -> deskTable shape (human balance + raw, policy words). Params: ui, doc, r (joined row). */
  function vestRow(ui, doc, r) {
    var a = (typeof r.prec === "number" && /^\d+$/.test(String(r.balance_raw)))
      ? Format.formatAmount(String(r.balance_raw), r.prec) + " " + r.sym
      : String(r.balance_raw) + " (" + r.asset_id + ")";
    var bH = r.policy.begin ? dateHuman(r.policy.begin) : null;
    var w = policyWords({ kind: r.policy.kind, beginHuman: bH, cliff_sec: r.policy.cliff_sec || 0, duration_sec: r.policy.duration_sec || 0 });
    return { r: r, words: w,
      cells: [{ text: r.id }, { text: r.owner }, { text: a, raw: r.balance_raw }, { text: w }],
      cardLines: [r.id + " · " + r.owner, a, w] };
  }
  /* Route entry: #/vesting — table + create + claim + op-37 claim + blind panel. */
  function renderVesting(root) {
    if (!root) return;
    var ui = entry(root);
    if (!ui) return;
    var ctx = ui.routeReady(root, "Vesting", function () { renderVesting(root); },
      ["Proposal", "ProposalMisc", "Tx", "Account", "Wallet", "Format", "Asset", "Chain", "Store"]);
    if (!ctx) return;
    var doc = ctx.doc, uiGen = ctx.myGen, myGen = ++gen;
    ctx.wrap.appendChild(ui.el(doc, "p", "Vesting locks funds under a release policy. Claim with op 33; genesis balances claim with op 37 (fee 0, owner-key signature — see below).", "muted"));
    var fA = ui.field(doc, "Account", { placeholder: "name or 1.2.N" });
    ctx.wrap.appendChild(fA.row);
    var go = ui.touchable(ui.el(doc, "button", "List vesting")); go.type = "button"; ctx.wrap.appendChild(go);
    var listBox = ui.el(doc, "div"); ctx.wrap.appendChild(listBox);
    ctx.wrap.appendChild(ui.el(doc, "h2", "Create vesting (op 32)"));
    var fC = ui.field(doc, "Creator", { placeholder: "name or 1.2.N" });
    var fO = ui.field(doc, "Owner", { placeholder: "name or 1.2.N" });
    var fS = ui.field(doc, "Asset", { placeholder: "symbol or 1.3.x", value: "BTS" });
    var fQ = ui.field(doc, "Amount", { placeholder: "1.5", inputmode: "decimal" });
    ctx.wrap.appendChild(fC.row); ctx.wrap.appendChild(fO.row); ctx.wrap.appendChild(fS.row); ctx.wrap.appendChild(fQ.row);
    var pol = doc.createElement("select"); ui.touchable(pol);
    [["instant", "instant (fully vested)"], ["cdd", "locked until claimed (cdd)"], ["linear", "linear release"]]
      .forEach(function (p) { var o = doc.createElement("option"); o.value = p[0]; o.textContent = p[1]; pol.appendChild(o); });
    ctx.wrap.appendChild(pol);
    var fD1 = ui.field(doc, "Begin / start-claim date", { type: "datetime-local" });
    var fD2 = ui.field(doc, "Cliff / vesting seconds", { placeholder: "seconds", inputmode: "numeric" });
    var fD3 = ui.field(doc, "Duration seconds (linear only)", { placeholder: "seconds", inputmode: "numeric" });
    ctx.wrap.appendChild(fD1.row); ctx.wrap.appendChild(fD2.row); ctx.wrap.appendChild(fD3.row);
    var cbox = ui.el(doc, "div"); ctx.wrap.appendChild(cbox);
    /* Current create-form inputs -> policy-words preview (reads the live policy select + date/seconds inputs). */
    function polWords() {
      var s2 = parseInt(fD2.input.value.trim() || "0", 10), s3 = parseInt((pol.value === "linear" ? fD3.input.value : fD2.input.value).trim() || "0", 10);
      return policyWords({ kind: pol.value, beginHuman: dateHuman(iso16(fD1.input.value) || null) || "none", cliff_sec: s2, duration_sec: s3 });
    }
    ui.reviewSection(doc, cbox, uiGen, "Review vesting", {
      build: async function () {
        var creator = await Account.resolve(fC.input.value.trim()), owner = await Account.resolve(fO.input.value.trim());
        var info = await Asset.describe(fS.input.value.trim() || "BTS");
        var raw = Format.parseAmount(fQ.input.value.trim(), info.precision);
        if (BigInt(raw) <= 0n) throw new Error("Vesting amount must be > 0.");
        var begin = iso16(fD1.input.value), policy;
        if (pol.value === "instant") policy = [2, {}];
        else if (pol.value === "cdd") {
          if (!begin) throw new Error("Start-claim date is required for cdd.");
          policy = [1, { start_claim: begin, vesting_seconds: parseInt(fD2.input.value.trim() || "0", 10) }];
        } else {
          if (!begin) throw new Error("Begin date is required for linear.");
          policy = [0, { begin_timestamp: begin, vesting_cliff_seconds: parseInt(fD2.input.value.trim() || "0", 10),
            vesting_duration_seconds: parseInt(fD3.input.value.trim() || "0", 10) }];
        }
        var before = (await ProposalMisc.vestings(owner.name || owner.id)).length;
        var pair = ProposalMisc.buildVestingCreate({ creatorId: creator.id, ownerId: owner.id, amountRaw: raw, assetId: info.id, policy: policy });
        await Proposal.fee(pair, "1.3.0");
        return { pair: pair, fee: pair[1].fee, words: polWords(), human: Format.formatAmount(raw, info.precision) + " " + info.symbol,
          prove: async function () {
            var now = await ProposalMisc.vestings(owner.name || owner.id);
            return now.length > before ? now[now.length - 1] : null;
          } };
      },
      title: "Confirm vesting create (op 32)",
      rows: function (built, f) {
        return [["Creator", built.pair[1].creator], ["Owner", built.pair[1].owner],
          ["Amount", built.human, built.pair[1].amount.amount], ["Policy", built.words], ["Fee (live)", f]];
      },
      ok: function () { return "Vesting created and re-read on chain."; },
      fail: "Could not build vesting (check accounts, asset, amount and dates)." });
    /* Per-row Claim button + amount/review box (over-claims blocked client-side; chain re-enforces). Params: t (vestRow shape). */
    function claimBox(t) {
      var b = ui.touchable(ui.el(doc, "button", "Claim " + t.r.id)); b.type = "button"; listBox.appendChild(b);
      var o2 = ui.el(doc, "div", null, "xfer-out"); listBox.appendChild(o2);
      b.addEventListener("click", function () {
        if (!live(myGen, uiGen)) return;
        ui.clearBox(o2);
        var fM = ui.field(doc, "Amount (at most the balance)", { value: t.r.balance_raw, inputmode: "decimal" });
        o2.appendChild(fM.row);
        o2.appendChild(ui.el(doc, "p", "Balance: " + t.cells[2].text + ". Over-claims fail on chain, so this form blocks them.", "muted"));
        var ibox = ui.el(doc, "div"); o2.appendChild(ibox);
        ui.reviewSection(doc, ibox, uiGen, "Review claim", {
          build: async function () {
            var info = await Asset.describe(t.r.asset_id);
            var raw = (fM.input.value.trim() === t.r.balance_raw) ? fM.input.value.trim()
              : Format.parseAmount(fM.input.value.trim(), info.precision);
            if (BigInt(raw) <= 0n) throw new Error("Claim amount must be > 0.");
            if (BigInt(raw) > BigInt(t.r.balance_raw)) throw new Error("Claim exceeds the balance — lower the amount.");
            var pair = ProposalMisc.buildVestingWithdraw({ ownerId: t.r.owner, vestingId: t.r.id, amountRaw: raw, assetId: t.r.asset_id });
            await Proposal.fee(pair, "1.3.0");
            return { pair: pair, fee: pair[1].fee, human: Format.formatAmount(raw, info.precision) + " " + info.symbol,
              prove: async function () {
                var rows = await ProposalMisc.vestings(t.r.owner);
                for (var i = 0; i < rows.length; i++) if (rows[i].id === t.r.id) return rows[i].balance_raw !== t.r.balance_raw ? rows[i] : null;
                return { gone: true };
              } };
          },
          title: "Confirm vesting withdraw (op 33)",
          rows: function (built, f) {
            return [["Vesting balance", t.r.id], ["Owner", t.r.owner], ["Amount", built.human], ["Fee (live)", f]];
          },
          ok: function () { return "Vesting withdrawn and re-read on chain."; } });
      });
    }
    go.addEventListener("click", function () {
      if (!live(myGen, uiGen)) return; go.disabled = true; ui.clearBox(listBox);
      ui.showStatus(doc, listBox, "Loading vesting balances…");
      ProposalMisc.vestings(fA.input.value.trim() || "").then(function (rows) {
        if (!live(myGen, uiGen)) return; ui.clearBox(listBox);
        if (!rows.length) {
          listBox.appendChild(ui.el(doc, "p", "No vesting balances for this account.", "muted"));
          try { ProposalMisc.requireClaimable(rows); } catch (e) { ui.showError(doc, listBox, e); }
          go.disabled = false; return;
        }
        var mapped = rows.map(function (r) { return vestRow(ui, doc, r); });
        listBox.appendChild(ui.deskTable(doc, ["ID", "Owner", "Balance", "Policy"], mapped));
        mapped.forEach(claimBox); go.disabled = false;
      }).catch(function (e) { if (!live(myGen, uiGen)) return; ui.clearBox(listBox); ui.showError(doc, listBox, e, "Could not load vesting."); go.disabled = false; });
    });
    ctx.wrap.appendChild(ui.el(doc, "h2", "Balance claim (op 37)"));
    ctx.wrap.appendChild(ui.el(doc, "p", "Genesis balances claim by explicit 1.15.x id with the balance-owner-key signature (not account auth) and fee 0.", "muted"));
    var fDep = ui.field(doc, "Deposit to account", { placeholder: "name or 1.2.N" });
    var fBal = ui.field(doc, "Balance id", { placeholder: "1.15.N" });
    var fKey = ui.field(doc, "Balance owner public key", { placeholder: "BTS…" });
    var fBA = ui.field(doc, "Asset", { placeholder: "symbol or 1.3.x", value: "BTS" });
    var fBQ = ui.field(doc, "Total to claim", { placeholder: "1.5", inputmode: "decimal" });
    ctx.wrap.appendChild(fDep.row); ctx.wrap.appendChild(fBal.row); ctx.wrap.appendChild(fKey.row);
    ctx.wrap.appendChild(fBA.row); ctx.wrap.appendChild(fBQ.row);
    var clbox = ui.el(doc, "div"); ctx.wrap.appendChild(clbox);
    ui.reviewSection(doc, clbox, uiGen, "Review claim", {
      build: async function () {
        var dep = await Account.resolve(fDep.input.value.trim());
        var info = await Asset.describe(fBA.input.value.trim() || "BTS");
        var raw = Format.parseAmount(fBQ.input.value.trim(), info.precision);
        if (BigInt(raw) <= 0n) throw new Error("Claim amount must be > 0.");
        var pair = ProposalMisc.buildBalanceClaim({ depositId: dep.id, balanceId: fBal.input.value.trim(),
          ownerKey: fKey.input.value.trim(), amountRaw: raw, assetId: info.id });
        return { pair: pair, fee: pair[1].fee, human: Format.formatAmount(raw, info.precision) + " " + info.symbol,
          prove: async function () {
            var rows = await Chain.call(await Chain.db(), "get_objects", [[fBal.input.value.trim()]]);
            return (!rows || !rows[0]) ? { gone: true } : null;
          } };
      },
      title: "Confirm balance claim (op 37)",
      rows: function (built, f) {
        var k = String(built.pair[1].balance_owner_key);
        return [["Deposit to", built.pair[1].deposit_to_account], ["Balance", built.pair[1].balance_to_claim],
          ["Owner key", k.length > 18 ? k.slice(0, 12) + "…" + k.slice(-6) : k],
          ["Total", built.human, built.pair[1].total_claimed.amount], ["Fee", "0 (balance claims are always free)"]];
      },
      ok: function () { return "Balance claimed (re-read confirms the object is gone)."; } });
    ctx.wrap.appendChild(ui.el(doc, "h2", "Blinded balances (read-only)"));
    ctx.wrap.appendChild(ui.el(doc, "p", "Blind transfers (ops 39/40/41) are disabled: they need vendored Pedersen-commitment and range-proof crypto that no static page ships. Commitment lookup below proves the read path only.", "muted"));
    var fBlind = ui.field(doc, "Commitment (33-byte hex)", { placeholder: "02…" });
    ctx.wrap.appendChild(fBlind.row);
    var bl = ui.touchable(ui.el(doc, "button", "Look up commitment")); bl.type = "button"; ctx.wrap.appendChild(bl);
    var blo = ui.el(doc, "div"); ctx.wrap.appendChild(blo);
    ["Transfer to blind (op 39)", "Blind transfer (op 40)", "Transfer from blind (op 41)"].forEach(function (label) {
      var d = ui.touchable(ui.el(doc, "button", label)); d.type = "button"; d.disabled = true;
      d.title = "Disabled: blind transfers need vendored commitment/range-proof crypto.";
      d.addEventListener("click", function () { try { Proposal.blindSend(); } catch (e) { ui.showError(doc, blo, e); } });
      ctx.wrap.appendChild(d);
    });
    bl.addEventListener("click", function () {
      if (!live(myGen, uiGen)) return; bl.disabled = true; ui.clearBox(blo);
      ui.showStatus(doc, blo, "Looking up…");
      Proposal.blindedLookup([fBlind.input.value.trim()]).then(function (rows) {
        if (!live(myGen, uiGen)) return; ui.clearBox(blo);
        blo.appendChild(ui.el(doc, "p", rows.length ? rows.length + " blinded object(s) found (amounts stay hidden by design)." : "No blinded object for this commitment.", "muted"));
        bl.disabled = false;
      }).catch(function (e) { if (!live(myGen, uiGen)) return; ui.clearBox(blo); ui.showError(doc, blo, e, "Lookup failed."); bl.disabled = false; });
    });
  }

  return { renderVesting: renderVesting };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.VestingUI === "undefined") { globalThis.VestingUI = VestingUI; }
if (typeof module !== "undefined") { module.exports = VestingUI; }
