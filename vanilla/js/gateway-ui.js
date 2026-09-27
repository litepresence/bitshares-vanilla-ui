/* gateway-ui.js — #/deposit-withdraw desk (+ #/deposit-withdraw/:gateway tab link).
 * Owns: four gateway tabs (XBTSX/IOB live-first, GDEX/BIT20 disabled-first),
 *   health dots + status line + Re-check, DEPOSIT/WITHDRAW toggle, coin select
 *   filtered by depositAllowed/withdrawalAllowed, deposit panels (Format-human
 *   facts + copyable address/memo + cached flag + verbatim host errors; NO QR —
 *   #1 uses npm qrcode.react, no zero-dep replacement on disk), withdraw panels
 *   (external address + memo preview + best-effort host check + deep-link prefill
 *   into the slice-4 #/transfer op-0 form, the ONLY signing path — never a forked
 *   confirm), and honest unavailable panels for disabled gateways. Signs nothing,
 *   broadcasts nothing, adds no serializers. Consumes: Gateway, Chain/Store,
 *   Format (money strings only). Exposes global GatewayUI only. Slice-15 Task 2.
 * MONEY (#6): host fee ints stay raw until fmtMoney renders them via Format at the
 *   row precision, labeled gateway-stated; chain fees live in the transfer form only.
 */
var GatewayUI = (function () {
  "use strict";
  var gen = 0;
  var openSubs = [];
  var coinCache = {}; /* session coin lists per gateway id (never persisted) */
  var ORDER = ["XBTSX", "IOB", "GDEX", "BIT20"];
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text; return n;
  }
  function touchable(n) { n.style.minHeight = "44px"; return n; }
  function clearBox(b) { while (b.firstChild) b.removeChild(b.firstChild); }
  /* showError: named Gateway errors -> human text. gateway-rejected stays
   * VERBATIM (the host's own reason — never rewritten, never forged). */
  function showError(doc, box, e, fallback) {
    var m = (e && e.message) ? e.message : String(e || fallback || "Unexpected error");
    if (m.indexOf("gateway-rejected:") === 0) m = "Gateway refused: " + m.slice(18).trim();
    else if (m.indexOf("gateway-down:") === 0) m = "Gateway unreachable (" + m.slice(14).trim() + "). Try Re-check.";
    else if (m.indexOf("disabled:") === 0) m = m.slice(9).trim();
    else if (m.indexOf("bad-account") !== -1) m = "Enter a BitShares account name first.";
    else if (m.indexOf("bad-coin") !== -1) m = "Unknown coin for this gateway.";
    else if (m.indexOf("not-connected") !== -1) m = "Network unavailable. Check Settings → Nodes and retry.";
    var err = el(doc, "div", m, "error"); err.setAttribute("aria-live", "polite"); box.appendChild(err); return err;
  }
  function showStatus(doc, box, text) {
    var p = el(doc, "p", text, "muted"); p.setAttribute("aria-live", "polite"); box.appendChild(p); return p;
  }
  function offlineBox(doc, box, retryFn) {
    box.appendChild(el(doc, "p", "Network unavailable. Check Settings → Nodes and retry.", "muted"));
    var b = touchable(el(doc, "button", "Retry")); b.type = "button";
    b.addEventListener("click", retryFn); box.appendChild(b);
  }
  function dropSubs() { openSubs.forEach(function (off) { try { off(); } catch (e) {} }); openSubs = []; }
  /* autoRetry: sibling pattern (pool-ui.js) — re-run on reconnect only while
   * this render is still current (generation-counter teardown). */
  function autoRetry(myGen, retryFn) {
    try {
      var hashAtEntry = (typeof location !== "undefined" && location.hash) || "", settled = false, off;
      off = Store.subscribe("connection", function (st) {
        if (settled || myGen !== gen) { settled = true; try { off(); } catch (e) {} return; }
        if (st && st.state === "open") { settled = true; try { off(); } catch (e) {}
          if (typeof location === "undefined" || location.hash === hashAtEntry) retryFn(); } });
      openSubs.push(off);
    } catch (e) { /* manual Retry remains */ }
  }
  /* Gate: backend globals + online. NO unlock gate — the desk is reads plus
   * prefill links; #/transfer gates the wallet itself when signing. */
  function routeGate(root, title, retry) {
    var doc = root.ownerDocument || document, myGen = ++gen, miss = null;
    dropSubs(); root.innerHTML = "";
    ["Gateway", "Chain", "Store", "Format"].forEach(function (g) {
      if (typeof globalThis[g] === "undefined") miss = g; });
    var wrap = el(doc, "div", null, "wrap"); root.appendChild(wrap);
    wrap.appendChild(el(doc, "h1", title));
    if (miss) { showError(doc, wrap, title + " backend missing: " + miss + " failed to load."); return null; }
    if (Chain.status().state !== "open") { offlineBox(doc, wrap, retry); autoRetry(myGen, retry); return null; }
    return { doc: doc, wrap: wrap, myGen: myGen };
  }
  /* fmtMoney: raw host int + row precision -> human via Format. Unknown
   * precision or non-digit input renders honestly as-is (never NaN). */
  function fmtMoney(raw, prec) {
    if (raw === null || raw === undefined || raw === "") return "—";
    if (typeof prec === "number" && /^\d+$/.test(String(raw))) { try { return Format.formatAmount(String(raw), prec); } catch (e) {} }
    return String(raw);
  }
  function fmtTime(at) { try { return new Date(at).toLocaleString(); } catch (e) { return String(at); } }
  function findEntry(id) {
    var list = Gateway.list(), want = String(id || "XBTSX").toUpperCase(), i;
    for (i = 0; i < list.length; i++) if (list[i].id === want) return list[i];
    for (i = 0; i < list.length; i++) if (list[i].id === "XBTSX") return list[i];
    return list[0] || null;
  }
  function copyBtn(doc, text) {
    var b = touchable(el(doc, "button", "Copy")); b.type = "button";
    b.addEventListener("click", function () {
      function done(ok) { b.textContent = ok ? "Copied" : "Copy failed — select manually"; }
      var c = (typeof navigator !== "undefined" && navigator.clipboard) || null;
      if (c && c.writeText) c.writeText(text).then(function () { done(true); }, function () { done(false); });
      else done(false);
    });
    return b;
  }
  function copyRow(doc, label, value) {
    var row = el(doc, "div", null, "xfer-field"), lab = el(doc, "label", label + " ");
    var inp = doc.createElement("input");
    inp.readOnly = true; inp.value = value; touchable(inp);
    lab.appendChild(inp); row.appendChild(lab); row.appendChild(copyBtn(doc, value));
    return row;
  }
  function factList(doc, pairs) {
    var dl = doc.createElement("dl"); dl.className = "xfer-confirm";
    pairs.forEach(function (p) {
      dl.appendChild(el(doc, "dt", p[0]));
      var dd = el(doc, "dd", p[1]); if (p[2]) dd.title = p[2]; dl.appendChild(dd); });
    return dl;
  }
  /* Route entry: renderDesk(root, gatewayParam). Tab clicks navigate the hash
   * (router re-renders; the gen counter tears down stale async work). */
  function renderDesk(root, gatewayParam) {
    if (!root) return;
    function retry() { renderDesk(root, gatewayParam); }
    var ctx = routeGate(root, "Deposit / Withdraw", retry);
    if (!ctx) return;
    ctx.tab = findEntry(gatewayParam).id;
    ctx.action = "deposit"; ctx.account = ""; ctx.coin = null;
    ctx.wrap.appendChild(el(ctx.doc, "p",
      "Deposits never broadcast — you send external coins to the shown address. " +
      "Withdraws continue in the standard transfer form with its live fee and confirm.", "muted"));
    ctx.tabsBox = el(ctx.doc, "div", null, "gw-tabs"); ctx.wrap.appendChild(ctx.tabsBox);
    ctx.healthBox = el(ctx.doc, "div", null, "muted"); ctx.wrap.appendChild(ctx.healthBox);
    ctx.bodyBox = el(ctx.doc, "div"); ctx.wrap.appendChild(ctx.bodyBox);
    paintTabs(ctx);
    refreshHealth(ctx);
    loadTab(ctx);
  }
  function paintTabs(ctx) {
    var doc = ctx.doc, myGen = ctx.myGen;
    clearBox(ctx.tabsBox);
    ctx.dots = {};
    ORDER.forEach(function (id) {
      var b = touchable(el(doc, "button", id)); b.type = "button";
      if (id === ctx.tab) b.disabled = true;
      var dot = el(doc, "span", " ○"); dot.title = "health unknown";
      b.appendChild(dot); ctx.dots[id] = dot;
      b.addEventListener("click", function () {
        if (myGen !== gen) return;
        if (typeof location !== "undefined") location.hash = "#/deposit-withdraw/" + id;
        else { ctx.tab = id; loadTab(ctx); }
      });
      ctx.tabsBox.appendChild(b);
    });
  }
  /* refreshHealth: probe all four (cached <15 min wins inside Gateway.health);
   * dots + one status line + Re-check update only while current. */
  function refreshHealth(ctx) {
    var doc = ctx.doc, myGen = ctx.myGen;
    clearBox(ctx.healthBox);
    showStatus(doc, ctx.healthBox, "Checking gateway health…");
    var pending = ORDER.length, parts = {};
    ORDER.forEach(function (id) {
      Gateway.health(id).then(function (h) {
        if (myGen !== gen) return;
        parts[id] = h;
        var dot = ctx.dots && ctx.dots[id];
        if (dot) { dot.textContent = h.ok ? " ●" : " ✕"; dot.title = (h.ok ? "ok " + (h.ms || "?") + "ms" : (h.reason || "down")) + " · " + fmtTime(h.at); }
        if (--pending !== 0) return;
        clearBox(ctx.healthBox);
        ctx.healthBox.appendChild(el(doc, "p", ORDER.map(function (g) {
          var r = parts[g];
          return g + ": " + (r.ok ? "ok " + r.ms + "ms" : (r.reason || "down")) + " · " + fmtTime(r.at); }).join("  |  "), "muted"));
        var re = touchable(el(doc, "button", "Re-check")); re.type = "button";
        re.addEventListener("click", function () {
          if (myGen !== gen) return;
          var n = ORDER.length; /* force-probe all, then refresh dots + tab */
          ORDER.forEach(function (g) {
            Gateway.health(g, { force: true }).then(function () {
              if (myGen === gen && --n === 0) { refreshHealth(ctx); loadTab(ctx); } }); });
        });
        ctx.healthBox.appendChild(re);
      });
    });
  }
  /* loadTab: disabled entries get the honest panel (never a coin select, never
   * a fetch); live entries load coins (session cache) or degrade with Retry. */
  function loadTab(ctx) {
    var doc = ctx.doc, myGen = ctx.myGen;
    clearBox(ctx.bodyBox);
    var entry = findEntry(ctx.tab);
    ctx.tab = entry.id;
    if (!entry.enabled) { disabledPanel(ctx, entry); return; }
    showStatus(doc, ctx.bodyBox, "Loading " + entry.id + " coins…");
    var hit = coinCache[entry.id];
    var job = hit ? Promise.resolve(hit)
      : Gateway.coins(entry.id).then(function (rows) { coinCache[entry.id] = rows; return rows; });
    job.then(function (rows) {
      if (myGen !== gen) return;
      clearBox(ctx.bodyBox);
      if (!rows || !rows.length) return coinsFailed(ctx, entry, "empty coin list");
      liveTab(ctx, entry, rows);
    }).catch(function (e) {
      if (myGen !== gen) return;
      clearBox(ctx.bodyBox);
      showError(doc, ctx.bodyBox, e, "Could not load " + entry.id + " coins.");
      coinsFailed(ctx, entry, null);
    });
  }
  function coinsFailed(ctx, entry, msg) {
    var doc = ctx.doc, myGen = ctx.myGen;
    if (msg) showError(doc, ctx.bodyBox, entry.id + " reported an " + msg + ".", null);
    var re = touchable(el(doc, "button", "Retry")); re.type = "button";
    re.addEventListener("click", function () { if (myGen !== gen) return; delete coinCache[entry.id]; loadTab(ctx); });
    ctx.bodyBox.appendChild(re);
  }
  /* disabledPanel: GDEX (dead-first, manual-only + landing + probe Retry) and
   * BIT20 (never fetched until discovery proves a host — no host Retry). */
  function disabledPanel(ctx, entry) {
    var doc = ctx.doc, myGen = ctx.myGen;
    ctx.bodyBox.appendChild(el(doc, "h2", entry.id + " — unavailable"));
    ctx.bodyBox.appendChild(el(doc, "p", entry.reason || "This gateway is disabled.", "muted"));
    if (entry.id === "GDEX") {
      ctx.bodyBox.appendChild(el(doc, "p",
        "Only manual deposit / withdraw (per the gateway's own status in the reference UI). " +
        "Automatic lookup stays off until a probe answers.", "muted"));
      if (entry.landing) {
        var a = doc.createElement("a"); a.setAttribute("href", entry.landing);
        a.setAttribute("rel", "noreferrer"); a.textContent = "Gateway status thread";
        ctx.bodyBox.appendChild(a);
      }
      var re = touchable(el(doc, "button", "Retry probe")); re.type = "button";
      re.addEventListener("click", function () {
        if (myGen !== gen) return;
        Gateway.health("GDEX", { force: true }).then(function () { if (myGen === gen) { refreshHealth(ctx); loadTab(ctx); } });
      });
      ctx.bodyBox.appendChild(re);
    } else if (entry.id === "BIT20") {
      ctx.bodyBox.appendChild(el(doc, "p",
        "What unblocks this tab: on-chain discovery of a BIT20-prefixed asset family " +
        "and issuer account (see parity note). No endpoint is guessed, so there is " +
        "nothing to retry against yet.", "muted"));
    }
  }
  /* liveTab: DEPOSIT/WITHDRAW toggle (the WORDS of XbtsxGateway.jsx) + coin
   * select filtered by depositAllowed/withdrawalAllowed. Only the active
   * action's panel renders. */
  function liveTab(ctx, entry, rows) {
    var doc = ctx.doc, myGen = ctx.myGen;
    var wantDeposit = ctx.action !== "withdraw";
    var bar = el(doc, "div", null, "gw-toggle");
    var depB = touchable(el(doc, "button", "DEPOSIT"));
    var witB = touchable(el(doc, "button", "WITHDRAW"));
    depB.type = "button"; witB.type = "button";
    if (wantDeposit) depB.disabled = true; else witB.disabled = true;
    function switchTo(a) { return function () { if (myGen !== gen) return; ctx.action = a; clearBox(ctx.bodyBox); liveTab(ctx, entry, rows); }; }
    depB.addEventListener("click", switchTo("deposit"));
    witB.addEventListener("click", switchTo("withdraw"));
    bar.appendChild(depB); bar.appendChild(witB); ctx.bodyBox.appendChild(bar);
    var pool = rows.filter(function (r) { return wantDeposit ? r.depositAllowed : r.withdrawalAllowed; });
    if (!pool.length) {
      showError(doc, ctx.bodyBox, entry.id + " lists no " + (wantDeposit ? "depositable" : "withdrawable") + " coins right now.", null);
      return;
    }
    if (!ctx.coin || !pool.some(function (r) { return r.symbol === ctx.coin; })) ctx.coin = pool[0].symbol;
    var selRow = el(doc, "div", null, "xfer-field"), lab = el(doc, "label", "Coin ");
    var sel = doc.createElement("select"); touchable(sel);
    pool.forEach(function (r) {
      var o = doc.createElement("option"); o.value = r.symbol;
      o.textContent = r.symbol + (r.backingCoin && r.backingCoin !== r.symbol ? " ← " + r.backingCoin : "");
      sel.appendChild(o);
    });
    sel.value = ctx.coin;
    sel.addEventListener("change", function () { if (myGen !== gen) return; ctx.coin = sel.value; clearBox(ctx.bodyBox); liveTab(ctx, entry, rows); });
    lab.appendChild(sel); selRow.appendChild(lab); ctx.bodyBox.appendChild(selRow);
    var row = null, i;
    for (i = 0; i < pool.length; i++) if (pool[i].symbol === ctx.coin) row = pool[i];
    if (wantDeposit) depositPanel(ctx, entry, row);
    else withdrawPanel(ctx, entry, row);
  }
  /* depositPanel: coin facts (host-stated fees labeled as such) + output
   * account input with inline validation + address/memo result + verbatim
   * host errors with Retry. Nothing here signs or broadcasts — ever. */
  function depositPanel(ctx, entry, row) {
    var doc = ctx.doc, myGen = ctx.myGen;
    ctx.bodyBox.appendChild(el(doc, "h2", "Deposit " + row.symbol + " via " + entry.id));
    ctx.bodyBox.appendChild(factList(doc, [
      ["Coin", row.symbol],
      ["Backing coin", row.backingCoin || "—"],
      ["Minimum deposit (gateway-stated)", fmtMoney(row.minAmountRaw, row.precision), row.minAmountRaw === null ? null : "raw: " + row.minAmountRaw],
      ["Deposit fee (gateway-stated)", fmtMoney(row.gateFeeRaw, row.precision), row.gateFeeRaw === null ? null : "raw: " + row.gateFeeRaw],
      ["Issuer / intermediate", row.gatewayWallet || row.issuer || "—"]
    ]));
    ctx.bodyBox.appendChild(el(doc, "p",
      "No QR code is shown: the reference UI renders QR via an npm component " +
      "with no zero-dependency replacement on disk — copy the text below instead.", "muted"));
    var acctRow = el(doc, "div", null, "xfer-field"), lab = el(doc, "label", "Your BitShares account ");
    var acct = doc.createElement("input");
    acct.setAttribute("placeholder", "account name"); acct.setAttribute("autocomplete", "off");
    acct.value = ctx.account || ""; touchable(acct);
    acct.addEventListener("input", function () { ctx.account = acct.value; });
    lab.appendChild(acct); acctRow.appendChild(lab); ctx.bodyBox.appendChild(acctRow);
    var out = el(doc, "div"); ctx.bodyBox.appendChild(out);
    var go = touchable(el(doc, "button", "Get deposit address")); go.type = "button";
    function doDeposit() {
      if (myGen !== gen) return;
      clearBox(out);
      var account = (acct.value || "").trim();
      if (!account) { showError(doc, out, new Error("bad-account"), null); return; }
      go.disabled = true;
      showStatus(doc, out, "Asking " + entry.id + " for a " + row.symbol + " deposit address…");
      Gateway.depositAddress(entry.id, { coin: row.symbol, account: account }).then(function (res) {
        if (myGen !== gen) return;
        go.disabled = false; clearBox(out);
        if (res.cached) showStatus(doc, out, "Last address (cached) — no new address minted.");
        out.appendChild(copyRow(doc, "Send to address", res.address));
        if (res.memo) out.appendChild(copyRow(doc, "With memo", res.memo));
        else out.appendChild(el(doc, "p", "No memo required for this deposit.", "muted"));
        out.appendChild(el(doc, "p", "Send your external " + row.symbol + " there. This page broadcasts nothing.", "muted"));
      }).catch(function (e) {
        if (myGen !== gen) return;
        go.disabled = false; clearBox(out);
        showError(doc, out, e, "Deposit lookup failed.");
        var re = touchable(el(doc, "button", "Retry")); re.type = "button";
        re.addEventListener("click", doDeposit);
        out.appendChild(re);
      });
    }
    go.addEventListener("click", doDeposit);
    ctx.bodyBox.appendChild(go);
  }
  /* withdrawPanel: external destination + memo preview (prefix + address) +
   * best-effort host validation (never blocking) + deep-link prefill into
   * #/transfer/<to>?asset=&memo= — the slice-4 op-0 form owns validate, live
   * fee, confirm, sign and broadcast. This slice never presses broadcast. */
  function withdrawPanel(ctx, entry, row) {
    var doc = ctx.doc, myGen = ctx.myGen;
    ctx.bodyBox.appendChild(el(doc, "h2", "Withdraw " + row.symbol + " via " + entry.id));
    ctx.bodyBox.appendChild(factList(doc, [
      ["Coin", row.symbol],
      ["Withdraw fee (gateway-stated)", fmtMoney(row.withdrawFeeRaw, row.precision), row.withdrawFeeRaw === null ? null : "raw: " + row.withdrawFeeRaw],
      ["Minimum withdrawal (gateway-stated)", fmtMoney(row.minAmountRaw, row.precision), row.minAmountRaw === null ? null : "raw: " + row.minAmountRaw],
      ["Pays to (gateway-stated)", row.gatewayWallet || row.issuer || "—"]
    ]));
    var destRow = el(doc, "div", null, "xfer-field"), dlab = el(doc, "label", "Destination external address ");
    var dest = doc.createElement("input");
    dest.setAttribute("placeholder", "external " + (row.backingCoin || row.symbol) + " address");
    dest.setAttribute("autocomplete", "off"); touchable(dest);
    dlab.appendChild(dest); destRow.appendChild(dlab); ctx.bodyBox.appendChild(destRow);
    var memoOut = el(doc, "div"); ctx.bodyBox.appendChild(memoOut);
    var validOut = el(doc, "div"); ctx.bodyBox.appendChild(validOut);
    function prefix() { return entry.id === "XBTSX" ? ((row.backingCoin || row.symbol) + ":") : entry.id === "IOB" ? "dex:" : ""; }
    function preview() {
      if (myGen !== gen) return;
      clearBox(memoOut);
      var memo = prefix() + (dest.value || "").trim();
      memoOut.appendChild(copyRow(doc, "Transfer memo", memo === prefix() ? prefix() + "…" : memo));
    }
    preview(); dest.addEventListener("input", preview);
    if (entry.id === "XBTSX" && row.walletType) {
      var chk = touchable(el(doc, "button", "Validate address with gateway")); chk.type = "button";
      chk.addEventListener("click", function () {
        if (myGen !== gen) return;
        clearBox(validOut);
        var addr = (dest.value || "").trim();
        if (!addr) { showError(doc, validOut, "Enter the destination external address first.", null); return; }
        showStatus(doc, validOut, "Asking " + entry.id + "…");
        Gateway.validateWithdrawAddress(entry.id, { walletType: row.walletType, address: addr }).then(function (r) {
          if (myGen !== gen) return;
          clearBox(validOut);
          showStatus(doc, validOut, "Gateway reports the address looks " + (r.valid ? "valid" : "INVALID") + " (advisory only).");
        }).catch(function (e) {
          if (myGen !== gen) return;
          clearBox(validOut);
          showStatus(doc, validOut, "Validation unavailable: " + ((e && e.message) || e) + " — you may still continue.");
        });
      });
      ctx.bodyBox.appendChild(chk);
    }
    var go = touchable(el(doc, "button", "Continue to transfer →")); go.type = "button";
    go.addEventListener("click", function () {
      if (myGen !== gen) return;
      var addr = (dest.value || "").trim();
      clearBox(validOut);
      if (!addr) { showError(doc, validOut, "Enter the destination external address first.", null); return; }
      go.disabled = true;
      Gateway.withdrawPrefill(entry.id, row.symbol).then(function (pre) {
        if (myGen !== gen) return;
        go.disabled = false;
        if (typeof location !== "undefined") location.hash = "#/transfer/" + encodeURIComponent(pre.to) + "?asset=" + encodeURIComponent(pre.assetSymbol) + "&memo=" + encodeURIComponent(pre.memoPrefix + addr);
      }).catch(function (e) {
        if (myGen !== gen) return;
        go.disabled = false;
        showError(doc, validOut, e, "Could not prepare the withdraw prefill.");
      });
    });
    ctx.bodyBox.appendChild(go);
    ctx.bodyBox.appendChild(el(doc, "p",
      "Amount, live chain fee, confirm, sign and broadcast all happen in the " +
      "transfer form — this page never broadcasts a gateway withdraw.", "muted"));
  }
  return { renderDesk: renderDesk, render: renderDesk };
})();

/* Expose the single GatewayUI global to Node for headless smoke tests (no-op in browsers). */
if (typeof globalThis !== "undefined" && typeof globalThis.GatewayUI === "undefined") { globalThis.GatewayUI = GatewayUI; }
if (typeof module !== "undefined") { module.exports = GatewayUI; }
