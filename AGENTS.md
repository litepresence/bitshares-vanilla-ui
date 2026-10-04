# AGENTS.md — bitshares-vanilla-ui (Vanilla BitShares UI Replacement Project)

> **Workspace root:** `/workspace`
> **Repo name:** `bitshares-vanilla-ui` — all docs refer to the project by
> this name. The shipped code lives in `vanilla/` (directory name unchanged).
> **Theme aliases (all spellings valid):** `default theme` = `ref-ui-theme`
> (classic BitShares look, default); `vanilla-theme` = `vanilla-ui-theme`
> (light, vanilla-tub photo); `dex-ux-theme` = `crypo theme` (dark, Crypo
> designer template — the id stays `dex-ux-theme` for stored-prefs
> compatibility even though the source is Crypo, not DEX-UX).
> **References live in `/workspace/reference/` (READ-ONLY checkouts, each with
> its own history — never edit). `reference/` is gitignored and NEVER ships:
> a fresh dev clone re-creates it with the `git clone` commands in §8
> Phase 0 (same URLs + branches), then works read-only per §7 rule 1.
> (Legacy root symlinks removed 2026-10-01 as tech debt; bare
> `bitshares-ui/...` paths in prose and file headers mean
> `reference/bitshares-ui/...`, likewise astro-ui/wallet-extension/
> bitshares-core.)
> **Reference #1 (canonical wallet):** `reference/bitshares-ui` — upstream `bitshares/bitshares-ui`, branch `develop`
> **Reference #2 (modern/dialog-based):** `reference/astro-ui` — `BTS-CM/astro-ui` by grctest, branch `main`
> **Reference #3 (extension/crypto-audit):** `reference/wallet-extension` — `pi314x/bitshares-wallet-browser-extension`, branch `master`
> **Reference #4 (chain API contract, sparse):** `reference/bitshares-core` — `bitshares/bitshares-core`, branch `develop` (only `libraries/{app/include,protocol,chain/include,wallet/include}` checked out — no build, no submodules)
> **Reference #5 (dashboard/style + indicator/plot math, behavior-only):** `reference/bitshares-dex-ux` — `squidKid-deluxe/bitshares-dex-ux` (Python/Falcon + JS, wrong runtime — NEVER a dependency; consult for market-picker logic and plot ideas, NOT for dark-theme CSS — the dark theme is Crypo-sourced, see §3.4)
> **Reference #6 (machine spec oracle, sparse):** `reference/open-graphene` — `open-graphene/open-graphene`, branch `main` (ONLY `.../graphene-chain-bitshares-spec/dist/bitshares.open-graphene.json` checked out — 78 ops, tags 0–77, spec SHA `caa33ea9`, HEAD `eb78e28` as of 2026-10-01). Serializer cross-check oracle for `mapping-chain-calls` (rank below BJS; #4 wins conflicts; testnet decides). Reference-only, never a dependency.
> **#1 vs #5 are UNIQUE projects — never confuse them.** #1 is the React-16
> reference WALLET (wallet.bitshares.org) we behaviorally replace. #5 is a
> Python dashboard/plot app whose only contributions are picker logic and
> visualization ideas (its Kibana/ES transport is REFUSED
> per the doctrine — chain history only; it is NOT the dark-theme source —
> that is Crypo, see §3.4). If a note cites one for the other's
> job, it is wrong — fix the citation.
> **This file is mission control.** Any agent working here reads this first.
>
> **Motto:** `vanilla/ is dependency-free and static-servable.`
> (`docs/motto.png` — the one-line test every change must pass: if
> `curl`-ing the folder doesn't include it, the app doesn't need it, and
> `python3 -m http.server` must serve a working wallet.)

> **Guiding principles (in priority order — all ten are binding):**
> - **#1 — NEVER RE-CREATE #3583.** The replacement cannot rot the way
>   `bitshares-ui` did (see §4). Every dependency, abstraction, and build step
>   is a future #3583. Default answer to all three is **no**. Doctrine: §4.5;
>   every "done" claim must answer its three gate questions.
> - **#2 — LOOK LIKE THE OLD UI.** The final look mimics the reference UI as
>   closely as possible — retro familiarity. Same layout, same styling, same
>   flows. A returning user feels at home instantly. (Elaboration: §3.1.)
> - **#3 — CARRY EVERY ASTRO-UI FEATURE.** The port is not complete until it
>   also implements every feature in the modern `astro-ui` (§5.4), not just
>   what the old UI had. (Elaboration: §3.2.)
> - **#4 — RETRO LOOK, MODERN GLOW.** Same retro styling on a vanilla stack —
>   but classy, slick, and reactive: easy, intuitive, solid search and menus.
>   Internal architecture may be reconsidered freely so long as the original
>   styling does not change. (Elaboration: §3.3.)
> - **#5 — THREE THEMES.** `ref-ui-theme` (the classic BitShares look — default),
>   `dex-ux-theme` (dark, Crypo designer template), `vanilla-ui-theme` (light,
>   modern classy cream/chocolate/sky from the user's vanilla-tub photo).
>   (Elaboration: §3.4.)
> - **#6 — HUMAN TERMS, NEVER RAW INTEGERS.** Every number the user sees must
>   have graphene's integer math resolved: asset amounts placed at the right
>   decimal, percents offset by precision, prices adjusted for both assets'
>   precisions. Raw chain integers must never reach the screen. (Elaboration:
>   §3.5.)
> - **#7 — PHONE-FIRST, NOT LAPTOP-ONLY.** The old UI was built in 2014 for
>   laptops; most users today are on smartphones. Every slice must work well
>   across the full range — from a 360px phone to a 4K desktop trading desk:
>   responsive layout, touch-sized targets, no hover-dependent UI, and dense
>   views that use wide screens instead of wasting them. (Elaboration: §3.6.)
> - **#8 — BUILT TO BE READ.** All code and file/folder structure must serve
>   ease of maintainability: one clear purpose per file, module headers,
>   function descriptions, honest comments. A final readability pass over the
>   whole app is a defined step before completion, not a nice-to-have.
>   (Elaboration: §3.7.)
> - **#9 — BROWSE AS ANYONE, SIGN AS YOURSELF.** It is a public blockchain:
>   every page renders any account's data with NO login — reads never gate on
>   unlock. The password is asked ONLY at signing. Acting-as defaults to
>   `committee-account` (`1.2.0`, verified on both chains; `1.2.5` is
>   proxy-to-self, not the default) with an honest viewing-as notice.
> - **#10 — EVERY LANGUAGE, FULLY.** BitShares is global; the wallet speaks
>   every supported language completely — every display string keyed, every
>   locale fully translated and audited, never a half-translated screen.
>   English is the fallback, never the excuse. (Elaboration: §3.9.)

---

## 1. Mission

Acquire the horribly-outdated `bitshares-ui` "reference UI", fully analyze it,
and then build a **plug-and-play, works-just-like-the-old-UI replacement in
pure vanilla code**: plain `HTML + JS + CSS`.

**End goal characteristics (non-negotiable):**

- No React. No Vue. No framework.
- No npm dependencies at runtime. No bundler required to *use* it.
- Nothing that can "go out of date and need to be repaired" — no pinned
  toolchain, no abandoned component library, no 400-component framework uplift.
- Open `index.html` (or serve statically) → connect to a BitShares API node →
  use the wallet, exactly like the old UI.
- All keys stay local, all transactions signed locally — same security model as
  the reference wallet.
- Looks like the old UI (retro familiarity, principle #2) yet feels modern:
  slick, reactive, intuitive, with solid search and menus (principle #4).
- Covers every feature of the old UI **plus** every feature of `astro-ui`
  (principle #3).
- Ships three themes: ref-ui-theme, dex-ux-theme, vanilla-ui-theme (principle #5).
- Shows numbers in human terms, never raw chain integers (principle #6).
- Works from a 360px phone to a 4K desktop, not just 2014-era laptops (principle #7).
- Written and structured to be read and maintained by a stranger (principle #8).

**Why:** the reference UI is architecturally unmaintainable (see §4 "The Rot
Report"). The rational fix is not another React 16→17→18→19 migration of
~400 components. It is a clean-room behavioral port to code that cannot rot.

**Prime directive:** preventing a recurrence of #3583 outranks feature speed,
visual polish, and developer convenience — in that order. A slice that ships
fast but introduces a new dependency, build step, or framework-shaped
abstraction is a failure, not progress. (Required responsiveness and glow per
principle #4 still hold — meet them with plain code, never with a library.)
When in doubt, ship less code, not more tooling.

---

## 2. Objectives

### Primary objectives (in order)

1. **Freeze + inventory the reference.** Done: cloned to
   `/workspace/reference/bitshares-ui`. Next: catalog every route, store, action,
   component, and chain-API call it makes.
2. **Document the rot.** Done (summary in §4): capture issue #3583 + Dockerfile /
   Travis / engines evidence so nobody ever argues "just upgrade React".
3. **Define behavioral parity.** For each screen in the old UI, define: inputs,
   outputs, chain calls, error states. Screenshots + network traces beat code
   reading.
4. **Design the vanilla architecture.** One static app, e.g. `/workspace/vanilla/`:
   hash-router, small pub/sub store, `fetch`/`WebSocket` chain client, WebCrypto
   + vendored minimal ECC/serializer (no npm at runtime — vendor by copying
   source into repo with license headers).
5. **Port incrementally by vertical slice.** Binding order lives in
   `/workspace/SLICES.md` (slices 1–18 + deferred extension-wrapper).
   Slices 1–18 built; 19 + extension drills remain — see SLICES.md.
   No slice is "done" until its parity note passes all eight
   audit checks (principle #8, §3.7).
6. **Prove parity.** Side-by-side checklist + manual test script per slice
   against testnet. No slice is "done" without connect → read → sign → broadcast
   verified on testnet. "Parity" means BOTH references: old-UI look/flows (#2)
   and astro-ui feature coverage (#3), with modern responsiveness (#4) — every
   number in human terms, never raw integers (#6), verified at phone width
   and desktop width (#7). See the §2 objectives paragraph.

### Explicit non-goals

- Do NOT modernize the React app in place (no Babel/webpack/electron uplift).
- Do NOT add any runtime dependency (no jQuery, no Bootstrap, no Tailwind CDN,
  no npm `bitsharesjs` import at runtime — vendor what you need).
- Do NOT redesign the LOOK. The layout, styling, and flows stay faithful to the
  old UI (principle #2). Internal architecture may be reconsidered freely, and
  reactivity/search/menu quality must be modern from the start (principle #4) —
  polish is never "deferred to later".
- Do NOT touch `/workspace/reference/bitshares-ui/` except `git fetch`/`git log`. It is
  evidence, not a workbench.

---

## 3. Strategic Vision

```
Old world:  Node 6/16 + React 16 + 100 npm pkgs + webpack + electron
              → every 2 years: "uplift everything or die"
              → issue #3583: several THOUSAND hours just to reach React 17

New world:  index.html + app.js + styles.css + vendored crypto
              → runs in any browser in 2036 the same as 2026
              → security surface = WebSocket endpoint + local keystore
              → a single human can read the whole app in a weekend
```

**Principles for the vanilla build:**

These are the short form. The binding form is the Anti-Rot Doctrine (§4.5) —
principle #1 outranks all nine below.

1. **Zero-runtime-dependency rule.** If `curl`-ing the folder doesn't include
   it, the app doesn't need it. Build tools (if any) must be optional, never
   required to run.
2. **Platform, not framework.** Use Web Components or tiny render functions,
   `hashchange` router, `localStorage`/`IndexedDB` directly. Prefer what browsers
   guarantee for decades over what npm guarantees for months.
3. **Chain isolation layer.** Exactly ONE module talks to `bitsharesjs-ws`-style
   nodes (`vanilla/js/sdk/chain.js`). Everything else talks to that module. This is
   where API-call inventory pays off.
4. **Crypto must be vendored + auditable.** The old UI delegates signing to
   `bitsharesjs`. We cannot `npm install bitsharesjs` at runtime. Options (to be
   decided in design): (a) vendor minimal `ecc` + `serializer` sources with
   licenses, (b) reimplement on WebCrypto + audited small files. Never roll
   custom crypto silently — document provenance per file.
5. **Plug-and-play.** `file://` or any static server works. Node list editable,
   defaults to current mainnet + testnet endpoints. No env vars, no `.env`, no
   build step.
6. **Progressive disclosure.** First load shows unlock/login. No blank screen if
   node is down — show node status + retry (old UI fails poorly here; fix it).

### 3.1 Retro look parity (principle #2)

The vanilla app must be instantly recognizable to a `wallet.bitshares.org`
user: same page structure, same panels and tables, same terminology and flows
(§6 is the checklist). Match the original's visual language — colors, density,
placement — close enough that existing screenshots and help docs still read
true. Deviations are allowed only where the original is broken (e.g. blank
screens on node failure) or where principle #4 requires it (responsiveness,
search); document each deviation with a before/after note in the slice's
parity file. Never "improve" the styling for taste reasons.

### 3.2 Full feature coverage (principle #3)

Scope is the UNION of both UIs: every route/flow in §6 (reference #1) **plus**
every operation page in `astro-ui`'s README (~60 ops: HTLC, direct debit,
Same-T funds, barter, pools/swaps/stake, credit deals/offers, UIA/smartcoin/
NFT/PMA creation, proposals, tickets, airdrops, blind transfers, invoices,
custom authorities — §5.4). Phase 1 inventory must produce a combined
op-coverage matrix (`#1 route/modal` × `#2 page` × `vanilla slice`) so no
astro-only op is discovered late. Slices land #1-parity first (a returning
user's daily flows), then astro-only ops, but nothing is "complete" until both
columns are checked.

### 3.3 Retro look, modern glow (principle #4)

Vanilla stack, modern feel. Concretely:
- **Reactive:** targeted DOM updates on chain data (orderbook ticks, balances,
  connection status) — no full-page reloads, no jank. Achieve with small
  render functions + pub/sub, not a framework.
- **Easy/intuitive:** empty states, inline validation, confirm dialogs with
  human-readable op fields (use `wallet-extension/src/popup/popup.js` 78-op
  table as the wording spec), undo-safe destructive actions.
- **Solid search/menus:** market picker, account/asset search, and nav menus
  must be fast, forgiving (typo-tolerant), and keyboard-friendly. This is a
  release blocker, not polish.
- Internal architecture (state shape, module splits, render strategy) may be
  reconsidered freely at any time — the constraint is only that the original
  STYLING does not change (§3.1).

### 3.4 Three themes (principle #5)

Ship three built-in themes: **ref-ui-theme** (the classic BitShares look —
default), **dex-ux-theme** (dark, sampled from the Crypo designer template in
`reference/crypo/crypo/Crypo/` — HEX VALUES ONLY, never a dependency), and
**vanilla-ui-theme** (light, modern classy cream/chocolate/sky from the user's
vanilla-tub photo). Implement via CSS custom properties (one
`themes.css`, `data-theme` switch on `<html>`, persisted in settings with
old-id migration) — no
theming library, no per-theme stylesheets to drift. Every slice must render
acceptably in all three themes before it is done; add a per-slice screenshot
trio to the parity note.

### 3.5 Human terms, never raw integers (principle #6)

The chain speaks integers; the user must never see them. Graphene stores
asset amounts as `share_type` integers plus a per-asset `precision`
(`scaled_precision(p) = 10^p` — `bitshares-core/.../protocol/asset.hpp:91`);
a `price` is a base/quote pair whose `to_real()` is still in raw units
(`asset.hpp:103-127`) and needs each side's precision ratio applied before
display. Percent fields are hundredths of a percent: `GRAPHENE_100_PERCENT =
10000`, `GRAPHENE_1_PERCENT = 100` (`protocol/config.hpp:102-103`), so a
stored `2000` means 20%. Getting any of this wrong shows the user a balance,
price, fee, or vote weight off by orders of magnitude — a silent,
money-looking bug. Rules:

- **One formatting module.** All amount/percent/price display goes through a
  single `vanilla/js/api/format.js` (amount→string, string→integer for inputs,
  percent fields↔labels, price pairs with both precisions). No ad-hoc
  `/ Math.pow(10, precision)` scattered across views. Reference #1's
  equivalent is `MarketClasses.toReal()` + `precisionsRatio`
  (`bitshares-ui/app/lib/common/MarketClasses.js`) with `PriceText.jsx` /
  `AmountSelector.jsx` at the view layer — port the *math*, not the files.
- **Integers until the last moment.** Keep values as integer strings
  internally; convert to display decimals only at render, and parse input
  strings back to integers without touching binary float for money.
- **Every field, every slice.** Balances, orders, history, fees
  (`get_required_fees` returns raw integers), vesting, HTLC amounts, feed
  prices, fill prices, fee-split percents, vote weights — each displayed
  number in a slice's parity note gets a test vector (raw chain value →
  expected human string, incl. a non-BTS precision and a percent field).
  A slice that renders a raw integer anywhere is not done.

### 3.6 Phone-first, not laptop-only (principle #7)

The old UI was built in 2014 for laptops; most users today are on
smartphones — while power users run 4K desktops. Every slice must work well
across the full range, from a 360px phone to a 4K trading desk, from the day
it lands — responsiveness is never a "mobile pass later", and wide screens
are never an afterthought. Rules:

- **Responsive layout from slice 1.** Shell nav collapses (no sidebar that
  eats a 360px screen); tables become stacked cards or horizontally
  scrollable regions with sticky first columns; order-book-style dense grids
  stay legible without pinch-zooming.
- **Wide screens earn their pixels.** No fixed narrow content column that
  strands a 4K monitor in whitespace: dense views (order book + chart +
  buy/sell, explorer tables, account overviews) expand into multi-column
  arrangements that use the available width. Same content, smarter grid —
  never a separate "desktop version".
- **Touch-sized targets.** Interactive elements ≥44px in at least one
  dimension; no hover-dependent UI (no tooltips or menus that only open on
  `mouseenter` — everything must also work on tap).
- **Viewport + input discipline.** Correct `<meta name="viewport">`, no fixed
  pixel widths above ~360px, inputs use the right `inputmode`/`type` so
  phones show numeric keyboards for amounts.
- **Verify at both ends.** Every slice's parity note adds viewport checks at
  360–390px phone width AND at desktop width (1440px minimum; 2560px+ where
  the slice has dense grids), alongside the theme trio. A slice that only
  works with a mouse at one screen size is not done.

### 3.7 Built to be read (principle #8)

The app must be maintainable by a stranger with no prior context. Rules, in
force from the first file written:

- **One clear purpose per file.** `chain.js` owns the socket, `store.js` owns
  state, view modules own one screen each. A file doing two jobs gets split;
  a file past ~400 lines is a split candidate, not a trophy. Folders group
  by responsibility (`js/`, `css/`, view modules), never by layer ceremony.
- **Module headers.** Every file opens with a block comment: what it owns,
  what it consumes, what globals/side effects it has, which skill + plan
  task created it.
- **Function descriptions.** Every non-trivial function gets: what it does,
  params and return shape, and failure modes. No behavior narration
  ("increment i") — comments explain WHY, never restate WHAT.
- **No dead text.** No commented-out code, no TODO/FIXME markers in shipped
  code — an unresolved item is a tracked task or it doesn't exist. (The
  auditor greps for these.)
- **Final readability pass.** After the last feature slice lands, a dedicated
  slice re-reads every file end to end: adds missing headers/descriptions,
  splits oversized files, deletes dead code, and records a readability note.
  The app is not complete until this pass and its audit are green — so write
  slice code as if the pass will embarrass you (it will).

### 3.8 Marketing surface, addictive busy box

Beyond replacing the wallet, this app is BitShares **marketing material**:
the first thing a newcomer meets (splash hero, README art, guided tour)
should sell the chain — self-custody, live markets, real numbers — before
asking anything of them. And it is an **addictive busy box**: live-ticking
stats, chain-pulse bands, candy motion, tour shimmer, price alerts —
delight that invites play, the way a trading desk invites touch. Both
purposes are binding, but bounded, in this order: never at the cost of
honesty (no fabricated stats, volumes, or counts — a dead feed says so,
never fakes it), never at the cost of performance (jank kills delight —
see the tour scroll-hijack lesson), never at the cost of accessibility
(`prefers-reduced-motion` silences all candy), and never at the cost of
   the doctrine (§4.5 — marketing that needs a dependency is advertising
   for someone else's release cycle).

### 3.9 Every language, fully (principle #10)

BitShares holders live on every continent; a wallet that speaks only English
is a wallet with a gate on it. Every user-visible string in the app resolves
through the locale system (`vanilla/js/i18n.js` + `vanilla/locales/*.json`) —
no hardcoded display text anywhere, in any view, including errors, empty
states, confirm dialogs, and help articles. Supported languages
(en, de, es, fr, hi, it, ja, ko, pt, ru, tr, zh) each ship a complete,
audited dictionary; English fills only what no translator has verified yet,
and the drift gate (`tooling/check_i18n.py`) proves key-completeness on every
change. Translation rules, in this order: placeholders (`%(name)s`), URLs,
object IDs, operation numbers, asset symbols, and theme/network IDs stay
byte-verbatim — a translation that breaks a placeholder is a bug, not a
translation; BitShares terms (witness, committee, worker, proxy, brainkey,
vesting, HTLC, swap, slate) follow one shared glossary per language, never
per-translator improvisation; and no unverified string ever passes as
translated (stubs stay honestly English until a human verifies them).

---

## 4. The Rot Report (why we port, not upgrade)

Source: [`bitshares/bitshares-ui#3583` — "Uplift compute environment & packages
to latest versions"](https://github.com/bitshares/bitshares-ui/issues/3583)
(opened 2022-10-22 by `grctest`, still open; comments through 2025 confirm it is
*more* pressing now). 451→~440 open issues at time of cloning.

### 4.1 Environment rot (verified in-clone)

| Layer        | Reference state                          | Problem |
|--------------|------------------------------------------|---------|
| `Dockerfile` | `FROM node:6`                            | Node 6 EOL since 2019. Issue notes even `node:6` in docker while README says Node 16. |
| `.travis.yml`| `node_js: 16`, `dist: trusty`, `osx_image: xcode8.3`, `g++-4.8` | Ubuntu Trusty + Xcode 8.3 + GCC 4.8 all long EOL. Travis itself dead. |
| `package.json engines` | `node >=16.x`, `yarn >=1.0` | Node 16 EOL 2023-09; Node 18 EOL 2025-04/05 per issue comments. Repo needs Node 20/22 + Ubuntu 22+. |
| `package.json version` | `5.0.250727-rc1` (`BitShares2-light`) | Still RC-style versioning on `develop`; last clone commit `79f8cca` (2026-09-13) is a Dependabot `svgo` bump, not a fix. |
| Electron     | `electron 16.2.6`, `electron-builder 23.6.0` | Electron 16 EOL 2022; each Electron bump = Chromium+Node bump. Light-client binaries unreproducible on modern OS. |
| Browsers     | `browsersList: electron 1.7`             | Meaningless target in 2026. |

### 4.2 Framework rot (the killer)

- **React `16.14.0` + `react-dom 16.14.0`.** React 19 is current. Issue author
  estimates ~400 components needing refactor just to reach React 17, "plausibly
  several thousand hours", then more breakage to 18 (Suspense replaces
  `react-loadable`, etc.).
- **State:** `alt`, `alt-container`, `alt-react` — all forked to `bitshares/*`,
  `alt-react` depends on React 14. Dead-end Flux implementation.
- **UI kit:** `foundation-apps` (Zurb, archived read-only) +
  `react-foundation-apps` (bitshares fork, 7+ years stale) +
  `bitshares-ui-style-guide` (git dep, unpinned).
- **Router/i18n:** `react-router-dom ^5.1.2`, `react-intl ^2.9.0`,
  `react-translate-component` (5 yrs stale), `counterpart ^0.18.5`.

### 4.3 Dependency graveyard (from #3583 — likely needs *replacement*, not bump)

```
alt-react                  → depends on react 14
foundation-apps            → archived read-only (zurb)
react-autocomplete         → archived read-only, react 15
react-clipboard.js         → no update in 3 yrs
react-debounce-render      → no react 18 support (#42)
react-foundation-apps      → no update in 7 yrs
react-highcharts           → no update in 3 yrs, likely react-16-locked
react-interpolate-component→ no update in 5 yrs (native in 17+)
react-json-inspector       → archived read-only (Lapple)
react-loadable             → superseded by Suspense
react-notification-system  → stale (electron has native notifications)
react-popover              → abandoned, no release in years
react-qr-reader            → unmaintained, blocks react upgrade
react-responsive-mixin     → no update in 6 yrs
react-sticky-table         → unmaintained (#137)
react-translate-component  → no update in 5 yrs
core-js                    → maintainer health failing, licensing risk noted
```

Plus ~90 packages with major bumps pending at issue time
(`babel`, `webpack 5.65→5.74`, `electron 16→21`, `indexeddbshim 2→10`,
`intro.js 2-alpha→6`, `jest 24→29`, `bignumber 4→9`, `immutable 3→4`, …).
Current clone is *newer* than the issue snapshot but still React 16 / Electron 16
era — the structural problem is unchanged.

### 4.4 Takeaway for agents

> **Do not propose "let's just upgrade packages".** That is the thousand-hour
> trap #3583 documents. Every future design doc must cite this section and
> explain why the vanilla approach avoids the cited failure mode (see the
> doctrine in §4.5 for how).

### 4.5 Anti-Rot Doctrine (prime directive — read before writing any code)

#3583 happened because each layer of the stack — OS image, Node, framework,
component kit, build tooling — could independently expire and force a
coordinated uplift of everything else. The vanilla build breaks that coupling
by depending on **nothing that has a release cycle**. The rules below are
ordered by importance and are not negotiable without a written exception that
names its own removal plan.

1. **Zero runtime dependencies.** `vanilla/` contains no `package.json`,
   no `node_modules`, no lockfile, no CDN `<script src>`, no framework.
   Any proposal to add one must answer: what removes it again, and when?
   Default answer: don't add it.
2. **Platform APIs only.** HTML, CSS, vanilla JS, WebSocket, WebCrypto,
   `localStorage`/`IndexedDB`, `Intl` — standards browsers guarantee for
   decades, not packages npm guarantees for months. No framework-shaped
   abstractions grown inside `vanilla/` either (no mini-React, no plugin
   systems, no codegen).
3. **Vendor, never depend.** Crypto/serializer code is *copied* into the repo
   with license headers intact, a provenance comment per file (source repo +
   commit hash), and an entry in a vendoring manifest. Pinned copies do not
   break on someone else's release day. (Candidates: see §5.5, audit #3 first.)
   The watch half lives in `vanilla/SECURITY.md` (upstream + advisory +
   re-vendor trigger per artifact — check it every slice and on CVE demand).
4. **No build step to run.** `python3 -m http.server` (or `file://`) must
   serve a working app. Optional dev tooling may exist under `tooling/` but
   must never be required to use, test, or deploy the wallet.
5. **Small and boring.** A single human reads the whole app in a weekend.
   Prefer duplicated plain code over a clever abstraction with a future
   migration cost. If a file grows large, that is a signal it does too much
   (see brainstorming skill: one clear purpose per unit).
6. **Minimal chain-facing surface.** Exactly one module talks to nodes
   (`vanilla/js/sdk/chain.js`). The node list is data (editable, with testnet
   defaults), not code. Gateway/faucet integrations are isolated adapters
   with explicit "unavailable" states, never load-bearing imports.
7. **The 2036 test.** Every design decision, every slice review, every "done"
   claim must answer these three gate questions:
   - (a) If every author of this code disappears and nothing is updated for
     ten years, does it still run in a contemporary browser?
   - (b) What, exactly, did this change newly depend on (package, service,
     toolchain, hosted asset)? If anything: why can't it be vendored or deleted?
   - (c) What is the smallest subset that could be deleted while keeping the
     slice working? Why wasn't it?

   A "done" claim that cannot answer (a)–(c) is not done. Run
   `verification-before-completion` **and** the rot check
   (`tooling/check_rot.py` — fails on runtime deps, framework imports, CDN
   references, or build-required artifacts inside `vanilla/`) before declaring
   any slice complete.

Note that reference #2 (`astro-ui`, React 19 / Astro / Tailwind / Electron 44)
is already on the same treadmill #1 died on — fresher today, a future #3583
tomorrow. That is why it is behavior/crypto reference only, never a
dependency or a pattern source for architecture.

---

## 5. Reference Map (ASCII)

Cloned: `https://github.com/bitshares/bitshares-ui.git` → `/workspace/reference/bitshares-ui`
Branch: `develop` (`origin/develop`), HEAD `79f8cca` as of 2026-09-26.
Scale: **~547 JS/JSX files, 421 component files, 101 SCSS files.**

Second reference: `https://github.com/BTS-CM/astro-ui.git` → `/workspace/reference/astro-ui`
Branch: `main`, HEAD `5037d61` as of 2026-09-26 (v0.6.30, ~599 commits).
Scale: **~1692 files under `src/`, ~70 `.astro` pages, ~221 TSX/JSX components.**
Form factor: dialog-based, page-per-operation (NOT same layout as old UI).
Stack: Astro 7 + React 19 + shadcn/ui (Radix dialogs) + Tailwind 4 + Electron 44.
Signing: outsources to Beet/BeetEOS multiwallets (no local keystore like #1).
See §5.4 for when to consult which reference.

### 5.1 Top level

```
/workspace/
├── AGENTS.md                  ← YOU ARE HERE (mission control)
├── reference/                 ← READ-ONLY checkouts (do not edit; see §5)
│   ├── bitshares-ui/          ← #1 canonical wallet (develop)
│   ├── astro-ui/              ← #2 modern dialogs (main)
│   ├── wallet-extension/      ← #3 extension/crypto-audit (master)
│   ├── bitshares-core/        ← #4 chain API contract, SPARSE (develop)
│   └── bitshares-dex-ux/      ← #5 dashboard/style, behavior-only (main)
└── vanilla/                   ← THE REPLACEMENT (static, no deps)
    ├── index.html
    ├── css/
    ├── js/                      ← sdk/ (chain, crypto) · api/ (tx, data reads)
    │                              builders/ (op construction) · views/ (*-ui)
    │                              + shell at root (app, router, store, …)
    └── assets/

bitshares-ui/
├── app/                       ← ALL UI SOURCE (~547 files)
├── docs/                      ← sphinx docs (structure.rst is useful)
├── charting_library/          ← TradingView vendored zip + installer
├── conf/  resources/  ssl/    ← nginx/electron/ssl scaffolding
├── bloom_filter/  bower.json  ← legacy artifacts
├── package.json  yarn.lock  webpack.config.js  .babelrc
├── Dockerfile  docker-compose.yml  build.sh  deploy.sh
├── CHANGELOG.md  release-notes.txt  news.json
└── README.md  README_zh.md  CONTRIBUTING.md  CODE_OF_CONDUCT.md
```

### 5.2 `app/` — the part we must understand completely

```
app/
├── Main.js                    ← entry shim (intl polyfill → index.js)
├── index.js                   ← bootstrap (stores, router, render)
├── App.jsx        (714 lines) ← shell + ALL <Route> definitions (see §6)
├── AppInit.jsx                ← init / node connect / error gates
├── Deprecate.jsx              ← deprecation banner
├── routerTransition.js (1278) ← route transition logic (largest router file)
├── alt-instance.js            ← Flux dispatcher singleton
├── branding.js                ← wallet name/URL/faucet/testnet detection
├── counterpart-instance.js    ← i18n singleton
├── idb-*.js                   ← IndexedDB keystore layer (5 files)
├── dl_cli_index.js
├── api/                (5)    ← ApplicationApi, WalletApi, accountApi, apiConfig, DebugApi
├── actions/           (22)    ← Flux actions (Account, Asset, Market, Wallet, …)
├── stores/            (24)    ← Flux stores (AccountStore, WalletDb, SettingsStore, …)
├── lib/
│   ├── chain/          (6)    ← chainIds, account/asset constants, serializer_config
│   ├── common/        (~40)   ← MarketClasses, trxHelper, utils, gateway caches, …
│   ├── feature_detect/ (3)    ← browser / incognito detect
│   └── workers/        (3)    ← AddressIndex, Aes, GenesisFilter workers
├── services/                  ← AccountHistoryExporter, Exchange, Math, Validation/
├── components/       (~421)   ← THE UI (34 dirs, see §5.3)
├── assets/
│   ├── locales/      (10)     ← en + 9 translations (crowdin)
│   ├── stylesheets/           ← SCSS (101 files)
│   ├── icons/  images/  intl-data/  language-dropdown/
│   └── index.hbs  loader.js  locales.js  …
├── help/               (6)    ← en es ja ru tr zh markdown help
└── __tests__/ test/           ← jest + mocha market tests
```

### 5.3 `app/components/` — file counts per area (for port sizing)

```
Blockchain/      78  ← blocks, txs, assets, witnesses, HTLC views, workers UI
Utility/         60  ← shared widgets (buttons, tables, modals helpers, …)
Account/         57  ← account page, asset create/issue, vesting, signed msgs
DepositWithdraw/ 36  ← gateway deposit/withdraw (GDEX/Citadel/RuDEX/BlockTrades…)
Exchange/        29  ← DEX core: Exchange, OrderBook, MarketPicker, MyMarkets, …
Modal/           27  ← ALL transaction confirm / action modals
Wallet/          20  ← create/unlock/backup/brainkey/import-keys/manager
Settings/        14  ← nodes, wallet, view, access, faucet, reset
Explorer/        13  ← chain explorer pages
Registration/    11  ← faucet / cloud / local account creation
Layout/          11  ← header, sidebar, footer, app shell
Dashboard/        8      PredictionMarkets/ 8      Forms/ 8
Showcases/        6      Transfer/ 5            QuickTrade/ 4
Login/            4      Icon/ 3
Poolmart/ 2  Notifier/ 2  Gateways/ 2  BrowserNotifications/ 2
Help.jsx  News.jsx  InitError.jsx  SyncError.jsx  LoadingIndicator.jsx
Page404/ 1  Console/ 1  LoginSelector.jsx  PriceAlertNotifications.jsx
PrivateKeyView.jsx  QRAddressScanner.jsx
```

### 5.4 `astro-ui/` — second reference (grctest, modern, dialog-based)

```
astro-ui/                         ← BTS-CM/astro-ui v0.6.30, Astro+React19, MIT
├── src/
│   ├── pages/          (~70 .astro) ← one page per operation (dex, htlc, pools,
│   │                                  swap, borrow/lend, proposals, tickets, …)
│   ├── components/    (~221 tsx/jsx) ← each op = Dialog + form + Beet sign flow
│   │   ├── Market/  InstantTrade/  common/  ui/dialog.jsx …
│   │   └── HtlcCreateDialog, WithdrawDialog, PoolDialogs, DeepLinkDialog, …
│   ├── bts/                       ← VENDORED CHAIN LIB (audit target for vanilla!)
│   │   ├── chain/  ecc/  serializer/  ws/  common.ts
│   ├── stores/         (16 nanostores) ← connection, node, users, favourites, …
│   ├── lib/  hooks/  nanoeffects/  config/  data/  layouts/  styles/
│   └── data/locales/  (10+ langs) ← per-component JSON dicts (vs counterpart)
├── scripts/  app/ (electron)  public/  resources/  build/
└── package.json ← react ~19.2.8, astro ^7.3.3, radix-ui, tailwind ^4.3.3,
                   electron ^44, nanostores, @noble/{ciphers,curves,hashes}
```

When to consult which reference:

| Question | Consult |
|---|---|
| "What must v1 look like / what route exists?" | #1 `bitshares-ui` — canonical layout + routes (§6). Vanilla v1 = its twin. |
| "How does this obscure op work now (Same-T fund, tickets, credit deals, airdrop)?" | #2 `astro-ui` — README lists ~60 ops; its per-op page is often clearer + newer than #1's buggy modal. |
| "What chain API calls + params?" | BOTH — diff `bitshares-ui/app/{actions,stores}` vs `astro-ui/src/components/<Op>.jsx` + `src/bts/`. If they disagree, trust on-chain docs/testnet, note the conflict. |
| "What crypto/serializer code can we vendor?" | #2 first — `src/bts/{ecc,serializer,chain,ws}` is already isolated and modern (`@noble/*`, `bs58`, `bignumber.js ^11`). Then compare with `bitsharesjs ^6.0.3` used by #1. Document provenance per vendored file. |
| "What signing UX?" | #1 — local keystore (`WalletDb.js`) is the v1 model. #2 outsources to Beet/BeetEOS — do NOT copy that; vanilla signs locally like #1. |

Do NOT port #2's stack (Astro/React/Tailwind/Radix/npm) — it reintroduces the
rot §4 warns about. Treat #2 as behavior + chain-call + crypto-provenance
reference only.

### 5.5 `wallet-extension/` — third reference (pi314x, extension/crypto-audit)

```
wallet-extension/                 ← pi314x/bitshares-wallet-browser-extension
                                    v0.8.7, MIT, Chrome MV3 + Firefox MV2
├── src/
│   ├── lib/
│   │   ├── crypto-utils.js (1398) ← ZERO-DEP CRYPTO (audit target #1 for vanilla!)
│   │   │                             WebCrypto SHA/PBKDF2/AES + noble secp256k1
│   │   │                             for secret-scalar ops; BigInt EC public-only
│   │   ├── noble-secp256k1.js (797)← vendored audited curve lib
│   │   ├── bitshares-api.js (3915)← WS client, 2026 nodes, failover, fee-fill
│   │   ├── wallet-manager.js(2367)← AES-256-GCM + PBKDF2 600k + salt, auto-lock,
│   │   │                             per-account keys, watch-only, rate-limit
│   │   ├── biometric-auth.js (145)← WebAuthn PRF (+ documented cosmetic fallback)
│   │   └── bip39-wordlist / jdenticon / qr-generator
│   ├── background/service-worker.js (1468) ← dApp approval flow, HTTPS-only,
│   │                                          chain_id check, timeouts
│   ├── content/inject.js + inpage.js ← isolated provider (`window.bitsharesWallet`
│   │                                    + `window.beet` compat), page can't touch keys
│   ├── popup/popup.js (7596)      ← 78-OP HUMAN-READABLE CONFIRM DIALOGS
│   │                                  (spec source for vanilla confirm modal)
│   └── biometric.html/js, assets/
├── tests/ (5 suites)              ← crypto, wallet-manager, api-call,
│                                     ops-serialization, biometric-auth
├── manifest.json (MV3) / manifest.firefox.json (MV2) ← CSP `script-src 'self'`
├── scripts/build.js               ← build-only; runtime has 1 dep (@noble/secp256k1)
└── docs/ (GitHub Pages site)
```

Security model (strongest of the three — extension isolation):

- Keys in `chrome.storage.local`, AES-256-GCM + PBKDF2-600k + per-wallet salt;
  unlock lives in memory/`chrome.storage.session` only; auto-lock via
  `chrome.alarms`; unlock rate-limit persisted across restarts.
- Page origin can NEVER read keys — only the provider API, every op gated by
  popup approval (60s timeout, per-origin rate-limit, `allowedAccountIds` bound
  so a site connected to A can't sign as B).
- `signMessage` deliberately UNIMPLEMENTED (`service-worker.js`) to rule out
  blind-signing a tx digest — copy that discipline.
- Honest docs: biometric without WebAuthn-PRF is flagged cosmetic (UI gate,
  not encryption).

When to consult #3:

| Question | Consult |
|---|---|
| "What crypto do we vendor for vanilla?" | #3 FIRST — `crypto-utils.js` + `noble-secp256k1.js` is the closest thing to the vanilla target that exists: no framework, WebCrypto-based, tested, constant-time boundaries documented. Diff against #2's `src/bts/ecc/` before deciding. |
| "How should the local keystore work?" | #3 — salt/PBKDF2-600k/AES-GCM/session-only/auto-lock/rate-limit/per-account keys. Vanilla reimplements the same properties on `IndexedDB`/`localStorage` (no `chrome.*` APIs). |
| "What does a safe confirm dialog show per op?" | #3 — `popup.js` 78-op display table. Clearer than #1's `Modal/` (27 files, stale) for field-level parity. |
| "What chain calls + node list?" | #3's `bitshares-api.js` (2026 nodes, failover loop) as third data point next to #1's stores and #2's `src/bts/ws/`. |
| "dApp bridge?" | Out of v1 scope — but if ever added, copy #3's permission/validation patterns (HTTPS-only, `chain_id` verify, explicit approval, no blind signing). |

Do NOT port #3's `chrome.*` plumbing (service-worker lifecycle, alarms, side
panel) — vanilla has no extension APIs. Port the crypto, keystore properties,
confirm-dialog spec, and validation discipline only.

### 5.6 `bitshares-core/` — fourth reference (chain API contract, SPARSE)

```
bitshares-core/                   ← bitshares/bitshares-core, develop, MIT
                                    SPARSE CHECKOUT — ~2 MB, no build, no submodules
├── libraries/app/include/graphene/app/
│   ├── database_api.hpp (1619)  ← THE read-API contract (get_accounts,
│   │                                get_assets, get_required_fees, markets, …)
│   └── api.hpp (896)            ← broadcast / network_node / block APIs
├── libraries/protocol/          ← AUTHORITATIVE op definitions (operations.hpp,
│   │                                htlc, samet_fund, credit_offer, ticket,
│   │                                liquidity_pool, proposal, … — field-level truth)
├── libraries/chain/include/      ← object IDs, chain types
└── libraries/wallet/include/graphene/wallet/
    └── wallet.hpp (1975)        ← cli_wallet command list (alt behavior source)
```

Why sparse, why read-only, why never expanded: a full clone is hundreds of MB
of C++ (consensus, P2P, witnesses, submodules `fc`/`docs`) that the UI port
will never read — and a full checkout invites "just build a node" scope creep.
The four header trees above are the complete API surface the wallet speaks.
Online mirrors of the same contract: `docs.bitshares.dev` (Database / History /
Broadcast API pages) and `bitshares.github.io/doxygen`.

When to consult #4:

| Question | Consult |
|---|---|
| "Does this WS method exist / what params does it take?" | #4 FIRST — `database_api.hpp` / `api.hpp` are ground truth. If #1/#2/#3 disagree with #4, #4 wins; note the conflict and verify on testnet. |
| "What fields does op X have / which are optional?" | `libraries/protocol/<op>.hpp` + `operations.hpp` — field-level truth for serializer + confirm-dialog work. |
| "How does cli_wallet do this flow?" | `wallet.hpp` — second opinion on behavior (e.g. fee handling, key import). |
| "Can I look at consensus/P2P/witness code?" | No — out of scope. Close the file. |

Do NOT run `git sparse-checkout add`, do NOT `git submodule update`, do NOT
build. If a header you need is missing, fetch that single path only and record
why in the parity note. `du -sh bitshares-core` should stay in single-digit MB.

### 5.7 `qtradex` — approved indicator-math source (consult on demand, never a dependency)

`QTradeX-Algo-Trading-SDK` (`squidKid-deluxe`, WTFPL — permissive, compatible
with our MIT repo, 85 stars) is the approved source for indicator
MATHEMATICS: its `qx.ti` module wraps Tulip plus community indicators (SMA,
EMA, MACD, RSI, Stoch, BBands, ATR, Fisher, PSAR, …). Rules, same as BJS:

- Port formulas into dependency-free JS (`vanilla/js/api/indicators.js`), verified
  against Tulip/QTradeX published vectors — never install, never import, never
  copy matplotlib plotting code (desktop Python has no place in a browser wallet).
- Consult the repo raw on demand for formulas beyond Tulip; record which
  indicator came from where in the parity note.
- QTradeX-the-dependency stays out for the same reasons as everything else:
  wrong runtime (Python/C-ext), single-community bus factor, release cycle.
  Math is public domain; machinery is not ours.

---

## 6. Functional Inventory (what "works just like the old UI" means)

Routes defined in `app/App.jsx` (~40 routes). Parity checklist v1:

```
 /                              → Dashboard / default market redirect
 /account/:account_name          → account overview (balances, orders, history)
 /accounts                      → account list / manager
 /market/:marketID               → full DEX (orderbook, chart, buy/sell, history)
 /credit-offer                   → credit offers
 /settings /settings/:tab        → nodes, general, wallet, access, faucet, reset
 /invoice/:data                  → payment invoice view
 /deposit-withdraw               → gateway bridge UI
 /create-account                 → faucet/registrar flow
 /login /registration*           → password/cloud/brainkey/local login
 /news                           → news feed
 /voting                         → witnesses/committee/workers/proxies voting
 /explorer /explorer/:tab        → chain explorer
 /asset/:symbol                  → asset detail
 /block/:height /block/:height/:txIndex → block/tx detail
 /borrow /barter                 → margin/borrow + barter (QuickTrade family)
 /direct-debit /spotlight        → recurring / spotlight order UIs
 /wallet /create-wallet-brainkey /existing-account → wallet lifecycle
 /create-worker                  → worker proposal creation
 /help/**                        → localized help (4-level deep routes)
 /htlc                           → HTLC create/redeem
 /prediction /prediction/:market → prediction markets
 /instant-trade /instant-trade/:marketID → simple trade view
 /pools                          → liquidity pools (Poolmart)
 *                               → Page404
```

**Core subsystems to port (with reference pointers):**

| Subsystem | Reference | Notes for vanilla |
|---|---|---|
| Node connect + settings | `SettingsStore`, `api/apiConfig`, `AppInit.jsx` | WS endpoint list, latency sort, testnet switch (`branding.js#_isTestnet`), chain-id check |
| Wallet lifecycle | `stores/WalletDb.js`, `WalletManagerStore`, `BackupStore`, `components/Wallet/` (20) | brainkey, cloud, local, import-keys, AES workers (`lib/workers/AesWorker`) |
| Account + keys | `AccountStore`, `AccountActions`, `PrivateKeyStore`, `AddressIndex` worker | permission model (`lib/common/permission_utils`), `paperWallet`, `account_utils` |
| Transfer / invoice | `components/Transfer/`, `trxHelper.estimateFee` | #3720 warns fee estimation is stale — use `get_required_fees` API in vanilla |
| DEX / markets | `components/Exchange/` (29), `MarketsStore/Actions`, `lib/common/MarketClasses` | orderbook, depth chart, `MarketPicker`, scaled orders, price alerts; TradingView `charting_library/` is proprietary — replace with canvas chart |
| Explorer / blockchain | `components/Blockchain/` (78), `BlockchainStore/Actions` | blocks, txs, assets, feeds, HTLC, witnesses |
| Voting / workers | `components/Account/*Voting*`, worker create route | proxy, slate, legacy-proposal toggles (known buggy — see open issues) |
| Gateways | `DepositWithdraw/` (36), `lib/common/*DepositAddressCache`, `gatewayMethods` | GDEX/RuDEX/Citadel/BlockTrades/Bitspark — most fragile; isolate per gateway |
| Pools / HTLC / prediction / credit | `Poolmart/`, `PredictionMarkets/`, HTLC actions, `CreditOfferStore` | lower priority, port after DEX+wallet solid |
| Notifications / alerts | `NotificationStore`, `Notifier/`, `PriceAlert*` | replace `react-notification-system` with native DOM + optional Electron-less Web Notifications |
| i18n | `counterpart-instance`, `assets/locales/` (10 langs), `IntlStore` | vanilla: plain JSON dicts + `Intl` API, no `react-intl` |
| Styling | `assets/stylesheets/` (101 SCSS), `bitshares-ui-style-guide` dep | vanilla: design-token CSS + `themes.css` custom properties, no SCSS build, no theming lib (see §3.1 + §3.4) |

---

## 7. How To Work Here (rules for agents)

1. **Read-only references.** Never edit `/workspace/reference/bitshares-ui/*`,
   `/workspace/reference/astro-ui/*`, `/workspace/reference/wallet-extension/*`, or
   `/workspace/reference/bitshares-core/*`. Use
   `git -C <dir> log/fetch/status`. If you need to experiment, copy the file
   to `/tmp` or `/workspace/vanilla/notes/`.
2. **New code lives in `/workspace/vanilla/`** (create on first implementation
   task). Static only: `index.html` must work via `python3 -m http.server` with
   zero `npm install`.
3. **No inline throwaway scripts.** Per repo policy: any useful script (audit,
   route extractor, locale converter, chain-call grepper) must be saved under
   `/workspace/tooling/` with a descriptive name, not left inline in chat.
4. **Brainstorm → plan → execute.** For each vertical slice: brainstorm skill for
   design, writing-plans skill for steps, then implement. Keep slices small
   enough to verify on testnet in one session.
5. **Evidence before claims.** "Parity achieved" requires: (a) reference
   behavior noted (file:line), (b) vanilla file:line, (c) manual test steps +
   observed result. Run `verification-before-completion` before declaring done.
Every "done" claim must ALSO pass the §4.5 anti-rot gate questions (a)–(c)
    and the `tooling/check_rot.py` scan. A slice that works but rots is not done.
    Every "done" claim must ALSO pass the hard type gate (check 9)
    (`bash tooling/check_types.sh` — tsc checkJs, zero emit). A slice that
    works but doesn't typecheck is not done.
6. **Chain safety.** Real keys only on testnet during dev. Never paste mainnet
   private keys/brainkeys into logs, issues, or commits. Test transfers on
   testnet faucet accounts.
7. **Commits.** Do not commit to `reference/bitshares-ui/`, `reference/astro-ui/`,
   `reference/wallet-extension/`, or `reference/bitshares-core/`. Commit `AGENTS.md`, `vanilla/`,
   `tooling/`, `skills/`, `docs/` only, with short messages. No secrets.
8. **Workspace skills.** `/workspace/skills/` holds this project's repeatable
   workflows — load the matching one via the skill tool before starting the
   task (read its `SKILL.md` directly if the tool cannot see it):
   `building-vanilla-slices` (any new slice), `auditing-vanilla-slices`
   (any done-claim or displayed number), `mapping-chain-calls` (any WS
   method, op field, fee, or endpoint question), `vanilla-director`
   (coordinating multi-task rounds), `batch-dispatch-parallelism`
   (saturating a dispatch round), `chain-doctor` (references disagree on
   chain behavior), `afk-keep-rolling` (user goes AFK mid-loop).

---

## 8. Analysis Playbook (start here, in this order)

### Phase 0 — Freeze (DONE)

- [x] Clone `bitshares/bitshares-ui` @ `develop` → `/workspace/reference/bitshares-ui`
- [x] Record HEAD (`79f8cca`, 2026-09-13), version `5.0.250727-rc1`
- [x] Capture Rot Report (#3583 + Dockerfile + Travis)
- [x] Clone `BTS-CM/astro-ui` @ `main` → `/workspace/reference/astro-ui`
- [x] Record HEAD (`5037d61`, 2026-09-20), version `0.6.30` — dialog-based 2nd reference
- [x] Clone `pi314x/bitshares-wallet-browser-extension` @ `master` → `/workspace/reference/wallet-extension`
- [x] Record HEAD (`ebb7451`, 2026-08-21), version `0.8.7` — extension/crypto-audit 3rd reference
- [x] Sparse-clone `bitshares/bitshares-core` @ `develop` → `/workspace/reference/bitshares-core`
- [x] Record HEAD (`fe7000c`, 2026-09-15) — API-contract 4th reference (headers only, ~2 MB)
- [x] Clone `squidKid-deluxe/bitshares-dex-ux` @ `main` → `/workspace/reference/bitshares-dex-ux`
- [x] Record HEAD (`bad2545`, committed 2023-02-21, cloned 2026-09-28) — dashboard/style 5th reference (Python/Falcon, behavior-only; live shots in `vanilla/notes/dexux-ref/`)

### Phase 1 — Inventory (folded into slices — no separate inventory docs)

The standalone `routes.md` / `chain-calls.md` inventory was superseded: §6 is
the route table, and chain-call mapping runs per slice via
`mapping-chain-calls` (results accrue in parity notes, not a central matrix).
Standing findings so far: node list + faucet config from #3 (2026 endpoints,
probe-verified); `get_account_by_name` (not `get_account`) is the lookup
method; history api id resolves via login `"history"`; testnet faucet
`testnet-faucet.xbts.io` alive, `faucet.testnet.bitshares.eu` dead.

### Phase 2 — Design the vanilla skeleton (DONE via slices 1–3)

- `vanilla/index.html`, `css/{app,themes}.css`, `js/{store,chain,router,settings,
  crypto,wallet,account,format}-plus-views.js` — hash router (37 routes),
  working settings/node switcher, real wallet keystore, account views.
- Crypto vendoring decided + executed: `noble-secp256k1.js` byte-copy with
  provenance (`vanilla/js/vendor/PROVENANCE.md`); hand-rolled remainder
  credited per file. bitsharesjs policy: REFERENCE ONLY — consult upstream
  raw files on demand when porting serializers (see `mapping-chain-calls`
  skill, `BJS` source); never cloned, never installed, never imported.

Suggested tooling (save under `/workspace/tooling/`):

```
tooling/extract_routes.py        ← parse App.jsx <Route> → markdown table
tooling/extract_chain_calls.py   ← grep Apis/ChainStore/FetchChain → csv
tooling/audit_deps.py            ← parse package.json → stale/archived table
tooling/check_rot.py             ← THE ANTI-ROT GATE: fail if vanilla/ contains
                                    package.json / node_modules / lockfiles,
                                    framework imports (react/vue/svelte/angular),
                                    CDN <script src> / @import URLs, or any file
                                    the app needs but `python3 -m http.server`
                                    doesn't serve. Run before every "done" claim.
tooling/ws-probe.mjs             ← stdlib-only headless WS handshake (chain-id,
                                    head-block, generic groundwork for probes).
tooling/visual/shot.mjs         ← OPTIONAL visual-iteration aid (headless Chromium
                                    screenshots + console-error capture). Dev-only:
                                    never shipped, never required — the human
                                    browser pass stays the gate. Needs
                                    PLAYWRIGHT_BROWSERS_PATH=.browsers in that dir.
```
### Phase 3 — Vertical slices (one at a time, testnet-verified)

Binding order: `/workspace/SLICES.md`. Each slice: spec → implement →
testnet check → parity note. Do not start slice N+1 until slice N passes its
checklist. Parity = the §2 objectives paragraph (both references + responsiveness).

---

## 9. Quick Reference Commands

```bash
# Reference repo (read-only)
git -C /workspace/reference/bitshares-ui log --oneline -5
git -C /workspace/reference/bitshares-ui status --short
git -C /workspace/reference/astro-ui log --oneline -5
git -C /workspace/reference/astro-ui status --short
git -C /workspace/reference/wallet-extension log --oneline -5
git -C /workspace/reference/wallet-extension status --short

# Structure exploration (prefer read/grep tools; bash for counts only)
ls /workspace/reference/bitshares-ui/app/components/
wc -l /workspace/reference/bitshares-ui/app/App.jsx
grep -rn "get_required_fees" /workspace/reference/bitshares-ui/app --include=*.js* | head
ls /workspace/reference/astro-ui/src/pages/ | head
ls /workspace/reference/astro-ui/src/bts/

# Future vanilla app (static — no build)
python3 -m http.server 8080 --directory /workspace/vanilla
# → http://localhost:8080/
```

Key files to read first:

```
bitshares-ui/app/App.jsx                  ← routes (lines ~500-650)
bitshares-ui/app/routerTransition.js      ← navigation guards
bitshares-ui/app/branding.js              ← chain-id, faucet, wallet name
bitshares-ui/app/api/apiConfig.js         ← node endpoints
bitshares-ui/app/stores/SettingsStore.js  ← persisted settings shape
bitshares-ui/app/stores/WalletDb.js       ← keystore (most security-critical)
bitshares-ui/app/lib/common/trxHelper.js  ← fee logic (KNOWN STALE — see #3720)
bitshares-ui/app/lib/common/MarketClasses.js ← orderbook math (port carefully)
bitshares-ui/Dockerfile                   ← node:6 evidence
bitshares-ui/.travis.yml                  ← node16/trusty evidence
wallet-extension/src/lib/crypto-utils.js  ← zero-dep crypto (audit target #1)
wallet-extension/src/lib/bitshares-api.js ← WS client + node list + fee-fill
wallet-extension/src/popup/popup.js       ← 78-op confirm-dialog spec
bitshares-core/libraries/app/include/graphene/app/database_api.hpp ← WS method ground truth
bitshares-core/libraries/protocol/operations.hpp ← op field ground truth
```

---

## 10. Open Questions / Risks

1. **Crypto scope.** How much of `bitsharesjs` (`ecc`, `serializer`, `ws`) must
   be vendored? Smallest auditable subset? (Spike: list imports of `bitsharesjs`
   across `app/`.)
   Start from `astro-ui/src/bts/` — it is already isolated + modern. Diff vs
   `bitsharesjs ^6.0.3` used by #1 before vendoring anything.
   Strongest candidate: `wallet-extension/src/lib/crypto-utils.js` +
   `noble-secp256k1.js` (zero-dep, WebCrypto, tested) — audit that first.
2. **TradingView.** `charting_library/` is licensed/proprietary. Vanilla needs a
   from-scratch canvas depth/price chart. Do not copy TradingView code.
3. **Gateways.** Third-party deposit-address APIs (GDEX etc.) may be dead or
   changed. Treat each as an adapter; ship with "unavailable" states, not hacks.
4. **Fee estimation.** Old `trxHelper.estimateFee` is wrong for some ops — vanilla
   must call `get_required_fees` (per #3720).
5. **Faucet/registrar.** Account-creation faucet endpoints may have moved.
   Re-discover during wallet slice; don't hardcode 2022 URLs.
6. **Scope control.** 421 component files ≠ 421 pages. Many are dead/showcase
   (`Showcases/`, `Console/`). Phase 1 must mark dead code so we don't port it.
7. **Extension-wrapper adapter (DEFERRED — specified, not scheduled).**
   Page-origin XSS is the ceiling risk of any web wallet: any script running
   in the page origin can read `localStorage`/memory. An optional
   `extension-wrapper/` adapter would repackage this exact vanilla code as a
   browser extension (isolated origin, CSP `script-src 'self'`, provider-gated
   signing with per-site approval à la #3 / MetaMask) without changing a line
   of wallet logic. Explicitly OUT of v1 scope: the web app ships first and
   must never depend on the wrapper existing. Build it only after the vanilla
   app is complete, tested, and audited — it is hardening, not a feature.

---

## 11. Founding vision (original understanding, preserved verbatim)

Screenshot: `docs/founding-vision.png`. The following is the project's
original statement of intent, transcribed word-for-word. It predates the
ten guiding principles above — where they differ, the principles (§1–§3)
are binding and this section is history.

> We're going to build a replacement for the BitShares reference wallet —
> the thing you open today at wallet.bitshares.org — but written in plain
> HTML, JavaScript, and CSS with zero dependencies. No React, no build step,
> no npm install. You'll be able to serve the folder with any static server,
> or even open the file directly, point it at a BitShares API node, and use
> it. Keys never leave your machine; transactions are signed locally in the
> browser, same security model as the old wallet.
>
> Look: deliberately retro. A returning BitShares user should feel instantly
> at home — the same dashboard, the same account pages with balances and
> history, the same market view with order book and buy/sell panels, the same
> settings, voting, and explorer pages, in the same places with the same
> words. We're not redesigning anything visually; if anything, existing
> screenshots and help docs should still read true against our app. The one
> visible addition is a theme switcher: the classic BitShares original blue
> as default, plus a light theme and a dark theme.
>
> Feel: this is where we refuse to feel retro. Even though it looks like the
> old UI and runs on nothing but platform APIs, it should behave like good
> modern software — reactive rather than reload-y, so balances, order books,
> and connection status update live in place. Forgiving and fast search
> wherever you pick markets, accounts, or assets. Empty states that explain
> what's going on instead of blank panels. Inline validation on forms.
> Confirmation dialogs that show every transaction's fields in plain human
> language before you sign. And every number on screen shown the way a person
> expects it — 1.23456 BTS, not 123456; 20%, not 2000 — because the chain
> stores everything as raw integers and getting that conversion wrong is a
> silent money bug.
>
> Work: under the hood it's a tiny static app — a hash router, a small store,
> exactly one module that talks to chain nodes over WebSocket, and vendored
> crypto code copied into the repo (audited, with provenance noted) instead
> of depended on. Feature-wise it has to cover both UIs we've studied:
> everything the old wallet does, plus the long tail of operations from
> grctest's modern astro-ui — HTLC contracts, liquidity pools and staking,
> credit offers and deals, asset creation, proposals, tickets, airdrops,
> blind transfers, and the rest. We get there one vertical slice at a time —
> settings and node connection first, then wallet creation and unlock,
> account views, transfers, read-only market data, trading, and so on — and
> no slice counts as done until it's been verified against testnet: connect,
> read, sign, broadcast, observed for real.
>
> And the whole thing is shaped by one rule above all the others: it must
> never rot the way the current UI did. The old wallet died under the weight
> of React 16, a hundred stale packages, and a toolchain nobody can
> reproduce — issue #3583 asks for thousands of hours just to catch up, and
> we'd land right back there if we built on anything with a release cycle. So
> every decision gets judged by a simple test: if everyone walks away for ten
> years, does it still run in a browser? If the answer is yes, we ship it.

---

*Last updated: 2026-10-03. Reference HEADs: bitshares-ui `79f8cca` (develop), astro-ui `5037d61` (main), wallet-extension `ebb7451` (master), bitshares-core `fe7000c` (develop, sparse). Binding slice order: `/workspace/SLICES.md`. Next action: see SLICES.md.*
