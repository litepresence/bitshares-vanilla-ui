/* ExplorerBlocksActivity: op/activity sentence rendering for the explorer.
 * Owns: sentenceFor (one activity sentence per op) + pillFor/opAccount/
 *   orderNum and the private sentence builders (amtSpan/orderSentence/
 *   amtObj/opName). Painted by the blocks-tab activity panel (paintActivity
 *   in explorer-blocks.js reaches pillFor/sentenceFor through this module)
 *   and by the _test seam re-exported on the ExplorerBlocks facade.
 * Consumes: Explorer.asset/OP_NAMES (lazy globals, fail open to raw),
 *   Format (human amounts), ExplorerUI._isCurrent (gen guard via the local
 *   isCurrent copy), ExplorerAssets.accountLink (name links via the local
 *   copy), DOM/touchable (script-tag globals).
 * Globals/side effects: DOM under the given doc only; global
 *   ExplorerBlocksActivity only. No chain writes, no signing.
 * Split from: vanilla/js/views/explorer-blocks.js (mechanical move, zero
 *   behavior change — bodies byte-identical, tiny t/const/delegate copies
 *   follow the file's own per-file verbatim-copy convention).
 * Created by: building-vanilla-slices skill, view-split task.
 */
var ExplorerBlocksActivity = (function () {
  "use strict";
  /* Batch-2c i18n (slice-17): display strings resolve via I18n.t with
   * the pre-conversion literal kept verbatim as enDefault (English-identical
   * on any transport, incl. file:// where dict fetch fails). Falls back to
   * the default when i18n.js failed to load: never blank, never throws.
   * Dynamic sentences keep their code structure (batch-2b precedent): only
   * complete static literals are wrapped, values and punctuation glue stay
   * raw, so every default below is byte-verbatim in the HEAD blob. */
  function t(key, dflt) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt);
    } catch (e) { /* default below */ }
    return dflt;
  }

  /* Account-id shape (data copy of the explorer-ui.js regex — slice-3
   * account route target; logic lives in explorer-assets.js). */
  var ACCT_RE = /^1\.2\.\d+$/;

  /* Virtual-op index set (operations.hpp:60,98,100,102,107,109,130-132 —
   * same set as Explorer.VIRTUAL, duplicated per the no-shared-DOM-util
   * doctrine rule: fill_order 4, settle-cancel 42, fba_distribute 44,
   * execute_bid 46, htlc_redeemed 51, htlc_refund 53, credit_deal_expired
   * 74). Virtual ops are chain-generated events, never signed — activity
   * rows say so ((virtual) marker), never silently listing them as user
   * actions. */
  var VIRTUAL_IDX = { 4: 1, 42: 1, 44: 1, 46: 1, 51: 1, 53: 1, 74: 1 };

  /* Core-asset precision for fee-pool funding amounts (asset_object.hpp:65:
   * fee_pool is "in core asset"; GRAPHENE_BLOCKCHAIN_PRECISION = 10^5,
   * config.hpp:29-30 — same const as explorer-assets.js CORE_PRECISION,
   * duplicated per doctrine). Op-16 amounts format synchronously via
   * Format, no precision join needed. */
  var CORE_PRECISION = 5;

  /* Local fallback counter, used ONLY when explorer-ui.js failed to load
   * (impossible in the shipped app — script tags are load-bearing). In
   * practice every bump/check below reaches the shell's single counter, so
   * stale async work bails across routes instead of touching detached DOM. */
  var localGen = 0;

  /* True while myGen is still the latest route entry. */
  function isCurrent(myGen) {
    if (typeof ExplorerUI !== "undefined" && ExplorerUI &&
        typeof ExplorerUI._isCurrent === "function") return ExplorerUI._isCurrent(myGen);
    return myGen === localGen;
  }

  /* Account-id link (canonical implementation in explorer-assets.js). Falls
   * back to plain text. */
  function accountLink(doc, id, myGen) {
    if (typeof ExplorerAssets !== "undefined" && ExplorerAssets &&
        typeof ExplorerAssets.accountLink === "function") {
      return ExplorerAssets.accountLink(doc, id, myGen);
    }
    return DOM.el(doc, "span", id);
  }

  function anchor(doc, text, href) {
    var a = DOM.el(doc, "a", text);
    a.setAttribute("href", href);
    touchable(a);
    a.style.display = "inline-block";
    return a;
  }

  /* Amount leaf -> span that fills in human text once the asset precision
   * resolves (same pattern as explorer-render.js amountSpan, local so this
   * file needs no new cross-module surface). Raw int + "(raw)" meanwhile,
   * raw in the title always. */
  function amtSpan(doc, raw, assetId, myGen) {
    var s = DOM.el(doc, "span", String(raw) + t("explorer.raw_mark", " (raw)"));
    s.title = String(raw) + " " + assetId;
    if (typeof Explorer === "undefined" || !Explorer || typeof Explorer.asset !== "function") return s;
    Explorer.asset(assetId).then(function (j) {
      if (!isCurrent(myGen)) return;
      try {
        s.textContent = Format.formatAmount(String(raw), j.asset.precision) + " " + j.asset.symbol;
        s.title = String(raw);
      } catch (e) { s.textContent = String(raw) + " " + assetId; }
    }).catch(function () {
      if (!isCurrent(myGen)) return;
      s.textContent = String(raw) + " " + assetId;
    });
    return s;
  }

  /* Activity pill for one op: PLACE ORDER (warn orange) / CANCEL (danger
   * red) / TRANSFER (accent) / known others muted with the spaced type name
   * / unknown "op <id>" muted (never blank, never throws). Virtual ops carry
   * an honest " (virtual)" suffix (see VIRTUAL_IDX). Uppercase rides
   * in CSS for known labels; the unknown id keeps its literal "op N" shape. */
  function pillFor(doc, op) {
    var idx = (typeof op.type_idx === "number") ? op.type_idx : parseInt(op.type_idx, 10);
    var known = (typeof op.type_name === "string" && op.type_name && op.type_name !== "unknown");
    var pill;
    if (idx === 1) pill = DOM.el(doc, "span", t("explorer.pill_place", "Place order"), "xplore-pill xplore-pill-place");
    else if (idx === 2) pill = DOM.el(doc, "span", t("explorer.pill_cancel", "Cancel order"), "xplore-pill xplore-pill-cancel");
    else if (idx === 0) pill = DOM.el(doc, "span", t("explorer.pill_transfer", "Transfer"), "xplore-pill xplore-pill-transfer");
    else if (known) pill = DOM.el(doc, "span", String(op.type_name).replace(/_/g, " "), "xplore-pill xplore-pill-muted");
    else pill = DOM.el(doc, "span", "op " + (isFinite(idx) ? idx : "?"), "xplore-pill xplore-pill-muted xplore-pill-raw");
    if (isFinite(idx) && VIRTUAL_IDX[idx]) pill.textContent += " (virtual)";
    return pill;
  }

  /* First 1.2.x account id found under the usual op field names (shallow
   * only — no guessing inside nested objects). Returns "" when none. */
  function opAccount(f) {
    if (!f || typeof f !== "object") return "";
    var keys = ["fee_paying_account", "seller", "from", "to", "account",
      "issuer", "payer", "owner", "worker_account", "witness_account",
      "committee_member_account", "registrar", "referrer", "payer_account",
      "authorizing_account", "account_to_upgrade", "from_account", "redeemer",
      "creator", "account_to_list"];
    for (var i = 0; i < keys.length; i++) {
      if (typeof f[keys[i]] === "string" && ACCT_RE.test(f[keys[i]])) return f[keys[i]];
    }
    return "";
  }

  /* Order instance number ("1.7.574981117" -> "574981117"): original
   * LimitOrderCancel.jsx:39 shows "#" + order.substring(4). Nonconforming
   * shapes fall back to the raw string (never blank). */
  function orderNum(id) {
    var s = String((id === undefined || id === null) ? "—" : id);
    if (/^1\.7\.\d+$/.test(s)) return s.substring(4);
    return s;
  }

  /* Limit-order sentence in the original shape (LimitOrderCreate.jsx:90-122
   * concept: "placed order to buy <amount> at <price> <sym/sym>"). Buy/sell
   * follows the no-prefs default of the original's market-direction test
   * (isBid = selling the lower-instance asset — getMarketName orders by
   * instance id, inverted falsy until the viewer picks a market): sellN <
   * buyN reads "buy", else "sell". Amount + price resolve human via
   * Explorer.asset + Format (integer-only Format.formatPrice, 8 places
   * trimmed); raw meanwhile, raw in the title. No block suffix — the
   * original rows carry no block number either. */
  function orderSentence(doc, f, myGen) {
    var sent = DOM.el(doc, "span", null, "xplore-act-sent");
    var sell = (f.amount_to_sell && typeof f.amount_to_sell === "object") ? f.amount_to_sell : {};
    var buy = (f.min_to_receive && typeof f.min_to_receive === "object") ? f.min_to_receive : {};
    var sellId = String(sell.asset_id || ""), buyId = String(buy.asset_id || "");
    var sellN = parseInt(sellId.split(".")[2] || "x", 10);
    var buyN = parseInt(buyId.split(".")[2] || "x", 10);
    var isBuy = (isFinite(sellN) && isFinite(buyN)) ? (sellN < buyN) : false;
    sent.appendChild(accountLink(doc, String(f.seller || opAccount(f) || "—"), myGen));
    sent.appendChild(DOM.el(doc, "span", isBuy ? " placed order to buy " : " placed order to sell "));
    var amtRaw0 = String((isBuy ? buy.amount : sell.amount) ?? "—");
    var amtPh = DOM.el(doc, "span", amtRaw0 + t("explorer.raw_mark", " (raw)"));
    amtPh.title = amtRaw0;
    sent.appendChild(amtPh);
    sent.appendChild(DOM.el(doc, "span", " at "));
    var pricePh = DOM.el(doc, "span", "…");
    sent.appendChild(pricePh);
    sent.appendChild(DOM.el(doc, "span", " "));
    sent.appendChild(DOM.el(doc, "span", (sellId || "?") + "/" + (buyId || "?")));
    if (!sellId || !buyId || typeof Explorer === "undefined" || !Explorer ||
        typeof Explorer.asset !== "function") return sent;
    var pairPh = sent.lastChild;
    Promise.all([Explorer.asset(sellId).catch(function () { return null; }),
      Explorer.asset(buyId).catch(function () { return null; })]).then(function (pair) {
      if (!isCurrent(myGen)) return;
      try {
        var sJ = pair[0], bJ = pair[1];
        if (!sJ || !bJ || !sJ.asset || !bJ.asset) return;
        var sP = sJ.asset.precision, bP = bJ.asset.precision;
        var sS = sJ.asset.symbol, bS = bJ.asset.symbol;
        if (typeof sP !== "number" || typeof bP !== "number") return;
        var amtRaw = String(isBuy ? buy.amount : sell.amount);
        amtPh.textContent = Format.formatAmount(amtRaw, isBuy ? bP : sP) + " " + (isBuy ? bS : sS);
        amtPh.title = amtRaw;
        var px = isBuy
          ? Format.formatPrice(String(sell.amount), sP, String(buy.amount), bP, 8)
          : Format.formatPrice(String(buy.amount), bP, String(sell.amount), sP, 8);
        px = px.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
        pricePh.textContent = px;
        pricePh.title = isBuy
          ? (String(sell.amount) + " " + sellId + " / " + String(buy.amount) + " " + buyId)
          : (String(buy.amount) + " " + buyId + " / " + String(sell.amount) + " " + sellId);
        pairPh.textContent = isBuy ? (sS + "/" + bS) : (bS + "/" + sS);
      } catch (e) { /* raw placeholders stand */ }
    });
    return sent;
  }

  /* Amount object {amount, asset_id} -> human span (raw meanwhile, raw in
   * title via amtSpan). Nonconforming shapes yield a muted dash (never
   * blank, never throws). */
  function amtObj(doc, o, myGen) {
    if (o && typeof o === "object" && typeof o.asset_id === "string") {
      return amtSpan(doc, String(o.amount), o.asset_id, myGen);
    }
    return DOM.el(doc, "span", "—", "muted");
  }

  /* Proposed-op index -> name via explorer.js OP_NAMES when present (that
   * module owns the 78-entry table — this file must not duplicate it).
   * Falls back to "op N" when OP_NAMES is absent (never blank, never
   * throws). */
  function opName(idx) {
    var i = (typeof idx === "number") ? idx : parseInt(idx, 10);
    try {
      if (typeof Explorer !== "undefined" && Explorer && Array.isArray(Explorer.OP_NAMES) &&
          typeof Explorer.OP_NAMES[i] === "string" && Explorer.OP_NAMES[i]) {
        return Explorer.OP_NAMES[i];
      }
    } catch (e) { /* fallback below */ }
    return "op " + (isFinite(i) ? i : "?");
  }

  /* One activity sentence (account + action + amounts, original Operation
   * wording: "placed order to buy/sell <amount> at <price> <pair>",
   * "cancelled order #<n>"). High-frequency op types carry full sentences
   * here: 0 transfer, 1/2 limit orders, 3 margin update, 4 fill (virtual),
   * 5 account create, 6 account update, 7 whitelist, 8 upgrade, 10/11 asset
   * create/update, 14 asset issue, 15 reserve, 16 fee-pool fund, 17 settle,
   * 19 feed publish, 22 proposal create, 23 proposal update, 33 vesting
   * withdraw, 49/50 HTLC create/redeem, 77 limit-order update — names via
   * op.type_name / opName, amounts via amtSpan/Format. Static glue stays
   * plain English (batch-2b: dynamic sentences keep code structure; only
   * the pill labels above carry i18n keys — no new t() keys, so check_i18n
   * stays green without touching vanilla/locales/*). Accounts resolve to
   * name links via the shared accountLink (raw id meanwhile); amounts
   * resolve human via amtSpan/orderSentence (raw meanwhile, raw in title).
   * Virtual ops (VIRTUAL_IDX) carry an honest " (virtual)" marker. Known
   * shapes carry no block suffix, like the original rows; unknown shapes
   * fall back to "op <id> · block #h" — never blank, never throws.
   * Field truth (#4 wins): account.hpp:197-220 (op 7 listing bits),
   * account.hpp:235-251 (op 8 upgrade flag), asset_ops.hpp:192-226 (op 10),
   * asset_ops.hpp:351-382 (op 11), asset_ops.hpp:513-524 (op 15),
   * asset_ops.hpp:322-334 (op 16, core precision per asset_object.hpp:65),
   * asset_ops.hpp:267-288 (op 17), proposal.hpp:119-143 (op 23),
   * vesting.hpp:101-117 (op 33), htlc.hpp:45-88/90-117 (ops 49/50),
   * market.hpp:117-136 (op 77). Wording follows the wallet-extension 78-op
   * history table (popup.js "Account Upgrade", "Order Updated", …) where it
   * names these ops. Witness/committee create/update (20/21/29/30),
   * pool/samet/credit/ticket/custom-authority ops keep the generic fallback
   * (name + block link) — their full views live in the owning slices. */
  function sentenceFor(doc, op, myGen) {
    var sent = DOM.el(doc, "span", null, "xplore-act-sent");
    try {
      var f = (op.fields && typeof op.fields === "object") ? op.fields : {};
      var idx = (typeof op.type_idx === "number") ? op.type_idx : parseInt(op.type_idx, 10);
      var blkLink = anchor(doc, "#" + op.block, "#/block/" + op.block);
      blkLink.title = t("explorer.block_prefix", "Block #") + op.block;
      if (idx === 0 && f.amount && typeof f.amount.asset_id === "string") {
        sent.appendChild(accountLink(doc, String(f.from || opAccount(f) || "—"), myGen));
        sent.appendChild(DOM.el(doc, "span", " transferred "));
        sent.appendChild(amtSpan(doc, String(f.amount.amount), f.amount.asset_id, myGen));
        sent.appendChild(DOM.el(doc, "span", " to "));
        sent.appendChild(accountLink(doc, String(f.to || "—"), myGen));
        return sent;
      }
      if (idx === 1 && f.amount_to_sell && f.min_to_receive) {
        return orderSentence(doc, f, myGen);
      }
      if (idx === 2) {
        sent.appendChild(accountLink(doc, String(f.fee_paying_account || opAccount(f) || "—"), myGen));
        sent.appendChild(DOM.el(doc, "span", " cancelled order #" + orderNum(f.order)));
        return sent;
      }
      if (idx === 3) {
        sent.appendChild(accountLink(doc, String(f.funding_account || opAccount(f) || "—"), myGen));
        sent.appendChild(DOM.el(doc, "span", t("explorer.updated_margin_position", " updated margin position")));
        if (f.delta_collateral && typeof f.delta_collateral === "object") {
          sent.appendChild(DOM.el(doc, "span", t("explorer.collateral_prefix", " (+collateral ")));
          sent.appendChild(amtObj(doc, f.delta_collateral, myGen));
          sent.appendChild(DOM.el(doc, "span", ")"));
        }
        if (f.delta_debt && typeof f.delta_debt === "object") {
          sent.appendChild(DOM.el(doc, "span", t("explorer.debt_prefix", " (+debt ")));
          sent.appendChild(amtObj(doc, f.delta_debt, myGen));
          sent.appendChild(DOM.el(doc, "span", ")"));
        }
        return sent;
      }
      if (idx === 4) {
        sent.appendChild(accountLink(doc, String(f.account_id || opAccount(f) || "—"), myGen));
        sent.appendChild(DOM.el(doc, "span", t("explorer.filled_order_prefix", " filled order: ")));
        sent.appendChild(amtObj(doc, f.pays, myGen));
        sent.appendChild(DOM.el(doc, "span", " → "));
        sent.appendChild(amtObj(doc, f.receives, myGen));
        sent.appendChild(DOM.el(doc, "span", " (virtual)", "muted"));
        return sent;
      }
      if (idx === 5) {
        sent.appendChild(accountLink(doc, String(f.registrar || opAccount(f) || "—"), myGen));
        sent.appendChild(DOM.el(doc, "span", t("explorer.created_account_prefix", " created account ") + String(f.name || "—")));
        return sent;
      }
      if (idx === 6) {
        sent.appendChild(accountLink(doc, String(f.account || opAccount(f) || "—"), myGen));
        sent.appendChild(DOM.el(doc, "span", t("explorer.updated_account", " updated account")));
        return sent;
      }
      if (idx === 14) {
        sent.appendChild(accountLink(doc, String(f.issuer || opAccount(f) || "—"), myGen));
        sent.appendChild(DOM.el(doc, "span", t("explorer.issued_mid", " issued ")));
        sent.appendChild(amtObj(doc, f.asset_to_issue, myGen));
        sent.appendChild(DOM.el(doc, "span", t("explorer.to_mid", " to ")));
        sent.appendChild(accountLink(doc, String(f.issue_to_account || "—"), myGen));
        return sent;
      }
      if (idx === 19) {
        sent.appendChild(accountLink(doc, String(f.publisher || opAccount(f) || "—"), myGen));
        sent.appendChild(DOM.el(doc, "span", t("explorer.published_feed_for_prefix", " published feed for ") + String(f.asset_id || "—")));
        return sent;
      }
      if (idx === 22) {
        sent.appendChild(accountLink(doc, String(f.fee_paying_account || opAccount(f) || "—"), myGen));
        var pops = Array.isArray(f.proposed_ops) ? f.proposed_ops : [];
        var names = pops.map(function (p) {
          var pi = Array.isArray(p) ? p[0] : (p && (p.type !== undefined ? p.type : p.op));
          return opName(pi).replace(/_/g, " ");
        }).join(", ");
        sent.appendChild(DOM.el(doc, "span", t("explorer.proposed_prefix", " proposed ") + pops.length + t("explorer.operation_mid", " operation") +
          (pops.length === 1 ? "" : "s") + (names ? " (" + names + ")" : "")));
        return sent;
      }
      if (idx === 7) {
        sent.appendChild(accountLink(doc, String(f.authorizing_account || opAccount(f) || "—"), myGen));
        var listing = parseInt(f.new_listing, 10);
        var word = "cleared the listing for";
        if (listing === 1) word = "whitelisted";
        else if (listing === 2) word = "blacklisted";
        else if (listing === 3) word = "whitelisted and blacklisted";
        sent.appendChild(DOM.el(doc, "span", " " + word + " "));
        sent.appendChild(accountLink(doc, String(f.account_to_list || "—"), myGen));
        return sent;
      }
      if (idx === 8) {
        sent.appendChild(accountLink(doc, String(f.account_to_upgrade || opAccount(f) || "—"), myGen));
        sent.appendChild(DOM.el(doc, "span", f.upgrade_to_lifetime_member === true
          ? " upgraded to lifetime membership" : " renewed annual membership"));
        return sent;
      }
      if (idx === 10) {
        sent.appendChild(accountLink(doc, String(f.issuer || opAccount(f) || "—"), myGen));
        var sym10 = String(f.symbol || "—");
        var prec10 = (typeof f.precision === "number") ? " (precision " + f.precision + ")" : "";
        sent.appendChild(DOM.el(doc, "span", " created asset " + sym10 + prec10));
        return sent;
      }
      if (idx === 11) {
        sent.appendChild(accountLink(doc, String(f.issuer || opAccount(f) || "—"), myGen));
        sent.appendChild(DOM.el(doc, "span", " updated asset " + String(f.asset_to_update || "—")));
        return sent;
      }
      if (idx === 15) {
        sent.appendChild(accountLink(doc, String(f.payer || opAccount(f) || "—"), myGen));
        sent.appendChild(DOM.el(doc, "span", " reserved "));
        sent.appendChild(amtObj(doc, f.amount_to_reserve, myGen));
        return sent;
      }
      if (idx === 16) {
        sent.appendChild(accountLink(doc, String(f.from_account || opAccount(f) || "—"), myGen));
        sent.appendChild(DOM.el(doc, "span", " funded the fee pool of " + String(f.asset_id || "—") + " with "));
        var raw16 = (f.amount !== undefined && f.amount !== null) ? String(f.amount) : null;
        if (raw16 !== null && /^\d+$/.test(raw16)) {
          var fund16 = DOM.el(doc, "span", null);
          try {
            fund16.textContent = Format.formatAmount(raw16, CORE_PRECISION) + " (core)";
          } catch (e) { fund16.textContent = raw16 + " (raw)"; }
          fund16.title = raw16;
          sent.appendChild(fund16);
        } else {
          sent.appendChild(DOM.el(doc, "span", "—", "muted"));
        }
        return sent;
      }
      if (idx === 17) {
        sent.appendChild(accountLink(doc, String(f.account || opAccount(f) || "—"), myGen));
        sent.appendChild(DOM.el(doc, "span", " requested settlement of "));
        sent.appendChild(amtObj(doc, f.amount, myGen));
        return sent;
      }
      if (idx === 23) {
        sent.appendChild(accountLink(doc, String(f.fee_paying_account || opAccount(f) || "—"), myGen));
        sent.appendChild(DOM.el(doc, "span", " updated proposal " + String(f.proposal || "—")));
        var adds = Array.isArray(f.active_approvals_to_add) ? f.active_approvals_to_add.length : 0;
        var rems = Array.isArray(f.active_approvals_to_remove) ? f.active_approvals_to_remove.length : 0;
        if (adds > 0 || rems > 0) {
          sent.appendChild(DOM.el(doc, "span", " (+" + adds + "/−" + rems + " approvals)"));
        }
        return sent;
      }
      if (idx === 33) {
        sent.appendChild(accountLink(doc, String(f.owner || opAccount(f) || "—"), myGen));
        sent.appendChild(DOM.el(doc, "span", " withdrew "));
        sent.appendChild(amtObj(doc, f.amount, myGen));
        sent.appendChild(DOM.el(doc, "span", " from vesting " + String(f.vesting_balance || "—")));
        return sent;
      }
      if (idx === 49) {
        sent.appendChild(accountLink(doc, String(f.from || opAccount(f) || "—"), myGen));
        sent.appendChild(DOM.el(doc, "span", " locked "));
        sent.appendChild(amtObj(doc, f.amount, myGen));
        sent.appendChild(DOM.el(doc, "span", " for "));
        sent.appendChild(accountLink(doc, String(f.to || "—"), myGen));
        return sent;
      }
      if (idx === 50) {
        sent.appendChild(accountLink(doc, String(f.redeemer || opAccount(f) || "—"), myGen));
        sent.appendChild(DOM.el(doc, "span", " claimed HTLC " + String(f.htlc_id || "—")));
        return sent;
      }
      if (idx === 77) {
        sent.appendChild(accountLink(doc, String(f.seller || opAccount(f) || "—"), myGen));
        sent.appendChild(DOM.el(doc, "span", " updated order #" + orderNum(f.order)));
        return sent;
      }
      var who = opAccount(f);
      if (who) sent.appendChild(accountLink(doc, who, myGen));
      else sent.appendChild(DOM.el(doc, "span", (typeof op.type_name === "string" && op.type_name !== "unknown")
        ? op.type_name.replace(/_/g, " ") : "op " + (isFinite(idx) ? idx : "?")));
      if (who) {
        sent.appendChild(DOM.el(doc, "span", " " + ((typeof op.type_name === "string" && op.type_name !== "unknown")
          ? op.type_name.replace(/_/g, " ") : "op " + (isFinite(idx) ? idx : "?"))));
      }
      if (isFinite(idx) && VIRTUAL_IDX[idx]) {
        sent.appendChild(DOM.el(doc, "span", " (virtual)", "muted"));
      }
      sent.appendChild(DOM.el(doc, "span", " · "));
      sent.appendChild(blkLink);
      return sent;
    } catch (e) {
      DOM.clear(sent);
      sent.appendChild(DOM.el(doc, "span", "op ? · #" + (op.block || "?")));
      return sent;
    }
  }

  return {
    pillFor: pillFor,
    sentenceFor: sentenceFor,
    opAccount: opAccount,
    orderNum: orderNum
  };
})();

if (typeof module !== "undefined") { module.exports = ExplorerBlocksActivity; }
