# Merged network table design — 2026-10-04

## Context

The #/settings network switcher (`SettingsPrefs.buildNetwork`,
`vanilla/js/settings-prefs.js:26-43`) is two bare inline radio labels with
zero CSS (`#net-toggle` has no rules): 18px native boxes, text-height rows,
side by side. Cramped, and under the 44px touch floor (principle #7).

An earlier status-card direction (two cards, live vs last-known state) was
considered and REJECTED in favor of this design: cards plus a table are two
widgets that must agree about "current network" forever. One merged table
that owns switching has nothing to keep in sync.

## Decisions (user-approved)

- Merge ALL nodes (mainnet defaults + testnet defaults + customs) into the
  one node table with a new NETWORK column.
- Color rule: chain prefix other than mainnet `4018d784…` renders yellow;
  `4018` keeps the existing green treatment; DOWN/TIMEOUT rows keep
  existing red/grey. Keyed off observed chain-id, never list membership —
  so custom nodes on odd chains are flagged too.
- Row selection owns network switching. The radio toggle is DELETED
  (`buildNetwork`, its `settings.js` change handler, and references).

## Rows and NETWORK column

- Order: mainnet defaults (existing order), then testnet defaults
  (existing order), then customs (existing order). No group headers, no
  re-sorting — `probeAll` order and latency-sort behavior untouched.
- NETWORK cell content:
  - Defaults: MAINNET / TESTNET from list membership, shown immediately
    (no probe needed to know which list a default came from).
  - Customs: `—` (`settings.dash`) until probed, then MAINNET / TESTNET /
    short chain-hash (first 4 chars, the existing row convention
    `prefix.slice(0, 4)`) from the observed chain-id.
- The old WRONG-CHAIN mismatch pill retires for customs (no "wrong" chain
  there, only labeled ones) but STAYS for defaults answering a foreign
  chain (stale DNS, repurposed node — still red, still unselectable-worthy).
  `healthFor("chain", …)` keeps its bands for the cell coloring
  (mainnet-match green, testnet-match yellow, mismatch red).
- `.node-card` mirrors gain the network cell via the existing mirror
  pattern in the `setRow`/paint path. Mobile behavior otherwise untouched.

## Selection = switching

- Row tap sets BOTH `activeNode` and `network`: from the list for
  defaults, from the observed chain-id for probed customs.
- Never-probed custom selected: probe it first (one `Chain.probe`, the tap
  is user consent), apply node + network on success; on failure, apply
  node-only (network unchanged) and let the existing `App.connect()`
  chain-id pin verify — a wrong chain disconnects with the footer mismatch
  message, a dead node surfaces via the footer/offline panel.
- The existing chain-id pin in `App.connect()` stays as the backstop and
  should now almost never fire.
- Footer (`MAINNET -`/`TESTNET -` prefix) and reconnect already follow
  `Store.network` reactively — no changes there.
- No confirm dialog on switch (matches current behavior; a full table row
  is a deliberate tap).

## Probing

- `probeAll` runs unchanged over the wider row set (~9 rows sequential,
  slower worst case). Still user-initiated via the existing button only —
  never auto-probe on page open (parallel probes race the shared socket).
- Inactive-network rows show last probe truth (persisted samples) until
  re-probed; unprobed cells show dashes. Stale is labeled by age where the
  existing `lastGood`/`agoMinutes` lines already do so, never shown as live.

## Styling

- One new column; no layout restructure. NETWORK pill reuses the
  `[data-h]` color tokens (`--live` / `--warn-text` text, `--warn` graphic
  accents per the themes.css contracts). Tokens only — all three themes
  follow with no per-theme rules.
- Touch targets grow as a side effect: rows are already full-width tap
  targets via the existing select buttons; verify ≥44px holds with the
  extra column at 360px width.

## i18n

- Exactly ONE new key: the column header (`settings.th_network`).
  MAINNET/TESTNET reuse `settings.network_mainnet`/`network_testnet`,
  matched to surrounding cell casing. Chain hashes, dashes, and ages are
  verbatim values, never translated. English first, 11 honest English
  stubs, `tooling/check_i18n.py` green.

## Verification

- `node` unit vectors for the network-derivation + select logic (new pure
  helpers, stdlib test in `tooling/` per convention), `bash
  tooling/check_types.sh`, `python3 tooling/check_i18n.py`,
  `tooling/check_rot.py` green.
- Manual matrix on testnet+mainnet: switch mainnet→testnet→mainnet via
  rows (footer prefix + reconnect observed), unprobed-custom select
  probes first, Probe All covers all rows, mismatch pin stays silent on
  correct selections, 360px + 1440px, three themes.
- Read-only change needs no testnet sign/broadcast; chain safety comes
  from the untouched connect pin.

## Anti-rot answers (§4.5 gate)

- (a) Ten years untouched: a static table with two node lists and one
  probe button; no third party in the render path.
- (b) New dependency: none. One column, reused probe/health/i18n
  machinery, one deleted widget.
- (c) Smallest deletable subset: the NETWORK column itself — without it
  the merged table still switches correctly. Kept because labeling is
  the requested feature (and the safety case for customs).
