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

---

### Task 5: Group divider bands (follow-up 2026-10-04)

**Rationale:** owner call — the three row blocks (mainnet/testnet/custom) read as separate tables via a thin background band, while radios stay one `name="node"` set by construction (single tbody, dividers carry no inputs).

**Files:**
- Modify: `vanilla/js/settings-nodes.js` (`groupOf` + `_test`, divider insertion in `buildNodeTable`/`buildNodeCards`, `paintOfflineIfAllDown` skips dataless rows)
- Modify: `tooling/node-network-test.js` (3 vectors, 24 → 27)
- Modify: `vanilla/css/app.css` (divider band rules after the stripe block)

**Interfaces:**
- Consumes: Task 1 `listNetwork` (module-local).
- Produces: `groupOf(url)` → `"mainnet" | "testnet" | "custom"` via `_test`. No other consumers (dividers are presentational; probe/selection logic keys off `data-url`, which dividers lack).

- [ ] **Step 1: groupOf + vectors** — in `vanilla/js/settings-nodes.js`, insert immediately before the line `  /* geoText: pure location-cell content.` (unique):

```js
  /**
   * Visual group for divider bands (mainnet / testnet / custom blocks).
   * @param {string} url node URL
   * @returns {string} "mainnet", "testnet", or "custom" */
  function groupOf(url) {
    var net = "";
    try { net = listNetwork(url); } catch (e) { net = ""; }
    return (net === "mainnet" || net === "testnet") ? net : "custom";
  }

```

Anchor `networkHealth: networkHealth }` (unique — definition sites read `function networkHealth`) → `networkHealth: networkHealth, groupOf: groupOf }`. In `tooling/node-network-test.js`: add `"groupOf"` to the exports `forEach` array; update the header helper list to `listNetwork/netFromChain/networkLabel/networkHealth/groupOf`; append before `console.log`:

```js
eq(T.groupOf("wss://m1"), "mainnet", "group mainnet");
eq(T.groupOf("wss://t1"), "testnet", "group testnet");
eq(T.groupOf("wss://x"), "custom", "group custom");
```

and change the log line to `console.log("node-network-test: " + passed + " passed, 0 failed");` (unchanged text — count becomes 27). Run: `node tooling/node-network-test.js` — expect `27 passed, 0 failed` (TDD: vectors fail first with `_test.groupOf exported`, then pass).

- [ ] **Step 2: Divider rows + cards** — table, old (exact):

```js
    var tbody = doc.createElement("tbody");
    tbody.id = "node-rows";
    table.appendChild(tbody);

    nodes.forEach(function (url) {
      var tr = doc.createElement("tr");
```

New:

```js
    var tbody = doc.createElement("tbody");
    tbody.id = "node-rows";
    table.appendChild(tbody);

    var lastGroup = "";
    nodes.forEach(function (url) {
      var grp = groupOf(url);
      if (lastGroup && grp !== lastGroup) {
        var sep = doc.createElement("tr");
        sep.className = "node-sep";
        sep.setAttribute("aria-hidden", "true");
        var sepTd = doc.createElement("td");
        sepTd.setAttribute("colspan", "12");
        sep.appendChild(sepTd);
        tbody.appendChild(sep);
      }
      lastGroup = grp;
      var tr = doc.createElement("tr");
```

(`colspan 12` = sel+Node+Network+Location+Provider+Handshake+Ping+Participation+Head+Chain+History+action; bump if columns change.) Cards, old (exact):

```js
    var cards = doc.createElement("div");
    cards.className = "node-cards";
    nodes.forEach(function (url) {
      var card = doc.createElement("div");
```

New:

```js
    var cards = doc.createElement("div");
    cards.className = "node-cards";
    var lastGroup = "";
    nodes.forEach(function (url) {
      var grp = groupOf(url);
      if (lastGroup && grp !== lastGroup) {
        var sep = doc.createElement("div");
        sep.className = "node-sep";
        sep.setAttribute("aria-hidden", "true");
        cards.appendChild(sep);
      }
      lastGroup = grp;
      var card = doc.createElement("div");
```

- [ ] **Step 3: Offline check skips dividers** — old (exact):

```js
    for (var k = 0; k < rows.length; k++) {
      if (rows[k].getAttribute("data-status") !== "down") { allDown = false; break; }
    }
```

New:

```js
    for (var k = 0; k < rows.length; k++) {
      if (!rows[k].getAttribute("data-url")) continue;
      if (rows[k].getAttribute("data-status") !== "down") { allDown = false; break; }
    }
```

- [ ] **Step 4: Divider CSS** — old (exact):

```css
.node-table tbody tr:nth-child(even),
table.pools-table tbody tr:nth-child(even) { background: var(--panel-deep); }
```

Append after it (later source order wins the equal-specificity tie with the stripe rule; tokens only):

```css
/* Network-group dividers (settings node table + cards): thin background
 * band between the mainnet / testnet / custom row blocks — reads as
 * separate tables while the radios stay one set (single tbody, one
 * name="node" group; dividers carry no data-url so probe/offline logic
 * skips them). */
.node-table tr.node-sep td { height: 8px; padding: 0; border: 0; border-top: 2px solid var(--border); background: var(--panel-deep); }
.node-cards .node-sep { height: 8px; background: var(--panel-deep); border-top: 2px solid var(--border); border-radius: 4px; }
```

- [ ] **Step 5: Gates + matrix + commit** — run `node tooling/node-network-test.js` (27/0), `node tooling/node-health-test.js` (exit 0), `node tooling/probe-geo-wiring-test.js` (exit 0 — stub has mainnet-only rows so zero dividers, row[0] unaffected), `bash tooling/check_types.sh` (zero lines on touched files), `python3 tooling/check_i18n.py` + `check_rot.py` (exit 0, no locale changes). Manual matrix via serve: dividers visible between groups; selecting across groups keeps single selection (native radio group + human pass); Probe All unaffected; 360px card dividers; three themes. Commit ONLY `vanilla/js/settings-nodes.js tooling/node-network-test.js vanilla/css/app.css`:

```bash
git add vanilla/js/settings-nodes.js tooling/node-network-test.js vanilla/css/app.css
git commit -m "Network table: group divider bands (radios stay one set)"
```

## Task 5 Self-Review

**Spec coverage:** group bands (§Rows — dividers, single tbody/group, dataless-skip). No gaps. **Placeholders:** none — all anchors/code exact. **Type consistency:** `groupOf` name/shape identical in helper, builders, test, export; `colspan` documented; divider class `node-sep` identical in JS + CSS.

---

### Task 6: Persistent remove column (follow-up 2026-10-04)

**Rationale:** owner call — every row gets a red `×` (after History); defaults hide into a persistent `hiddenNodes` Store list, customs unlist, re-add un-hides. Runs AFTER Task 5 (same builders).

**Files:**
- Modify: `vanilla/js/store.js` (`hiddenNodes` in base/load/save)
- Modify: `vanilla/js/settings-nodes.js` (`allNodes` filter, `hideNode`/`unhideNode` + export, `×` buttons table + cards)
- Modify: `vanilla/js/settings.js` (remove handler hide/unlist + visible fallback, custom-add un-hide)
- Modify: `tooling/node-network-test.js` (7 vectors, 27 → 34)
- Modify: `vanilla/css/app.css` (red 44px `×` rule)
- No locale changes (reuse `settings.remove`).

**Interfaces:**
- Consumes: Task 1/2/5 code; `Store.loadSettings/saveSettings`.
- Produces: `settings.hiddenNodes` (string array); `hideNode`/`unhideNode` via `SettingsNodes` public export + `_test`.

- [ ] **Step 1: Store hiddenNodes** — baseSettings, old (exact): `      customNodes: [],` (the `baseSettings` occurrence — unique: saveSettings' copy reads `customNodes: current.customNodes,`) → new `      customNodes: [],\n      hiddenNodes: [],`. loadSettings, old (exact):

```js
    var customNodes = Array.isArray(stored.customNodes)
      ? stored.customNodes.filter(function (u) { return typeof u === "string"; })
      : [];
```

append after it:

```js
    var hiddenNodes = Array.isArray(stored.hiddenNodes)
      ? stored.hiddenNodes.filter(function (u) { return typeof u === "string"; }).slice(-60)
      : [];
```

Return line, old (exact): `    return { network: network, activeNode: activeNode, customNodes: customNodes, theme: theme, locale: locale, esEnabled: esEnabled, signing: signing };` → insert `hiddenNodes: hiddenNodes, ` after `customNodes: customNodes, `. Active-fallback, old (exact): `    var activeNode = (typeof stored.activeNode === "string" && stored.activeNode) ? stored.activeNode : fallbackNode;` append after it:

```js
    if (hiddenNodes.indexOf(activeNode) !== -1) {
      var visible = DEFAULT_NODES.mainnet.concat(DEFAULT_NODES.testnet).concat(customNodes).filter(function (u) { return hiddenNodes.indexOf(u) === -1; });
      activeNode = visible[0] || fallbackNode;
    }
```

saveSettings `next`, old (exact): `      customNodes: current.customNodes,` → append after it `      hiddenNodes: current.hiddenNodes,`. Patch, old (exact): `      if (Array.isArray(patch.customNodes)) next.customNodes = patch.customNodes;` append after it: `      if (Array.isArray(patch.hiddenNodes)) next.hiddenNodes = patch.hiddenNodes.filter(function (u) { return typeof u === "string"; }).slice(-60);`.

- [ ] **Step 2: allNodes filter + hide helpers** — old (exact): `    var customs = Array.isArray(settings.customNodes) ? settings.customNodes : [];` (the `allNodes` occurrence — verify: settings.js:213 has `cur.customNodes` variant, distinct ✓) → append after it `    var hidden = Array.isArray(settings.hiddenNodes) ? settings.hiddenNodes : [];`. Old (exact): `      if (seen[u]) return;` → new `      if (seen[u] || hidden.indexOf(u) !== -1) return;`. Comment line `   * (mainnet defaults, testnet defaults, customs). The table owns network` → `   * (mainnet defaults, testnet defaults, customs, minus hiddenNodes). The table owns network`. Insert after `noteChain` (anchor: the `  /* Observed chain ids` block end — place new helpers right before it; anchor unique `  /* Observed chain ids per URL, this page-load only`):

```js
  /* hideNode: append a URL to a hidden list (capped at 60 like probe
   * history, deduped). Params: list (array|null), url string. Returns a
   * NEW array. Never throws. */
  function hideNode(list, url) {
    try {
      var out = Array.isArray(list) ? list.slice() : [];
      if (typeof url === "string" && url && out.indexOf(url) === -1) out.push(url);
      if (out.length > 60) out = out.slice(out.length - 60);
      return out.filter(function (u) { return typeof u === "string"; });
    } catch (e) { return []; }
  }

  /* unhideNode: drop a URL from a hidden list (the re-add path).
   * Params/returns: same shape as hideNode. Never throws. */
  function unhideNode(list, url) {
    try {
      var out = Array.isArray(list) ? list.slice() : [];
      return out.filter(function (u) { return typeof u === "string" && u !== url; });
    } catch (e) { return []; }
  }

```

Export: anchor `    selectNode: selectNode,` (unique) → `    selectNode: selectNode,\n    hideNode: hideNode,\n    unhideNode: unhideNode,`; `_test` line gains `hideNode: hideNode, unhideNode: unhideNode` (anchor `healthFor: healthFor }` → `healthFor: healthFor, hideNode: hideNode, unhideNode: unhideNode }`; if Task 5 already extended it with groupOf, append after groupOf instead — verify at execution: the line ends with ` }`; append inside the braces regardless).

- [ ] **Step 3: × buttons + header** — table action cell, old (exact):

```js
      var tdAct = doc.createElement("td");
      if (isCustom(url, settings)) {
        var rm = doc.createElement("button");
        rm.type = "button";
        rm.className = "node-remove";
        rm.setAttribute("data-url", url);
        rm.textContent = t("settings.remove", "Remove");
        tdAct.appendChild(rm);
      }
      tr.appendChild(tdAct);
```

New:

```js
      var tdAct = doc.createElement("td");
      var rm = doc.createElement("button");
      rm.type = "button";
      rm.className = "node-remove";
      rm.setAttribute("data-url", url);
      rm.setAttribute("aria-label", t("settings.remove", "Remove"));
      rm.textContent = "×";
      tdAct.appendChild(rm);
      tr.appendChild(tdAct);
```

Header, old (exact): `t("settings.th_history", "History"), ""].forEach(function (t) {` → new: `t("settings.th_history", "History"), t("settings.remove", "Remove")].forEach(function (t) {`. Cards rm2, old (exact):

```js
      if (isCustom(url, settings)) {
        var rm2 = doc.createElement("button");
        rm2.type = "button";
        rm2.className = "node-remove";
        rm2.setAttribute("data-url", url);
        rm2.textContent = t("settings.remove", "Remove");
        card.appendChild(rm2);
      }
```

New:

```js
      var rm2 = doc.createElement("button");
      rm2.type = "button";
      rm2.className = "node-remove";
      rm2.setAttribute("data-url", url);
      rm2.setAttribute("aria-label", t("settings.remove", "Remove"));
      rm2.textContent = "×";
      card.appendChild(rm2);
```

Then grep `isCustom(` across `vanilla/js`: if zero remaining callers, delete `isCustom` + its export entry (exact block lines 37-41 as read 2026-10-04 — verify before deleting); else keep.

- [ ] **Step 4: Handlers** — remove handler, old (exact, lines 280-294 as read 2026-10-04 — verify boundaries):

```js
    // Events: custom remove (table + cards)
    Array.prototype.forEach.call(wrap.querySelectorAll(".node-remove"), function (b) {
      b.addEventListener("click", function () {
        var u = b.getAttribute("data-url");
        var cur = Store.loadSettings();
        var customs = (Array.isArray(cur.customNodes) ? cur.customNodes : []).filter(function (x) { return x !== u; });
        var patch = {customNodes: customs};
        if (cur.activeNode === u) {
          var fb = (Store.DEFAULT_NODES && Store.DEFAULT_NODES[cur.network] && Store.DEFAULT_NODES[cur.network][0]) || "";
          patch.activeNode = fb;
        }
        Store.saveSettings(patch);
        render(rootEl);
      });
    });
```

New:

```js
    // Events: node remove (table + cards) — defaults hide persistently,
    // customs unlist; removing the active node falls back to first visible.
    Array.prototype.forEach.call(wrap.querySelectorAll(".node-remove"), function (b) {
      b.addEventListener("click", function () {
        var u = b.getAttribute("data-url");
        var cur = Store.loadSettings();
        var customs = Array.isArray(cur.customNodes) ? cur.customNodes.slice() : [];
        var hidden = Array.isArray(cur.hiddenNodes) ? cur.hiddenNodes.slice() : [];
        var isC = customs.indexOf(u) !== -1;
        var patch = {
          customNodes: isC ? customs.filter(function (x) { return x !== u; }) : customs,
          hiddenNodes: isC ? hidden : SettingsNodes.hideNode(hidden, u)
        };
        if (cur.activeNode === u) {
          var rest = SettingsNodes.allNodes({ network: cur.network, customNodes: patch.customNodes, hiddenNodes: patch.hiddenNodes });
          patch.activeNode = rest[0] || "";
        }
        Store.saveSettings(patch);
        render(rootEl);
      });
    });
```

Custom-add un-hide, old (exact): `      customs.push(v);\n      Store.saveSettings({customNodes: customs});` → new: `      customs.push(v);\n      Store.saveSettings({ customNodes: customs, hiddenNodes: SettingsNodes.unhideNode(cur.hiddenNodes, v) });`.

- [ ] **Step 5: CSS + vectors** — append after the Task 5 divider rules (anchor: `.node-cards .node-sep {` line):

```css
/* Remove column: red × per row (defaults hide, customs unlist). Glyph
 * buttons need an explicit 44px box (text buttons size themselves; a
 * bare × would miss the touch floor). --danger follows the footer
 * closed-host precedent for small red text. */
.node-table .node-remove, .node-card .node-remove { min-width: 44px; color: var(--danger); font-weight: 700; font-size: 1.1rem; }
```

Vectors — append before `console.log` in `tooling/node-network-test.js` (also extend the exports array with `"hideNode", "unhideNode"`):

```js
eq(T.hideNode([], "wss://a").join(","), "wss://a", "hide appends");
eq(T.hideNode(["wss://a"], "wss://a").length, 1, "hide dedupes");
eq(T.hideNode(null, "wss://a").join(","), "wss://a", "hide null list");
eq(T.unhideNode(["wss://a", "wss://b"], "wss://a").join(","), "wss://b", "unhide drops");
eq(T.unhideNode(null, "wss://a").length, 0, "unhide null list");
eq(T.hideNode(["wss://a"], null).join(","), "wss://a", "hide null url no-op");
var big = []; for (var i = 0; i < 65; i++) big.push("wss://n" + i);
eq(T.hideNode(big, "wss://z").length, 60, "hide caps at 60");
```

Run: `node tooling/node-network-test.js` — expect `34 passed, 0 failed` (27 + 7).

- [ ] **Step 6: Gates + matrix + commit** — run `node tooling/node-health-test.js` + `probe-geo-wiring-test.js` (exit 0 — stub settings lack hiddenNodes → guarded `[]`, same rows), `bash tooling/check_types.sh` (zero lines on touched files), `python3 tooling/check_i18n.py` + `check_rot.py` (exit 0 — no locale changes; reused key drift-safe). Manual matrix via serve: × on every row; remove default → row gone + persists across reload; re-add via custom-add → returns; remove active → fallback connects (footer follows); remove custom → unlisted; 360px 44px targets; three themes red legible. Commit ONLY `vanilla/js/store.js vanilla/js/settings-nodes.js vanilla/js/settings.js tooling/node-network-test.js vanilla/css/app.css`:

```bash
git add vanilla/js/store.js vanilla/js/settings-nodes.js vanilla/js/settings.js tooling/node-network-test.js vanilla/css/app.css
git commit -m "Network table: persistent remove column (hide defaults, unlist customs)"
```

## Task 6 Self-Review

**Spec coverage:** × column + header reuse (§Remove column — header key reuse, glyph, 44px); hiddenNodes persist/un-hide (§Remove column — Store shape, allNodes filter, custom-add return path); active fallback (§Remove column); zero new keys (§Remove column). No gaps. **Placeholders:** none — anchors/code exact, both isCustom branches spelled. **Type consistency:** `hiddenNodes` string-array in base/load/save/return; `hideNode`/`unhideNode` signatures identical in impl, export, handlers, tests; `allNodes({network, customNodes, hiddenNodes})` shape matches its reader.

---

### Task 7: Merge NETWORK into CHAIN, 3 finite states (follow-up 2026-10-04)

**Rationale:** owner call — one column, three states for observed chains (green MAINNET 4018 / yellow TESTNET 39f5 / red DEVNET anything else, all caps via CSS); pending dash pre-probe; pill/mismatch text leaves the cell (tooltip keeps facts).

**Files:**
- Modify: `vanilla/js/settings-nodes.js` (chainLabel/chainHealth replace networkLabel/networkHealth, builders drop net spans + header entry, probeAll rewrites, setRow + JSDoc trim)
- Modify: `tooling/node-network-test.js` (12 vectors rewritten to 8, 34 → 30)
- Modify: `vanilla/css/app.css` (drop dead margin fragment, add caps rule)
- Create: `tooling/merge_chain_column_i18n.py` (add network_devnet, drop th_network)
- Modify: `vanilla/locales/*.json` (12 files, via one-shot)

**Interfaces:**
- Consumes: Task 1/2/5/6 code; `Store.CHAIN_IDS`; existing keys `network_mainnet/testnet/dash/pending/timeout/down`.
- Produces: `chainLabel(t, chainId)` → `string`; `chainHealth(chainId)` → `"good"|"warn"|"bad"|""` via `_test`. `listNetwork/netFromChain/groupOf/hideNode` untouched (selection/probe/dividers still use them).

- [ ] **Step 1: Helpers rename + reshape** — old (exact, lines 655-669):

```js
  /** networkLabel: NETWORK cell text.
   * @param {Function} t - injected lookup.
   * @param {string} net - "mainnet"|"testnet"|"".
   * @param {string|null} chainId - observed chain id or null.
   * @returns {string} the keyed network name, the 4-char chain prefix, or the keyed dash. Never throws. */
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
```

New:

```js
  /** chainLabel: merged CHAIN cell text — three finite states for observed
   * chains (rendered caps via CSS), dash pre-probe.
   * @param {Function} t - injected lookup.
   * @param {string|null} chainId - observed chain id or null.
   * @returns {string} keyed mainnet/testnet/devnet word or dash. Never throws. */
  function chainLabel(t, chainId) {
    var dash = "—";
    try { dash = String(t("settings.dash", "—")); } catch (e) { /* dash stands */ }
    try {
      if (typeof chainId !== "string" || !chainId) return dash;
      if (typeof Store === "undefined" || !Store || !Store.CHAIN_IDS) return dash;
      var low = chainId.toLowerCase();
      if (Store.CHAIN_IDS.mainnet && low === String(Store.CHAIN_IDS.mainnet).toLowerCase()) return String(t("settings.network_mainnet", "mainnet"));
      if (Store.CHAIN_IDS.testnet && low === String(Store.CHAIN_IDS.testnet).toLowerCase()) return String(t("settings.network_testnet", "testnet"));
      return String(t("settings.network_devnet", "devnet"));
    } catch (e) { return dash; }
  }
```

Old (exact, lines 671-688):

```js
  /** networkHealth: NETWORK cell color.
   * @param {string} net - "mainnet"|"testnet"|"".
   * @param {string|null} chainId - observed chain id or null.
   * @returns {string} "good" (mainnet chain) | "warn" (testnet or any other chain — owner rule: yellow unless 4018) | "bad" (listed default answering a foreign chain) | "" (unprobed: unknown never guesses). Never throws. */
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

New:

```js
  /** chainHealth: merged CHAIN cell color.
   * @param {string|null} chainId - observed chain id or null.
   * @returns {string} "good" (4018) | "warn" (39f5) | "bad" (anything else) | "" (unprobed). Never throws. */
  function chainHealth(chainId) {
    try {
      if (typeof chainId !== "string" || !chainId) return "";
      if (typeof Store === "undefined" || !Store || !Store.CHAIN_IDS) return "";
      var low = chainId.toLowerCase();
      if (Store.CHAIN_IDS.mainnet && low === String(Store.CHAIN_IDS.mainnet).toLowerCase()) return "good";
      if (Store.CHAIN_IDS.testnet && low === String(Store.CHAIN_IDS.testnet).toLowerCase()) return "warn";
      return "bad";
    } catch (e) { return ""; }
  }
```

Export line: anchor `networkLabel: networkLabel, networkHealth: networkHealth` (unique — definition sites read `function networkLabel`) → `chainLabel: chainLabel, chainHealth: chainHealth`. setRow JSDoc: old `    *   data-url), cells ({lat, ping, part, head, chain, network, geo, prov}` → drop `, network`; old `    *   health ({lat, ping, part, head, chain, network} "good"|"warn"|"bad" — painted` → drop `, network`.

- [ ] **Step 2: Builders drop net spans + header entry** — table, old (exact):

```js
      var tdNet = doc.createElement("td");
      var netSpan = doc.createElement("span");
      netSpan.className = "node-network";
      netSpan.textContent = networkLabel(t, listNetwork(url) || netFromChain(seenChain[url] || ""), seenChain[url] || null);
      tdNet.appendChild(netSpan);
      tr.appendChild(tdNet);
```

Delete the whole block. Cards, old (exact):

```js
      var netSpan = doc.createElement("span");
      netSpan.className = "node-network";
      netSpan.textContent = networkLabel(t, listNetwork(url) || netFromChain(seenChain[url] || ""), seenChain[url] || null);
      card.appendChild(netSpan);
```

Delete the whole block. Header: old substring `t("settings.th_network", "Network"), ` (unique) → delete (empty string). chainSpan initial `…` pending text stays (already correct pre-probe).

- [ ] **Step 3: setRow drops .node-network** — delete line `      var nnet = root.querySelector(".node-network");` (unique); delete line `      if (nnet && typeof c.network === "string") nnet.textContent = c.network;` (unique); old hue line (exact): `      hue(lat, "lat"); hue(png, "ping"); hue(prt, "part"); hue(hed, "head"); hue(chn, "chain"); hue(nnet, "network");` → new: `      hue(lat, "lat"); hue(png, "ping"); hue(prt, "part"); hue(hed, "head"); hue(chn, "chain");`.

- [ ] **Step 4: probeAll rewrites** — delete line `        var dispNet = rowNet || netFromChain(cid);` (unique). Connecting, old (exact): `      setRow(row, { lat: pend, ping: pend, part: pend, head: pend, chain: conn, network: networkLabel(t, listNetwork(url), seenChain[url] || null), geo: pend, prov: pend }, "connecting");` → new: `      setRow(row, { lat: pend, ping: pend, part: pend, head: pend, chain: conn, geo: pend, prov: pend }, "connecting");`. Mismatch: delete block (exact):

```js
          var mChain4 = "";
          try { mChain4 = String(prefix || "").slice(0, 4); } catch (sliceErr) { mChain4 = ""; }
```

old setRow (exact): `          setRow(row, { lat: latencyText(t, r.latencyMs), ping: pingText(t, r.pingMs), part: partText(t, r.participation), head: headText(t, r.headAgeS), chain: "mismatch " + mChain4, network: networkLabel(t, dispNet, cid) }, "down",` → new: `          setRow(row, { lat: latencyText(t, r.latencyMs), ping: pingText(t, r.pingMs), part: partText(t, r.participation), head: headText(t, r.headAgeS), chain: chainLabel(t, cid) }, "down",`; old health tail (exact): `            { lat: healthFor("hs", r.latencyMs), ping: healthFor("ping", r.pingMs), part: partText(t, r.participation), head: headText(t, r.headAgeS), chain: "bad", network: networkHealth(dispNet, cid) });` → new: `            { lat: healthFor("hs", r.latencyMs), ping: healthFor("ping", r.pingMs), part: partText(t, r.participation), head: headText(t, r.headAgeS), chain: chainHealth(cid) });` (tooltip `detailText(r, prefix, "wrong chain for this network")` stays untouched). Success: delete pill block (exact):

```js
          var pill = {
            "GOOD": t("settings.node_good", "Good"),
            "STALE": t("settings.node_stale", "Stale"),
            "SUSPECT": t("settings.node_suspect", "Suspect"),
            "FORKED": t("settings.node_forked", "Forked"),
            "WRONG-CHAIN": "mismatch " + prefix
          }[v.status] || t("settings.node_good", "Good");
```

old cells (exact): `            chain: (v.status === "GOOD") ? prefix.slice(0, 4) : (pill + " · " + prefix.slice(0, 4)), network: networkLabel(t, dispNet, cid) },` → new: `            chain: chainLabel(t, cid) },`; old health tail (exact): `              chain: networkHealth(dispNet, cid) });` → new: `              chain: chainHealth(cid) });` (`id` status mapping + tooltip + history lines stay). Catch, old (exact): `          chain: timeout ? t("settings.node_timeout", "Timeout") : t("settings.down", "down"), network: networkLabel(t, listNetwork(url), null) },` → new: `          chain: timeout ? t("settings.node_timeout", "Timeout") : t("settings.down", "down") },` (Timeout/down behavior unchanged).

- [ ] **Step 5: CSS caps + dead-margin cleanup** — delete substring ` .node-card .node-network,` (unique — joins neighbors back to valid CSS). Append after the divider rule line `.node-cards .node-sep { height: 8px; background: var(--panel-deep); border-top: 2px solid var(--border); border-radius: 4px; }` (unique):

```css
/* Merged CHAIN states render all-caps (MAINNET/TESTNET/DEVNET); locale
 * values stay lowercase, translators never touch casing. */
.node-table .node-chain, .node-card .node-chain { text-transform: uppercase; }
```

- [ ] **Step 6: Vectors 34 → 30 (TDD)** — test file: exports array substring `"networkLabel", "networkHealth"` → `"chainLabel", "chainHealth"`; header helper list `networkLabel/networkHealth` → `chainLabel/chainHealth`; delete the 12 old vectors (4 networkLabel + 8 networkHealth, exact text from Task 1 Step 5); append before `console.log`:

```js
eq(T.chainLabel(t, MID), "mainnet", "chain mainnet");
eq(T.chainLabel(t, TID), "testnet", "chain testnet");
eq(T.chainLabel(t, "ffff"), "devnet", "chain other devnet");
eq(T.chainLabel(t, null), "—", "chain dash");
eq(T.chainHealth(MID), "good", "chain health green");
eq(T.chainHealth(TID), "warn", "chain health yellow");
eq(T.chainHealth("ffff"), "bad", "chain health red");
eq(T.chainHealth(null), "", "chain health unprobed");
```

Run: `node tooling/node-network-test.js` — expect `30 passed, 0 failed` (rewrite vectors first: RED `chainLabel exported`, then GREEN).

- [ ] **Step 7: i18n one-shot** — create `tooling/merge_chain_column_i18n.py` with exactly:

```python
#!/usr/bin/env python3
"""One-shot: merge NETWORK into CHAIN column i18n (2026-10-04).

Adds settings.network_devnet ("devnet") and DROPS settings.th_network
(header retired with the column) across all 12 vanilla/locales/*.json
as honest English stubs (principle #10). MAINNET/TESTNET reuse
settings.network_mainnet/testnet (rendered caps via CSS); chain states
are verbatim values, never translated.

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

ADDS = [
    # (pattern, replacement, done_marker)
    (re.compile(r'^    "network_mainnet": "mainnet",\n', re.MULTILINE),
     '    "network_devnet": "devnet",\n    "network_mainnet": "mainnet",\n',
     '"network_devnet"'),
    (re.compile(r'^      "settings\.network_mainnet",\n', re.MULTILINE),
     '      "settings.network_devnet",\n      "settings.network_mainnet",\n',
     '"settings.network_devnet"'),
]
DROPS = [
    # (pattern, replacement, absent_marker): skip when absent_marker gone.
    (re.compile(r'^    "th_location": "Location \*",\n    "th_network": "Network",\n', re.MULTILINE),
     '    "th_location": "Location *",\n',
     '"th_network"'),
    (re.compile(r'^      "settings\.th_network",\n', re.MULTILINE),
     '',
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
        for pat, repl, marker in ADDS:
            if marker in text:
                continue
            hits = len(pat.findall(text))
            if hits != 1:
                print("ABORT %s: add hits %d" % (path, hits))
                return 1
            text = pat.sub(repl, text, count=1)
            changed = True
        for pat, repl, gone in DROPS:
            if gone not in text:
                continue
            hits = len(pat.findall(text))
            if hits != 1:
                print("ABORT %s: drop hits %d" % (path, hits))
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

Run: `python3 tooling/merge_chain_column_i18n.py` (expect 12 `updated` + `done`) then `python3 tooling/check_i18n.py` (exit 0).

- [ ] **Step 8: Gates + matrix + commit** — run `node tooling/node-health-test.js` + `probe-geo-wiring-test.js` (exit 0 — neither asserts chain cells), `bash tooling/check_types.sh` (zero lines on touched files), `python3 tooling/check_rot.py` (exit 0). Manual matrix via serve: mainnet rows green MAINNET, testnet rows yellow TESTNET, pending `…` pre-probe, Timeout/down unchanged, tooltips keep full facts, DEVNET by code reasoning only (no odd chain available — human pass if a devnet URL exists), 360px + themes + single-set radios sanity. Commit ONLY `vanilla/js/settings-nodes.js tooling/node-network-test.js vanilla/css/app.css tooling/merge_chain_column_i18n.py vanilla/locales/`:

```bash
git add vanilla/js/settings-nodes.js tooling/node-network-test.js vanilla/css/app.css tooling/merge_chain_column_i18n.py vanilla/locales/
git commit -m "Network table: merge NETWORK into CHAIN (MAINNET/TESTNET/DEVNET)"
```

## Task 7 Self-Review

**Spec coverage:** 3 states + caps-via-CSS + devnet key (§Merged chain column → Steps 1/5/7); dash pre-probe (Steps 1-2); pill/mismatch text out, tooltips stay (Step 4); header reuse + th_network drop (Steps 2/7); data-status/offline/selection/probe-first/hidden untouched (no edits there). No gaps. **Placeholders:** none — all anchors/code exact. **Type consistency:** `chainLabel(t, chainId)`/`chainHealth(chainId)` identical in impl, all 6 call sites, tests, export; removed names (`networkLabel*`, `dispNet`, `pill`, `mChain4`, `nnet`) have zero remaining references (implementer verifies with grep before committing — any hit besides the deleted lines is NEEDS_CONTEXT).
