# AFK Round 3 record — ES centralization + holders + type-gate repair

## Worker A — Phase 4b migration (`market-fills-history.js`, `pool-history.js`)
- `esFills`/`esSwaps` route through `HistoryCap.esSearch`; query DSL bodies
  byte-identical (runtime-probed `JSON.stringify(sent)===JSON.stringify(
  esQuery(...))`, index `bitshares-*`, search_after intact); URL equivalence
  `ES_URL===ES_BASE+"/bitshares-*/_search"` proven true both files.
- Pref gating: esAllowed() false → chain directly, `source:"chain"` (existing
  labels, zero new strings). Missing-HistoryCap → reject to chain (direct
  fetch FORBIDDEN — centralization rule).
- Behavior delta: none (only rejection-message strings changed, same
  `.catch(chain)`; timeout 15s+Abort → per-page remainder in esSearch opts).

## Worker B — Phase 4a holders (`explorer-assets.js` + 4 keys + test)
- Live-curl FIRST: astro's shape works desc-sorted (`total=gte 10000`);
  observed `_source`: id/asset_type/balance(JSON number, raw)/owner_
  (trailing underscore, 1.2.x)/object_id/block_time/block_number — no names,
  no precision in hits (names via existing accountLink, prec in scope).
  Balances kept digit-strings (never astro's Number()).
- Panel after descBox (before the smartcoin early-return — UIAs included):
  node-table/xplore-scroll classes, top-25 Account+Balance, raw in title,
  ES-off/unavailable → keyed notice + settings link. `parseHolders` pure.
- Test 69 checks; keys asset.holders_{title,account,balance,unavailable}.

## Director — type-gate repair (workers' blind spot, my fix)
- Worker's `require("./history-cap.js")` fallback broke checkJs (TS2591:
  browser libs have no node types — correctly so). Removed from both files;
  harnesses preload `globalThis.HistoryCap` instead (2-line test edits).
  Rule learned: shipped code never names module loaders; recorded here so
  future workers don't reintroduce it.
- types PASS · fills 29/29 · pool-history 31/31 · holders 69 PASS.

## Shots (zero console errors throughout)
- `#/asset/BTS` tall: Top holders LIVE (gate-io-bts66 389770474.06455 …
  evan 10659691.88478 — real names, p5 human balances, linked ids).
- `#/market/BTS_USD`: desk live (ticker, book, charts); timeframe radios now
  drawn from reconcileBuckets (5m/15m/1h/4h visible; 1D/1m/1W below fold —
  pre-fix these three never rendered on this node).

## Gates
types PASS · rot PASS · i18n OK (3092 keys) · all prior suites green.
Money: holders via formatAmount(prec-in-scope) — vectors in holders test.
Anti-rot: (a) platform only (fetch is platform); (b) no new dep — one seam
owns all ES; (c) deletable: migration (old fetch restorable), panel (asset
view stands) — kept: centralization + the flagship ES surface.
§4.5(b) exception (raw ES): filed — removable via WS fallbacks + one-constant
host swap; recorded here, carried into the final audit.
