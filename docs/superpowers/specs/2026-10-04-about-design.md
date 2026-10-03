# About Page (marketing-layered philosophy) — Design

Date: 2026-10-04. Status: APPROVED (owner, one-click).
Audience: both, layered (owner call) — marketing hero up top, philosophy
deep-dive below. Scope: one static page + wiring. No chain calls, no wallet,
no crypto. Process note: build list below IS the plan (owner-approved direct).

## 1. Goal

A bookmarkable `#/about` page that sells the wallet honestly: what it is,
why it's built this way, what it won't pretend. §3.8 bounds are binding —
no fabricated stats, volumes, or counts; the only live things on the page
are links TO live pages.

## 2. Content (7 blocks, marketing voice, repo-true)

1. Hero: "BitShares, in your browser. Nothing to install." + lede
   (self-custody, real on-chain markets) + CTAs (Open the exchange, Read the guides).
2. Your keys never leave this browser (local vault, local signing).
3. A real exchange, not a screenshot (on-chain books, pools, swaps, credit).
4. Built to outlive its builders (never-rot: no framework, no dependencies,
   no build step; the 2036 test in one line).
5. Familiar, but alive (retro parity + modern reactivity, search, themes).
6. Numbers you can trust (human amounts, live fee previews, no raw integers).
7. Honest limits (gateways are custodians; community index is third-party;
   testnet gaps; no in-app news feed) + links row (Help, Community, source).

## 3. Build list

1. `vanilla/js/views/about-ui.js` (new): `AboutUI.renderAbout`, static DOM,
   textContent-only, `about.*` keys with verbatim defaults. No imports beyond
   guarded I18n.
2. `vanilla/js/router.js`: `/about` (title "About", placeholder fallback).
3. `vanilla/index.html`: script tag + footer ABOUT link (`appfoot-actions`).
4. `vanilla/js/app.js`: `paintFootActions` paints ABOUT (comment updated).
5. `vanilla/js/views/menu-ui.js`: Labs += About card (icon `info-circle-o`,
   53 links); SECTIONS comment updated.
6. `tooling/menu-test.js`: 52→53 + `#/about` spot-check.
7. `tooling/apply_i18n_menu_batch.py`: sweep `about.*` (all keys owned by
   this batch); run batch; `check_i18n.py` green.
8. Gates + shots (1440 + 390 + theme) + parity note `vanilla/notes/about.md`.

## 4. Doctrine (§4.5)

No exception: static page, zero deps, zero failure modes — it renders with
the node down, which IS the pitch. Deletable subset: blocks 5–6 could go;
kept because layered depth was the approved audience call.

## Self-review

No placeholders; ambiguity check: "marketing-oriented" is bounded by §3.8
(explicit block 7 lists what we won't claim). Single-home rule holds
(About listed once, in Labs). Footer fits 3 links (verified in shot).
