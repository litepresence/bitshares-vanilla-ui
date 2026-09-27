# Slice Roadmap — Vanilla BitShares UI

> The binding build order. Each slice: brainstorm → plan (`docs/superpowers/plans/`) → build → testnet-verify → parity note (`vanilla/notes/`) → 8-check audit. A slice is NOT done until its parity note is green; browser passes marked ⏳ are with the human tester. This file is the answer to "what's left".

Legend: ✅ done · 🔨 in progress · ⬜ queued · ⏳ waiting on human tester · 🔒 deferred post-v1.

## Status table

| # | Slice | Status |
|---|---|---|
| 1 | Shell + settings/nodes | ✅ done (F5-reconnect repair verified, browser PASS) |
| 2 | Wallet lifecycle | ✅ built (faucet round-trip proven on-chain; browser pass ⏳) |
| 3 | Account view | ✅ built (22 live vectors incl. p2/p4/p6/p8; browser pass ⏳) |
| 4 | Transfer | ✅ built (2 testnet broadcasts incl. blocks + memo decrypt-match; browser pass ⏳) |
| 5 | Exchange read-only | ✅ built (live orderbook + charts; browser pass ⏳) |
| 6 | Exchange trading | ✅ built (place+cancel live, N=3 scaled + cancel-all, FoK reject; browser pass ⏳) |
| 7 | Indicators + real candles + desk restyle | ✅ built (LWC + 25 indicators + stacked sub-panes + candles; audit DONE-WITH-BROWSER-ITEMS; browser pass ⏳) |
| 8 | Voting/governance | ✅ built (op-6 proven blocks 100916767/68, 1.2.5 sentinel; audit DONE-WITH-BROWSER-ITEMS; browser pass ⏳) |
| 9 | Explorer | ✅ built (fixtures 100916767/68 read back, 4 verify bugs fixed, split; audit DONE-WITH-BROWSER-ITEMS; browser pass ⏳) |
| 10 | Asset ops | ✅ built (ops 10–15+19, CER+F1+B1 money fixes, split; audit DONE-WITH-BROWSER-ITEMS; browser pass ⏳) |
| 11 | HTLC + direct debit + spotlight | 🔨 (plan mapped; T1+T2 landed; T3 views pending) |
| 12 | Pools + swap + stake | ⬜ |
| 13 | Credit + Same-T + borrow | ⬜ |
| 14 | Proposals + tickets + misc | ⬜ |
| 15 | Gateways | ⬜ |
| 16 | Notifications + alerts | ⬜ |
| 17 | i18n foundations | ⬜ |
| 18 | Final readability pass | ⬜ |
| — | Extension-wrapper adapter | 🔒 post-v1 hardening, never a v1 dependency |

## Sub-objectives per slice

### 1. Shell + settings/nodes ✅
- [x] Hash router with all ~40 §6 routes (stubs + 404)
- [x] Sole-owner WS chain client (login→database handshake, failover, latency, chain-id check)
- [x] Settings/nodes page (list, latency probe, select, testnet toggle, custom nodes, offline panel + Retry)
- [x] Theme token system (original-blue/light/dark via CSS vars)
- [x] F5-reconnect repair (probe-vs-shared-socket bug found by tester, fixed, re-verified)

### 2. Wallet lifecycle ✅ (browser ⏳)
- [x] Classic brainkey derivation (NOT SLIP-48 — proven incompatible with legacy wallets)
- [x] Vendored noble-secp256k1 (byte-copy + classic wrapper + provenance)
- [x] 49,744-word dictionary extraction + brainkey suggest
- [x] PBKDF2-600k/AES-GCM keystore, memory-only unlock, auto-lock, backup view
- [x] Brainkey import verified vs chain (look-ahead refuses empty, discovers funded)
- [x] Faucet round-trip proven on-chain (`t9-vanilla-6742`: derived → registered → byte-match → look-ahead discovery)

### 3. Account view ✅ (browser ⏳)
- [x] `format.js` amounts debut (string math, no float; round-trip vectors)
- [x] Public balances + history for any account (reads need no login)
- [x] Public open orders on account view (ownership gates cancel only, per #1)
- [x] `/account/me` shortcut via wallet keys + locked unlock prompt
- [x] 22 live vectors incl. non-BTS precisions (p2/p4/p6/p8)

### 4. Transfer ✅ (browser ⏳)
- [x] `tx.js` serializer subset (op 0) + canonical signing + `get_required_fees`
- [x] Encrypted memos (ECDH+AES) + plaintext memos, human-readable confirm
- [x] 2 live testnet broadcasts (blocks recorded, memo decrypt-match, fees observed)
- [x] Error paths (unknown recipient, overspend, bad decimals, locked gate)

### 5. Exchange read-only ✅ (browser ⏳)
- [x] Orderbook + cumulative depth + spread/midpoint (best-ask bug found + fixed)
- [x] Market picker + search, ticker stats, trade history
- [x] Canvas price + depth charts + SMA/EMA overlays
- [x] Read-only my orders; BigInt price math (base-per-quote proven)
- [x] Deep-link race repair (wait-for-connection pattern for all data pages)

### 6. Exchange trading ✅ (browser ⏳)
- [x] Multi-op transactions (ops 1+2) + exact price fractions (BigInt, remainder-safe)
- [x] Limit + fill-or-kill + expiry presets + scaled N=2–20 placement (one tx each)
- [x] Live place + cancel incl. order ids/blocks; N=3 scaled + cancel-all; FoK reject proven; book left clean, balance reconciles
- [x] Per-row cancel + cancel-all with inline confirms (1167-line trade-ui.js split noted for readability pass)

### 7. Indicators + real candles + desk restyle ✅ (browser ⏳)
- [x] Vendored lightweight-charts 5.2.1 (Apache-2.0, hash recorded)
- [x] 25-indicator catalog as dependency-free math (Tulip-C-compiled vectors, 26/26 green; FFT deferred, never guessed)
- [x] indicators.js split (340/285) per §3.7; osc module wired (index.html:39)
- [x] Timeframe-aware interpolated candles (carry-forward gaps, red/green flags, unit-tested)
- [x] Stacked oscillator sub-panes (independent scales) + volume pane
- [x] Scroll regions + desk styling alignment (density, header stats, sidebar) + DEX-UX dark values
- [x] Live candle proof, headless shots (read), parity note `vanilla/notes/slice-07-indicators.md`, 8-check audit DONE-WITH-BROWSER-ITEMS (percent vector `2000`→`20%` recorded)

### 8. Voting/governance ✅ (browser ⏳)
- [x] Witness / committee / worker lists + details (`vote.js` reads)
- [x] Proxy selection + vote slates (draft-vs-published diff, proxy disables slate)
- [x] Vote weights with percent math (raw stake ints → human via Format; integer-hundredths shares)
- [x] Op-6 `account_update` serializer in `tx.js`; vote proven block `100916767`, unvote cleanup `100916768`; `1.2.5` sentinel ACCEPTED (self-id retry never needed); named-row confirm beats #3 raw JSON
- [x] Parity note `vanilla/notes/slice-08-voting.md`, audit DONE-WITH-BROWSER-ITEMS

### 9. Explorer ✅ (browser ⏳)
- [x] Blocks + transactions + assets + feeds tables (`explorer.js` reads, `explorer-ui/blocks/assets.js` views — split 396/367/786)
- [x] Object/operation deep links (1.x.y addressing; 1.2.x→account, 1.3.x→asset redirects; op enum 0–77 + space tables)
- [x] Fixture blocks `100916767/100916768` read back our own slice-8 op-6 contents; feed ambiguity resolved live (`current_feed` wins); probe `tooling/explorer-reprobe.mjs`
- [x] 4 verify bugs found+fixed (head `time` field, batch pair-unpack, space/type misassign, raw leaves) — verification works
- [x] Parity note `vanilla/notes/slice-09-explorer.md`, audit DONE-WITH-BROWSER-ITEMS (vectors `2000`→`20%`, `74900` p2→`749.00`)

### 10. Asset ops ✅ (browser ⏳)
- [x] UIA create/issue/update, smartcoin create/update, NFT + PMA flows (ops 10/11/12/13/14/15); BJS cross-check fetched, no conflicts
- [x] Feed publishing for MPA issuers (op 19); CER-leg ground truth `asset_ops.cpp:178` enforced
- [x] Full testnet lifecycle: `AFKTEST10` (1.3.1849) create→issue→update→reserve; `AFKTESTM11` (1.3.1850) MPA→op-12→op-13→op-19 feeds (`100918180`, `100918551`); fee tiers + ppk surcharges observed live
- [x] Money-critical fixes: F1 CER legs, B1 `pctHumanToRatio` ×10 pad (chain reconcile: MCR 1750/MSSR 1500 TRUE on-chain); F2 subscribe, F3 feeGen; split (170/380/267/275/282)
- [x] Parity note `vanilla/notes/slice-10-assets.md`, audit DONE-WITH-BROWSER-ITEMS (round-trips `"175"→1750→"175"`, `"2"→200→"2"`)

### 11. HTLC + direct debit + spotlight 🔨
- [x] Plan mapped (`docs/superpowers/plans/2026-09-28-slice-11-htlc.md`): ops 25/26/27/28 + 49/50/52 (51/53 VIRTUAL never signed); hash variant 0–3, sha256-only until RIPEMD proven; op-26 start-time trap; spotlight = tile grid + recurring via slice-6 path
- [x] Task 1: serializers in `tx.js` (7 ops, op-26 trap vector proven in bytes); Task 2: `htlc.js` reads+builders (400 lines)
- [ ] Task 3: views (htlc-ui + debit split, preimage never displayed, routes + tags)
- [ ] Task 4: full lifecycle testnet proof (create→redeem, create→refund, debit create→claim→delete), parity note, audit

### 12. Pools + swap + stake ⬜
- [ ] Pool create/deposit/withdraw/exchange, simple swap page, staking views

### 13. Credit + Same-T + borrow ⬜
- [ ] Credit offers/deals lifecycle, Same-T funds, barter, margin/borrow views

### 14. Proposals + tickets + misc ⬜
- [ ] Proposal create/approve/reject, vote-lock tickets, airdrops, blind transfers, invoices, vesting claims, custom authorities, account lists

### 15. Gateways ⬜
- [ ] Per-gateway adapters (GDEX/RuDEX/Citadel/…) with explicit unavailable states, deposit-address flows, NEVER load-bearing

### 16. Notifications + alerts ⬜
- [ ] Native DOM notifications, price alerts (no notification library)

### 17. i18n foundations ⬜
- [ ] Plain JSON dicts + `Intl` (no react-intl); English-first until then; locale switcher wired to existing picker assets

### 18. Final readability pass ⬜
- [ ] End-to-end re-read per §3.7 (headers, descriptions, splits incl. 1167-line trade-ui.js, dead code); app incomplete until green

## Standing facts (update as they change)

- Testnet fixtures: `tooling/testnet-lite-test-1.json` (git-ignored, 600-perms) — funded `lite-test-1` account for broadcasts. Faucet: `testnet-faucet.xbts.io` ALIVE (registered `t9-vanilla-6742`); `faucet.testnet.bitshares.eu` dead (404 + self-signed). Leftover chain state (no delete op exists, intentional): `AFKTEST10` (1.3.1849) 9.0000 held by issuer; `AFKTESTM11` (1.3.1850) supply 0 with live feed (MCR 1750/MSSR 1500).
- bitsharesjs policy: REFERENCE ONLY, never a dependency. Consult upstream raw files on demand when porting op serializers (see `mapping-chain-calls`); #4 headers win conflicts; testnet broadcast is final proof.
- Charting decision: TradingView REJECTED (proprietary blob, mirror download, 922-line bridge treadmill). Vendored lightweight-charts 5.2.1 (Apache-2.0) for the price pane + our canvas for depth; canvas line fallback retained.
- Indicator-math source: QTradeX (`squidKid-deluxe`, WTFPL) approved for formulas incl. beyond-Tulip indicators (see AGENTS.md §5.7). Port into `indicators*.js`, verified against published vectors; never installed, never imported.
- DEX-UX (squidKid-deluxe/bitshares-dex-ux) consulted for: market-selector patterns (two-round search, MPA/UIA/LPT/POOL/BTS filters), dark-theme values (TradingView-dark palette), MIT chart precedent. Never a dependency.
- Serializer grows one op-set per slice inside `vanilla/js/tx.js`: op 0 (slice 4); ops 1+2 (slice 6); op 6 (slice 8); ops 10/11/12/13/14/15/19 (slice 10); ops 25/26/27/28 + 49/50/52 (slice 11; 51/53 VIRTUAL never signed). Nothing generated, so nothing to regenerate.
- Headless visual iteration: `tooling/visual/shot.mjs` (dev-only aid; human browser pass stays the gate).
- Image assets vendored: `vanilla/assets/` (459 files: 84 SVG icons, 105 token logos, 243 flags, button-state SVGs, app art — byte-copies per `PROVENANCE.md`, MIT). Styling that applies them lands per-slice.
- Full palette extracted: `vanilla/assets/PALETTE.md` (93 variables × dark/light/midnight, all `$refs` + `darken()`/`lighten()` resolved to final values incl. rgba, via `tooling/extract_palette.py`) + font stacks. Per-slice pixel-matching consumes exact values from here.
- Original-page screenshot arsenal: `vanilla/notes/original-pages/` (35 routes captured headless + README index) — side-by-side reference for retro parity.
- Tracked debt: roelandp node DNS-dead from sandbox (kept last, failover covers); 2 pre-existing `#fff` literals in `app.css` (theme trio must catch); slice-02 fixture brainkey provenance open (does not derive fixture keys — our classic derivation proven independently).
