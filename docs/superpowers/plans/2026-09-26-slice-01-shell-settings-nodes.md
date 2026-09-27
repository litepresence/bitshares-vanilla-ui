# Slice 01 (Shell + Settings/Nodes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the vanilla app skeleton with a working settings/nodes page that connects to real BitShares nodes over WebSocket, proving the chain path before any wallet code exists.

**Architecture:** Static files only. `chain.js` is the sole WebSocket owner (raw JSON-RPC: login → database → chain queries); `store.js` is a tiny pub/sub with localStorage persistence; `router.js` renders hash routes into `#view`; `settings.js` owns the nodes page. No frameworks, no build, no runtime deps.

**Tech Stack:** Plain HTML + CSS + vanilla JS (WebSocket, localStorage). Node 20 (stdlib only) for headless verification scripts. Python 3 for static serving and the rot gate.

## Global Constraints

- Zero runtime dependencies: no `package.json`, no `node_modules`, no CDN `<script src>`, no framework imports in `vanilla/`.
- `python3 -m http.server` (or `file://`) must serve a working app.
- Chain IDs: mainnet `4018d7844c78f6a6c41c6a552b898022310fc5dec06da467ee7905a8dad512c8`, testnet `39f5e2ede1f8bc1a3a54a7914414e3779e33193f1f5693510e73cb7a87617447`.
- Node lists are data, not code; defaults below; network + active node + theme persist in `localStorage` key `bts-vanilla-settings-v1`.
- Money math: none in this slice (no amounts displayed). If any number appears, it routes through the future `format.js` — no inline float division.
- Viewport range 360px → 4K; touch targets ≥44px in one dimension; no hover-only UI.
- Test keys only on testnet; slice 1 signs nothing (read-only handshake).
- Each `js/*.js` assigns exactly one global and ends with
  `if (typeof module !== "undefined") { module.exports = <Global>; }`
  so node can `require()` it for smoke tests (harmless in browsers).

---

## File Structure

```
vanilla/
├── index.html          ← shell: <meta viewport>, header (brand + connection badge), <nav>, <main id="view">, theme init + script tags
├── css/
│   ├── themes.css      ← custom properties for [data-theme="original-blue"|"light"|"dark"], original-blue default
│   └── app.css         ← layout, collapsing nav (<720px), node table → cards (<560px), fluid wide-screen grid
├── js/
│   ├── store.js        ← createStore, settings load/save, pub/sub topics: "settings", "connection"
│   ├── chain.js        ← ChainClient: connect(url), call(api,method,params), getChainId(), getHeadBlock(), onStatus(), disconnect()
│   ├── router.js       ← route table (§6, ~40 routes), hashchange handling, placeholder renderer, settings route wiring
│   ├── settings.js     ← renderSettings(root): node table, latency probe, select, network toggle, custom node add/remove
│   └── app.js          ← boot: load settings, apply theme, start router, auto-connect active node
└── notes/
    └── slice-01-settings.md  ← parity note (six fields per building-vanilla-slices)
tooling/
├── check_rot.py        ← EXISTS (do not recreate; run it in Task 10)
└── ws-probe.mjs        ← NEW: stdlib-only node script, runs the handshake headlessly, prints JSON result
```

---

### Task 1: Scaffold shell (`index.html` + boot wiring contract)

**Files:**
- Create: `vanilla/index.html`
- Create: `vanilla/js/app.js` (stub: imports store/router only; chain wired in Task 5)

**Interfaces:**
- Consumes: nothing yet (later tasks fill in `js/store.js`, `js/router.js` APIs below — app.js references them by these exact names).
- Produces: `#view` outlet, `#conn-badge` element, `#nav` element; `app.js` calls `Store.loadSettings()`, `Router.start(document.getElementById("view"))`, applies `data-theme` from settings.

- [ ] **Step 1: Create `vanilla/index.html`**

```html
<!DOCTYPE html>
<html lang="en" data-theme="original-blue">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>BitShares Wallet</title>
<link rel="stylesheet" href="css/themes.css">
<link rel="stylesheet" href="css/app.css">
</head>
<body>
<header class="topbar">
  <a class="brand" href="#/">BitShares</a>
  <span id="conn-badge" class="badge" data-state="unknown">connecting…</span>
  <button id="nav-toggle" aria-label="Menu" aria-expanded="false">☰</button>
</header>
<nav id="nav" aria-label="Main">
  <a href="#/">Dashboard</a>
  <a href="#/market/BTS_USD">Exchange</a>
  <a href="#/account/overview">Account</a>
  <a href="#/transfer">Transfer</a>
  <a href="#/explorer">Explorer</a>
  <a href="#/voting">Voting</a>
  <a href="#/settings">Settings</a>
</nav>
<main id="view" aria-live="polite"></main>
<script src="js/store.js"></script>
<script src="js/chain.js"></script>
<script src="js/router.js"></script>
<script src="js/settings.js"></script>
<script src="js/app.js"></script>
</body>
</html>
```

(Classic scripts, not modules: zero tooling, `file://`-safe. Each `js/*.js` assigns exactly one global: `Store`, `Chain`, `Router`, `SettingsPage`, booted by `app.js`.)

- [ ] **Step 2: Create `vanilla/js/app.js` stub**

```js
/* Boot: settings -> theme -> router -> chain (chain wired in Task 5). */
(function () {
  "use strict";
  var settings = Store.loadSettings();
  document.documentElement.setAttribute("data-theme", settings.theme);
  Router.start(document.getElementById("view"));
})();
```

- [ ] **Step 3: Syntax-check both files**

Run: `node --check vanilla/js/app.js`
Expected: no output, exit 0.

- [ ] **Step 4: Serve and confirm the shell loads with no console errors**

Run: `python3 -m http.server 8080 --directory /workspace/vanilla`
Expected: `http://localhost:8080/` renders header/nav/empty view; badge reads "connecting…".

---

### Task 2: Theme tokens (`css/themes.css`)

**Files:**
- Create: `vanilla/css/themes.css`

**Interfaces:**
- Consumes: palette sampled from `bitshares-ui/app/assets/stylesheets/themes/` (primary `#337ab7`, button `#049cce`).
- Produces: variables `--bg, --panel, --text, --muted, --accent, --accent-text, --buy, --sell, --warn, --danger, --border` for all three themes.

- [ ] **Step 1: Create `vanilla/css/themes.css`**

```css
/* Theme tokens. Original blue is default; light/dark refined per slice. */
:root,
:root[data-theme="original-blue"] {
  --bg: #f5f7fa; --panel: #ffffff; --text: #333333; --muted: #777777;
  --accent: #337ab7; --accent-text: #ffffff; --button-bg: #049cce;
  --buy: #22d173; --sell: #e3745b; --warn: #fcab53; --danger: #e3745b;
  --border: #dddddd; --header-bg: #337ab7; --header-text: #ffffff;
}
:root[data-theme="light"] {
  --bg: #ffffff; --panel: #f5f7fa; --text: #222222; --muted: #666666;
  --accent: #337ab7; --accent-text: #ffffff; --button-bg: #049cce;
  --buy: #1da866; --sell: #d35a41; --warn: #e89b3d; --danger: #d35a41;
  --border: #e2e2e2; --header-bg: #337ab7; --header-text: #ffffff;
}
:root[data-theme="dark"] {
  --bg: #1a1d23; --panel: #24282f; --text: #e0e0e0; --muted: #999999;
  --accent: #4a90c4; --accent-text: #ffffff; --button-bg: #049cce;
  --buy: #22d173; --sell: #e3745b; --warn: #fcab53; --danger: #e3745b;
  --border: #3a3f47; --header-bg: #24282f; --header-text: #e0e0e0;
}
```

- [ ] **Step 2: Verify no hardcoded colors leak into later CSS**

Run: after Task 3, `grep -rn "#[0-9a-fA-F]\{3,6\}" vanilla/css/*.css | grep -v "themes.css" || echo CLEAN`
Expected: `CLEAN`.

---

### Task 3: Responsive layout (`css/app.css`)

**Files:**
- Create: `vanilla/css/app.css`

**Interfaces:**
- Consumes: variables from `themes.css`.
- Produces: classes used by shell + settings page: `.topbar`, `.badge[data-state]`, `#nav`, `.wrap` (fluid grid: `minmax(300px, 720px)` center column on narrow, full-width multi-column above 1200px), `.node-table`, `.node-cards` (cards replace table under 560px), buttons/inputs ≥44px height.

- [ ] **Step 1: Create `vanilla/css/app.css`** — complete content below (no hardcoded colors; all from `themes.css`):

```css
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text);
  font: 16px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
.topbar { display: flex; align-items: center; gap: 12px; padding: 0 16px;
  min-height: 56px; background: var(--header-bg); color: var(--header-text); }
.brand { color: inherit; font-weight: 700; font-size: 1.1rem; text-decoration: none; }
.badge { margin-left: auto; padding: 4px 12px; border-radius: 999px; font-size: 0.85rem;
  background: var(--muted); color: #fff; min-height: 44px; display: inline-flex; align-items: center; }
.badge[data-state="open"] { background: var(--buy); }
.badge[data-state="closed"], .badge[data-state="error"] { background: var(--danger); }
#nav-toggle { display: none; margin-left: 8px; min-width: 44px; min-height: 44px;
  background: transparent; border: 1px solid currentColor; border-radius: 6px;
  color: inherit; font-size: 1.2rem; }
#nav { display: flex; gap: 4px; padding: 8px 16px; background: var(--panel);
  border-bottom: 1px solid var(--border); }
#nav a { padding: 10px 14px; min-height: 44px; display: inline-flex; align-items: center;
  color: var(--text); text-decoration: none; border-radius: 6px; }
#nav a:hover { background: var(--bg); }
.wrap { margin: 0 auto; padding: 16px; max-width: 720px; }
@media (min-width: 1200px) { .wrap.wide { max-width: none; display: grid;
  grid-template-columns: repeat(12, 1fr); gap: 16px; } }
@media (max-width: 719px) {
  #nav-toggle { display: inline-flex; align-items: center; justify-content: center; }
  #nav { display: none; flex-direction: column; }
  #nav.open { display: flex; }
  .badge { font-size: 0.75rem; }
}
.node-table { width: 100%; border-collapse: collapse; background: var(--panel); }
.node-table th, .node-table td { padding: 12px; border-bottom: 1px solid var(--border);
  text-align: left; }
.node-table th:first-child, .node-table td:first-child { position: sticky; left: 0;
  background: var(--panel); }
.node-cards { display: none; }
@media (max-width: 559px) {
  .node-table { display: none; }
  .node-cards { display: grid; gap: 12px; }
  .node-card { background: var(--panel); border: 1px solid var(--border);
    border-radius: 8px; padding: 12px; }
}
button, select, input { min-height: 44px; font-size: 1rem; }
button { background: var(--button-bg); color: #fff; border: 0; border-radius: 6px;
  padding: 0 16px; }
.error { color: var(--danger); } .muted { color: var(--muted); }
```

- [ ] **Step 2: Verify at both widths**

Run: serve (Task 1 Step 4), resize to 360px and 1440px.
Expected: 360px — hamburger shows nav, no horizontal scroll; 1440px — content uses the width, header spans fully.

---

### Task 4: Store (`js/store.js`)

**Files:**
- Create: `vanilla/js/store.js`

**Interfaces:**
- Consumes: `localStorage` only.
- Produces: global `Store` with exactly:
  - `Store.loadSettings() -> {network, activeNode, customNodes[], theme}` (defaults: network `"mainnet"`, theme `"original-blue"`, activeNode first default of network; merges over corrupt/missing storage without throwing)
  - `Store.saveSettings(patch)` (merges, persists, emits `"settings"`)
  - `Store.subscribe(topic, fn) -> unsubscribeFn`; topics `"settings"`, `"connection"`
  - `Store.emitConnection(status)` where status is `{state, node, latencyMs, chainId}`; state ∈ `unknown|connecting|open|closed|error`
  - `Store.DEFAULT_NODES = {mainnet: [...6 urls...], testnet: [...2 urls...]}` and `Store.CHAIN_IDS = {mainnet: "4018d784…dad512c8", testnet: "39f5e2ed…617447"}` (full hashes from Global Constraints)

- [ ] **Step 1: Write `vanilla/js/store.js`** implementing exactly the interface above (~60 lines, `"use strict"`, one `var Store = ...` global).

- [ ] **Step 2: Syntax + behavior check in node**

Run:
```
node --check vanilla/js/store.js && node -e "
global.localStorage = { _s: {}, getItem(k){return this._s[k]??null}, setItem(k,v){this._s[k]=v} };
require('/workspace/vanilla/js/store.js');
const s = Store.loadSettings();
console.log(JSON.stringify({network: s.network, theme: s.theme, nodes: s.mainnetNodes?.length ?? Store.DEFAULT_NODES.mainnet.length}));
let seen = null; const off = Store.subscribe('settings', v => { seen = v.theme; }); off();
Store.saveSettings({theme: 'dark'}); console.log('saved-theme:', Store.loadSettings().theme);
"
```
Expected: `{"network":"mainnet","theme":"original-blue","nodes":6}` then `saved-theme: dark`, exit 0. (Node `require` of a classic script works because the file assigns a bare `var Store` global — keep it that way.)

---

### Task 5: Chain client (`js/chain.js`)

**Files:**
- Create: `vanilla/js/chain.js`

**Interfaces:**
- Consumes: `Store` (reads nothing; emits via `Store.emitConnection`), browser `WebSocket`.
- Produces: global `Chain` with exactly:
  - `Chain.connect(url, {timeoutMs=8000}) -> Promise<{chainId, headBlockTime, latencyMs}>` — handshake: `call(1,"login",["",""])` → `call(1,"database",[])` → parallel `get_chain_id` + `get_dynamic_global_properties`; emits connecting/open/closed/error; closes stale socket before opening a new one.
  - `Chain.call(apiId, method, params, {timeoutMs}) -> Promise<result>` — increments numeric `id`, routes responses, rejects on `error` payload or timeout; sends only when `readyState === 1`.
  - `Chain.disconnect()`, `Chain.status() -> last emitted status object`.
- Wire-up: `app.js` gains `Chain.connect(settings.activeNode)` after router start, `Store.subscribe("settings", ...)` reconnects when `activeNode`/`network` changes.

- [ ] **Step 1: Capture the expected handshake result FIRST (test-first)**

Run: `node tooling/ws-probe.mjs wss://testnet.xbts.io/ws` (built in Task 9 — if running tasks in order, do Task 9 first; the expectation below is the assertion).
Expected: JSON with `chainId` starting `39f5e2ed` and a recent `headBlockTime`. Paste the observed values into the parity note as the vectors.

- [ ] **Step 2: Write `vanilla/js/chain.js`** — complete content below:

```js
/* Chain: sole WebSocket owner. Raw JSON-RPC: login -> database -> queries. */
var Chain = (function () {
  "use strict";
  var ws = null, nextId = 1, pending = {}, lastStatus = {state: "unknown"};

  function setStatus(patch) {
    lastStatus = Object.assign({state: "unknown", node: null, latencyMs: null, chainId: null}, lastStatus, patch);
    Store.emitConnection(lastStatus);
    var badge = document.getElementById("conn-badge");
    if (badge) {
      badge.setAttribute("data-state", lastStatus.state);
      badge.textContent = lastStatus.state === "open"
        ? "connected · " + (lastStatus.chainId || "").slice(0, 8) + " · " + lastStatus.latencyMs + "ms"
        : lastStatus.state;
    }
  }

  function call(apiId, method, params, timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (!ws || ws.readyState !== 1) { reject(new Error("not connected")); return; }
      var id = nextId++;
      var timer = setTimeout(function () { delete pending[id]; reject(new Error("call timeout: " + method)); }, timeoutMs || 8000);
      pending[id] = {resolve: resolve, reject: reject, timer: timer};
      ws.send(JSON.stringify({id: id, method: "call", params: [apiId, method, params || []]}));
    });
  }

  function connect(url, opts) {
    var timeoutMs = (opts && opts.timeoutMs) || 12000;
    disconnect();
    setStatus({state: "connecting", node: url});
    var t0 = Date.now();
    return new Promise(function (resolve, reject) {
      var done = false;
      try { ws = new WebSocket(url); } catch (e) { setStatus({state: "error", node: url}); reject(e); return; }
      var guard = setTimeout(function () { if (!done) { done = true; try { ws.close(); } catch (e) {} setStatus({state: "error", node: url}); reject(new Error("connect timeout")); } }, timeoutMs);
      ws.onopen = function () {
        call(1, "login", ["", ""]).then(function () { return call(1, "database", []); }).then(function (dbId) {
          return Promise.all([call(dbId, "get_chain_id", []), call(dbId, "get_dynamic_global_properties", [])]);
        }).then(function (res) {
          if (done) return; done = true; clearTimeout(guard);
          var latencyMs = Date.now() - t0;
          setStatus({state: "open", node: url, latencyMs: latencyMs, chainId: res[0]});
          resolve({chainId: res[0], headBlockTime: res[1].time, latencyMs: latencyMs});
        }).catch(function (e) {
          if (done) return; done = true; clearTimeout(guard);
          try { ws.close(); } catch (err) {}
          setStatus({state: "error", node: url}); reject(e);
        });
      };
      ws.onmessage = function (ev) {
        var msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (msg.id !== undefined && pending[msg.id]) {
          var p = pending[msg.id]; delete pending[msg.id]; clearTimeout(p.timer);
          if (msg.error) p.reject(new Error(JSON.stringify(msg.error))); else p.resolve(msg.result);
        }
      };
      ws.onclose = function () { if (!done) { done = true; clearTimeout(guard); setStatus({state: "closed", node: url}); reject(new Error("socket closed")); } else if (lastStatus.state === "open") { setStatus({state: "closed", node: url}); } };
      ws.onerror = function () { /* onclose carries the failure */ };
    });
  }

  function disconnect() { try { if (ws) ws.close(); } catch (e) {} ws = null; }
  return {connect: connect, call: call, disconnect: disconnect, status: function () { return lastStatus; }};
})();
```

- [ ] **Step 3: Syntax check**

Run: `node --check vanilla/js/chain.js`
Expected: exit 0.

---

### Task 6: Router (`js/router.js`)

**Files:**
- Create: `vanilla/js/router.js`

**Interfaces:**
- Consumes: `SettingsPage.render` (Task 7) for `#/settings`.
- Produces: global `Router` with `Router.start(viewEl)`; route table covering AGENTS.md §6 (each entry `{title, render}`); unknown hash → Page404 renderer; every non-settings route renders `placeholder(title)` ("`<title>` — not yet ported; tracked in slice N").

- [ ] **Step 1: Write `vanilla/js/router.js`** with the full §6 route list: `/`, `/account/:account_name`, `/accounts`, `/market/:marketID`, `/credit-offer`, `/settings/:tab`, `/settings`, `/invoice/:data`, `/deposit-withdraw`, `/create-account`, `/login`, `/registration`, `/registration/local`, `/registration/cloud`, `/news`, `/voting`, `/explorer`, `/explorer/:tab`, `/asset/:symbol`, `/block/:height`, `/block/:height/:txIndex`, `/borrow`, `/barter`, `/direct-debit`, `/spotlight`, `/wallet`, `/create-wallet-brainkey`, `/existing-account`, `/create-worker`, `/help/**`, `/htlc`, `/prediction`, `/prediction/:market`, `/instant-trade`, `/instant-trade/:marketID`, `/pools`, `*`. `:params` matched by segment; `hashchange` re-renders; `document.title` follows the route.

- [ ] **Step 2: Syntax check + route smoke test in node**

Run: `node --check vanilla/js/router.js`
Expected: exit 0. (Full render test happens in the browser in Task 10: visit `#/`, `#/settings`, `#/market/BTS_USD`, `#/nope` → dashboard placeholder, settings page, market placeholder, 404.)

---

### Task 7: Settings/nodes page (`js/settings.js`)

**Files:**
- Create: `vanilla/js/settings.js`

**Interfaces:**
- Consumes: `Store` (settings + `DEFAULT_NODES`), `Chain.connect`.
- Produces: global `SettingsPage` with `SettingsPage.render(rootEl)`: network toggle (mainnet/testnet), node table (url, latency, status, select radio) + card layout under 560px, "probe all" latency pass on render, custom-node add (wss:// only, reject http/non-wss with inline error) and remove, active-node switch triggers reconnect; all-nodes-down shows status panel + Retry button (never blank); theme selector (original-blue/light/dark) persisted via `Store.saveSettings`.

- [ ] **Step 1: Write `vanilla/js/settings.js`** exposing `SettingsPage.render(rootEl)`. Exact element contract the CSS and tests rely on:
  - `div.wrap > h1("Settings")`, network toggle: two radio inputs `name="network"` values `mainnet|testnet` inside `#net-toggle`
  - node list: `table.node-table > tbody#node-rows` with one `<tr data-url>` per node (cells: radio `name="node"`, url text, `.latency` cell, `.node-status` cell) AND mirrored `div.node-cards > div.node-card[data-url]` (same data, card layout)
  - `#probe-all` button (re-runs latency), `#custom-url` input (`inputmode="url"`) + `#custom-add` button + `#custom-error.error`, `#retry-btn` inside `#offline-panel` (hidden unless all probes fail), theme `select#theme-select` with the three values
  - Probe loop (sequential, 6s timeout each — complete code, reuse verbatim):

```js
function probeAll(nodes, tbody) {
  var i = 0;
  function next() {
    if (i >= nodes.length) { paintOfflineIfAllDown(); return; }
    var url = nodes[i], row = tbody.querySelector('tr[data-url="' + url + '"]');
    setRow(row, "…", "connecting");
    Chain.connect(url, {timeoutMs: 6000}).then(function (r) {
      setRow(row, r.latencyMs + "ms", r.chainId.slice(0, 8));
    }).catch(function () {
      setRow(row, "—", "down");
    }).then(function () { i++; next(); });
  }
  next();
}
```

  (`setRow` writes the `.latency`/`.node-status` cells in both table row and matching card; `paintOfflineIfAllDown` unhides `#offline-panel` when every row reads "down". Selecting a radio saves via `Store.saveSettings({activeNode: url})` and calls `Chain.connect(url)`; network toggle saves `{network}` and reconnects to that network's first node; custom add accepts only `^wss://`, else inline error; theme select saves `{theme}` and re-sets `document.documentElement` theme.)

- [ ] **Step 2: Syntax check**

Run: `node --check vanilla/js/settings.js`
Expected: exit 0.

---

### Task 8: Boot wiring (`js/app.js` final)

**Files:**
- Modify: `vanilla/js/app.js` (Task 1 stub)

**Interfaces:**
- Consumes: `Store`, `Router`, `Chain`.
- Produces: full boot: load settings → apply theme → `Router.start` → `Chain.connect(activeNode)` → badge follows `Store.subscribe("connection")` (`#conn-badge` text + `data-state`); settings changes to theme re-apply `data-theme`; nav-toggle flips `#nav.open` + `aria-expanded`.

- [ ] **Step 1: Replace the stub with the full boot (~40 lines).**

- [ ] **Step 2: Syntax check**

Run: `node --check vanilla/js/app.js`
Expected: exit 0.

---

### Task 9: Headless WS probe (`tooling/ws-probe.mjs`)

**Files:**
- Create: `tooling/ws-probe.mjs` (Node stdlib only: `tls`, `net`, `crypto` — hand-rolled RFC 6455 client: opening handshake with `Sec-WebSocket-Key`, masked text frames, unmasked server frames incl. 16/64-bit lengths + fragmentation; sends login → database → `get_chain_id` + `get_dynamic_global_properties`; prints one JSON line `{url, chainId, headBlockTime, latencyMs}`; exit 0 on success, 1 with `{"error": ...}` on failure/timeout).

- [ ] **Step 1: Write `tooling/ws-probe.mjs`** (~130 lines, no npm deps).

- [ ] **Step 2: Probe testnet, then mainnet**

Run: `node tooling/ws-probe.mjs wss://testnet.xbts.io/ws`
Expected: `chainId` starts with `39f5e2ed`, exit 0.

Run: `node tooling/ws-probe.mjs wss://node.xbts.io/ws`
Expected: `chainId` starts with `4018d784`, exit 0.

- [ ] **Step 3: Record both outputs as the parity-note vectors (Task 10).**

---

### Task 10: Verify, parity note, audit, gate

**Files:**
- Create: `vanilla/notes/slice-01-settings.md`
- Modify: none.

- [ ] **Step 1: Rot gate**

Run: `python3 tooling/check_rot.py`
Expected: `ROT CHECK PASSED`, exit 0.

- [ ] **Step 2: Serve + browser pass** (`python3 -m http.server 8080 --directory /workspace/vanilla`): `#/settings` shows node table with latencies; switch node → badge flips connecting→open with correct chain ID; toggle testnet → list swaps, reconnects; kill network (offline) → status panel + Retry, never blank; 360px width — hamburger nav, no horizontal scroll; 1440px — full-width layout; theme selector cycles all three (screenshot trio).

- [ ] **Step 3: Write the parity note** (six fields per `building-vanilla-slices`: reference behavior with file:lines — `bitshares-ui/app/api/apiConfig.js:129-245`, `wallet-extension/src/lib/bitshares-api.js:62-110,325-355`, `bitshares-core/.../database_api.hpp:209,224,229`; vanilla file:lines; manual steps + observed results incl. probe outputs; test vectors — record "no money numbers in this slice" explicitly rather than skipping the field; theme trio + both viewport checks; §4.5(a–c) answers).

- [ ] **Step 4: Run the audit** (REQUIRED SUB-SKILL: use `auditing-vanilla-slices`, all seven checks). Fix findings, re-run until green. Do not start slice 2 until green.
