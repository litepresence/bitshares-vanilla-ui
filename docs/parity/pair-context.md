# Pair context + parallel selector ladder — parity note (2026-10-07)

The navbar used to send Exchange straight to a desk (`#/market/BTS_USD`)
while Pools landed on its selector page — two different ladders for the
same job. Now both ladders run `category → selector → desk`, and one
**global selected pair** travels between them.

## What shipped

| Rung | Markets | Pools |
|---|---|---|
| Navbar | `Markets` → `#/markets` | `Pools` → `#/pools` |
| Selector H1 | `Market Selector` | `Pool Selector` |
| Desk H1 | `Exchange Desk` (unchanged, `01876d9`) | `Swap Desk` (unchanged, `01876d9`) |

- **Owner rulings (2026-10-07):** session memory + URL seeds (no
  persistence — a reload resets to `[BTS]`, a shared `?a=/?b=` link still
  works); pair stored in **human order `[base, quote]`**; pickers **read**,
  desks **write**; both pickers + both desks participate, dashboard /
  favourites / instant-trade untouched.
- **`vanilla/js/api/pair-context.js`** (new): the sole owner — `get`,
  `set`, `on`, `reset`, `marketId` (`QUOTE_BASE`), `fromMarketId`,
  `fromPool`, plus `_t` test seams. Normalization: trim → uppercase →
  drop blanks → drop object ids → 12-char cap → dedupe → cap at 2 legs →
  empty resets to `[BTS]`. Never empty, never throws.
- **Seed precedence (both selectors):** shared `?a=/?b=` deep link → the
  global pair → `[BTS]`.
- **Retired:** `App.setPoolMarket`, `App.poolMarket`,
  `App.refreshExchangeLink`, `App._test.validPoolMarket`, the router's
  per-route pool-context clear hook, and the one-way pool→Exchange navbar
  swap. The pool desk's `QUOTE_BASE` string is now *derived* by
  `PairContext.marketId()` rather than handed to the navbar.
- **New:** section-aware tab highlight (`navIsCurrent`), `#/markets` SEO
  title/description (it had none — and it is a navbar destination now),
  the Trade sitemap card retargeted to `#/markets`.

## Bugs this pass caught (not in the original design)

1. **Query-in-hash broke the tab highlight.** The pickers write `?a=&b=`
   *inside* the hash (`#/markets?a=DOGE&b=USD`), so an exact-match
   comparison left a filtered selector's own tab dark. `navIsCurrent` now
   compares the path half (`app.js`), with three vectors.
2. **A malformed desk id was silently truncated.** `fromMarketId("A_B_C")`
   first yielded `["A","B"]` — i.e. a typo would open a *different*
   market. It now rejects to the default pair, which is what the ported
   `validPoolMarket` rule always said ("three parts rejected").
3. **A string meant two things.** `normalize("ETH_BTS")` split on `_` while
   `normalize(["bts_cny"])` kept the token verbatim. Now a string is ONE
   leg and `set()` is the only door that accepts a `QUOTE_BASE` string
   (routing it through `fromMarketId`), so the two shapes can never mean
   different things in different callers.

## Evidence

- `node tooling/pair-context-test.js` → **41 passed** (normalization table,
  `QUOTE_BASE` incl. the spec's `BTS/BTC → BTC_BTS`, round trip,
  `fromPool → marketId()` reproducing the old pool string, pub/sub).
- `node tooling/app-shell-test.js` → **green** (18 + 21 + bar-six +
  phone-scroll-row). The seven `validPoolMarket` vectors moved to
  `pair-context-test.js` — same cases, same expectations.
- `node tooling/market-net-test.js` → 22 passed ·
  `node tooling/pool-history-test.js` → 46 pass ·
  `node tooling/market-fills-test.js` → 29 passed (all unchanged).
- Headless (`tooling/visual/probe-pair-ladder.mjs`): default seed
  `["BTS",""]`; desk writes `BTS,ETH`; selector comes back seeded
  `["BTS","ETH"]`; `?a=DOGE&b=USD` still wins; navbar reads
  `Dashboard · Markets · Pools · Credit · Margin · Explore`; both H1s
  correct; the tab stays current one rung down on both sides; pool desk
  `1.19.0` wrote its own legs (`TWENTIX,BTS`); **zero page errors**.
- Gates: `check_rot.py` PASSED · `check_i18n.py` OK (3772 keys, 12 dicts,
  4980 call sites drift-free) · `check_types.sh` **PASS** (whole
  `vanilla/js`, checkJs, no emit).

## i18n

Five new keys (`nav.markets`, `nav.pools`, `market_net.selector_title`,
`pools.selector_title`, `seo.title_markets`, `seo.desc_markets`) via
`tooling/add_pair_selector_i18n.py` — insert-if-missing, English fill in
the non-en dicts (honest stubs until a translator verifies).
**`nav.exchange` was deliberately kept**: all 12 dicts carry verified
translations of "Exchange" (Börse, Bourse, 取引所, Биржа…), and renaming
the English value would have invalidated every one of them. The desk still
says "Exchange Desk", so that vocabulary lives one rung down instead.

## Accepted costs

- The navbar no longer says "Exchange" — muscle memory looks for it. The
  word is still on the desk, and `#1`'s own vocabulary uses it for this
  route.
- Session-only means a reload forgets the pair (by ruling, not by
  accident): share a pair with a link, not with a habit.

## Anti-rot answers (§4.5)

- **(a)** One module, standard ES5 + `Array`/`RegExp`, no globals beyond
  its own name — it still runs in a 2036 browser.
- **(b)** Nothing newly depended on: no package, no service, no toolchain,
  no hosted asset. It reads no chain API at all.
- **(c)** The smallest deletable subset is the whole thing: drop
  `pair-context.js` + its six call sites and the navbar falls back to
  static category links with no reader — which is exactly why nothing else
  in the app depends on it.
