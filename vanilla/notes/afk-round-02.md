# AFK Round 2 record — Settings history pills + ES switch + account filter UI

## Director — Phase 3 settings (`settings-nodes.js`, `settings.js`, `settings-prefs.js`)
- History pill: second span in Status cell (table) + card (phone), painted by
  `paintHistory` from `HistoryCap.nodeHistory` (snapshot at build, live after
  every probe — `probeAll` records `HistoryCap.update` on hit AND mismatch,
  repaints on failure so stale live pills never linger). `histInfo` pure +
  `_test`-exported (7 vectors). Separator owned by layout (" (History)").
- Decision logged: head-age promotion into row content DEFERRED (would need
  unkeyed English literals; tooltip already carries age/part/lag/prefix).
  Pill is the new visible signal; tooltip unchanged.
- ES block (`SettingsPrefs.buildHistory`, wired in settings.js between
  discovery list and theme): h2 + checkbox (seeded from envelope, default
  ON) + third-party note (t.me/bitsharesDEV). Change persists only — views
  read `esAllowed()` live, no reconnect/re-render.
- Testnet banner (testnet only, p.muted + aria-live): node history works,
  community index is mainnet-only. Sweep-cited, not assumed.
- 6 keys × 10 dicts via committed `tooling/i18n_add_keys.py` (self-healing
  rerun: position-preserving value sync; em-dash drift caught by check_i18n
  and fixed at the script, not the dicts). No new CSS (muted/h2/checkbox
  native; 44px floor inline on the toggle).
- Shots (zero console errors): `#/settings` @1440 (7/7 pills live from
  startup probe) + @390 + tall-2200 (ES block checked-ON + note + theme +
  locale); `#/account/committee-account` + HISTORY click via new
  `shot.mjs --click` flag (filter select + live rows). Post-shot fix: pill
  separator space (shot-read, not assumed).

## Worker — Phase 4c UI (`account-ui.js` only, keys reused, zero minted)
- Filter select (All=`market.kind_all`, Transfers=`transfer.title`→[0],
  Fills=`account.op_fill`→[4]) above history; `loadHist(mode)` reuses the
  existing row pipeline + showError (Round-1 Settings link free).
- Decision: Slice-16 watcher runs on "all" only (filtered first-ids must not
  reset the global baseline). Missing-`opsFiltered` guard → history-
  unavailable (never blank). node --check OK; headless proof above.

## Gates
types PASS · rot PASS · i18n OK (3088 keys, 3966 sites drift-free) ·
node-health 52/52 · all Round-1 suites re-green (no regressions).
Money: none touched. Themes: token/native elements only.
Anti-rot: (a) platform only; (b) nothing new (2 helpers + 1 builder + 1 block);
(c) deletable: pills (status stands), ES block (envelope reads ON), filter
(all-mode is the old path) — kept: the reconciliation hub the plan requires.
