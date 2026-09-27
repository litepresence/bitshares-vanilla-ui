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
| 7 | Indicators + real candles + desk restyle | 🔨 (vendor + 25 indicators + candles landed; sub-panes, styling, verify remain — see below) |
| 8 | Voting/governance | ⬜ |
| 9 | Explorer | ⬜ |
| 10 | Asset ops | ⬜ |
| 11 | HTLC + direct debit + spotlight | ⬜ |
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

### 7. Indicators + real candles + desk restyle 🔨
- [x] Vendored lightweight-charts 5.2.1 (Apache-2.0, hash recorded)
- [x] 25-indicator catalog as dependency-free math (Tulip-C-compiled vectors, 26/26 green; FFT deferred, never guessed)
- [x] indicators.js split (340/285) per §3.7
- [x] Timeframe-aware interpolated candles (carry-forward gaps, red/green flags, unit-tested)
- [ ] Task 4b: stacked oscillator sub-panes (independent scales) + volume pane (dispatched once, rate-limited — retry)
- [ ] Scroll regions: book sides, trades, picker, history capped with native overflow (original uses fixed-height scroll areas — ours currently run full-length)
- [ ] Desk styling alignment to original (density, header stats, sidebar) + DEX-UX dark values
- [ ] Task 6: live candle proof, headless shots (read), parity note, 8-check audit, tester browser pass

### 8. Voting/governance ⬜
- [ ] Witness / committee / worker lists + details
- [ ] Proxy selection + vote slates
- [ ] Vote weights with percent math (principle #6: hundredths-of-percent fields)

### 9. Explorer ⬜
- [ ] Blocks + transactions + assets + feeds tables
- [ ] Object/operation deep links (1.x.y addressing)

### 10. Asset ops ⬜
- [ ] UIA create/issue/update, smartcoin create/update, NFT + PMA flows
- [ ] Feed publishing for MPA issuers

### 11. HTLC + direct debit + spotlight ⬜
- [ ] HTLC create/redeem/extend/refund
- [ ] Withdraw permissions (direct debit) lifecycle
- [ ] Spotlight/recurring orders

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

- Testnet fixtures: `tooling/testnet-lite-test-1.json` (git-ignored, 600-perms) — funded `lite-test-1` account for broadcasts. Faucet: `testnet-faucet.xbts.io` ALIVE (registered `t9-vanilla-6742`); `faucet.testnet.bitshares.eu` dead (404 + self-signed).
- bitsharesjs policy: REFERENCE ONLY, never a dependency. Consult upstream raw files on demand when porting op serializers (see `mapping-chain-calls`); #4 headers win conflicts; testnet broadcast is final proof.
- Charting decision: TradingView REJECTED (proprietary blob, mirror download, 922-line bridge treadmill). Vendored lightweight-charts 5.2.1 (Apache-2.0) for the price pane + our canvas for depth; canvas line fallback retained.
- Indicator-math source: QTradeX (`squidKid-deluxe`, WTFPL) approved for formulas incl. beyond-Tulip indicators (see AGENTS.md §5.7). Port into `indicators*.js`, verified against published vectors; never installed, never imported.
- DEX-UX (squidKid-deluxe/bitshares-dex-ux) consulted for: market-selector patterns (two-round search, MPA/UIA/LPT/POOL/BTS filters), dark-theme values (TradingView-dark palette), MIT chart precedent. Never a dependency.
- Serializer grows one op per slice inside `vanilla/js/tx.js`, starting with op 0 (transfer) in slice 4. Nothing generated, so nothing to regenerate.
- Headless visual iteration: `tooling/visual/shot.mjs` (dev-only aid; human browser pass stays the gate).
- Image assets vendored: `vanilla/assets/` (459 files: 84 SVG icons, 105 token logos, 243 flags, button-state SVGs, app art — byte-copies per `PROVENANCE.md`, MIT). Styling that applies them lands per-slice.
- Full palette extracted: `vanilla/assets/PALETTE.md` (93 variables × dark/light/midnight, all `$refs` + `darken()`/`lighten()` resolved to final values incl. rgba, via `tooling/extract_palette.py`) + font stacks. Per-slice pixel-matching consumes exact values from here.
- Original-page screenshot arsenal: `vanilla/notes/original-pages/` (35 routes captured headless + README index) — side-by-side reference for retro parity.
- Tracked debt: roelandp node DNS-dead from sandbox (kept last, failover covers); 2 pre-existing `#fff` literals in `app.css` (theme trio must catch); slice-02 fixture brainkey provenance open (does not derive fixture keys — our classic derivation proven independently).
