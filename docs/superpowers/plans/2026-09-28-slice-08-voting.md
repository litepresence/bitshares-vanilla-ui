# Slice 08 (Voting/Governance) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Governance parity with the old UI's voting page at `#/voting`: witness / committee / worker lists with vote-weight display, current-account vote slate + proxy picker, and a publish flow that builds, confirms (human-readable), signs, and broadcasts a real `account_update` (op 6) vote transaction on testnet — then cleans up with an unvote.

**Architecture:** `vote.js` owns all governance chain reads (lists, current votes, proxy account, globals). `vote-ui.js` owns the `#/voting` view (three tabs, search, slate checkboxes, proxy picker, confirm, result). `tx.js` grows ONE serializer (`serializeAccountUpdateOp` + `serializeAccountOptions`, appended only). Signing/broadcast/fee paths are reused untouched.

**Tech Stack:** Vanilla JS + `Chain.call`/`Chain.db` reads + existing `Tx` sign/broadcast + `Format` string math. Node 20 stdlib for checks. Python 3 for rot gate. No new files beyond `vote.js` + `vote-ui.js` (+ parity note); `tx.js` + `index.html` + `router.js` are modified only.

## References (mapped first — evidence, not memory)

Method / op-field table. #4 wins conflicts; testnet confirms.

| # | Item | Value | Source file:line |
|---|---|---|---|
| 1 | Vote tx is op id 6 | `account_update_operation` at position 6 in the op enum | `bitshares-core/.../protocol/operations.hpp:62` (`/* 6 */ account_update_operation`) |
| 2 | Op 6 fields + order | `(fee)(account)(owner?)(active?)(new_options?)(extensions)`; fee payer = `account`; only `new_options` is set by voting (owner/active stay null) | `bitshares-core/.../protocol/account.hpp:151-162`, `:164`, `:174-175` |
| 3 | `account_options` fields + order | `(memo_key)(voting_account)(num_witness)(num_committee)(votes)(extensions)`; `votes` is `flat_set<vote_id_type>`; weight = account's core-asset balance | `bitshares-core/.../protocol/account.hpp:39-59`, `FC_REFLECT .../protocol/account.hpp:282` |
| 4 | Proxy-to-self sentinel | `GRAPHENE_PROXY_TO_SELF_ACCOUNT = account_id_type(5)` → `"1.2.5"`; `voting_account` defaults to it; any other value means "my votes are ignored, my stake follows the proxy" | `bitshares-core/.../protocol/config.hpp:150`, `.../protocol/account.hpp:45-48`, `:62-73` |
| 5 | Sentinel in use (#1) | No-proxy publish sets `new_options.voting_account = "1.2.5"`; account-create default `voting_account: "1.2.5"`; empty-string proxy input maps to `"1.2.5"` | `bitshares-ui/app/components/Account/AccountVoting.jsx:290`, `...:45-46`, `...:121`, `...:136-139`; `bitshares-ui/app/api/ApplicationApi.js:62-68` |
| 6 | `num_witness` / `num_committee` semantics | Counts of active witnesses/committee the account votes to appoint; MUST NOT exceed the actual witness/committee votes inside `votes`; worker votes do not count | `bitshares-core/.../protocol/account.hpp:50-55`; #1 sets them from slate sizes `AccountVoting.jsx:291-292`; #2 same `astro-ui/src/components/Voting.jsx:845-846` |
| 7 | `vote_id_type` wire + JSON | JSON `"type:instance"`; wire u32 = `instance<<8 \| type`; enum `committee=0, witness=1, worker=2`; instances unique across types | `bitshares-core/.../protocol/vote.hpp:42-49`, `:58-70` |
| 8 | Vote-type prefixes in use | #1 keeps worker votes by `"2"` prefix (`AccountVoting.jsx:349-351`); #2 splits `"0:"` committee / `"1:"` witness / `"2:"` worker (`Voting.jsx:818-829`) — both consistent with #4 enum | As cited |
| 9 | Object IDs (NOT vote IDs) | Witness objects `1.6.x`, committee `1.5.x`, workers `1.14.x`; #1 enumerates `1.6.x/1.5.x` object IDs from `2.0.0` active lists +10 (`AccountVoting.jsx:227-266`); #2 scans space 1 / types 6, 5, 14 (`Voting.jsx:404-410`, `:439-445`, `:472-477`) | As cited |
| 10 | List read methods | `get_witnesses`, `get_witness_by_account`, `lookup_witness_accounts(lower,limit≤1000)`, `get_witness_count`; `get_committee_members`, `get_committee_member_by_account`, `lookup_committee_member_accounts`, `get_committee_count`; `get_all_workers(is_expired?)`, `get_workers_by_account`, `get_worker_count`; `lookup_vote_ids(votes)` resolves vote IDs to objects | `bitshares-core/.../app/database_api.hpp:1129-1151`, `:1164-1188`, `:1201-1213`, `:1221-1233`; registered `:1570-1587` |
| 11 | Current-account votes | `account.options.votes` + `options.voting_account` from `get_account_by_name`/`get_accounts`; #1 reads `options.get("votes")` (`AccountVoting.jsx:141-144`); #2 fetches the user object by id (`Voting.jsx:378-382`) | As cited + `vanilla/js/account.js:24-37` resolve pattern |
| 12 | Vote weights (raw stake ints) | `witness_object.total_votes` u64 (`witness_object.hpp:40`); `committee_member_object.total_votes` u64 (`committee_member_object.hpp:49`); `worker_object.total_votes_for/_against` u64 (`worker_object.hpp:130-131`); displayed in CORE precision — #2 uses `humanReadableFloat(x, 5)` (`Voting.jsx:116`, `:194`, `:648-649`); #1 reads `account.get("total_votes")` (`VotingAccountsList.jsx:26`) | `bitshares-core/.../chain/witness_object.hpp:39-40`, `.../chain/committee_member_object.hpp:48-49`, `.../chain/worker_object.hpp:126-131` |
| 13 | Serializer reference (#3) | `serializeAccountUpdateOp`: fee, account, optional owner/active/new_options, empty extensions (`bitshares-api.js:2420-2429`); `serializeAccountOptions`: pubkey, voting_account (default `'1.2.5'`), u16 num_witness, u16 num_committee, varint-counted vote u32s (`"t:i"` → `(t&0xff)\|((i&0xffffff)<<8)`), empty extensions (`bitshares-api.js:2116-2140`) | As cited |
| 14 | #1 broadcast wrapper | `updateAccount(updateObject)` → `tr.add_type_operation("account_update", updateObject)` → `WalletDb.process_transaction(tr, null, true)` (`ApplicationApi.js:486-490`); vanilla equivalent = `Tx` build/sign/broadcast (slices 4/6) | As cited |
| 15 | Fee | `get_required_fees(ops, asset)` at runtime, fee in TEST/BTS per slices 4/6 — never static tables (stale `#3720`) | `bitshares-core/.../app/database_api.hpp:1313`; `vanilla/js/tx.js:44-46` |
| 16 | Confirm-dialog spec (#3) | `popup.js:5764-5770` renders op 6 as Account + raw `JSON.stringify(new_options)` — DELIBERATELY WEAK; vanilla beats it with named rows (proxy name, added/removed per tab, counts, fee) per principle #4 + `transfer-ui.js` confirm pattern | `wallet-extension/src/popup/popup.js:5764-5770`; `vanilla/js/transfer-ui.js:1-30` header |
| 17 | Expired-worker + `vote_against` hygiene | #1 strips expired-worker `vote_for` and legacy `vote_against` before publish (`AccountVoting.jsx:304-325`) — port both | As cited |
| 18 | Proxy UX (#1) | Slate tabs disabled while a proxy is set (`hasProxy ? -1 : 2`, `supported = hasProxy ? proxy_* : own` in `Voting/Witnesses.jsx:78-90`); proxy shown from `options.voting_account` (`AccountVoting.jsx:901`, `AccountPage.jsx:99`) | As cited |

**Recorded ambiguity (NOT guessed — testnet decides, Task 4):** #2's publish payload sets `voting_account: usr.id` (`Voting.jsx:841-850`) while #1 (`AccountVoting.jsx:290`), #2's own account-create path (`background.js:366`), #3's serializer default (`bitshares-api.js:2119`), and #4's struct default (`account.hpp:48`) all use the `"1.2.5"` sentinel. Vanilla publishes with `"1.2.5"` for no-proxy (matches #4+#1+#3). If the testnet node rejects it, retry with self-id, record the outcome in the parity note, and treat testnet as winner per `mapping-chain-calls`.

**Percent-math note (principle #6):** `account_options` contains NO hundredths-scaled field (verify #3 above: memo_key / voting_account / num_witness / num_committee / votes only). Vote weights are raw core-precision ints; any vote-share `%` shown is computed display-side from integer ratios (`share_bp = total*10000/stake`, formatted without float) with `GRAPHENE_100_PERCENT=10000` as the basis (`config.hpp:102-103`). A slice rendering a raw integer anywhere is not done.

## Global Constraints

- Zero runtime dependencies; platform APIs only; `python3 -m http.server`-servable. No new crypto (serialize + sign via existing `Tx`/`Crypto` only).
- All money/weight math through `Format` (`formatAmount` core p5; string/int ratios for percents) — never inline `/ Math.pow(10, precision)` (audit greps).
- One new file pair only: `vote.js` (reads) + `vote-ui.js` (view). Serializer appends inside `tx.js` (one op per slice, standing rule). `index.html` gains two `<script>` tags; `router.js` wires `#/voting` from stub to view. Nothing else touched.
- Route `#/voting` stub already exists (`vanilla/js/router.js:93`); nav link already exists (`vanilla/index.html:22`).
- Test keys only on testnet. Publish on a SMALL/test account (`lite-test-1` fixture per SLICES.md standing facts), then unvote cleanup in the same session (slate restored + unpublish or proxy cleared — chain left as found).
- Viewports 360px→1440px minimum (2560px where dense tables allow); touch targets ≥44px in ≥1 dimension; no hover-only UI. Three themes via existing tokens (no new palette values).
- One global per file + `module.exports` guard (existing convention). Module headers + function descriptions per §3.7; no dead text, no TODOs.

---

## File Structure

```
vanilla/
├── index.html            ← Task 3 (TWO script tags: vote.js BEFORE vote-ui.js, both BEFORE router.js)
├── js/
│   ├── tx.js             ← Task 1 (APPEND serializeAccountOptions + serializeAccountUpdateOp + op-6 dispatch; nothing else)
│   ├── vote.js           ← Task 2 (CREATE: chain reads)
│   ├── vote-ui.js        ← Task 3 (CREATE: #/voting view)
│   └── router.js         ← Task 3 (MODIFY: /voting stub → VoteUI.renderVoting)
└── notes/
    └── slice-08-voting.md ← Task 4: parity note
```

**Task ordering:** Task 1 (serializer) → Task 2 (reads) → Task 3 (view) → Task 4 (verify + parity + audit). Tasks 1–2 are independently checkable with `node --check` + read-only testnet probes; Task 3 needs 1+2; Task 4 needs all.

---

### Task 1: Op-6 serializer in `tx.js` (append only)

**Files:**
- Modify: `vanilla/js/tx.js` (append `serializeAccountOptions` + `serializeAccountUpdateOp`, register op 6 in the op dispatch + fee-shape path; NOTHING else).

**Spec (from References #2, #3, #7, #13 — port the bytes, not the files):**
- `serializeAccountOptions(opts)`: `serializePublicKey(memo_key)` → `serializeObjectId(voting_account || "1.2.5")` → u16 `num_witness` → u16 `num_committee` → varint count + u32 per vote (`"t:i"` string → `(t&0xff)|((i&0xffffff)<<8)`, `writeUint32LE`) → empty extensions. Votes MUST be sorted ascending by (type, instance) before serializing (#1 `AccountVoting.jsx:354-361`).
- `serializeAccountUpdateOp(op)`: `serializeAssetAmount(fee)` → `serializeObjectId(account)` → optional owner (null) → optional active (null) → optional new_options → empty extensions. Field order per #4 (`account.hpp:151-162`) confirmed by #3 (`bitshares-api.js:2420-2429`).
- BJS cross-check (per `mapping-chain-calls` step 2): fetch the single upstream `bitsharesjs` operations/serializer raw file on demand and confirm the op-6 field order matches #3/#4; record URL + commit/HEAD date in the parity note. If BJS disagrees with #4, #4 wins — note the conflict, do NOT follow BJS.
- Fee shape: `get_required_fees` with `[[6, opData]]` in TEST/BTS (existing `Tx.fee` path; extend the op-id→op-data fee map, no new fee code).

- [ ] **Step 1: Implement** (~60 lines, tx.js header provenance comment extended with the two #3 source lines + #4 field-order lines).
- [ ] **Step 2: Syntax + vector check** — `node --check js/tx.js`, exit 0. Offline vector: serialize a fixture `{account:"1.2.x", new_options:{memo_key, voting_account:"1.2.5", num_witness:1, num_committee:0, votes:["1:5","0:3","2:9"]}}` and assert deterministic bytes across two runs + vote-u32 spot values (`"1:5"` → `0x0501`, `"0:3"` → `0x0300`, `"2:9"` → `0x0902` little-endian). Record the hex in the report. NO broadcast in this task.

**Acceptance:** `node --check` green; fixture bytes deterministic; vote-u32 spot values exact; no other `tx.js` behavior changed (transfer/trade paths re-`node --check`ed).

---

### Task 2: `vote.js` — governance chain reads (one purpose: reads)

**Files:**
- Create: `vanilla/js/vote.js` (global `Vote`, `module.exports` guard, §3.7 header).

**Interface (all return plain JSON, throw named errors `not-connected` / `unknown-account` / `empty-list`):**
- `Vote.lists()` → `{witnesses, committee, workers}` where each entry is `{id, account_id, name, vote_id, total_raw (int string), active bool, url, extra}`:
  - Witnesses: `get_witness_count` → `get_objects` batches of `1.6.0..N` (cap: stop after first all-null batch tail; page ≤50 ids/call) → `get_accounts`/`get_objects` join for `witness_account` names → `active` from `2.0.0.active_witnesses`. Fallback if count missing: `lookup_witness_accounts("", 100)` paging.
  - Committee: same pattern via `get_committee_count` / `1.5.x` / `2.0.0.active_committee_members` / `lookup_committee_member_accounts`.
  - Workers: `get_all_workers(false)` (non-expired only; #2 `WorkerProposals.ts:28`) + `get_workers_by_account` NOT needed; join names; carry `work_begin_date/work_end_date/daily_pay/total_votes_for/total_votes_against` raw.
  - `total_raw` stays a STRING until render; `active` preserved per row (retro parity: #1 marks actives in `VotingAccountsList`).
- `Vote.currentVotes(accountId)` → `{voting_account, voting_account_name ("" when `"1.2.5"`), num_witness, num_committee, votes:[...], byType:{committee:[], witness:[], worker:[]}}` via `get_accounts[[id]]` → `options`; split votes by `"t:"` prefix per Reference #8; resolve proxy name via `Account.resolve` (empty when sentinel).
- `Vote.fee(accountId, newOptions)` → raw fee string via `get_required_fees([[6, {fee:{amount:"0",asset_id:core}, account:accountId, new_options:newOptions}]], coreAssetId)` (existing `Tx.fee` helper if it covers op 6 after Task 1, else direct `Chain.call` — reuse, don't duplicate).
- `Vote.publish(accountId, {proxyIdOrNull, witnessIds, committeeIds, workerVoteIds, memoKey})` → builds `{fee, account, new_options:{memo_key, voting_account: proxy||"1.2.5", num_witness: witnessIds.length, num_committee: committeeIds.length, votes: sorted}}` with expired-worker + `vote_against` stripping (Reference #17), then `Tx.sign+broadcast` with the unlocked active key. NO DOM, NO key handling beyond what `Tx` already does.

- [ ] **Step 1: Implement** (~200 lines max; past ~400 split is n/a — file is new and scoped).
- [ ] **Step 2: Syntax + read-only probe** — `node --check js/vote.js`, exit 0; against testnet (no signing): `lists()` returns non-empty witnesses+committee on testnet (workers MAY be empty — valid), `currentVotes("1.2.5"→ sentinel name "")`, one `lookup_vote_ids` round-trip resolving a known vote id. Record counts + one sample row per list.

**Acceptance:** read-only probe green on testnet; weights are raw strings (no float); empty worker list handled, not crashed; proxy sentinel resolves to `""`.

---

### Task 3: `vote-ui.js` — `#/voting` view (one purpose: the voting screen)

**Files:**
- Create: `vanilla/js/vote-ui.js` (global `VoteUI.renderVoting(root)`, `module.exports` guard, §3.7 header).
- Modify: `vanilla/index.html` (TWO script tags, order: `vote.js` then `vote-ui.js`, both before `router.js`); `vanilla/js/router.js` (`/voting` stub → `VoteUI.renderVoting`; one line, `:93`).

**Layout (retro parity with #1 `AccountVoting` + tabs, modern glow per principle #4):**
- Account strip: voting-as account (defaults to wallet account via `Account.myAccountId`, else name input + resolve; locked-wallet gate per `transfer-ui.js` pattern) + current proxy display + [Publish] [Reset] (dirty-tracked via `isChanged` equivalent: proxy/slate vs last-published snapshot).
- Proxy picker: text input with search (resolve via `Account.resolve`, ≥44px, keyboard-friendly list of matches — NO hover-only dropdown) + [Set proxy] [Remove proxy]; when a proxy is set, slate checkboxes render DISABLED with the proxy's slate shown read-only (Reference #18 `hasProxy` pattern).
- Three tabs (Witnesses / Committee / Workers, #1 `AccountVoting.jsx:59-78` order): each a searchable table — name, id, weight (human via `Format.formatAmount(total_raw, 5)` + share-% from integer hundredths math), active marker, vote checkbox; workers add `daily_pay` (human p5), dates, for/against. Phone: tables stack to cards; desktop: full columns.
- Publish flow: validate (`num_witness/committee` ≤ slate counts — enforced by construction; at least one change vs snapshot) → confirm dialog (transfer-ui pattern) with NAMED rows: proxy name (or "none — voting directly"), added/removed names per tab, final counts, fee (human) + network — never raw `JSON.stringify` (beats Reference #16) → `Vote.publish` → result panel (block # + position, same convention as transfer result; no fabricated txid).
- Empty states everywhere: no wallet account, node down (offline panel + Retry per slice-1 pattern), empty worker list, no search hits, proxy has no votes.

- [ ] **Step 1: Implement** (~350 lines max).
- [ ] **Step 2: Syntax checks** — `node --check` all touched JS, exit 0; `router.match("/voting")` resolves to the new renderer (headless `node` smoke like slice-04).

**Acceptance:** `#/voting` renders with no console errors on a connected testnet node AND shows the offline panel when disconnected; proxy set disables slates; confirm shows names+counts+fee; all numbers human-formatted (spot-check: a `total_votes` of `123456789` renders `1234.56789`, never the raw int).

---

### Task 4: Verify, parity note, audit, gate

**Files:**
- Create: `vanilla/notes/slice-08-voting.md` (seven-field parity contract + §3.7 + §4.5(a–c)).

- [ ] **Step 1: Testnet vote round-trip (SMALL account, cleanup mandatory)** — on `lite-test-1` (or a fresh faucet sub-account if slate pollution is a concern): (a) record pre-state (`currentVotes`); (b) publish a MINIMAL vote (e.g. 1 testnet witness + `num_witness:1`, or set+clear a proxy — whichever touches less state); (c) capture fee observed + block # + position; (d) re-read `currentVotes` and assert the slate matches; (e) UNVOTE (restore pre-state slate, or clear proxy to `"1.2.5"`) + re-verify restoration. If the `"1.2.5"` publish is rejected, retry once with self-id per the recorded ambiguity and log which the chain accepted.
- [ ] **Step 2: Raw→human vectors** — in the parity note: `total_votes` (witness + committee + worker for/against) incl. a non-p5-amount case is n/a (weights are core p5 — state that) + one share-% hundredths computation (`part/whole` → expected `x.xx%`); fee raw→human; `vote_id` `"t:i"` → u32 spot values from Task 1.
- [ ] **Step 3: Rot gate** — `python3 tooling/check_rot.py` exit 0; float-money grep CLEAN (any `Math.*` hit listed as pixels/none with file:line or removed); new files have headers + function descriptions; no TODO/FIXME.
- [ ] **Step 4: Headless shots (dev server + shot.mjs, READ them)** — `#/voting` @1440 + @390, original-blue + dark (+ light if cheap), tabs + confirm dialog visible; compare against `original-pages/` voting capture (or #1 `AccountVoting` layout notes if no capture exists); fix NOTHING in code (report findings); record.
- [ ] **Step 5: Parity note** — seven fields: reference file:lines (table above, plus BJS URL+date from Task 1), vanilla file:lines, manual test steps + observed result (broadcast block #s, fee, pre/post slates, cleanup proof), vectors, theme trio + both viewports (browser-dependent honestly PENDING-BROWSER with tester steps), §3.7 checklist, §4.5(a–c) incl. "serializer grows one op" justification + the `voting_account` ambiguity outcome.
- [ ] **Step 6: Audit** — all eight checks (browser-dependent honestly PENDING-BROWSER, queued in the note). No slice 9 until green-minus-browser.

**Acceptance:** round-trip + cleanup proven on-chain with block #s; parity note complete; rot gate green; tester browser pass queued.

---

## Anti-rot gate (AGENTS.md §4.5 — answers required in the parity note)

- **(a) 2036 test:** `vote.js`/`vote-ui.js` are plain scripts with no imports, no build, no framework; the op-6 bytes are pinned serializer code with per-function provenance (Task 1 header), not a library call — a decade-old copy still serializes identically because the chain's `FC_REFLECT` order is consensus-frozen. What could break: node WS endpoints (data, not code — editable node list covers it).
- **(b) New dependencies:** none. New chain surface: six read methods + one op, all through the single `Chain` module (no new socket code). BJS consulted raw on demand (Task 1) — read, never vendored, never imported.
- **(c) Smallest deletable subset:** the Workers tab + share-% column + proxy search (keep: witness/committee checkboxes + raw publish) — kept because #1 shows all three tabs together and weights without context invite mis-votes; if the slice overruns, defer worker *details* (dates/pay) first, never the unvote-cleanup step.
