# Slice 01 — Shell + Settings/Nodes: parity note

Date: 2026-09-26. Plan: `docs/superpowers/plans/2026-09-26-slice-01-shell-settings-nodes.md`.

## 1. Reference behavior

- Node list + active-node select + testnet switch: `bitshares-ui/app/api/apiConfig.js:129-245`
  (legacy list incl. dead hosts — NOT copied verbatim, see §4).
- WS handshake (login → database api id → chain queries) + failover loop:
  `wallet-extension/src/lib/bitshares-api.js:62-110` (iterative connect),
  `:325-355` (`login(['',''])`, `database`, `get_chain_properties` +
  `get_dynamic_global_properties`).
- Ground truth: `bitshares-core/.../database_api.hpp:209` (`get_chain_properties`),
  `:224` (`get_chain_id`), `:229` (`get_dynamic_global_properties`); all three
  reflected for WS clients (`:1487-1491`).

## 2. Vanilla implementation

| File | Lines | Role |
|---|---|---|
| `vanilla/index.html` | 32 | shell: viewport meta, topbar + `#conn-badge`, `#nav-toggle`, `#nav`, `#view` |
| `vanilla/css/themes.css` | 20 | token sets for original-blue (default), light, dark |
| `vanilla/css/app.css` | 43 | layout, collapsing nav <720px, table→cards <560px, fluid grid ≥1200px |
| `vanilla/js/store.js` | 114 | pub/sub (`settings`, `connection`), localStorage `bts-vanilla-settings-v1` |
| `vanilla/js/chain.js` | 66 | sole WebSocket owner; handshake per references; badge updates |
| `vanilla/js/router.js` | 177 | 37 routes (§6); placeholders; 404 |
| `vanilla/js/settings.js` | 353 | node table+cards, sequential latency probe, select, network toggle, wss-only custom add, offline panel + Retry, theme select |
| `vanilla/js/app.js` | 59 | boot: settings → theme → router → connect; badge + reconnect subscriptions |

## 3. Manual test steps + observed result

Headless (this environment, 2026-09-26):
- `node tooling/ws-probe.mjs wss://testnet.xbts.io/ws` →
  `{"chainId":"39f5e2ed…617447","headBlockTime":"2026-09-26T20:44:27","latencyMs":968}`, exit 0 ✅
- Same probe, `wss://node.xbts.io/ws` → mainnet `4018d784…dad512c8`, exit 0 ✅
- All 6 default mainnet + 2 testnet endpoints probed: 7/8 live with correct
  chain IDs; `btsws.roelandp.nl` DNS-unresolvable from sandbox → kept LAST in
  list (failover covers; see §4).
- `node --check` on all 5 JS files: clean ✅
- `python3 tooling/check_rot.py`: PASSED ✅
- DOM-shim smoke (`/tmp/dom-smoke.js`, throwaway): 37 routes load, settings
  renders without exceptions, probe loop + App boot clean ✅
- `python3 -m http.server` serves the tree (file listing verified; rendering
  needs a browser — below).

Browser (PENDING — follow steps A–E below in order; record PASS/FAIL per step):

Setup (do once):
1. Open a terminal, `cd /workspace`, run `python3 -m http.server 8080 --directory vanilla`
   and leave it running. Confirm it prints `Serving HTTP on ... port 8080`.
2. Open Chrome/Edge/Firefox to `http://localhost:8080/`. Open DevTools
   (F12) → Console tab, and keep it visible: any red error during the steps
   below is an automatic FAIL for that step — copy the message into your report.
3. You should see a blue top bar ("BitShares" + a status badge), a nav row
   (Dashboard, Exchange, Account, Transfer, Explorer, Voting, Settings), and
   an empty content area. If the page is blank or the console is red, stop and
   report FAIL at "Setup".

PASS

Step A — node table loads with live latencies:
1. Click "Settings" in the nav (URL becomes `http://localhost:8080/#/settings`).
2. You should see "Settings", a Mainnet/Testnet toggle, a table of 6 nodes
   (api.bitshares.dev first), each row gaining a latency like "419ms" and a
   short chain prefix within ~30 seconds. A "Probe all" button re-runs this.
3. PASS if: all rows resolve to a latency or "down" (roelandp may show down —
   that is EXPECTED, not a failure), no console errors. FAIL otherwise.

PASS

Step B — switching nodes reconnects:
1. Note the badge text in the top bar (e.g. `connected · 4018d784 · 419ms`).
2. Click the radio button of a DIFFERENT node row (e.g. public.xbts.io).
3. PASS if: badge flips to "connecting…" then back to `connected · 4018d784 · …`
   with a different latency, no console errors, and after reload
   (F5 → back to `#/settings`) the same node is still selected (persistence).
   FAIL if the badge sticks on "connecting" over 30s or the selection resets.

FAIL, doesn't reconnect.  on f5, goes to "connecting..." -> "closed"

REPAIR 2026-09-26 (root cause found — tester was right): the settings page
latency probe called `Chain.connect()` per node, and `connect()` kills the
shared socket first (`chain.js` disconnect-on-connect). The probe loop's last
node is dead roelandp, so every F5 ended with the shared connection murdered
and the badge on "closed". Fix: new `Chain.probe(url, timeoutMs)` in
`vanilla/js/chain.js` runs the handshake on a throwaway socket with its own
pending map and emits NO status; `probeAll` in `vanilla/js/settings.js` now
uses it, so probes can never disturb the boot connection. Also fixed:
latency/chain cells ran together in cards ("677ms4018d784") — added spacing
in `vanilla/css/app.css`. Verified: `node --check` clean on both files, rot
gate PASSED, DOM-shim smoke clean. STEP B RESET TO PENDING — please re-run
Step B above on the fixed build.

PASS

Step C — testnet toggle:
1. Switch the network toggle to Testnet. The table should swap to 2 rows
   (testnet.xbts.io, testnet.dex.trading) and the badge should reconnect.
2. PASS if: badge reads `connected · 39f5e2ed · …` (note the DIFFERENT prefix
   vs mainnet's `4018d784`), no console errors. Switch back to Mainnet and
   confirm `4018d784` returns. FAIL on wrong prefix or stuck badge.

PASS

Step D — all-nodes-down is never blank:
1. In DevTools go to Network tab → set "Offline" (or disconnect Wi-Fi).
2. Click "Probe all" (or reload the page).
3. PASS if: a visible status panel appears with a Retry button (NOT a blank
   page), and clicking Retry after going back online reconnects. FAIL on blank
   content or missing Retry.

PASS

Step E — viewports + themes:
1. Theme trio: find the theme selector on the settings page, choose Light,
   take a screenshot; choose Dark, screenshot; choose Original Blue,
   screenshot. PASS if all three render readably (no invisible text).
2. Phone width: resize the window to ~360px wide (DevTools → device toolbar →
   iPhone SE or 360×800). PASS if: a ☰ hamburger appears and opens the nav,
   node rows become stacked cards (no table), no horizontal scrollbar.
3. Desktop width: maximize / stretch to ≥1440px wide. PASS if: content uses
   the width (no stranded narrow column), header spans fully.
4. Attach the 3 theme screenshots + 2 viewport screenshots (360px, 1440px).

PASS, screenshots are next to this file

Report format: for each of A–E, one line `PASS` or `FAIL + what you saw`
(console errors quoted). Only all-PASS closes the browser pass.

## 4. Raw→human test vectors

No money numbers exist in this slice (connection status, latencies, node URLs
only). Explicitly: nothing here divides by precision, so principle #6 is
vacuously satisfied. First vectors land with the wallet/account slice.
Probe vectors above double as the chain-identity vectors
(`39f5e2ed…` = testnet, `4018d784…` = mainnet).

## 5. Theme + viewport checks

Tokens for all three themes ship (`themes.css`); selector persists via settings.
Screenshots (trio + 360px/1440px) PENDING browser pass above.

## 6. Anti-rot gate (§4.5)

- (a) Ten years, zero maintenance: static HTML/CSS/JS + platform WebSocket +
  localStorage — runs wherever browsers speak WS + ES5-level JS. YES.
- (b) New dependencies: NONE. `tooling/ws-probe.mjs` is Node-stdlib dev tooling,
  never shipped or required. Vendored crypto: not yet needed (no signing).
- (c) Smallest deletable subset: `ws-probe.mjs` (verification convenience;
  browser pass covers the same ground). Kept because headless probes de-risk
  every future slice's testnet step.
- `check_rot.py`: PASSED. Node list is data (editable, persisted), not code.

## Ruling log (chain-doctor)

- Node list: worker's first draft used legacy hosts (`api.bitshares.ws`,
  `*.nodes.bitshares.ws`, `api.bts.mobi`, `bts-api.lafona.net`) — replaced with
  the probe-verified 2026 set, ordered by observed latency, roelandp last.
  Tiebreaker: live testnet observation over stale reference data.
