**Superseded by SLICES.md** (current build status); this doc frozen at 2026-10-01.

# Ship-day state (rewritten 2026-10-01 — supersedes the 2026-09-27 AFK note)

Project: `bitshares-vanilla-ui` (repo name; shipped code lives in `vanilla/`).
Standing orders: SLICES.md Owner rulings 2026-10-01 are binding; tester
browser passes queue in `docs/tester-manual.md`; secrets never in chat or
commits; `reference/` is read-only and never ships (re-clone per AGENTS.md).

## Where we stand

- Slices 1–17 built + audited `DONE-WITH-BROWSER-ITEMS`; slice-18
  readability splits landed; op-coverage MISSING 0 (`vanilla/notes/op-coverage-matrix.md`).
- Ship-day builds in flight: wallet-security perfection (R1a), on-chain
  trollbox, chain-scan ranked ops, dead-browser notice, live-MPA settlement
  estimate, collateral ratio, open-settlement tab, per-theme banner tokens.
- Deferred + documented: blind transfers, `.bin`/cloud login, QR, op-35
  generic builder, escrow broadcast, scammer registry, explorer activity
  joins, gateway history, news feed, issue reporter, forum mirror, LTM
  inclusion (serializers-done suffices), faucet work.
- Extension-wrapper Tier-1 human drill gates v1; Tier-2 follow-up.
- Footer version stamp: `v1.0.0` (`vanilla/index.html:33`, `vanilla/js/app.js`
  `paintVersion`). No git remote configured yet — owner adds `origin` to ship.

## Post-compaction re-read order (mandatory before any other action)

1. `AGENTS.md` (mission control — naming, doctrine §4.5, references §5, rules §7).
2. `SLICES.md` (binding build order + Owner rulings 2026-10-01).
3. `docs/tester-manual.md` (human-gate coverage).
4. `vanilla/notes/op-coverage-matrix.md` (scope truth).
5. `workspace/skills/*` (the skill matching the task at hand).
6. The active plan in `docs/superpowers/plans/` + its parity note in `vanilla/notes/`.

## Conversation nuance (not written anywhere else — do not lose this)

- User style: terse directives, answers scoping questions fast, pushes back
  hard on weak reasoning, accepts honest better answers. A separate human
  unit tester does browser passes and needs VERBOSE click-by-click
  instructions (slice-01 A–E style) — terse checkboxes confuse them.
- Momentum beats ceremony, but skills are mandatory (brainstorm→plan→
  execute, audits, mapping). User overrides stand: canvas→
  lightweight-charts pivot was EARNED with priced evidence. Theme
  provenance calls (Crypo = dark source) and chain-only ranked ops were
  earned the same way. Same bar for any future dependency ask.
- Diagnostic discipline: verify on disk (never trust subagent reports),
  independent reimplementation cross-checks, headless screenshots READ by
  self, balance-reconciliation to the raw integer, STOP-and-report beats
  guessing.
- Operational scars: NEVER `pkill -f` with a pattern present in your own
  command line; ALWAYS set bash `workdir` per command purpose;
  `/tmp` VOLATILE across sessions; `npm` here is a pnpm shim; the http
  server (port 8081) dies between sessions — restart with setsid+disown.
- Judgment calls already made (don't relitigate without new evidence):
  fee in transfer asset; no fabricated txids; remainder-on-last-order;
  SLIP-48 rejected; bitsharesjs reference-only; QTradeX math-only;
  TradingView rejected; testnet fixture brainkey → IGNORE; op-35 stays
  undispatched for generic payloads (trollbox 9198/9199 sub-ids excepted);
  ranked ops = bounded chain-scan (astro's ES endpoint refused per doctrine);
  dead-browser = feature detection (no UA sniff, no Chrome upsell);
  settlement estimate follows #1's offset formula (#4 op comment agrees);
  collateral warn band = #1's mcr+0.5; fee asset `1.3.0` default;
  footer version `v1.0.0`; `build/` gitignored.
- Test-money discipline: TINY off-market amounts only, cancel everything
  placed, check history before ANY retry, testnet asserted in scripts,
  fixture read via file 600-perms and NEVER printed.

## Key facts (do NOT re-derive; all verified)

- Testnet: wss://testnet.xbts.io/ws + wss://testnet.dex.trading/ (chain
  39f5e2ed). Faucet: testnet-faucet.xbts.io (flaky, rate-limited — no v1
  work waits on it). Fixture: tooling/testnet-lite-test-1.json (600,
  git-ignored) — lite-test-1 1.2.26833.
- marketID = QUOTE_BASE; displayed price = base-per-quote human; book
  levels arrive as chain-human strings (display verbatim); BigInt path for
  fills/candles/fees. No float money math anywhere (audit greps).
- Vendored: noble (byte-copy + classic wrapper), lightweight-charts 5.2.1
  Apache-2.0, 49,744-word dict, 459 image files, 93-var palette. All with
  provenance notes.
- Headless loop: python3 -m http.server 8081 --directory vanilla +
  tooling/visual/shot.mjs (PLAYWRIGHT_BROWSERS_PATH=.browsers); read every
  PNG yourself; record in parity notes.
- Custom-ops chat: op 35, TROLLBOX 9199 / FORUM 9198, reads via
  `custom_operations_api get_storage_info` (#4 `api.hpp:650-688`); plugin
  probe `trollbox-meta`; writes need standard broadcast + get_required_fees.
- Settle reads: `get_settle_orders(assetId, limit≤300)` (#4
  `database_api.hpp:558`); NO by_asset variant exists; by_account variant
  unused by both UIs' market paths.
- Git repo: commit per round; NEVER commit references, secrets,
  node_modules, .browsers, /tmp fixtures, build/. No remote yet.
- Open owner questions: NONE pending (all R1–R8 + themes ruled 2026-10-01).
