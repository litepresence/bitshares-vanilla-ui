/* AccountUI: public account pages (balances in human terms + op history).
 * Owns: DOM for the /account/:account_name route only (loading, header,
 *   balances table/cards, history list, /account/me unlock prompt, errors).
 * Consumes: Account.resolve/balances/history/myAccountId (js/account.js),
 *   Wallet.isUnlocked/unlock (js/wallet.js); Format via Account display
 *   strings (no money math here); Store owns settings/connection outside
 *   this view (not read here, keeping the slice read-only).
 * Globals/side effects: document DOM under the router's root element,
 *   global AccountUI only. No network, no storage, no signing.
 * Created by: building-vanilla-slices skill, slice-03 Task 4.
 */
var AccountUI = (function () {
  "use strict";

  /* Operation type -> human label (spec verbatim, 0..10). */
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

  /* New .wrap container appended to root. */
  function makeWrap(doc, root) {
    var wrap = doc.createElement("div");
    wrap.className = "wrap";
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
      : String(e || fallback || "Unexpected error");
    if (msg.indexOf("unknown-account") !== -1) {
      msg = fallback || "Unknown account.";
    } else if (msg.indexOf("no-account") !== -1) {
      msg = "No on-chain account found for the wallet's active key.";
    } else if (msg.indexOf("history-unavailable") !== -1) {
      msg = "History unavailable on this node.";
    } else if (msg.indexOf("bad-asset-shape") !== -1) {
      msg = "Unexpected asset data from the node; stopped instead of guessing.";
    } else if (msg.indexOf("wallet-locked") !== -1) {
      msg = "Wallet is locked.";
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
      return OP_LABELS[n];
    }
    return "Operation #" + String(n);
  }

  /* Best-effort time text for a history row: chain timestamp when present,
   * else the block number, else the row id. Never blank, never computed. */
  function timeText(row) {
    if (row.timestamp) return String(row.timestamp);
    if (row.time) return String(row.time);
    if (row.block_time) return String(row.block_time);
    if (row.block_num !== undefined && row.block_num !== null) {
      return "block #" + String(row.block_num);
    }
    if (row.id) return String(row.id);
    return "—";
  }

  /* Balances section: Asset | Balance table plus a card list that the
   * existing .node-table/.node-cards CSS swaps under 560px. Balance cells
   * show the preformatted display string; the raw integer lives in title. */
  function renderBalances(doc, section, list) {
    if (!list || list.length === 0) {
      var empty = doc.createElement("p");
      empty.className = "muted";
      empty.textContent = "No balances.";
      section.appendChild(empty);
      return;
    }
    var table = doc.createElement("table");
    table.className = "node-table";
    var thead = doc.createElement("thead");
    var headRow = doc.createElement("tr");
    ["Asset", "Balance"].forEach(function (t) {
      var th = doc.createElement("th");
      th.textContent = t;
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
    sumBal.setAttribute("aria-label", "Show raw balances JSON");
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
      empty.textContent = "No open orders.";
      section.appendChild(empty);
      return;
    }
    var table = doc.createElement("table");
    table.className = "node-table";
    var thead = doc.createElement("thead");
    var headRow = doc.createElement("tr");
    ["Sell", "Buy", "Price", "Order"].forEach(function (t) {
      var th = doc.createElement("th");
      th.textContent = t;
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
      line.textContent = "Sell " + o.sell.display + " " + o.sell.symbol +
        " for " + o.buy.display + " " + o.buy.symbol;
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
    sumOrd.setAttribute("aria-label", "Show raw orders JSON");
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
      empty.textContent = "No recent activity.";
      section.appendChild(empty);
      return;
    }
    var ul = doc.createElement("ul");
    rows.forEach(function (row) {
      var li = doc.createElement("li");
      var n = opTypeOf(row);
      var head = doc.createElement("div");
      head.textContent = timeText(row) + " — " +
        (n === null ? "Unknown operation" : opLabel(n));
      li.appendChild(head);
      var details = doc.createElement("details");
      details.className = "raw";
      var summary = doc.createElement("summary");
      summary.setAttribute("aria-label", "Show raw operation JSON");
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
    h1.textContent = "My Account";
    wrap.appendChild(h1);
    var hint = doc.createElement("p");
    hint.textContent = "Wallet is locked. Enter your password to view your account.";
    wrap.appendChild(hint);
    var label = doc.createElement("label");
    label.appendChild(doc.createTextNode("Password "));
    var input = doc.createElement("input");
    input.id = "acct-unlock-password";
    input.type = "password";
    input.setAttribute("autocomplete", "current-password");
    label.appendChild(input);
    wrap.appendChild(label);
    var btn = doc.createElement("button");
    btn.id = "acct-unlock-do";
    btn.type = "button";
    btn.textContent = "Unlock";
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
          var msg = (e && e.message) ? e.message : String(e || "Unlock failed");
          err.textContent = msg;
        });
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

    var balSection = doc.createElement("section");
    var balH = doc.createElement("h2");
    balH.textContent = "Balances";
    balSection.appendChild(balH);
    var balLoading = doc.createElement("p");
    balLoading.className = "muted";
    balLoading.textContent = "Loading balances…";
    balSection.appendChild(balLoading);
    wrap.appendChild(balSection);

    var ordSection = doc.createElement("section");
    var ordH = doc.createElement("h2");
    ordH.textContent = "Open orders";
    ordSection.appendChild(ordH);
    var ordLoading = doc.createElement("p");
    ordLoading.className = "muted";
    ordLoading.textContent = "Loading open orders…";
    ordSection.appendChild(ordLoading);
    wrap.appendChild(ordSection);

    var histSection = doc.createElement("section");
    var histH = doc.createElement("h2");
    histH.textContent = "History";
    histSection.appendChild(histH);
    var histLoading = doc.createElement("p");
    histLoading.className = "muted";
    histLoading.textContent = "Loading history…";
    histSection.appendChild(histLoading);
    wrap.appendChild(histSection);

    Account.balances(acct.id).then(function (list) {
      balSection.removeChild(balLoading);
      renderBalances(doc, balSection, list);
    }).catch(function (e) {
      balSection.removeChild(balLoading);
      showError(doc, balSection, e, "Could not load balances.");
    });

    Account.history(acct.id, 20).then(function (rows) {
      histSection.removeChild(histLoading);
      renderHistory(doc, histSection, rows);
    }).catch(function (e) {
      histSection.removeChild(histLoading);
      showError(doc, histSection, e, "History unavailable on this node.");
    });

    /* Public read: any account's open orders render with NO login (#1 shows
     * them for every viewed account; only cancel requires ownership, and
     * cancel lives on the market desk — no cancel buttons here by design). */
    Account.openOrders(acct.id).then(function (orders) {
      ordSection.removeChild(ordLoading);
      renderOpenOrders(doc, ordSection, orders);
    }).catch(function (e) {
      ordSection.removeChild(ordLoading);
      showError(doc, ordSection, e, "Could not load open orders.");
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
      showError(doc, wrap, "Account backend missing: js/account.js failed to load.");
      return;
    }
    if (typeof name !== "string" || !name) {
      showError(doc, wrap, "unknown-account", "Unknown account.");
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
      waiting.textContent = "Connecting to network…";
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
        showError(doc, failed, new Error("not connected"), "Network unavailable.");
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
      loading.textContent = "Loading…";
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
        h1.textContent = "My Account";
        retry.appendChild(h1);
        showError(doc, retry, e, "Could not load your account.");
      });
      return;
    }

    var loadingPub = doc.createElement("p");
    loadingPub.className = "muted";
    loadingPub.textContent = "Loading…";
    wrap.appendChild(loadingPub);
    Account.resolve(name).then(function (acct) {
      clearRoot(root);
      showAccount(doc, makeWrap(doc, root), root, acct);
    }).catch(function (e) {
      clearRoot(root);
      var failed = makeWrap(doc, root);
      showError(doc, failed, e, "Unknown account: " + name + ".");
    });
  }

  return {
    renderAccount: renderAccount,
    OP_LABELS: OP_LABELS
  };
})();

if (typeof module !== "undefined") { module.exports = AccountUI; }
