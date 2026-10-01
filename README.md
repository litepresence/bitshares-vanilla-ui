# bitshares-vanilla-ui

A plug-and-play replacement for the BitShares reference wallet
(`wallet.bitshares.org`), written in plain HTML + JavaScript + CSS with
**zero runtime dependencies**. No React, no bundler, no `npm install` to
run it — serve the `vanilla/` folder statically (or even open the file),
point it at a BitShares API node, and use the wallet. Keys never leave
your machine; transactions are signed locally in the browser.

## Quickstart

```bash
python3 -m http.server 8080 --directory vanilla
# → http://localhost:8080/
```

Pick a node in Settings (mainnet + testnet defaults, latency-sorted),
create or import a brainkey wallet, and browse any account with no login —
the password is asked only at signing.

## Layout

```
vanilla/            ← THE APP (static; this is what ships)
  index.html
  css/              ← app.css + themes.css (3 themes via data-theme)
  js/               ← hash router, store, chain client, views, vendored crypto
  assets/           ← vendored icons/logos/flags (see PROVENANCE.md)
  locales/          ← 10 language dicts (en full)
  notes/            ← per-slice parity notes + op-coverage matrix
tooling/            ← dev-only audit/probe/test scripts (never shipped)
docs/               ← plans, tester manual, proposals
skills/             ← repeatable agentic workflows
extension-wrapper/  ← optional browser-extension repackaging (Tier 1)
reference/          ← READ-ONLY upstream checkouts (NEVER shipped; see below)
```

## References (re-clone fresh — not in this repo)

`reference/` and the root symlinks (`bitshares-ui`, `astro-ui`,
`wallet-extension`, `bitshares-core`) are gitignored and never committed.
A fresh dev clone re-creates them, then works read-only:

```bash
git clone --branch develop https://github.com/bitshares/bitshares-ui.git reference/bitshares-ui
git clone --branch main https://github.com/BTS-CM/astro-ui.git reference/astro-ui
git clone --branch master https://github.com/pi314x/bitshares-wallet-browser-extension.git reference/wallet-extension
git clone --branch develop --filter=blob:none --sparse https://github.com/bitshares/bitshares-core.git reference/bitshares-core
git -C reference/bitshares-core sparse-checkout set libraries/app/include libraries/protocol libraries/chain/include libraries/wallet/include
git clone --branch main https://github.com/squidKid-deluxe/bitshares-dex-ux.git reference/bitshares-dex-ux
# Crypo designer template (dark-theme HEX source): extract your copy at reference/crypo/crypo/Crypo/
```

Never edit through `reference/` or the symlinks — copy files to `/tmp` to
experiment. Vendored code in `vanilla/` carries per-file provenance.

## Themes

Three built-ins (`themes.css`, `data-theme` switch, persisted):
- **default theme / ref-ui-theme** — classic BitShares look (default)
- **vanilla-theme / vanilla-ui-theme** — light, from a vanilla-tub photo
- **dex-ux-theme / crypo theme** — dark, from the Crypo template (id kept for stored prefs)

## Doctrine

One rule above all: **never rot the way the old UI did** (upstream issue
`bitshares/bitshares-ui#3583`). Zero runtime deps, platform APIs only,
vendored-never-depended crypto, no build step to run. Every change answers
the 2036 test in `AGENTS.md` §4.5. `AGENTS.md` is mission control —
agents read it first; `SLICES.md` is the binding build order.

## Status

Slices 1–17 built + testnet-verified; see `SLICES.md` and
`vanilla/notes/op-coverage-matrix.md` (zero unjustified gaps).
`docs/tester-manual.md` is the human-gate checklist.
Footer stamp: `v1.0.0`.
