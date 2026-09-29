/* fees-ui.js — standalone network fee-schedule page (matrix C31).
 * Owns: #/fees (read-only grouped table of every op fee, live from the
 *   chain via Asset.feeSchedule — this page's OWN renderer, not
 *   AssetFeedUI.feeSection, so the page carries a single heading plus the
 *   full fee concept set: five groups, named ops, per-fee-type rows,
 *   schedule scale, and the lifetime-member column).
 * Consumes: Asset.feeSchedule (sole chain reader — groups, scale,
 *   network_percent_of_fee, per-op raw/scaled maps), Format (human strings;
 *   raw ints in title attributes), Chain (connect gate), Store (reconnect
 *   subscribe). No wallet, no signing, no broadcasts.
 * Globals/side effects: DOM under root only; global FeesUI. Gen counter
 *   tears down stale reconnect work.
 * Refs (CONCEPTS only, no code): #1 Blockchain/Fees.jsx:18-42 (the five
 *   groups), :45 (ltm_required registrar-paid ops), :70-71 (network_fee =
 *   network_percent_of_fee/1e4, scale = current_fees.scale), :76-94 (op
 *   names + the op-10 half-registrar LTM rule), :105-201 (per-key rows with
 *   fee*scale/1e4, LTM column, dash treatment); #2 NetworkFees.jsx
 *   (extras-beneath-the-op layout idea, fee-type wording); #4
 *   fee_schedule.hpp:221 (fee*scale/GRAPHENE_100_PERCENT) and
 *   chain_parameters.hpp:67 (network_percent_of_fee), op order via Asset
 *   (operations.hpp:56-133).
 * i18n NOTE: pre-existing t() keys are reused byte-verbatim (check_i18n
 *   gate); genuinely new labels (group names, column headers, fee-type
 *   names, explainer notes) stay plain English until an i18n batch mints
 *   keys — adding t() keys here without touching all ten locale dicts
 *   would fail tooling/check_i18n.py.
 * Created by: deferred-matrix close-out (C30/C31/C34/C35 batch).
 * Repaired by: fees punchlist (groups, full op names, scale, LTM column,
 *   null-fee explanation, single heading).
 */
var FeesUI = (function () {
  "use strict";

  /* Batch-2e i18n (slice-17 precedent): display strings resolve via I18n.t with the
   * pre-conversion literal kept verbatim as enDefault (English-identical on any
   * transport, incl. file:// where dict fetch fails). Falls back to the default
   * when i18n.js failed to load: never blank, never throws. */
  function t(key, dflt) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt);
    } catch (e) { /* default below */ }
    return dflt;
  }
  var gen = 0;

  /* Group order + display names (plain English per header i18n NOTE; the
   * words follow #1 locale-en transaction.feeGroups). */
  var GROUP_ORDER = ["general", "asset", "market", "account", "business"];
  var GROUP_NAMES = { general: "General", asset: "Asset-Specific",
    market: "Market-Specific", account: "Account-Specific",
    business: "Business Administration" };
  /* Op index -> short snake name, FC_REFLECT order <- operations.hpp:56-133.
   * PROVENANCE: value-copy of the OP_NAMES table in vanilla/js/asset.js
   * (which copies vanilla/js/explorer.js:27-47). Copied, not imported: Asset
   * exposes names only for ops present in the live schedule, but the page
   * must also name schedule-missing ops honestly (never "op_45"). */
  var OP_NAMES = ["transfer", "limit_order_create", "limit_order_cancel", "call_order_update",
    "fill_order", "account_create", "account_update", "account_whitelist", "account_upgrade",
    "account_transfer", "asset_create", "asset_update", "asset_update_bitasset",
    "asset_update_feed_producers", "asset_issue", "asset_reserve", "asset_fund_fee_pool",
    "asset_settle", "asset_global_settle", "asset_publish_feed", "witness_create",
    "witness_update", "proposal_create", "proposal_update", "proposal_delete",
    "withdraw_permission_create", "withdraw_permission_update", "withdraw_permission_claim",
    "withdraw_permission_delete", "committee_member_create", "committee_member_update",
    "committee_member_update_global_parameters", "vesting_balance_create",
    "vesting_balance_withdraw", "worker_create", "custom", "assert", "balance_claim",
    "override_transfer", "transfer_to_blind", "blind_transfer", "transfer_from_blind",
    "asset_settle_cancel", "asset_claim_fees", "fba_distribute", "bid_collateral",
    "execute_bid", "asset_claim_pool", "asset_update_issuer", "htlc_create", "htlc_redeem",
    "htlc_redeemed", "htlc_extend", "htlc_refund", "custom_authority_create",
    "custom_authority_update", "custom_authority_delete", "ticket_create", "ticket_update",
    "liquidity_pool_create", "liquidity_pool_delete", "liquidity_pool_deposit",
    "liquidity_pool_withdraw", "liquidity_pool_exchange", "samet_fund_create",
    "samet_fund_delete", "samet_fund_update", "samet_fund_borrow", "samet_fund_repay",
    "credit_offer_create", "credit_offer_delete", "credit_offer_update",
    "credit_offer_accept", "credit_deal_repay", "credit_deal_expired",
    "liquidity_pool_update", "credit_deal_update", "limit_order_update"];
  /* Virtual execution events (never signed, marker only) — same set as
   * asset.js VIRTUAL <- operations.hpp "// VIRTUAL" marks. */
  var VIRTUAL = { 4: 1, 42: 1, 44: 1, 46: 1, 51: 1, 53: 1, 74: 1 };
  /* Canonical fee-param row order (schedule order would shuffle per node;
   * unknown future params append after these in chain order). Wording
   * follows #1 feeTypes en + #2 EXTRA_PARAM_LABELS (concepts, Table below). */
  var TYPE_ORDER = ["fee", "basic_fee", "premium_fee", "membership_lifetime_fee",
    "membership_annual_fee", "symbol3", "symbol4", "long_symbol", "price_per_kbyte",
    "price_per_byte", "price_per_output", "fee_per_day", "fee_per_kb"];
  var TYPE_LABELS = { fee: "Fee", basic_fee: "Basic fee", premium_fee: "Premium name fee",
    membership_lifetime_fee: "Lifetime membership", membership_annual_fee: "Annual membership",
    symbol3: "3-char symbols", symbol4: "4-char symbols", long_symbol: "Long symbols",
    price_per_kbyte: "Price per KByte", price_per_byte: "Price per byte",
    price_per_output: "Price per output", fee_per_day: "Fee per day", fee_per_kb: "Fee per KB" };

  /* textContent-only element (chain strings never reach HTML). */
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n; }
  /* Touch floor (principle #7): interactive elements >= 44px one dimension. */
  function touchable(n) { n.style.minHeight = "44px"; return n; }
  function clearRoot(root) { while (root.firstChild) root.removeChild(root.firstChild); }
  function makeWrap(doc, root) {
    var w = doc.createElement("div"); w.className = "wrap"; root.appendChild(w); return w; }
  /* Inline error panel, never blank. */
  function showError(doc, wrap, e, fallback) {
    var msg = (e && typeof e.message === "string" && e.message) ? e.message : String(e || fallback || t("fees.unexpected_error", "Unexpected error"));
    if (msg.indexOf("not connected") !== -1) msg = t("fees.network_unavailable_check_settings_nodes_and", "Network unavailable. Check Settings → Nodes and retry.");
    var err = el(doc, "div", msg, "error");
    err.setAttribute("aria-live", "polite"); wrap.appendChild(err); return err;
  }
  /* typeLabel: fee-param key -> short row label (unknown future keys prettify, never blank). */
  function typeLabel(key) {
    if (Object.prototype.hasOwnProperty.call(TYPE_LABELS, key)) return TYPE_LABELS[key];
    return String(key).replace(/_/g, " ");
  }
  /* opLabel: schedule row (or bare id) -> display name + virtual flag.
   * Schedule-missing ops fall back to the local table (never "op_45").
   * Returns {name, virtual, title}: title is the "# · name" form for tooltips;
   * cells show the bare name because the # column already carries the id. */
  function opLabel(row, id) {
    var name = (row && row.name) || OP_NAMES[id] || ("op_" + id);
    var virt = row ? !!row.virtual : !!VIRTUAL[id];
    var disp = name + (virt ? " (virtual)" : "");
    return { name: disp, virtual: virt, title: id + " · " + disp };
  }
  /* orderedKeys: fee-param keys in canonical TYPE_ORDER, unknown keys appended in chain order. */
  function orderedKeys(raw) {
    var out = [], seen = {}, i, k;
    for (i = 0; i < TYPE_ORDER.length; i++) {
      k = TYPE_ORDER[i];
      if (raw && raw[k] !== undefined) { out.push(k); seen[k] = 1; }
    }
    for (k in raw) {
      if (Object.prototype.hasOwnProperty.call(raw, k) && !seen[k]) out.push(k);
    }
    return out;
  }
  /* ltmFor: member-effective cost <- #1 Fees.jsx:95-107. Standard ×
   * network_pct/10000, except op 10 (asset_create) which splits half
   * registrar / half network (#996): × (10000+pct)/20000. BigInt floor —
   * never float for money. Null pct (node omitted it) yields null (dash). */
  function ltmFor(scaledFee, opId, netPct) {
    if (netPct === null || netPct === undefined) return null;
    try {
      var s = BigInt(String(scaledFee));
      if (opId === 10) return (s * (10000n + BigInt(netPct)) / 20000n).toString();
      return (s * BigInt(netPct) / 10000n).toString();
    } catch (e) { return null; }
  }
  /* pctText: basis-points int -> "40%" / "12.5%" label (integer math only). */
  function pctText(bp) {
    var whole = Math.floor(bp / 100), rem = bp % 100;
    if (!rem) return whole + "%";
    return whole + "." + (rem < 10 ? "0" + rem : String(rem)).replace(/0$/, "") + "%";
  }
  /* fmtMoney: scaled int string -> human core-asset string (Format), raw in title. */
  function fmtMoney(scaledVal, prec) {
    if (typeof Format !== "undefined" && Format && typeof Format.formatAmount === "function") {
      try { return Format.formatAmount(String(scaledVal), prec); } catch (e) { /* raw below */ }
    }
    return String(scaledVal);
  }
  /* moneyCell: right-aligned amount cell (dash when null) with raw+scale provenance in title. */
  function moneyCell(doc, scaledVal, prec, title) {
    var td = doc.createElement("td");
    td.style.textAlign = "right"; td.style.whiteSpace = "nowrap";
    if (scaledVal === null || scaledVal === undefined) { td.textContent = "—"; return td; }
    td.textContent = fmtMoney(scaledVal, prec);
    if (title) td.title = title;
    return td;
  }

  /* groupTable: one fee-group section (h2 + scrollable plain table; plain
   * table, not .node-table, so phones scroll it instead of hiding it).
   * Columns: # | Operation | Type | Standard fee | LTM fee. Multi-param ops
   * span one row per fee type; null-fee ops explain themselves; missing ops
   * say so honestly. Params: doc, box, gname, ids, byId, s (schedule),
   * ltmReq (id->true set). Returns missing-op count. */
  function groupTable(doc, box, gname, ids, byId, s, ltmReq) {
    var prec = s.fee_asset_precision, scale = s.scale, netPct = s.network_percent_of_fee;
    box.appendChild(el(doc, "h2", GROUP_NAMES[gname] || gname));
    var sc = el(doc, "div", null, null); sc.style.overflowX = "auto";
    var tb = doc.createElement("table"), thead = doc.createElement("thead"), hr = doc.createElement("tr");
    ["#", "Operation", "Type", "Standard fee", "LTM fee"].forEach(function (h, hi) {
      var th = el(doc, "th", h);
      if (hi >= 3) th.style.textAlign = "right";
      hr.appendChild(th);
    });
    thead.appendChild(hr); tb.appendChild(thead);
    var tb2 = doc.createElement("tbody"), missing = 0, i;
    for (i = 0; i < ids.length; i++) {
      var id = ids[i], row = byId[id], lab = opLabel(row || null, id);
      var title = lab.title;
      if (!row) {
        /* No entry in the live schedule (e.g. testnet lacks bid-collateral
         * 45 / claim-pool 47 / update-issuer 48 / custom-authority 54-56 /
         * ticket-update 58 — the chain prices them via a related op's fee).
         * A dash row beats silence: the op exists, the schedule is quiet. */
        missing += 1;
        var tr0 = doc.createElement("tr");
        var tdId0 = el(doc, "td", String(id)); tdId0.title = title; tr0.appendChild(tdId0);
        var tdOp0 = el(doc, "td", lab.name); tdOp0.title = title; tr0.appendChild(tdOp0);
        tr0.appendChild(el(doc, "td", "—"));
        var tdM = el(doc, "td", "Not in schedule");
        tdM.title = "No entry for op " + id + " in the current fee schedule — the chain falls back to a related operation's fee.";
        tdM.style.textAlign = "right"; tr0.appendChild(tdM);
        var tdL0 = el(doc, "td", "—"); tdL0.style.textAlign = "right"; tr0.appendChild(tdL0);
        tb2.appendChild(tr0);
        continue;
      }
      var keys = orderedKeys(row.raw);
      if (!keys.length) {
        /* Null-fee row: virtual execution events (fills, settle cancels,
         * FBA distributions, bid executions, HTLC redeemed/refund, expired
         * credit deals) and balance claims carry NO fee parameters — they
         * cost nothing and are never signed directly. */
        var tr1 = doc.createElement("tr");
        var tdId1 = el(doc, "td", String(id)); tdId1.title = title; tr1.appendChild(tdId1);
        var tdOp1 = el(doc, "td", lab.name); tdOp1.title = title; tr1.appendChild(tdOp1);
        tr1.appendChild(el(doc, "td", "—"));
        var tdF = el(doc, "td", "Free of charge");
        tdF.title = lab.virtual
          ? "Virtual execution event (op " + id + "): produced by the chain, never signed, no fee parameter."
          : "No fee parameters for op " + id + " on chain (balance claims are always free).";
        tdF.style.textAlign = "right"; tr1.appendChild(tdF);
        var tdL = el(doc, "td", "—"); tdL.style.textAlign = "right"; tr1.appendChild(tdL);
        tb2.appendChild(tr1);
        continue;
      }
      keys.forEach(function (k, ki) {
        var tr = doc.createElement("tr");
        if (ki === 0) {
          var tdId = el(doc, "td", String(id)); tdId.title = title;
          tdId.setAttribute("rowspan", String(keys.length)); tr.appendChild(tdId);
          var tdOp = el(doc, "td", lab.name); tdOp.title = title;
          tdOp.setAttribute("rowspan", String(keys.length)); tr.appendChild(tdOp);
        }
        tr.appendChild(el(doc, "td", typeLabel(k)));
        var rawK = row.raw[k], scaledK = (row.scaled && row.scaled[k] !== undefined) ? row.scaled[k] : rawK;
        var prov = "raw " + rawK + " · scale " + scale;
        if (ltmReq[id]) {
          /* LTM-required (#1 Fees.jsx:182-199): registrar-paid op — no
           * standard fee exists, dash-starred; the member column carries it. */
          var tdD = el(doc, "td", "— *");
          tdD.title = "Lifetime membership required — no standard fee for op " + id + ".";
          tdD.style.textAlign = "right"; tr.appendChild(tdD);
        } else {
          tr.appendChild(moneyCell(doc, scaledK, prec, prov + " · " + k));
        }
        var ltm = ltmFor(scaledK, id, netPct);
        var tdLtm;
        if (ltm === null) {
          tdLtm = el(doc, "td", "—");
          if (netPct === null || netPct === undefined) tdLtm.title = "network_percent_of_fee unavailable — member cost unknown.";
        } else {
          tdLtm = moneyCell(doc, ltm, prec, "member cost = " + prov + " · net " + netPct + "/10000" + (id === 10 ? " · half registrar/half network" : ""));
        }
        tdLtm.style.textAlign = "right"; tr.appendChild(tdLtm);
        tb2.appendChild(tr);
      });
    }
    tb.appendChild(tb2); sc.appendChild(tb); box.appendChild(sc);
    return missing;
  }

  /* Route entry: single heading + honest scope notes, then the five group
   * tables from the live schedule. Offline renders Retry + auto-reruns on
   * reconnect (transfer-ui.js connect-wait pattern, gen-guarded). */
  function renderFees(root) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    var myGen = ++gen;
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    if (typeof Asset === "undefined" || !Asset || typeof Asset.feeSchedule !== "function") {
      showError(doc, wrap, "Fee backend missing: js/asset.js failed to load.");
      return;
    }
    wrap.appendChild(el(doc, "h1", t("fees.network_fees", "Network fees")));
    wrap.appendChild(el(doc, "p",
      "Every operation fee charged by the network, fetched live from the chain's fee schedule. " +
      "Fees are shown in the core asset; each amount's title (hover or long-press) carries the raw chain value and the schedule scale.",
      "muted"));
    if (typeof Chain !== "undefined" && Chain && typeof Chain.status === "function" &&
        Chain.status().state !== "open") {
      wrap.appendChild(el(doc, "p", t("fees.connecting_to_network", "Connecting to network…"), "muted"));
      var retry = touchable(el(doc, "button", t("fees.retry", "Retry")));
      retry.type = "button"; wrap.appendChild(retry);
      var hashAtEntry = (typeof location !== "undefined" && location.hash) || "", settled = false;
      var off = function () {};
      if (typeof Store !== "undefined" && Store && typeof Store.subscribe === "function") {
        off = Store.subscribe("connection", function (st) {
          if (settled || myGen !== gen) return;
          if (st && st.state === "open") {
            settled = true; try { off(); } catch (e) {}
            if (typeof location === "undefined" || location.hash === hashAtEntry) renderFees(root);
          }
        });
      }
      retry.addEventListener("click", function () {
        if (!settled) { settled = true; try { off(); } catch (e) {} }
        if (myGen === gen) renderFees(root);
      });
      var timer = setTimeout(function () {
        if (settled || myGen !== gen) return;
        settled = true; try { off(); } catch (e) {}
      }, 15000);
      return;
    }
    var box = doc.createElement("div");
    wrap.appendChild(box);
    box.appendChild(el(doc, "p", "Loading fee schedule…", "muted"));
    Asset.feeSchedule().then(function (s) {
      if (myGen !== gen) return;
      clearRoot(box);
      var byId = {}, i;
      (s.fees || []).forEach(function (f) { byId[f.opId] = f; });
      var ltmReq = {};
      (s.ltm_required || []).forEach(function (id) { ltmReq[id] = 1; });
      var rebate = (s.network_percent_of_fee === null || s.network_percent_of_fee === undefined)
        ? "an unavailable rebate — the node omitted network_percent_of_fee, so member costs show as dashes"
        : "a " + pctText(s.network_percent_of_fee) + " network share (member-effective cost = fee × " +
          s.network_percent_of_fee + "/10000; asset creation splits half registrar / half network)";
      box.appendChild(el(doc, "p",
        "Schedule scale ×" + s.scale + "/10000 already applied to every figure below. " +
        "The member column shows the lifetime-member effective cost at " + rebate + ". " +
        "Operations marked * require lifetime membership — no standard fee applies to them.",
        "muted"));
      var missingTotal = 0;
      var groups = s.groups || {};
      GROUP_ORDER.forEach(function (gname) {
        var ids = groups[gname] || [];
        if (!ids.length) return;
        missingTotal += groupTable(doc, box, gname, ids, byId, s, ltmReq);
      });
      box.appendChild(el(doc, "p",
        "Operations with no fee parameters — chain execution events (order fills, settlement cancels, " +
        "FBA distributions, bid executions, HTLC redemptions/refunds, expired credit deals) and balance " +
        "claims — cost nothing and are never signed directly.",
        "muted"));
      if (missingTotal > 0) {
        box.appendChild(el(doc, "p",
          missingTotal + " operation(s) have no entry in this schedule — the chain prices them via a " +
          "related operation's fee (e.g. collateral bids fall back to the margin-update fee).",
          "muted"));
      }
      var more = el(doc, "p", null, "muted");
      var a = doc.createElement("a");
      a.href = "#/assets"; a.textContent = t("fees.back_to_assets", "Back to Assets");
      more.appendChild(a); box.appendChild(more);
    }).catch(function (e) {
      if (myGen !== gen) return;
      clearRoot(box);
      showError(doc, box, e, t("asset.fees_failed", "Could not load fees."));
      var retry2 = touchable(el(doc, "button", t("fees.retry", "Retry")));
      retry2.type = "button"; box.appendChild(retry2);
      retry2.addEventListener("click", function () { if (myGen === gen) renderFees(root); });
    });
  }

  return { renderFees: renderFees };
})();

if (typeof module !== "undefined") { module.exports = FeesUI; }
