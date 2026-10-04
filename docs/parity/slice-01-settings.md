# Slice 01 — Shell + Settings/Nodes: parity note

Date: 2026-09-26. Plan: `docs/superpowers/plans/2026-09-26-slice-01-shell-settings-nodes.md`.

## 1. Reference behavior

- Node list + active-node select + testnet switch: `bitshares-ui/app/api/apiConfig.js:129-245`
  (legacy list incl. dead hosts — NOT copied verbatim, see §4).
- WS handshake (login → database api id → chain queries) + failover loop:
  `wallet-extension/src/lib/bitshares-api.js:62-110` (iterative connect),
  `:325-355` (`login(['',''])`, `database`, `get_chain_properties` +
  `get_dynamic_global_properties`).
- Ground truth: `bitshares-core/.../database_api.hpp:209` (`get_chain_properties`),
  `:224` (`get_chain_id`), `:229` (`get_dynamic_global_properties`); all three
  reflected for WS clients (`:1487-1491`).

## 2. Vanilla implementation

| File | Lines | Role |
|---|---|---|
| `vanilla/index.html` | 32 | shell: viewport meta, topbar + `#conn-badge`, `#nav-toggle`, `#nav`, `#view` |
| `vanilla/css/themes.css` | 238 | token sets for ref-ui (default), vanilla light, dex-ux dark + per-theme `--banner-*`/`--warn-text` (2026-10-01 delta below) |
| `vanilla/css/app.css` | 43 | layout, collapsing nav <720px, table→cards <560px, fluid grid ≥1200px |
| `vanilla/js/store.js` | 114 | pub/sub (`settings`, `connection`), localStorage `bts-vanilla-settings-v1` |
| `vanilla/js/chain.js` | 66 | sole WebSocket owner; handshake per references; badge updates |
| `vanilla/js/router.js` | 177 | 37 routes (§6); placeholders; 404 |
| `vanilla/js/settings.js` | 353 | node table+cards, sequential latency probe, select, network toggle, wss-only custom add, offline panel + Retry, theme select |
| `vanilla/js/app.js` | 59 | boot: settings → theme → router → connect; badge + reconnect subscriptions |

## 3. Manual test steps + observed result

Headless (this environment, 2026-09-26):
- `node tooling/ws-probe.mjs wss://testnet.xbts.io/ws` →
  `{"chainId":"39f5e2ed…617447","headBlockTime":"2026-09-26T20:44:27","latencyMs":968}`, exit 0 ✅
- Same probe, `wss://node.xbts.io/ws` → mainnet `4018d784…dad512c8`, exit 0 ✅
- All 6 default mainnet + 2 testnet endpoints probed: 7/8 live with correct
  chain IDs; `btsws.roelandp.nl` DNS-unresolvable from sandbox → kept LAST in
  list (failover covers; see §4).
- `node --check` on all 5 JS files: clean ✅
- `python3 tooling/check_rot.py`: PASSED ✅
- DOM-shim smoke (`/tmp/dom-smoke.js`, throwaway): 37 routes load, settings
  renders without exceptions, probe loop + App boot clean ✅
- `python3 -m http.server` serves the tree (file listing verified; rendering
  needs a browser — below).

Browser (PENDING — follow steps A–E below in order; record PASS/FAIL per step):

Setup (do once):
1. Open a terminal, `cd /workspace`, run `python3 -m http.server 8080 --directory vanilla`
   and leave it running. Confirm it prints `Serving HTTP on ... port 8080`.
2. Open Chrome/Edge/Firefox to `http://localhost:8080/`. Open DevTools
   (F12) → Console tab, and keep it visible: any red error during the steps
   below is an automatic FAIL for that step — copy the message into your report.
3. You should see a blue top bar ("BitShares" + a status badge), a nav row
   (Dashboard, Exchange, Account, Transfer, Explorer, Voting, Settings), and
   an empty content area. If the page is blank or the console is red, stop and
   report FAIL at "Setup".

PASS

Step A — node table loads with live latencies:
1. Click "Settings" in the nav (URL becomes `http://localhost:8080/#/settings`).
2. You should see "Settings", a Mainnet/Testnet toggle, a table of 6 nodes
   (api.bitshares.dev first), each row gaining a latency like "419ms" and a
   short chain prefix within ~30 seconds. A "Probe all" button re-runs this.
3. PASS if: all rows resolve to a latency or "down" (roelandp may show down —
   that is EXPECTED, not a failure), no console errors. FAIL otherwise.

PASS

Step B — switching nodes reconnects:
1. Note the badge text in the top bar (e.g. `connected · 4018d784 · 419ms`).
2. Click the radio button of a DIFFERENT node row (e.g. public.xbts.io).
3. PASS if: badge flips to "connecting…" then back to `connected · 4018d784 · …`
   with a different latency, no console errors, and after reload
   (F5 → back to `#/settings`) the same node is still selected (persistence).
   FAIL if the badge sticks on "connecting" over 30s or the selection resets.

FAIL, doesn't reconnect.  on f5, goes to "connecting..." -> "closed"

REPAIR 2026-09-26 (root cause found — tester was right): the settings page
latency probe called `Chain.connect()` per node, and `connect()` kills the
shared socket first (`chain.js` disconnect-on-connect). The probe loop's last
node is dead roelandp, so every F5 ended with the shared connection murdered
and the badge on "closed". Fix: new `Chain.probe(url, timeoutMs)` in
`vanilla/js/chain.js` runs the handshake on a throwaway socket with its own
pending map and emits NO status; `probeAll` in `vanilla/js/settings.js` now
uses it, so probes can never disturb the boot connection. Also fixed:
latency/chain cells ran together in cards ("677ms4018d784") — added spacing
in `vanilla/css/app.css`. Verified: `node --check` clean on both files, rot
gate PASSED, DOM-shim smoke clean. STEP B RESET TO PENDING — please re-run
Step B above on the fixed build.

PASS

Step C — testnet toggle:
1. Switch the network toggle to Testnet. The table should swap to 2 rows
   (testnet.xbts.io, testnet.dex.trading) and the badge should reconnect.
2. PASS if: badge reads `connected · 39f5e2ed · …` (note the DIFFERENT prefix
   vs mainnet's `4018d784`), no console errors. Switch back to Mainnet and
   confirm `4018d784` returns. FAIL on wrong prefix or stuck badge.

PASS

Step D — all-nodes-down is never blank:
1. In DevTools go to Network tab → set "Offline" (or disconnect Wi-Fi).
2. Click "Probe all" (or reload the page).
3. PASS if: a visible status panel appears with a Retry button (NOT a blank
   page), and clicking Retry after going back online reconnects. FAIL on blank
   content or missing Retry.

PASS

Step E — viewports + themes:
1. Theme trio: find the theme selector on the settings page, choose Light,
   take a screenshot; choose Dark, screenshot; choose Original Blue,
   screenshot. PASS if all three render readably (no invisible text).
2. Phone width: resize the window to ~360px wide (DevTools → device toolbar →
   iPhone SE or 360×800). PASS if: a ☰ hamburger appears and opens the nav,
   node rows become stacked cards (no table), no horizontal scrollbar.
3. Desktop width: maximize / stretch to ≥1440px wide. PASS if: content uses
   the width (no stranded narrow column), header spans fully.
4. Attach the 3 theme screenshots + 2 viewport screenshots (360px, 1440px).

PASS, screenshots are next to this file

Report format: for each of A–E, one line `PASS` or `FAIL + what you saw`
(console errors quoted). Only all-PASS closes the browser pass.

## 4. Raw→human test vectors

No money numbers exist in this slice (connection status, latencies, node URLs
only). Explicitly: nothing here divides by precision, so principle #6 is
vacuously satisfied. First vectors land with the wallet/account slice.
Probe vectors above double as the chain-identity vectors
(`39f5e2ed…` = testnet, `4018d784…` = mainnet).

## 5. Theme + viewport checks

Tokens for all three themes ship (`themes.css`); selector persists via settings.
Screenshots (trio + 360px/1440px) PENDING browser pass above.

## 6. Anti-rot gate (§4.5)

- (a) Ten years, zero maintenance: static HTML/CSS/JS + platform WebSocket +
  localStorage — runs wherever browsers speak WS + ES5-level JS. YES.
- (b) New dependencies: NONE. `tooling/ws-probe.mjs` is Node-stdlib dev tooling,
  never shipped or required. Vendored crypto: not yet needed (no signing).
- (c) Smallest deletable subset: `ws-probe.mjs` (verification convenience;
  browser pass covers the same ground). Kept because headless probes de-risk
  every future slice's testnet step.
- `check_rot.py`: PASSED. Node list is data (editable, persisted), not code.

## Ruling log (chain-doctor)

- Node list: worker's first draft used legacy hosts (`api.bitshares.ws`,
  `*.nodes.bitshares.ws`, `api.bts.mobi`, `bts-api.lafona.net`) — replaced with
  the probe-verified 2026 set, ordered by observed latency, roelandp last.
  Tiebreaker: live testnet observation over stale reference data.

## R1c delta — dead-browser notice (2026-10-01, R1c part 1 task A)

Reference behavior (`bitshares-ui` read-only): `App.jsx:231` (state flag),
`:300-316` (show/hide), `:345-356` (UA-sniff trigger: shows the modal unless
`navigator.userAgent` mentions firefox/chrome/edge), `Modal/
BrowserSupportModal.jsx:9-15` (Chrome upsell via a `google.com/chrome` link),
locale `app_init.browser` / `browser_text` (`locale-en.json:496-497`: "highly
recommend … import it using the Chrome Browser") + `understand` (`:511`).
Vanilla REFUSES both the sniff and the upsell (doctrine: no vendor push).

Vanilla implementation (file:line):
- `vanilla/js/app.js`: `compatMissing()` (feature-detects WebSocket,
  WebCrypto-subtle, BigInt, localStorage-and/or-IndexedDB — never reads
  `navigator.userAgent`); `finishBoot` paints `#compat-banner` ONLY when
  something is genuinely missing (never a load gate); dismissal persists in
  `localStorage` (`bts-vanilla-compat-off-v1`); copy neutral with a `#/help`
  link; all literals via `t()` (`compat.msg` + `compat.dismiss`, `help.help`
  reused for the link).
- `vanilla/index.html`: `#compat-banner` (`hidden` by default) mirroring the
  `#warn-banner` pattern (note + `#compat-msg` + `#compat-help` + dismiss).
- `vanilla/css/app.css`: `#compat-banner` rules mirroring `#warn-banner`
  (fixed pale-gold, readable in all three themes; per-theme `--banner-*`
  tokens remain an owner-ruling follow-up, not this task).
- `vanilla/locales/*.json`: `compat.msg` + `compat.dismiss` added en-identical
  to all 10 dicts via `tooling/sync_locale_keys.py`.

Manual test + observed result (headless, this sandbox 2026-10-01):
- `node --check` on `app.js`: clean; `check_rot.py` PASS; `check_i18n.py` OK
  (10 dicts key-complete, 3696 `t()` sites drift-free).
- Headless Chromium smoke via `tooling/visual/shot.mjs` NOT possible here
  (sandbox lacks `libnspr4.so` — browser fails to launch, exit 127;
  recorded, not hidden). Static smoke instead (node): banner markup present +
  `hidden`, no `google.com` link in `app.js` (only a provenance comment naming
  the refused URL), `compatMissing` wired in `finishBoot` next to the
  warn-banner gate.
- Browser pass (human tester): open any page in a modern browser → no banner;
  disable WebSocket (or use a stripped down browser) → banner appears naming
  the missing API; Dismiss → reload → stays hidden; Help link → `#/help`.

Raw→human vectors: none (capability names are identifiers, never money).
Theme + viewport: banner reuses the warn-banner treatment (readable in all
three themes by construction); 44px dismiss target; flex-wrap safe at 360px.
Anti-rot gate: (a) static + platform APIs only, still runs in 10 years;
(b) zero new deps; (c) deletable subset: the whole banner (app runs without
it — detection only ever ADDS a notice).

## Ship-day theme delta — per-theme banner tokens + warn small-text fixes (2026-10-01)

Landing the owner-ruling follow-up the R1c delta above deferred ("per-theme
`--banner-*` tokens remain an owner-ruling follow-up"): both banners now ride
per-theme tokens, and the `--warn` small-text contract violation is fixed.
No new UI literals (CSS + comment + token-value changes only), so the i18n
`t()` pattern is untouched — zero new keys, zero dict edits.

Reference behavior: `#1` renders its top notice via antd v3
`<Alert type="warning|info" banner />` (`NewsHeadline.jsx:139`; no inline
background in `NewsHeadline.jsx`/`Deprecate.jsx` — the color lives in the
antd stylesheet: `#fffbe6` bg / `#ffe58f` border / `#1a1a1a` text), a fixed
light notice independent of the theme stylesheets. Vanilla keeps the
notice shape but themes it (a fixed pale-gold band leaked into both dark
themes).

Vanilla implementation (file:line):
- `vanilla/css/themes.css`: `--banner-bg`/`--banner-text`/`--banner-border`
  + `--warn-text` per theme (the ONLY new tokens): ref-ui ambered dark
  `#4A3200` + white (12.02) + `--warn` border; vanilla ochre cream `#F3E2B8`
  (darker/warmer than `--bg` `#FAF6EA`) + chocolate `#2A1A12` (13.05) +
  lid-ochre border; dex-ux Crypo ground `#2a2e39` + white (13.56) + `#fbbc06`
  border. `--warn-text` == `--warn` in ref-ui (`#fcab53`: 7.58 bg / 5.56
  panel) and dex-ux (`#fbbc06`: 10.48 bg) — already PASS, no darkening;
  vanilla `--warn-text` `#7A5A0A` (5.90 cream / 6.37 white). Photo-path
  comment fixed to `vanilla/notes/vanilla-theme/tub.jpg`.
- `vanilla/css/app.css`: `#warn-banner` rewired to the tokens; dead
  `background: var(--warn)` line-60 rule DELETED (was overridden by the
  fixed-light rule); fixed-light `#fffbe6` rule replaced (provenance kept
  in the comment); `#compat-banner` rides the same tokens (its "follow-up"
  comment closed); `.xplore-warn` + `.xplore-pill-place` text moved to
  `--warn-text` (pill border follows text, matching the sibling-pill
  convention); `.mkt-star` + toast borders stay `--warn` (graphic-only).
- `vanilla/css/themes.css` vanilla block: `--buy` `#1DA866`→`#0E7A4A`
  (was 2.84 cream / 3.07 white) and `--sell` `#D35A41`→`#B8452F` (was
  3.66 / 3.96) — all <4.5 FAIL for the book-price + picker-CHANGE text
  uses; now 4.98/5.38 + 4.94/5.34 with hue kept. `--live` follows `--buy`
  (footer host is text on white: 3.07→5.38). `--danger` left at `#D35A41`
  (flagged follow-up, out of scope). Ratios recorded in the block comment
  in the `#0F6E99` style.
- `vanilla/notes/vanilla-theme/README.md`: line-11 sky row amended with the
  `#1E9ED7`→`#0F6E99` darkening note (2.81/3.03→5.24/5.66); buy/sell +
  warn-text/banner rows updated to the new values.

Manual test + observed result (this sandbox, 2026-10-01):
- `rg "#fffbe6|#ffe58f|#1a1a1a" vanilla/css/app.css` → only the two
  provenance comments (old antd values named as history); zero live rules.
- `python3 tooling/check_rot.py` → PASSED (dependency-free, static-servable).
- `python3 tooling/check_i18n.py` → FAIL on `borrow.cr_*` + `market.*settle*`
  keys — PRE-EXISTING concurrent-work drift (`borrow-ui.js`,
  `market-orders.js`, `en.json` all carry other agents' uncommitted edits;
  this delta touches only CSS + palette notes, none of which the checker
  scans, and adds zero `t()` call sites).
- `tooling/visual/shot.mjs` theme trio: NOT possible in this sandbox
  (Playwright browser binaries absent —
  `chromium_headless_shell-1243/chrome-headless-shell` missing; recorded,
  not hidden). Human browser pass stays the gate: open `#/` in
  each theme → banner readable; `#/explorer` → pills/missed-blocks
  readable; 360px + 1440px.

Raw→human vectors: none (colors/contrast only — no money math; principle
#6 vacuous here as in the base slice).
Theme + viewport checks (§5): all three themes carry the four new tokens;
banner flex layout untouched (360px-safe); 44px dismiss targets unchanged.
Anti-rot gate: (a) static CSS tokens + platform-only — ten-year safe;
(b) zero new deps, four new custom properties with removal = delete the
four lines per theme (banners fall back to unset, layout intact);
(c) smallest deletable subset: the buy/sell darkening (revert two hexes —
kept because 12px book/CHANGE text was unreadable at 2.84:1).

## Delta 2026-10-01 — Option-B splash (locked landing)

Reference behavior: #1 `/` → DashboardPage gate (LoginSelector when
accountCount==0) then desk redirect; vanilla showed the watched-account
dashboard to everyone (matrix A1 deviation: redirect with link).
Crypo `landing-page-dark.html` (hero + ticker tape + info blocks + feature
trio + number band + 3 steps + CTA) is the structural spec — HEX/structure
only, its lorem copy + fake stats + TradingView embeds refused.

Vanilla implementation: `dashboard-ui.js` `renderDashboard` branches on
`landingFor(isUnlockedNow())` — locked paints `paintLanding` immediately
(no connect-wait, fail-open fills), unlocked paints `paintDashboard`
byte-identical. Sections: motto hero (`assets/hero.webp` framed card +
CTAs Create/Open-exchange/Login) + reused `paintMarketStrip` + 5-call
chain pulse (`get_dynamic_global_properties`, `get_account_count`,
`get_asset_count`, `getWitnessCount`, `getCommitteeCount`, one wave) +
labeled single-market top-vol row (`get_top_markets(1)` — aggregate volume
has no chain call, summed rows would violate #6) + CSS-only product cards
+ trust trio + DEX-honest 3 steps + final CTA. Counts verbatim (grouping
stays Tier-2-deferred); `innerHTML` grep clean; no float math.

Manual test (tester, R6 §0-1 extended): locked `/` at 390px + 1440px in all
three themes (hero readable incl. light-theme framing, band wraps, cards
stack); unlock → same URL becomes the dashboard with zero content loss;
node-down first paint shows hero/cards/steps with "—" live cells.
`tooling/splash-test.js` 22/22 (routing, counts, top-vol shaping);
`node --check` clean; rot PASS; i18n OK (38 splash.* keys × 10 dicts).
Anti-rot: (a) static DOM + 6 read-only db calls — ten-year safe; (b) one
322KB owner-art webp (the page's only image, cached after first load —
removal = hero text block stands alone); (c) deletable: pulse band (strip
+ cards carry the page).

## Delta 2026-10-01 — Splash refill fix (dead sections on slow connect)

Root causes (both verified): (1) `paintLanding` fired `Market.stats` /
`Chain.db` against the still-connecting socket (boot paints `/`
synchronously, connect is async) with zero `Store.subscribe("connection")`
on the landing path — deterministic "not connected" -> "—" everywhere,
never refilled; (2) `tickRow` cached failures as null
(`_tickCache[id]=null` on `.catch`) poisoning later renders.

Reference behavior: #1 has no splash (DashboardPage gate + desk redirect);
the refill pattern is vanilla's own `renderDashboard:220-235` /
`accounts-ui.js:85-89` connect-wait (hashAtEntry/settled/timeout guards).

Vanilla implementation (file:line):
- `vanilla/js/dashboard-ui.js` landing branch paints the static shell
  immediately (never blank) then, when `Chain.status().state!=="open"`,
  subscribes to `connection` — on open clears tick misses and re-invokes
  `renderDashboard(root)` under the same hashAtEntry/settled/
  `CONNECT_TIMEOUT_MS` guards (timeout settles silently, fail-open: the
  shell + "—" cells stand, no error panel); Chain-open path opportunistically
  clears stale nulls.
- `tickRow`: `.catch` returns null WITHOUT caching; parse-throw path likewise
  uncached; `_tickPending` still clears on settle. New `clearTickMisses()`
  drops legacy nulls (returns the count) + one-time `wireTickMissClear()`
  clears on every connection-open.
- Pure `shapePulse(r)` extracted from `fetchPulse` (same null-on-miss
  shaping); `fetchPulse` now delegates. Exposed via `_test`
  (`shapePulse`, `tickRow`, `clearTickMisses`, `_tickCache`) for headless vectors.
- `vanilla/js/router.js` comment fixed: `dashboard-ui.js` eager-loads via
  `vanilla/index.html:138`; `ensureDashboard` is load-failure fallback only.
- No new i18n literals (refill reuses the existing shell/connecting strings;
  timeout is silent) — zero dict edits.

Manual test + observed result (this sandbox, 2026-10-01):
- Slow-connect sim (headless reasoning + code read): boot `/` locked with
  socket connecting -> static hero/cards/steps paint with "…" skeletons,
  live cells miss fail-open; on `Store.emitConnection({state:"open"})` the
  landing re-renders and `Market.stats`/`Chain.db` succeed (misses were never
  cached, legacy nulls cleared first).
- `node --check` clean on `dashboard-ui.js`, `router.js`, `splash-test.js`;
  `tooling/splash-test.js` 50/50 (22 pre-existing + 14 shapePulse + 14
  tick-miss/clear vectors); `python3 tooling/check_rot.py` PASSED;
  `python3 tooling/check_i18n.py` OK (10 dicts key-complete, drift-free).

Raw→human vectors: none new (counts stay verbatim via `fmtCount`/`asCount`;
`topVolText` unchanged; new `shapePulse` vectors assert the same shaping).
Theme + viewport: refill re-renders the same splash DOM (trio + 360px/1440px
behavior unchanged); no new targets, no layout change.
Anti-rot: (a) static DOM + one `Store.subscribe` + 6 read-only db calls —
ten-year safe; (b) zero new deps (no new script tags, no CDN, no build);
(c) deletable subset: the landing subscription (page still paints static +
fail-open fills, just without auto-refill).

## Delta 2026-10-01 — node health beyond reachability (latencyTEST.py signals)

Reference: the owner's 2019 WTFPL utility (removed 2026-10-02 after porting —
logic now lives in `Chain.probe`/`classifyHealth`/`participationPct` plus
the opt-in `NodeDiscover` engine) measured per node: handshake latency, chain-id,
head age, witness participation (`recent_slots_filled` bitcount), and a
STALE/FORKED/WRONG-CHAIN/DOWN/TIMEOUT taxonomy — all from calls the app
already makes. No geolocation (explicit owner call — third-party leaks +
rate limits + https mixed-content; refused, documented).

Vanilla implementation: `Chain.probe` throws one extra
`get_dynamic_global_properties` on its throwaway socket (fail-soft: props
failure with answered chain-id verdicts GOOD with unknown details) and
resolves `{chainId, latencyMs, headBlock, headAgeS, participation,
irrevLag}`; pure `participationPct` (BigInt-exact for uint128 strings) +
`classifyHealth` (GOOD ≥95 / SUSPECT 80–95 or lag>10 / FORKED <80 or
lag>20-with-soft-part / STALE past latency+10s / WRONG-CHAIN mismatch;
thresholds adapted — the script's <100 bar is too strict for the rolling
window) + `enrichProbe`. `probeAll` paints taxonomy pills with tooltips
(head age, participation, lag, prefix, last-good) and stores the last 12
snapshots/node (7-day prune) for "last good Xm ago". List order preserved
(latency sort untouched); offline panel semantics unchanged (only all-"down"
shows it). `tooling/node-health-test.js` 36/36.

## Delta 2026-10-02 — opt-in background discovery (owner: button, never automatic)

`NodeDiscover.run` (`vanilla/js/api/node-discover.js`): GitHub repo search
-> top-12 config sweep (40-fetch budget) -> wss:// extraction -> dedupe vs
known -> sequential Chain.probe + classifyHealth per fresh candidate, all
cancellable via `isCancelled`, all fail-open. UI (`buildDiscover` +
`discoverRow` + settings.js wiring): Discover button, privacy note (states
the IP exposure up front), live progress, Cancel (partial results kept),
per-candidate Add reusing the custom path byte-for-byte (same validation +
storage, zero duplication). Never auto-runs, never auto-adds. 11 i18n keys.
`tooling/node-discover-test.js` 12/12.

## Delta 2026-10-02 — shell round (pool Exchange context, acting-as, footer link, node ops row)
Four owner calls, one round. (1) Pool→Exchange context: pool views publish
their pair (`App.setPoolMarket`, QUOTE_BASE validated — object ids rejected
so the desk never misroutes); the header Exchange tab swaps to it with a
`data-nav-exchange` hook (icon/label fallbacks for dynamic hrefs); the
router clears context off pool/swap/market routes. `validPoolMarket`
unit-tested (`tooling/app-shell-test.js` 11/11); DOM-proven headless on pool
1.19.66 (tab href `#/market/BTS_HONEST.BTC`). (2) Acting-as name left of the
lock: unlocked resolves the wallet account (stale-guarded, fails toward
locked), otherwise the committee-account default; repaints on shell render +
lock toggle. (3) Footer status block is now a `#/settings` link (anchor
keeps id/classes/aria-live; token CSS, no underline). (4) Node ops row:
Ping All (renamed, es "Probar todos" preserved), Add node (new key — the
shared Add stays for HTLC/discovery rows), Find nodes, one flex line ≥720px
stacked below. Headless `#/settings` @1440: all three controls inline,
username + footer link live, zero console errors.

## Delta 2026-10-02 — Phase 1 history capability layer (probe flag + pref + gates)
Chain now knows which nodes serve history. (1) `Chain.probe()` issues a
fail-soft `call(1,"history",[])` on the throwaway socket after props
(`sdk/chain.js` softHistory: own sub-budget, soft:true routing around
fail(), close-mid-soft resolves history-less instead of failing a reachable
node); `enrichProbe()` gains optional 4th `extra` (`hasHistory`, default
false — old 3-arg callers untouched). (2) `Chain.hasHistory()` memoizes the
active connection (`_historyOk`, cleared with the socket in resetApiIds).
(3) `Store` envelope gains 6th key `esEnabled` (default ON per owner ruling;
pre-Phase-1 envelopes upgrade open — only explicit false opts out).
(4) New `api/history-cap.js`: canonical ES_BASE (help-listed
`https://es.bitshares.dev`; kibana host UI-only, never fetched), ES_INDEXES
allowlist, dated HIST_SNAPSHOT from
`tooling/history-capabilities-2026-10-02.json` (9/9 true) + live `update()`
wins, `nodeHistory/historyHere/esAllowed/esLastOk/esAvailable` predicates,
and `esSearch` — the only raw-ES fetch seam (disabled/bad-index/unavailable
error contract, outcomes recorded). NOTE: market-fills-history.js +
pool-history.js keep their own ES_URL+fetch until Phase 4 migrates them; no
new direct ES fetches meanwhile. Zero user-facing strings (no locale churn —
check_i18n green unchanged). Tests: `tooling/history-cap-test.js` 30/30
(gating asserts inline — fetch fires synchronously, so bypass would show in
the counter; record-cache legs sequenced, never raced) + 5 new
node-health vectors (backward compat + true/false/empty-extra). Gates:
check_types PASS, check_rot PASS (no new transport yet — esSearch unfired
until Phase 4; §4.5(b) exception lands with first fired call, not before).
Anti-rot: (a) platform only (WS/fetch/localStorage); (b) nothing new depended
on (snapshot is data, refresh is probe); (c) deletable: history-cap (callers
fall back to Chain.history fail-soft), esEnabled key (reads as ON), probe
flag (pill reads snapshot) — kept because every later phase reads them.

## Delta 2026-10-03 — view-as multilingual completion + verification (Task 5)
Tasks 1–4 reviewed clean (ViewingAs state, header picker, dashboard/accounts
reuse, 18-file form sweep); Task 5 is audit-only and needed zero code fixes.
(1) Drift gate: `python3 tooling/check_i18n.py` →
`OK: 12 dicts key-complete (3497 keys); allowlists exact; stubs honest;
4287 t() call sites drift-free.` (2) Hardcoded-string sweep over
`api/viewing-as.js`, `app.js`, `views/{accounts,account,dashboard}-ui.js` →
no output; wider `vanilla/js` sweep likewise clean (only `t("…")` call
sites). (3) Placeholder-verbatim: no new non-`viewing.*` interpolations added
by this plan (`transfer-confirm.js:188`, `barter-ui.js:229` predate it —
HEAD's barter touch uses `viewing.notice_locked` only); `%(name)s`/`%(id)s`
byte-verbatim in all 12 locales for `header_locked`/`header_unlocked`/
`notice_locked` (fr/ja/tr translated + audited, 8 stubs honestly English).
(4) Rot PASS (`vanilla/ is dependency-free and static-servable`); types PASS
(`checkJs, no emit`); headless trio `#/accounts` 360px+1440px ×
ref-ui/vanilla-ui/dex-ux themes — 6/6 captured, zero console errors
(`/tmp/viewas-{360,1440}-*.png`); keyboard: picker is a native `<button>`
(tabindex 0), headless `focus()` lands, click opens the `View as account`
dialog with focus in the input (`dialog_hint` keyed string shown);
reduced-motion passes by construction (viewing-as adds no animation;
global `prefers-reduced-motion` guard in `app.css:1118` zeroes transitions).
Step-5 commit skipped: no fixes were needed, so no empty commit.
