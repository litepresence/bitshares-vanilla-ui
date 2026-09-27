/* htlc-ui.js — #/htlc + #/htlc/:id views + shared _ui helpers for debit-ui.js.
 * Owns: HTLC sent/received tables, create form (type-preimage or paste-hash),
 * detail panel, redeem form (live hash-match), extend form, NAMED-row confirms.
 * Consumes: Htlc (reads/builders/fee/sendAndProve/formatters), Tx (buildTx),
 * Format, Account, Asset, Wallet (unlock + memory WIF), Chain, Store (WIFs stay JS values).
 * Created by: building-vanilla-slices skill, slice-11-htlc plan Task 3 (generation counter drops stale work).
 * CHAIN TRUTH (#4 wins): op 49 create / 50 redeem / 52 extend (protocol/
 * htlc.hpp); 51/53 VIRTUAL, never dispatched. Secrecy: HASH ONLY on screen;
 * plaintext lives only in the redeem password input; create clears secrets.
 */
var HtlcUI = (function () {
  "use strict";
  var gen = 0;
  var PRESETS = [["1 hour", 3600], ["12 hours", 43200], ["1 day", 86400], ["7 days", 604800], ["30 days", 2592000]];
  function el(doc, tag, text, cls) { /* textContent-only element (no HTML injection) */
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text; return n;
  }
  function touchable(n) { n.style.minHeight = "44px"; return n; } /* touch floor: >=44px one dim */
  function clearBox(box) { while (box.firstChild) box.removeChild(box.firstChild); }
  function shortHash(hex) { hex = String(hex || ""); return hex.length > 18 ? hex.slice(0, 12) + "…" + hex.slice(-6) : hex; }
  function showError(doc, wrap, e, fallback) { /* any throw -> text, never blank */
    var m = (e && typeof e.message === "string" && e.message) ? e.message : String(e || fallback || "Unexpected error");
    var map = [["not-connected", "Network unavailable. Check Settings → Nodes and retry."], ["wallet-locked", "Wallet is locked."],
      ["unknown-htlc", "Unknown HTLC contract."], ["unknown-account", "Account not found."],
      ["hash-mismatch", "Preimage does not match the locked hash."], ["bad-preimage", "Enter a non-empty preimage."]], i;
    if (m.indexOf("not connected") !== -1) m = map[0][1];
    for (i = 0; i < map.length; i++) if (m.indexOf(map[i][0]) !== -1) { m = map[i][1]; break; }
    var err = el(doc, "div", m, "error"); err.setAttribute("aria-live", "polite"); wrap.appendChild(err); return err;
  }
  /* Status line (aria-live, muted): progress text so panels never sit blank. Params: doc, wrap (appended to), text. Returns: the p. */
  function showStatus(doc, wrap, text) {
    var p = el(doc, "p", text, "muted"); p.setAttribute("aria-live", "polite"); wrap.appendChild(p); return p;
  }
  function offlineBox(doc, wrap, retryFn) { /* offline panel + Retry, never blank */
    wrap.appendChild(el(doc, "p", "Network unavailable. Check Settings → Nodes and retry.", "muted"));
    var b = touchable(el(doc, "button", "Retry")); b.type = "button";
    b.addEventListener("click", retryFn); wrap.appendChild(b);
  }
  function unlockBox(doc, wrap, retry) { /* locked gate: unlock re-runs the retry closure */
    wrap.appendChild(el(doc, "p", "Wallet is locked. Enter your password to continue.", "muted"));
    var inp = doc.createElement("input");
    inp.type = "password"; inp.setAttribute("autocomplete", "current-password"); touchable(inp); wrap.appendChild(inp);
    var b = touchable(el(doc, "button", "Unlock")); b.type = "button"; wrap.appendChild(b);
    b.addEventListener("click", function () { b.disabled = true;
      Wallet.unlock(inp.value).then(retry).catch(function (e) { b.disabled = false; showError(doc, wrap, e, "Unlock failed."); });
    });
  }
  function missingBackends() { /* first missing backend id, or null */
    var need = ["Htlc", "Tx", "Account", "Wallet", "Format", "Asset", "Chain", "Store"], miss = null;
    need.forEach(function (g) { if (typeof globalThis[g] === "undefined") miss = g; });
    return miss;
  }
  var openSubs = []; /* pending connect watchers; drained on every entry so none leak */
  function dropOpenSubs() { openSubs.forEach(function (off) { try { off(); } catch (e) {} }); openSubs = []; }
  function autoRetryOnOpen(myGen, retryFn, isLive) { /* re-run entry when the socket opens (vote pattern); stale gens bail.
    isLive defaults to this module's gen check; cross-file callers (debit-ui owns its own gen) pass their own. */
    try {
      var live = isLive || function () { return myGen === gen; };
      var hashAtEntry = (typeof location !== "undefined" && location.hash) || "";
      var settled = false;
      var off = Store.subscribe("connection", function (st) {
        if (settled) return;
        if (!live()) { settled = true; try { off(); } catch (e) {} return; }
        if (st && st.state === "open") {
          settled = true; try { off(); } catch (e) {}
          if (typeof location === "undefined" || location.hash === hashAtEntry) retryFn();
        }
      });
      openSubs.push(off);
    } catch (e) { /* subscribe unavailable: manual Retry remains */ }
  }
  function routeReady(root, title, retry) { /* preamble (backends/offline/unlock); null = gate painted */
    var doc = root.ownerDocument || document, myGen = ++gen, miss = missingBackends();
    dropOpenSubs();
    root.innerHTML = "";
    var wrap = el(doc, "div", null, "wrap"); root.appendChild(wrap);
    wrap.appendChild(el(doc, "h1", title));
    if (miss) { showError(doc, wrap, title + " backend missing: " + miss + " failed to load."); return null; }
    if (Chain.status().state !== "open") { offlineBox(doc, wrap, retry); autoRetryOnOpen(myGen, retry); return null; }
    if (!Wallet.isUnlocked()) { unlockBox(doc, wrap, retry); return null; }
    return { doc: doc, wrap: wrap, myGen: myGen };
  }
  function routeFail(root, title, e, fallback, retry) { /* shared load-failure page */
    root.innerHTML = "";
    var doc = root.ownerDocument || document, failed = el(doc, "div", null, "wrap");
    root.appendChild(failed); failed.appendChild(el(doc, "h1", title));
    showError(doc, failed, e, fallback); offlineBox(doc, failed, retry);
  }
  function loadAccount(myGen, loader) { /* resolve wallet account, run loader(me); stale gens bail */
    return Account.myAccountId().then(function (id) { return Account.resolve(id); }).then(function (me) {
      if (myGen !== gen) return null;
      return loader(me).then(function (data) { return { me: me, data: data }; }); });
  }
  function confirmList(doc, rows) { /* NAMED rows: human term + raw in title, never raw-only */
    var list = el(doc, "dl", null, "xfer-confirm");
    rows.forEach(function (r) {
      list.appendChild(el(doc, "dt", r[0]));
      var dd = el(doc, "dd", r[1]); if (r[2]) dd.title = r[2]; list.appendChild(dd);
    });
    return list;
  }
  function field(doc, labelText, opts) { /* labeled touch-sized input row */
    opts = opts || {};
    var row = el(doc, "div", null, "xfer-field"), label = el(doc, "label", labelText + " ");
    var input = doc.createElement("input");
    if (opts.type) input.type = opts.type; if (opts.value !== undefined) input.value = opts.value;
    if (opts.placeholder) input.setAttribute("placeholder", opts.placeholder);
    if (opts.inputmode) input.setAttribute("inputmode", opts.inputmode);
    touchable(input); label.appendChild(input); row.appendChild(label); return { row: row, input: input };
  }
  function selectOpts(doc, sel, pairs) { /* [[value, title]] -> options */
    pairs.forEach(function (p) {
      var o = doc.createElement("option"); o.value = p[0]; o.textContent = p[1]; sel.appendChild(o);
    });
    return sel;
  }
  function secsPicker(doc, pairs, labelText) { /* preset + custom seconds; returns {row, secs()} */
    var sel = selectOpts(doc, touchable(doc.createElement("select")), pairs);
    var customOpt = doc.createElement("option"); customOpt.value = "custom"; customOpt.textContent = "Custom…";
    sel.appendChild(customOpt);
    var custom = doc.createElement("input");
    custom.setAttribute("placeholder", "seconds"); custom.setAttribute("inputmode", "numeric");
    touchable(custom); custom.style.display = "none"; var row = el(doc, "div", null, "xfer-field");
    row.appendChild(el(doc, "span", labelText + ": ")); row.appendChild(sel); row.appendChild(custom);
    sel.addEventListener("change", function () { custom.style.display = sel.value === "custom" ? "" : "none"; });
    return { row: row, sel: sel, custom: custom, secs: function () {
      return sel.value === "custom" ? parseInt(String(custom.value).trim(), 10) : parseInt(sel.value, 10);
    } };
  }
  function tableHead(doc, titles) { /* shared thead builder */
    var hr = doc.createElement("tr");
    titles.forEach(function (t) { hr.appendChild(el(doc, "th", t)); });
    var thead = doc.createElement("thead"); thead.appendChild(hr); return thead;
  }
  async function feeText(fee) { /* fee -> human + raw (lookup failure falls back to raw) */
    try {
      var a = await Asset.describe(fee.asset_id);
      return { text: Format.formatAmount(fee.amount, a.precision) + " " + a.symbol, raw: String(fee.amount) };
    } catch (e) { return { text: String(fee.amount) + " (" + fee.asset_id + ")", raw: String(fee.amount) }; }
  }
  async function headBlock() { /* head # for result panels (observation marker, never a txid) */
    return (await Chain.call(await Chain.db(), "get_dynamic_global_properties", [])).head_block_number || 0;
  }
  function amtText(raw, assetId, prec) { /* raw int -> human + raw title (unknown prec stays honest) */
    if (typeof prec === "number" && /^\d+$/.test(String(raw))) {
      return { text: Format.formatAmount(String(raw), prec), raw: String(raw) };
    }
    return { text: String(raw) + " (" + assetId + ")", raw: String(raw) };
  }
  function sendConfirm(doc, out, cfg, myGen) { /* confirm + publish: fresh-WIF sign, re-read proof, result */
    clearBox(out);
    out.appendChild(el(doc, "h3", cfg.title)); out.appendChild(confirmList(doc, cfg.rows));
    var back = touchable(el(doc, "button", "Back")); back.type = "button";
    var send = touchable(el(doc, "button", "Sign & Send")); send.type = "button";
    out.appendChild(back); out.appendChild(send);
    back.addEventListener("click", function () { clearBox(out); });
    send.addEventListener("click", function () {
      if (myGen !== gen) return; send.disabled = true; back.disabled = true;
      var status = showStatus(doc, out, "Signing…");
      var wif = Wallet.keys && Wallet.keys.active ? Wallet.keys.active.wif : null;
      if (!wif) { out.removeChild(status); showError(doc, out, new Error("wallet-locked")); send.disabled = false; back.disabled = false; return; }
      Promise.resolve().then(cfg.makeUnsigned).then(function (unsigned) {
        status.textContent = "Broadcasting…";
        return Htlc.sendAndProve(unsigned, wif, cfg.prove);
      }).then(async function (res) {
        if (myGen !== gen) return;
        clearBox(out);
        out.appendChild(el(doc, "p", cfg.okText, "xfer-ok"));
        out.appendChild(el(doc, "p", "Observed at head block #" + String(await headBlock()) + " (" + res.via + ").", "muted"));
        (cfg.clear || []).forEach(function (inp) { inp.value = ""; }); /* secrecy: drop secret fields */
      }).catch(function (e) {
        if (myGen !== gen) return;
        out.removeChild(status);
        showError(doc, out, e, "Failed. Check state before retrying (do NOT blindly rebroadcast)."); send.disabled = false; back.disabled = false;
      });
    });
  }
  function reviewPaid(doc, out, myGen, cfg) { /* review: build {pair,fee,prove} + live fee -> rows -> sendConfirm */
    clearBox(out); if (cfg.btn) cfg.btn.disabled = true;
    showStatus(doc, out, "Resolving and estimating fee…");
    function done() { if (cfg.btn) cfg.btn.disabled = false; }
    Promise.resolve().then(cfg.build).then(function (built) {
      if (myGen !== gen) return done();
      feeText(built.fee).then(function (f) {
        if (myGen !== gen) return done();
        sendConfirm(doc, out, { title: cfg.title, rows: cfg.rows(built, f),
          makeUnsigned: function () { return Tx.buildTx([built.pair]); },
          prove: built.prove, okText: cfg.ok(built), clear: cfg.clear || [] }, myGen);
        done();
      }).catch(function (e) { if (myGen === gen) { clearBox(out); showError(doc, out, e, "Fee lookup failed."); } done(); });
    }).catch(function (e) {
      if (myGen !== gen) return done();
      clearBox(out); showError(doc, out, e, cfg.fail || "Could not prepare the transaction."); done();
    });
  }
  function reviewSection(doc, box, myGen, label, cfg) { /* review button + output box + gen-checked wiring */
    var btn = touchable(el(doc, "button", label)); btn.type = "button"; box.appendChild(btn);
    var out = el(doc, "div", null, "xfer-out"); box.appendChild(out);
    cfg.btn = btn;
    btn.addEventListener("click", function () { if (myGen === gen) reviewPaid(doc, out, myGen, cfg); });
    return btn;
  }
  /* Route entry: #/htlc — sent + received tables + create form. */
  function renderHtlc(root) {
    if (!root) return;
    var ctx = routeReady(root, "Hashed Timelock Contracts", function () { renderHtlc(root); });
    if (!ctx) return;
    var doc = ctx.doc, myGen = ctx.myGen; ctx.wrap.appendChild(el(doc, "p", "Loading contracts…", "muted"));
    loadAccount(myGen, function (me) { return Htlc.mine(me.id); }).then(function (found) {
      if (!found || myGen !== gen) return;
      root.innerHTML = "";
      var box = el(doc, "div", null, "wrap"); root.appendChild(box);
      box.appendChild(el(doc, "h1", "Hashed Timelock Contracts"));
      box.appendChild(el(doc, "p", "Locked transfers redeemable with a secret preimage before expiry.", "muted"));
      box.appendChild(el(doc, "h2", "Sent (" + found.data.sent.length + ")"));
      box.appendChild(htlcTable(doc, found.data.sent, "sent"));
      box.appendChild(el(doc, "h2", "Received (" + found.data.received.length + ")"));
      box.appendChild(htlcTable(doc, found.data.received, "received"));
      box.appendChild(el(doc, "h2", "New HTLC"));
      createBox(doc, box, found.me, myGen);
    }).catch(function (e) {
      if (myGen !== gen) return; routeFail(root, "Hashed Timelock Contracts", e, "Could not load contracts.", function () { renderHtlc(root); }); });
  }
  function htlcTable(doc, rows, kind) { /* ALGO NAME + short hex cells; rows link to detail */
    if (!rows.length) return el(doc, "p", kind === "sent" ? "No HTLCs sent from your accounts." : "No HTLCs addressed to you.", "muted");
    var table = doc.createElement("table"); table.className = "node-table";
    table.appendChild(tableHead(doc, ["Contract", "Amount", "Hash lock", "Expires", ""]));
    var tbody = doc.createElement("tbody");
    rows.forEach(function (r) {
      var tr = doc.createElement("tr"), a = amtText(r.amount_raw, r.asset_id, r.precision), exp, link, td, ac, hc;
      ac = el(doc, "td", a.text); ac.title = "raw " + a.raw;
      var hc = el(doc, "td", r.algo + " — " + shortHash(r.hash_hex)); hc.title = r.hash_hex;
      try { exp = Htlc.formatDateTime(r.expiration_iso); } catch (e) { exp = String(r.expiration_iso || "unknown"); }
      link = el(doc, "a", "Open"); link.setAttribute("href", "#/htlc/" + r.id);
      td = doc.createElement("td"); td.appendChild(link);
      tr.appendChild(el(doc, "td", r.id)); tr.appendChild(ac); tr.appendChild(hc);
      tr.appendChild(el(doc, "td", r.expired ? exp + " (expired)" : exp)); tr.appendChild(td);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); return table;
  }
  function createBox(doc, box, me, myGen) { /* create form; fee RE-READ at review; no preimage echo */
    var fTo = field(doc, "To account", { placeholder: "name or 1.2.N" });
    var fAsset = field(doc, "Asset", { value: "BTS" });
    var fAmount = field(doc, "Amount", { inputmode: "decimal", placeholder: "1.23456" });
    [fTo, fAsset, fAmount].forEach(function (f) { box.appendChild(f.row); });
    var algoSel = selectOpts(doc, touchable(doc.createElement("select")), [["sha256", "sha256"], ["ripemd160", "ripemd160"]]);
    var algoRow = el(doc, "div", null, "xfer-field");
    algoRow.appendChild(el(doc, "span", "Hash: ")); algoRow.appendChild(algoSel);
    algoRow.appendChild(el(doc, "span", " (ripemd160: paste a hash — hashing is sha256-only)", "muted"));
    box.appendChild(algoRow);
    var modeSel = selectOpts(doc, touchable(doc.createElement("select")), [["type", "Type a new preimage"], ["paste", "Paste an existing hash"]]);
    var modeRow = el(doc, "div", null, "xfer-field");
    modeRow.appendChild(el(doc, "span", "Secret: ")); modeRow.appendChild(modeSel); box.appendChild(modeRow);
    var fSecret = field(doc, "Preimage", { placeholder: "secret words" });
    var fHash = field(doc, "Hash hex", { placeholder: "hex of the preimage hash" });
    var fSize = field(doc, "Preimage size (bytes)", { inputmode: "numeric" });
    box.appendChild(fSecret.row); box.appendChild(fHash.row); box.appendChild(fSize.row);
    var period = secsPicker(doc, PRESETS.map(function (p) { return [String(p[1]), p[0]]; }), "Lock time");
    box.appendChild(period.row);
    /* Toggle preimage-vs-paste rows for the Secret mode select (type = preimage row; paste = hash + size rows). */
    function syncMode() {
      var paste = modeSel.value === "paste";
      fSecret.row.style.display = paste ? "none" : "";
      fHash.row.style.display = paste ? "" : "none"; fSize.row.style.display = paste ? "" : "none";
    }
    modeSel.addEventListener("change", syncMode); syncMode();
    reviewSection(doc, box, myGen, "Review HTLC", {
        build: async function () {
          var to = await Account.resolve(fTo.input.value.trim());
          var asset = await Asset.describe(fAsset.input.value.trim() || "BTS"), paste = modeSel.value === "paste", hashHex;
          var pair = await Htlc.buildCreate({ fromId: me.id, toId: to.id, assetId: asset.id,
            amountHuman: fAmount.input.value.trim(), precision: asset.precision, algo: algoSel.value,
            preimageOrNull: paste ? null : fSecret.input.value,
            hashHexOrNull: paste ? fHash.input.value.trim() : null,
            sizeOrNull: paste ? parseInt(String(fSize.input.value).trim(), 10) : null, claimSeconds: period.secs() });
          hashHex = pair[1].preimage_hash[1];
          return { pair: pair, fee: await Htlc.fee(pair, "1.3.0"), asset: asset, to: to,
            prove: async function () {
              try {
                var lists = await Htlc.mine(me.id);
                return lists.sent.concat(lists.received).find(function (r) { return r.hash_hex === hashHex; }) || null;
              } catch (e) { return null; } } };
        },
        rows: function (R, fee) {
          var opData = R.pair[1], hashPair = opData.preimage_hash, secs = opData.claim_period_seconds, amtHuman, periodHuman,
            algoName = hashPair[0] === 2 ? "sha256" : (hashPair[0] === 0 ? "ripemd160" : "unknown(" + hashPair[0] + ")");
          try { amtHuman = Format.formatAmount(opData.amount.amount, R.asset.precision) + " " + R.asset.symbol; }
          catch (e) { amtHuman = String(opData.amount.amount); }
          try { periodHuman = Htlc.formatDuration(secs) + " (" + secs + " s)"; } catch (e) { periodHuman = secs + " s"; }
          var rows = [["From", me.name + " (" + me.id + ")"], ["To", R.to.name + " (" + R.to.id + ")"],
            ["Amount", amtHuman, "raw " + opData.amount.amount], ["Hash algorithm", algoName],
            ["Preimage hash", shortHash(hashPair[1]), hashPair[1]], ["Preimage size", opData.preimage_size + " bytes"],
            ["Claim period", periodHuman], ["Fee", fee.text, "raw " + fee.raw]];
          if (secs > 86400) rows.push(["Network note", "Fee scales per day (fee_per_day)"]);
          rows.push(["Network", "testnet"]); return rows;
        },
        title: "Confirm HTLC", ok: function () { return "HTLC created."; }, clear: [fSecret.input, fHash.input, fSize.input], fail: "Could not prepare the HTLC." });
  }
  /* Route entry: #/htlc/:id — detail + redeem + extend; unknown id is an empty state. */
  function renderHtlcDetail(root, id) {
    if (!root) return;
    var retry = function () { renderHtlcDetail(root, id); };
    var ctx = routeReady(root, "HTLC " + String(id || ""), retry);
    if (!ctx) return;
    var doc = ctx.doc, myGen = ctx.myGen;
    if (typeof id !== "string" || !/^1\.16\.\d+$/.test(id)) {
      ctx.wrap.appendChild(el(doc, "p", "Unknown HTLC contract.", "muted"));
      var back = el(doc, "a", "Back to HTLCs"); back.setAttribute("href", "#/htlc"); ctx.wrap.appendChild(back); return;
    }
    ctx.wrap.appendChild(el(doc, "p", "Loading contract…", "muted"));
    loadAccount(myGen, function () { return Htlc.htlc(id); }).then(function (found) {
      if (!found || myGen !== gen) return;
      var me = found.me, row = found.data, a = amtText(row.amount_raw, row.asset_id, row.precision), exp;
      root.innerHTML = "";
      var box = el(doc, "div", null, "wrap"); root.appendChild(box);
      box.appendChild(el(doc, "h1", "HTLC " + row.id));
      try { exp = Htlc.formatDateTime(row.expiration_iso); } catch (e) { exp = String(row.expiration_iso || "unknown"); }
      box.appendChild(confirmList(doc, [["Contract", row.id], ["From", row.from_id], ["To", row.to_id],
        ["Amount", a.text, "raw " + a.raw], ["Hash algorithm", row.algo], ["Preimage hash", row.hash_hex],
        ["Preimage size", String(row.preimage_size) + " bytes"], ["Expires", row.expired ? exp + " (expired)" : exp]]));
      if (row.expired) box.appendChild(el(doc, "p", "Expired: the sender is refunded automatically; no redeem is possible.", "muted"));
      if (me.id === row.to_id && !row.expired) redeemBox(doc, box, me, row, myGen);
      else if (me.id === row.to_id) box.appendChild(el(doc, "p", "You are the receiver, but this contract expired.", "muted"));
      if (me.id === row.from_id && !row.expired) extendBox(doc, box, me, row, myGen);
      else if (me.id !== row.from_id && me.id !== row.to_id) {
        box.appendChild(el(doc, "p", "You are neither sender nor receiver: read-only for you.", "muted"));
      }
      var back2 = el(doc, "a", "Back to HTLCs"); back2.setAttribute("href", "#/htlc"); box.appendChild(back2);
    }).catch(function (e) {
      if (myGen !== gen) return; routeFail(root, "HTLC " + String(id || ""), e, "Could not load the contract.", retry); });
  }
  function redeemBox(doc, box, me, row, myGen) { /* password input + LIVE hash-match; LENGTH ONLY in confirm */
    box.appendChild(el(doc, "h2", "Redeem"));
    var typeId = row.algo === "sha256" ? 2 : (row.algo === "ripemd160" ? 0 : -1);
    if (typeId < 0) { box.appendChild(el(doc, "p", "Unsupported hash (" + row.algo + "): redeem is disabled.", "muted")); return; }
    var inp = doc.createElement("input");
    inp.type = "password"; inp.setAttribute("placeholder", "preimage"); inp.setAttribute("aria-label", "Preimage");
    touchable(inp); box.appendChild(inp);
    var match = el(doc, "p", "Type the preimage to check it against the locked hash.", "muted");
    match.setAttribute("aria-live", "polite"); box.appendChild(match);
    var timer = null, lastOk = "";
    inp.addEventListener("input", function () {
      if (myGen !== gen) return; reviewBtn.disabled = true; match.textContent = "Checking…"; match.className = "muted";
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        if (myGen !== gen || !inp.value) { match.textContent = "Type the preimage to check it against the locked hash."; return; }
        Htlc.checkPreimage(row.algo, inp.value, typeId, row.hash_hex).then(function (r) {
          if (myGen !== gen) return;
          lastOk = Array.from(new TextEncoder().encode(inp.value),
            function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join("");
          match.textContent = "Hash match ✓ (" + r.size + " bytes)"; match.className = "xfer-ok"; reviewBtn.disabled = false;
        }).catch(function () {
          if (myGen !== gen) return;
          lastOk = ""; match.textContent = "No match — the node would reject this preimage."; match.className = "error";
        });
      }, 400);
    });
    var reviewBtn = reviewSection(doc, box, myGen, "Review redeem", {
        build: async function () {
          if (!lastOk) throw new Error("bad-preimage");
          var pair = Htlc.buildRedeem({ htlcId: row.id, redeemerId: me.id, preimageHex: lastOk });
          return { pair: pair, fee: await Htlc.fee(pair, "1.3.0"), preBytes: lastOk.length / 2,
            prove: async function () {
              try { await Htlc.htlc(row.id); return null; }
              catch (e) { return String((e && e.message) || "") === "unknown-htlc" ? { gone: true } : null; } } };
        },
        rows: function (R, fee) {
          return [["HTLC", row.id], ["Redeemer", me.name + " (" + me.id + ")"], ["Preimage", R.preBytes + " bytes, hash-match ✓"],
            ["Fee", fee.text, "raw " + fee.raw], ["Network", "testnet"]];
        },
        title: "Confirm redeem", ok: function () { return "Redeemed: contract " + row.id + " is gone."; }, clear: [inp], fail: "Could not estimate the redeem fee." });
    reviewBtn.disabled = true;
  }
  function extendBox(doc, box, me, row, myGen) { /* presets + custom, new-expiry preview, live fee */
    box.appendChild(el(doc, "h2", "Extend timelock"));
    var picker = secsPicker(doc, PRESETS.map(function (p) { return [String(p[1]), "+" + p[0]]; }), "Add");
    box.appendChild(picker.row);
    var preview = el(doc, "p", "", "muted"); preview.setAttribute("aria-live", "polite"); box.appendChild(preview);
    var oldSecs = Math.floor(new Date(row.expiration_iso + "Z").getTime() / 1000);
    function humanAdded(n) { var dur, when; /* {dur, when, line} for preview + confirm rows */
      try { dur = Htlc.formatDuration(n) + " (" + n + " s)"; } catch (e) { dur = n + " s"; }
      try { when = Htlc.formatDateTime(new Date((oldSecs + n) * 1000).toISOString().slice(0, 19)); } catch (e) { when = "unknown"; }
      return { dur: dur, when: when, line: "Adds " + dur + " → new expiry " + when + "." };
    }
    function refreshPreview() {
      var n = picker.secs();
      preview.textContent = (!Number.isInteger(n) || n < 1) ? "Enter extra seconds." : humanAdded(n).line; }
    picker.sel.addEventListener("change", refreshPreview);
    picker.custom.addEventListener("input", refreshPreview); refreshPreview();
    reviewSection(doc, box, myGen, "Review extend", {
        build: async function () {
          var n = picker.secs(), h;
          if (!Number.isInteger(n) || n < 1) throw new Error("Extra seconds must be a positive integer.");
          h = humanAdded(n);
          var pair = Htlc.buildExtend({ htlcId: row.id, issuerId: me.id, secondsToAdd: n });
          return { pair: pair, fee: await Htlc.fee(pair, "1.3.0"), h: h, n: n, prove: async function () {
            try {
              var curSecs = Math.floor(new Date((await Htlc.htlc(row.id)).expiration_iso + "Z").getTime() / 1000);
              return curSecs >= oldSecs + n - 5 ? { advanced: true } : null;
            } catch (e) { return null; } } };
        },
        rows: function (R, fee) {
          return [["HTLC", row.id], ["Issuer", me.name + " (" + me.id + ")"], ["Added time", R.h.dur], ["New expiry", R.h.when],
            ["Fee", fee.text, "raw " + fee.raw], ["Network", "testnet"]];
        },
        title: "Confirm extend", ok: function (R) { return "Extended by " + R.n + " seconds."; }, fail: "Could not estimate the extend fee." });
  }
  return { renderHtlc: renderHtlc, renderHtlcDetail: renderHtlcDetail, _ui: {
      el: el, touchable: touchable, clearBox: clearBox, shortHash: shortHash, showError: showError, showStatus: showStatus,
      offlineBox: offlineBox, unlockBox: unlockBox, confirmList: confirmList, field: field, selectOpts: selectOpts, tableHead: tableHead,
      feeText: feeText, headBlock: headBlock, sendConfirm: sendConfirm, reviewPaid: reviewPaid, reviewSection: reviewSection,
      routeReady: routeReady, routeFail: routeFail, loadAccount: loadAccount, amtText: amtText, secsPicker: secsPicker,
      autoRetryOnOpen: autoRetryOnOpen, dropOpenSubs: dropOpenSubs,
      missingBackends: missingBackends, presets: PRESETS } };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.HtlcUI === "undefined") { globalThis.HtlcUI = HtlcUI; }
if (typeof module !== "undefined") { module.exports = HtlcUI; }
