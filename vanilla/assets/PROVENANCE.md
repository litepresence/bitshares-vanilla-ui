# Image asset provenance

All files under `vanilla/assets/` are byte-copies from the reference UI
(`bitshares/bitshares-ui`, MIT — images ship under the repo license),
copied 2026-09-27 for principle #2 (retro look parity): buttons, icons,
token logos, flags, and app art must be pixel-identical to the original.

| Dir | Files | Contents |
|---|---|---|
| `icons/` | 91 (84 SVG + 7 PNG) | UI icon set (nav, buttons, status, actions) |
| `language-dropdown/` | 245 (243 PNG + 2 JS) | Flag icons for the language picker |
| `bin-file/` | 5 SVG | Button-state graphics (default/hover/error/rounded-arrow/downloaded) |
| `model-type-images/` | 6 | Model-type illustrations |
| root (`favicon.ico`, `logo-*.png`, `qr.png`, `ul-arrow*.png`, `fresh-bolt2.png`, `hero.webp`) | 10 | Favicons, logos, misc art |

Deliberately NOT copied:
- `icons-loader.js`, `symbols.js` (webpack-era loader shims — dead weight; filenames are the registry).
- `docs/_build/` images (generated build output, regenerable).
- `resources/*.js` (Electron plumbing, not art).
- `charting_library/` (proprietary TradingView blob — rejected, see SLICES.md).

SVG `http://` strings are XML namespace declarations only (`xmlns`), not
remote references — verified. Styling that *uses* these images (buttons,
backgrounds) still lands per-slice; these files are the raw material.

Owner-supplied exception (2026-10-01):
- `logo-ico-blue.png` (64×64, 3.5KB) REPLACED the reference byte-copy with
  the owner's sky-blue BitShares mark (1050² source `bitshares.png`,
  downscaled via ffmpeg, transparency kept). Same filename + same header
  slot (`index.html:26`, `dashboard-ui.js:279`), so all consumers update
  with no code change. Rationale: project branding for bitshares-vanilla-ui;
  retro parity unaffected (same mark, same 40px header height).
- `hero.webp` (1920×629, ~322KB — the README header art, owner-supplied
  2026-10-01, vanilla flower + pods + mark + title) is the splash hero
  (`dashboard-ui.js` landing branch). Single image on one route, cached
  after first load; light theme frames it as a card (no recolor, no second
  file). Background source `docs/header-background.webp` stays out of the
  app (docs-only, never referenced by shipped code).

Hand-drawn addition (Tier 2):
- `icons/shield-check.svg` (32×32 stroke shield + check, `#929292` to take
  the existing `--icon-filter` theming like the set) is ORIGINAL art drawn
  for the extension-signing header badge — no source, no license surface.
  Same   viewBox/stroke convention as the set so it sits evenly beside
  `locked.svg` at 18px.
- `icons/shield-blue.png` (owner-supplied 2026-10-04, blue shield + white
  check, transparent) beside the Signing section heading
  (`settings-prefs.js` buildSigning). Same family as the state shields.
- `icons/lock-blue.png` (owner-supplied 2026-10-04, blue padlock, 70×96,
  transparent) beside the Login page heading (`auth-ui.js` renderLogin).
  Same blue-lock family as the state padlocks; full-color art bypasses the
  `--icon-filter` invert like the other PNG badges.

Owner-supplied state icons (2026-10-04):
- `icons/_source-lock-shield-4up.png` was the owner's 2×2 sheet (green-check
  shield, red-X shield, red locked padlock, green open padlock on white;
  file deleted 2026-10-04 after the split — the four outputs below are the
  wired artifacts, this paragraph is history).
  Split by `tooling/split_lock_shield_icons.py` (PIL edge flood-fill, white
  glyphs preserved) into `icons/shield-ok.png`, `icons/shield-bad.png`,
  `icons/lock-closed.png`, `icons/lock-open.png` (RGBA, transparent).
  Wired in `app.js` paintLock/paintShieldBadge: BOTH badges always present —
  lock color carries locked (red) vs unlocked (green), shield color carries
  extension-routed (green check) vs browser signing (red X). Colored PNGs
  bypass the `--icon-filter` invert (app.css exempts `img.icon-state`).
