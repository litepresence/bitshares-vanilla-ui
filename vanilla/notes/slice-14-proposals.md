# Slice 14 parity note — proposals + tickets + misc (+ barter PROPOSE)

Plan: `docs/superpowers/plans/2026-09-28-slice-14-proposals.md` (Tasks 1–4).

## What landed (vanilla file:line)
- `vanilla/js/tx.js` — 12 serializers: op 7, 22/23/24 (op_wrapper both forms,
  `serializeOperationData` recursion), 32/33 (policy array-form), 37 (fee 0),
  54/55/56 (restrictions 0–41 table), 57/58 (target varint 0–4). WHY-NOT: 38
  issuer-only, 39/40/41 blind-downscoped, 46 VIRTUAL. BJS: all 12 match
  (#4 wins the one gap — BJS lacks instant policy type 2).
- `vanilla/js/proposal.js` (239) + `proposal-ticket.js` (124) + `proposal-misc.js`
  (246) — reads (1.10/1.13/1.15/1.17/1.18), builders, invoice base58-JSON
  pack/unpack, airdrop batcher, `blindSend` throws.
- Views: `proposal-ui.js` 513 (shared-toolkit exception: helpers ~290 incl.
  nested renderer, views 188), `ticket-ui.js` 267, `misc-ui.js` 330,
  `vesting-ui.js` 240 (cap-split), `barter-ui.js` PROPOSE enabled.
- Routes: 8 (`#/proposals`, `#/proposals/:id`, `#/tickets`, `#/vesting`,
  `#/authorities`, `#/lists`, `#/airdrop`, `#/invoice[/:data]`).

## Reference behavior (file:line)
- #4 wins throughout; prompt guesses corrected by evidence: op 37 (not 38),
  blind trio 39/40/41 (not 46), authority trio 54/55/56 (not 39–41).
- Blind DOWNSCOPED honestly: commitments + bulletproofs + stealth ECDH have no
  static-page mint (#3 serializes bytes only, #2 needs electron IPC).
- Airdrop = N× op-14 batches (no op); invoice = base58-JSON URLs (not #1 zip —
  foreign URLs surface `invoice-unparseable`, never crash).

## Bugs found by verification, fixed + re-proved
- F1 BLOCKING: `Tx.fee` choked on op-22 `[[flat,[inners]]]` → nested unwrap
  (flat first, inners informational); `feeMulti` same + display-fee fix.
  Sub-cause: null memo objects rejected (`base58str.size`) → empty memo=null.
- F2: fee-payer column blank — chain sends `proposer`, not `fee_paying_account`.
- F3: create confirm lacked per-inner nested rows → added via `extra` slot.
- F4: op-type number → number + name. F5: stale disabled comment updated.
- F6: inner from==to → client gate (chain `transfer.cpp:42`).
- String lock enums (director): node returns `"lock_360_days"`, `lockLabel`
  took ints only → accepts both, rows canonicalize to int (proven live strings).

## Test vectors (raw → human, real files, live testnet)
- Proposal `1.10.1488`: create (inner xfer `10000`→`0.10000 TEST`) fee `4592`→
  `0.04592` — `100932694` (flat accepted, inners NOT added); approve fee `2443` —
  `100932695`; `1.10.1489` create→delete fee `100` — `100932695`.
- Barter op-22 (slice-13 deferred proof): `1.10.1491` inners `[[0,5000],[0,3000]]`,
  fee `7228` — `100932716`. Fee-delta 2636 = ppk size proof.
- Vesting: instant `1.13.885` 20000/fully withdrawn (`100932633-34`); linear
  `1.13.888` ✓; cdd `1.13.889` immediate-withdraw REJECTED
  (`is_withdraw_allowed`), matured withdraw — `100933376` (accrues from deposit).
- Authority `1.17.4`: create fee `530000`→`5.3` — `100932698` (30-day window
  REJECTED `max_custom_authority_lifetime`, 1-day accepted); update fee `110000`,
  delete fee `100000` — `100932699`.
- Whitelist `0→1→0` vs `1.2.25483`, fees 100 — `100932678-700`.
- Airdrop 2×op-14 (10000+5000 p4), total fee 394 (no batch discount) — `100932700`.
- Op-37: no claimable → broadcast correctly gated; fee-0 explicit in confirm.
- Tickets: PROVEN (faucet-funded throwaway `afk-tkt-75a7` 1.2.26837, 1000 TEST):
  op-57 create ticket **`1.18.61`** (1 TEST, 180-day, fee 50) — block `100943508`;
  op-58 update 1→2 (→360-day, fee 50) — block `100943509`; independently
  re-read on-chain (`account 1.2.26837, amount 100000, target lock_360_days`).
  Side log: 2000 faucet TEST orphaned on two keyless throwaways (iteration cost).
- Ambiguities: bare `[t,d]` REJECTED (`bad_cast`), `{op:}` required; op-72
  omit/set both proven (slice 13); maps canonical; TCR ÷1000 both ways.

## Manual test (headless, --network testnet, zero console errors ×13)
- All 8 routes @1440 blue/dark/light + 390: retro shell, connected badge, lock
  gates, trio holds at gate level. Nested renderer: transfer/whitelist/ticket/
  issue rows human, unknown-type fallback honest.

## Tester pass (queued)
- Proposal create→approve→delete + barter PROPOSE + ticket create→update (needs
  funded fixture ≥105 TEST) + vesting/authority/whitelist/airdrop visuals; trio; 390.

## Anti-rot gate (§4.5): (a) yes — static + existing Tx/Chain reuse, no stealth
crypto vendored; (b) nothing new depended on; (c) smallest deletable: invoice
page (proposal core stands). `check_rot.py` PASS.

## R1c trollbox delta (2026-10-01) — on-chain chat reads + UI + posting (op-35 single exception)

> The op-35 exception lives with misc ops (this note), not as its own slice:
> generic custom_operation stays deferred; only chat sub-ids 9198/9199 serialize.
> Reference HEADs: astro-ui `5037d61`, bitshares-core `fe7000c`,
> wallet-extension `ebb7451`. Builder proof is offline vectors + one testnet
> post (below); no human browser pass ran in this round (tester-queued).

### Reference behavior (file:line)
- #2 `astro-ui/src/components/Trollbox.jsx` (dialog chat: channel tabs, lang
  select, 15s poll `POLL_MS`, byte budget from live `maximum_transaction_size`,
  fee via schedule, Beet sign) + `src/nanoeffects/Trollbox.ts` (channels ×10,
  langs ×11, `trollbox-<channel>` legacy / `trollbox-<channel>-<lang>` suffix,
  `get_storage_info` pager 100/page, `trollbox-meta` probe
  supported/missing/error, `cleanMessageText` hardening, storage-id ordering)
  + `src/bts/serializer/customOperations.js` (`TROLLBOX_OP_ID=9199`,
  `FORUM_OP_ID=9198`, op-35 `custom_operation` fee/payer/required_auths/id/data,
  `packAccountStorageMap`).
- #4 `libraries/app/include/graphene/app/api.hpp:650-688`
  (`get_storage_info(account,catalog,key,limit,start_id)`, incl. note 1d
  catalog+key queries) + `libraries/protocol/include/graphene/protocol/custom.hpp`
  FC_REFLECT `(fee)(payer)(required_auths)(id)(data)` + `operations.hpp:91`
  (op 35 = custom_operation).
- #3 `wallet-extension/src/lib/bitshares-api.js:2867-2875` (`serializeCustomOp`
  field order — unanimous with #4).

### Vanilla implementation (file:line)
- `vanilla/js/chain.js` — `custom()` api-id lookup (login
  `"custom_operations"`, same in-flight dedupe as db/history/net) + cache reset.
- `vanilla/js/trollbox.js` (new) — channels/langs/catalog math, pack/unpack
  (hand-ported, per-file provenance @5037d61 in header), decode, clean-text,
  budget, probe, 100/page pager, author enrichment, `buildPost` (9199 only,
  attachments rejected loudly). Text-only v1: attach payloads read as
  attach:null (never raw payload); 9198 serializes, no UI.
- `vanilla/js/tx.js` — `serializeCustomTrollboxOp` (STRICT: id must be
  9198/9199, payer 1.2.N, non-empty auths containing payer, non-empty hex data)
  + dispatch in `serializeTransaction` AND `serializeOperationData` + `OP`
  + `_ser` + header provenance. Generic sub-ids rejected loudly (single
  exception documented at every site).
- `vanilla/js/trollbox-ui.js` (new) — `#/trollbox` desk: channel tabs, lang
  select, plain-text list (`textContent` only + mirrored clean hardening),
  composer (byte counter, live `get_required_fees` preview — NEVER estimated,
  unlock-at-post, broadcast + DIRECT key read-back proof), 15s poll gated on
  `document.visibilitychange`. Reads need no login; reads need a plugin node,
  broadcast works from any.
- Routes/nav: `router.js` `#/trollbox`, `app.js` More-group link, `index.html`
  script tags, 28 `trollbox.*` keys × 10 locale dicts (en-identical honest
  stubs), `app.css` trollbox block (tokens only, 44px targets, phone stack +
  desktop column).

### Bugs found by verification, fixed
- F-TB1 (real, would have missed posts): read-back used the channel pager
  (`fetchChannelMessages(catalog, 1)` = OLDEST 100 rows) — fixed to the direct
  catalog+key query (#4 note 1d) in both `trollbox-ui.js:broadcastPost` and
  `tooling/prove-trollbox-post.cjs`. Pager stays for list reads only.

### Test vectors (offline `tooling/trollbox-test.js` 75/75 GREEN + live)
- Pack/unpack round-trip (incl. UTF-8 + remove=true); unpack nulls (empty, bad
  hex, variant≠0, trailing garbage); catalog en-legacy/de-suffix/unknown→en;
  pair-room valid, `#spoof` rejected; budget 2048→1792, floor 256;
  key shape `t-hex6`; build guards (blank/1024+/budget/attach);
  decode string+object/bad-json/no-text; clean strips tags+links;
  `storageIdNum`; plugin-error map (-32601/method-not-found/not-enabled true,
  timeout false); op-35 bytes contain payer/auths/`EF23` (9199 LE),
  9198 `EE23`, other sub-ids/payer-less/empty-data rejected; `OP 35`;
  nested dispatch ok, op-36 still undispatched; `buildPost` shape + unpacks;
  pager cursor: 150 rows / 2 storage calls / limit 100 / newest-first / names.
- Live (testnet, single post): fee `16213` raw → `0.16213 TEST` (p5,
  `Format.formatAmount`); budget `409344` (live maxTx `409600`); value `102`
  bytes (≤200 rule).

### Testnet single post (exactly ONE — no retries, no second post)
- Post: catalog `trollbox-general`, key `1790853870696-39b881`,
  text `vanilla trollbox probe 2026-10-01 11:24:30` (41 chars, value 102 bytes),
  payer `lite-test-1 (1.2.26833)`, fee `16213` TEST, sent via
  `broadcast_transaction_with_callback` on `wss://testnet.xbts.io/ws`
  (accepted, no node error). Fixture balance before `3844543` raw.
- Read-back: DIRECT key lookup `get_storage_info([null, catalog, key, 1])` →
  `0 rows` at +45s poll AND +~10min (`tooling/trollbox-readback.cjs`, exit 2).
  Node matrix: xbts.io plugin OPEN (probe supported) but key absent;
  `testnet.dex.trading` answers `custom_operations` login with
  `is_allowed: Access denied` (restricted `allowed_apis` — our
  `isPluginMissingError` classifies it "missing", honest empty state).
  Verdict: send accepted, inclusion NOT observed — same discipline as
  `Tx.broadcast` (do NOT rebroadcast). Suspect stale xbts.io fork holding the
  tx in mempool (cf. 2026-09-30 stale-fork note). Litter rule held: ONE post
  total; investigation was read-only.
- Artifacts: `tooling/prove-trollbox-post.cjs` (exit 3 = STOP/queued, exit 0 =
  posted+matched), `tooling/trollbox-readback.cjs` (read-only key lookup).

### Tester pass (queued — exact steps, no owner order needed)
1. Open `#/trollbox` on testnet with a FUNDED account (≥2 TEST), node =
   a plugin-open endpoint (xbts.io has the plugin; if reads stay empty, try
   another node from Settings → Nodes and note which works).
2. Read: channels switch catalogs, lang `de` reads `trollbox-general-de`,
   messages render plain text (no links/HTML), badge Live/Plugin
   unavailable/Node unreachable each honest.
3. Post ≤200 bytes: fee preview appears (never an estimate), unlock, Post →
   `Posted and read back on-chain (…+storage-readback)`, message appears.
4. Themes: ref-ui/vanilla/dex-ux trio + 360–390px phone AND 1440px+ desktop.
5. If the 2026-10-01 key `1790853870696-39b881` ever reads back, record its
   storage id here (late inclusion, still counts as the ONE post).

### Anti-rot gate (§4.5): (a) yes — static files + existing Chain/Tx/Format
reuse, zero new deps, no vendored crypto (pack is integer/string math);
(b) nothing new depended on (node list is data, plugin probe degrades
honestly); (c) smallest deletable: composer (read-only desk stands).
`check_rot.py` PASS, `check_i18n.py` OK (2793 keys, 3756 sites drift-free),
`node --check` clean on all touched JS, `trollbox-test.js` 75/75.
