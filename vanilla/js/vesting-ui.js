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
 * PUNCHLIST 2026-09-29 (#/vesting HIGH — progress columns + available hint):
 *   the table now carries Required / Earned / Remaining (integer days) +
 *   Available (claimable-now %) per policy, computed read-only by
 *   progressOf() below (BigInt/integer math only — concepts from #1
 *   AccountVesting.jsx:71-230, units documented per branch), and the
 *   per-row claim form defaults to the available amount instead of the
 *   full balance. The raw policy legs (coin_seconds_earned,
 *   begin_balance, ...) are re-read here via get_vesting_balances because
 *   ProposalMisc.vestings drops them to kind+words (duplicated plain read,
 *   doctrine rule 5); a failed raw read still renders dashed progress,
 *   never a throw. New column labels are plain literals (no new t() keys —
 *   locale dicts are outside this punchlist's file scope; check_i18n stays
 *   green, a later i18n batch should key them).
 * DEFERRED (punchlist 2026-09-29, low — recorded, not built): list
 *   search/filter input over the vesting rows (ref AccountVesting.jsx:10
 *   SearchInput).
 * NOTE: iso16/dateHuman duplicate the tiny copies in misc-ui.js on purpose
 *   (the authorities view still needs them there) — doctrine rule 5 prefers
 *   duplicated plain code over a shared helper with cross-file coupling.
 */
var VestingUI = (function () {
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
  /* Shared-_ui accessor: ProposalUI._ui (proposal-ui.js loads first); throws proposal-ui-missing otherwise. */
  function U() {
    if (typeof ProposalUI === "undefined" || !ProposalUI._ui) throw new Error(t("vesting.proposal_ui_missing_proposal_ui_js_first", "proposal-ui-missing (proposal-ui.js first)"));
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
      w0.appendChild(d0.createTextNode(t("vesting.vesting_backend_missing_proposal_ui_js_failed", "Vesting backend missing: proposal-ui.js failed to load.")));
      return null;
    }
  }
  function iso16(v) { v = String(v || "").trim(); return v.length === 16 ? v + ":00" : v; }
  function dateHuman(iso) {
    if (!iso) return t("vesting.none", "none");
    var ts = Date.parse(/Z$/.test(iso) ? iso : iso + "Z");
    return isNaN(ts) ? String(iso) : new Date(ts).toLocaleString();
  }
  var DAY_SEC = 86400n; /* Integer day for progress math (wall-clock only — money stays raw elsewhere). */
  /* BigInt helpers for read-only progress math (principle #6: no Number()/
   * parseFloat on chain integers; Date.parse/now feed wall-clock only).
   * digits: digit-string -> BigInt or null. u32int: chain u32 (number or
   * digit string) -> BigInt or null. isoSec: ISO datetime -> BigInt epoch
   * seconds or null (unparseable dates never throw). */
  function digits(s) { var v = String(s === undefined || s === null ? "" : s); return /^\d+$/.test(v) ? BigInt(v) : null; }
  function u32int(v) {
    if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 0xFFFFFFFF) return BigInt(v);
    if (typeof v === "string" && /^\d+$/.test(v)) { try { var b = BigInt(v); if (b <= 0xFFFFFFFFn) return b; } catch (e) { /* null below */ } }
    return null;
  }
  function isoSec(iso) {
    if (!iso) return null;
    var s = String(iso), ms = Date.parse(/Z$/.test(s) ? s : s + "Z");
    return isNaN(ms) ? null : BigInt(Math.floor(ms / 1000));
  }
  function nowSec() { return BigInt(Math.floor(Date.now() / 1000)); }
  /* BigInt ratio -> basis points 0..10000 (null when the denominator is
   * missing/zero — the caller dashes). Caps above 100% at 100%. */
  function ratioBp(num, den) {
    if (num === null || den === null || den <= 0n) return null;
    var bp = (num * 10000n) / den;
    return bp > 10000n ? 10000n : bp;
  }
  /* Basis points -> "12.34%" via integer math (null -> "—", never blank). */
  function fmtBp(bp) {
    if (bp === null || bp === undefined) return "—";
    return (bp / 100n).toString() + "." + (bp % 100n).toString().padStart(2, "0") + "%";
  }
  function dash(v) { return (v === null || v === undefined) ? "—" : String(v); }
  /* Raw vesting_balance object -> {req, earn, rem, availBp}. req/earn/rem
   * are integer-DAY strings (null renders as "—"); availBp is basis points
   * 0..10000 (null -> "—"). Read-only: malformed chain data yields
   * all-dash + null avail, never a throw (the row still renders).
   * Concepts from #1 AccountVesting.jsx:71-230 only — the units below are
   * deliberate integer-day simplifications, documented per branch:
   * - instant (type 2): fully vested -> 100%, no day columns.
   * - linear (type 0): remaining = floor(max(period-earned,0)/86400);
   *   required/earned stay dash (the reference shows remaining only);
   *   available = max(vested-claimed,0) in bp, claimed from begin_balance
   *   when present (missing begin_balance -> claimed 0, never a throw).
   * - cdd with start_claim (type 1, dated): plain days required/earned and
   *   remaining = max(required-earned,0) (keeps the displayed invariant
   *   required = earned + remaining); available is binary (matured? 100:0).
   * - cdd coin-days (type 1, no start): required/earned/remaining are
   *   asset-adjusted coin-days (the reference get_asset_amount concept:
   *   coin-seconds / 86400 / 10^prec) as integer days, same invariant;
   *   available = earned/required capped at 100% — unitless, so it needs
   *   no precision and still renders when prec is unknown.
   * Params: vb raw get_vesting_balances object (policy in [t,d] ARRAY
   *   form), balRaw digit string, prec number-or-null. */
  function progressOf(vb, balRaw, prec) {
    function unknown() { return { req: null, earn: null, rem: null, availBp: null }; }
    if (!vb || !Array.isArray(vb.policy)) return unknown();
    var type = vb.policy[0], d = vb.policy[1] || {};
    if (type === 2) return { req: null, earn: null, rem: null, availBp: 10000n };
    var now = nowSec();
    if (type === 0) {
      var start = isoSec(d.begin_timestamp), period = u32int(d.vesting_duration_seconds), cliff = u32int(d.vesting_cliff_seconds);
      if (start === null || period === null || cliff === null) return unknown();
      var earned = now > start ? now - start : 0n;
      var remDays = (period > earned ? period - earned : 0n) / DAY_SEC;
      var vested = earned >= period ? 10000n : (earned < cliff || period === 0n ? 0n : (earned * 10000n) / period);
      var beginBal = digits(d.begin_balance), bal = digits(balRaw);
      var claimed = (beginBal !== null && beginBal > 0n && bal !== null)
        ? ((beginBal > bal ? beginBal - bal : 0n) * 10000n) / beginBal : 0n;
      return { req: null, earn: null, rem: String(remDays), availBp: vested > claimed ? vested - claimed : 0n };
    }
    if (type === 1) {
      var vestSec = u32int(d.vesting_seconds);
      if (vestSec === null) return unknown();
      var startClaim = isoSec(d.start_claim);
      if (startClaim !== null && startClaim > 0n) {
        var e2 = now > startClaim ? now - startClaim : 0n;
        var req = vestSec / DAY_SEC, ern = e2 / DAY_SEC;
        var mature = e2 >= vestSec;
        return { req: String(req), earn: String(ern),
          rem: String(mature ? 0n : (req > ern ? req - ern : 0n)), availBp: mature ? 10000n : 0n };
      }
      var last = isoSec(d.coin_seconds_earned_last_update), cse = digits(d.coin_seconds_earned), bal2 = digits(balRaw);
      if (last === null || cse === null || bal2 === null) return unknown();
      var earnedCS = cse + bal2 * (now > last ? now - last : 0n);
      var denom = vestSec * bal2;
      if (denom <= 0n) return { req: "0", earn: "0", rem: "0", availBp: 10000n };
      var bp = ratioBp(earnedCS, denom);
      if (typeof prec !== "number" || prec < 0) return { req: null, earn: null, rem: null, availBp: bp };
      var scale = 1n;
      for (var i = 0; i < prec; i++) scale *= 10n;
      var unit = DAY_SEC * scale;
      var reqD = denom / unit, earnD = earnedCS / unit;
      return { req: String(reqD), earn: String(earnD),
        rem: String(reqD > earnD ? reqD - earnD : 0n), availBp: bp };
    }
    return unknown();
  }
  /* Vesting policy -> human WORDS (amounts stay out — caller joins). */
  function policyWords(p) {
    if (p.kind === "linear") return "linear · begin " + p.beginHuman + " · cliff " +
      Proposal.durToHuman(p.cliff_sec) + " · duration " + Proposal.durToHuman(p.duration_sec);
    if (p.kind === "cdd") return "locked until claimed · start " + p.beginHuman + " · vests over " + Proposal.durToHuman(p.duration_sec);
    return t("vesting.instant_fully_vested", "instant (fully vested)");
  }
  /* Vesting row -> deskTable shape (human balance + raw, policy words,
   * progress columns). Params: ui, doc, r (joined row with .prog from
   * progressOf — missing prog degrades to dashes, never a throw). */
  function vestRow(ui, doc, r) {
    var a = (typeof r.prec === "number" && /^\d+$/.test(String(r.balance_raw)))
      ? Format.formatAmount(String(r.balance_raw), r.prec) + " " + r.sym
      : String(r.balance_raw) + " (" + r.asset_id + ")";
    var bH = r.policy.begin ? dateHuman(r.policy.begin) : null;
    var w = policyWords({ kind: r.policy.kind, beginHuman: bH, cliff_sec: r.policy.cliff_sec || 0, duration_sec: r.policy.duration_sec || 0 });
    var p = r.prog || { req: null, earn: null, rem: null, availBp: null };
    var reqT = dash(p.req), earnT = dash(p.earn), remT = dash(p.rem), avT = fmtBp(p.availBp);
    return { r: r, words: w,
      cells: [{ text: r.id }, { text: r.owner }, { text: a, raw: r.balance_raw }, { text: w },
        { text: reqT }, { text: earnT }, { text: remT }, { text: avT }],
      cardLines: [r.id + " · " + r.owner, a, w,
        "Required " + reqT + " · Earned " + earnT + " · Remaining " + remT + " · Available " + avT] };
  }
  /* Route entry: #/vesting — table + create + claim + op-37 claim + blind panel. */
  function renderVesting(root) {
    if (!root) return;
    var ui = entry(root);
    if (!ui) return;
    var ctx = ui.routeReady(root, t("vesting.vesting", "Vesting"), function () { renderVesting(root); },
      ["Proposal", "ProposalMisc", "Tx", "Account", "Wallet", "Format", "Asset", "Chain", "Store"]);
    if (!ctx) return;
    var doc = ctx.doc, uiGen = ctx.myGen, myGen = ++gen;
    ctx.wrap.appendChild(ui.el(doc, "p", t("vesting.vesting_locks_funds_under_a_release_policy_cl", "Vesting locks funds under a release policy. Claim with op 33; genesis balances claim with op 37 (fee 0, owner-key signature — see below)."), "muted"));
    try {
      if (typeof Wallet === "undefined" || !Wallet.isUnlocked())
        ctx.wrap.appendChild(ui.el(doc, "p", t("vesting.viewing_as", "Viewing as committee-account (1.2.0) — unlock to act as yourself."), "muted"));
    } catch (e) { /* notice is display-only */ }
    var fA = ui.field(doc, t("vesting.account", "Account"), { placeholder: t("vesting.name_or_1_2_n", "name or 1.2.N"), value: "1.2.0" });
    ctx.wrap.appendChild(fA.row);
    var go = ui.touchable(ui.el(doc, "button", t("vesting.list_vesting", "List vesting"))); go.type = "button"; ctx.wrap.appendChild(go);
    var listBox = ui.el(doc, "div"); ctx.wrap.appendChild(listBox);
    ctx.wrap.appendChild(ui.el(doc, "h2", t("vesting.create_vesting_op_32", "Create vesting (op 32)")));
    var fC = ui.field(doc, t("vesting.creator", "Creator"), { placeholder: t("vesting.name_or_1_2_n", "name or 1.2.N"), value: "1.2.0" });
    var fO = ui.field(doc, t("vesting.owner", "Owner"), { placeholder: t("vesting.name_or_1_2_n", "name or 1.2.N"), value: "1.2.0" });
    var fS = ui.field(doc, t("vesting.asset", "Asset"), { placeholder: t("vesting.symbol_or_1_3_x", "symbol or 1.3.x"), value: "BTS" });
    var fQ = ui.field(doc, t("vesting.amount", "Amount"), { placeholder: "1.5", inputmode: "decimal" });
    ctx.wrap.appendChild(fC.row); ctx.wrap.appendChild(fO.row); ctx.wrap.appendChild(fS.row); ctx.wrap.appendChild(fQ.row);
    var pol = doc.createElement("select"); ui.touchable(pol);
    [["instant", t("vesting.instant_fully_vested", "instant (fully vested)")], ["cdd", t("vesting.locked_until_claimed_cdd", "locked until claimed (cdd)")], ["linear", t("vesting.linear_release", "linear release")]]
      .forEach(function (p) { var o = doc.createElement("option"); o.value = p[0]; o.textContent = p[1]; pol.appendChild(o); });
    ctx.wrap.appendChild(pol);
    var fD1 = ui.field(doc, t("vesting.begin_start_claim_date", "Begin / start-claim date"), { type: "datetime-local" });
    var fD2 = ui.field(doc, t("vesting.cliff_vesting_seconds", "Cliff / vesting seconds"), { placeholder: t("vesting.seconds", "seconds"), inputmode: "numeric" });
    var fD3 = ui.field(doc, t("vesting.duration_seconds_linear_only", "Duration seconds (linear only)"), { placeholder: t("vesting.seconds", "seconds"), inputmode: "numeric" });
    ctx.wrap.appendChild(fD1.row); ctx.wrap.appendChild(fD2.row); ctx.wrap.appendChild(fD3.row);
    var cbox = ui.el(doc, "div"); ctx.wrap.appendChild(cbox);
    /* Current create-form inputs -> policy-words preview (reads the live policy select + date/seconds inputs). */
    function polWords() {
      var s2 = parseInt(fD2.input.value.trim() || "0", 10), s3 = parseInt((pol.value === "linear" ? fD3.input.value : fD2.input.value).trim() || "0", 10);
      return policyWords({ kind: pol.value, beginHuman: dateHuman(iso16(fD1.input.value) || null) || t("vesting.none", "none"), cliff_sec: s2, duration_sec: s3 });
    }
    ui.reviewSection(doc, cbox, uiGen, t("vesting.review_vesting", "Review vesting"), {
      build: async function () {
        var creator = await Account.resolve(fC.input.value.trim() || "1.2.0"), owner = await Account.resolve(fO.input.value.trim() || "1.2.0");
        var info = await Asset.describe(fS.input.value.trim() || "BTS");
        var raw = Format.parseAmount(fQ.input.value.trim(), info.precision);
        if (BigInt(raw) <= 0n) throw new Error(t("vesting.vesting_amount_must_be_0", "Vesting amount must be > 0."));
        var begin = iso16(fD1.input.value), policy;
        if (pol.value === "instant") policy = [2, {}];
        else if (pol.value === "cdd") {
          if (!begin) throw new Error(t("vesting.start_claim_date_is_required_for_cdd", "Start-claim date is required for cdd."));
          policy = [1, { start_claim: begin, vesting_seconds: parseInt(fD2.input.value.trim() || "0", 10) }];
        } else {
          if (!begin) throw new Error(t("vesting.begin_date_is_required_for_linear", "Begin date is required for linear."));
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
      title: t("vesting.confirm_vesting_create_op_32", "Confirm vesting create (op 32)"),
      rows: function (built, f) {
        return [[t("vesting.creator", "Creator"), built.pair[1].creator], [t("vesting.owner", "Owner"), built.pair[1].owner],
          [t("vesting.amount", "Amount"), built.human, built.pair[1].amount.amount], [t("vesting.policy", "Policy"), built.words], [t("vesting.fee_live", "Fee (live)"), f]];
      },
      ok: function () { return t("vesting.vesting_created_and_re_read_on_chain", "Vesting created and re-read on chain."); },
      fail: t("vesting.could_not_build_vesting_check_accounts_asset", "Could not build vesting (check accounts, asset, amount and dates).") });
    /* Per-row Claim button + amount/review box (over-claims blocked client-side; chain re-enforces). Params: t (vestRow shape). */
    function claimBox(vr) {
      var b = ui.touchable(ui.el(doc, "button", "Claim " + vr.r.id)); b.type = "button"; listBox.appendChild(b);
      var o2 = ui.el(doc, "div", null, "xfer-out"); listBox.appendChild(o2);
      b.addEventListener("click", function () {
        if (!live(myGen, uiGen)) return;
        ui.clearBox(o2);
        /* Default to the claimable-now hint (was: full raw balance).
         * availRaw floors via BigInt; the human default round-trips
         * through parseAmount exactly (raw integer units both ways). */
        var availRaw = vr.r.balance_raw, availTxt = vr.cells[2].text;
        try {
          var bp = vr.r.prog && vr.r.prog.availBp;
          if (bp !== null && bp !== undefined && /^\d+$/.test(String(vr.r.balance_raw))) {
            availRaw = String((BigInt(String(vr.r.balance_raw)) * BigInt(bp)) / 10000n);
            availTxt = (typeof vr.r.prec === "number")
              ? Format.formatAmount(availRaw, vr.r.prec) + " " + vr.r.sym
              : availRaw + " (" + vr.r.asset_id + ")";
          }
        } catch (e) { availRaw = vr.r.balance_raw; availTxt = vr.cells[2].text; }
        var defVal = availRaw;
        try { if (typeof vr.r.prec === "number") defVal = Format.formatAmount(availRaw, vr.r.prec); } catch (e) { defVal = availRaw; }
        var fM = ui.field(doc, t("vesting.amount_at_most_the_balance", "Amount (at most the balance)"), { value: defVal, inputmode: "decimal" });
        o2.appendChild(fM.row);
        o2.appendChild(ui.el(doc, "p", t("vesting.balance_2", "Balance: ") + vr.cells[2].text + " · " + availTxt +
          " claimable now (" + fmtBp(vr.r.prog && vr.r.prog.availBp) + "). Over-claims fail on chain, so this form blocks them.", "muted"));
        var ibox = ui.el(doc, "div"); o2.appendChild(ibox);
        ui.reviewSection(doc, ibox, uiGen, t("vesting.review_claim", "Review claim"), {
          build: async function () {
            var info = await Asset.describe(vr.r.asset_id);
            var raw = (fM.input.value.trim() === vr.r.balance_raw) ? fM.input.value.trim()
              : Format.parseAmount(fM.input.value.trim(), info.precision);
            if (BigInt(raw) <= 0n) throw new Error(t("vesting.claim_amount_must_be_0", "Claim amount must be > 0."));
            if (BigInt(raw) > BigInt(vr.r.balance_raw)) throw new Error(t("vesting.claim_exceeds_the_balance_lower_the_amount", "Claim exceeds the balance — lower the amount."));
            var pair = ProposalMisc.buildVestingWithdraw({ ownerId: vr.r.owner, vestingId: vr.r.id, amountRaw: raw, assetId: vr.r.asset_id });
            await Proposal.fee(pair, "1.3.0");
            return { pair: pair, fee: pair[1].fee, human: Format.formatAmount(raw, info.precision) + " " + info.symbol,
              prove: async function () {
                var rows = await ProposalMisc.vestings(vr.r.owner);
                for (var i = 0; i < rows.length; i++) if (rows[i].id === vr.r.id) return rows[i].balance_raw !== vr.r.balance_raw ? rows[i] : null;
                return { gone: true };
              } };
          },
          title: t("vesting.confirm_vesting_withdraw_op_33", "Confirm vesting withdraw (op 33)"),
          rows: function (built, f) {
            return [[t("vesting.vesting_balance", "Vesting balance"), vr.r.id], [t("vesting.owner", "Owner"), vr.r.owner], [t("vesting.amount", "Amount"), built.human], [t("vesting.fee_live", "Fee (live)"), f]];
          },
          ok: function () { return t("vesting.vesting_withdrawn_and_re_read_on_chain", "Vesting withdrawn and re-read on chain."); } });
      });
    }
    go.addEventListener("click", function () {
      if (!live(myGen, uiGen)) return; go.disabled = true; ui.clearBox(listBox);
      ui.showStatus(doc, listBox, t("vesting.loading_vesting_balances", "Loading vesting balances…"));
      var acctName = fA.input.value.trim() || "1.2.0";
      ProposalMisc.vestings(acctName).then(function (rows) {
        if (!live(myGen, uiGen)) return;
        /* Raw re-read for the progress legs (coin_seconds_earned,
         * begin_balance, ...): ProposalMisc.vestings drops them to
         * kind+words, so the same get_vesting_balances method is read
         * again here (duplicated plain read, doctrine rule 5).
         * Best-effort: a failed raw read still renders the table with
         * dashed progress, never a throw. */
        var rawP = (async function () {
          try {
            var db = await Chain.db();
            var raw = await Chain.call(db, "get_vesting_balances", [acctName]);
            var byId = {};
            (raw || []).forEach(function (v) { if (v && v.id) byId[String(v.id)] = v; });
            return byId;
          } catch (e) { return {}; }
        })();
        rawP.then(function (byId) {
          if (!live(myGen, uiGen)) return; ui.clearBox(listBox);
          if (!rows.length) {
            listBox.appendChild(ui.el(doc, "p", t("vesting.no_vesting_balances_for_this_account", "No vesting balances for this account."), "muted"));
            try { ProposalMisc.requireClaimable(rows); } catch (e) { ui.showError(doc, listBox, e); }
            go.disabled = false; return;
          }
          rows.forEach(function (r) {
            r.prog = progressOf(byId[r.id], r.balance_raw, (typeof r.prec === "number" ? r.prec : null));
          });
          var mapped = rows.map(function (r) { return vestRow(ui, doc, r); });
          listBox.appendChild(ui.deskTable(doc, [t("vesting.id", "ID"), t("vesting.owner", "Owner"), t("vesting.balance", "Balance"), t("vesting.policy", "Policy"),
            "Required (days)", "Earned (days)", "Remaining (days)", "Available"], mapped));
          mapped.forEach(claimBox); go.disabled = false;
        });
      }).catch(function (e) { if (!live(myGen, uiGen)) return; ui.clearBox(listBox); ui.showError(doc, listBox, e, t("vesting.could_not_load_vesting", "Could not load vesting.")); go.disabled = false; });
    });
    ctx.wrap.appendChild(ui.el(doc, "h2", t("vesting.balance_claim_op_37", "Balance claim (op 37)")));
    ctx.wrap.appendChild(ui.el(doc, "p", t("vesting.genesis_balances_claim_by_explicit_1_15_x_id", "Genesis balances claim by explicit 1.15.x id with the balance-owner-key signature (not account auth) and fee 0."), "muted"));
    var fDep = ui.field(doc, t("vesting.deposit_to_account", "Deposit to account"), { placeholder: t("vesting.name_or_1_2_n", "name or 1.2.N"), value: "1.2.0" });
    var fBal = ui.field(doc, t("vesting.balance_id", "Balance id"), { placeholder: "1.15.N" });
    var fKey = ui.field(doc, t("vesting.balance_owner_public_key", "Balance owner public key"), { placeholder: "BTS…" });
    var fBA = ui.field(doc, t("vesting.asset", "Asset"), { placeholder: t("vesting.symbol_or_1_3_x", "symbol or 1.3.x"), value: "BTS" });
    var fBQ = ui.field(doc, t("vesting.total_to_claim", "Total to claim"), { placeholder: "1.5", inputmode: "decimal" });
    ctx.wrap.appendChild(fDep.row); ctx.wrap.appendChild(fBal.row); ctx.wrap.appendChild(fKey.row);
    ctx.wrap.appendChild(fBA.row); ctx.wrap.appendChild(fBQ.row);
    var clbox = ui.el(doc, "div"); ctx.wrap.appendChild(clbox);
    ui.reviewSection(doc, clbox, uiGen, t("vesting.review_claim", "Review claim"), {
      build: async function () {
        var dep = await Account.resolve(fDep.input.value.trim() || "1.2.0");
        var info = await Asset.describe(fBA.input.value.trim() || "BTS");
        var raw = Format.parseAmount(fBQ.input.value.trim(), info.precision);
        if (BigInt(raw) <= 0n) throw new Error(t("vesting.claim_amount_must_be_0", "Claim amount must be > 0."));
        var pair = ProposalMisc.buildBalanceClaim({ depositId: dep.id, balanceId: fBal.input.value.trim(),
          ownerKey: fKey.input.value.trim(), amountRaw: raw, assetId: info.id });
        return { pair: pair, fee: pair[1].fee, human: Format.formatAmount(raw, info.precision) + " " + info.symbol,
          prove: async function () {
            var rows = await Chain.call(await Chain.db(), "get_objects", [[fBal.input.value.trim()]]);
            return (!rows || !rows[0]) ? { gone: true } : null;
          } };
      },
      title: t("vesting.confirm_balance_claim_op_37", "Confirm balance claim (op 37)"),
      rows: function (built, f) {
        var k = String(built.pair[1].balance_owner_key);
        return [[t("vesting.deposit_to", "Deposit to"), built.pair[1].deposit_to_account], [t("vesting.balance", "Balance"), built.pair[1].balance_to_claim],
          [t("vesting.owner_key", "Owner key"), k.length > 18 ? k.slice(0, 12) + "…" + k.slice(-6) : k],
          [t("vesting.total", "Total"), built.human, built.pair[1].total_claimed.amount], [t("vesting.fee", "Fee"), t("vesting.0_balance_claims_are_always_free", "0 (balance claims are always free)")]];
      },
      ok: function () { return t("vesting.balance_claimed_re_read_confirms_the_object_i", "Balance claimed (re-read confirms the object is gone)."); } });
    ctx.wrap.appendChild(ui.el(doc, "h2", t("vesting.blinded_balances_read_only", "Blinded balances (read-only)")));
    ctx.wrap.appendChild(ui.el(doc, "p", t("vesting.blind_transfers_ops_39_40_41_are_disabled_the", "Blind transfers (ops 39/40/41) are disabled: they need vendored Pedersen-commitment and range-proof crypto that no static page ships. Commitment lookup below proves the read path only."), "muted"));
    var fBlind = ui.field(doc, t("vesting.commitment_33_byte_hex", "Commitment (33-byte hex)"), { placeholder: "02…" });
    ctx.wrap.appendChild(fBlind.row);
    var bl = ui.touchable(ui.el(doc, "button", t("vesting.look_up_commitment", "Look up commitment"))); bl.type = "button"; ctx.wrap.appendChild(bl);
    var blo = ui.el(doc, "div"); ctx.wrap.appendChild(blo);
    [t("vesting.blind_op39", "Transfer to blind (op 39)"), t("vesting.blind_op40", "Blind transfer (op 40)"), t("vesting.blind_op41", "Transfer from blind (op 41)")].forEach(function (label) {
      var d = ui.touchable(ui.el(doc, "button", label)); d.type = "button"; d.disabled = true;
      d.title = t("vesting.disabled_blind_transfers_need_vendored_commit", "Disabled: blind transfers need vendored commitment/range-proof crypto.");
      d.addEventListener("click", function () { try { Proposal.blindSend(); } catch (e) { ui.showError(doc, blo, e); } });
      ctx.wrap.appendChild(d);
    });
    bl.addEventListener("click", function () {
      if (!live(myGen, uiGen)) return; bl.disabled = true; ui.clearBox(blo);
      ui.showStatus(doc, blo, t("vesting.looking_up", "Looking up…"));
      Proposal.blindedLookup([fBlind.input.value.trim()]).then(function (rows) {
        if (!live(myGen, uiGen)) return; ui.clearBox(blo);
        blo.appendChild(ui.el(doc, "p", rows.length ? rows.length + " blinded object(s) found (amounts stay hidden by design)." : "No blinded object for this commitment.", "muted"));
        bl.disabled = false;
      }).catch(function (e) { if (!live(myGen, uiGen)) return; ui.clearBox(blo); ui.showError(doc, blo, e, t("vesting.lookup_failed", "Lookup failed.")); bl.disabled = false; });
    });
  }

  return { renderVesting: renderVesting,
    /* Headless-test seam: read-only progress math (VoteUI._test precedent —
     * same reason: pure integer functions worth vector-testing). */
    _test: { progressOf: progressOf, fmtBp: fmtBp, ratioBp: ratioBp } };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.VestingUI === "undefined") { globalThis.VestingUI = VestingUI; }
if (typeof module !== "undefined") { module.exports = VestingUI; }
