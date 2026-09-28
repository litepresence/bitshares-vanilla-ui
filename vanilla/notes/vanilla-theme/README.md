# vanilla-ui-theme palette (user-supplied DeConna tub photo, `tub.jpg`)

Sampled by eye from the photo (user is on the BitShares dev team; private
label photo used as color source only — not shipped in the app):

| Swatch | Approx hex | Use |
|---|---|---|
| Lid golden ochre | `#C8961E` | `--warn` (graphic/large use), stars/stripes |
| Label warm cream | `#FAF6EA` | `--bg` |
| White highlight | `#FFFFFF` | `--panel` |
| Sky-blue logo/band | `#1E9ED7` | `--accent`, `--button-bg` (white text) |
| Chocolate body text | `#6B3A1F`→ text `#2A1A12` | `--text` (darkened for AAA ~15:1) |
| Chocolate→taupe muted | `#6F5F50` | `--muted` (~5.5:1) |
| Cream border | `#E5DCC8` | `--border` |
| Header | chocolate bg + cream text | `--header-bg`/`--header-text` (label inverted) |

Buy/sell keep the light-surface-tuned `#1DA866`/`#D35A41` (no tub cue to
change them). Implemented in `vanilla/css/themes.css` (`vanilla-ui-theme`
block, with reasoning comments per token).
