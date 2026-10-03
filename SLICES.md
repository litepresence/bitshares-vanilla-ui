# Slice Roadmap — bitshares-vanilla-ui

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
| 11 | HTLC + direct debit + spotlight | ✅ built (full lifecycle 1.16.621-625, debit 1.12.139, F-fixes; audit DONE-WITH-BROWSER-ITEMS; browser pass ⏳) |
| 12 | Pools + swap + stake | ✅ built (2 lifecycles 1.19.66/67, virgin max-rule, DEX-UX mirror, ES refused; audit DONE-WITH-BROWSER-ITEMS; browser pass ⏳) |
| 13 | Credit + Same-T + borrow | ✅ built (offer 1.21.43→deals, fund 1.20.29/30, denom 1M, same-tx rule; audit DONE-WITH-BROWSER-ITEMS; browser pass ⏳) |
| 14 | Proposals + tickets + misc | ✅ built (props 1.10.1488/89/91, vesting lifecycles, authority 1.17.4, tickets 1.18.61 proven blocks 100943508/09, F1-F6; audit DONE-WITH-BROWSER-ITEMS; browser pass ⏳) |
| 15 | Gateways | ✅ built (XBTSX/IOB live, GDEX/BIT20 honest-unavailable, memo fix; audit DONE-WITH-BROWSER-ITEMS; browser pass ⏳) |
| 16 | Notifications + alerts | ✅ built (engine wired, CSS, split; audit DONE-WITH-BROWSER-ITEMS; browser pass ⏳) |
| 17 | i18n foundations | ✅ built (en+es+8 stubs, switcher, batch-1 en-identical, Store envelope; audit DONE-WITH-BROWSER-ITEMS; browser pass ⏳) |
| 18 | Final readability pass | 🔨 (oversize list inventoried — see below; audit then fixes) |
| 19 | Principle #10 + 11-language program | 🔨 in progress (AGENTS.md #10 landed; hi+pt plumbed; 136 unkeyed strings keyed; ru/zh/hi/ko/ja/tr/fr/de/it/pt/es fully translated + audited + validator-green; spec `docs/superpowers/specs/2026-10-04-multilingual-design.md`; browser pass ⏳) |
| — | Extension-wrapper adapter Tier 1 (repackage+harden) + Tier 2 gate (WIRED 2026-10-04, headless-tested; human drills gate v1) | 🔨 Tier 1 drill + Tier 2 browser/testnet drills pending (parity: vanilla/notes/extension-tier2.md) |

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

### 11. HTLC + direct debit + spotlight ✅ (browser ⏳)
- [x] Ops 25/26/27/28 + 49/50/52 (51/53 VIRTUAL never signed); op-26 trap proven
- [x] Full lifecycle: HTLC `1.16.621` create→redeem, `1.16.622` extend→expiry (virtual op-53), cross-account 623/624; debit `1.12.139` create→claim→update→delete; F-FEEFILL/F-DEBITGEN/F-MEMO + subscribe fixed
- [x] Parity note `vanilla/notes/slice-11-htlc.md`, audit DONE-WITH-BROWSER-ITEMS

### 12. Pools + swap + stake ✅ (browser ⏳)
- [x] Ops 59/60/61/62/63/75; lifecycles `1.19.66` + `1.19.67`; virgin mint = max(raw) proven; DEX-UX desk mirror; ES transport refused (chain-only)
- [x] Parity note `vanilla/notes/slice-12-pools.md`, audit DONE (verdict DONE-WITH-BROWSER-ITEMS)
- [x] UX DIRECTION (user): DEX-UX experience over Poolmart — desks seamless (kept)

### 13. Credit + Same-T + borrow ✅ (browser ⏳)
- [x] Ops 3/64–73/76; offer `1.21.43`→deals `1.22.70/71`; funds `1.20.29/30`; denom 1M; same-tx [67,68] rule; barter form (PROPOSE deferred → slice 14)
- [x] Parity note `vanilla/notes/slice-13-credit.md`, audit DONE-WITH-BROWSER-ITEMS

### 14. Proposals + tickets + misc ✅ (browser ⏳)
- [x] Ops 7/22/23/24/32/33/37/54/55/56/57/58; props `1.10.1488/89/91`; barter PROPOSE proven; vesting/authority/whitelist/airdrop; blind downscoped honestly; F1–F6 fixed
- [x] Tickets PROVEN on throwaway afk-tkt-75a7 (supersedes the earlier PENDING-funds note): op-57 ticket `1.18.61` block `100943508`, op-58 update block `100943509`
- [x] Parity note `vanilla/notes/slice-14-proposals.md`, audit DONE-WITH-BROWSER-ITEMS

### 15. Gateways ✅ (browser ⏳)
- [x] XBTSX + IOB live (45 + 2 coins); GDEX dead (DNS) → manual-only; BIT20 gateway-less → disabled; withdraw = transfer-prefill delegation; `backingCoin` memo fix proven live (`BTC:`)
- [x] SCOPE (user, 2026-09-28): XBTSX/BIT20/GDEX/IOB only; all other historic partners OUT OF SCOPE (kept)
- [x] Parity note `vanilla/notes/slice-15-gateways.md`, audit DONE-WITH-BROWSER-ITEMS

### 16. Notifications + alerts ✅ (browser ⏳)
- [x] Toast engine + rules + watcher + prefs (browser OFF default); `#/alerts` + host + desk bell; wired into ticker/history/broadcasts; CSS + split
- [x] Parity note `vanilla/notes/slice-16-notify.md`, audit DONE-WITH-BROWSER-ITEMS

### 17. i18n foundations ✅ (browser ⏳)
- [x] `i18n.js` + 10 dicts (121 keys; en full, es 32, 8 stubs); switcher; batch-1 en-identical (16/16); Store-envelope pref; drift gate
- [x] Batch ledger in parity note `vanilla/notes/slice-17-i18n.md`; audit DONE-WITH-BROWSER-ITEMS

### 18. Final readability pass ✅
- [x] Full read-only audit (headers, descriptions, oversize, dead code, TODOs)
- [x] 10 behavior-identical splits; dead code deleted (caller-proven); exceptions recorded
- [x] Readability note `vanilla/notes/slice-18-readability.md`; smoke-verified post-split
- [x] Op-coverage matrix `vanilla/notes/op-coverage-matrix.md`: 0 unjustified missing (22+17+20 ported, 11 honest stubs, deferred with reasons)
- [x] STUB BUILD QUEUE (all built): `/instant-trade`×2, `/create-account`, `/accounts`, `/create-worker` (+ op-34 serializer), `/registration`×3+`/login`, `/news`, `/help/**`, `/prediction`×2; deferred sweep: ops 8/45, `#/fees`, `#/referrals`, `#/wallet/password`, `#/favourites`, `#/ops`
- [ ] Morning questions for owner: ref-ui-theme direction (currently #1's darkTheme column per branding.js default — lightTheme blue #337ab7 is the alternate reading); tester browser passes (slices 2–17 + new views)
- [ ] Tester browser passes (slices 2–17) + ticket funding (≥105 TEST) — with human tester

## Standing directives (user, 2026-09-28 — binding for all remaining slices)
- Retro look: continually review the ref UI via BOTH `vanilla/notes/original-pages/` screenshots AND the `bitshares-ui` codebase; iterate every page until the retro look holds. No page is done until it reads true against the original.
- Themes: dex-ux-theme (dark, Crypo-sourced — extracted template at `reference/crypo/crypo/Crypo/`, HEX VALUES ONLY; alias "crypo theme", id stays `dex-ux-theme`); vanilla-ui-theme (light, from `vanilla/notes/vanilla-theme/tub.jpg`, alias "vanilla-theme"); ref-ui-theme stays default (alias "default theme"). Every slice renders acceptably in all three (screenshot trio in parity note). Per-theme banner tokens (`--banner-bg/--banner-text/--banner-border`); warn-ochre small-text resolved visually per theme.
- Completeness: port EVERY ref-UI route (§6) PLUS every astro-ui operation page (§5.4). Maintain the op-coverage matrix (`#1 route/modal` × `#2 page` × `vanilla slice`) — no astro-only op discovered late. Testnet-prove everything.

- Testnet fixtures: `tooling/testnet-lite-test-1.json` (git-ignored, 600-perms) — funded `lite-test-1` account for broadcasts. Faucet: `testnet-faucet.xbts.io` ALIVE (registered `t9-vanilla-6742`); `faucet.testnet.bitshares.eu` dead (404 + self-signed). Leftover chain state (no delete op exists, intentional): `AFKTEST10` (1.3.1849) 9.0000 held by issuer; `AFKTESTM11` (1.3.1850) supply 0 with live feed (MCR 1750/MSSR 1500).
- bitsharesjs policy: REFERENCE ONLY, never a dependency. Consult upstream raw files on demand when porting op serializers (see `mapping-chain-calls`); #4 headers win conflicts; testnet broadcast is final proof.
- Charting decision: TradingView REJECTED (proprietary blob, mirror download, 922-line bridge treadmill). Vendored lightweight-charts 5.2.1 (Apache-2.0) for the price pane + our canvas for depth; canvas line fallback retained.
- Indicator-math source: QTradeX (`squidKid-deluxe`, WTFPL) approved for formulas incl. beyond-Tulip indicators (see AGENTS.md §5.7). Port into `indicators*.js`, verified against published vectors; never installed, never imported.
- DEX-UX (`reference/bitshares-dex-ux`, squidKid-deluxe, Python/Falcon — behavior-only, never a dependency) consulted for: market-selector patterns (two-round search, MPA/UIA/LPT/POOL/BTS filters), networkx-plot ideas (plots TBD — Kibana/ES transport refused; chain-history plots only). NOT consulted for dark-theme values (those are Crypo-sourced, see Themes line). #1 (React-16 wallet) vs #5 (Python dashboard) are UNIQUE projects — never confuse them.
- Serializer grows one op-set per slice inside `vanilla/js/tx.js`: op 0 (slice 4); ops 1+2 (slice 6); op 6 (slice 8); ops 10/11/12/13/14/15/19 (slice 10); ops 25/26/27/28 + 49/50/52 (slice 11; 51/53 VIRTUAL never signed). Nothing generated, so nothing to regenerate.
- Headless visual iteration: `tooling/visual/shot.mjs` (dev-only aid; human browser pass stays the gate).
- Image assets vendored: `vanilla/assets/` (459 files: 84 SVG icons, 105 token logos, 243 flags, button-state SVGs, app art — byte-copies per `PROVENANCE.md`, MIT). Styling that applies them lands per-slice.
- Full palette extracted: `vanilla/assets/PALETTE.md` (93 variables × dark/light/midnight, all `$refs` + `darken()`/`lighten()` resolved to final values incl. rgba, via `tooling/extract_palette.py`) + font stacks. Per-slice pixel-matching consumes exact values from here.
- Original-page screenshot arsenal: `vanilla/notes/original-pages/` (35 routes captured headless + README index) — side-by-side reference for retro parity.
- Tracked debt: roelandp node proven DNS-dead GLOBALLY (DoH NXDOMAIN 2026-09-30) → replaced by probe-verified `wss://api.bts.mobi/ws` (mainnet chain-id match); 2 pre-existing `#fff` literals in `app.css` (theme trio must catch); slice-02 fixture brainkey provenance open (does not derive fixture keys — our classic derivation proven independently).

## Owner rulings 2026-10-01 (binding — ship-day decisions)

- Project/repo name: `bitshares-vanilla-ui` (code dir `vanilla/` unchanged). Theme aliases: default theme = ref-ui-theme; vanilla-theme = vanilla-ui-theme; dex-ux-theme = crypo theme (id kept).
- Banners: each theme gets its own `--banner-bg/--banner-text/--banner-border` tokens (replaces fixed-light antd banner); warn-ochre small-text resolved visually per theme (owner trusts builder eye + headless trio).
- R1a wallet security: must be complete and perfected to ship (no deferral).
- R1b deferred + documented: `.bin` decrypt/import, cloud password login, multi-wallet subroutes, balance-claims paths (single-slot brainkey keystore is final).
- R1c build: on-chain trollbox (op-35 custom ops, astro `Trollbox.jsx`/`Forum.jsx` pattern), ranked-ops via bounded chain-scan (NOT astro's ES endpoint — doctrine), dead-browser notice via feature detection (NOT UA sniff, NOT Chrome upsell). Defer + document: issue reporter, forum mirror.
- R1d build: live-MPA settlement estimate (exact reciprocal-percent string math, #1's offset formula — #4 op comment sides with #1 over #2's offset-less dialog). Defer: QR, op-35-generic builder, escrow broadcast, scammer registry, settlement-bid extras.
- R1e build: collateral ratio display + open-settlement-orders tab (`get_settle_orders`, #4 `database_api.hpp:558`); fee asset stays `1.3.0` default with switching deferred + noted. No explorer activity joins, no gateway history panels, no news feed (all deferred + documented).
- R1f gateways: XBTSX/IOB/GDEX-manual/BIT20-disabled only — final.
- R2 matrix counts line fixed (table = truth; C3/C37 BUILDING, C23/C36 DEFERRED).
- R3/R4 LTM: skipped for v1 — serializers-done suffices, documented; no faucet work without owner order.
- R5 extension: Tier-1 human install drill gates v1; Tier-2 approval/signing-gate is follow-up. Documented in `vanilla/notes/extension-wrapper.md`.
- R6 tester document: `docs/tester-manual.md` (junior-dev click-by-click, full coverage incl. new features).
- R7 proposal-wrap non-broadcast stands; `1.10.1492` stays uncounted.
- R8 hygiene: `build/` gitignored; footer version stamp `v1.0.0`; `docs/afk-resume.md` refreshed ship-day.
- Splash (2026-10-01, Option B): `/` shows the landing while locked (motto hero + live strip + 5-call chain pulse + labeled single-market top-vol + cards/trust/steps/CTA), dashboard unchanged when unlocked. Aggregate DEX volume omitted (no chain call; summing rows violates #6). §3.1 deviation recorded in slice-01 delta.
- Layer move (2026-10-01): `vanilla/js/` flat → `sdk/` (chain, crypto, vendor, data) · `api/` (tx, data reads, format, wallet) · `builders/` (op construction) · `views/` (`*-ui` + desk/book/tab renders) + shell at root. Pure moves via `tooling/move-to-layers.py` (saved record); old `file:line`s in dated notes stay as history.