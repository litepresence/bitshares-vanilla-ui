/* trollbox-ui.js — on-chain chat desk (#/trollbox, R1c slice-14 delta).
 * Owns: the #/trollbox route view (channel tabs, language select, plain-text
 *   message list, composer with live byte budget + get_required_fees preview,
 *   unlock-at-post + broadcast + storage read-back proof, 15s poll gated on
 *   document.visibilitychange). No chain math here beyond display (fee human
 *   strings come from Format; byte/budget counts are plain counts, not money).
 * Consumes: Trollbox (probe/pager/budget/builder, read-only), Chain (status,
 *   guarded), Account (myAccountId/resolve, guarded), Wallet (unlock/keys),
 *   Tx (fee/buildTx/sign + net broadcast via Chain), Format (fee display),
 *   I18n.t (guarded fallback). Side effects: DOM under the route root +
 *   one module-level poll timer (cleared on every re-render).
 * Created by: building-vanilla-slices skill, R1c trollbox plan.
 * Refs: astro Trollbox.jsx (behavior) + nanoeffects/Trollbox.ts (probe/pager
 *   rules) @ 5037d61; #4 api.hpp:650-688 (get_storage_info), custom.hpp (op 35).
 */
var TrollboxUI = (function () {
  "use strict";

  var gen = 0;
  var timer = null;
  /* visibilitychange handle for the active mount (single live mount at a
   * time — same contract as the poll timer above). Removed by stopPoll so
   * route leave never leaks a listener. Null when idle. */
  var visFn = null;
  function clearRoot(root) { while (root.firstChild) root.removeChild(root.firstChild); }
  /* Drop the poll timer AND the visibility hook. Safe to call when idle;
   * renderTrollbox calls it on every entry, and an orphaned tick calls it
   * on itself after a route leave (ownership-guarded, never killing a newer
   * mount's timer). Never throws. */
  function stopPoll() {
    try { if (timer !== null) clearInterval(timer); } catch (e) {}
    timer = null;
    try {
      if (visFn && typeof document !== "undefined" && typeof document.removeEventListener === "function") {
        document.removeEventListener("visibilitychange", visFn);
      }
    } catch (e) { /* listener gone */ }
    visFn = null;
  }
  var NATIVE = { en: "English", da: "Dansk", de: "Deutsch", es: "Español",
    et: "Eesti", fr: "Français", it: "Italiano", ja: "日本語", ko: "한국어",
    pt: "Português", th: "ไทย" };

  /* t: locale string with verbatim-English fallback (slice-17 pattern). */
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    if (vars && typeof dflt === "string") return dflt.replace(/%\(([^)]+)\)s/g, function (m, name) {
      return (vars && Object.prototype.hasOwnProperty.call(vars, name)) ? String(vars[name]) : m;
    });
    return dflt;
  }
  /* el: textContent-only element (chain strings never reach HTML). */
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function clearRoot(root) { while (root.firstChild) root.removeChild(root.firstChild); }

  /* broadcastPost: send a signed op-35 tx (callback-first, plain fallback —
   * same wire as Tx.broadcast) then prove inclusion by a DIRECT storage
   * read-back of our own key (get_storage_info catalog+key query per #4
   * api.hpp note 1d — NOT the channel pager, whose first page holds the
   * OLDEST 100 rows and would miss our newest key in a busy channel).
   * Tx.broadcast's history poll is unusable here (it matches op-0 from/to).
   * Params: signedTx, catalog, key. Returns {via, id}. Throws the node's
   * error on broadcast failure, or a do-NOT-rebroadcast timeout when the
   * send was accepted but the key was not read back (same discipline as
   * Tx.broadcast). */
  async function broadcastPost(signedTx, catalog, key) {
    var netId = await Chain.net();
    var via = "broadcast_transaction_with_callback";
    try {
      var cbId = (Math.random() * 4294967296) >>> 0;
      await Chain.call(netId, "broadcast_transaction_with_callback", [cbId, signedTx]);
    } catch (e) {
      via = "broadcast_transaction";
      await Chain.call(netId, "broadcast_transaction", [signedTx]);
    }
    var customId = await Chain.custom();
    var deadline = Date.now() + 30000;
    for (;;) {
      var found = null;
      try {
        var rows = await Chain.call(customId, "get_storage_info", [null, catalog, key, 1]);
        if (rows && rows.length) found = rows[0];
      } catch (e) { found = null; }
      if (found) return { via: via + "+storage-readback", id: found.id };
      if (Date.now() >= deadline) {
        throw new Error("broadcast accepted but the message was not read back within 30000ms; check the channel before retrying (do NOT blindly rebroadcast)");
      }
      await new Promise(function (res) { setTimeout(res, 2500); });
    }
  }

  /* Route entry: full trollbox desk. Params: root (element). */
  function renderTrollbox(root) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    var myGen = ++gen;
    stopPoll();
    clearRoot(root);
    var T = (typeof Trollbox !== "undefined") ? Trollbox : null;
    var wrap = doc.createElement("div"); wrap.className = "wrap trollbox-wrap"; root.appendChild(wrap);

    wrap.appendChild(DOM.pageHead(doc, t("trollbox.title", "Trollbox"), "text"));
    wrap.appendChild(el(doc, "p", t("trollbox.intro", "Messages are posted on-chain from your account and visible to everyone. The sender pays a small network fee per message."), "muted"));

    if (!T) {
      wrap.appendChild(el(doc, "p", t("trollbox.error_body", "The connected node did not answer the plugin probe. Check your connection and retry."), "muted"));
      return;
    }

    /* State for this mount. errCount/hiddenSince/slow drive the poll
     * backoff (15s fast, 60s slow); feeSeq guards the fee preview. */
    var S = {
      channel: "general", lang: "en", probeState: "probing",
      messages: [], loading: false, loadError: null,
      maxBytes: T.maxMessageBytes(), draft: "",
      feeText: "", feeTimer: null, feeSeq: 0, posting: false, postNote: "",
      errCount: 0, hiddenSince: 0, slow: false, myTimer: null
    };
    var SLOW_MS = 60000;
    var HIDDEN_SLOW_MS = 60000;

    /* Status badge (honest empty states live here). */
    var badge = el(doc, "p", t("trollbox.status_checking", "Checking node…"), "muted");
    badge.setAttribute("aria-live", "polite");
    wrap.appendChild(badge);

    /* Channel tabs + language select. */
    var chanBox = doc.createElement("div"); chanBox.className = "trollbox-channels";
    wrap.appendChild(chanBox);
    var tabsRow = doc.createElement("div"); tabsRow.className = "trollbox-tabs"; chanBox.appendChild(tabsRow);
    var langLabel = el(doc, "label", t("trollbox.language_label", "Language") + " ");
    var langSel = doc.createElement("select");
    langSel.classList.add("touchable");
    langSel.setAttribute("aria-label", t("trollbox.language_label", "Language"));
    T.LANGS.forEach(function (code) {
      var opt = doc.createElement("option");
      opt.value = code;
      opt.textContent = (NATIVE[code] || code) + " (" + code + ")";
      langSel.appendChild(opt);
    });
    langSel.value = S.lang;
    langLabel.appendChild(langSel);
    chanBox.appendChild(langLabel);

    function paintTabs() {
      while (tabsRow.firstChild) tabsRow.removeChild(tabsRow.firstChild);
      T.CHANNELS.forEach(function (id) {
        var b = el(doc, "button", "#" + id, "trollbox-tab subtle-btn");
        b.type = "button";
        b.classList.add("touchable");
        b.setAttribute("aria-pressed", id === S.channel ? "true" : "false");
        if (id === S.channel) b.classList.add("active");
        b.addEventListener("click", function () {
          if (S.channel === id) return;
          S.channel = id;
          S.messages = []; S.loadError = null;
          paintTabs(); loadMessages(); scheduleFee();
        });
        tabsRow.appendChild(b);
      });
    }
    langSel.addEventListener("change", function () {
      var v = langSel.value;
      S.lang = T.isSupportedLang(v) ? v : "en";
      S.messages = []; S.loadError = null;
      loadMessages(); scheduleFee();
    });

    /* Message list (plain text only). */
    wrap.appendChild(el(doc, "h2", t("trollbox.channels_title", "Channels") + ": #" + S.channel, "trollbox-chanhead"));
    var chanHead = wrap.lastChild;
    var listNote = el(doc, "p", "", "muted");
    listNote.setAttribute("aria-live", "polite");
    wrap.appendChild(listNote);
    var list = doc.createElement("ul"); list.className = "trollbox-list"; wrap.appendChild(list);

    function paintBadge() {
      var label = S.probeState === "live" ? t("trollbox.status_live", "Live")
        : S.probeState === "unsupported" ? t("trollbox.status_unsupported", "Plugin unavailable")
        : S.probeState === "error" ? t("trollbox.status_error", "Node unreachable")
        : t("trollbox.status_checking", "Checking node…");
      badge.textContent = label;
      badge.setAttribute("data-state", S.probeState);
    }

    function paintList() {
      try { chanHead.textContent = t("trollbox.channels_title", "Channels") + ": #" + S.channel; } catch (e) {}
      while (list.firstChild) list.removeChild(list.firstChild);
      if (S.loading) {
        listNote.textContent = t("trollbox.loading_messages", "Loading messages…");
        return;
      }
      if (S.loadError) {
        listNote.textContent = String(S.loadError);
        var retry = el(doc, "button", t("trollbox.retry", "Retry"));
        retry.type = "button";
        retry.classList.add("touchable");
        retry.addEventListener("click", function () { loadMessages(); });
        list.appendChild(retry);
        return;
      }
      if (!S.messages.length) {
        listNote.textContent = t("trollbox.empty_channel", "No messages in this channel yet — be the first to post.");
        return;
      }
      listNote.textContent = "";
      var shown = S.messages.slice(0, 100);
      shown.forEach(function (m) {
        var li = doc.createElement("li"); li.className = "trollbox-msg";
        var head = doc.createElement("div"); head.className = "trollbox-msghead";
        head.appendChild(el(doc, "strong", m.displayAuthor || m.account));
        head.appendChild(el(doc, "span", " " + (m.account || ""), "muted"));
        li.appendChild(head);
        li.appendChild(el(doc, "p", m.text || "", "trollbox-msgtext"));
        list.appendChild(li);
      });
    }

    /* Probe then load. Reads need a plugin node; broadcast works from any. */
    async function runProbe() {
      if (myGen !== gen) return;
      S.probeState = "probing"; paintBadge();
      var r;
      try { r = await T.probe(); }
      catch (e) { r = { supported: false, reason: "error" }; }
      if (myGen !== gen) return;
      if (r && r.supported) { S.probeState = "live"; }
      else if (r && r.reason === "missing") { S.probeState = "unsupported"; }
      else { S.probeState = "error"; }
      paintBadge();
      if (S.probeState === "live") { loadMessages(); }
      else {
        var body = S.probeState === "unsupported"
          ? t("trollbox.unsupported_body", "This node does not run the custom_operations plugin, so chat history cannot be read here. Broadcasting still works from any node; switch to a node with the plugin enabled in Settings → Nodes to read history.")
          : t("trollbox.error_body", "The connected node did not answer the plugin probe. Check your connection and retry.");
        S.loadError = body;
        paintList();
        var go = el(doc, "a", t("trollbox.change_node", "Go to node settings"), "btn btn-ghost");
        go.href = "#/settings";
        go.classList.add("touchable");
        wrap.appendChild(go);
      }
    }

    async function loadMessages() {
      if (myGen !== gen || S.probeState !== "live") return;
      S.loading = true; S.loadError = null; paintList();
      var catalog = T.trollboxCatalog(S.channel, S.lang);
      try {
        try { S.maxBytes = await T.fetchMaxMessageBytes(); } catch (e) { /* budget default stands */ }
        var msgs = await T.fetchChannelMessages(catalog, 1);
        if (myGen !== gen) return;
        S.messages = msgs; S.loading = false;
        S.errCount = 0;
        paintList(); paintBudget();
      } catch (e) {
        if (myGen !== gen) return;
        S.loading = false;
        S.errCount = (S.errCount || 0) + 1;
        if (S.errCount >= 2) setSlow(true);
        if (T.isPluginMissingError(e)) {
          S.probeState = "unsupported"; paintBadge();
          S.loadError = t("trollbox.unsupported_body", "This node does not run the custom_operations plugin, so chat history cannot be read here. Broadcasting still works from any node; switch to a node with the plugin enabled in Settings → Nodes to read history.");
        } else {
          S.loadError = (e && e.message) ? e.message : String(e);
        }
        paintList();
      }
    }

    /* Composer: textarea + byte budget + live fee preview + unlock-at-post. */
    wrap.appendChild(el(doc, "h2", t("trollbox.composer_title", "Post a message")));
    var gate = el(doc, "p", t("trollbox.login_gate", "Unlock your wallet to post. Reading works without login."), "muted");
    wrap.appendChild(gate);
    var pwRow = doc.createElement("div"); pwRow.className = "trollbox-row";
    var pwInput = doc.createElement("input");
    pwInput.type = "password";
    pwInput.setAttribute("aria-label", t("trollbox.password_label", "Wallet password"));
    pwInput.placeholder = t("trollbox.password_label", "Wallet password");
    pwInput.classList.add("touchable");
    var unlockBtn = el(doc, "button", t("trollbox.unlock", "Unlock"));
    unlockBtn.type = "button";
    unlockBtn.classList.add("touchable");
    pwRow.appendChild(pwInput); pwRow.appendChild(unlockBtn);
    wrap.appendChild(pwRow);
    var area = doc.createElement("textarea");
    area.rows = 3;
    area.maxLength = 1024;
    area.placeholder = t("trollbox.composer_placeholder", "Write a plain-text message…");
    area.setAttribute("aria-label", t("trollbox.composer_title", "Post a message"));
    area.classList.add("touchable");
    wrap.appendChild(area);
    var budgetLine = el(doc, "p", "", "muted"); wrap.appendChild(budgetLine);
    var feeLine = el(doc, "p", "", "muted"); feeLine.setAttribute("aria-live", "polite"); wrap.appendChild(feeLine);
    var postBtn = el(doc, "button", t("trollbox.post", "Post on-chain"), "btn");
    postBtn.classList.add("touchable");
    postBtn.type = "button";
    wrap.appendChild(postBtn);
    var note = el(doc, "p", "", "muted"); note.setAttribute("aria-live", "polite"); wrap.appendChild(note);

    function unlockedNow() {
      try {
        if (typeof Wallet !== "undefined" && Wallet && typeof Wallet.isUnlocked === "function") return !!Wallet.isUnlocked();
      } catch (e) {}
      return false;
    }
    function refreshGate() {
      var open = unlockedNow();
      gate.style.display = open ? "none" : "";
      pwRow.style.display = open ? "none" : "";
    }

    function paintBudget() {
      var used = 0;
      try { used = T.utf8Length((area.value || "").trim()); } catch (e) { used = 0; }
      budgetLine.textContent = t("trollbox.bytes_prefix", "Bytes: ") + String(used) + " / " + String(S.maxBytes);
    }

    /* Fee preview: ONE live get_required_fees call per draft pause (never
     * estimated). Needs a payer id — the unlocked account when available,
     * else the 1.2.0 placeholder (fee depends on data bytes, not payer).
     * Sequence-guarded (market-desk tipSeq pattern): overlapping previews
     * paint only when still latest — a slow older fetch never overwrites a
     * newer line. */
    function scheduleFee() {
      try { if (S.feeTimer !== null) clearTimeout(S.feeTimer); } catch (e) {}
      S.feeSeq = (S.feeSeq || 0) + 1;
      var s = S.feeSeq;
      S.feeTimer = setTimeout(function () { previewFee(s); }, 500);
    }
    async function previewFee(s) {
      if (myGen !== gen || s !== S.feeSeq) return;
      var text = (area.value || "").trim();
      if (!text) { feeLine.textContent = ""; return; }
      if (text.length > T.TEXT_MAX_CHARS) {
        feeLine.textContent = t("trollbox.over_chars", "Message exceeds 1024 characters — shorten it.");
        return;
      }
      var payer = "1.2.0";
      try {
        if (unlockedNow() && typeof Account !== "undefined" && Account && typeof Account.myAccountId === "function") {
          payer = await Account.myAccountId();
        }
      } catch (e) { payer = "1.2.0"; }
      if (myGen !== gen || s !== S.feeSeq) return;
      var built;
      try {
        built = T.buildPost({ payerId: payer, username: "preview", channel: S.channel, lang: S.lang, text: text, maxBytes: S.maxBytes });
      } catch (e) {
        feeLine.textContent = (e && e.message) ? e.message : String(e);
        return;
      }
      try {
        var fee = await Tx.fee(T.CUSTOM_OP_ID, built.opData, "1.3.0");
        if (myGen !== gen || s !== S.feeSeq) return;
        var dbId = await Chain.db();
        var rows = await Chain.call(dbId, "get_assets", [[fee.asset_id || "1.3.0"]]);
        if (myGen !== gen || s !== S.feeSeq) return;
        var prec = (rows && rows[0] && typeof rows[0].precision === "number") ? rows[0].precision : 5;
        feeLine.textContent = t("trollbox.fee_prefix", "Network fee: ") +
          Format.formatAmount(String(fee.amount), prec) + " (" + String(fee.amount) + " raw)";
      } catch (e) {
        if (myGen !== gen || s !== S.feeSeq) return;
        feeLine.textContent = "";
      }
    }

    area.addEventListener("input", function () {
      S.draft = area.value || "";
      paintBudget(); scheduleFee();
    });
    unlockBtn.addEventListener("click", function () {
      var pw = pwInput.value || "";
      note.textContent = "";
      Promise.resolve().then(function () { return Wallet.unlock(pw); }).then(function () {
        if (myGen !== gen) return;
        try { pwInput.value = ""; } catch (e) {}
        refreshGate(); scheduleFee();
      }).catch(function () {
        if (myGen !== gen) return;
        note.textContent = t("common.unlock_failed", "Unlock failed.");
      });
    });

    postBtn.addEventListener("click", function () {
      if (S.posting) return;
      note.textContent = "";
      var text = (area.value || "").trim();
      if (!text) { note.textContent = t("trollbox.empty_text", "Message text is empty."); return; }
      if (text.length > T.TEXT_MAX_CHARS) { note.textContent = t("trollbox.over_chars", "Message exceeds 1024 characters — shorten it."); return; }
      if (!unlockedNow()) { note.textContent = t("trollbox.login_gate", "Unlock your wallet to post. Reading works without login."); return; }
      S.posting = true;
      postBtn.disabled = true;
      note.textContent = t("trollbox.posting", "Posting…");
      Promise.resolve().then(async function () {
        var payerId = await Account.myAccountId();
        var acct = await Account.resolve(payerId);
        var username = (acct && acct.name) || payerId;
        var maxBytes = await T.fetchMaxMessageBytes();
        if (myGen !== gen) throw new Error("navigated away");
        var built = T.buildPost({ payerId: payerId, username: username, channel: S.channel, lang: S.lang, text: text, maxBytes: maxBytes });
        var fee = await Tx.fee(T.CUSTOM_OP_ID, built.opData, "1.3.0");
        built.opData.fee = { amount: fee.amount, asset_id: fee.asset_id };
        var unsigned = await Tx.buildTx([[T.CUSTOM_OP_ID, built.opData]]);
        var wif = (Wallet.keys && Wallet.keys.active) ? Wallet.keys.active.wif : null;
        if (!wif) throw new Error("wallet-locked");
        var signed = await Tx.sign(unsigned, wif);
        return broadcastPost(signed, built.catalog, built.key);
      }).then(function (res) {
        if (myGen !== gen) return;
        S.posting = false; postBtn.disabled = false;
        note.textContent = t("trollbox.posted_ok", "Posted and read back on-chain.") + " (" + (res.via || "broadcast") + ")";
        try { area.value = ""; } catch (e) {}
        S.draft = ""; paintBudget(); feeLine.textContent = "";
        loadMessages();
      }).catch(function (e) {
        if (myGen !== gen) return;
        S.posting = false; postBtn.disabled = false;
        note.textContent = t("trollbox.post_failed_prefix", "Post failed: ") + ((e && e.message) ? e.message : String(e));
      });
    });

    /* Poll backoff (fast 15s, slow 60s): hidden-over-a-minute and
     * error-streak (2+) drop to the slow cadence; visible + clean restore
     * fast. Stale-mount ticks self-clear (route-leave wiring — an orphaned
     * tick never kills a newer mount's timer: ownership-guarded). */
    function setSlow(on) {
      if (myGen !== gen) return;
      if (!!S.slow === !!on) return;
      S.slow = !!on;
      if (timer === S.myTimer) { stopPoll(); armPoll(); }
    }
    function armPoll() {
      /* Timer-only re-arm (slow/fast switch): the visibility hook survives —
       * stopPoll (full teardown incl. the hook) runs on route leave only. */
      try { if (timer !== null) clearInterval(timer); } catch (e) { /* gone */ }
      timer = null;
      try {
        timer = setInterval(tick, S.slow ? SLOW_MS : T.POLL_MS);
        S.myTimer = timer;
      } catch (e) { timer = null; S.myTimer = null; }
    }
    function tick() {
      if (myGen !== gen) {
        if (timer !== null && timer === S.myTimer) stopPoll();
        return;
      }
      var hidden = false;
      try { hidden = !!(typeof document !== "undefined" && document.hidden); } catch (e) { hidden = false; }
      if (hidden) {
        if (!S.hiddenSince) S.hiddenSince = Date.now();
        try {
          if (Date.now() - S.hiddenSince > HIDDEN_SLOW_MS) setSlow(true);
        } catch (e) { /* next tick decides */ }
        return;
      }
      S.hiddenSince = 0;
      if (S.slow && !S.errCount) setSlow(false);
      if (S.probeState === "live" && !S.posting) loadMessages();
    }

    /* Boot: tabs, budget, probe; 15s poll gated on visibility. */
    paintTabs(); paintBadge(); paintBudget(); refreshGate();
    runProbe();
    armPoll();
    try {
      if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
        try {
          if (visFn && typeof document.removeEventListener === "function") {
            document.removeEventListener("visibilitychange", visFn);
          }
        } catch (e) { /* fresh hook below */ }
        visFn = function () {
          if (myGen !== gen) { stopPoll(); return; }
          var hidden = false;
          try { hidden = !!document.hidden; } catch (e) { hidden = false; }
          if (!hidden) {
            S.hiddenSince = 0;
            if (S.slow && !S.errCount) setSlow(false);
            tick();
          }
        };
        document.addEventListener("visibilitychange", visFn);
      }
    } catch (e) { /* poll stands without the hook */ }
  }

  return { renderTrollbox: renderTrollbox };
})();

if (typeof module !== "undefined") { module.exports = TrollboxUI; }
