/* debit-ui.js — #/direct-debit + #/spotlight views (withdraw permissions + grid).
 * Owns: giver/recipient tables, create/update/claim/delete forms with
 * NAMED-row confirms, the spotlight tile grid, and the recurring-orders
 * helper. Reads/builders stay in htlc.js; DOM scaffolding comes from
 * HtlcUI._ui (htlc-ui.js loads first). WIFs are JS values, never DOM.
 * Side effects: DOM under the router root; global DebitUI only. Generation
 * counter drops stale async work on teardown (router reuses #view).
 * Created by: building-vanilla-slices skill, slice-11-htlc plan Task 3.
 * CHAIN TRUTH (#4 wins): op 25 create / 26 update (TRAP: period_start_time
 * serializes BEFORE periods_until_expiration) / 27 claim (payer = CLAIMANT
 * withdraw_to_account) / 28 delete (fee 0, free cancel). Claim memo is
 * PLAINTEXT v1 with an inline warning. Spotlight is #1's ShowcaseGrid (NO
 * chain op); recurring = N user-triggered op-1 placements NOW, one tx per
 * order, each with its own confirm (page-closed = nothing placed). Recurring
 * builds op-1 pairs from Tx.OP locally — TradeUI exposes no builder, so no
 * serializer/signer line is duplicated (serializers stay in tx.js).
 */
var DebitUI = (function () {
  "use strict";
  var gen = 0;
  function U() { /* shared helpers live in htlc-ui.js; missing file -> named error */
    if (typeof HtlcUI === "undefined" || !HtlcUI._ui) throw new Error("HTLC backend missing: htlc-ui.js failed to load.");
    return HtlcUI._ui;
  }
  function usedPct(claimedRaw, limitRaw) { /* claimed share of limit as "xx.xx%" (integer math, no float) */
    var lim = BigInt(limitRaw);
    if (lim <= 0n) return "—";
    var s = (BigInt(claimedRaw) * 10000n / lim).toString();
    while (s.length < 3) s = "0" + s;
    return s.slice(0, -2) + "." + s.slice(-2) + "%";
  }
  function findRow(lists, permId) {
    return lists.asGiver.concat(lists.asRecipient).find(function (r) { return r.id === permId; }) || null;
  }
  /* Route entry: #/direct-debit — giver + recipient tables + action forms. */
  function renderDirectDebit(root) {
    if (!root) return;
    var u = U(), retry = function () { renderDirectDebit(root); };
    var ctx = u.routeReady(root, "Direct Debit", retry);
    if (!ctx) return;
    var doc = ctx.doc, htlcGen = ctx.myGen, myGen = ++gen;
    /* TWO counters (slice-10 F3 precedent): htlcGen (HtlcUI's) goes to the shared
     * _ui helpers, which check it against HtlcUI's live gen internally; myGen
     * (DebitUI's own) guards this file's continuations. Comparing ctx.myGen
     * against DebitUI's gen stuck the page on "Loading permissions…" forever. */
    ctx.wrap.appendChild(u.el(doc, "p", "Loading permissions…", "muted"));
    u.loadAccount(htlcGen, function (me) { return Htlc.permissions(me.id); }).then(function (found) {
      if (!found || myGen !== gen) return;
      root.innerHTML = "";
      var box = u.el(doc, "div", null, "wrap"); root.appendChild(box);
      box.appendChild(u.el(doc, "h1", "Direct Debit"));
      box.appendChild(u.el(doc, "p", "Recurring withdrawal rights you granted or received.", "muted"));
      box.appendChild(u.el(doc, "h2", "Granted by you (" + found.data.asGiver.length + ")"));
      box.appendChild(permTable(u, doc, found.data.asGiver, "giver"));
      box.appendChild(u.el(doc, "h2", "Granted to you (" + found.data.asRecipient.length + ")"));
      box.appendChild(permTable(u, doc, found.data.asRecipient, "recipient"));
      box.appendChild(u.el(doc, "h2", "New / update permission"));
      createUpdateBox(u, doc, box, found.me, found.data, htlcGen);
      box.appendChild(u.el(doc, "h2", "Claim / delete"));
      rowActionBox(u, doc, box, found.me, found.data, htlcGen);
    }).catch(function (e) {
      if (myGen !== gen) return; u.routeFail(root, "Direct Debit", e, "Could not load permissions.", retry); });
  }
  function permTable(u, doc, rows, side) { /* limit/claimed/available human, period human, status */
    if (!rows.length) return u.el(doc, "p", side === "giver" ? "You granted no permissions." : "No permissions granted to you.", "muted");
    var table = doc.createElement("table"); table.className = "node-table";
    table.appendChild(u.tableHead(doc, ["Permission", side === "giver" ? "Authorized" : "Giver",
      "Limit", "Used", "Available", "Period", "Status"]));
    var tbody = doc.createElement("tbody");
    rows.forEach(function (r) {
      var l = u.amtText(r.limit_raw, r.asset_id, r.precision), period, tr = doc.createElement("tr");
      var limCell = u.el(doc, "td", l.text); limCell.title = "raw " + l.raw;
      try { period = Htlc.formatDuration(r.period_sec); } catch (e) { period = String(r.period_sec) + " s"; }
      tr.appendChild(u.el(doc, "td", r.id));
      tr.appendChild(u.el(doc, "td", side === "giver" ? r.to_id : r.from_id));
      tr.appendChild(limCell);
      tr.appendChild(u.el(doc, "td", u.amtText(r.claimed_raw, r.asset_id, r.precision).text + " (" + usedPct(r.claimed_raw, r.limit_raw) + ")"));
      tr.appendChild(u.el(doc, "td", u.amtText(r.available_raw, r.asset_id, r.precision).text));
      tr.appendChild(u.el(doc, "td", period));
      tr.appendChild(u.el(doc, "td", !r.started ? "not started" : (r.periods_left === 0 ? "expired" : "active")));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); return table;
  }
  function createUpdateBox(u, doc, box, me, lists, myGen) { /* fee RE-READ at review; update gets old→new rows */
    var fPerm = u.field(doc, "Permission id (update only, else blank)", { placeholder: "1.12.N" });
    var fAuth = u.field(doc, "Authorized account", { placeholder: "name or 1.2.N" });
    var fAsset = u.field(doc, "Asset", { value: "BTS" });
    var fLimit = u.field(doc, "Limit per period", { placeholder: "10", inputmode: "decimal" });
    var fCount = u.field(doc, "Period count", { value: "12", inputmode: "numeric" });
    var fStart = u.field(doc, "Start (local time)", {});
    fStart.input.type = "datetime-local";
    [fPerm, fAuth, fAsset, fLimit, fCount, fStart].forEach(function (f) { box.appendChild(f.row); });
    var period = u.secsPicker(doc, u.presets.map(function (p) { return [String(p[1]), p[0]]; }), "Period");
    box.appendChild(period.row);
    u.reviewSection(doc, box, myGen, "Review permission", {
      build: async function () {
        var to = await Account.resolve(fAuth.input.value.trim());
        var asset = await Asset.describe(fAsset.input.value.trim() || "BTS");
        var common = { fromId: me.id, toId: to.id, assetId: asset.id, limitHuman: fLimit.input.value.trim(),
          precision: asset.precision, periodSec: period.secs(),
          periodsCount: parseInt(String(fCount.input.value).trim(), 10),
          startIso: String(fStart.input.value || "").trim().replace(" ", "T").slice(0, 16) };
        var permId = String(fPerm.input.value || "").trim(), pair, old = null;
        if (permId) { pair = Htlc.buildDebitUpdate(Object.assign({ permId: permId }, common)); old = findRow(lists, permId); }
        else pair = Htlc.buildDebitCreate(common);
        var wantId = permId || null, wantLimit = String(pair[1].withdrawal_limit.amount);
        return { pair: pair, fee: await Htlc.fee(pair, "1.3.0"), asset: asset, to: to, old: old, isUpdate: !!permId,
          prove: async function () {
            try {
              var all = await Htlc.permissions(me.id).then(function (l) { return l.asGiver.concat(l.asRecipient); });
              if (wantId) {
                var row = all.find(function (r) { return r.id === wantId; });
                return (row && String(row.limit_raw) === wantLimit) ? row : null;
              }
              return all.find(function (r) { return r.to_id === to.id && String(r.limit_raw) === wantLimit; }) || null;
            } catch (e) { return null; }
          } };
      },
      rows: function (R, fee) {
        var opData = R.pair[1], limitHuman, periodHuman, startHuman;
        try { limitHuman = Format.formatAmount(opData.withdrawal_limit.amount, R.asset.precision) + " " + R.asset.symbol; }
        catch (e) { limitHuman = String(opData.withdrawal_limit.amount); }
        try { periodHuman = Htlc.formatDuration(opData.withdrawal_period_sec) + " (" + opData.withdrawal_period_sec + " s)"; }
        catch (e) { periodHuman = String(opData.withdrawal_period_sec) + " s"; }
        try { startHuman = Htlc.formatDateTime(opData.period_start_time); } catch (e) { startHuman = opData.period_start_time; }
        var rows = [["From (giver)", me.name + " (" + me.id + ")"], ["Authorized", R.to.name + " (" + R.to.id + ")"],
          ["Limit per period", limitHuman, "raw " + opData.withdrawal_limit.amount], ["Period", periodHuman],
          ["Period count", String(opData.periods_until_expiration)], ["Start", startHuman], ["Fee", fee.text, "raw " + fee.raw]];
        if (R.isUpdate) {
          rows.unshift(["Permission", opData.permission_to_update]);
          if (R.old) rows.push(["Limit change", u.amtText(R.old.limit_raw, R.old.asset_id, R.old.precision).text + " → " + limitHuman,
            "raw " + R.old.limit_raw + " → " + opData.withdrawal_limit.amount]);
        }
        rows.push(["Network", "testnet"]);
        return rows;
      },
      title: "Confirm permission", ok: function (R) { return R.isUpdate ? "Permission updated." : "Permission created."; },
      fail: "Could not prepare the permission." });
  }
  function rowActionBox(u, doc, box, me, lists, myGen) { /* claim (≤ available + plaintext-memo warning) + delete (fee 0) */
    var fPerm = u.field(doc, "Permission id", { placeholder: "1.12.N" });
    var fAmount = u.field(doc, "Claim amount (claim only)", { placeholder: "1.0", inputmode: "decimal" });
    var fMemo = u.field(doc, "Claim memo, optional (claim only)", { placeholder: "stored in PLAINTEXT" });
    [fPerm, fAmount, fMemo].forEach(function (f) { box.appendChild(f.row); });
    box.appendChild(u.el(doc, "p", "Claim memos are plaintext on-chain in v1 — never put secrets in one.", "muted"));
    u.reviewSection(doc, box, myGen, "Review claim", {
      build: async function () {
        var idText = String(fPerm.input.value || "").trim();
        var row = findRow(lists, idText);
        if (!row) throw new Error("Unknown permission id: " + idText);
        var asset = await Asset.describe(row.asset_id);
        var amountText = fAmount.input.value.trim(), raw = Format.parseAmount(amountText, asset.precision);
        Htlc.checkClaim(row, raw);
        var built = await Htlc.buildDebitClaim({ permId: row.id, fromId: row.from_id, toId: row.to_id, assetId: row.asset_id,
          amountHuman: amountText, precision: asset.precision, memoOrNull: String(fMemo.input.value || "") || null });
        var pair = Array.isArray(built) ? built : built.pair;
        var wantAmt = String(pair[1].amount_to_withdraw.amount);
        var amtHuman;
        try { amtHuman = Format.formatAmount(raw, asset.precision) + " " + asset.symbol; } catch (e) { amtHuman = raw; }
        return { pair: pair, fee: await Htlc.fee(pair, "1.3.0"), asset: asset, row: row, amtHuman: amtHuman,
          memoWarning: !Array.isArray(built) && !!built.memoWarning, prove: async function () {
            try {
              var all = await Htlc.permissions(me.id).then(function (l) { return l.asGiver.concat(l.asRecipient); });
              var cur = all.find(function (r) { return r.id === row.id; });
              return (cur && BigInt(cur.claimed_raw) >= BigInt(wantAmt)) ? cur : null;
            } catch (e) { return null; }
          } };
      },
      rows: function (R, fee) {
        var opData = R.pair[1];
        var rows = [["Permission", R.row.id], ["From", R.row.from_id], ["To (claimant, pays fee)", R.row.to_id],
          ["Amount", R.amtHuman, "raw " + opData.amount_to_withdraw.amount],
          ["Available now", u.amtText(R.row.available_raw, R.row.asset_id, R.row.precision).text],
          ["Fee (paid by claimant)", fee.text, "raw " + fee.raw]];
        if (R.memoWarning) rows.push(["Memo warning", "Plaintext on-chain — visible to everyone"]);
        rows.push(["Network", "testnet"]);
        return rows;
      },
      title: "Confirm claim", ok: function (R) { return "Claimed " + R.amtHuman + "."; },
      fail: "Could not prepare the claim." });
    u.reviewSection(doc, box, myGen, "Review delete", {
      build: async function () {
        var idText = String(fPerm.input.value || "").trim();
        var row = findRow(lists, idText);
        if (!row) throw new Error("Unknown permission id: " + idText);
        var pair = Htlc.buildDebitDelete({ permId: row.id, fromId: row.from_id, toId: row.to_id });
        return { pair: pair, fee: await Htlc.fee(pair, "1.3.0"), row: row, prove: async function () {
          try {
            var all = await Htlc.permissions(me.id).then(function (l) { return l.asGiver.concat(l.asRecipient); });
            return !all.find(function (r) { return r.id === row.id; }) ? { gone: true } : null;
          } catch (e) { return null; }
        } };
      },
      rows: function (R, fee) {
        return [["Permission", R.row.id], ["Giver", R.row.from_id], ["Authorized", R.row.to_id],
          ["Fee", fee.text + " (free cancel)", "raw " + fee.raw], ["Network", "testnet"]];
      },
      title: "Confirm delete", ok: function (R) { return "Permission " + R.row.id + " deleted."; },
      fail: "Could not estimate the delete fee." });
  }
  /* Route entry: #/spotlight — tile grid (ShowcaseGrid parity, no chain op).
   * The grid renders WITHOUT unlock (login-gated tiles link out); only the
   * recurring helper needs the wallet. */
  function renderSpotlight(root) {
    if (!root) return;
    var u = U(), doc = root.ownerDocument || document, myGen = ++gen;
    u.dropOpenSubs();
    root.innerHTML = "";
    var wrap = u.el(doc, "div", null, "wrap"); root.appendChild(wrap);
    wrap.appendChild(u.el(doc, "h1", "Spotlight"));
    var miss = u.missingBackends();
    if (miss) { u.showError(doc, wrap, "Spotlight backend missing: " + miss + " failed to load."); return; }
    if (Chain.status().state !== "open") { var sretry = function () { renderSpotlight(root); }; u.offlineBox(doc, wrap, sretry); u.autoRetryOnOpen(myGen, sretry, function () { return myGen === gen; }); return; }
    var tiles = [["HTLC", "Lock funds with a hash + timelock.", "#/htlc", ""], ["Direct Debit", "Recurring withdrawal permissions.", "#/direct-debit", ""],
      ["Borrow", "Margin positions.", "", "Lands in a later slice"], ["Barter", "Two-sided swap offers.", "", "Lands in a later slice"],
      ["Prediction", "Prediction markets.", "", "Lands in a later slice"], ["Instant Trade", "Simple buy/sell view.", "", "Lands in a later slice"]];
    var grid = u.el(doc, "div", null, "spot-grid");
    tiles.forEach(function (t) {
      var card = u.el(doc, "div", null, "spot-card");
      card.appendChild(u.el(doc, "h3", t[0]));
      card.appendChild(u.el(doc, "p", t[1] + (t[3] ? " " + t[3] + "." : ""), "muted"));
      if (t[2]) { var a = u.el(doc, "a", "Open " + t[0]); a.setAttribute("href", t[2]); card.appendChild(a); }
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
    wrap.appendChild(u.el(doc, "h2", "Recurring orders helper"));
    wrap.appendChild(u.el(doc, "p", "Places N limit orders NOW at stepped prices (one transaction per order, " +
      "each with its own confirm). No scheduler runs in a static page: closing the page places nothing further.", "muted"));
    recurringBox(u, doc, wrap, root, myGen);
  }
  function recurringBox(u, doc, wrap, root, myGen) { /* N op-1 orders across [low, high]; per-order confirm */
    var fSell = u.field(doc, "Sell asset", { value: "BTS" });
    var fRecv = u.field(doc, "Receive asset", { value: "USD" });
    var fTotal = u.field(doc, "Total to sell", { placeholder: "10" });
    var fLow = u.field(doc, "Low price (recv per sell)", { placeholder: "0.9" });
    var fHigh = u.field(doc, "High price (recv per sell)", { placeholder: "1.1" });
    var fCount = u.field(doc, "Order count (2–20)", { value: "5" });
    [fSell, fRecv, fTotal, fLow, fHigh, fCount].forEach(function (f) { wrap.appendChild(f.row); });
    var previewBtn = u.touchable(u.el(doc, "button", "Preview recurring orders")); previewBtn.type = "button"; wrap.appendChild(previewBtn);
    var out = u.el(doc, "div", null, "xfer-out"); wrap.appendChild(out);
    previewBtn.addEventListener("click", function () {
      if (myGen !== gen) return;
      u.clearBox(out);
      if (!Wallet.isUnlocked()) { u.unlockBox(doc, out, function () { renderSpotlight(root); }); return; }
      previewBtn.disabled = true;
      u.showStatus(doc, out, "Computing order ladder…");
      Promise.resolve().then(async function () {
        var me = await Account.resolve(await Account.myAccountId());
        var sell = await Asset.describe(fSell.input.value.trim() || "BTS");
        var recv = await Asset.describe(fRecv.input.value.trim() || "USD");
        var n = parseInt(String(fCount.input.value).trim(), 10);
        if (!Number.isInteger(n) || n < 2 || n > 20) throw new Error("Order count must be 2–20.");
        var lowR = Format.parsePriceRatio(fLow.input.value.trim());
        var highR = Format.parsePriceRatio(fHigh.input.value.trim());
        var D = lowR.den * highR.den, lowD = lowR.num * highR.den, highD = highR.num * lowR.den;
        if (highD <= lowD) throw new Error("High price must be above low price.");
        var total = BigInt(Format.parseAmount(fTotal.input.value.trim(), sell.precision));
        if (total <= 0n) throw new Error("Total must be greater than zero.");
        var per = total / BigInt(n);
        if (per <= 0n) throw new Error("Total is too small to split into " + n + " orders.");
        var step = (highD - lowD) / BigInt(n - 1), orders = [], i;
        for (i = 0; i < n; i++) {
          var priceNum = (i === n - 1) ? highD : lowD + step * BigInt(i);
          var sellRaw = (i === n - 1) ? (total - per * BigInt(n - 1)).toString() : per.toString();
          var recvRaw = (BigInt(sellRaw) * priceNum / D).toString();
          if (!/[1-9]/.test(recvRaw)) throw new Error("Order " + (i + 1) + " receives zero; raise the total.");
          orders.push({ priceNum: priceNum, priceDen: D, sellRaw: sellRaw, recvRaw: recvRaw });
        }
        return { me: me, sell: sell, recv: recv, orders: orders, exp: new Date(Date.now() + 7 * 86400 * 1000).toISOString().slice(0, 19) };
      }).then(function (R) {
        if (myGen !== gen) return;
        u.clearBox(out);
        out.appendChild(u.el(doc, "h3", R.orders.length + " orders: review each, then place"));
        var table = doc.createElement("table"); table.className = "node-table";
        table.appendChild(u.tableHead(doc, ["#", "Sell", "Min receive", "Price", "Status"]));
        var tbody = doc.createElement("tbody");
        R.orders.forEach(function (o, i) {
          var tr = doc.createElement("tr"), cell;
          tr.appendChild(u.el(doc, "td", String(i + 1)));
          cell = u.el(doc, "td", Format.formatAmount(o.sellRaw, R.sell.precision) + " " + R.sell.symbol);
          cell.title = "raw " + o.sellRaw; tr.appendChild(cell);
          cell = u.el(doc, "td", Format.formatAmount(o.recvRaw, R.recv.precision) + " " + R.recv.symbol);
          cell.title = "raw " + o.recvRaw; tr.appendChild(cell);
          tr.appendChild(u.el(doc, "td", Format.formatAmount((o.priceNum * (10n ** 8n) / o.priceDen).toString(), 8)));
          var stCell = u.el(doc, "td", "not placed", "muted"); tr.appendChild(stCell);
          tbody.appendChild(tr);
          var btn = u.touchable(u.el(doc, "button", "Sign & Send #" + (i + 1))); btn.type = "button";
          btn.addEventListener("click", function () {
            if (myGen !== gen) return;
            btn.disabled = true; stCell.textContent = "signing…";
            var wif = Wallet.keys && Wallet.keys.active ? Wallet.keys.active.wif : null;
            if (!wif) { stCell.textContent = "Wallet is locked."; btn.disabled = false; return; }
            var pair = [Tx.OP.limit_order_create, { fee: { amount: 0, asset_id: "1.3.0" }, seller: R.me.id,
              amount_to_sell: { amount: o.sellRaw, asset_id: R.sell.id },
              min_to_receive: { amount: o.recvRaw, asset_id: R.recv.id },
              expiration: R.exp, fill_or_kill: false, extensions: [] }];
            Promise.resolve().then(function () { return Htlc.fee(pair, "1.3.0"); }).then(function () { return Tx.buildTx([pair]); }).then(function (unsigned) {
              stCell.textContent = "broadcasting…";
              return Htlc.sendAndProve(unsigned, wif, async function () {
                try { return (await u.headBlock()) > 0 ? { head: true } : null; } catch (e) { return null; }
              });
            }).then(async function (res) {
              stCell.textContent = "placed (head #" + String(await u.headBlock()) + " via " + res.via + "; verify fills on #/market).";
              stCell.className = "xfer-ok";
            }).catch(function (e) {
              stCell.textContent = "failed: " + String((e && e.message) || e) + " — check state before retrying.";
              stCell.className = "error"; btn.disabled = false;
            });
          });
          var trBtn = doc.createElement("tr"); trBtn.appendChild(u.el(doc, "td", ""));
          var wrapCell = u.el(doc, "td", ""); wrapCell.setAttribute("colspan", "4"); wrapCell.appendChild(btn);
          trBtn.appendChild(wrapCell); tbody.appendChild(trBtn);
        });
        table.appendChild(tbody); out.appendChild(table);
      }).catch(function (e) {
        if (myGen !== gen) return;
        u.clearBox(out); u.showError(doc, out, e, "Could not preview the ladder.");
      }).then(function () { previewBtn.disabled = false; });
    });
  }
  return { renderDirectDebit: renderDirectDebit, renderSpotlight: renderSpotlight };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.DebitUI === "undefined") { globalThis.DebitUI = DebitUI; }
if (typeof module !== "undefined") { module.exports = DebitUI; }
