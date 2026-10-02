# Slice 17 parity note — i18n foundations

Plan: `docs/superpowers/plans/2026-09-28-slice-17-i18n.md` (Tasks 1–3).
Testnet N/A by construction (zero chain calls — `tx.js`/`chain.js` diffs empty).
English-first: no rewording, call-site defaults ARE the guarantee.

## What landed (vanilla file:line)
- `vanilla/js/i18n.js` (198) — dict registry, `t(key, enDefault, vars?)`
  (locale→en→default→key-id, never blank), allowlist gate, `%(name)s`
  interpolation, `I18n.date/num` Intl wrappers, `{v:1}` cache, Store-envelope
  pref (`storedLocale` + write-back; standalone key fallback).
- `vanilla/locales/*.json` — 10 dicts, 121 keys each: en full; es 32 batch-1
  translated (per-key provenance, #1 + #2 cross-checked, 4 candidates rejected
  with reasons); 8 stubs key-complete English + `_meta.untranslated`.
- `vanilla/js/settings.js` — locale `<select>` (theme-selector mirror, stub
  suffixes, offline toast + snap-back) + 26 batch-1 `t()` swaps with canonical
  `data-status` ids; `app.js` `localizeShell()` + boot `loadCached()`; `router.js`
  shell-chrome swaps; `htlc.js:405` → `I18n.date` (output-neutral in en).
- `vanilla/js/store.js` — `locale` in base/load/save + `storedLocale()`.
- Tooling: `extract_i18n_keys.py`, `build_locale_dicts.py`, `check_i18n.py`
  (drift gate), `prove_i18n_task2.mjs` (headless proof).
- Route: `#/settings` hosts the switcher (no new route); tag `index.html`.

## Reference behavior (file:line)
- #1 measured: en 2709 > de=es=ru=zh 2708 > fr=it=ja=ko=tr 2704 leaves, 60
  sections. es chosen: full in #1 AND only candidate in #2's dicts (zh has none).
- #2 per-component dicts REJECTED (no component scope in plain scripts — one
  global dict, #1-style sections). Codemod rejected (unreviewable) — incremental
  batches, batch ledger below.
- Deviation from #1: browser-locale default OFF... n/a — locale defaults en,
  permission never auto-anything (no request involved).

## Fixes by director (post-verify)
- Store-envelope migration (plan architecture, T2 skipped): envelope wins,
  legacy imports, theme preserves — 4-case matrix proven through real files.
- Stale comments refreshed (migration "queued" ×2).
- Cap trim 218→198 (comment condensing + setLocale branch merge, equivalence
  vector-proven: fast paths, bad-locale, fetch, repeat, switch, fallback).

## Test vectors (real files)
- Drift gate OK (121 keys, allowlists exact, 43 sites drift-free).
- English-identical: 8 sampled defaults verbatim vs HEAD; headless DOM diff
  16/16 (nav/brand byte-identical, settings added-only locale row).
- Fallback walk: es-hit `nav.dashboard→Tablero`; non-batch →en; unknown+default
  →default; unknown→key-id; interpolation + missing-var warn; bad-locale;
  fetch-fail unchanged; corrupt cache dropped + refetched.
- es mode: full Spanish shell/settings, identifiers untranslated, no key-ids;
  de stub falls back; rapid en↔es no staleness.
- `I18n.num(1234567)→1,234,567`; date byte-identical to old undefined-locale call.

## Batch ledger (per-view conversion queue — everything else hardcoded = identical)
- DONE batch 1: shell nav + settings (+ htlc.js:405 date).
- QUEUED: transfer, account, market/desk, trade, vote, explorer, assets, HTLC/
  debit, pools/swap, credit/samet/borrow/barter, proposals/tickets/misc,
  gateways, notify/alerts. Each batch: t() swaps + drift gate + en-identical shots.
- QUEUED: 8 full translations (key-complete stubs until then), flags, plurals.

## Manual test (headless, no chain, zero console errors)
- `#/settings` @1440 blue/dark + es-mode + @390: locale row, Spanish render,
  offline toast + snap-back, card layout, no overflow.

## Tester pass (queued)
- Switch to es → walk 3 views → back to en; offline fetch-abort; 390; trio.

## Anti-rot gate (§4.5): (a) yes — static JSON + one dependency-free module,
`Intl` is platform; (b) nothing new depended on (fetch is platform);
(c) smallest deletable: 8 stub dicts (en+es stand). `check_rot.py` PASS.

## Delta 2026-10-02 — help goes multilingual + 48 topics (day-1 feedback)
Help articles were English string literals with an English-only note (the one
place the app apologized for itself). Now: 47 topics + glossary (24 new:
pools, swap, HTLC, credit, trollbox, alerts, settings/nodes, top-ops,
txbuilder, prediction, PMO, transfer, instant, authorities, vesting, lists,
airdrop, invoice, proposals, tickets, fees, referrals, favourites, tour),
every article a keyed lite-markdown block (`# ` headings, `- ` bullets,
textContent-only render — no HTML anywhere), titles/guides/bodies in all 10
dicts (en complete; 9 stubs en-identical per convention — real translations
are translator work, tracked, not pretended). Index drops the old-UI
comparisons and the English-only note; adds Documentation (docs.bitshares.org,
docs.bitshares.dev, new-tab noopener) and AI Assisted Help (deepwiki mirror
link). Design constraint found live: I18n.t lookup() returns strings only,
so array defaults fall through to the raw key id (caught headless) — dicts
store joined strings, code defaults join the same way. Headless: index (48
links, docs + AI sections), article render (headings/paragraphs), es locale
(chrome translates, article stubs honestly English), zero console errors.

## Delta 2026-10-02 — help link directory (owner: homepage/code/explorers/forum/chats)
Community sections on the help index (Homepage, Code ×3, Explorers ×3,
Forum, English Chat ×5, Chinese Chat) as a data-driven keyed block, same
external-link treatment (new tab + noopener, textContent-only). 20 keys × 10
dicts. Headless: all sections + links render, zero console errors.
