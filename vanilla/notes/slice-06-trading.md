# Slice 06 — Exchange Trading: parity note

Date: 2026-09-27 (UTC). Plan: `docs/superpowers/plans/2026-09-26-slice-06-trading.md`, **Task 3 only**
(worker scope: verification — writes ONLY this file; `/tmp/*.js` throwaways never
committed; no commits). Implementation under test: `vanilla/js/{tx,format}.js`
(Task 1) + `vanilla/js/trade-ui.js` + `market-ui.js` hook + `market-orders.js`
cancel buttons (Task 2, other workers). Fixture:
`/workspace/tooling/testnet-lite-test-1.json` (600-perms, read via scripts only;
keys referenced as `<keys>`, never printed). Node `wss://testnet.xbts.io/ws`,
chain `39f5e2ed…` asserted before every broadcast (abort armed, never triggered).

## 1. Reference behavior

- Op fields (ground truth, #4 wins): create = fee/seller/amount_to_sell/
  min_to_receive/expiration/fill_or_kill/extensions, op id 1 —
  `bitshares-core/.../protocol/include/graphene/protocol/market.hpp:72-101`
  (struct) and `:297-298` (FC_REFLECT byte order). Cancel = fee/
  fee_paying_account/order/extensions, op id 2 — `market.hpp:145-155` (struct;
  note the struct lists `order` before `fee_paying_account` at `:150-152` but
  FC_REFLECT at `:301-302` governs the bytes) .
- Deferred-fee design (#4): `market_object.hpp:53` (`deferred_fee` on the order
  object) + `market_evaluator.hpp:40-57` (create evaluator overrides `pay_fee`
  → fee deferred, not posted like generic ops). Live behavior derived from this
  crowns §3 (quoted-vs-burned finding).
- Serializer ports (#3): `wallet-extension/src/lib/bitshares-api.js:1760-1807`
  (create: fee, seller, amounts, expiration uint32 via `new Date(op.expiration+
  'Z')`, fill_or_kill byte, extensions-set collapse), `:1812-1828` (cancel),
  `:761-788` (fee fill), `:885-920` (ref-block/expiry envelope), `:1392-1415`
  (sign layout), `:855-880` (broadcast+callback). Signing/canonical/recovery:
  `crypto-utils.js:720-770/:775-815/:822-887`.
- Old-UI flows (#1): `app/actions/MarketsActions.js:566-626` (`createLimitOrder`;
  fee-asset fallback to `1.3.0` at `:576-594`), `:628-660` (`createLimitOrder2`
  multi-order loop); expiry presets + YEAR default
  `app/components/Exchange/Exchange.jsx:214-263` (HOUR/12HOURS/24HOURS/7DAYS/
  MONTH/YEAR/SPECIFIC) + `:65-68`; scaled step `(upper-lower)/(N-1)` +
  even amount split `ScaledOrderTab.jsx:304-322` (float-string `precise*`
  math — vanilla uses stricter BigInt, same semantics); open-order fee display
  reads `order.deferred_fee` (`app/lib/common/MarketClasses.js:524`).
- Confirm-dialog wording (#3): `src/popup/popup.js:5724-5737` (Seller / Sell
  (Amount to Sell) / Buy (Min to Receive) / Expiration / Fill or Kill /
  Fee Paying Account / Order ID).
- BJS cross-check: NOT consulted — no ambiguity found (#3 is explicit
  line-by-line, #4 FC_REFLECT confirms field order, testnet acceptance is the
  gate). Same standing policy as the `tx.js` header.

## 2. Vanilla implementation

| File | Lines | Role |
|---|---|---|
| `vanilla/js/tx.js` | 642 | op 0/1/2 serializers, `buildTx` (any op list), `feeMulti` (ONE `get_required_fees` call), `sign`, transfer-only `broadcast` |
| `vanilla/js/format.js` | 76 | `parsePriceRatio` (exact `{num, den}` BigInt), amount parse/format — only money-math entry points |
| `vanilla/js/trade-ui.js` | 1167 | Buy/Sell/Scaled panels, confirms, results, cancel + cancel-all boxes (see §3.7 split note) |
| `vanilla/js/market-ui.js` | 647 (hook ~:411-493) | desk mount point + `TradeUI.renderPanels(doc, mount, ctx)` only |
| `vanilla/js/market-orders.js` | 236 (hook ~:112+) | per-row Cancel + cancel-all box mounting; flows delegated to TradeUI |
| `vanilla/index.html` | +1 tag (`:43`) | `js/trade-ui.js` in dependency order |

Notable documented design point (`trade-ui.js:1-30` header):
`Tx.broadcast` is NEVER used for orders — its inclusion poll only matches op-0
transfers (`tx.js:538+`). Trade UI sends via `Chain` and proves inclusion with
order-book reads (`trade-ui.js:271-329` `sendTx`/`proveNewOrder`/`proveGone`).
The headless scripts below use the identical pattern (real `Tx` + `Chain`).

## 3. Manual test steps + observed result

Headless, real `vanilla/js/{tx,crypto,format}.js` in node 20 (noble via
`vm`-loaded `vendor/noble-classic.js`; stub `Store {network:testnet}`;
`Chain` = `/tmp/ws-chain.js`, stdlib WS modeled on `tooling/ws-probe.mjs`
framing with ping→pong). Scripts: `/tmp/trade-crosscheck.js`,
`/tmp/live-trade.js`, `/tmp/followup.js`, `/tmp/trade-errors.js`,
`/tmp/discover.js`, `/tmp/book.js`, `/tmp/book2.js` (throwaways).

Deviations from plan recorded: (a) quote asset is USD `1.3.15` (flags 0), NOT
BTS — BTS `1.3.1420` carries whitelist `flags=3`, authorities `["1.2.23812"]`
(`/tmp/book.js` + `/tmp/book2.js`); an unwhitelisted account risks rejection,
so the clean asset was chosen. (b) TEST/BTS book was EMPTY (no best price), so
TEST/USD was used (best bid `100` USD/TEST, `/tmp` book read) and orders priced
100x away — satisfies the "cannot fill" intent. (c) Cross-check script had a
slicing bug (compact sig cut at `[0:32]` instead of header‖r‖s — fixed,
disclosed; serializer bytes were identical throughout).

Step 1 — gates (observed):

- `python3 tooling/check_rot.py` → `ROT CHECK PASSED`, exit 0 ✅
- SLIP grep (`mnemonicToSeed|m/48|bip32|bip39`) → CLEAN ✅
- Float grep: `Math.pow(10` → zero hits everywhere (even `format.js`);
  `parseFloat` → two hits, both inside comments (`market.js:46,61`,
  provenance notes, not executable money math) ✅
- `node --check` tx/format/trade-ui/market-ui/market-orders/crypto → all OK ✅
- Ratio vectors (`parsePriceRatio('100.5')` → `1005n/10n`; `100000n*num/den`
  → `10050000n`) → `RATIO VECTORS GREEN` ✅

Step 2 — serializer cross-check, no broadcast (`node /tmp/trade-crosscheck.js`):

- FIXED fixtures, independent Buffer/DataView reimplementation vs `Tx._ser`:
  op-1 basic `IDENTICAL (36 bytes)`; op-1 FoK + odd amounts (incl. `2^53+1`
  receive) `IDENTICAL (36 bytes)`; op-2 `IDENTICAL (16 bytes)`;
  mixed envelope `[op1, op2]` `IDENTICAL (66 bytes)` ✅
- Throwaway-key sign of the envelope digest: `isCanonicalSignature` true +
  `recoverPublicKey` matches noble pub (`recovery-match=true`; key discarded) ✅

Step 3a — single order + cancel (sell `1.00000` TEST = raw `100000` / `1.3.0`
for min `10000.0000` USD = raw `100000000` / `1.3.15`; price 10000 USD/TEST =
100x best bid 100 → rests, cannot fill; 30-day expiry):

- `feeMulti` (one call): fee raw **100** → display **0.00100 TEST** ✅
- Broadcast via `broadcast_transaction_with_callback` → order **1.7.9233091**
  present in `get_limit_orders_by_account` with matching fields ✅
- History op-1 inclusion: block **100914150** ✅
- Cancel (op 2, fee raw **10** → **0.00010 TEST**) → block **100914152** →
  order gone from book ✅

Step 3b — scaled N=3 micro-orders in ONE tx (total raw `100000`):

- Split `33333/33333/33334`, sum `100000` == total (remainder-conservation ✅);
  prices `20000/30000/40000` USD/TEST via REAL `Format.parsePriceRatio`;
  receives `66666000/99999000/133336000` USD-raw (BigInt floor) ✅
- `feeMulti` ONE call over 3 ops → fees `[100,100,100]`, totalRaw `300` →
  display **0.00300 TEST** (multi-op fee vector ✅)
- One signed tx → orders **1.7.9233092, 1.7.9233093, 1.7.9233094**, all present;
  history op-1 entries: block **100914154** (×3; recovered via follow-up scan —
  the live script's 1s history timeout was too short, disclosed) ✅
- Cancel-all (3 cancel ops, ONE tx, fee totalRaw `30` → **0.00030 TEST**) →
  block **100914155** (×3 entries) → all gone ✅

Step 3c — fill-or-kill, impossible price (1 TEST for min `1,000,000.0000` USD):

- Node REJECTED: `rpc error: {"code":3050101,…"Killing limit order due to
  unable to fill: Killing limit order {…seller 1.2.26833…}"}` — FoK semantics
  proven with zero fill ✅
- Resting-match count 0, `my-open` 0, history top unchanged ✅

Fee economics (found, not assumed — quoted vs burned):

- `get_required_fees` quotes (embedded in submitted ops): creates 100/op,
  cancels 10/op. Quoted totals: A 100+10, B 300+30, FoK 100 (rejected, never
  charged), probe 100+10.
- Balance trail (TEST raw): `99616224` (pre) → `99616184` (post 3a–3c) →
  `99616174` (post probe). Total burned **50** = cancel fees only
  (10 + 30 + 10). The deferred-fee probe (`/tmp/followup.js`) pins why:
  after CREATE the balance drops by sell amount + create fee (`-50100` =
  `-50000` locked + `-100`); after CANCEL it rises by sell amount + create
  fee minus cancel fee (`+50090` = `+50000` + `100` − `10`); net `-10`.
- Rule: the create fee + sell amount are escrowed while the order rests and
  released on cancel — only the cancel-op fee burns. Consistent with the
  deferred-fee design (#4 `market_object.hpp:53`, `market_evaluator.hpp:40-57`;
  #1 reads the live fee off `order.deferred_fee`, `MarketClasses.js:524`).
  Fill-economics (deferred fee taken from proceeds) is untested BY DESIGN —
  no order in this slice may fill.
- Book-clean: `end-open=0` after every stage; final balance `99616174`
  reconciles to the cent (`99616224 − 50`) ✅

Step 4 — error paths (`node /tmp/trade-errors.js`, all PASS):

- E1 overspend (sell ~1B TEST vs ~996 balance): node rejects
  `limit_order_create_insufficient_balance: "Insufficient balance:
  insufficient balance"` (code 3050106); history top unchanged, no entry ✅
- E2 bad price strings via REAL `Format.parsePriceRatio`: `"1.2.3"`, `"-5"`,
  `"abc"`, `""`, `"1."`, `".5"`, `"1e3"` ALL throw `bad price: …`;
  `parseAmount("1.123456", 5)` throws `too many decimals for precision 5`
  (UI maps these to inline field errors — code path cited, click PENDING) ✅
- E3 cancel already-canceled `1.7.9233095`: node rejects
  `limit_order_cancel_nonexist_order: "Order does not exist:
  Limit order 1.7.9233095 does not exist"` (code 3050201) ✅
- E4 empty ops: `buildTx([])` throws `buildTx needs a non-empty ops array`;
  `feeMulti([])` throws `feeMulti needs a non-empty ops array` ✅
- E5 locked-wallet direct navigation: CODE-PASS — `renderUnlock` gate
  (`trade-ui.js:346-368`, unlock prompt + return path, same pattern as
  transfer/account); click test PENDING-BROWSER (Step C) ✅
- E6 expired custom date: CODE-PASS — `expiryWire` (`trade-ui.js:221-233`)
  throws unless custom > now+60s; click test PENDING-BROWSER (Step C) ✅

Browser (PENDING — follow steps A–E in order; record PASS/FAIL per step):

Setup (do once):
1. Open a terminal, `cd /workspace`, run `python3 -m http.server 8080
   --directory vanilla` and leave it running.
2. Open Chrome/Edge/Firefox to `http://localhost:8080/`. Open DevTools (F12)
   → Console, keep visible: any red error is an automatic FAIL — quote it.
3. In `#/settings`, switch to Testnet, confirm badge `connected · 39f5e2ed`.
   Unlock the wallet (`#/wallet`) with the TESTNET wallet from slice-02 steps
   (never a mainnet key). Navigate to `#/market/TEST_USD`.

Step A — desk + trade panels render (desktop ≥1440px):
1. The market desk shows chart/book/trades/side; below (or beside) a Trade
   section with Buy/Sell/Scaled tabs.
2. Buy tab shows Amount (USD), Price (TEST per USD), FoK checkbox, Expiration
   select defaulting to "1 year", live fee line, side labels per #3 wording.
3. PASS if: all three tabs switch without console errors; fee line shows a
   TEST fee after entering amount+price. FAIL otherwise.

Step B — single order place + cancel (testnet ONLY, tiny + off-market):
1. Buy tab: side Buy USD (spend TEST), amount `0.1`, price far ABOVE market
   (e.g. 100x the best bid shown in the book), expiry HOUR. Confirm screen
   must show Side/Price/Amount/Total/Fee/Expiry; Sign&Send → result with
   block #.
2. The order appears in My Open Orders with a Cancel button; click Cancel →
   inline confirm shows the `1.7.x` id → confirm → result; order disappears.
3. PASS if: block # shown, order appeared then disappeared, no console errors.
   FAIL on any fill (price was 100x away — report immediately), blank error,
   or missing confirm screen.

Step C — error paths + locked wallet:
1. Locked: lock the wallet (`#/wallet` → Lock), navigate directly to
   `#/market/TEST_USD` → PASS if an unlock prompt with return path appears
   (no blank panel).
2. Bad price: type `1.2.3` in Price → PASS if inline field error, form kept.
3. Past expiry: Expiration → Specific → pick a past datetime → PASS if inline
   "at least a minute in the future", no broadcast attempted.
4. Scaled: N=3, low/high far off-market, total `1` → preview table shows 3
   rows with per-order price/amount and the remainder note on the last row →
   confirm places ONE tx; Cancel-all (≥2 orders) lists the COUNT, one N-op tx.
   PASS if preview math matches §4 vectors for your inputs.

Step D — FoK attempt (testnet ONLY):
1. Same as Step B but tick Fill-or-Kill with an impossible price.
2. PASS if the node rejects with a "unable to fill"-class message shown inline
   (proves FoK without filling), history shows no new order. FAIL on fill.

Step E — viewports + themes:
1. Theme trio: settings theme selector → Original Blue screenshot → Light
   screenshot → Dark screenshot. PASS if trade panels, book, confirms and
   cancel buttons render readably in all three (no invisible text, no
   hardcoded-color breakage).
2. Phone width ~360px (DevTools device toolbar): PASS if nav collapses
   (hamburger), trade tabs + amount/price inputs usable with ≥44px targets,
   book/orders become cards/scrollable (no pinch-zoom needed), numeric
   keyboards on amount inputs (`inputmode`), no hover-only UI.
3. Desktop ≥1440px (2560px+ if available): PASS if the desk expands into
   multi-column (book+chart+buy/sell visible without a stranded narrow
   column).
4. Attach 3 theme + 2 viewport screenshots.

Report format: one line `PASS` / `FAIL + what you saw` per A–E (console errors
quoted). Only all-PASS closes the browser pass.

## 4. Raw→human test vectors

Conversions: `Format.formatAmount` (string math) for amounts/fees;
`Format.parsePriceRatio` + BigInt receive math for prices; book price strings
are chain-human verbatim (per `market.js` header convention, NOT raw).

| # | Raw chain value | Expected human | Observed |
|---|---|---|---|
| V1 | fee `100` @ prec 5 (TEST) | `0.00100 TEST` | `feeMulti.totalDisplay`, live 3a ✅ |
| V2 | fee `10` @ prec 5 | `0.00010 TEST` | live 3a-cancel ✅ |
| V3 | multi-op total `300` @ prec 5 | `0.00300 TEST` | live 3b (`fees=[100,100,100]`, one call) ✅ |
| V4 | sell `100000` @ prec 5 | `1.00000 TEST` | order 1.7.9233091 `for_sale` ✅ |
| V5 | receive `100000000` @ prec 4 (USD — non-BTS precision) | `10000.0000 USD` | order 1.7.9233091 ✅ |
| V6 | price ratio `100000000/100000` adjusted 10⁴/10⁵ | `10000 USD/TEST` (100x best bid `100`) | off-market proof ✅ |
| V7 | scaled split `33333+33333+33334` | sum `100000` == total (remainder on LAST) | live 3b ✅ |
| V8 | scaled receives `66666000/99999000/133336000` @ prec 4 | `6666.6000/9999.9000/13333.6000 USD` | chain read-back ✅ |
| V9 | balance `99616224` → `99616174` @ prec 5 | `996.16224` → `996.16174 TEST` (Δ `-0.00050` = burned cancel fees) | reconciled ✅ |
| V10 | book best bid price `"100"` | chain-human string, verbatim (not raw) | `/tmp` book ✅ |
| V11 | percent identity `2000` of `10000` | `20%` (wire convention `GRAPHENE_100_PERCENT=10000`) | reference vector — no percent field is populated or displayed in this slice (on_fill percents never built; extensions always empty set), so no UI vector exists; recorded for the auditor |
| V12 | `2^53+1` receive raw in op-1 | byte-exact (BigInt path, no float) | cross-check `fok+odd-amounts` IDENTICAL ✅ |

No raw integer reaches the user in slice-06 flows: amounts/fees formatted at
render (`trade-ui.js:255-259` `humanFee`, confirm rows), prices as decimal
strings via `ratioToDec` (`trade-ui.js:175-180`, floor).

## 5. Theme + viewport checks

PENDING-BROWSER (Step E above): theme trio (original blue / light / dark)
screenshots + 360px phone AND ≥1440px desktop checks with click steps.
Static facts for the tester: slice-06 JS has NO hardcoded hex colors
(`grep #[hex]` clean in `trade-ui.js`/`market-ui.js`/`market-orders.js` —
the two `#fff` in `app.css` are pre-existing slice-01 button text);
`<meta name="viewport" content="width=device-width, initial-scale=1">`
present (`index.html:5`); desk CSS already stacks to cards on phones and
expands to 3-column ≥1200px (`app.css:46-70`, slice-05).

## 6. Module headers + function descriptions (§3.7)

- Every touched file opens with a what/owns/consumes/side-effects/origin
  header (`trade-ui.js:1-30`, `tx.js:1-90` incl. per-function provenance +
  BJS policy, `format.js:1-10`); non-trivial functions carry what/params/
  returns/failure-modes (`trade-ui.js:53+`, e.g. `scaledOrders :751-754`,
  `expiryWire :218-220`, `sendTx/prove* :271-329`).
- Dead-text grep (`TODO|FIXME|XXX|HACK` in `js/`+`css/`) → CLEAN ✅
- **Split note (required): `trade-ui.js` is 1167 lines** — past the ~400-line
  split guideline by 3x. Single purpose (trading panels + cancel boxes) but
  oversized: NOT split now (plan forbids inventing files mid-slice), recorded
  as a SPLIT CANDIDATE for the final readability pass — natural seams:
  `trade-panels.js` (Buy/Sell render+review+confirm), `trade-scaled.js`
  (`scaledOrders`+preview+confirm), `trade-cancel.js` (`orderCancelBox`+
  `cancelAllBox`+prove helpers), shared `trade-helpers.js`
  (`el/touchable/pow10/quoteToBaseRaw/baseToQuoteRaw/ratioToDec/humanFee`).

## 7. Anti-rot gate (§4.5)

- (a) Ten years, zero maintenance: static HTML/CSS/JS + platform WebSocket +
  WebCrypto + vendored noble (copied source, no registry) — runs wherever
  browsers speak WS. YES. The deferred-fee finding changes no code (read-path
  only); nothing new can expire.
- (b) New dependencies: NONE. `/tmp/*.js` are node-stdlib throwaways, never
  shipped, never required to run/serve the app. No CDN, no framework, no BJS
  import (consulted-never — see §1).
- (c) Smallest deletable subset: `/tmp` scripts (verification convenience;
  results above already record everything) + the on_fill auto-action
  serializer in `tx.js` (`serializeLimitOrderAutoAction`, unused — extensions
  always empty; kept because #3 documents the collapse rule and deleting it
  would lose the byte-truth for a future slice that needs on_fill).
- `check_rot.py`: PASSED. Node list stays data; fee asset `1.3.0` is a
  constant default, not a dependency.

## 8. Audit — eight checks

1. Rot gate — PASS (`check_rot.py` exit 0; CDN/framework/SLIP greps clean;
   no `package.json`/`node_modules`; §4.5(a–c) in §7).
2. Retro look — PASS-MINUS-BROWSER (flows mirror #1: same tabs/side labels per
   #3 wording, same expiry presets + YEAR default, same scaled semantics;
   side-by-side visual confirmed only in Step A/E — PENDING).
3. Feature coverage — PASS (op 1 + op 2 + multi-op + FoK + scaled + cancel +
   cancel-all = full #1 Exchange trading surface for limit orders; astro-only
   ops out of slice scope per plan; no gap introduced).
4. Modern glow — PASS-MINUS-BROWSER (no reloads: targeted re-render on
   `done`; inline validation + empty states + confirm screens in code;
   search quality N/A to this slice — no new search surface).
5. Themes — PENDING-BROWSER (static: no hardcoded colors in slice JS;
   trio screenshots in Step E).
6. Human terms — PASS (V1–V12 above incl. non-BTS precision (USD prec 4) and
   percent identity; `Math.pow(10` zero hits; no float money math; no raw
   integer displayed).
7. Both ends of the screen — PENDING-BROWSER (static: viewport meta, ≥44px
   `touchable` targets, desk grid already responsive; 360px + ≥1440px runs in
   Step E).
8. Built to be read — PASS with noted candidate (headers/descriptions
   present, dead-text clean, 1167-line split recorded in §6, no TODOs).

Ruling: GREEN-MINUS-BROWSER. No slice 7 until Steps A–E all PASS.
`grep` audit trail: rot ✅ SLIP ✅ float ✅ dead-text ✅ hex-colors ✅
`node --check` (6 files) ✅ ratio vectors ✅ cross-check (4/4 identical +
canonical) ✅ live (4 orders placed / 4 canceled / FoK rejected / 3 error
rejects) ✅ book-clean (`end-open=0` every stage) ✅ balance reconciled ✅.
