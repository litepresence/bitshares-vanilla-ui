# Sell-side scaled batch — testnet proof (2026-10-05)

Addendum to slice-06 (`slice-06-trading.md`) and the scaled-toggle report
(`.superpowers/sdd/scaled-toggle-report.md` concern #5): the new UI path
(sell-column SCALED review → op-1 batch) previously had vector proof only.
This entry records the live broadcast.

## Spec (sell column SCALED review, dust, cannot fill)

- Account `lite-test-1` (`1.2.26833`), fixture
  `tooling/testnet-lite-test-1.json` (keys as `<keys>`, never printed).
- Node `wss://testnet.xbts.io/ws`, chain `39f5e2ed…` asserted pre-broadcast.
- Market TEST/USD: TEST `1.3.0` p5 (QUOTE, sold) / USD `1.3.15` p4 (BASE,
  received). Live book best bid `100` USD/TEST (`get_order_book`).
- Spec: side `sell`, N=`2`, low=`10000`, high=`20000` USD/TEST (100x best
  bid → rests, cannot fill), total=`0.4` TEST (raw `40000`), expiry YEAR.
- Math: exact `scaledOrders` (`trade-panels.js:1175-1228`) sell branch —
  `Format.parsePriceRatio` + `TradeCore.quoteToBaseRaw`, remainder last.

## Observed

- Legs: `#1 sell=20000 TEST-raw recv=20000000 USD-raw @10000/1`
  (`2000.0000 USD`), `#2 sell=20000 TEST-raw recv=40000000 USD-raw @20000/1`
  (`4000.0000 USD`). Split sum `20000+20000=40000` == total (remainder
  exact; both legs equal here since 40000/2 divides evenly).
- Op shape: `limit_order_create`, `amount_to_sell 1.3.0` /
  `min_to_receive 1.3.15`, `fill_or_kill false` (scaled never FoK).
- `feeMulti` ONE call over 2 ops → fees `[100,100]`, totalRaw `200` →
  `0.00200 TEST`.
- Broadcast via `broadcast_transaction_with_callback` → orders
  **1.7.9233097**, **1.7.9233098** (each `for_sale=20000`), both present in
  `get_limit_orders_by_account`.
- History op-1 inclusion: block **101146020/0** (one tx, both legs — the two
  legs carry identical sell amounts so the content-match collapses to one
  key; same-tx ⇒ same block by construction).
- Cancel-all (2 cancel ops, ONE tx, fee totalRaw `20` → `0.00020 TEST`) →
  block **101146022/0** (both order ids) → both gone from book.
- Balance trail (TEST raw): `3771257` → `3771237` (Δ `-20` = cancel fees
  only — create fees escrowed while resting, released on cancel; matches
  the slice-06 deferred-fee rule). Book-clean (`open orders 0` before and
  after), balance reconciles.

## Method

Headless worker `/tmp/scaled-sell-live.cjs` (throwaway, not committed):
shipped `vanilla/js` files only (`noble-classic` via vm for globals,
`crypto`/`format`/`tx-primitives`/`tx-ops-trade`/`tx-ops-gov`/`tx`/`tx-send`/`trade-core`
via require), stdlib WS framing per `tooling/ws-probe.mjs`. No
reimplementation — the leg math is the shipped `Format`+`TradeCore` calls
with the shipped `TradeCore.createOp`/`Tx.buildTx`/`Tx.feeMulti`/`Tx.sign`
rail.
