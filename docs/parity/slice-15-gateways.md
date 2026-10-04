# Slice 15 parity note — gateways (XBTSX/BIT20/GDEX/IOB only)

Plan: `docs/superpowers/plans/2026-09-28-slice-15-gateways.md` (Tasks 1–3).
User scope: XBTSX, BIT20, GDEX, IOB ONLY — all other historic partners
(RuDEX/Citadel/BlockTrades/…) out of business → OUT OF SCOPE, not ported.
Reads-only slice: withdraw proven as prefilled `#/transfer` delegation;
deposit never broadcasts; `tx.js` untouched.

## What landed (vanilla file:line)
- `vanilla/js/gateway.js` (400) — adapter registry: `list/health/coins/
  depositAddress/validateWithdrawAddress/withdrawPrefill` + timestamped cache.
  Withdraw targets from LIVE rows only, never hardcoded. QR/RSA omitted (npm-only
  in #1, nothing zero-dep on disk).
- `vanilla/js/gateway-ui.js` (399) — `#/deposit-withdraw` (+`:gateway` tabs):
  health dots + Re-check, deposit/withdraw toggle, honest unavailable panels,
  withdraw → `#/transfer/<to>?asset=&memo=` delegation (existing op-0 confirm).
- `vanilla/js/transfer-ui.js` — surgical hook: `hashQuery()` parses
  `?asset=/ ?memo=`; query memo forces plaintext (gateways can't read encryption).
- Route `router.js`, tags `index.html`.

## Liveness (probed live, no keys — curl + in-page agree)
- XBTSX `GET /coin` → 200, 45 rows (`BTS, XBTSX.STH, XBTSX.GRAM…`; `XBTSX.BTC`:
  min 21000 p8, fee 20000, issuer `xbtsx-wallet 1.2.1014725`); POST → 404 (GET wins).
- IOB `GET /coins` → 200, 2 rows (`IOB.XRP, IOB.XLM`; issuer `ioxbank-gateway
  1.2.1787259`); deposit endpoint 404s verbatim → panel degrades.
- GDEX `api.52bts.net` + `openapi…/coins` → DNS NXDOMAIN (sandbox AND headless
  browser) = host death → manual-only unavailable panel + probe Retry.
- BIT20: no assets on-chain (`BIT20.*` all not found), `bit20` account exists
  but gateway-less (`1.2.106303`) → tab disabled, no URL guessed.
- XBTSX list flipped POST-first→GET-first (ambiguity A long decided; the doomed
  POST logged a console 404 on every fetch). Remaining console signal:
  GDEX `api.52bts.net` DNS failure — honest and expected (dead host; UI shows
  gateway-down + Retry). Not suppressible (Chromium logs failed fetches) and
  not a bug: it IS the health signal.

## Bug found by verification, fixed + re-proved (load-bearing)
- `backingCoin` dropped: normalizer read only `deposit_coin_type`, live hosts
  send `backingCoin` → every row null → withdraw memo `XBTSX.BTC:…` instead of
  `BTC:` (gateway non-credit risk). Fixed (`gateway.js:132` accepts both) →
  proven LIVE: `backingCoin: BTC`, `memoPrefix: BTC:`, `to: xbtsx-wallet`.

## Test vectors (raw → human, real Format)
- `21000` p8→`0.00021000`, `20000` p8→`0.00020000` (XBTSX.BTC fees);
  `100000` p5→`1.00000`, gateFee `"1"` p5→`0.00001`; `100000` p4→`10.0000`
  (IOB.XRP). GateFee `0.5` rendered as-is, labeled gateway-stated. No percent
  fields in payloads. Health timestamps human.

## Manual test (headless, --network testnet, zero console errors ×11)
- Desk @1440 blue/dark/light + 390: tabs with ●/✕ health, facts rows, honest
  red verbatim errors + Retry, unavailable panels legible. Withdraw click →
  exact hash `#/transfer/xbtsx-wallet?asset=XBTSX.BTC&memo=…` → locked gate
  (broadcast never pressed). Kill-switch: all-down stub → no throws.
- `#1` original page is a blank broken panel — working desk is a justified
  deviation (original broken, not styled).

## Tester pass (queued)
- Unlock → deposit fetch on live contact → withdraw prefill field assert
  (To/Asset/Memo-plain/Encrypted-unchecked) → trio → 390 → 2560 desk.

## Anti-rot gate (§4.5): (a) yes — static adapters, hosts are data not code,
gateway death = non-event; (b) nothing new depended on (fetch only);
(c) smallest deletable: BIT20/GDEX tabs (XBTSX/IOB stand). `check_rot.py` PASS.
