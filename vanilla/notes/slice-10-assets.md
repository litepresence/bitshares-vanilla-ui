# Slice 10 parity note — asset ops

Plan: `docs/superpowers/plans/2026-09-28-slice-10-assets.md` (Tasks 1–4).

## What landed (vanilla file:line)
- `vanilla/js/tx.js` — 7 serializers appended: op 10/11/12/13/14/15/19 +
  `serializeAssetOptions`/`serializeBitassetOptions`/`serializePrice`/
  `serializePriceFeed`/`serializeIdSet`. BJS cross-check fetched
  (`operations.js` 2026-09-27): all orders match #3/#4, no conflicts.
- `vanilla/js/asset.js` — reads (`issuedBy`, `describe`, `feeSchedule`) +
  builders `buildCreate/Update/UpdateBitasset/UpdateProducers/Issue/Reserve/
  Feed` + `fee` + `sendAndProve`; percent/ratio helpers (integer-only).
- `vanilla/js/asset-ui.js` (267: list + create) + `vanilla/js/asset-manage-ui.js`
  (275: update + issue) + `vanilla/js/asset.js` (170: reads) +
  `vanilla/js/asset-ops.js` (380: builders + helpers) — split per audit B2,
  re-verified (fee table renders, zero `undefined`, rot PASS).
- `vanilla/js/asset-feed-ui.js` (261) — `#/assets/feed` (read-back + op-19 +
  op-13 editor) + `feeSection` fee-schedule table.
- Routes `router.js:116-120`, tags `index.html` before `router.js`.

## Reference behavior (file:line)
- #4 wins throughout: op ids + FC order `asset_ops.hpp:626-639,650-658,682-726`;
  price_feed `asset.hpp:312-313`; chain ground truth `asset_ops.cpp:178`
  (settlement.base == CER.base) + `asset.cpp:266-273` (`is_for`).
- #1 `Asset.jsx:738-748`: MCR/MSSR/MCR ÷1000 (`1750`→`1.75×`); market fee
  hundredths (`200`→`2%`). NFT = description-JSON convention; PMA = op-10 +
  `is_prediction_market:true` (no separate ops). Ops 16/17/18/43/47/48
  deferred (settle→slice 13).

## Bugs found by verification, fixed + re-proved
- F1 BLOCKING: feed CER legs swapped (views built CER base=backing). Fixed
  (`asset.js:444-467`, `asset-feed-ui.js:7-11,172,190-213,218`) → feed
  ACCEPTED at **block `100918551`** (settle + CER both `1.3.1850/1.3.0`,
  MCR 1750/MSSR 1500). Op-10 create CER placeholder (`1.3.1`) is correct —
  chain overwrites it (proven on re-read).
- B1 MONEY-CRITICAL (audit): `pctHumanToRatio("175")` returned `175` not
  `1750` (missing ×10 pad; decimals worked). Fixed (pad like sibling).
  Chain reconcile: `1.3.1850` bitasset `2.4.448` CURRENTLY stores MCR 1750 /
  MSSR 1500 — the F1 proof passed via explicit ints; only the UI form string
  path was broken, fixed at the single helper. Round-trips:
  `"175"→1750→"175"`, `"150"→1500→"150"`, `"175.5"→1755→"175.5"`, `"2"→200→"2"`.
- F2: `cold()` never subscribed → same `Store.subscribe("connection")`
  pattern as transfer/vote/explorer; proven by no-click re-render shot.
- F3: fee table compared cross-file gen → own `feeGen` guard; fee rows render.

## Test vectors (raw → human, real files, live testnet)
- CREATE UIA `AFKTEST10` (`1.3.1849`, p4): fee `20008496`→`200.08496 TEST`,
  maxsupply `10000000000`→`1000000.0000` — block `100918131`.
- ISSUE 10.0000: fee `197`→`0.00197`; supply/balance exact — ~`100918147`.
- UPDATE (desc): fee `8498`→`0.08498` — block `100918148` (first attempt
  correctly REJECTED `invalid asset * price` on create-style CER — evaluator
  proof the node parsed our bytes).
- RESERVE 1.0000: fee `100`→`0.00100`; supply `100000`→`90000` — `100918149`.
- MPA `AFKTESTM11` (`1.3.1850`, smartcoin, backing `1.3.0`) — `100918151`;
  op-12 lifetime 86400→43200 — `100918152`; op-13 self-producer — `100918156`;
  op-19 feed — `100918180` + F1 correction feed — `100918551`.
- Fee tiers live: op-10 `{symbol3:2000000000, symbol4:200000000,
  long:20000000, ppk:100000}`, op-11/14 `{fee:100, ppk:100000}`, op-12/13/15/19
  flat `100`; surcharges ≈ bytes × ppk (`+8496/+10058/+8398/+97`).
- Serializer: `200→c8 00`, `1750→d6 06`, `1500→dc 05`; op-10 UIA 86B / MPA 106B
  deterministic; `hundredthsToPct(200)="2"`, `ratioToPct(1750)="175"`.

## Manual test (headless, --network testnet, zero console errors)
- `#/assets` @1440 (+dark/light trio): fee table renders real rows, no stale
  offline panel; 390 stacks with hamburger.
- `#/assets/create|issue|feed`: connected badge + correct lock gate.
- Leftovers (no chain delete): `AFKTEST10` 9.0000 held by issuer; `AFKTESTM11`
  supply 0.

## Tester pass (queued)
- Create UIA → issue → reserve → update (named confirms, human fees);
  create MPA → set producers → publish feed; fee table; light visual; 390.

## Anti-rot gate (§4.5): (a) yes — static + existing Tx/Chain reuse; (b) nothing
new depended on (BJS fetched once as reference, never imported); (c) smallest
deletable: feed page (create/issue/update stand). `check_rot.py` PASS.
