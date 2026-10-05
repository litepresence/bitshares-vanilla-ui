# Slice 03 — Account View: parity note

Date: 2026-09-26. Plan: `docs/superpowers/plans/2026-09-26-slice-03-account.md` (Task 5, this file).
Code Tasks 1–4 landed by prior workers; this note verifies (headless + live WS).
Worker scope: verification only — writes ONLY this file (+ throwaway `/tmp/*.js`, never committed). No commits.

## 1. Reference behavior

Ground-truth chain contract (`bitshares-core`, sparse, read-only):

- `libraries/app/include/graphene/app/database_api.hpp:326` — `get_account_by_name(string)` (plan cites `:326,:371,:425` exactly).
- `database_api.hpp:371` — `get_account_balances(account_name_or_id, assets)` (empty set = all).
- `database_api.hpp:425` — `get_assets([symbols_or_ids])` returns `{id,symbol,precision}` (asserted at runtime; STOP on `bad-asset-shape`).
- History API id via `login "history"` then `get_account_history [id,"1.11.0",limit,"1.11.0"]`.

Second/third references (behavior + call-shape cross-check):

- `wallet-extension/src/lib/bitshares-api.js:325-336` — `login(['',''])` + `database` + `history` api-id fetch (plan cites extension `:460-476`; observed balances `:451-463`, history `:468-476`, login/ids `:325-336` — same file, cited range covers the history tail).
- `wallet-extension/src/lib/bitshares-api.js:451-463` — `getAccountBalances(accountId)` calls `get_account_balances [id, []]`, returns `[]` on error.
- `wallet-extension/src/lib/bitshares-api.js:468-476` — `getAccountHistory(accountId)` calls `get_account_history [id,'1.11.0',limit,'1.11.0']`, returns `[]` on error.
- `#1` account-page layout (header + balances + history) is the visual reference for the browser pass (§2 below); no `#1` file:line enters the money-math path — all numbers come from the contract above via `Format`.

## 2. Vanilla implementation

| File | Lines | Role |
|---|---|---|
| `vanilla/js/format.js` | 46 total; `formatAmount` :14-22, `parseAmount` :27-36 | string-math only, zero deps, no float (verbatim per plan Task 1) |
| `vanilla/js/chain.js` | `history()` :108-112, export :113 | append-only `Chain.history()` (cached id; reject = caller shows "history unavailable") |
| `vanilla/js/account.js` | 129 total; `resolve` :24-37, `balances` :45-81, `history` :87-102, `myAccountId` :109-119 | read-only data layer; `bad-asset-shape` assert :61,69-70; `history-unavailable` :92-94,98-100; `wallet-locked` :110-111 |
| `vanilla/js/account-ui.js` | 345 total; `OP_LABELS` :16-28, `renderBalances` :107-156 (raw in `title`, display text formatted), `renderHistory` :160-191, `renderUnlockPrompt` :195-229, `showAccount` :233-277, `renderAccount` :283-337 | `/account/:name` + `/account/me` (locked → unlock prompt + return to `#/account/me`) |
| `vanilla/js/router.js` | `/account/:account_name` entry :46 | repointed to `AccountUI.renderAccount`; `/accounts` stays placeholder :47 |
| `vanilla/index.html` | script tags :33-35 | `js/format.js`, `js/account.js`, `js/account-ui.js` after `chain.js`, before `router.js` |

No signing, no keystore writes, no unlock required except `/account/me` (reads `Wallet.isUnlocked`/`getBrainkey` + `Crypto.brainPrivateKeyHex(seq1)`).

## 3. Manual test steps + observed result

Headless + live WS (this environment, 2026-09-26). Scripts: `/tmp/acct-vectors.js`, `/tmp/acct-errors.js`, `/tmp/acct-hist-probe.js` (throwaways, stdlib only, modeled on `tooling/ws-probe.mjs` handshake).

Step 1 — rot gate + math grep (recorded outputs):

- `python3 tooling/check_rot.py` → `ROT CHECK PASSED — vanilla/ is dependency-free and static-servable.` exit 0 ✅
- `grep -rn "Math.pow(10\|parseFloat" vanilla/js/account.js vanilla/js/account-ui.js vanilla/js/format.js vanilla/js/chain.js` → `MATH CLEAN` (no hits — string ops only, even inside `format.js`) ✅
- `node --check` on format/account/account-ui/chain → all `OK` ✅ (established fact, re-confirmed)

Step 2 — live vectors (`node /tmp/acct-vectors.js`, exit 0, `VECTORS GREEN`):

- Unknown-name control `get_account_by_name ["no-such-acct-xyz-9"]` on `wss://testnet.xbts.io/ws` → `null` (found=false; clean error, no throw) ✅
- Candidates per plan order: `faucet` found id `1.2.17` balances=22 history=20 histId=2; `init0` not needed (faucet already funded). No mainnet fallback required — our keys never involved in any case. ✅
- CHOSEN: testnet `faucet` (`1.2.17`) via `wss://testnet.xbts.io/ws`. Balances count=22, history length=20. ✅
- Each balance hand-verified: `display === indepFormat(raw, precision)` with pad/slice reimplemented inline (NO shared code with `format.js`). All 22 OK. Non-BTS precision REQUIRED: satisfied by balances themselves (precisions 5,4,2,8,6 — see §4; no synthetic second vector needed). ✅
- History sample[0]: `id=1.11.151699067 block=68374381 op_present=true` (shape proves length + rows). ✅
- Cross-check shipped `Format` (`/tmp/acct-errors.js` §format-match): 5 vectors (p5/p2/p8/p6/p4) byte-match independent math ✅

Step 3 — error paths (`node /tmp/acct-errors.js`, `ERROR-PATHS ALL GREEN`, 10/10 PASS; history-per-node via `/tmp/acct-hist-probe.js`):

- `unknown-account` (live null + stubbed null through real `Account.resolve`) → throws `unknown-account`; UI maps to inline "Unknown account." panel, never blank ✅
- `locked-me` (stubbed locked `Wallet.isUnlocked()->false`, real `Account.myAccountId`) → throws `wallet-locked`; UI renders unlock prompt (`#acct-unlock-password`, `#acct-unlock-do`) + return-to-`#/account/me` ✅
- `history-unavailable`: live per-node — `wss://testnet.xbts.io/ws` → available id=2; `wss://testnet.dex.trading/` → available id=2; `wss://node.xbts.io/ws` (mainnet) → available id=2. NO probed node lacked the plugin, so the "History unavailable on this node." panel is proven via stub (`Chain.history` rejects → `Account.history` throws `history-unavailable`) ✅
- `bad-asset-shape` (unit, real `Account.balances` + stubbed `Chain`): precision as string `"5"` → throws; asset `null` → throws ✅

Browser — PENDING (human tester; steps A–E below; record PASS/FAIL per step):

Setup (do once):
1. `cd /workspace && python3 -m http.server 8080 --directory vanilla` (leave running; confirm `Serving HTTP on ... port 8080`).
2. Open Chrome/Edge/Firefox to `http://localhost:8080/`. Open DevTools (F12) → Console, keep visible: any red error during steps = automatic FAIL for that step (quote it).
3. In Settings, select Testnet + `wss://testnet.xbts.io/ws` (badge `connected · 39f5e2ed · …`). All steps below use testnet `faucet` unless noted.

Step A — account render (`#/account/faucet`):
1. Navigate to `http://localhost:8080/#/account/faucet`.
2. PASS if: header shows `faucet` + `1.2.17`; Balances table lists assets with human displays (e.g. `4172999718.42524 TEST`, `2012.00 CNY`, `66.60734244 SPINDITS`); hovering/``title`` on a balance shows the raw integer; History lists 20 rows each `time — LABEL` + expandable `Details` raw JSON; no console errors. FAIL on blank section, raw-integer-as-text, or missing `title`.

Step B — unknown-name error (`#/account/no-such-acct-xyz-9`):
1. Navigate to `http://localhost:8080/#/account/no-such-acct-xyz-9`.
2. PASS if: inline error panel `Unknown account: no-such-acct-xyz-9.` (never blank), no console errors. FAIL on blank page or throw.

Step C — locked-me prompt (`#/account/me` while locked):
1. In `#/wallet`, Lock (confirm manager shows locked). Then navigate to `http://localhost:8080/#/account/me`.
2. PASS if: "Wallet is locked. Enter your password…" + password field + Unlock button; wrong password → INLINE error (not blank); correct password → renders your account (header + balances + history). FAIL on blank, missing return-to-`#/account/me`, or keys written while locked.

Step D — theme trio (on `#/account/faucet`):
1. Settings → theme Original Blue → screenshot; Light → screenshot; Dark → screenshot.
2. PASS if: all three readable (no invisible text; balances/history legible); slice adds NO hardcoded colors (only `Operation #`/`block #` string literals, no `#rrggbb`). FAIL on unreadable theme or hardcoded color. Attach 3 screenshots next to this file.

Step E — viewports (on `#/account/faucet`):
1. Phone ~360px (DevTools device toolbar → iPhone SE / 360×800): PASS if nav collapses to ☰, balances table becomes stacked cards (no horizontal scrollbar), history list readable, touch targets ≥44px in ≥1 dimension, no hover-only UI.
2. Desktop ≥1440px (maximize): PASS if content uses width (no stranded narrow column), header spans fully.
3. Attach 2 screenshots (360px, 1440px). FAIL on single-viewport-only evidence.

Report format: one line `PASS` / `FAIL + what you saw` per A–E (console errors quoted). Only all-PASS closes the browser pass.

## 4. Raw→human test vectors

Live from `wss://testnet.xbts.io/ws`, account `faucet` (`1.2.17`), 2026-09-26 (independent pad/slice; shipped `Format` byte-matches all five re-checked in `/tmp/acct-errors.js`):

| raw (chain integer) | precision | symbol (id) | display (human) |
|---|---|---|---|
| `417299971842524` | 5 | TEST (`1.3.0`) | `4172999718.42524` |
| `1000000000` | 4 | PEG.PARITY (`1.3.5`) | `100000.0000` |
| `9990000` | 4 | PRUEBA (`1.3.39`) | `999.0000` |
| `20000` | 4 | LIVE (`1.3.105`) | `2.0000` |
| `99000000` | 5 | TESTDECTWENTYSIX (`1.3.157`) | `990.00000` |
| `212300` | 2 | SILVERSHARE (`1.3.171`) | `2123.00` |
| `201200` | 2 | CNY (`1.3.174`) | `2012.00` |
| `1000000000` | 4 | EAGLE (`1.3.176`) | `100000.0000` |
| `250300000` | 4 | BUDGIE (`1.3.177`) | `25030.0000` |
| `352330000` | 4 | FALCON (`1.3.178`) | `35233.0000` |
| `242430000` | 4 | TRUCK (`1.3.179`) | `24243.0000` |
| `11000` | 2 | LIVEDEMO (`1.3.209`) | `110.00` |
| `1000000` | 5 | HERO (`1.3.219`) | `10.00000` |
| `8000000000` | 5 | MYTEST (`1.3.296`) | `80000.00000` |
| `1000000` | 4 | DIMATEST (`1.3.332`) | `100.0000` |
| `10012833` | 2 | USDBTCX (`1.3.363`) | `100128.33` |
| `100000000` | 4 | CORKYT (`1.3.389`) | `10000.0000` |
| `3763073` | 4 | TICKETS (`1.3.413`) | `376.3073` |
| `6660734244` | 8 | SPINDITS (`1.3.414`) | `66.60734244` |
| `10000` | 4 | RICKCOIN (`1.3.415`) | `1.0000` |
| `13000000` | 6 | GXXXX (`1.3.1241`) | `13.000000` |
| `1000000` | 4 | GHAL813 (`1.3.1371`) | `100.0000` |

Non-BTS precision REQUIRED: satisfied live — p2 (`CNY`), p4 (`PEG.PARITY`), p6 (`GXXXX`), p8 (`SPINDITS`) alongside p5 (`TEST`). No synthetic fallback needed (plan allowed it only if the account held a single asset).
History: length 20; sample[0] `1.11.151699067` block `68374381` op present.
Unknown name: `no-such-acct-xyz-9` → `null` (clean, no throw at WS layer; `Account.resolve` throws `unknown-account`).

Own-account addendum (2026-09-26 evening): testnet `lite-test-1` (`1.2.26833`,
fixture `tooling/testnet-lite-test-1.json`, git-ignored, 600-perms) —
`get_account_balances` → 1 row: raw `100000000` `1.3.0`/TEST p5 →
`1000.00000` ✅ (matches the funded "1000 TEST"); `get_account_history`
limit 5 → 2 rows (op 0 transfer/funding, op 5 account_create) ✅. On-chain
owner/active/memo_key byte-match the fixture's recorded pubs ✅. (Fixture
keys are a valid self-consistent set — recorded WIFs re-derive to recorded
pubs — but the fixture brainkey does NOT derive them under classic/canonical
case variants, seq0..20: provenance question open with the owner.)

## 5. Theme + viewport checks

CODE-PASS (tokens ship for all three themes; slice uses only `var(--*)` + structural classes `.node-table`/`.node-cards`/`.muted`/`.error`; `index.html:5` viewport meta correct):

- `vanilla/css/themes.css` defines `original-blue` (default), `light`, `dark`.
- Hex grep on slice JS (`account.js`, `account-ui.js`, `format.js`): hits are `Operation #`/`block #`/`#/account/me` string literals only — NO `#rrggbb` color literals ✅
- Dead-text grep on slice files: CLEAN ✅
- Sizes: `format.js` 46 / `account.js` 129 / `account-ui.js` 345 / `chain.js` 115 — all under the ~400 split-candidate bar ✅

Screenshots (trio + 360px/1440px): PENDING browser pass Steps D–E above.

## 6. Readability (§3.7)

- Module headers present: `format.js:1-7` (owns/consumes/side effects/origin + no-float note), `account.js:1-8`, `account-ui.js:1-11`, `chain.js:1` (+ `history()` documented in plan Task 2). ✅
- Function descriptions on all non-trivial functions (what/params/returns/failure-modes; WHY not WHAT). ✅
- No dead text: `TODO|FIXME|XXX|HACK` over slice JS + css → CLEAN. ✅
- One purpose per file: `format.js` owns string math; `account.js` owns reads; `account-ui.js` owns DOM; `chain.js` owns the socket. ✅
- `node --check` clean on all four files. ✅

## 7. Anti-rot gate (§4.5)

- (a) Ten years, zero maintenance: static HTML/CSS/JS + platform WebSocket + `localStorage`; money math is hand-rolled string ops (no lib to expire); node list is data. YES.
- (b) New dependencies: NONE. `check_rot.py` PASSED exit 0; CDN grep CLEAN; framework-import grep CLEAN; no `package.json`/`node_modules`; `/tmp/*.js` are node-stdlib throwaways, never shipped, never committed.
- (c) Smallest deletable subset: `/tmp/acct-vectors.js` + `/tmp/acct-errors.js` + `/tmp/acct-hist-probe.js` (verification convenience; browser pass + vectors above already record the same ground). Already outside the repo by design — nothing to delete from `vanilla/`.

## Audit check results (auditing-vanilla-slices, all eight)

1. Rot gate — PASS (code; `check_rot.py` exit 0, CDN/framework/`package.json` greps clean).
2. Retro look — PENDING-BROWSER (side-by-side vs #1 account flow in Step A; deviations only if broken-original or #4-required with before/after note).
3. Feature coverage — CODE-PASS (public balances+history+`me` shortcut; no chain op, no signing; no astro-only op in scope), live-confirm PENDING (Step A).
4. Modern glow — CODE-PASS (loading states, per-section inline errors never blank, no full-page reloads, `aria-live` errors, `title` raw + display text), live-confirm PENDING.
5. Themes — CODE-PASS (tokens only, no hardcoded colors), screenshots PENDING (Step D).
6. Human terms — PASS (22/22 live vectors green incl. p2/p4/p6/p8 non-BTS; `Math.pow(10`/`parseFloat` grep CLEAN everywhere; raw integers only in `title` attrs, never as display text).
7. Viewports — PENDING-BROWSER (360px + 1440px per Step E; `viewport` meta present, table→cards <560px reused).
8. Readability — PASS (§6 above).

Slice is NOT done until browser Steps A–E are all-PASS. Headless + live-vector + error-path + code-audit portions are GREEN.

## Repair 2026-09-26 (deep-link race, found via headless screenshots)

Headless render of `#/account/faucet` on a cold load showed `not connected`
with a green `connected` badge: the page read the chain before boot finished
connecting and never retried. Fix (`account-ui.js` `renderAccount` entry):
wait for shared-connection `open` with a "Connecting to network…" state,
one-shot re-render on open, 15s timeout into the error panel, route-change
guard against stale re-renders. Verified headlessly: same deep link now
renders header + id + balances + history, zero console errors. Rule recorded
in code comment: all future data pages must wait for connection, never read
on a cold socket.

## Repair 2026-09-27 (public open orders — reads need no login)

Owner report: #1 shows any account's balances AND open orders with no login
(`AccountOrders.jsx` renders for every viewed account; `isMyAccount`
at :592/:663 gates ONLY row selection + the cancel button). Our account view
had balances + history but no orders section — fixed to match the model:
- `Account.openOrders(id)` (`account.js`, public, no wallet): `get_limit_orders_by_account [id,100]` → enriched rows (sell/buy legs + base-per-quote priceDisplay, same orientation as slice 5).
- Account view renders an "Open orders" section (table + phone cards) for EVERY
  viewed account, logged out included. NO cancel buttons here by design —
  cancel lives on the market desk (consolidation, not a parity gap for reads).
- Live proof (testnet, fixture keys via file, never pasted): placed micro order
  sell 1.00000 TEST → 10000000.00 CNY (`1.7.9233096`) → visible through the NEW
  `Account.openOrders` path (1 row, amounts + `0.00000010` match) → headless
  screenshot of `#/account/lite-test-1` in a wallet-less profile shows balances
  + orders + history with zero console errors → canceled → `openOrders` = 0
  (BOOK-CLEAN). Orientation cross-check: live price `0.00000010` = 1/10000000
  base-per-quote ✓.

## History one-liners Task 6 (live re-read probe 2026-10-05)

`node tooling/history-summary-probe.mjs` (reads only — `get_chain_id`,
`get_dynamic_global_properties`, `get_account_by_name`, `get_account_history`,
`lookup_asset_symbols`, `get_accounts`; no keys, no signing, no broadcast)
drives the exact view path `Account.history(id, 20)` →
`HistorySummary.enrich(rows, id)` with the real `I18n` + shipped `en.json`
seeded in, then fails on any `\d{5,}` run left after stripping dotted
object ids (identifiers may show raw — spec §3) and decimal amounts.
- `wss://testnet.xbts.io/ws` @ head `#101131485` (`2026-10-05T00:26:00`),
  fixture `lite-test-1` → `1.2.26833`: 20/20 rows object-shaped, 20/20
  summarized (e.g. `Sent 0.10000 TEST to committee-account`), 20 scanned,
  zero raw runs. PASS.
- `wss://testnet.dex.trading/` @ head `#101131487`: same 20/20, zero raw
  runs. PASS.
