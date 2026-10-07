# Global market pair context + parallel selector ladder (2026-10-07)

One pair travels the app: navbar `Markets`/`Pools` → a selector page →
the desk. Replaces the one-way "Exchange tab follows the pool you are
visiting" swap (which existed only because the Exchange tab pointed
straight at a desk) with a two-way context both ladders can read and
write. Chain-only; session-memory only; no storage, no new route.

## §1 Architecture + placement (approved)

- New `vanilla/js/api/pair-context.js`: the sole owner of the global
  selected pair. Normalization + market-id derivation + a 3-line pub/sub.
  No DOM, no chain calls, no storage, no load-order dependency on the
  views that call it (all callers guard with `typeof`).
- Public surface (all pure except `set`/`on`):

  | Call | Returns | Notes |
  |---|---|---|
  | `PairContext.get()` | `["BTS"]` … `["BTS","ETH"]` | human order `[base, quote]`; fresh array copy, never a live reference |
  | `PairContext.set(pair)` | normalized pair | accepts array or `"BASE_QUOTE"` / `"BASE-QUOTE"` string; notifies subscribers when the value changes |
  | `PairContext.marketId()` | `"ETH_BTS"` or `null` | desk id = `QUOTE_BASE` (the rule `market-net-ui.js` (DESK-ID RULE header) and `PoolDetailView` already use); `null` for a 1-item pair |
  | `PairContext.fromMarketId(id)` | `["BTS","ETH"]` | inverse of `marketId()`; bare ids / junk → default |
  | `PairContext.fromPool(pool)` | `["BTS","USDT"]` | pool's own `(base, quote)` order, so `marketId()` reproduces the string the pool desk builds today |
  | `PairContext.on(fn)` | unsubscribe fn | add/remove subscriber |
  | `PairContext.reset()` | `["BTS"]` | used by tests and the "Clear" button |
  | `PairContext._t` | seams | `normalize`, `marketId`, `fromMarketId`, `DEFAULT` |

- `normalize`: trim → uppercase → drop blanks → drop object-id-shaped
  junk (`^1\.\d+\.\d+$`, the `validPoolMarket` rule, kept verbatim so a
  bare id can never misroute a desk) → drop symbols longer than 12 chars →
  dedupe → cap at 2 (keep the first two) → **empty result resets to
  `DEFAULT` (`["BTS"]`)**. The pair is therefore never in a state the
  pickers cannot render.
- Where it lives: **not** in `Store` (that module owns the persisted
  settings envelope; the pair is transient) and **not** in `app.js` (that
  is the shell). It is a domain concept, so it sits in `js/api/` beside
  `market-net.js`.

## §2 Wiring, four seams (approved)

| Seam | Behavior |
|---|---|
| `app.js` nav | `ORIGINAL_NAV` Exchange href → `#/markets`, label `Markets`; `Pools` href stays `#/pools`, label `Pools`. `setPoolMarket`, `poolMarket`, `refreshExchangeLink`, `validPoolMarket` **deleted**; the router's pool-route clear hook goes with them. |
| `/markets` picker (`market-net-ui.js`) | Seeds Asset 1 / Asset 2 from the pair. H1 → `Market Selector`. Reads only — a row click lands on a desk, and the desk writes (§2.1). |
| `/pools` picker (`pool-ui.js`) | Seeds its asset A/B filters from the pair. H1 → `Pool Selector`. Reads only. |
| both desks | On load, `PairContext.set(...)` from the route: `/market/:id` → `fromMarketId(id)`, `/pools/:id` → `fromPool(P.assets)`. Replaces `App.setPoolMarket` in `pool-detail-view.js:423`. |

2.1 **Pickers read, desks write.** The approved sketch had pickers also
writing on row click; that is redundant — every picker row navigates to a
desk, and the desk writes on load — so it is dropped. Keeps one writer
per value and one place to reason about.

2.2 **Seed precedence in both pickers:** URL `?a=&b=` (existing shareable
deep link, unchanged) → `PairContext.get()` → `[BTS]` default. Shared
links therefore keep working exactly as they do today.

2.3 **Active-tab highlight becomes section-aware.** Exact-hash matching
(`app.js:187`) leaves every tab dark once you are one level deep, which is
what made the ladder feel broken. A tab is current when the hash matches
its own route **or** a child of it: `Markets` on `#/markets` and
`#/market/…`, `Pools` on `#/pools` and `#/pools/…`. Applies to the bar,
the burger sitemap cards, and the drawer.

## §3 Naming ladder (approved)

| Rung | Markets | Pools |
|---|---|---|
| Navbar | `Markets` | `Pools` |
| Picker H1 | `Market Selector` | `Pool Selector` |
| Desk H1 | `Exchange Desk` (unchanged) | `Swap Desk` (unchanged) |

Rungs were chosen for parallel grammar (category → control → floor) after
rejecting a literal `Market Exchange` desk name: on a DEX a *market* is an
exchange pair, so "Market Exchange" is a pleonasm, and it left the two
ladders rhyming differently at the bottom rung. Desk headers from `01876d9`
stand; the pair itself is printed by the desk sub line, so orientation
inside the desk is unchanged.

Copy: picker subtitles carry the selling line (the markets one already
exists — "Top order-book markets by 24h volume. Pick a row to open the
desk."). **New: `#/markets` has no SEO title/description today**, and it is
now a top-level navbar destination, so it gets `seo.title_markets` /
`seo.desc_markets` to match `/pools`. The Trade sitemap card `Exchange`
retargets to `#/markets` so the drawer and the bar agree.

i18n: `nav.exchange` default becomes `Markets`; new
`market_net.selector_title` ("Market Selector") and
`pools.selector_title` ("Pool Selector"); the 12 dicts receive the new keys
through the existing non-clobbering adder (English fill, honest stubs
elsewhere) so `check_i18n.py` stays green and no verified translation is
clobbered.

## §4 States, perf, a11y, i18n (approved)

- Pair reads are synchronous and allocation-tiny (one array copy); a
  desk-load write is a single notify. No subscriber currently needs a
  repaint — both pickers seed at render — so `on()` exists for the drawer
  highlight and for future consumers, and is exercised by tests only.
- Nothing about the desk data path changes: no new chain call, no new
  probe, no extra read. The pickers' existing empty state doubles as the
  "no market for this pair" state (honest, never blank).
- Labels keep `aria-current="page"` on the section match, so a screen
  reader still hears where it is at every rung. Seeded search fields are
  ordinary inputs — no new control, no new a11y surface.
- 3 themes, 360px → 4K untouched: a H1 string and a tab label cannot
  break layout, and the seeded fields are the pickers' existing inputs.

## §5 Testing (approved)

- New `tooling/pair-context-test.js`: normalization table (case, blanks,
  dupes, >2 truncation, 12-char cap, object-id rejection, empty →
  `["BTS"]`), `marketId()` including the `BTS/BTC → BTC_BTS` case
  documented at `market-picker.js:151`, `fromMarketId` round-trip,
  `fromPool` → `marketId()` reproducing today's pool string, subscriber
  add/remove/notify-once.
- `tooling/app-shell-test.js`: the seven `validPoolMarket` vectors port to
  `pair-context-test.js` (same cases, same expectations — the rule moved,
  it did not change); `navText` / `ORIGINAL_NAV` assertions updated to the
  new hrefs and labels; nav-six still 6 links.
- Headless, both ladders: navbar `Markets` lands on `Market Selector`;
  row click → desk; navbar again → selector pre-seeded with that pair;
  same for pools; a desk-load write survives navigation; `?a=&b=` beats
  the stored pair.
- Gates: `node tooling/pair-context-test.js`, `node tooling/app-shell-test.js`,
  the existing market/pool test files **unchanged** (they must not need
  edits), `bash tooling/check_types.sh`, `python3 tooling/check_rot.py`,
  `python3 tooling/check_i18n.py`.

## §6 Risks, explicitly accepted

- **Retro cost.** The navbar label drops "Exchange"; muscle memory looks
  for it. Mitigated by the desk still saying "Exchange Desk" and by
  `#1`'s own vocabulary (its sidebar says Exchange/Trade for this route).
- **Dirty tree.** `pool-ui.js` (and other files) carry uncommitted
  concurrent-workstream edits. Implementation reads the working tree and
  stages by file/hunk; unrelated diffs are never staged or reverted.
- **Deep-link precedence.** A shared `?a=&b=` link wins over the stored
  pair, so a pair set in one tab is not sticky enough to hijack a shared
  URL. That is the intended order.

## Self-review

- No TBDs; no new route, no new view, no new chain call, one new
  dependency-free module.
- Consistent: every rung reads the pair in the same human order, and the
  one place that knows about `QUOTE_BASE` is `PairContext.marketId()`.
- Scope: one module + six touched files + one test file + i18n keys —
  small enough for a single plan.
- Ambiguity resolved explicitly: one writer per value (§2.1), seed
  precedence (§2.2), highlight scope (§2.3), pool pair order (§1
  `fromPool`).
