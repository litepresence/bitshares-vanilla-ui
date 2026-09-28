/* AccountUI: public account pages (balances in human terms + op history +
 *   membership + lifetime-member upgrade).
 * Owns: DOM for the /account/:account_name route only (loading, header,
 *   membership section with the op-8 LTM upgrade flow, balances table/cards,
 *   history list, /account/me unlock prompt, errors).
 * Consumes: Account.resolve/balances/history/myAccountId (js/account.js),
 *   Wallet.isUnlocked/unlock/keys (js/wallet.js); Format via Account display
 *   strings (no money math here); the upgrade path additionally consumes
 *   Chain (get_accounts re-read), Tx.fee/buildTx/sign (via Credit.fee/
 *   Credit.sendAndProve + Tx.buildTx), Asset.describe (fee display) —
 *   all guarded at call time, never at load.
 * Globals/side effects: document DOM under the router's root element,
 *   global AccountUI only. The upgrade flow signs + broadcasts one op-8
 *   tx (user-confirmed, never automatic); everything else is read-only.
 * I18n.t (display strings with verbatim en defaults — batch-2a i18n).
 * Created by: building-vanilla-slices skill, slice-03 Task 4.
 */
var AccountUI = (function () {
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
    return dflt;
  }

  /* Slice-16 (F1b): per-account last-seen history first-id for the pulled
   * fill/transfer watcher. No global polling state in Notify; the caller
   * persists per-view. First paint is a baseline (never toasts). */
  var _histFirst = {};

  /* Operation type -> i18n key (batch-2a; op 0 reuses transfer.title,
   * byte-identical "Transfer"). OP_LABELS stays the verbatim English
   * source (still exported); opLabel() resolves through t() at render
   * time so locale switches apply without a reload. */
  var OP_KEYS = {
    0: "transfer.title",
    1: "account.op_limit_create",
    2: "account.op_limit_cancel",
    3: "account.op_call_update",
    4: "account.op_fill",
    5: "account.op_account_create",
    6: "account.op_account_update",
    7: "account.op_whitelist",
    8: "account.op_upgrade",
    9: "account.op_account_transfer",
    10: "account.op_asset_create"
  };

  /* Operation type -> human label (spec verbatim, 0..10). The values are
   * the t() enDefaults (see OP_KEYS); the object stays exported raw. */
  var OP_LABELS = {
    0: "Transfer",
    1: "Limit order create",
    2: "Limit order cancel",
    3: "Call order update",
    4: "Fill order",
    5: "Account create",
    6: "Account update",
    7: "Account whitelist",
    8: "Account upgrade",
    9: "Account transfer",
    10: "Asset create"
  };

  /* Clear all children of the router root. */
  function clearRoot(root) {
    while (root.firstChild) root.removeChild(root.firstChild);
  }

  /* New .wrap container appended to root. Wide (viewport-gaps fix
   * 2026-09-28): full-bleed stacked grid ≥1200px instead of the 720px
   * stranded column; children span full width via app.css .wide contract. */
  function makeWrap(doc, root) {
    var wrap = doc.createElement("div");
    wrap.className = "wrap wide";
    root.appendChild(wrap);
    return wrap;
  }

  /* Inline error line (aria-live so screen readers announce failures). */
  function makeError(doc) {
    var err = doc.createElement("div");
    err.className = "error";
    err.setAttribute("aria-live", "polite");
    return err;
  }

  /* Show an inline error panel that is never blank: any thrown value maps
   * to a human sentence; unknown shapes fall back to a generic message. */
  function showError(doc, wrap, e, fallback) {
    var err = makeError(doc);
    var msg = (e && typeof e.message === "string" && e.message)
      ? e.message
      : String(e || fallback || t("transfer.err_unexpected", "Unexpected error"));
    if (msg.indexOf("unknown-account") !== -1) {
      msg = fallback || t("transfer.unknown_account", "Unknown account.");
    } else if (msg.indexOf("no-account") !== -1) {
      msg = t("transfer.err_no_account", "No on-chain account found for the wallet's active key.");
    } else if (msg.indexOf("history-unavailable") !== -1) {
      msg = t("account.err_history", "History unavailable on this node.");
    } else if (msg.indexOf("bad-asset-shape") !== -1) {
      msg = t("account.err_asset_shape", "Unexpected asset data from the node; stopped instead of guessing.");
    } else if (msg.indexOf("wallet-locked") !== -1) {
      msg = t("transfer.err_locked", "Wallet is locked.");
    }
    err.textContent = msg;
    wrap.appendChild(err);
  }

  /* Extract the numeric op type from a get_account_history row, or null
   * when the shape is unrecognized (caller falls back to a generic label). */
  function opTypeOf(row) {
    if (!row || typeof row !== "object") return null;
    if (Array.isArray(row.op) && typeof row.op[0] === "number") return row.op[0];
    if (typeof row.op_type === "number") return row.op_type;
    if (typeof row.type === "number") return row.type;
    return null;
  }

  /* Human label for an op type number; unknown numbers stay identifiable. */
  function opLabel(n) {
    if (typeof n === "number" && Object.prototype.hasOwnProperty.call(OP_LABELS, n)) {
      return t(OP_KEYS[n], OP_LABELS[n]);
    }
    return t("account.op_unknown", "Operation #%(n)s", {n: String(n)});
  }

  /* Best-effort time text for a history row: chain timestamp when present,
   * else the block number, else the row id. Never blank, never computed. */
  function timeText(row) {
    if (row.timestamp) return String(row.timestamp);
    if (row.time) return String(row.time);
    if (row.block_time) return String(row.block_time);
    if (row.block_num !== undefined && row.block_num !== null) {
      return t("account.block_prefix", "block #") + String(row.block_num);
    }
    if (row.id) return String(row.id);
    return t("settings.dash", "—");
  }

  /* Balances section: Asset | Balance table plus a card list that the
   * existing .node-table/.node-cards CSS swaps under 560px. Balance cells
   * show the preformatted display string; the raw integer lives in title. */
  function renderBalances(doc, section, list) {
    if (!list || list.length === 0) {
      var empty = doc.createElement("p");
      empty.className = "muted";
      empty.textContent = t("account.s1", "No balances.");
      section.appendChild(empty);
      return;
    }
    var table = doc.createElement("table");
    table.className = "node-table";
    var thead = doc.createElement("thead");
    var headRow = doc.createElement("tr");
    var balHeaders = [t("account.asset_th", "Asset"), t("account.balance_th", "Balance")];
    balHeaders.forEach(function (label) {
      var th = doc.createElement("th");
      th.textContent = label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = doc.createElement("tbody");
    list.forEach(function (b) {
      var tr = doc.createElement("tr");
      var assetCell = doc.createElement("td");
      assetCell.textContent = b.symbol;
      tr.appendChild(assetCell);
      var balCell = doc.createElement("td");
      balCell.textContent = b.display;
      balCell.title = b.raw;
      tr.appendChild(balCell);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    section.appendChild(table);

    var cards = doc.createElement("div");
    cards.className = "node-cards";
    list.forEach(function (b) {
      var card = doc.createElement("div");
      card.className = "node-card";
      var name = doc.createElement("div");
      name.textContent = b.symbol;
      card.appendChild(name);
      var bal = doc.createElement("div");
      bal.textContent = b.display;
      bal.title = b.raw;
      card.appendChild(bal);
      cards.appendChild(card);
    });
    section.appendChild(cards);
    var detBal = doc.createElement("details");
    detBal.className = "raw";
    var sumBal = doc.createElement("summary");
    sumBal.setAttribute("aria-label", t("account.bal_json_label", "Show raw balances JSON"));
    detBal.appendChild(sumBal);
    var preBal = doc.createElement("pre");
    try { preBal.textContent = JSON.stringify(list, null, 2); }
    catch (e) { preBal.textContent = String(list); }
    detBal.appendChild(preBal);
    section.appendChild(detBal);
  }

  /* Open-orders section: table + phone cards, same patterns as balances.
   * Read-only by design (cancel lives on the market desk). Each row shows
   * what the order sells, what it asks at what price, plus id/expiration. */
  function renderOpenOrders(doc, section, orders) {
    if (!orders || orders.length === 0) {
      var empty = doc.createElement("p");
      empty.className = "muted";
      empty.textContent = t("account.s2", "No open orders.");
      section.appendChild(empty);
      return;
    }
    var table = doc.createElement("table");
    table.className = "node-table";
    var thead = doc.createElement("thead");
    var headRow = doc.createElement("tr");
    [t("account.sell_th", "Sell"), t("account.buy_th", "Buy"), t("account.price_th", "Price"), t("account.order_th", "Order")].forEach(function (label) {
      var th = doc.createElement("th");
      th.textContent = label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);
    var tbody = doc.createElement("tbody");
    orders.forEach(function (o) {
      var tr = doc.createElement("tr");
      var sellCell = doc.createElement("td");
      sellCell.textContent = o.sell.display + " " + o.sell.symbol;
      sellCell.title = o.sell.raw;
      tr.appendChild(sellCell);
      var buyCell = doc.createElement("td");
      buyCell.textContent = o.buy.display + " " + o.buy.symbol;
      buyCell.title = o.buy.raw;
      tr.appendChild(buyCell);
      var priceCell = doc.createElement("td");
      priceCell.textContent = o.priceDisplay;
      tr.appendChild(priceCell);
      var idCell = doc.createElement("td");
      idCell.textContent = o.id;
      tr.appendChild(idCell);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    section.appendChild(table);

    var cards = doc.createElement("div");
    cards.className = "node-cards";
    orders.forEach(function (o) {
      var card = doc.createElement("div");
      card.className = "node-card";
      var line = doc.createElement("div");
      line.textContent = t("account.sell_prefix", "Sell ") + o.sell.display + " " + o.sell.symbol +
        t("account.for_mid", " for ") + o.buy.display + " " + o.buy.symbol;
      card.appendChild(line);
      var meta = doc.createElement("div");
      meta.className = "muted";
      meta.textContent = o.id + " @ " + o.priceDisplay;
      card.appendChild(meta);
      cards.appendChild(card);
    });
    section.appendChild(cards);
    var detOrd = doc.createElement("details");
    detOrd.className = "raw";
    var sumOrd = doc.createElement("summary");
    sumOrd.setAttribute("aria-label", t("account.orders_json_label", "Show raw orders JSON"));
    detOrd.appendChild(sumOrd);
    var preOrd = doc.createElement("pre");
    try { preOrd.textContent = JSON.stringify(orders, null, 2); }
    catch (e) { preOrd.textContent = String(orders); }
    detOrd.appendChild(preOrd);
    section.appendChild(detOrd);
  }

  /* History section: one row per op (time + label + raw JSON details).
   * Plain list (no table) so it is readable from 360px to 4K as-is. */
  function renderHistory(doc, section, rows) {
    if (!rows || rows.length === 0) {
      var empty = doc.createElement("p");
      empty.className = "muted";
      empty.textContent = t("account.s3", "No recent activity.");
      section.appendChild(empty);
      return;
    }
    var ul = doc.createElement("ul");
    rows.forEach(function (row) {
      var li = doc.createElement("li");
      var n = opTypeOf(row);
      var head = doc.createElement("div");
      head.textContent = timeText(row) + " — " +
        (n === null ? t("account.unknown_operation", "Unknown operation") : opLabel(n));
      li.appendChild(head);
      var details = doc.createElement("details");
      details.className = "raw";
      var summary = doc.createElement("summary");
      summary.setAttribute("aria-label", t("account.op_json_label", "Show raw operation JSON"));
      details.appendChild(summary);
      var pre = doc.createElement("pre");
      try {
        pre.textContent = JSON.stringify(row);
      } catch (e) {
        pre.textContent = String(row);
      }
      details.appendChild(pre);
      li.appendChild(details);
      ul.appendChild(li);
    });
    section.appendChild(ul);
  }

  /* Unlock prompt for /account/me while locked: password + button; on
   * success re-renders #/account/me so the user lands back where asked. */
  function renderUnlockPrompt(doc, wrap, root) {
    var h1 = doc.createElement("h1");
    h1.textContent = t("account.s4", "My Account");
    wrap.appendChild(h1);
    var hint = doc.createElement("p");
    hint.textContent = t("account.s5", "Wallet is locked. Enter your password to view your account.");
    wrap.appendChild(hint);
    var label = doc.createElement("label");
    label.appendChild(doc.createTextNode(t("account.password_label", "Password ")));
    var input = doc.createElement("input");
    input.id = "acct-unlock-password";
    input.type = "password";
    input.setAttribute("autocomplete", "current-password");
    label.appendChild(input);
    wrap.appendChild(label);
    var btn = doc.createElement("button");
    btn.id = "acct-unlock-do";
    btn.type = "button";
    btn.textContent = t("account.s6", "Unlock");
    wrap.appendChild(btn);
    var err = makeError(doc);
    wrap.appendChild(err);
    btn.addEventListener("click", function () {
      err.textContent = "";
      btn.disabled = true;
      Promise.resolve()
        .then(function () { return Wallet.unlock(input.value); })
        .then(function () { renderAccount(root, "me"); })
        .catch(function (e) {
          btn.disabled = false;
          var msg = (e && e.message) ? e.message : t("transfer.unlock_failed", "Unlock failed");
          err.textContent = msg;
        });
    });
  }

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
              send.textContent = t("confirm.sign_send", "Sign & Send");
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
                bs.textContent = t("transfer.s1", "Broadcasting…");
                out.appendChild(bs);
                var wif = Wallet.keys && Wallet.keys.active ? Wallet.keys.active.wif : null;
                if (!wif) {
                  out.removeChild(bs);
                  showError(doc, out, new Error("wallet-locked"), t("transfer.err_locked", "Wallet is locked."));
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
                    t("account.upgrade_failed_hint", "Failed. Check state before retrying (do NOT blindly rebroadcast)."));
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

  /* Fill an account page: header (name + id), then balances and history
   * sections that each fail inline (never blank, never wiping the other). */
  function showAccount(doc, wrap, root, acct) {
    var h1 = doc.createElement("h1");
    h1.textContent = acct.name;
    wrap.appendChild(h1);
    var sub = doc.createElement("p");
    sub.className = "muted";
    sub.textContent = acct.id;
    wrap.appendChild(sub);

    var memSection = doc.createElement("section");
    var memH = doc.createElement("h2");
    memH.textContent = t("account.membership", "Membership");
    memSection.appendChild(memH);
    wrap.appendChild(memSection);
    renderMembership(doc, memSection, acct);

    var balSection = doc.createElement("section");
    var balH = doc.createElement("h2");
    balH.textContent = t("account.s7", "Balances");
    balSection.appendChild(balH);
    var balLoading = doc.createElement("p");
    balLoading.className = "muted";
    balLoading.textContent = t("account.loading_balances", "Loading balances…");
    balSection.appendChild(balLoading);
    wrap.appendChild(balSection);

    var ordSection = doc.createElement("section");
    var ordH = doc.createElement("h2");
    ordH.textContent = t("account.orders_title", "Open orders");
    ordSection.appendChild(ordH);
    var ordLoading = doc.createElement("p");
    ordLoading.className = "muted";
    ordLoading.textContent = t("account.loading_orders", "Loading open orders…");
    ordSection.appendChild(ordLoading);
    wrap.appendChild(ordSection);

    var histSection = doc.createElement("section");
    var histH = doc.createElement("h2");
    histH.textContent = t("account.history_title", "History");
    histSection.appendChild(histH);
    var histLoading = doc.createElement("p");
    histLoading.className = "muted";
    histLoading.textContent = t("account.loading_history", "Loading history…");
    histSection.appendChild(histLoading);
    wrap.appendChild(histSection);

    Account.balances(acct.id).then(function (list) {
      balSection.removeChild(balLoading);
      renderBalances(doc, balSection, list);
    }).catch(function (e) {
      balSection.removeChild(balLoading);
      showError(doc, balSection, e, t("account.load_balances_failed", "Could not load balances."));
    });

    Account.history(acct.id, 20).then(function (rows) {
      histSection.removeChild(histLoading);
      renderHistory(doc, histSection, rows);
      /* Slice-16 (F1b): pulled history watcher on the existing fetch.
       * First-entry diff per plan; a notify fault never breaks history. */
      try {
        if (typeof NotifyHost !== "undefined" && NotifyHost &&
            typeof NotifyHost.mountToasts === "function") {
          try { NotifyHost.mountToasts(); } catch (e) { /* host best-effort */ }
        }
        if (typeof NotifyRules !== "undefined" && NotifyRules &&
            typeof NotifyRules.checkHistory === "function") {
          try {
            var prev = Object.prototype.hasOwnProperty.call(_histFirst, acct.id)
              ? _histFirst[acct.id] : null;
            var res = NotifyRules.checkHistory(prev, rows, { watchAccounts: [acct.id] });
            if (res && res.firstId !== undefined && res.firstId !== null) {
              _histFirst[acct.id] = String(res.firstId);
            }
          } catch (e) { /* watcher sleeps, never breaks the view */ }
        }
      } catch (e) { /* notify optional here */ }
    }).catch(function (e) {
      histSection.removeChild(histLoading);
      showError(doc, histSection, e, t("account.err_history", "History unavailable on this node."));
    });

    /* Public read: any account's open orders render with NO login (#1 shows
     * them for every viewed account; only cancel requires ownership, and
     * cancel lives on the market desk — no cancel buttons here by design). */
    Account.openOrders(acct.id).then(function (orders) {
      ordSection.removeChild(ordLoading);
      renderOpenOrders(doc, ordSection, orders);
    }).catch(function (e) {
      ordSection.removeChild(ordLoading);
      showError(doc, ordSection, e, t("account.load_orders_failed", "Could not load open orders."));
    });
  }

  /* Route entry: renderAccount(root, name). Name "me" resolves through the
   * wallet keystore (unlock prompt when locked); anything else resolves as
   * a public account name or 1.2.N id. Unknown accounts render an inline
   * error panel, never a blank page. */
  function renderAccount(root, name) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    clearRoot(root);
    var wrap = makeWrap(doc, root);

    if (typeof Account === "undefined" || !Account) {
      showError(doc, wrap, t("account.backend_missing_account", "Account backend missing: js/account.js failed to load."));
      return;
    }
    if (typeof name !== "string" || !name) {
      showError(doc, wrap, "unknown-account", t("transfer.unknown_account", "Unknown account."));
      return;
    }

    /* Wait for the shared connection before any chain read: deep links land
     * before boot finishes connecting. Re-renders once on open; times out
     * into the normal error panel. Guards against route changes mid-wait.
     * (Pattern for all future data pages: never read on a cold socket.) */
    var hashAtEntry = (typeof location !== "undefined" && location.hash) || "";
    if (typeof Chain !== "undefined" && Chain && typeof Chain.status === "function" &&
        Chain.status().state !== "open") {
      var waiting = doc.createElement("p");
      waiting.className = "muted";
      waiting.textContent = t("transfer.connecting", "Connecting to network…");
      wrap.appendChild(waiting);
      var settled = false;
      var off = Store.subscribe("connection", function (st) {
        if (settled) return;
        if (st && st.state === "open") {
          settled = true; off(); clearTimeout(timer);
          if (typeof location === "undefined" || location.hash === hashAtEntry) renderAccount(root, name);
        }
      });
      var timer = setTimeout(function () {
        if (settled) return; settled = true; off();
        if (typeof location !== "undefined" && location.hash !== hashAtEntry) return;
        clearRoot(root);
        var failed = makeWrap(doc, root);
        showError(doc, failed, new Error("not connected"), t("transfer.network_unavailable_short", "Network unavailable."));
      }, 15000);
      return;
    }

    if (name === "me") {
      if (typeof Wallet === "undefined" || !Wallet ||
          typeof Wallet.isUnlocked !== "function" || !Wallet.isUnlocked()) {
        renderUnlockPrompt(doc, wrap, root);
        return;
      }
      var loading = doc.createElement("p");
      loading.className = "muted";
      loading.textContent = t("transfer.loading", "Loading…");
      wrap.appendChild(loading);
      Account.myAccountId().then(function (id) {
        return Account.resolve(id);
      }).then(function (acct) {
        clearRoot(root);
        showAccount(doc, makeWrap(doc, root), root, acct);
      }).catch(function (e) {
        clearRoot(root);
        var retry = makeWrap(doc, root);
        var h1 = doc.createElement("h1");
        h1.textContent = t("account.s4", "My Account");
        retry.appendChild(h1);
        showError(doc, retry, e, t("transfer.load_account_failed", "Could not load your account."));
      });
      return;
    }

    var loadingPub = doc.createElement("p");
    loadingPub.className = "muted";
    loadingPub.textContent = t("transfer.loading", "Loading…");
    wrap.appendChild(loadingPub);
    Account.resolve(name).then(function (acct) {
      clearRoot(root);
      showAccount(doc, makeWrap(doc, root), root, acct);
    }).catch(function (e) {
      clearRoot(root);
      var failed = makeWrap(doc, root);
      showError(doc, failed, e, t("transfer.unknown_account_name", "Unknown account: %(name)s.", {name: name}));
    });
  }

  return {
    renderAccount: renderAccount,
    OP_LABELS: OP_LABELS
  };
})();

if (typeof module !== "undefined") { module.exports = AccountUI; }
