# vanilla-ui-theme palette (user-supplied DeConna tub photo, `tub.jpg`)

Sampled by eye from the photo (user is on the BitShares dev team; private
label photo used as color source only — not shipped in the app):

| Swatch | Approx hex | Use |
|---|---|---|
| Lid golden ochre | `#C8961E` | `--warn` (graphic/large use), stars/stripes |
| Label warm cream | `#FAF6EA` | `--bg` |
| White highlight | `#FFFFFF` | `--panel` |
| Sky-blue logo/band | `#1E9ED7`→`#0F6E99` | `--accent`, `--button-bg` (white text; darkened 2026-09-30: 2.81/3.03→5.24/5.66 on cream/white, white-on 5.66) |
| Chocolate body text | `#6B3A1F`→ text `#2A1A12` | `--text` (darkened for AAA ~15:1) |
| Chocolate→taupe muted | `#6F5F50` | `--muted` (~5.5:1) |
| Cream border | `#E5DCC8` | `--border` |
| Header | chocolate bg + cream text | `--header-bg`/`--header-text` (label inverted) |

Buy/sell are hue-kept darkenings for text (`#1DA866`→`#0E7A4A`,
`#D35A41`→`#B8452F` 2026-10-01: old 2.84/3.07 + 3.66/3.96 → new
4.98/5.38 + 4.94/5.34 on cream/white). `--warn` stays lid ochre
(graphic/large use only); small text rides `--warn-text` `#7A5A0A`
(5.90/6.37). Banners ride `--banner-bg` `#F3E2B8` / `--banner-text`
chocolate / `--banner-border` lid ochre. Implemented in
`vanilla/css/themes.css` (`vanilla-ui-theme` block, with reasoning
comments per token).
