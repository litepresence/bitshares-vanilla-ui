# Slice 06 (Exchange Trading) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trade on the desk — limit orders (buy/sell, fill-or-kill, expiration presets), scaled multi-order placement in ONE transaction, per-order cancel + cancel-all. Generalizes slice-4 signing to multi-op transactions.

**Architecture:** `tx.js` grows op 1 + op 2 serializers and multi-op build/fee (same file, credited ports). New `trade-ui.js` owns all trading panels, mounted into the desk by a minimal `market-ui.js` hook. `format.js` gains exact price-fraction parsing (BigInt throughout, zero float).

**Tech Stack:** Vanilla JS + WebCrypto + vendored noble. Node 20 stdlib for checks. Python 3 for rot gate.

## Global Constraints

- Zero runtime dependencies; platform APIs only; `python3 -m http.server`-servable.
- No float money math (audit greps). Amounts AND prices are integer/fraction strings until render.
- Op fields per #4 `market.hpp:72-101` (create: fee, seller, amount_to_sell, min_to_receive, expiration `time_point_sec::maximum()` default, fill_or_kill, extensions; op id 1) and `:145-155` (cancel: fee, order, fee_paying_account=seller, extensions; op id 2). Serialization ports from #3 (`serializeLimitOrderCreateOp` :1760, `serializeLimitOrderCancelOp` :1812 + dispatch entries); BJS on demand if ambiguous.
- Expiration presets like #1 (`Exchange.jsx:250`: HOUR/DAY/WEEK/??/YEAR/SPECIFIC — read exact list during implementation; default YEAR) + custom datetime; wire format uint32 seconds (`new Date(op.expiration + 'Z')/1000`, #3 :1771 — timestamps, not money, `Date` allowed).
- Fees per op from `get_required_fees` with the FULL op list (one call, N fee entries); total displayed human-formatted.
- Scaled semantics (from #1 `ScaledOrderTab.jsx:304-322`): N orders, priceLow→priceHigh equal steps (`step=(upper-lower)/(N-1)`), amount split evenly with integer-division remainder on the LAST order (conservation, no dust loss).
- Test keys only on testnet. Test orders MUST be canceled after verification (leave no junk on the book). Viewports 360px→4K; ≥44px; no hover-only UI. One global per file + `module.exports` guard.

---

## File Structure

```
vanilla/
├── js/
│   ├── tx.js          ← TASK 1: +op1/op2 serializers, multi-op build/fee (append patterns exist)
│   ├── format.js      ← TASK 1: +parsePriceRatio (exact below)
│   ├── trade-ui.js    ← TASK 2: NEW panels (buy/sell, scaled, cancels)
│   ├── market-ui.js   ← TASK 2: mount-point hook ONLY (minimal edit)
│   └── market-orders.js ← TASK 2: cancel buttons (modify; single worker owns it this round)
└── notes/
    └── slice-06-trading.md  ← TASK 3: parity note
```

---

### Task 1: Multi-op transactions + price fractions

**Files:**
- Modify: `vanilla/js/tx.js` (append serializers + generalize build/fee ONLY).
- Modify: `vanilla/js/format.js` (append + export entry ONLY).

**Interfaces:**
- `Tx.OP = {transfer: 0, limit_order_create: 1, limit_order_cancel: 2}` (extend existing dispatch, don't fork).
- `Tx.buildTx(opsArray)` where opsArray = `[[opId, opData], ...]` — `buildTransfer` reimplemented ON TOP of it (no duplicated envelope logic; transfer behavior byte-identical — prove with the Task-4 Step-2 cross-check fixture from slice 4 if still in /tmp, else re-derive one).
- `Tx.feeMulti(opsArray, feeAssetId)` → per-op `[{amount, asset_id}]` via ONE `get_required_fees` call; fills each `opData.fee` in place; returns `{fees, totalRaw, totalDisplay}` (total via BigInt add + `Format.formatAmount`).
- `Format.parsePriceRatio("100.5")` → `{num: 1005n, den: 10n}` (exact code: split on `.`, den = 10^fracLen, throw on garbage/empty/negatives). Receive-side math stays `sell_raw * num / den` (floor) with remainder to last order — all BigInt, specified here so Task 2 needs no math decisions.
- Serializer ports: `serializeLimitOrderCreateOp` (fee, seller, amount_to_sell, min_to_receive, expiration-uint32, fill_or_kill-byte, extensions-set — #3 :1760-1809; extensions: empty set `varint(0)` unless on_fill actions present, same collapse logic) and `serializeLimitOrderCancelOp` (fee, fee_paying_account, order, extensions — #3 :1812+). Per-function header credits + BJS cross-check note.

- [ ] **Step 1: Implement** (tx.js +~120 lines, format.js +~15 lines).
- [ ] **Step 2: Checks** — `node --check` both, exit 0, plus:

Run:
```
node -e "
const F = require('/workspace/vanilla/js/format.js');
const r = F.parsePriceRatio('100.5');
if (r.num !== 1005n || r.den !== 10n) throw new Error('ratio');
// receive math: sell 100000 raw @100.5 -> 10050000 floor, remainder tracked
const recv = 100000n * r.num / r.den;
if (recv !== 10050000n) throw new Error('recv');
console.log('RATIO VECTORS GREEN');"
```
Expected: `RATIO VECTORS GREEN`, exit 0.

---

### Task 2: Trading panels + cancel UI

**Files:**
- Create: `vanilla/js/trade-ui.js`.
- Modify: `vanilla/js/market-ui.js` (mount hook ONLY: a `<section class="trade">` mount point inside the desk + one `TradeUI.renderPanels(doc, mount, ctx)` call with the ctx the desk already holds), `vanilla/js/market-orders.js` (cancel buttons ONLY), `vanilla/index.html` (ONE tag: `js/trade-ui.js` in dependency order — read current order first).

**Interfaces:**
- Consumes: `Tx`, `Market`, `Format`, `Wallet` (unlocked gate with return path — same pattern as transfer/account), `Account` (my id), `Store`.
- Produces: global `TradeUI`:
  - `renderPanels(doc, mount, ctx)` with `ctx = {base, quote, basePrec, quotePrec, baseSym, quoteSym, myId|null, refresh}`: Buy/Sell tabs (side select; amount input parsed by asset precision; price input parsed by `parsePriceRatio`; FoK checkbox; expiry select Hour/Day/Week/Month?/Year/Custom — read #1's exact preset list first, default YEAR; live fee line via `Tx.feeMulti` for the single op; confirm screen with Side/Price/Amount/Total/Fee/Expiry per #3 wording; Sign&Send → result with block #).
  - Scaled tab: N (2–20), priceLow, priceHigh, total amount, side, expiry; preview table (per-order price/amount, remainder note on last row); ONE multi-op tx on confirm; per-op fees summed + displayed.
  - Cancel: each my-order row gets Cancel → inline confirm (order id `1.7.x` + pair + warning) → single-op cancel tx → result. Cancel-all button (only when ≥2 orders): confirm lists the COUNT → one N-op tx.
  - All errors inline (insufficient funds pre-check via balances, bad price/amount, broadcast reject with node text), never blank. No WIF in DOM. Amounts integer strings; prices fraction structs; display only at render.

- [ ] **Step 1: Write `vanilla/js/trade-ui.js`** (~350 lines — over ~450 → split trade-confirm into same file? NO new files beyond plan: if it passes ~450, record split candidate for the readability pass instead of inventing files mid-slice).
- [ ] **Step 2: market-ui hook + market-orders cancel buttons + script tag** (exact, minimal).
- [ ] **Step 3: Syntax checks** — `node --check` all touched JS, exit 0.

---

### Task 3: Verify (place AND cancel live), parity note, audit, gate

**Files:**
- Create: `vanilla/notes/slice-06-trading.md` (+ throwaway `/tmp/trade-*.js`, NOT committed).

- [ ] **Step 1: Gates** — `python3 tooling/check_rot.py` exit 0; SLIP + float-money greps CLEAN.
- [ ] **Step 2: Serializer cross-check (no broadcast)** — independent `/tmp` reimplementation of op-1/op-2 bytes for FIXED fixtures vs `Tx._ser` output: byte-identical or STOP. Canonical-sig check on the envelope digest with a throwaway key.
- [ ] **Step 3: LIVE place + cancel (testnet ONLY)** — with lite-test-1 keys via file (never pasted): place a TINY buy order far off-market (never fills: price 1% of best, min amount) → confirm inclusion → read back via `get_limit_orders_by_account` (order `1.7.x` present, fields match) → CANCEL it → confirm gone (book clean — MANDATORY cleanup, verify empty). Then scaled N=3 micro-orders → confirm all 3 on-chain → cancel-all → confirm empty. Then FoK-with-impossible-price → node must REJECT the tx (error recorded — proves FoK semantics without filling). Fee charged (raw + display) recorded per broadcast.
- [ ] **Step 4: Error paths** — overspend (insufficient), bad price decimals, locked-wallet direct navigation, expired-custom-date in past, cancel foreign order id (node must reject — use a nonsense `1.7.999999999`? NO — canceling others' orders is impossible without their keys; instead: cancel an already-canceled order → node reject recorded).
- [ ] **Step 5: Parity note** (seven fields + §3.7: reference file:lines — #4 `market.hpp:72-101,145-155`, #3 serializer lines, #1 `MarketsActions.js:566-660` + `ScaledOrderTab.jsx:304-322`; serializer inventory (op 0/1/2 in `tx.js`); vectors incl. multi-op fee + remainder-conservation proof (sum of per-order raws == total raw); theme trio + both viewports PENDING-BROWSER with tester steps; §4.5(a–c)).
- [ ] **Step 6: Audit** (all eight checks; browser-dependent honestly PENDING-BROWSER). No slice 7 until green-minus-browser.
