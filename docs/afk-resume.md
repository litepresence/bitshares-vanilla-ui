# AFK resume state (written pre-compaction, 2026-09-27)

User is AFK for the night. Standing orders: march down SLICES.md (slice 7 → 8 → …);
tester browser passes queue in parity notes; secrets never in chat; no idle stops
(afk-keep-rolling tail item must be re-added to the todo list FIRST if todos reset).

## Post-compaction re-read order (mandatory before any other action)
1. `AGENTS.md` (mission control — 8 principles, doctrine §4.5, references §5, rules §7).
2. `SLICES.md` (binding build order + standing facts).
3. `docs/afk-resume.md` (this file — state + nuance below).
4. `workspace/skills/*` (the skill matching the task at hand).
5. The active slice plan in `docs/superpowers/plans/` + its parity note in `vanilla/notes/`.

## Conversation nuance (not written anywhere else — do not lose this)
- User style: terse directives ("build it", "5 go"), answers scoping questions fast,
  pushes back hard on weak reasoning (bitsharesjs debate, TradingView pricing) and
  accepts honest better answers. Bedtime/AFK pattern with token refreshes; a separate
  human unit tester does browser passes and needs VERBOSE click-by-click instructions
  (slice-01 A–E style) — terse checkboxes confuse them.
- Momentum beats ceremony, but skills are mandatory (brainstorm→plan→execute,
  audits, mapping). User overrides stand: canvas→lightweight-charts pivot was EARNED
  with priced evidence, not granted lightly. Same bar for any future dependency ask.
- Diagnostic discipline that works here: verify on disk (never trust subagent
  reports), independent reimplementation cross-checks (not shared code), headless
  screenshots READ by self (not just captured), balance-reconciliation to the raw
  integer, STOP-and-report beats guessing (several workers correctly stopped — praise it).
- Operational scars: NEVER `pkill -f` with a pattern present in your own command line
  (kills your shell); ALWAYS set bash `workdir` per command purpose (root vs
  tooling/visual mixups burned multiple turns); `/tmp` is VOLATILE across sessions
  (rebuild throwaways from parity notes); `npm` here is a pnpm shim (use pnpm syntax);
  the http server (port 8081) dies between sessions — restart with setsid+disown.
- Judgment calls already made (don't relitigate without new evidence): fee in
  transfer asset; no fabricated txids; remainder-on-last-order; SLIP-48 rejected;
  extension-wrapper deferred post-v1; bitsharesjs reference-only; QTradeX math-only;
  TradingView rejected (proprietary+m
irror); testnet fixture brainkey → IGNORE (keys work regardless);
  F2 overlap unreproduced (tester to confirm/close); 1167-line trade-ui.js +
  617-line market-ui.js split notes live with the readability pass.
- Test-money discipline: TINY off-market amounts only, cancel everything placed,
  check history before ANY retry (double-spend risk), testnet asserted in scripts,
  fixture read via file 600-perms and NEVER printed.

## Immediate next: slice 7 Task 4b retry (was rate-limited, work NOT started)
Dispatch ONE general subagent (must first read workspace/skills/building-vanilla-slices/SKILL.md):
rework the single shared oscillator sub-pane into STACKED SUB-PANES + volume —
multi-checkboxes RSI/MACD/Stoch/ATR/Fisher/Volume, each its OWN sub-pane with
independent scale, each removable, canvas fallback per pane. Touch ONLY
vanilla/js/market-charts.js + vanilla/js/market-ui.js. node --check both.
Full spec: docs/superpowers/plans/2026-09-26-slice-07-indicators.md Task 4 section
as amended ("Task 4b" paragraph). Then Task 6 verify worker per the same plan.

## After slice 7: slice 8 (voting/governance) — brainstorm → plan → build per skills.

## Key facts (do NOT re-derive; all verified)
- Testnet: wss://testnet.xbts.io/ws (chain 39f5e2ed). Faucet ALIVE: testnet-faucet.xbts.io
  (NOT faucet.testnet.bitshares.eu — dead). Fixture: tooling/testnet-lite-test-1.json
  (600, git-ignored) — lite-test-1 1.2.26833, ~996 TEST; brainkey provenance OPEN, ignore.
- marketID = QUOTE_BASE; displayed price = base-per-quote human; book levels arrive
  as chain-human strings (display verbatim); BigInt path for fills/candles/fees.
- No float money math anywhere (audit greps). SLIP-48/BIP forbidden in vanilla/.
- Vendored: noble (byte-copy + classic wrapper), lightweight-charts 5.2.1 Apache-2.0,
  49,744-word dict, 459 image files, 93-var palette. All with provenance notes.
- Headless loop: python3 -m http.server 8081 --directory vanilla + tooling/visual/shot.mjs
  (PLAYWRIGHT_BROWSERS_PATH=.browsers); read every PNG yourself; record in parity notes.
- /tmp is VOLATILE across sessions (rewrites: ws-probe.mjs pattern lives in tooling/;
  /tmp/query.mjs, /tmp/*-check.js scripts may be gone — rebuild from parity notes).
- Standing user directives: reads public without login (only signing gates); raw-JSON
  triangle disclosures everywhere (triangle-only, copyable, never secrets); dark theme
  follows DEX-UX values; QTradeX math approved, never the dependency; TradingView rejected;
  extension-wrapper deferred post-v1; bitsharesjs is reference-only.
- Git repo initialized (commit 2a02991); commit per round; NEVER commit references,
  secrets, node_modules, .browsers, /tmp fixtures.
- Open owner questions: NONE pending (brainkey → ignore; faucet → resolved).
