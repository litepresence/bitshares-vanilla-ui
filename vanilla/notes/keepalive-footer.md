# Keepalive + footer-signal note (block-push, badge removal, explorer tabs)

Date: 2026-09-28. User reports: stale footer; ref parity (footer color
signal, no top badge); explorer subtabs; per-block updates.

## 1. Reference behavior

- #1 footer: node location name colored (green/red), latency + block, no
  topbar badge. `Explorer.jsx:18-64`: 8 tabs.
- #3 `bitshares-api.js:27/214` (notice map + handler), `:3883`
  (set_subscribe_callback pattern).
- #2 `BlocksLive.ts`: `set_block_applied_callback` pushes the applied block;
  block number from id head bytes; testnets may disallow subscriptions.

## 2. Vanilla implementation

- `chain.js`: 20s heartbeat now samples RTT latency (monotonic tip guard
  added after the suite caught a beat/notice race); `set_block_applied_callback
  [1]` on connect (best-effort); `onmessage` routes `method=notice` to
  onBlockNotice (monotonic advance only). Wire shape proven live first
  (4 notices/12s, `[blockid]` payload).
- `app.js`/`index.html`/`app.css`: badge deleted (element, paint fn,
  subscription, CSS); footer host span green/red (`--buy`/`--danger`).
- `explorer-tabs.js` (new): pools/accounts/witnesses/committee/markets/fees
  in ref order (+feeds kept); shell dispatches with gen guard.
- `tooling/chain-keepalive-test.js`: +notice case (caught the race).

## 3. Observed (headless, zero console errors)

- Footer blocks tick per applied block (…164 → …169 over 15s); latency
  refreshes on beats (426 → 47ms). Closed state: red host + red state.
- Explorer: 6/6 tabs live (pools, account search, 194 witnesses with
  16 active correctly flagged, committee, top markets human strings, fees).
- Account/voting @1920: full-bleed tables (`.wide` verified, no stranded col).

## 4. Vectors

Keepalive suite green incl. notice case; pool-history 21/21; indicators
63/63. No money math in footer/explorer tabs (verbatim human strings).

## 5. Anti-rot

(a) Push dies with the socket; heartbeat covers unsubscribed nodes; ES/TS
nowhere near this path. (b) No new deps (fetch/WebSocket are platform).
(c) Deletable: subscription (heartbeat remains), any tab renderer.
