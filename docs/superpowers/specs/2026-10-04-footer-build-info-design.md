# Footer build-info design — 2026-10-04

## Context

Footer-left currently renders `BITSHARES {chainId8} • v1.0.0 • Disclaimer`
(static skeleton in `vanilla/index.html:51`, live repaint in
`vanilla/js/app.js` `paintVersion()`). Request: show
`BITSHARES VANILLA UI {commit-hash} {n} commits ahead/behind Master`
with "Master" hyperlinked to the canonical GitHub repo.

## Decisions (user-approved)

- Full replace of footer-left (chain-id prefix and Disclaimer link removed
  there; chain context stays on the node-status side, Help stays reachable
  via the existing footer Help action).
- Hybrid data source: own hash baked at build time, ahead/behind fetched
  live from the GitHub compare API.
- Repo identity: `litepresence/bitshares-vanilla-ui` for now; the eventual
  `bitshares/` move is a one-constant edit (recorded in §6).

## Display states

Base format: `BITSHARES VANILLA UI {short7} · {relation} Master`,
only the word "Master" hyperlinked (repo root URL).

- In sync: `… abc1234 · in sync with Master`
- Ahead: `… abc1234 · N commit(s) ahead of Master` (singular "1 commit")
- Behind: `… abc1234 · N commit(s) behind Master`
- Diverged: `… abc1234 · diverged from Master (A ahead, B behind)`;
  CSS ellipsis clips the tail on narrow screens, the word "diverged"
  (the load-bearing part) always survives.
- Degradation ladder (never blank, never false):
  1. version.json + API reachable → full string.
  2. version.json present, API unreachable/offline → hash only, no count.
  3. No version.json (or `file://` fetch blocked) → leave the static
     skeleton untouched; same skeleton is the no-JS fallback.

## Data flow

1. `tooling/generate_version.py` (new, optional dev tooling) runs
   `git rev-parse HEAD`, records `{repo, branch: "master", commit, short,
   generated_at}`, writes `vanilla/version.json`. Gitignored. Never
   required to serve, run, or deploy (doctrine rule 4).
2. App boot fetches `version.json` same-origin (CSP `connect-src` already
   allows `https:` + `'self'`; `file://` failure falls to ladder step 3).
3. Single live call `GET /repos/{repo}/compare/{branch}...{commit}` →
   `ahead_by` / `behind_by`. Result cached in memory + `localStorage`
   with a TTL (10 minutes) so `paintVersion()` repaints on every
   connection event never re-fetch (respects 60/hr unauthenticated limit).
4. Implementation verifies at build time whether the compare endpoint
   accepts a raw SHA as head; if not, fallback is tip-fetch
   (`GET /repos/{repo}/commits/{branch}`) then `compare/{tip}...{commit}`.

## Network prefix (amendment 2026-10-04)

Footer-right line 1 (node host, `paintFooter()` in `vanilla/js/app.js`) is
prefixed with the active network: `MAINNET - {host}` / `TESTNET - {host}`.

- Source of truth: `Store.loadSettings().network` (validated
  `"mainnet"`/`"testnet"`, defaults to mainnet). Custom nodes inherit the
  setting; the chain-id pin (`connect()`) guards wrong-chain lies.
- Labels: new format key `shell.footer_net_host` (`%(net)s - %(host)s`)
  reusing the existing `settings.network_mainnet` / `settings.network_testnet`
  labels (no new translatable words; rendered caps by the existing
  `.appfoot-host { text-transform: uppercase }`).
- Color: open + mainnet keeps the existing green glow
  (`data-state="open"`). Open + testnet uses a new state
  (`data-state="open-testnet"`): text `--warn-text` (small-text contrast
  contract, cf. node-table `warn`), halo `text-shadow: 0 0 8px var(--warn)`,
  same `candy-glow` pulse, and the `prefers-reduced-motion` stilling rule
  extended to cover it. Closed / error / mismatch states keep current
  red/grey colors but still carry the prefix.
- Verify alongside the build-info matrix: toggle Settings network
  mainnet↔testnet, observe prefix + green/yellow swap at 360px + 1440px.

## Files touched

- New: `tooling/generate_version.py`, (generated, gitignored)
  `vanilla/version.json`.
- Edit: `vanilla/js/app.js` (`paintVersion()` rework; repo URL + branch
  as one shared constant), `vanilla/index.html` (static skeleton only if
  wording changes; JS owns the rest), `vanilla/locales/en.json` + 11
  locale stubs, `.gitignore` (version.json entry).
- No CSS changes expected (`.appfoot-left` already ellipsis-truncates).

## i18n

New `shell.footer_*` keys with `%(name)s`-style placeholders; repo URL,
commit hash, and counts stay byte-verbatim in every language. English
first, other locales carry honest English stubs until human-verified.
`tooling/check_i18n.py` must pass.

## Verification

- `tooling/check_rot.py`, `bash tooling/check_types.sh`,
  `tooling/check_i18n.py` green.
- Manual matrix: online (full string) / offline (hash only) /
  version.json deleted (skeleton) / `file://` open; viewports 360px +
  1440px; all three themes.
- Read-only footer: no testnet sign/broadcast required. GitHub API is
  data, not chain; chain safety unaffected.

## Anti-rot answers (§4.5 gate)

- (a) Ten years untouched: version.json (if shipped) still renders the
  hash; API failure degrades to hash-only or skeleton. No crash path.
- (b) New dependency: one opt-in HTTPS fetch to api.github.com that
  fails soft. Not vendored because it is live data, not code.
- (c) Smallest deletable subset: the live-compare fetch; without it the
  footer is still truthful (hash only). Kept because the count is the
  requested feature.

## Future migration

When the repo lands at `bitshares/bitshares-vanilla-ui`: change the one
repo constant (generator + app), regenerate `version.json`, done. No
other file references the owner.
