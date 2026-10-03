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
 *   Format (money strings only). Side effects: DOM under the router root;
 *   exposes global GatewayUI only. Created by: building-vanilla-slices skill,
 *   slice-15-gateways plan Task 2.
 * MONEY (#6): host fee ints stay raw until fmtMoney renders them via Format at the
 *   row precision, labeled gateway-stated; chain fees live in the transfer form only.
 */
var GatewayUI = (function () {
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
    var m = (e && e.message) ? e.message : String(e || fallback || t("gateway.unexpected", "Unexpected error"));
    if (m.indexOf("gateway-rejected:") === 0) m = t("gateway.refused_prefix", "Gateway refused: ") + m.slice(18).trim();
    else if (m.indexOf("gateway-down:") === 0) m = t("gateway.unreachable_prefix", "Gateway unreachable (") + m.slice(14).trim() + t("gateway.unreachable_suffix", "). Try Re-check.");
    else if (m.indexOf("disabled:") === 0) m = m.slice(9).trim();
    else if (m.indexOf("bad-account") !== -1) m = t("gateway.bad_account", "Enter a BitShares account name first.");
    else if (m.indexOf("bad-coin") !== -1) m = t("gateway.bad_coin", "Unknown coin for this gateway.");
    else if (m.indexOf("not-connected") !== -1) m = t("gateway.offline", "Network unavailable. Check Settings → Nodes and retry.");
    var err = el(doc, "div", m, "error"); err.setAttribute("aria-live", "polite"); box.appendChild(err); return err;
  }
  function showStatus(doc, box, text) {
    var p = el(doc, "p", text, "muted"); p.setAttribute("aria-live", "polite"); box.appendChild(p); return p;
  }
  function offlineBox(doc, box, retryFn) { /* Offline panel: copy depends on
    * actual connection (unknown-id failures while connected must not claim
    * the network is down). Retry handshakes via the shared Offline helper
    * (js/api/offline.js); Open Settings links to #/settings for failover. */
    var open = (typeof Chain !== "undefined" && Chain && Chain.status && Chain.status().state === "open");
    box.appendChild(el(doc, "p", open
      ? t("gateway.retry_load", "Retry loading.")
      : t("gateway.offline", "Network unavailable. Check Settings → Nodes and retry."), "muted"));
    var status = el(doc, "p", "", "muted");
    try { status.setAttribute("aria-live", "polite"); } catch (e) { /* text stands */ }
    box.appendChild(status);
    var row = el(doc, "div", null, "pools-offline-row");
    box.appendChild(row);
    var b = touchable(el(doc, "button", t("gateway.retry", "Retry"))); b.type = "button";
    row.appendChild(b);
    var off = null;
    try { off = (typeof Offline !== "undefined" && Offline) ? Offline : null; } catch (e) { off = null; }
    if (off && typeof off.wire === "function") {
      try { off.wire(b, status, retryFn, t); } catch (e) { b.addEventListener("click", retryFn); }
    } else {
      b.addEventListener("click", retryFn);
    }
    var link = null;
    if (off && typeof off.settingsLink === "function") {
      try { link = off.settingsLink(doc, t); } catch (e) { link = null; }
    }
    if (!link) {
      link = el(doc, "a", t("notice.open_settings", "Open Settings"));
      try { link.setAttribute("href", "#/settings"); } catch (e) { /* label stands */ }
      touchable(link);
    }
    row.appendChild(link);
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
    if (miss) { showError(doc, wrap, title + t("gateway.backend_missing", " backend missing: ") + miss + t("gateway.load_failed", " failed to load.")); return null; }
    if (Chain.status().state !== "open") { offlineBox(doc, wrap, retry); autoRetry(myGen, retry); try { if (typeof Offline !== "undefined" && Offline && typeof Offline.ensure === "function") Offline.ensure(); } catch (e) { /* manual Retry remains */ } return null; }
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
    var b = touchable(el(doc, "button", t("gateway.copy", "Copy"))); b.type = "button";
    b.addEventListener("click", function () {
      function done(ok) { b.textContent = ok ? t("gateway.copied", "Copied") : t("gateway.copy_failed", "Copy failed — select manually"); }
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
    var ctx = routeGate(root, t("gateway.title", "Deposit / Withdraw"), retry);
    if (!ctx) return;
    ctx.tab = findEntry(gatewayParam).id;
    ctx.action = "deposit"; ctx.account = ""; ctx.coin = null;
    ctx.wrap.appendChild(el(ctx.doc, "p",
      t("gateway.intro_a", "Deposits never broadcast — you send external coins to the shown address. ") +
      t("gateway.intro_b", "Withdraws continue in the standard transfer form with its live fee and confirm."), "muted"));
    /* LOW punchlist: per-service display toggles (persisted viewSettings) +
     * terms/agreement disclosure. Batch-3-keyed literals; toggles hide tab
     * buttons (direct hashes still load); terms are display-only. */
    (function gwPrefs() {
      var KEY = "bts-vanilla-gw-toggles-v1";
      var prefs = null;
      try {
        prefs = JSON.parse(localStorage.getItem(KEY) || "null");
      } catch (e) { prefs = null; }
      if (!prefs || typeof prefs !== "object") {
        prefs = { XBTSX: true, IOB: true, GDEX: true, BIT20: true };
      }
      ctx.gwShow = prefs;
      var det = ctx.doc.createElement("details");
      det.className = "muted";
      var sum = ctx.doc.createElement("summary");
      sum.textContent = t("gateway.display_terms", "Gateway display + terms");
      touchable(sum);
      det.appendChild(sum);
      ORDER.forEach(function (id) {
        var lab = ctx.doc.createElement("label");
        var box = ctx.doc.createElement("input");
        box.type = "checkbox";
        box.checked = prefs[id] !== false;
        touchable(box);
        box.setAttribute("aria-label", t("gateway.show_prefix", "Show ") + id);
        box.addEventListener("change", function () {
          prefs[id] = !!box.checked;
          try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) { /* session-only */ }
          paintTabs(ctx);
        });
        lab.appendChild(box);
        lab.appendChild(ctx.doc.createTextNode(t("gateway.show_mid", " Show ") + id + " "));
        det.appendChild(lab);
      });
      var terms = el(ctx.doc, "p", t("gateway.use_at_your_own_risk_external_hosts_set_", "Gateway use is at your own risk: external hosts set fees, minimums and addresses. Verify every address and memo before sending — deposits cannot be reversed."), "muted");
      det.appendChild(terms);
      ctx.wrap.appendChild(det);
    })();
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
      if (ctx.gwShow && ctx.gwShow[id] === false) return;
      var b = touchable(el(doc, "button", id)); b.type = "button";
      if (id === ctx.tab) b.disabled = true;
      var dot = el(doc, "span", " ○"); dot.title = t("gateway.health_unknown", "health unknown");
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
    showStatus(doc, ctx.healthBox, t("gateway.checking_health", "Checking gateway health…"));
    var pending = ORDER.length, parts = {};
    ORDER.forEach(function (id) {
      Gateway.health(id).then(function (h) {
        if (myGen !== gen) return;
        parts[id] = h;
        var dot = ctx.dots && ctx.dots[id];
        if (dot) { dot.textContent = h.ok ? " ●" : " ✕"; dot.title = (h.ok ? t("gateway.health_ok", "ok ") + (h.ms || "?") + "ms" : (h.reason || t("gateway.down", "down"))) + " · " + fmtTime(h.at); }
        if (--pending !== 0) return;
        clearBox(ctx.healthBox);
        ctx.healthBox.appendChild(el(doc, "p", ORDER.map(function (g) {
          var r = parts[g];
          return g + ": " + (r.ok ? t("gateway.health_ok", "ok ") + r.ms + "ms" : (r.reason || t("gateway.down", "down"))) + " · " + fmtTime(r.at); }).join("  |  "), "muted"));
        var re = touchable(el(doc, "button", t("gateway.recheck", "Re-check"))); re.type = "button";
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
    showStatus(doc, ctx.bodyBox, t("gateway.loading_prefix", "Loading ") + entry.id + t("gateway.loading_coins_suffix", " coins…"));
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
      showError(doc, ctx.bodyBox, e, t("gateway.coins_failed_prefix", "Could not load ") + entry.id + t("gateway.coins_failed_suffix", " coins."));
      coinsFailed(ctx, entry, null);
    });
  }
  function coinsFailed(ctx, entry, msg) {
    var doc = ctx.doc, myGen = ctx.myGen;
    if (msg) showError(doc, ctx.bodyBox, entry.id + t("gateway.reported_an", " reported an ") + msg + ".", null);
    var re = touchable(el(doc, "button", t("gateway.retry", "Retry"))); re.type = "button";
    re.addEventListener("click", function () { if (myGen !== gen) return; delete coinCache[entry.id]; loadTab(ctx); });
    ctx.bodyBox.appendChild(re);
  }
  /* disabledPanel: GDEX (dead-first, manual-only + landing + probe Retry) and
   * BIT20 (never fetched until discovery proves a host — no host Retry). */
  function disabledPanel(ctx, entry) {
    var doc = ctx.doc, myGen = ctx.myGen;
    ctx.bodyBox.appendChild(el(doc, "h2", entry.id + t("gateway.unavailable_suffix", " — unavailable")));
    ctx.bodyBox.appendChild(el(doc, "p", entry.reason || t("gateway.disabled_fallback", "This gateway is disabled."), "muted"));
    if (entry.id === "GDEX") {
      ctx.bodyBox.appendChild(el(doc, "p",
        t("gateway.gdex_manual_a", "Only manual deposit / withdraw (per the gateway's own status in the reference UI). ") +
        t("gateway.gdex_manual_b", "Automatic lookup stays off until a probe answers."), "muted"));
      if (entry.landing) {
        var a = doc.createElement("a"); a.setAttribute("href", entry.landing);
        a.setAttribute("rel", "noreferrer"); a.textContent = t("gateway.status_thread", "Gateway status thread");
        ctx.bodyBox.appendChild(a);
      }
      var re = touchable(el(doc, "button", t("gateway.retry_probe", "Retry probe"))); re.type = "button";
      re.addEventListener("click", function () {
        if (myGen !== gen) return;
        Gateway.health("GDEX", { force: true }).then(function () { if (myGen === gen) { refreshHealth(ctx); loadTab(ctx); } });
      });
      ctx.bodyBox.appendChild(re);
    } else if (entry.id === "BIT20") {
      ctx.bodyBox.appendChild(el(doc, "p",
        t("gateway.bit20_a", "What unblocks this tab: on-chain discovery of a BIT20-prefixed asset family ") +
        t("gateway.bit20_b", "and issuer account (see parity note). No endpoint is guessed, so there is ") +
        t("gateway.bit20_c", "nothing to retry against yet."), "muted"));
    }
  }
  /* liveTab: DEPOSIT/WITHDRAW toggle (the WORDS of XbtsxGateway.jsx) + coin
   * select filtered by depositAllowed/withdrawalAllowed. Only the active
   * action's panel renders. */
  function liveTab(ctx, entry, rows) {
    var doc = ctx.doc, myGen = ctx.myGen;
    var wantDeposit = ctx.action !== "withdraw";
    var bar = el(doc, "div", null, "gw-toggle");
    var depB = touchable(el(doc, "button", t("gateway.deposit_tab", "DEPOSIT")));
    var witB = touchable(el(doc, "button", t("gateway.withdraw_tab", "WITHDRAW")));
    depB.type = "button"; witB.type = "button";
    if (wantDeposit) depB.disabled = true; else witB.disabled = true;
    function switchTo(a) { return function () { if (myGen !== gen) return; ctx.action = a; clearBox(ctx.bodyBox); liveTab(ctx, entry, rows); }; }
    depB.addEventListener("click", switchTo("deposit"));
    witB.addEventListener("click", switchTo("withdraw"));
    bar.appendChild(depB); bar.appendChild(witB); ctx.bodyBox.appendChild(bar);
    var pool = rows.filter(function (r) { return wantDeposit ? r.depositAllowed : r.withdrawalAllowed; });
    if (!pool.length) {
      showError(doc, ctx.bodyBox, entry.id + t("gateway.lists_no", " lists no ") + (wantDeposit ? t("gateway.kind_deposit", "depositable") : t("gateway.kind_withdraw", "withdrawable")) + t("gateway.coins_right_now", " coins right now."), null);
      return;
    }
    if (!ctx.coin || !pool.some(function (r) { return r.symbol === ctx.coin; })) ctx.coin = pool[0].symbol;
    var selRow = el(doc, "div", null, "xfer-field"), lab = el(doc, "label", t("gateway.coin_label", "Coin "));
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
    ctx.bodyBox.appendChild(el(doc, "h2", t("gateway.deposit_prefix", "Deposit ") + row.symbol + t("gateway.via", " via ") + entry.id));
    ctx.bodyBox.appendChild(factList(doc, [
      [t("gateway.coin_fact", "Coin"), row.symbol],
      [t("gateway.backing_fact", "Backing coin"), row.backingCoin || "—"],
      [t("gateway.min_deposit", "Minimum deposit (gateway-stated)"), fmtMoney(row.minAmountRaw, row.precision), row.minAmountRaw === null ? null : t("gateway.raw_prefix", "raw: ") + row.minAmountRaw],
      [t("gateway.deposit_fee", "Deposit fee (gateway-stated)"), fmtMoney(row.gateFeeRaw, row.precision), row.gateFeeRaw === null ? null : t("gateway.raw_prefix", "raw: ") + row.gateFeeRaw],
      [t("gateway.issuer_fact", "Issuer / intermediate"), row.gatewayWallet || row.issuer || "—"]
    ]));
    ctx.bodyBox.appendChild(el(doc, "p",
      t("gateway.no_qr_a", "No QR code is shown: the reference UI renders QR via an npm component ") +
      t("gateway.no_qr_b", "with no zero-dependency replacement on disk — copy the text below instead."), "muted"));
    var acctRow = el(doc, "div", null, "xfer-field"), lab = el(doc, "label", t("gateway.your_account", "Your BitShares account "));
    var acct = doc.createElement("input");
    acct.setAttribute("placeholder", t("gateway.account_ph", "account name")); acct.setAttribute("autocomplete", "off");
    acct.value = ctx.account || ""; touchable(acct);
    acct.addEventListener("input", function () { ctx.account = acct.value; });
    lab.appendChild(acct); acctRow.appendChild(lab); ctx.bodyBox.appendChild(acctRow);
    var out = el(doc, "div"); ctx.bodyBox.appendChild(out);
    var go = touchable(el(doc, "button", t("gateway.get_address", "Get deposit address"))); go.type = "button";
    function doDeposit() {
      if (myGen !== gen) return;
      clearBox(out);
      var account = (acct.value || "").trim();
      if (!account) { showError(doc, out, new Error("bad-account"), null); return; }
      go.disabled = true;
      showStatus(doc, out, t("gateway.asking_prefix", "Asking ") + entry.id + t("gateway.asking_deposit_mid", " for a ") + row.symbol + t("gateway.asking_deposit_end", " deposit address…"));
      Gateway.depositAddress(entry.id, { coin: row.symbol, account: account }).then(function (res) {
        if (myGen !== gen) return;
        go.disabled = false; clearBox(out);
        if (res.cached) showStatus(doc, out, t("gateway.cached_note", "Last address (cached) — no new address minted."));
        out.appendChild(copyRow(doc, t("gateway.send_to", "Send to address"), res.address));
        if (res.memo) out.appendChild(copyRow(doc, t("gateway.with_memo", "With memo"), res.memo));
        else out.appendChild(el(doc, "p", t("gateway.no_memo", "No memo required for this deposit."), "muted"));
        out.appendChild(el(doc, "p", t("gateway.send_external_prefix", "Send your external ") + row.symbol + t("gateway.send_external_suffix", " there. This page broadcasts nothing."), "muted"));
      }).catch(function (e) {
        if (myGen !== gen) return;
        go.disabled = false; clearBox(out);
        showError(doc, out, e, t("gateway.deposit_failed", "Deposit lookup failed."));
        var re = touchable(el(doc, "button", t("gateway.retry", "Retry"))); re.type = "button";
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
    ctx.bodyBox.appendChild(el(doc, "h2", t("gateway.withdraw_prefix", "Withdraw ") + row.symbol + t("gateway.via", " via ") + entry.id));
    ctx.bodyBox.appendChild(factList(doc, [
      [t("gateway.coin_fact", "Coin"), row.symbol],
      [t("gateway.withdraw_fee", "Withdraw fee (gateway-stated)"), fmtMoney(row.withdrawFeeRaw, row.precision), row.withdrawFeeRaw === null ? null : t("gateway.raw_prefix", "raw: ") + row.withdrawFeeRaw],
      [t("gateway.min_withdraw", "Minimum withdrawal (gateway-stated)"), fmtMoney(row.minAmountRaw, row.precision), row.minAmountRaw === null ? null : t("gateway.raw_prefix", "raw: ") + row.minAmountRaw],
      [t("gateway.pays_to", "Pays to (gateway-stated)"), row.gatewayWallet || row.issuer || "—"]
    ]));
    var destRow = el(doc, "div", null, "xfer-field"), dlab = el(doc, "label", t("gateway.dest_label", "Destination external address "));
    var dest = doc.createElement("input");
    dest.setAttribute("placeholder", t("gateway.dest_ph_prefix", "external ") + (row.backingCoin || row.symbol) + t("gateway.dest_ph_suffix", " address"));
    dest.setAttribute("autocomplete", "off"); touchable(dest);
    dlab.appendChild(dest); destRow.appendChild(dlab); ctx.bodyBox.appendChild(destRow);
    var memoOut = el(doc, "div"); ctx.bodyBox.appendChild(memoOut);
    var validOut = el(doc, "div"); ctx.bodyBox.appendChild(validOut);
    function prefix() { return entry.id === "XBTSX" ? ((row.backingCoin || row.symbol) + ":") : entry.id === "IOB" ? "dex:" : ""; }
    function preview() {
      if (myGen !== gen) return;
      clearBox(memoOut);
      var memo = prefix() + (dest.value || "").trim();
      memoOut.appendChild(copyRow(doc, t("gateway.memo_label", "Transfer memo"), memo === prefix() ? prefix() + "…" : memo));
    }
    preview(); dest.addEventListener("input", preview);
    if (entry.id === "XBTSX" && row.walletType) {
      var chk = touchable(el(doc, "button", t("gateway.validate_btn", "Validate address with gateway"))); chk.type = "button";
      chk.addEventListener("click", function () {
        if (myGen !== gen) return;
        clearBox(validOut);
        var addr = (dest.value || "").trim();
        if (!addr) { showError(doc, validOut, t("gateway.dest_needed", "Enter the destination external address first."), null); return; }
        showStatus(doc, validOut, t("gateway.asking_prefix", "Asking ") + entry.id + "…");
        Gateway.validateWithdrawAddress(entry.id, { walletType: row.walletType, address: addr }).then(function (r) {
          if (myGen !== gen) return;
          clearBox(validOut);
          showStatus(doc, validOut, t("gateway.addr_prefix", "Gateway reports the address looks ") + (r.valid ? t("gateway.addr_valid", "valid") : t("gateway.addr_invalid", "INVALID")) + t("gateway.addr_suffix", " (advisory only)."));
        }).catch(function (e) {
          if (myGen !== gen) return;
          clearBox(validOut);
          showStatus(doc, validOut, t("gateway.validation_prefix", "Validation unavailable: ") + ((e && e.message) || e) + t("gateway.validation_suffix", " — you may still continue."));
        });
      });
      ctx.bodyBox.appendChild(chk);
    }
    var go = touchable(el(doc, "button", t("gateway.continue_transfer", "Continue to transfer →"))); go.type = "button";
    go.addEventListener("click", function () {
      if (myGen !== gen) return;
      var addr = (dest.value || "").trim();
      clearBox(validOut);
      if (!addr) { showError(doc, validOut, t("gateway.dest_needed", "Enter the destination external address first."), null); return; }
      go.disabled = true;
      Gateway.withdrawPrefill(entry.id, row.symbol).then(function (pre) {
        if (myGen !== gen) return;
        go.disabled = false;
        if (typeof location !== "undefined") location.hash = "#/transfer/" + encodeURIComponent(pre.to) + "?asset=" + encodeURIComponent(pre.assetSymbol) + "&memo=" + encodeURIComponent(pre.memoPrefix + addr);
      }).catch(function (e) {
        if (myGen !== gen) return;
        go.disabled = false;
        showError(doc, validOut, e, t("gateway.prefill_failed", "Could not prepare the withdraw prefill."));
      });
    });
    ctx.bodyBox.appendChild(go);
    ctx.bodyBox.appendChild(el(doc, "p",
      t("gateway.withdraw_note_a", "Amount, live chain fee, confirm, sign and broadcast all happen in the ") +
      t("gateway.withdraw_note_b", "transfer form — this page never broadcasts a gateway withdraw."), "muted"));
  }
  return { renderDesk: renderDesk, render: renderDesk };
})();

/* Expose the single GatewayUI global to Node for headless smoke tests (no-op in browsers). */
if (typeof globalThis !== "undefined" && typeof globalThis.GatewayUI === "undefined") { globalThis.GatewayUI = GatewayUI; }
if (typeof module !== "undefined") { module.exports = GatewayUI; }
