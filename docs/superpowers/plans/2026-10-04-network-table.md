# Merged Network Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One node table lists both networks with a NETWORK column (chain-id coloring, yellow unless `4018…`); row tap switches node + network; the radio toggle is deleted.

**Architecture:** Pure derivation helpers (`listNetwork`/`netFromChain`/`networkLabel`/`networkHealth`) tested headless; `allNodes` merges both default lists + customs; `probeAll` pins expected-chain per row and records observed chains in memory; `selectNode` becomes `Promise<boolean>` (probe-first for unknown customs, rerender only on network flip); radios deleted; one locale key via one-shot surgery.

**Tech Stack:** Vanilla JS (ES5-style `var`, JSDoc), Python 3 stdlib, CSS tokens. No new dependencies.

## Global Constraints

- Zero runtime dependencies: stdlib only, no npm, no CDN, no build step required to serve.
- Every `t("key", "default")` call is single-line, double-quoted, default byte-equals the `en.json` value (`tooling/check_i18n.py` drift gate).
- New locale key `settings.th_network` lands in ALL 12 `vanilla/locales/*.json` dicts AND all 12 `_meta.translated` lists.
- Every new/changed JS function keeps JSDoc `@param`/`@returns` (`bash tooling/check_types.sh`).
- New files open with a module-header block comment (principle #8).
- `tooling/check_rot.py` stays green.
- Table never shows a network color it did not observe (pre-probe cells uncolored); footer/selection never follows the wrong chain (connect pin untouched).
- `vanilla/version.json` is not involved; never touch `/workspace/reference/*`.

**Spec:** `docs/superpowers/specs/2026-10-04-network-table-design.md`

---

### Task 1: Pure network helpers + node test (TDD)

**Files:**
- Create: `tooling/node-network-test.js`
- Modify: `vanilla/js/settings-nodes.js` (insert helper block before the `/* geoText:` comment; extend `_test` export)

**Interfaces:**
- Consumes: `Store.DEFAULT_NODES`/`Store.CHAIN_IDS` (guarded; tests stub `global.Store`), `healthFor` (existing, same file).
- Produces (via `SettingsNodes._test` for Task 2 wiring + tests):
  - `listNetwork(url)` → `"mainnet" | "testnet" | ""`
  - `netFromChain(chainId)` → `"mainnet" | "testnet" | ""`
  - `networkLabel(t, net, chainId)` → `string`
  - `networkHealth(net, chainId)` → `"good" | "warn" | "bad" | ""`

- [ ] **Step 1: Write the failing test** — create `tooling/node-network-test.js` with exactly:

```js
/* node-network-test.js — unit vectors for merged-table network helpers
 * (settings-nodes.js listNetwork/netFromChain/networkLabel/networkHealth).
 * Stdlib only: `node tooling/node-network-test.js` (exit 0 = green). Covers
 * list-vs-chain derivation, display labels, and the yellow-unless-4018
 * color rule. No DOM, no network, no deps (Store stubbed globally).
 */
"use strict";
var assert = require("assert");
global.Store = {
  DEFAULT_NODES: { mainnet: ["wss://m1", "wss://m2"], testnet: ["wss://t1"] },
  CHAIN_IDS: {
    mainnet: "4018d7844c78f6a6c41c6a552b898022310fc5dec06da467ee7905a8dad512c8",
    testnet: "39f5e2ede1f8bc1a3a54a7914414e3779e33193f1f5693510e73cb7a87617447"
  }
};
var SN = require("../vanilla/js/settings-nodes.js");
var T = SN._test;
["listNetwork", "netFromChain", "networkLabel", "networkHealth"].forEach(function (k) {
  assert.ok(T && typeof T[k] === "function", "_test." + k + " exported");
});
function t(k, d) { return d; }
var passed = 0;
function eq(actual, expected, name) {
  assert.strictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}
var MID = "4018d7844c78f6a6c41c6a552b898022310fc5dec06da467ee7905a8dad512c8";
var TID = "39f5e2ede1f8bc1a3a54a7914414e3779e33193f1f5693510e73cb7a87617447";
eq(T.listNetwork("wss://m1"), "mainnet", "mainnet default");
eq(T.listNetwork("wss://m2"), "mainnet", "second mainnet default");
eq(T.listNetwork("wss://t1"), "testnet", "testnet default");
eq(T.listNetwork("wss://x"), "", "custom unknown");
eq(T.listNetwork(null), "", "null url");
eq(T.listNetwork(""), "", "empty url");
eq(T.netFromChain(MID), "mainnet", "mainnet chain");
eq(T.netFromChain(MID.toUpperCase()), "mainnet", "case-insensitive");
eq(T.netFromChain(TID), "testnet", "testnet chain");
eq(T.netFromChain("abcd"), "", "unknown chain");
eq(T.netFromChain(null), "", "null chain");
eq(T.netFromChain(""), "", "empty chain");
eq(T.networkLabel(t, "mainnet", null), "mainnet", "label mainnet");
eq(T.networkLabel(t, "testnet", null), "testnet", "label testnet");
eq(T.networkLabel(t, "", "abcd1234"), "abcd", "label chain prefix");
eq(T.networkLabel(t, "", null), "—", "label dash");
eq(T.networkHealth("mainnet", MID), "good", "mainnet chain green");
eq(T.networkHealth("testnet", TID), "warn", "testnet chain yellow");
eq(T.networkHealth("mainnet", TID), "bad", "default answering foreign chain red");
eq(T.networkHealth("", TID), "warn", "custom testnet yellow");
eq(T.networkHealth("", "ffff"), "warn", "custom unknown chain yellow");
eq(T.networkHealth("", MID), "good", "custom mainnet green");
eq(T.networkHealth("mainnet", null), "", "unprobed uncolored");
eq(T.networkHealth("", null), "", "unknown uncolored");
delete global.Store;
console.log("node-network-test: " + passed + " passed, 0 failed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tooling/node-network-test.js`
Expected: FAIL with `_test.listNetwork exported` (helpers not exported yet).

- [ ] **Step 3: Write minimal implementation** — in `vanilla/js/settings-nodes.js`, insert the block below immediately before the line `  /* geoText: pure location-cell content.` (unique), and extend the `_test` export (old: `provText: provText, healthFor: healthFor }`, new: `provText: provText, healthFor: healthFor, listNetwork: listNetwork, netFromChain: netFromChain, networkLabel: networkLabel, networkHealth: networkHealth }`):

```js
  /* listNetwork: which default list owns a URL (customs return "").
   * Params: url string. Returns "mainnet"|"testnet"|"". Never throws
   * (Store missing -> ""). */
  function listNetwork(url) {
    try {
      if (typeof url !== "string" || !url) return "";
      if (typeof Store === "undefined" || !Store || !Store.DEFAULT_NODES) return "";
      var mains = Store.DEFAULT_NODES.mainnet || [];
      var tests = Store.DEFAULT_NODES.testnet || [];
      for (var i = 0; i < mains.length; i++) if (mains[i] === url) return "mainnet";
      for (var j = 0; j < tests.length; j++) if (tests[j] === url) return "testnet";
    } catch (e) { /* "" below */ }
    return "";
  }

  /* netFromChain: network for an observed chain id (customs after probe).
   * Params: chainId string|null. Returns "mainnet"|"testnet"|"".
   * Never throws (ids missing -> ""). */
  function netFromChain(chainId) {
    try {
      if (typeof chainId !== "string" || !chainId) return "";
      if (typeof Store === "undefined" || !Store || !Store.CHAIN_IDS) return "";
      var low = chainId.toLowerCase();
      if (Store.CHAIN_IDS.mainnet && low === String(Store.CHAIN_IDS.mainnet).toLowerCase()) return "mainnet";
      if (Store.CHAIN_IDS.testnet && low === String(Store.CHAIN_IDS.testnet).toLowerCase()) return "testnet";
    } catch (e) { /* "" below */ }
    return "";
  }

  /* networkLabel: NETWORK cell text. Params: t (injected lookup), net
   * ("mainnet"|"testnet"|""), chainId (observed or null). Returns the
   * keyed network name, the 4-char chain prefix, or the keyed dash.
   * Never throws. */
  function networkLabel(t, net, chainId) {
    var dash = "—";
    try { dash = String(t("settings.dash", "—")); } catch (e) { /* dash stands */ }
    try {
      if (net === "mainnet") return String(t("settings.network_mainnet", "mainnet"));
      if (net === "testnet") return String(t("settings.network_testnet", "testnet"));
      if (typeof chainId === "string" && chainId) return chainId.slice(0, 4);
    } catch (e) { /* dash below */ }
    return dash;
  }

  /* networkHealth: NETWORK cell color. Params: net, chainId (observed or
   * null). Returns "good" (mainnet chain) | "warn" (testnet or any other
   * chain — owner rule: yellow unless 4018) | "bad" (listed default
   * answering a foreign chain) | "" (unprobed: unknown never guesses).
   * Never throws. */
  function networkHealth(net, chainId) {
    try {
      if (typeof chainId !== "string" || !chainId) return "";
      if (net === "mainnet" || net === "testnet") {
        if (typeof Store === "undefined" || !Store || !Store.CHAIN_IDS) return "";
        var exp = Store.CHAIN_IDS[net];
        var match = !!exp && chainId.toLowerCase() === String(exp).toLowerCase();
        return healthFor("chain", null, { network: net, match: match });
      }
      if (typeof Store === "undefined" || !Store || !Store.CHAIN_IDS || !Store.CHAIN_IDS.mainnet) return "";
      if (chainId.toLowerCase() === String(Store.CHAIN_IDS.mainnet).toLowerCase()) return "good";
      return "warn";
    } catch (e) { return ""; }
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node tooling/node-network-test.js`
Expected: `node-network-test: 24 passed, 0 failed` (exit 0).

- [ ] **Step 5: Run type gate + regression**

Run: `bash tooling/check_types.sh`
Expected: PASS on `vanilla/js/settings-nodes.js` (grep output for `settings-nodes` shows zero lines; repo-wide red from unrelated parallel splits is out of scope — record what you see).

Run: `node tooling/node-health-test.js`
Expected: exit 0 (existing `_test` seam extended, nothing removed).

- [ ] **Step 6: Commit**

```bash
git add tooling/node-network-test.js vanilla/js/settings-nodes.js
git commit -m "Network table: pure network helpers + node vectors"
```

---

### Task 2: Merged table + selection-flips-network + probe updates

**Files:**
- Modify: `vanilla/js/settings-nodes.js` (`allNodes`, `seenChain`/`noteChain`, `probeAll` three outcomes, `setRow`, `buildNodeTable`, `buildNodeCards`, `selectNode`)
- Modify: `vanilla/js/settings.js` (node-radio + card handlers gain rerender-if-flipped + label refresh)
- Modify: `vanilla/css/app.css` (card margin list gains `.node-network`)

**Interfaces:**
- Consumes: Task 1 helpers (`listNetwork`, `netFromChain`, `networkLabel`, `networkHealth` — module-local, no export needed beyond `_test`).
- Produces: `allNodes(settings)` → mainnet defaults + testnet defaults + customs; `selectNode(url)` → `Promise<boolean>` (true = network flipped); NETWORK column painted by existing `setRow` path.

- [ ] **Step 1: Merge allNodes** — old (exact, `vanilla/js/settings-nodes.js:20-35`):

```js
  /* Defaults + customs joined, de-duplicated, order-stable (defaults first).
   * Params: settings (Store.loadSettings shape: {network, customNodes}).
   * Returns: array of wss:// URL strings. Fails: never (garbage entries drop). */
  function allNodes(settings) {
    var defaults = (Store.DEFAULT_NODES && Store.DEFAULT_NODES[settings.network]) || [];
    var customs = Array.isArray(settings.customNodes) ? settings.customNodes : [];
```

New:

```js
  /* Both networks' defaults + customs joined, de-duplicated, order-stable
   * (mainnet defaults, testnet defaults, customs). The table owns network
   * switching, so every row is always listed. Params: settings
   * (Store.loadSettings shape: {network, customNodes}). Returns: array of
   * wss:// URL strings. Fails: never (garbage entries drop). */
  function allNodes(settings) {
    var mains = (Store.DEFAULT_NODES && Store.DEFAULT_NODES.mainnet) || [];
    var tests = (Store.DEFAULT_NODES && Store.DEFAULT_NODES.testnet) || [];
    var customs = Array.isArray(settings.customNodes) ? settings.customNodes : [];
```

And old `    defaults.concat(customs).forEach(function (u) {` becomes `    mains.concat(tests).concat(customs).forEach(function (u) {`.

- [ ] **Step 2: Observed-chain memory** — insert immediately before the line `  /* Sequential health probe over the node list (one socket at a time —` (unique):

```js
  /* Observed chain ids per URL, this page-load only (lets selectNode reuse
   * a probe this session ran instead of re-probing; no storage churn —
   * absence just means probe-first). Never read before write fails: a
   * missing entry is "". */
  var seenChain = {};
  function noteChain(url, chainId) {
    try {
      if (typeof url === "string" && url && typeof chainId === "string" && chainId) seenChain[url] = chainId;
    } catch (e) { /* memory best-effort */ }
  }
```

- [ ] **Step 3: probeAll per-row expectation** — old (exact):

```js
      Chain.probe(url, 6000).then(function (r) {
        /* H1: a probe hit on the wrong chain paints as a mismatch (down),
         * never as a healthy row — selecting it would sign wrong-chain. */
        var mismatch = false;
        var netName = "";
        try {
          var st = Store.loadSettings();
          netName = (st && st.network) || "";
          var exp = Store.CHAIN_IDS && Store.CHAIN_IDS[st.network];
          if (exp && r && r.chainId &&
              String(r.chainId).toLowerCase() !== String(exp).toLowerCase()) mismatch = true;
        } catch (pinErr) { mismatch = false; }
        var prefix = "";
        try { prefix = String(r.chainId || "").slice(0, 8); } catch (sliceErr) { prefix = ""; }
```

New:

```js
      Chain.probe(url, 6000).then(function (r) {
        var cid = "";
        try { cid = (r && typeof r.chainId === "string") ? r.chainId : ""; } catch (cidErr) { cid = ""; }
        noteChain(url, cid);
        /* Per-row expectation: listed defaults answer their list's chain
         * (a foreign answer stays a red mismatch); customs answer anything
         * and are labeled by what they show. */
        var rowNet = listNetwork(url);
        var mismatch = false;
        try {
          var exp = (rowNet && Store.CHAIN_IDS) ? Store.CHAIN_IDS[rowNet] : null;
          if (exp && cid && cid.toLowerCase() !== String(exp).toLowerCase()) mismatch = true;
        } catch (pinErr) { mismatch = false; }
        var dispNet = rowNet || netFromChain(cid);
        var prefix = "";
        try { prefix = String(r.chainId || "").slice(0, 8); } catch (sliceErr) { prefix = ""; }
```

- [ ] **Step 4: Paint NETWORK in all three outcomes** — (a) mismatch `setRow`, old (exact):

```js
          setRow(row, { lat: latencyText(t, r.latencyMs), ping: pingText(t, r.pingMs), part: partText(t, r.participation), head: headText(t, r.headAgeS), chain: "mismatch " + mChain4 }, "down",
            detailText(r, prefix, "wrong chain for this network"),
            { lat: healthFor("hs", r.latencyMs), ping: healthFor("ping", r.pingMs), part: partText(t, r.participation), head: headText(t, r.headAgeS), chain: "bad" });
```

New: cells gain `network: networkLabel(t, dispNet, cid),` after the `chain:` entry; health gains `network: networkHealth(dispNet, cid),` after `chain: "bad"`. (b) success `setRow`, old (exact):

```js
          setRow(row, { lat: latencyText(t, r.latencyMs), ping: pingText(t, r.pingMs), part: partText(t, r.participation), head: headText(t, r.headAgeS),
            chain: (v.status === "GOOD") ? prefix.slice(0, 4) : (pill + " · " + prefix.slice(0, 4)) },
            id, detailText(r, prefix, extra),
            { lat: healthFor("hs", r.latencyMs), ping: healthFor("ping", r.pingMs), part: partText(t, r.participation), head: headText(t, r.headAgeS),
              chain: healthFor("chain", null, { network: netName, match: true }) });
```

New: cells gain `network: networkLabel(t, dispNet, cid),` after the `chain:` entry; health `chain:` becomes `chain: networkHealth(dispNet, cid)`. (c) catch `setRow`, old (exact):

```js
        setRow(row, { lat: t("settings.dash", "—"), ping: t("settings.dash", "—"), part: t("settings.dash", "—"), head: t("settings.dash", "—"),
          chain: timeout ? t("settings.node_timeout", "Timeout") : t("settings.down", "down") },
          "down", extra || undefined, { chain: "bad" });
```

New: cells gain `network: networkLabel(t, listNetwork(url), null),` after the `chain:` entry (health untouched → uncolored).

- [ ] **Step 5: setRow paints .node-network** — old (exact): `      var chn = root.querySelector(".node-chain");` → append after it `      var nnet = root.querySelector(".node-network");`. Old (exact): `      if (chn && typeof c.chain === "string") chn.textContent = c.chain;` → append after it `      if (nnet && typeof c.network === "string") nnet.textContent = c.network;`. Old (exact): `      hue(lat, "lat"); hue(png, "ping"); hue(prt, "part"); hue(hed, "head"); hue(chn, "chain");` → append ` hue(nnet, "network");` to the line.

- [ ] **Step 6: Table + card NETWORK cells** — header, old (exact line): `    ["", t("settings.th_node", "Node"), t("settings.th_location", "Location *"), t("settings.th_provider", "Provider *"), t("settings.th_handshake", "Handshake"), t("settings.th_ping", "Ping"), t("settings.th_participation", "Participation"), t("settings.th_head", "Head"), t("settings.th_chain", "Chain"), t("settings.th_history", "History"), ""].forEach(function (t) {` → insert `t("settings.th_network", "Network"), ` after the Node entry. Row, old (exact):

```js
      var tdUrl = doc.createElement("td");
      tdUrl.textContent = url;
      tr.appendChild(tdUrl);
```

append after it:

```js
      var tdNet = doc.createElement("td");
      var netSpan = doc.createElement("span");
      netSpan.className = "node-network";
      netSpan.textContent = networkLabel(t, listNetwork(url), null);
      tdNet.appendChild(netSpan);
      tr.appendChild(tdNet);
```

Cards, old (exact):

```js
      var urlDiv = doc.createElement("div");
      urlDiv.className = "node-card-url";
      urlDiv.textContent = url;
      card.appendChild(urlDiv);
```

append after it:

```js
      var netSpan = doc.createElement("span");
      netSpan.className = "node-network";
      netSpan.textContent = networkLabel(t, listNetwork(url), null);
      card.appendChild(netSpan);
```

CSS (`vanilla/css/app.css`), old (exact):

```css
  .node-card .latency, .node-card .ping, .node-card .part, .node-card .node-head,
  .node-card .node-chain, .node-card .node-history, .node-card .node-geo,
  .node-card .node-provider { margin-right: 8px; }
```

New: add ` .node-card .node-network,` to the selector list (after `.node-chain,`).

- [ ] **Step 7: selectNode flips networks** — old (exact):

```js
  /* Persist the active node and reconnect the shared socket now (the badge
   * + next probe pass carry any error — never a throw here).
   * Params: url string. Fails: never (connect errors are swallowed). */
  function selectNode(url) {
    Store.saveSettings({activeNode: url});
    if (typeof Chain !== "undefined" && Chain && Chain.connect) {
      try { Chain.connect(url); } catch (e) { /* probe/badge carries the error */ }
    }
  }
```

New:

```js
  /* Persist the active node (+ network when the row determines one) and
   * reconnect now (badge + next probe carry any error). Customs with no
   * observed chain probe first (tap = consent); a failed first probe falls
   * back to node-only (the connect chain-id pin guards wrong-chain).
   * Params: url string. Returns a Promise resolving true when the network
   * flipped (caller rerenders for the testnet note), false otherwise.
   * Never throws. */
  function selectNode(url) {
    function apply(net) {
      var prev = "";
      try {
        var st = Store.loadSettings();
        prev = (st && st.network) || "";
      } catch (e) { /* prev stands */ }
      var patch = { activeNode: url };
      if (net === "mainnet" || net === "testnet") patch.network = net;
      try { Store.saveSettings(patch); } catch (e) { return Promise.resolve(false); }
      if (typeof Chain !== "undefined" && Chain && Chain.connect) {
        try { Chain.connect(url); } catch (e) { /* badge carries the error */ }
      }
      return Promise.resolve((net === "mainnet" || net === "testnet") ? net !== prev : false);
    }
    try {
      var known = listNetwork(url) || netFromChain(seenChain[url] || "");
      if (known) return apply(known);
      if (typeof Chain !== "undefined" && Chain && typeof Chain.probe === "function") {
        return Chain.probe(url, 6000).then(function (r) {
          var cid = (r && typeof r.chainId === "string") ? r.chainId : "";
          noteChain(url, cid);
          return apply(netFromChain(cid));
        }).then(null, function () { return apply(""); });
      }
      return apply("");
    } catch (e) { return Promise.resolve(false); }
  }
```

- [ ] **Step 8: Handlers rerender on flip + refresh labels** — in `vanilla/js/settings.js`, insert before the line `    // Events: node radios` (unique):

```js
    /* Card Select/Selected labels go stale without a rerender (radios flip
     * natively). Refresh after every selection; full render only when the
     * network flipped (testnet note visibility). Params: none (closure).
     * Returns nothing. Never throws. */
    function refreshSelectLabels() {
      var active = "";
      try { active = Store.loadSettings().activeNode || ""; } catch (e) { /* labels stand */ }
      Array.prototype.forEach.call(cards.querySelectorAll(".node-select"), function (b) {
        var on = false;
        try { on = b.getAttribute("data-url") === active; } catch (e) { /* keep */ }
        b.textContent = on ? t("settings.selected", "Selected") : t("settings.select", "Select");
      });
    }
```

Old radio handler (exact):

```js
    // Events: node radios
    Array.prototype.forEach.call(tbody.querySelectorAll('input[name="node"]'), function (r) {
      r.addEventListener("change", function () {
        if (r.checked) SettingsNodes.selectNode(r.value);
      });
    });
```

New:

```js
    // Events: node radios (selection may flip networks -> rerender then)
    Array.prototype.forEach.call(tbody.querySelectorAll('input[name="node"]'), function (r) {
      r.addEventListener("change", function () {
        if (!r.checked) return;
        try {
          SettingsNodes.selectNode(r.value).then(function (flipped) {
            try { refreshSelectLabels(); } catch (e) { /* labels stand */ }
            if (flipped) render(rootEl);
          });
        } catch (e) { /* selection stands */ }
      });
    });
```

Old card handler (exact):

```js
    // Events: card select buttons
    Array.prototype.forEach.call(cards.querySelectorAll(".node-select"), function (b) {
      b.addEventListener("click", function () {
        SettingsNodes.selectNode(b.getAttribute("data-url"));
      });
    });
```

New:

```js
    // Events: card select buttons (selection may flip networks -> rerender then)
    Array.prototype.forEach.call(cards.querySelectorAll(".node-select"), function (b) {
      b.addEventListener("click", function () {
        try {
          SettingsNodes.selectNode(b.getAttribute("data-url")).then(function (flipped) {
            try { refreshSelectLabels(); } catch (e) { /* labels stand */ }
            if (flipped) render(rootEl);
          });
        } catch (e) { /* selection stands */ }
      });
    });
```

- [ ] **Step 9: Run tests + type gate**

Run: `node tooling/node-network-test.js`
Expected: `node-network-test: 24 passed, 0 failed` (exit 0).

Run: `node tooling/node-health-test.js && node tooling/probe-geo-wiring-test.js`
Expected: both exit 0 (seam extended, table/cards gained a cell the geo test does not assert on).

Run: `bash tooling/check_types.sh`
Expected: zero lines mentioning `settings-nodes` or `settings.js`; repo-wide red from unrelated parallel splits is out of scope — record what you see.

- [ ] **Step 10: Commit**

```bash
git add tooling/node-network-test.js vanilla/js/settings-nodes.js vanilla/js/settings.js vanilla/css/app.css
git commit -m "Network table: merged rows, NETWORK column, selection flips network"
```

---

### Task 3: Delete the radio toggle

**Files:**
- Modify: `vanilla/js/settings-prefs.js` (delete `buildNetwork` + export + header mention)
- Modify: `vanilla/js/settings.js` (delete toggle build + handler + comment mention)

**Interfaces:** Consumes: nothing (pure deletion). Produces: no `buildNetwork` export; no `net-toggle` in DOM. `settings.network_mainnet/testnet` keys stay (footer `netHostText` + new table labels use them).

- [ ] **Step 1: Delete builder** — in `vanilla/js/settings-prefs.js`, delete the block from `  /* Network toggle (mainnet/testnet radios, current network checked).` through the closing `  }` just before `  /* Theme selector (ref-ui-theme`. (Lines 22-43 as read 2026-10-04; verify boundaries by reading before deleting — the block ends at the lone `  }` preceding the Theme comment.) Delete the export line `    buildNetwork: buildNetwork,` (unique). Header, old (exact): `  * Owns: the network toggle (mainnet/testnet radios), the theme selector` new: `  * Owns: the theme selector`. (Line 3 `  *   (ref-ui-theme/vanilla-ui-theme/dex-ux-theme), and the locale switcher` stays valid.)

- [ ] **Step 2: Delete render + handler** — in `vanilla/js/settings.js`, delete (exact):

```js
    var netToggle = SettingsPrefs.buildNetwork(doc, settings, t);
    wrap.appendChild(netToggle);
```

Delete the handler block from `    // Events: network toggle` through its closing `    });` (the `input[name="network"]` forEach, lines 167-179 as read 2026-10-04 — verify boundaries; it ends at the `    });` just before the blank line preceding `    // Events: probe-all + retry`). Comment, old (exact): `   *   old-UI order: title, network, node table + cards (with history pills),` new: `   *   old-UI order: title, node table + cards (with history pills),`.

- [ ] **Step 3: Verify no stragglers + gates**

Run: `grep -rn "buildNetwork\|net-toggle\|input\[name=\"network\"\]" /workspace/vanilla/js /workspace/vanilla/index.html`
Expected: zero matches.

Run: `node tooling/node-network-test.js && node tooling/node-health-test.js`
Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add vanilla/js/settings-prefs.js vanilla/js/settings.js
git commit -m "Network table: delete radio toggle (table owns switching)"
```

---

### Task 4: th_network key + gates + manual matrix

**Files:**
- Create: `tooling/add_net_th_i18n.py`
- Modify: `vanilla/locales/*.json` (12 files, via re-run-safe one-shot)
- Verify: everything below

**Interfaces:** Consumes: header default `"Network"` (must byte-match Task 2's `t("settings.th_network", "Network")`).

- [ ] **Step 1: Write the one-shot** — create `tooling/add_net_th_i18n.py` with exactly:

```python
#!/usr/bin/env python3
"""One-shot: node-table NETWORK column header (2026-10-04).

Adds settings.th_network ("Network") to all 12 vanilla/locales/*.json
as honest English stubs (principle #10 — translators verify later).
MAINNET/TESTNET cell words reuse settings.network_mainnet/testnet;
chain prefixes and dashes are verbatim values, never translated.

Exact string surgery only (no JSON round-trip, diffs stay minimal).
Safe to re-run: finished files match nothing and are left untouched.
Aborts a file on an unexpected hit count. Verify with:
  python3 tooling/check_i18n.py
"""
import glob
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "vanilla", "locales")

# (pattern, replacement, done_marker); every file must hit exactly once
# unless its done_marker is already present.
STEPS = [
    # dict: th_network after th_location (anchors verified byte-identical
    # in en/de 2026-10-04; runner aborts any file that differs).
    (re.compile(r'^    "th_location": "Location \*",\n', re.MULTILINE),
     '    "th_location": "Location *",\n    "th_network": "Network",\n',
     '"th_network"'),
    # _meta.translated, alpha order (th_location < th_network < th_node).
    (re.compile(r'^(      "settings\.th_location",\n)(      "settings\.th_node",\n)',
                re.MULTILINE),
     '\\1      "settings.th_network",\n\\2',
     '"settings.th_network"'),
]


def main():
    paths = sorted(glob.glob(os.path.join(LOCALES, "*.json")))
    if len(paths) != 12:
        print("ABORT: expected 12 locale files, found %d" % len(paths))
        return 1
    for path in paths:
        with open(path, encoding="utf-8") as f:
            text = f.read()
        changed = False
        for pat, repl, marker in STEPS:
            if marker in text:
                continue
            hits = len(pat.findall(text))
            if hits != 1:
                print("ABORT %s: %d hits" % (path, hits))
                return 1
            text = pat.sub(repl, text, count=1)
            changed = True
        if changed:
            with open(path, "w", encoding="utf-8") as f:
                f.write(text)
            print("updated " + os.path.basename(path))
    print("done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Run and verify green**

Run: `python3 tooling/add_net_th_i18n.py`
Expected: 12 `updated XX.json` lines plus `done` (or `done` only on re-run).

Run: `python3 tooling/check_i18n.py`
Expected: exit 0.

Run: `python3 tooling/check_rot.py`
Expected: exit 0.

- [ ] **Step 3: Manual matrix** — serve: `python3 -m http.server 8080 --directory /workspace/vanilla`. Record observations (pass/fail each):
1. Rows for both networks listed with NETWORK labels (mainnet rows MAINNET, testnet rows TESTNET, customs `—` pre-probe).
2. Probe All paints every row including NETWORK cells (testnet rows yellow).
3. Select a testnet row → footer flips to `TESTNET - …`, testnet note appears, reconnect observed.
4. Select a mainnet row → flips back, note disappears.
5. Add a custom node, select it before probing → probe-first switch (or honest no-switch + pin message on failure).
6. 360px: cards show the network cell; 1440px: table fits; three themes render the column.
7. No radio toggle anywhere on the page.

- [ ] **Step 4: Commit**

```bash
git add tooling/add_net_th_i18n.py vanilla/locales/
git commit -m "Network table: th_network header x12 locales (English stubs)"
```

---

## Self-Review

**1. Spec coverage:** merged rows (§Rows → Task 2 Step 1); NETWORK labels + yellow-unless-4018 (§Rows → Task 2 Steps 4–6, Task 1 rule); mismatch-red stays for defaults (§Rows → Task 2 Step 3–4 mismatch path); selection flips network + probe-first customs (§Selection → Task 2 Steps 7–8); radios deleted (§Decisions → Task 3); Probe All unchanged in kind (§Probing → untouched function, wider input); cards mirror (§Rows → Task 2 Step 6 + CSS); one key (§i18n → Task 4); gates + matrix (§Verification → Tasks 1/4). No gaps.

**2. Placeholder scan:** no TBD/TODO; every code block complete with exact old/new text and anchors; commands carry expected outputs; no "similar to" references.

**3. Type consistency:** `_test` names (`listNetwork`, `netFromChain`, `networkLabel`, `networkHealth`) identical in test, implementation, and Task 2 consumers; `selectNode(url)` → `Promise<boolean>` at both call sites with `.then` + `render(rootEl)` in scope; `setRow` `cells.network`/`health.network` naming consistent across all three outcomes and the paint function; `t("settings.th_network", "Network")` default identical in table header step and one-shot value.
