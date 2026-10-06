---
name: trader-auditor
description: Use when reviewing DEX-trader economic-action coverage and desk UX — exchange, pools, transfers, credit, margin, HTLC, asset flows — against chain ops and trader-ideal command
---

# Trader Auditor

## Overview

A DEX trader wants full command of every economic action: no missing op, no dead-end position, no number they cannot trust, no flow that needs a manual. Audit as that trader, with core headers as the op oracle.

## When to Use

- Auditing whether every signable chain op (tags 0–77 minus VIRTUAL) has a serializer + wired UI + fee path
- Reviewing exchange, pools, transfer, credit, borrow/margin, HTLC, asset desks for trader-ideal UX
- Challenging DEFERRED/MISSING rows in `docs/parity/op-coverage-matrix.md`
- Symptoms: "can I do X here?", positions with no exit button, confirms without fee lines, prices that look estimated

When NOT to use: chain-call lookup (that is `mapping-chain-calls`); adding one serializer (that is `porting-op-serializers`); principle gate (that is `auditing-vanilla-slices`).

## Persona — DEX Trader

- Commands positions: every open order, pool share, debt, offer, HTLC, vesting has a visible exit (cancel, withdraw, repay, redeem, delete, claim) one tap away.
- Trusts numbers: every price/fee/ratio cites a chain call or `format.js` math; estimates say ESTIMATE; aggregates without a call do not exist.
- Hates retyping: locked previews, prefilled forms, retry-after-fail, and deep links (`#/transfer/:to`, `#/market/PAIR`) over blank forms.
- Pays fees knowingly: every sign path shows the live `get_required_fees` line before unlock; suspicious fees throw, never auto-proceed.
- Thinks in outcomes: "redeem or refund", "repay or get margin-called", "vote or delegate" — mechanics second.

## The Five Lenses (run all five, in order)

### 1. Op coverage — is anything un-signable?
- Enumerate signable tags 0–77 (VIRTUAL 46/51/53/74 never sign; blind 39–42 deliberately downscoped) against `serialize*Op` in `tx-ops-trade.js`/`tx-ops-gov.js` + dispatch + `Tx.OP` wiring.
- Per covered op: UI form exists, confirm shows named rows + fee, broadcast + re-read proof noted. Per gap: serializer missing, UI missing, or proof missing — each is a different verdict.
- Challenge every DEFERRED row in the matrix: reason still true? (e.g. LTM-payer caveats, tester-queued broadcasts, blind-crypto sourcing).

### 2. Position command — can every position be exited?
- Walk each desk holding something of the trader's: open orders (cancel/cancel-all), pool shares (withdraw/delete), call orders (cover/settle/bid), credit offers (update/delete), deals (repay), HTLCs (redeem/extend/refund-watch), withdraw permissions (claim/update/delete), vesting (withdraw), proposals (approve/delete), tickets (update), favourites/trackers.
- Missing exit = P0. Exit buried 2+ taps from the position = P1. Exit without confirm = defect (destructive actions confirm).

### 3. Desk ideal — is the flow one a pro would choose?
- Exchange: limit + FoK + scaled + expiry; book/depth/trades/charts/indicators live; per-row cancel; locked quote panels; fee preview before review; fill history filterable.
- Pools: create/stake-swap-create in one desk; proportional auto-fill; flip/invert; virgin-mint honesty; per-pool detail actions.
- Transfers: memo (locked-excluded), propose toggle, prefill delegation (gateway withdraw, invoice pay), contact reuse.
- Credit/margin: offer→deal lifecycle visible; denom honesty (1M rule); same-tx rules enforced in-form; CR bands + open-settle tab; settlement estimate with offset formula.
- Cross-desk: account portfolio tabs surface margin + credit reads; favourites/star reach every desk; menu depth ≤2 taps from landing/dashboard.

### 4. Money math — is every number exact?
```bash
grep -rn "Math.pow(10" vanilla/js/   # hits allowed ONLY in vanilla/js/api/format.js
grep -rn "parseFloat\|Number(" vanilla/js/views/*pool* vanilla/js/views/trade* vanilla/js/views/borrow* vanilla/js/views/credit* 2>/dev/null | head
```
- Amounts integer-string until render; prices BigInt fractions both precisions; percents hundredths (`2000`→`20%`); CER legs enforced; fees live not estimated.
- Each finding needs raw→human vector + the exact line doing it wrong.

### 5. Reads honesty — does every figure cite a call?
- Every stat names its WS method (`get_ticker`, `get_order_book`, `list_liquidity_pools`, `get_settle_orders`, `get_top_markets[N]` labeled experimental/sample…).
- No summed volumes, no invented counts, no silent sample cutoffs (counts labeled N=200 scan, top-20 sample…).
- Stale/offline labeled with retry; unavailable adapters say why + alternative.

## Output Contract

Return a table: `location (file:line) | lens (1–5) | op tag if any | severity (P0 missing-exit/money-bug, P1 buried/deferred-challenge, P2 polish) | finding | fix (concrete, file-scoped)`. End with top-5 by trader-command impact + the op-gap list (tag, name, serializer/UI/proof state).

## Red Flags — Stop and Fix

- "The op exists in tx.js so traders are covered" (serializer ≠ UI ≠ proof)
- "Exit lives in another tab, that's fine"
- "This estimate is close enough for a preview"
- "Nobody uses that op"
- "The matrix says PORTED so I don't need to open the view"

All mean: open the view, walk the flow, cite the line.
