# Image asset provenance

All files under `vanilla/assets/` are byte-copies from the reference UI
(`bitshares/bitshares-ui`, MIT — images ship under the repo license),
copied 2026-09-27 for principle #2 (retro look parity): buttons, icons,
token logos, flags, and app art must be pixel-identical to the original.

| Dir | Files | Contents |
|---|---|---|
| `icons/` | 84 SVG | UI icon set (nav, buttons, status, actions) |
| `asset-symbols/` | 105 PNG | Token/asset logos |
| `language-dropdown/` | 243 mixed | Flag icons for the language picker |
| `bin-file/` | 5 SVG | Button-state graphics (default/hover/error/rounded-arrow/downloaded) |
| `model-type-images/` | 6 | Model-type illustrations |
| root (`favicon.ico`, `logo-*.png`, `qr.png`, `ul-arrow*.png`, `fresh-bolt2.png`) | 9 | Favicons, logos, misc art |
| `resources/` | 5 | Electron app art (backgrounds, window icons) |

Deliberately NOT copied:
- `icons-loader.js`, `symbols.js` (webpack-era loader shims — dead weight; filenames are the registry).
- `docs/_build/` images (generated build output, regenerable).
- `resources/*.js` (Electron plumbing, not art).
- `charting_library/` (proprietary TradingView blob — rejected, see SLICES.md).

SVG `http://` strings are XML namespace declarations only (`xmlns`), not
remote references — verified. Styling that *uses* these images (buttons,
backgrounds) still lands per-slice; these files are the raw material.
