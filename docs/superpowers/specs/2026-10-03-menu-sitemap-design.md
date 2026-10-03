# Headings Burger + Sitemap TOC Pages + Help Coverage — Design

Date: 2026-10-03. Status: APPROVED (owner pre-approved spec + full build, AFK loop).
Author: brainstorm with owner (approach A: headings burger → dedicated TOC card pages).
Scope: rework `vanilla/` nav only + help coverage. No chain calls, no crypto,
no serializer, no new transport. Static files only, zero runtime deps.

## 1. Goal

The burger stops being a 46-link dump and becomes a 6-heading sitemap:
each heading links to its own styled table-of-contents page, and burger +
TOC pages + help index together cover every route exactly once. Help gains
the 12 missing articles so every shipped feature is documented.

## 2. Decisions (from brainstorm)

- Burger holds ONLY 6 headings (icon + label + one-line blurb + page count),
  each a plain link to `#/menu/<slug>`, plus a `#/menu` overview entry.
  Removed from burger: live filter search (moves onto TOC pages where it has
  room), per-account follow/send/deposit shortcuts (move to the account page,
  where they are contextual), duplicate theme-switcher copy (header + settings
  remain). Lock/unlock already lives in the header and stays there.
  Rejected: accordion burger (same 50-link monster, no shareable URLs, bad on
  phones); reusing working pages as landings (confuses "where am I").
- TOC pages are NEW bookmarkable routes `#/menu` + `#/menu/:section`
  (one view module, DOM only). No modal, no framework, back button works.
- Single-home rule: every list route appears on exactly one TOC page.
  Detail routes (`/pools/:id`, `/asset/:symbol`, `/block/:height/:txIndex`,
  …) are never listed — parents link to them, as in #1.
- Help mirrors the sitemap: index regrouped under the same 6 headings, 12 new
  articles in the existing lite-markdown format + `help.topic_*` i18n pattern.
- Desktop header bar (`ORIGINAL_NAV` 5 links) is UNTOUCHED — this slice only
  reworks the burger directory panel and adds menu/help views.

## 3. Sitemap (binding — burger + TOC + help contract)

1. Wallet `#/menu/wallet` — `/`, `/account/me`, `/accounts`, `/transfer`,
   `/invoice`, `/vesting`, `/wallet`, `/wallet/password`,
   `/create-wallet-brainkey`, `/existing-account`, `/create-account`, `/login`,
   `/registration` (local/cloud folded), `/referrals`.
2. Trade `#/menu/trade` — `/market/BTS_USD`, `/instant-trade`, `/pools`,
   `/swap`, `/borrow`, `/barter`, `/deposit-withdraw`, `/samet`, `/spotlight`.
3. Earn & Protect `#/menu/earn` — `/credit-offer`, `/direct-debit`, `/htlc`,
   `/tickets`, `/airdrop`, `/authorities`, `/lists`.
4. Govern `#/menu/govern` — `/voting`, `/proposals`, `/create-worker`,
   `/prediction`.
5. Explore `#/menu/explore` — `/explorer`, `/assets`, `/assets/create`,
   `/assets/issue`, `/assets/feed`, `/fees`, `/ops`, `/top-ops`, `/news`.
6. Labs & Personal `#/menu/labs` — `/api-lab`, `/es-lab`, `/txbuilder`,
   `/trollbox`, `/favourites`, `/alerts`, `/help`, `/settings`.

`#/menu` overview lists all 6 sections with counts + global search.

## 4. Burger behavior

- `#nav` keeps the 5-link bar; the `#nav-directory` panel renders 6 heading
  links + one "All pages" (`#/menu`) link. No `<input>`, no buttons, no
  per-route links inside the burger.
- Click a heading → hashchange navigates → existing `hashchange` handler
  closes the panel (no new close logic). Esc + focus-return behavior unchanged.
- `buildAccountActions`, directory search filter, and empty-note DOM are
  DELETED (dead code per §3.7, not commented out). `NAV_GROUPS` is replaced
  by a `MENU_SECTIONS` table shared with the menu view (single source).
- Contacts/follow helpers (`loadContacts`/`saveContacts`/`hashAccount`) move
  to the account view module that actually uses them, or delete if unused
  (verify callers first).
- Single source: the section/link table lives in `menu-ui.js` as
  `MenuUI.SECTIONS` (global, guarded); `app.js` consumes it when present and
  falls back to a 6-heading label-only list when absent (e.g. script-load
  failure) — the burger never blanks.

## 5. TOC page styling

- Card grid: 1 column at 360px, 2 at ≥720px, 3 at ≥1200px. Cards are plain
  `<a>` (full-card link, ≥44px targets, keyboard-focusable, visible focus
  ring). Each card: vendored icon (existing `Icon.img` names only, no new
  assets), title, one-line blurb, no raw integers anywhere (counts are page
  counts, not chain data — #6 trivially holds).
- Section page: breadcrumb (`Menu / <Section>`), heading, in-page filter
  `<input type="search">` (substring over title+blurb+href, same no-lib
  pattern as the old directory filter), card grid, empty-note.
  Overview page: 6 section cards + global filter over all pages.
- Unknown `#/menu/:section` slug → honest miss with link back to `#/menu`
  (same pattern as help unknown-topic).
- Styling is class-driven in `app.css` + theme tokens only
  (`--panel/--text/--border/--accent` + banner tokens); all three themes must
  render (screenshot trio). `prefers-reduced-motion` respected (no candy on
  these pages — plain fade-free render).
- i18n: titles/blurbs resolve via `I18n.t` with verbatim English defaults
  (slice-17 batch pattern); new keys added to `en.json` full + 9 stub dicts.

## 6. Help coverage (12 new articles)

New topics (key, route pointer): `samet` (#/samet), `barter` (#/barter),
`spotlight` (#/spotlight), `direct-debit` (#/direct-debit), `api-lab`
(#/api-lab), `es-lab` (#/es-lab), `charts` (indicators/candles/LWC panes →
#/market/BTS_USD), `dashboard` (Option-B splash vs unlocked dashboard → #/),
`register` (faucet create-account flow → #/create-account), `password`
(#/wallet/password), `news` (#/news), `uris` (BitShares URIs + CSV export →
#/invoice). Each: TOPICS row + BODY_DEFAULTS article (existing format),
  en full bodies, other locales fall back to English via existing `t()`.
- Index regroup: same 6 headings as the sitemap (section subheads over the
  existing `<ul>`, no link changes). `ops` article pointer stays `#/top-ops`
  with a line naming both desks; `history-index` gains one paragraph pointing
  at `#/es-lab`.

## 7. Architecture (files)

- Modify: `vanilla/js/app.js` (NAV_GROUPS → MENU_SECTIONS, burger builder
  slim-down; ~200 lines deleted net), `vanilla/js/router.js` (2 routes),
  `vanilla/index.html` (1 script tag), `vanilla/css/app.css` (menu card
  classes), `vanilla/locales/en.json` + 9 stubs (menu + help keys),
  `vanilla/js/views/help-ui.js` (12 topics + bodies + regrouped index).
- Create: `vanilla/js/views/menu-ui.js` (MenuUI.renderMenu/renderSection +
  `MenuUI.SECTIONS` data table; consumes Icon + I18n only; no chain, no Format).
- No changes to: chain.js, tx.js, format.js, store.js, any builder/api file.

## 8. Doctrine exception (AGENTS.md §4.5)

None required. No dependency, no transport, no build step, no hosted asset.
(a) 2036 test: plain DOM + hash links + CSS grid — runs anywhere.
(b) Newly depended on: nothing.
(c) Smallest deletable subset: the overview page (`#/menu`) could go (section
pages stand alone); kept because it is the sitemap front door. The burger
deletes ~200 lines net — this slice shrinks the app.

## 9. Verification

- `tooling/check_rot.py` green, `bash tooling/check_types.sh` green.
- Node smoke: `node -e` require of menu-ui.js data table (section count 6,
  every router list-route covered exactly once — assert in test).
- Browser pass (tester): burger shows 6 headings at 360px + 1440px; each
  heading → section page; filter narrows cards; theme trio screenshots;
  help index shows 6 groups, 12 new articles render; desktop bar unchanged.
- Parity note `vanilla/notes/menu-sitemap.md` (behavior-only slice: no chain
  vectors — field 4 records "no chain numbers on these pages" + page-count
  arithmetic check; fields 1–3, 5–7 per contract).
