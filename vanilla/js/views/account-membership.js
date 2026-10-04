/* account-membership.js — account page membership + positions sections.
 *
 * What it owns: memberStatus/confirmList/renderMembership (permission
 *   view + upgrade path), renderMargin/renderCredit (Margin Positions +
 *   Credit Management tabs). Consumes: I18n.t (display strings) — no
 *   cross-module calls (renderCredit's old orderCells use was a comment).
 *   Globals/side effects: DOM under the given section element only;
 *   attaches AccountUI._membership and republishes globalThis.AccountUI.
 *   Split from account-ui.js (mechanical move, zero behavior change —
 *   called by AccountUI.showAccount via the facade). Facade: account-ui.js.
 * Created by: split_responsibility.py account/market frontier.
 */
var AccountUI = (typeof globalThis !== "undefined" && globalThis.AccountUI) ? globalThis.AccountUI : ((typeof AccountUI !== "undefined") ? AccountUI : {});
AccountUI._membership = AccountUI._membership || {};
(function () {
  "use strict";

  /* Verbatim copy of account-ui.js t (same per-file convention as the explorer/vote-slate splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared chart/vote abstraction. */
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
    return dflt;
  }

  /* Verbatim copy of account-ui.js makeError (same per-file convention as the explorer/vote-slate splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared chart/vote abstraction. */
  /* Inline error line (aria-live so screen readers announce failures). */
  function makeError(doc) {
    var err = doc.createElement("div");
    err.className = "error";
    err.setAttribute("aria-live", "polite");
    return err;
  }

  /* Verbatim copy of account-ui.js showError (same per-file convention as the explorer/vote-slate splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared chart/vote abstraction. */
  /* Show an inline error panel that is never blank: any thrown value maps
   * to a human sentence; unknown shapes fall back to a generic message.
   * History fallback keeps its byte-identical message key and gains a linked
   * "Open Settings" action (HistoryNotice.actionLink, pure DOM). */
  function showError(doc, wrap, e, fallback) {
    var err = makeError(doc);
    var raw = (e && typeof e.message === "string" && e.message)
      ? e.message
      : String(e || fallback || "");
    var isHist = raw.indexOf("history-unavailable") !== -1;
    var msg = (e && typeof e.message === "string" && e.message)
      ? e.message
      : String(e || fallback || t("common.unexpected_error", "Unexpected error"));
    if (msg.indexOf("unknown-account") !== -1) {
      msg = fallback || t("common.unknown_account", "Unknown account.");
    } else if (msg.indexOf("no-account") !== -1) {
      msg = t("transfer.err_no_account", "No on-chain account found for the wallet's active key.");
    } else if (msg.indexOf("history-unavailable") !== -1) {
      msg = t("account.err_history", "History unavailable on this node.");
    } else if (msg.indexOf("bad-asset-shape") !== -1) {
      msg = t("account.err_asset_shape", "Unexpected asset data from the node; stopped instead of guessing.");
    } else if (msg.indexOf("wallet-locked") !== -1) {
      msg = t("common.wallet_locked", "Wallet is locked.");
    }
    err.textContent = msg;
    wrap.appendChild(err);
    if (isHist) {
      try {
        if (typeof HistoryNotice !== "undefined" && HistoryNotice && typeof HistoryNotice.actionLink === "function") {
          var link = HistoryNotice.actionLink(doc, t, "settings");
          if (link) wrap.appendChild(link);
        }
      } catch (e2) { /* error panel stands without the link */ }
    }
  }

  /* Verbatim copy of account-ui.js fmtRaw (same per-file convention as the explorer/vote-slate splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared chart/vote abstraction. */
  /* Raw integer -> display string at prec decimals; falls back to the raw
   * digits when Format is absent (never throws on chain data). */
  function fmtRaw(raw, prec) {
    if (typeof prec !== "number") return String(raw);
    try {
      if (typeof Format !== "undefined" && Format && typeof Format.formatAmount === "function") {
        return Format.formatAmount(String(raw), prec);
      }
    } catch (e) { /* raw fallback below */ }
    return String(raw);
  }

  /* Verbatim copy of account-ui.js dashText (same per-file convention as the explorer/vote-slate splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared chart/vote abstraction. */
  /* Dash text for honestly-missing cells (reuses the shared dash key). */
  function dashText() { return t("settings.dash", "—"); }

  /* Member status from a full get_accounts object (bitsharesjs
   * ChainStore.getAccountMemberStatus rule, consumed at #1
   * AccountMembership.jsx:85 — member_status drives the upgrade buttons
   * there): lifetime iff the account is its own lifetime_referrer; else
   * annual iff membership_expiration_date parses to a future time; else
   * basic. Unparseable/missing dates read basic — a display field never
   * throws. Params: full (raw account object or null). */
  function memberStatus(full) {
    if (!full || typeof full !== "object") return "basic";
    if (full.lifetime_referrer && full.id && full.lifetime_referrer === full.id) {
      return "lifetime";
    }
    var t = Date.parse(full.membership_expiration_date);
    if (Number.isFinite(t) && t > Date.now()) return "annual";
    return "basic";
  }

  /* Named-row confirm list (dt/dd pairs; dd title carries the raw value). */
  function confirmList(doc, rows) {
    var list = doc.createElement("dl");
    list.className = "xfer-confirm";
    rows.forEach(function (r) {
      var dt = doc.createElement("dt");
      dt.textContent = r[0];
      list.appendChild(dt);
      var dd = doc.createElement("dd");
      dd.textContent = r[1];
      if (r[2]) dd.title = r[2];
      list.appendChild(dd);
    });
    return list;
  }

  /* Membership section (C29): status line for every account plus the op-8
   * lifetime-member upgrade flow for non-LTM accounts. Flow: Review (fee
   * estimated live via get_required_fees) -> named-row confirm (account,
   * fee) -> Sign & Send -> re-read proof (status flips to lifetime).
   * Guards: wallet must be unlocked AND bound to the viewed account (an
   * upgrade signs with the account's own active key — anything else fails
   * loudly before any broadcast). Params: doc, box (section element),
   * acct ({id, name}). */
  function renderMembership(doc, box, acct) {
    var loading = doc.createElement("p");
    loading.className = "muted";
    loading.textContent = t("account.loading_membership", "Loading membership…");
    box.appendChild(loading);
    var need = ["Chain", "Tx", "Credit", "Format", "Asset", "Wallet", "Account"];
    var missing = null;
    need.forEach(function (g) {
      if (typeof globalThis[g] === "undefined") missing = g;
    });
    if (missing) {
      box.removeChild(loading);
      showError(doc, box, t("account.backend_missing", "%(mod)s backend missing: %(mod)s failed to load.", {mod: missing}));
      return;
    }
    Promise.resolve().then(async function () {
      var dbId = await Chain.db();
      var rows = await Chain.call(dbId, "get_accounts", [[acct.id]]);
      if (!rows || !rows[0]) throw new Error("unknown-account");
      return rows[0];
    }).then(function (full) {
      box.removeChild(loading);
      var status = memberStatus(full);
      var p = doc.createElement("p");
      if (status === "lifetime") {
        p.textContent = t("account.lifetime", "Lifetime member.");
        box.appendChild(p);
        return;
      }
      p.textContent = status === "annual" && full.membership_expiration_date
        ? t("account.annual_member", "Annual member (expires %(date)s).", {date: String(full.membership_expiration_date)})
        : t("account.basic", "Basic account.");
      box.appendChild(p);
      var btn = doc.createElement("button");
      btn.type = "button";
      btn.style.minHeight = "44px";
      btn.textContent = t("account.upgrade_btn", "Upgrade to lifetime member");
      box.appendChild(btn);
      var out = doc.createElement("div");
      box.appendChild(out);
      btn.addEventListener("click", function () {
        while (out.firstChild) out.removeChild(out.firstChild);
        btn.disabled = true;
        var st = doc.createElement("p");
        st.className = "muted";
        st.textContent = t("account.resolving_fee", "Resolving and estimating fee…");
        out.appendChild(st);
        Promise.resolve().then(async function () {
          if (!Wallet.isUnlocked()) throw new Error("wallet-locked");
          var mine = await Account.myAccountId();
          if (mine !== acct.id) {
            throw new Error(t("account.upgrade_guard", "This upgrade must be signed by %(name)s's active key — unlock that wallet account first (no broadcast made).", {name: acct.name}));
          }
          var pair = [8, { fee: { amount: "0", asset_id: "1.3.0" },
            account_to_upgrade: acct.id, upgrade_to_lifetime_member: true,
            extensions: [] }];
          var fee = await Credit.fee(pair, "1.3.0");
          return { pair: pair, fee: fee, fromStatus: status };
        }).then(function (R) {
          var fa = null;
          Asset.describe(R.fee.asset_id).then(function (a) { fa = a; })
            .catch(function () { fa = null; }).then(function () {
              while (out.firstChild) out.removeChild(out.firstChild);
              var feeHuman = fa
                ? Format.formatAmount(String(R.fee.amount), fa.precision) + " " + fa.symbol
                : String(R.fee.amount);
              out.appendChild(confirmList(doc, [
                [t("account.upgrade_row_account", "Account"), acct.name + " (" + acct.id + ")"],
                [t("account.upgrade_row_upgrade", "Upgrade"), R.fromStatus + t("account.to_lifetime", " → Lifetime member")],
                [t("confirm.fee", "Fee"), feeHuman, t("account.raw_prefix", "raw ") + String(R.fee.amount)],
                [t("confirm.network", "Network"), "testnet"]
              ]));
              var back = doc.createElement("button");
              back.type = "button";
              back.style.minHeight = "44px";
              back.textContent = t("confirm.back", "Back");
              var send = doc.createElement("button");
              send.type = "button";
              send.style.minHeight = "44px";
              send.textContent = t("common.sign_send", "Sign & Send");
              out.appendChild(back);
              out.appendChild(send);
              back.addEventListener("click", function () {
                while (out.firstChild) out.removeChild(out.firstChild);
                btn.disabled = false;
              });
              send.addEventListener("click", function () {
                send.disabled = true;
                back.disabled = true;
                var bs = doc.createElement("p");
                bs.className = "muted";
                bs.textContent = t("common.status_broadcasting", "Broadcasting…");
                out.appendChild(bs);
                var wif = Wallet.keys && Wallet.keys.active ? Wallet.keys.active.wif : null;
                if (!wif) {
                  out.removeChild(bs);
                  showError(doc, out, new Error("wallet-locked"), t("common.wallet_locked", "Wallet is locked."));
                  send.disabled = false;
                  back.disabled = false;
                  return;
                }
                Tx.buildTx([R.pair]).then(function (unsigned) {
                  return Credit.sendAndProve(unsigned, wif, async function () {
                    try {
                      var dbId = await Chain.db();
                      var rows = await Chain.call(dbId, "get_accounts", [[acct.id]]);
                      if (rows && rows[0] && memberStatus(rows[0]) === "lifetime") return rows[0];
                    } catch (e) { return null; }
                    return null;
                  });
                }).then(function (res) {
                  while (out.firstChild) out.removeChild(out.firstChild);
                  var ok = doc.createElement("p");
                  ok.textContent = t("account.upgraded_ok", "Lifetime upgrade broadcast (%(via)s). %(name)s is now a lifetime member.", {via: res.via, name: acct.name});
                  out.appendChild(ok);
                  btn.disabled = false;
                }).catch(function (e) {
                  out.removeChild(bs);
                  showError(doc, out, e,
                    t("common.failed_check_state", "Failed. Check state before retrying (do NOT blindly rebroadcast)."));
                  send.disabled = false;
                  back.disabled = false;
                });
              });
              btn.disabled = false;
            });
        }).catch(function (e) {
          while (out.firstChild) out.removeChild(out.firstChild);
          showError(doc, out, e, t("account.upgrade_prepare_failed", "Could not prepare the upgrade."));
          btn.disabled = false;
        });
      });
    }).catch(function (e) {
      box.removeChild(loading);
      showError(doc, box, e, t("account.membership_failed", "Could not load membership."));
    });
  }

  /* Margin Positions tab (punchlist ADD): Credit.positions for the viewed
   * account (public read, no unlock — same posture as open orders).
   * Reference concept only: #1 AccountOverview MarginPositionsTable.
   * Read-only table (Position / Collateral / Debt / Borrower); adjust or
   * close flows live on #/borrow — linked, not rebuilt. A missing Credit
   * backend or a failed read renders an honest line, never a blank tab.
   * sharedPositions (optional zero-arg fn): the render's shared positions
   * promise (perf — same rows the Balances enrichment reads; one fetch per
   * render, never two). */
  function renderMargin(doc, section, acct, sharedPositions) {
    var loading = doc.createElement("p");
    loading.className = "muted";
    loading.textContent = t("account.loading_margin_positions", "Loading margin positions…");
    section.appendChild(loading);
    if (typeof Credit === "undefined" || !Credit || typeof Credit.positions !== "function") {
      section.removeChild(loading);
      var miss = doc.createElement("p");
      miss.className = "muted";
      miss.textContent = t("account.margin_backend_not_loaded_js_credit_js_missin", "Margin backend not loaded (js/credit.js missing) — positions unavailable.");
      section.appendChild(miss);
      return;
    }
    Promise.resolve().then(function () {
      if (typeof sharedPositions === "function") return sharedPositions();
      return Credit.positions(acct.id);
    }).then(function (rows) {
      section.removeChild(loading);
      if (!rows || rows.length === 0) {
        var empty = doc.createElement("p");
        empty.className = "muted";
        empty.textContent = t("account.no_margin_positions_for_this_account", "No margin positions for this account.") + t("account.margin_hint", " Lock collateral from the borrow page (#/borrow) — positions list here.");
        section.appendChild(empty);
        return;
      }
      var table = doc.createElement("table");
      table.className = "node-table";
      var thead = doc.createElement("thead");
      var headRow = doc.createElement("tr");
      ["Position", "Collateral", "Debt", "Borrower"].forEach(function (label) {
        var th = doc.createElement("th");
        th.textContent = label;
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      table.appendChild(thead);
      var tbody = doc.createElement("tbody");
      rows.forEach(function (r) {
        var tr = doc.createElement("tr");
        var idCell = doc.createElement("td");
        idCell.textContent = r.call_id;
        tr.appendChild(idCell);
        var collCell = doc.createElement("td");
        collCell.textContent = (r.coll_prec !== null && r.coll_prec !== undefined)
          ? fmtRaw(r.coll_raw, r.coll_prec) + " " + r.coll_sym : String(r.coll_raw) + " (" + r.coll_id + ")";
        collCell.title = t("account.raw_prefix", "raw ") + String(r.coll_raw);
        tr.appendChild(collCell);
        var debtCell = doc.createElement("td");
        debtCell.textContent = (r.debt_prec !== null && r.debt_prec !== undefined)
          ? fmtRaw(r.debt_raw, r.debt_prec) + " " + r.debt_sym : String(r.debt_raw) + " (" + r.debt_id + ")";
        debtCell.title = t("account.raw_prefix", "raw ") + String(r.debt_raw);
        tr.appendChild(debtCell);
        var borCell = doc.createElement("td");
        borCell.textContent = r.borrower;
        tr.appendChild(borCell);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      section.appendChild(table);
      var more = doc.createElement("p");
      more.className = "muted";
      more.appendChild(doc.createTextNode(t("account.adjust_or_close_positions_on_the", "Adjust or close positions on the ")));
      var a = doc.createElement("a");
      a.setAttribute("href", "#/borrow");
      a.textContent = t("account.borrow_page", "borrow page");
      more.appendChild(a);
      more.appendChild(doc.createTextNode("."));
      section.appendChild(more);
    }).catch(function (e) {
      section.removeChild(loading);
      showError(doc, section, e, t("account.could_not_load_margin_positions", "Could not load margin positions."));
    });
  }

  /* Credit Management tab (punchlist ADD): offers owned by the viewed
   * account via Credit.offersByOwner (id or name — the chain resolves it).
   * Reference concept only: #1 AccountOverview CreditOfferAccountPage.
   * Table (Offer / Asset / Current / Total / Rate / Enabled) plus a link to
   * the full #/credit-offer desk, where accept/repay live (not rebuilt
   * here). Offer ids link to #/credit-offer/:id detail pages.
   * Proposals tab: DEFERRED by punchlist scope and recorded here so the gap
   * stays visible — per-account proposals already render on #/proposals
   * (router route, global list), linked below, instead of a third new tab
   * in this file. */
  function renderCredit(doc, section, acct) {
    var loading = doc.createElement("p");
    loading.className = "muted";
    loading.textContent = t("account.loading_credit_offers", "Loading credit offers…");
    section.appendChild(loading);
    if (typeof Credit === "undefined" || !Credit || typeof Credit.offersByOwner !== "function") {
      section.removeChild(loading);
      var miss = doc.createElement("p");
      miss.className = "muted";
      miss.textContent = t("account.credit_backend_not_loaded_js_credit_js_missin", "Credit backend not loaded (js/credit.js missing) — offers unavailable.");
      section.appendChild(miss);
      return;
    }
    Promise.resolve().then(function () { return Credit.offersByOwner(acct.id); }).then(function (rows) {
      section.removeChild(loading);
      if (!rows || rows.length === 0) {
        var empty = doc.createElement("p");
        empty.className = "muted";
        empty.textContent = t("account.no_credit_offers_for_this_account", "No credit offers for this account.") + t("account.credit_hint", " Create one from the credit desk (#/credit-offer) — owned offers list here.");
        section.appendChild(empty);
      } else {
        var table = doc.createElement("table");
        table.className = "node-table";
        var thead = doc.createElement("thead");
        var headRow = doc.createElement("tr");
        ["Offer", "Asset", "Current", "Total", "Rate", "Enabled"].forEach(function (label) {
          var th = doc.createElement("th");
          th.textContent = label;
          headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        table.appendChild(thead);
        var tbody = doc.createElement("tbody");
        rows.forEach(function (r) {
          var tr = doc.createElement("tr");
          var idCell = doc.createElement("td");
          var link = doc.createElement("a");
          link.setAttribute("href", "#/credit-offer/" + encodeURIComponent(r.id));
          link.textContent = r.id;
          idCell.appendChild(link);
          tr.appendChild(idCell);
          var symCell = doc.createElement("td");
          symCell.textContent = r.sym || r.asset_id;
          tr.appendChild(symCell);
          var curCell = doc.createElement("td");
          curCell.textContent = (r.prec !== null && r.prec !== undefined)
            ? fmtRaw(r.current_raw, r.prec) : String(r.current_raw);
          curCell.title = t("account.raw_prefix", "raw ") + String(r.current_raw);
          tr.appendChild(curCell);
          var totCell = doc.createElement("td");
          totCell.textContent = (r.prec !== null && r.prec !== undefined)
            ? fmtRaw(r.total_raw, r.prec) : String(r.total_raw);
          totCell.title = t("account.raw_prefix", "raw ") + String(r.total_raw);
          tr.appendChild(totCell);
          var rateCell = doc.createElement("td");
          var rateH = null;
          try {
            if (typeof Credit.rateUnitsToHuman === "function" && typeof r.rate_units === "number") {
              rateH = Credit.rateUnitsToHuman(r.rate_units) + "%";
            }
          } catch (e) { rateH = null; }
          rateCell.textContent = (rateH !== null ? rateH : dashText());
          tr.appendChild(rateCell);
          var enCell = doc.createElement("td");
          enCell.textContent = r.enabled ? "yes" : "no";
          tr.appendChild(enCell);
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        section.appendChild(table);
      }
      var more = doc.createElement("p");
      more.className = "muted";
      more.appendChild(doc.createTextNode(t("account.offer_and_deal_flows_live_on_the", "Offer and deal flows live on the ")));
      var a = doc.createElement("a");
      a.setAttribute("href", "#/credit-offer");
      a.textContent = t("account.credit_offers_page", "credit offers page");
      more.appendChild(a);
      more.appendChild(doc.createTextNode(t("account.account_proposals_render_on_the", "; account proposals render on the ")));
      var b = doc.createElement("a");
      b.setAttribute("href", "#/proposals");
      b.textContent = t("account.proposals_page", "proposals page");
      more.appendChild(b);
      more.appendChild(doc.createTextNode(t("account.no_per_account_proposals_tab_here_deferred", " (no per-account proposals tab here — deferred).")));
      section.appendChild(more);
    }).catch(function (e) {
      section.removeChild(loading);
      showError(doc, section, e, t("account.could_not_load_credit_offers", "Could not load credit offers."));
    });
  }
  AccountUI._membership.renderMargin = renderMargin;
  AccountUI._membership.renderCredit = renderCredit;
  AccountUI._membership.renderMembership = renderMembership;
  if (typeof globalThis !== "undefined") { globalThis.AccountUI = AccountUI; }
})();

if (typeof module !== "undefined") { module.exports = AccountUI; }
