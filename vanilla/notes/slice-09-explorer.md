# Slice 9 parity note — explorer

Plan: `docs/superpowers/plans/2026-09-28-slice-09-explorer.md` (Tasks 1–3).
Reads-only slice: no signing, no confirm dialog (`tx.js`/`crypto.js` untouched).

## What landed (vanilla file:line)
- `vanilla/js/explorer.js` — reads only: `head`, `recentBlocks` (batch pairs
  unpacked + per-row `get_block` tx counts), `block`, `tx`, `recentTxById`,
  `assetsPage`, `assetCount`, `asset`, `feeds`, `resolveObject`, `search`.
- `vanilla/js/explorer-ui.js` — `#/explorer` (+`:tab` blocks|assets|feeds),
  `#/block/:height`, `#/block/:height/:txIndex`, `#/asset/:symbol`; 1.x.y
  search with `1.2.x`→`#/account/:name`, `1.3.x`→`#/asset/:symbol` redirects;
  generic object panel with humanized leaves; gen-counter teardown.
- Routes `router.js:94-98`, tags `index.html` before `router.js`.
- Readability split (audit follow-up): `explorer-ui.js` 396 (shell), new
  `explorer-blocks.js` 367, new `explorer-assets.js` 786 (assets+feeds+values
  layer, no separate cap — readability-pass candidate). Re-verified post-split:
  fee `0.05959 TEST`, AAAA supply `101.00000`, zero `undefined`, rot PASS.
- Probe saved per policy §7.3: `tooling/explorer-reprobe.mjs` (stdlib-only, 9/9).

## Reference behavior (file:line)
- #4: methods per `database_api.hpp:92-200,229,413-461`; op enum 0–77
  (`operations.hpp:56-133`); spaces (`types.hpp:362-386`); `get_bitasset_data`
  is wallet-API-only so feeds go via `bitasset_data_id` + `get_objects`
  (confirmed by #1 `AssetActions.js:574-580`).
- #1 `Asset.jsx:738-748`: MSSR/MCR ÷1000 ratio (`1100`→`1.1×`); market fee
  hundredths (`0`→`0%`). Chain facts that beat guesses: `get_block` has no
  height in body (client-attached); batch returns `[height,header]` pairs
  (fc map encoding); ticker change is human float.

## Bugs found by verification, fixed + re-probed
1. `head()` read `head_block_time`, chain sends `time` → now `g.time` + fallback.
2. Batch pairs not unpacked; headers carry no tx count → unpack + per-row
   `get_block` (page-capped, failure → `—`).
3. `resolveObject` space/type misassigned → space literal 1, type=m[1];
   restores typeName, both redirects, 1.11.x op-attach.
4. Generic panel raw leaves → CORE_AMOUNT_KEYS at core p5, OWN_AMOUNT_KEYS at
   owning-asset precision (async resolve, else raw + ` (raw)`).

## Test vectors (raw → human, real files, live testnet)
- Fixture blocks read back our own slice-8 contents: `100916767` op-6
  `votes ["1:0"]` proxy `1.2.5` fee `5959`→`0.05959 TEST`; `100916768` op-6
  `votes []` proxy `1.2.25483` fee `5764`→`0.05764 TEST`.
- `AAAA (1.3.642)`: supply `10100000`→`101.00000`, fee pool
  `15000000000`→`150000.00000`; MSSR `1100`→`1.1×`; `TEST` max supply
  `1000000000000000`→`10000000000.00000`; market fee `0`→`0%`.
- `1.6.1`: `witness · 80000000.00000 votes (raw 8000000000000)`.
- Hundredths percent (audit follow-up, real `pctHundredths`): `2000`→`20%`,
  `0`→`0%`. Non-p5 amount (real `Format.formatAmount`): `74900` p2 → `749.00`
  (CNY, slice-7 live fill precision).
- Feed ambiguity RESOLVED live: `current_feed` wins; zero-pairs → `—`/`unavailable`.
- `get_asset_count` = `1849`; `1.10.1` → honest "Nothing found".

## Manual test (headless, --network testnet, zero console errors)
- `#/explorer` @1440 blue/dark + @390: head strip
  `Head #100917335 · 2026-09-27T04:10:39 · irreversible #100917327`, rows with
  time + witness links + Txs, phone stacks.
- `#/block/100916767` + `/0` + `#/asset/TEST` + `#/explorer/feeds` (10 live MPAs):
  all fully correct.
- `1.11.x` live objects pruned on testnet — op-attach branch code-intact,
  untestable live (honestly recorded).

## Tester pass (queued)
- Search `1.3.0`→asset page, `1.2.5`→account page, `1.6.1`→witness panel;
  block→tx→op drill-down; feeds tab; light-theme visual; phone-390 scroll.

## Anti-rot gate (§4.5): (a) yes — static reads via existing chain.js, no new
deps; (b) nothing new depended on; (c) smallest deletable: feeds tab (blocks/
txs/assets stand). `check_rot.py` PASS.
