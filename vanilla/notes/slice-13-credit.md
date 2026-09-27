# Slice 13 parity note — credit + Same-T + borrow (+ barter form)

Plan: `docs/superpowers/plans/2026-09-28-slice-13-credit.md` (Tasks 1–4).

## What landed (vanilla file:line)
- `vanilla/js/tx.js` — 12 serializers: op 3 (no expiration; ext optional TCR),
  ops 64/65/66/67/68 (samet, canonical `new_fee_rate`), ops 69/70/71/72/73/76
  (credit; 72 ext omit/set; 76 `account` + auto_repay enum 0/1/2).
  Op 74 VIRTUAL never serialized. Stale #3 names not ported.
- `vanilla/js/credit.js` (400) + `vanilla/js/credit-samet.js` (148) — reads
  (offers/deals/funds/positions with `get_margin_positions`→`get_call_orders`
  fallback), rate math (denom 1M, TCR divisor 1000), builders, in-place fees.
- Views (all ≤400): `credit-ui.js` 374 (`#/credit-offer`), `credit-detail-ui.js`
  284 (`#/credit-offer/:id` + accept/repay/update/delete), `samet-ui.js`
  (`#/samet`, combined Borrow+Repay), `borrow-ui.js` 270 (`#/borrow` + op-3),
  `barter-ui.js` 188 (`#/barter` form+preview, PROPOSE disabled).
- Routes `router.js:82-84,101-102`, tags `index.html`.

## Reference behavior (file:line)
- #4 wins: spaces samet `1.20.x` / offers `1.21.x` / deals `1.22.x`
  (`types.hpp:383-385`); fee_rate denom 1M (`config.hpp:121` + #1
  `FEE_RATE_DENOM=1000000`) — #2's /10000 declared buggy (6 places).
- TCR divisor 1000 both directions (#1 `BorrowModal.jsx:57-60,478-484`).
- #1 collateral direction (base=debt 1 unit) accepted first try.

## Bugs found by verification, fixed + re-proved
- Samet confirms showed raw → human + raw-title + symbol (credit pattern).
- FINDING D: lone op-67 ALWAYS rejects (`Unpaid SameT Fund debt`,
  `db_block.cpp:778`) → combined [67,68] single-tx order (fee on EVERY op);
  repay-only gated on fresh unpaid read. Proven on fund `1.20.30`
  (create→combined→delete, blocks `100930968/69`, balance walk exact).
- Barter manual-Retry only → auto-reconnect subscribe (spotlight pattern).
- False alarm (director): `themes.css ::root` suspicion WRONG — file correctly
  uses `:root` (verified on disk); light-vs-blue shot similarity stays a
  tester item, not a code bug.

## Test vectors (raw → human, real files, live testnet)
- Offer `1.21.43`: create 5.0 AFKTEST10 rate `1000`→`0.1%` fee `103110`→`1.03110`
  — `~100930628`; accept (omit) → deal `1.22.70` fee `100000`→`1.0`;
  repay `5000`+fee `5` (`ceil(5000·1000/1M)`) — `~100930629`; op-76
  auto_repay 0→1 fee `1000`→`0.01` — `100930630`; op-71 rate →`2000` +
  borrowers set — `100930630`; accept (set) → `1.22.71` — `100930682`;
  full repays (fee `5`/`20`) deals removed; delete fee `0` — `100930683`.
- Fund `1.20.29`: create 5 TEST fee `100000` — `100930683`; [67+68] same-tx
  bal `500000`→`500100` — `100930730`; update →`2000` — `100930741`;
  delete fee `0` — `100930741`.
- Margin: `get_margin_positions`→`[]` proven; op-3 broadcast client-gated
  (never risked fixture) — honest.
- Rate math: `1000`→`0.1%`, `2000`→`0.2%`, NOT pool-hundredths; `1750`→TCR 1.75×;
  `86400`→`1 day`; two-precision collateral legs.
- Chain traps observed (all recovered): non-empty collateral required; balance
  must cover; borrow ≥ min_deal; fee on EVERY op of multi-op tx.
- Money reconciles exact (14 tx fees Δ`1206937`); leftovers: deal history rows
  only (no deal-delete op exists).

## Manual test (headless, --network testnet, zero console errors ×11)
- `#/credit-offer`, `#/samet`, `#/borrow`, `#/barter` @1440 blue/dark/light +
  390: retro shell, connected badge, lock gates, zero `undefined`. Vanilla
  columns match #1 `credit-offer.png` family (ID/ASSET/ACCOUNT/TOTAL/RATE…).

## Tester pass (queued)
- Offer create→accept→repay→delete + fund create→combined→delete visuals;
  rate/fee rows; trio; 390.

## Anti-rot gate (§4.5): (a) yes — static + existing Tx/Chain reuse; (b) nothing
new depended on; (c) smallest deletable: barter page (credit/samet/borrow
stand). `check_rot.py` PASS.
