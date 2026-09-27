# DEX-UX live reference (bts.exchange, captured 2026-09-28, user-approved MIT)

Files: `btsx-home.png` (landing/create-login), `btsx-market2.png` (`#/market/BTS_USD`),
`btsx-pools.png` (`#/pools`). Canonical URLs use `#/` hash routes
(`/market/BTS_USD` without hash 404s).

## Market desk cues (mirror target for our desk + pools desk)
- Stats strip: pair bell/star + Latest + 24h Change (red/green) + 24h Volume +
  Feed Price + Global Settlement + Personalize gear.
- Chart: OHLC legend + volume bars, 1h default; right rail MY/FIND MARKETS tabs,
  liquid-only + star-only checkboxes, quote-coin radios (BTS/BTC/CNY/USD/USDT/ETH),
  MARKET/VOL/PRICE/CHANGE table with green/red changes.
- BUY/SELL panels: LIMIT/SCALED tabs, Price/Amount/Total/Fee rows with unit
  suffixes inside inputs.
- Footer bar: version + DISCLAIMER left; latency/block + REPORT/HELP right.
- Warning banner top (dismissible). Dark TradingView-family background.

## Pools cues
- Filter row: Asset A + Asset B + Share Asset + page-size select.
- Dense table: POOL ID / SHARE / A / A QTY / B / B QTY / TAKER / WITHDRAWAL /
  EXCHANGE (⇄ icon) / STAKE-UNSTAKE (icon); paginated (11 pages here).
- Same dark chrome + footer as the desk (seamless by construction).

## Deltas vs vanilla (style-iteration queue)
1. No persistent footer with latency/block (both refs have it).
2. Pools list density: theirs is a paginated icon-action table; compare ours.
3. Input unit suffixes (Price [BITUSD/BTS]) vs our plain inputs.
4. LIMIT/SCALED tab shape on buy/sell panels.
