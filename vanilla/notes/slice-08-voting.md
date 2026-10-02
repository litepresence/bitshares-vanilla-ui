# Slice 8 parity note — voting/governance

Plan: `docs/superpowers/plans/2026-09-28-slice-08-voting.md` (Tasks 1–4).

## What landed (vanilla file:line)
- `vanilla/js/tx.js` — op-6 `account_update` serializer appended: `voteIdToUint32`
  (`"t:i"` → `instance<<8|type`), `serializeAccountOptions` (memo_key →
  voting_account → num_witness/committee → sorted votes → extensions),
  `serializeAccountUpdateOp` (fee → account → owner/active absent → new_options).
  Field order per #4 `account.hpp:39-59,151-162`; matches #3 `bitshares-api.js:2116-2140,2420-2429`.
- `vanilla/js/vote.js` — reads only: witness/committee/worker counts, lists
  (count→`get_objects` batches + lookup fallback), `lookupVoteIds`,
  `currentVotes`, `fee` via `Tx.fee(6,…)`. Weights stay raw-int strings.
- `vanilla/js/vote-ui.js` — `#/voting` view: witness/committee/worker tabs,
  proxy picker with search, draft-vs-published slate diff, named-row confirm,
  publish + reset, generation-counter teardown. Route `router.js:93`, tags
  `index.html:47-48`.
- `Tx.broadcast` history poll only matches op-0 — view sends via local path +
  slate re-read proof (`sendAndProve`), proven end-to-end.

## Reference behavior (file:line)
- #4 wins: op 6 = `account_update_operation` (`operations.hpp:62`);
  `GRAPHENE_PROXY_TO_SELF_ACCOUNT` = `1.2.5` (`config.hpp:150`).
  Ambiguity RESOLVED on testnet: `1.2.5` ACCEPTED, self-id retry never needed
  (#2's `usr.id` payload vs #1/#3/#4 — testnet sides with #1/#3/#4).
- #3's op-6 confirm is raw `JSON.stringify` (`popup.js:5764-5770`) — vanilla
  deliberately beats it with named rows (zero `JSON.stringify` in vote files).
- BJS cross-check: not consulted — #3 and #4 agree on op-6 field order with no
  conflict, and testnet accepted the bytes; per mapping rules #4 wins ties.

## Test vectors (raw → human, real format.js)
- Fees: `5959→0.05959 TEST`, `5764→0.05764 TEST` (from `get_required_fees`).
- Weights: `8000000000000→80000000.00000`, `8615384615384→86153846.15384`,
  worker `daily_pay 9900000→99.00000` (p5); share `%` integer-hundredths
  (`8000000000000/360000000000000→2.22%`; empty supply hides column).
- Vote u32: `"1:5"→0x0501`, `"0:3"→0x0300`, `"2:9"→0x0902`; deterministic + sort-invariant.

## Manual test (testnet, backbone wss://testnet.xbts.io/ws, chain 39f5e2ed)
- VOTE `["1:0"]` (num_witness 1, proxy `1.2.5`) → **block `100916767`**,
  slate re-read confirms. Reads: witnesses 130, committee 35, live workers 3.
- UNVOTE cleanup → **block `100916768`**, exact PRE restored
  (`votes=[]`, proxy back to PRE-state `1.2.25483`). Chain left as found.
- Headless shots (zero console errors ×4): `#/voting` @1440 blue/dark/light +
  @390 blue — locked-wallet gate renders in all themes, phone stacks.

## Tester pass (queued)
- Unlock → Voting tabs render with names/weights; check a witness → Publish →
  named-row confirm (proxy/votes/fee) → broadcast → slate updates; proxy set
  disables slate; light-theme visual; phone-390 scroll.

## Anti-rot gate (§4.5): (a) yes — static + existing Tx/Crypto reuse, no new
deps; (b) nothing new depended on (reads via existing chain.js, signing via
existing tx.js); (c) smallest deletable: worker tab (witness/committee stand).
`check_rot.py` PASS.

## Delta — 2026-10-02 governance analytics (gov-analytics extension)
- NEW `vanilla/js/api/gov-analytics.js` — bounded analytics joins + pure
  rankers (fundingShare/fundingRows/fundingTotal/splitCounts/sampleLabel/
  biggestBlocks/biggestTxs/buildMatrix + workerFunding/splits/topVoters/
  proxyMatrix/biggestSample). Tag `index.html` after `explorer-tabs.js`;
  `globals.d.ts` gains `GovAnalytics` (type-gate only, zero runtime).
- `vanilla/js/views/vote-ui.js` — "Governance analytics" section under the
  join entries: splits line (zero new RPCs, from the lists snapshot), worker
  funding top-10 (pay p5 via Format + share via fundingShare), top-10 voters
  (get_top_voters, vp as comma ints — NEVER money-formatted), proxy-vote
  matrix 10×(10W+10C) with ✓/· cells in a scroll region. All fail-open.
- Method map (#4 wins): get_top_voters(limit) database_api.hpp:313-319 (cap
  api_limit_get_top_voters=200 application.hpp:63; vanilla 1..20); stats
  {owner,name,vp_active,is_voting} chain/account_object.hpp:50,52,91,97-98;
  votes/proxy via ONE batched get_accounts database_api.hpp:287 +
  account.options.voting_account protocol/account.hpp:48 (1.2.5 sentinel
  protocol/config.hpp:150). No unbounded scan: full "who-proxies-to-X" would
  need whole-registry enumeration — matrix is labeled a top-10 sample, never
  a census. ES refused (doctrine).
- Unit vectors: `tooling/gov-analytics-test.js` 33/33 green (shares incl.
  1/3→33.33%, 2/3→66.67%; sorts, totals, splits, sample-label honesty,
  rankings, matrix cells, caps).
- Live mainnet (headless, api.bitshares.dev, head #114882090): splits 16
  active/178 standby/194 witnesses, 11/54/65 committee; funding top
  "Fund to pay dividend (1.14.35)" 2000000.00000/day; budget 1.00000/day
  (committee-set 100000 raw vs default 500000/day config.hpp:96 — chain
  truth, hence >100% shares, honest not absurd); total requested
  3330003.00000/day; top voter abot 52,800,002,400,000 vp; matrix live ✓/·.
- Anti-rot (a–c): (a) static + existing reads, runs 2036; (b) one new WS
  method (get_top_voters, data not code — removable); (c) deletable: matrix
  (lists + funding stand). check_rot PASS, check_types PASS, check_i18n PASS
  (plain literals, no new keys).
