# Parity note — API Lab (#/api-lab, Swagger-feel node prober)

Spec: `docs/superpowers/specs/2026-10-03-api-lab-design.md` (Option B, approved).

## 1. Reference behavior

- #1 `reference/bitshares-ui/app/components/Console/Console.jsx:7-22` — `eval(js)`
  with `db/net/app/wallet/debug` in scope. Anti-pattern: arbitrary code eval in
  the wallet origin. Vanilla deliberately does NOT copy this; the lab runs a
  curated catalog through `Chain.call` only, never `eval`.
- #4 ground truth per catalog entry (verified 2026-10-03, sparse checkout):
  `database_api.hpp` get_objects:92, get_chain_id:224, get_config:219,
  get_dynamic_global_properties:229, get_block:182, get_transaction:190,
  get_recent_transaction_by_id:200, get_accounts:287, get_account_by_name:326,
  lookup_account_names:342, lookup_accounts:357, get_account_balances:371,
  get_account_count:402, get_assets:425, lookup_asset_symbols:444,
  get_asset_count:450, get_limit_orders:475, get_order_book:636, get_ticker:618,
  get_top_markets:646, get_witnesses:1129, get_committee_members:1164,
  get_required_fees:1313; `api.hpp` history get_account_history:89,
  get_relative_account_history:167, broadcast_transaction:352,
  network_node get_info:401, get_connected_peers:412. No `debug_api` class
  exists in `api.hpp` — the debug tier is a login probe surfacing the real
  rejection, no invented methods.
- #3 `wallet-extension/src/popup/popup.js` (78-op confirm wording) is the
  precedent for the broadcast confirm; `signMessage` stays unimplemented
  (blind-signing discipline kept — the lab broadcasts only full signed-tx
  JSON the user pasted + confirmed).

## 2. Vanilla implementation

- `vanilla/js/api/api-lab.js` — 29-entry catalog (Database 23 incl. fee tier,
  History 2, Network 3 incl. broadcast tier, Debug 1 probe) + `coerce` +
  `run` (generic `Chain.call(1, login, [])` then method on the shared socket).
- `vanilla/js/views/api-lab-ui.js` — gate modal, method pulldown (optgroups)
  + filter, curated boxes, raw-JSON mirror both ways, Run/Reset/Copy-link,
  raw `<pre>` + hint line, session history (20), deep-link read/write,
  broadcast unlock+confirm, connect gate (ops-ui pattern), gen counter.
- `vanilla/js/router.js` — `#/api-lab` route (before `*`); `Router.query()`
  (pre-existing uncommitted helper) reads `?by=&params=`.
- `vanilla/index.html` — `api-lab.js` + `api-lab-ui.js` script tags (before
  `router.js`), nav `API Lab` link after Explore. Deviation from spec §4:
  top-nav link instead of Explorer-header link (keeps slice small; header
  link is a one-line follow-up).
- `vanilla/js/globals.d.ts` — `ApiLab`, `ApiLabUI` ambient lines.

## 3. Manual test steps + observed result (testnet, 2026-10-03)

- `node --check` on both new files + router: OK. Catalog logic in node with
  stubbed Chain: 29 methods, 4 groups; `coerce([100916767])` for get_block;
  strlist `[1.2.0,1.3.0]`; missing-required throws `missing: block_num`;
  `abc` throws `bad uint: block_num`; debug probe calls `Chain.call(1,
  "debug", [])`; broadcast entry tier=broadcast, 1 param.
- Live `wss://testnet.xbts.io/ws` (chain `39f5e2ede1f8bc1a3a54a7914414e3779e33193f1f5693510e73cb7a87617447`):
  `get_account_by_name committee-account` → `1.2.0`; `get_assets ["BTS"]` →
  `BTS` precision 5; `get_block head-1` → valid block with witness;
  `get_required_fees` transfer 1.00000 TEST → raw `86869`.
- Headless DOM render + human browser pass: PENDING (tester gate, same as
  slices 2–17 ⏳). No broadcast sent (confirm path reviewed, not fired).

## 4. Raw→human vectors

- `committee-account` → `1.2.0` (IDs are addressing, never money).
- `BTS` asset → precision `5` (amounts ÷ 10^5).
- Transfer fee raw `86869` (TEST p5) → `0.86869 TEST` (hint line, never
  replacing raw).
- Percent rule restated in generic hint: stored `2000` → `20%`.
- Block heights are plain ints (no conversion — stated in-desk).

## 5. Themes + viewports

- No new CSS (retro cards + theme tokens only); single-column layout is
  360px-safe by construction (select/inputs stack, 44px targets); desktop
  uses `wrap wide`. Screenshot trio + phone/desktop flow check: PENDING with
  the tester browser pass.

## 6. Headers + descriptions

- Both files open with module headers (owns/consumes/globals/refs); every
  non-trivial function has params/return/failure docs. No TODO/FIXME, no
  commented-out code, no `eval` (grep-verified).

## 7. Anti-rot gate (AGENTS.md §4.5)

- (a) 2036 test: catalog is in-repo data (no remote spec fetch), UI is
  platform DOM, single shared socket. Yes, still runs.
- (b) New dependencies: none. No package, no CDN, no build step; two static
  files + 3 one-line wirings. `check_rot.py`: my files clean — the single
  violation is pre-existing uncommitted `account-ui.js` mentioning
  `globals.d.ts` (earlier round's dirt, not this slice). `check_types.sh`:
  zero errors in new files (25 remaining all in pre-existing untracked
  `bitshares-uri.js`).
- (c) Smallest deletable subset: the Debug probe + broadcast entry could go
  and reads still work — kept because the owner explicitly asked for full
  surface with honest failures; each is tier-gated so deletion stays trivial.
