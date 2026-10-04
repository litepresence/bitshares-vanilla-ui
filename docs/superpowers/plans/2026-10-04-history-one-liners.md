# History One-Liners Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every account-history row renders a one-line human summary (`_summary`) for all 78 op tags, with honest fallbacks, behind 2 bounded RPCs per page.

**Architecture:** New `HistorySummary.enrich(rows, viewedAcctId)` runs between fetch and `renderHistory` (single call-site change in `account-ui.js:loadHist`). Generic id-collect, batch join over a chain-keyed asset cache (boot-seeded from a generated mainnet pool-asset table), ~24 explicit per-family summarizers, label-only fallback. Enrich never rejects.

**Tech Stack:** Vanilla JS (ES5 `var`, classic script tags), Node stdlib tests (`node tooling/*-test.js`), Python stdlib i18n one-shots, `get_accounts` / `lookup_asset_symbols` chain reads only.

## Global Constraints

- Zero runtime dependencies: no `package.json`, no npm, no CDN, no framework in `vanilla/` (`python3 tooling/check_rot.py` green).
- All money math through `vanilla/js/api/format.js`; never `amount / Math.pow(10, precision)` outside it.
- Never a raw chain integer as a displayed value; raw rides `title` attributes only.
- Every user-visible string via `t(key, default)` with byte-identical default; new keys added to all 12 `vanilla/locales/*.json` (stubs = English) so `python3 tooling/check_i18n.py` stays green.
- JSDoc `@param`/`@returns` on touched seams; `bash tooling/check_types.sh` green; new globals declared in `vanilla/js/globals.d.ts` (dev-only, never a script tag).
- Never edit `reference/` (read-only); never paste mainnet keys; testnet only.
- No `TODO`/`FIXME` markers in shipped code; every file keeps its module header; comments explain WHY.

---

## File structure

- Create `vanilla/js/api/history-summary.js` — owns `enrich`, id-collect, joins, asset-meta cache, ~24 family summarizers, shared `amount`/`name` helpers. Consumes `Chain`, `Format`, `I18n.t` (guarded). Exposes global `HistorySummary`.
- Create `vanilla/js/api/pool-assets.js` — GENERATED data-only file: provenance header + `PoolAssets = { chain_id, assets: {...} }`. Never hand-edited.
- Create `tooling/generate_pool_assets.mjs` — pages mainnet `list_liquidity_pools`, joins symbols, writes `pool-assets.js`. Stdlib + WS only (follow `tooling/ws-probe.mjs` precedent).
- Create `tooling/history-summary-test.js` — offline vectors per family + adversarial vectors. Stdlib `assert` only.
- Create `tooling/add_history_templates_i18n.py` — one-shot key adder (follow `tooling/add_history_oplabels_i18n.py` anchor pattern).
- Modify `vanilla/js/views/account-ui.js:1332-1335` — call `enrich` before `renderHistory`.
- Modify `vanilla/js/views/account-history.js` `renderHistory` — headline prefers `row._summary`.
- Modify `vanilla/index.html` — add `<script src="js/api/pool-assets.js">` before `history-summary.js`; add `history-summary.js` after `account.js` (line 82).
- Modify `vanilla/js/globals.d.ts` — add `declare var HistorySummary: any;` and `declare var PoolAssets: any;` (alpha spots).

---

### Task 1: Pool-assets seed (data + generator)

**Files:**
- Create: `tooling/generate_pool_assets.mjs`
- Create: `vanilla/js/api/pool-assets.js` (by running the generator; committed)
- Test: manual run + `node -e` shape check (no new test file; generator output asserted in Task 6 gates)

**Interfaces:**
- Consumes: mainnet WS node, `list_liquidity_pools`, `lookup_asset_symbols` (same calls as `Pool.list`).
- Produces: `PoolAssets = { chain_id: "chain-id-hex", generated_block: N, assets: { "1.3.x": { sym, prec } } }`.

- [ ] **Step 1: Write the generator**

Follow `tooling/ws-probe.mjs` WS handshake (login → database api id). Page `list_liquidity_pools` from `1.19.0` in chunks of 100 until a short page; collect `asset_a/asset_b/share_asset` ids; single `lookup_asset_symbols` for the union; emit the file below. Cap: if pools exceed 2000, stop with a non-zero exit and print the count (owner then decides the cap; do not silently truncate).

```js
// tooling/generate_pool_assets.mjs (sketch — adapt to ws-probe.mjs framing)
import { requestNode, rpc } from "./ws-probe.mjs"; // if not exported, inline the ~30-line handshake instead; no new deps
const HEADER = (chainId, block, date) =>
`/* pool-assets.js — GENERATED mainnet pool-asset seed (do not hand-edit).
 * Owns: PoolAssets { chain_id, generated_block, assets } for HistorySummary
 *   cache seeding. Regenerate: node tooling/generate_pool_assets.mjs
 *   (queries live mainnet; values are issuance-immutable so the file can't
 *   go wrong, only incomplete — misses fall through to live joins).
 * Source: list_liquidity_pools + lookup_asset_symbols @ block ${block}, ${date}, chain ${chainId}.
 * Consumes: nothing. Side effects: none (data only). */
`;
```

- [ ] **Step 2: Run it and inspect the output**

Run: `node tooling/generate_pool_assets.mjs > /tmp/pool-assets.js && head -n 20 /tmp/pool-assets.js && wc -l /tmp/pool-assets.js`
Expected: provenance header + `var PoolAssets = ...`; asset count printed to stderr. If mainnet is unreachable, record the exact error and retry once on another default node before stopping.

- [ ] **Step 3: Commit the generated file**

Run: `cp /tmp/pool-assets.js vanilla/js/api/pool-assets.js && python3 tooling/check_rot.py`
Expected: ROT CHECK PASSED.

```bash
git add tooling/generate_pool_assets.mjs vanilla/js/api/pool-assets.js
git commit -m "feat(history): generated mainnet pool-asset seed + generator"
```

---

### Task 2: Skeleton (collect + join + cache + wiring)

**Files:**
- Create: `vanilla/js/api/history-summary.js`
- Create: `tooling/history-summary-test.js` (skeleton vectors: label-only fallback + never-rejects)
- Modify: `vanilla/js/views/account-ui.js:1332-1335`, `vanilla/js/views/account-history.js` (headline), `vanilla/index.html`, `vanilla/js/globals.d.ts`

**Interfaces:**
- Consumes: `Chain.db()`, `Chain.call(dbId, "lookup_asset_symbols", [ids])`, `Chain.call(dbId, "get_accounts", [ids])`, `Format.formatAmount`, `PoolAssets` (optional global), guarded `I18n.t` via local `t()` copy (same convention as `account-history.js:30-35`).
- Produces: `HistorySummary.enrich(rows, viewedAcctId) -> Promise<rows>` (same array, `_summary` set or absent; never rejects).

- [ ] **Step 1: Write the failing test**

```js
// tooling/history-summary-test.js
"use strict";
var assert = require("assert");
global.Chain = { db: function () { return Promise.resolve(1); },
  call: function () { return Promise.resolve([]); } };
global.Format = { formatAmount: function (raw, prec) { return raw + "@" + prec; } };
var HS = require("../vanilla/js/api/history-summary.js");
var rows = [{ id: "1.11.1", block_num: 1, op: [999, {}] }];
HS.enrich(rows, "1.2.0").then(function (out) {
  assert.strictEqual(out, rows, "same array");
  assert.ok(!out[0]._summary, "unknown tag stays label-only");
  console.log("history-summary skeleton: 2 passed");
}).catch(function (e) { console.error("FAIL", e); process.exit(1); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tooling/history-summary-test.js`
Expected: FAIL with "Cannot find module .../history-summary.js".

- [ ] **Step 3: Write minimal implementation**

```js
/* history-summary.js — one-line human summaries for account-history rows.
 * Owns: enrich() (collect ids -> 2 batch joins over a chain-keyed
 *   asset-meta cache boot-seeded from PoolAssets on matching chain_id ->
 *   per-family summarizers -> row._summary), shared amount()/name()
 *   helpers. Label-only fallback for anything unrecognized; enrich never
 *   rejects (degraded rows render as today). No DOM, no signing.
 * Consumes: Chain.db/.call, Format.formatAmount, PoolAssets (optional),
 *   I18n.t (guarded local copy). Exposes global HistorySummary.
 * Created by: history one-liners plan (spec docs/superpowers/specs/2026-10-04-history-one-liners-design.md). */
var HistorySummary = (function () {
  "use strict";
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    return dflt;
  }
  var ID_RE = /\b1\.(2|3|19)\.\d+\b/g;
  var _assetCache = {}; // "chainId|assetId" -> { sym, prec }
  var _chainId = null;

  /* Current chain id string, or null when unreadable (cache stays empty). */
  function chainId() {
    try {
      if (typeof Chain !== "undefined" && Chain && typeof Chain.id === "function") return Chain.id();
      if (typeof Chain !== "undefined" && Chain && typeof Chain.chainId === "string") return Chain.chainId;
    } catch (e) { /* null below */ }
    return null;
  }
  /* Seed the cache from the generated table on matching chain only. */
  function seedFromTable(id) {
    try {
      if (typeof PoolAssets === "undefined" || !PoolAssets || !PoolAssets.assets) return;
      if (!id || PoolAssets.chain_id !== id) return;
      var table = PoolAssets.assets, k;
      for (k in table) {
        if (Object.prototype.hasOwnProperty.call(table, k) && table[k]) {
          _assetCache[id + "|" + k] = { sym: String(table[k].sym), prec: table[k].prec };
        }
      }
    } catch (e) { /* live joins cover */ }
  }
  /* Collect every 1.2.x/1.3.x/1.19.x id in the page payloads (generic pass). */
  function collect(rows) {
    var out = { acc: [], asset: [], pool: [] }, seen = {};
    (rows || []).forEach(function (r) {
      var s = "";
      try { s = JSON.stringify(r.op); } catch (e) { s = ""; }
      var m = s.match(ID_RE) || [];
      m.forEach(function (id) {
        if (seen[id]) return; seen[id] = 1;
        if (id.indexOf("1.2.") === 0) out.acc.push(id);
        else if (id.indexOf("1.3.") === 0) out.asset.push(id);
        else out.pool.push(id);
      });
    });
    return out;
  }
  /* Two batch joins; misses stay missing; never throws. */
  async function join(ids, id) {
    var assets = {}, names = {};
    try {
      if (ids.asset.length) {
        var uncached = ids.asset.filter(function (a) { return !(_assetCache[(id || "") + "|" + a]); });
        if (uncached.length) {
          var dbId = await Chain.db();
          var objs = await Chain.call(dbId, "lookup_asset_symbols", [uncached]);
          (objs || []).forEach(function (a) {
            if (a && a.id && typeof a.precision === "number") {
              _assetCache[(id || "") + "|" + a.id] = { sym: a.symbol || a.id, prec: a.precision };
            }
          });
        }
        ids.asset.forEach(function (a) {
          var hit = _assetCache[(id || "") + "|" + a];
          if (hit) assets[a] = hit;
        });
      }
    } catch (e) { /* assets stay missing */ }
    try {
      if (ids.acc.length) {
        var dbId2 = await Chain.db();
        var rows = await Chain.call(dbId2, "get_accounts", [ids.acc]);
        (rows || []).forEach(function (a) { if (a && a.id) names[a.id] = a.name || a.id; });
      }
    } catch (e) { /* names stay missing */ }
    return { assets: assets, names: names };
  }
  /* {amount, asset_id} -> human string or em dash (never raw). */
  function amount(leg, assets) {
    if (!leg || leg.amount === undefined || leg.amount === null || !leg.asset_id) return t("settings.dash", "—");
    var meta = (assets || {})[String(leg.asset_id)];
    if (!meta || typeof meta.prec !== "number" || !/^-?\d+$/.test(String(leg.amount))) return t("settings.dash", "—");
    try { return Format.formatAmount(String(leg.amount), meta.prec) + " " + meta.sym; }
    catch (e) { return t("settings.dash", "—"); }
  }
  /* Account id -> name or raw id (identifiers may show raw; money may not). */
  function name(id, names) { return (names && names[id]) || String(id); }
  /* Op tag number from a history row (same shapes as opTypeOf). */
  function tagOf(row) {
    if (!row || typeof row !== "object") return null;
    if (Array.isArray(row.op) && typeof row.op[0] === "number") return row.op[0];
    if (typeof row.op_type === "number") return row.op_type;
    if (typeof row.type === "number") return row.type;
    return null;
  }
  /* Family dispatch table is filled by Tasks 3-5; unknown -> no summary. */
  var SUMMARIZERS = {};
  /* Enrich rows in place (adds _summary); never rejects. */
  async function enrich(rows, viewedAcctId) {
    try {
      var id = chainId();
      seedFromTable(id);
      var ids = collect(rows);
      var J = await join(ids, id);
      (rows || []).forEach(function (r) {
        try {
          var tag = tagOf(r);
          var fn = (tag !== null && SUMMARIZERS[tag]) || null;
          if (fn) {
            var s = fn(r.op && r.op[1], J, viewedAcctId);
            if (typeof s === "string" && s) r._summary = s;
          }
        } catch (e) { /* label-only fallback stands */ }
      });
    } catch (e) { /* rows render as today */ }
    return rows;
  }
  return { enrich: enrich, _test: { collect: collect, amount: amount, name: name, tagOf: tagOf, SUMMARIZERS: SUMMARIZERS } };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.HistorySummary === "undefined") { globalThis.HistorySummary = HistorySummary; }
if (typeof module !== "undefined") { module.exports = HistorySummary; }
```

Note: `Chain.id()` may not exist — verify against `vanilla/js/sdk/chain.js` (`rg -n "function id|chainId|getChainId" vanilla/js/sdk/chain.js`) and use the real accessor; fallback chain is the try/catch returning null (cache keyed `"|id"`, still correct within a session).

- [ ] **Step 4: Wire the caller + headline + tags, run tests**

In `vanilla/js/views/account-ui.js` `loadHist`, replace `AccountUI._history.renderHistory(doc, histBody, rows);` with:

```js
Promise.resolve(rows).then(function (r2) {
  if (typeof HistorySummary !== "undefined" && HistorySummary && typeof HistorySummary.enrich === "function") return HistorySummary.enrich(r2, acct.id);
  return r2;
}).then(function (r3) {
  histRowsCache = Array.isArray(r3) ? r3 : [];
  AccountUI._history.renderHistory(doc, histBody, r3);
});
```

Keep the existing `histRowsCache = ...` line replaced (not duplicated). In `renderHistory` (`account-history.js:233-235`), headline becomes `(row._summary || (n === null ? ... : opLabel(n)))`. Add script tags + `globals.d.ts` entries. Run: `node tooling/history-summary-test.js`, `bash tooling/check_types.sh`, `python3 tooling/check_rot.py`. Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add vanilla/js/api/history-summary.js tooling/history-summary-test.js vanilla/js/views/account-ui.js vanilla/js/views/account-history.js vanilla/index.html vanilla/js/globals.d.ts
git commit -m "feat(history): one-liner skeleton (collect/join/cache/wiring, label fallback)"
```

---

### Task 3: Daily-eight families + template keys

**Files:**
- Modify: `vanilla/js/api/history-summary.js` (SUMMARIZERS for tags 0,1,2,77,3,4,19,6), `tooling/history-summary-test.js` (vectors)
- Create: `tooling/add_history_templates_i18n.py`; run it (12 locales)

**Interfaces:**
- Consumes: Task 2 helpers (`amount`, `name`, `t`).
- Produces: 8 template keys `account.sum_*` + summaries for the 8 tags.

Field paths (verify each with `grep -rn "struct <name>_operation" reference/bitshares-core/libraries/protocol/` before coding; `#4` wins any conflict):
- 0 transfer: `p.from, p.to, p.amount{amount, asset_id}`. Direction vs `viewedAcctId` (compare raw ids AND resolved names — viewed may be name form; normalize by comparing `String(viewed)` to both `p.from` and `J.names[p.from]`).
- 1 limit_order_create: `p.seller, p.amount_to_sell{...}, p.min_to_receive{...}` → "Offered A for at least B".
- 2 limit_order_cancel: `p.fee_paying_account, p.order` → "Cancelled order X".
- 77 limit_order_update: same legs as 1 (verify struct first) → "Updated order X: ...".
- 3 call_order_update: `p.funding_account, p.delta_collateral{...}, p.delta_debt{...}` (SIGNED — show `+`/`−`, verify sign encoding in `operations.hpp`).
- 4 fill_order: `p.account_id, p.pays{...}, p.receives{...}` → "Filled: paid A, received B".
- 19 asset_publish_feed: `p.publisher, p.asset_id` (+ asset symbol from join) → "Feed published for SYM by name".
- 6 account_update: `p.account` → "Account updated: name" (proxies/votes change; no field claims beyond the account).

Templates (exact defaults; placeholders byte-verbatim):
- `account.sum_transfer_send` = `Sent %(amount)s to %(to)s`
- `account.sum_transfer_recv` = `Received %(amount)s from %(from)s`
- `account.sum_transfer` = `Transfer %(amount)s from %(from)s to %(to)s` (neither side is the viewer)
- `account.sum_order_create` = `Offered %(sell)s for at least %(buy)s`
- `account.sum_order_cancel` = `Cancelled order %(order)s`
- `account.sum_order_update` = `Updated order %(order)s`
- `account.sum_call_update` = `Adjusted position: %(coll)s collateral, %(debt)s debt`
- `account.sum_fill` = `Filled: paid %(pays)s, received %(receives)s`
- `account.sum_feed` = `Feed published for %(asset)s by %(publisher)s`
- `account.sum_account_update` = `Account updated: %(account)s`

- [ ] **Step 1: Add keys via one-shot** (follow `add_history_oplabels_i18n.py`: anchor-computed inserts into the `account` dict + dotted registry; verify with `check_i18n.py`).
- [ ] **Step 2: Write failing vectors** (one per tag + transfer direction trio + precision-miss dash on tag 0 with unknown asset).
- [ ] **Step 3: Run to verify they fail** (`node tooling/history-summary-test.js`, expect assertion on missing `_summary`).
- [ ] **Step 4: Implement summarizers + run green** (also `check_types.sh`, `check_i18n.py`).
- [ ] **Step 5: Commit** (`git commit -m "feat(history): daily-eight one-liners (transfer/orders/fill/feed/update)"`).

---

### Task 4: Pool / asset / credit / Same-T / debit families

**Files:** same as Task 3 (no new files except vectors appended).

Field paths (verify against `reference/bitshares-core/libraries/protocol/` first):
- 59 pool_create: `p.account, p.asset_a, p.asset_b` (ids; symbols via join) → `account.sum_pool_create` = `Created pool %(a)s / %(b)s`.
- 60 pool_delete: `p.account, p.pool` → `Deleted pool %(pool)s`.
- 61 pool_deposit: `p.account, p.pool, p.amount_a{...}, p.amount_b{...}` → `Staked %(a)s + %(b)s in pool %(pool)s`.
- 62 pool_withdraw: `p.account, p.pool, p.share_amount{...}` → `Unstaked %(shares)s from pool %(pool)s` (share asset symbol via join on the pool's share id — collect() already grabs `1.3.x`; pool share id is NOT in the payload, so use the amount's own `asset_id`, which IS the share asset).
- 63 pool_exchange: `p.account, p.pool, p.amount_to_sell{...}, p.min_to_receive{...}` → `Swapped %(sell)s → at least %(buy)s in pool %(pool)s`.
- 75 pool_update: `p.account, p.pool` → `Updated pool %(pool)s`.
- 10 asset_create: `p.issuer, p.symbol, p.precision` (inline! no join needed) → `Created asset %(symbol)s`.
- 11 asset_update / 48 issuer_update: `p.asset_to_update` (+ symbol via join) → `Updated asset %(asset)s` / `New issuer for %(asset)s: %(issuer)s`.
- 12 smartcoin_update: `p.asset_to_update` → `Updated smartcoin %(asset)s`.
- 13 feed_producers: `p.asset_to_update` + count of `p.new_feed_producers` → `Set %(n)s feed producers for %(asset)s`.
- 14 asset_issue: `p.issue_to_account, p.asset_to_issue{...}` → `Issued %(amount)s to %(to)s`.
- 15 asset_burn: `p.payer, p.amount_to_reserve{...}` → `Burned %(amount)s`.
- 16 fee_pool_fund: `p.from_account, p.asset_id, p.amount` (amount is BARE integer + separate asset_id — pair them explicitly, never assume) → `Funded fee pool of %(asset)s with %(amount)s`.
- 17 asset_settle: `p.account, p.amount{...}` → `Requested settlement of %(amount)s`.
- 18 global_settle: `p.asset_to_settle` → `Globally settled %(asset)s`.
- 42 settle_cancel: `p.account, p.amount{...}` → `Cancelled settlement of %(amount)s`.
- 43/47 claim: `p.issuer, p.amount_to_claim{...}` → `Claimed %(amount)s in fees`.
- 64–68 samet: `p.owner`/`p.borrower`, fund id, `{borrow,repay}_amount{...}` + `p.collateral{...}` → e.g. `Borrowed %(amount)s against %(coll)s (fund %(fund)s)`.
- 69/70/71 offer create/delete/update: `p.owner_account`, offer id or `p.asset_type`+`p.balance` → `Created credit offer in %(asset)s` / `Deleted offer %(offer)s` / `Updated offer %(offer)s`.
- 72 accept: `p.borrower, p.offer_id, p.borrow_amount{...}, p.collateral{...}` → `Borrowed %(amount)s against %(coll)s (offer %(offer)s)`.
- 73 repay: `p.account, p.deal_id, p.repay_amount{...}` → `Repaid %(amount)s on deal %(deal)s`.
- 76 deal_update: `p.account, p.deal_id` → `Updated deal %(deal)s`.
- 74 deal_expired (virtual): ids only → `Deal %(deal)s expired`.
- 25–28 debit: `p.from`/`withdraw_from_account, p.authorized_account, p.withdrawal_limit{...}` (verify field names per tag — create vs claim differ) → `Authorized %(amount)s debit for %(to)s` / `Claimed %(amount)s debit`.

Steps mirror Task 3 (keys → vectors → fail → implement → green → commit `feat(history): pool/asset/credit/samet/debit one-liners`).

---

### Task 5: Governance / HTLC / tickets / vesting / proposals / misc / blind

**Files:** same as Task 3.

Field paths (verify first):
- 20 witness_create: `p.witness_account` → `Became witness: %(account)s`. 21 witness_update → `Updated witness %(account)s`.
- 29/30 committee_create/update: same shape → `Became committee member: %(account)s` / `Updated committee member %(account)s`.
- 31 params_update: `p` has no single account — `p.fee_paying_account`? (verify; else label-only) → `Updated global parameters`.
- 34 worker_create: `p.owner, p.name` → `Created worker "%(name)s"`.
- 22 proposal_create: `p.fee_paying_account, p.proposed_ops` (array — COUNT only, never recurse) → `Proposed %(n)s operations`.
- 23/24 proposal_update/delete: `p.proposal` → `Approved proposal %(proposal)s` / `Deleted proposal %(proposal)s` (update payloads carry add/remove voter lists — count, don't enumerate).
- 32 vesting_create: `p.creator, p.owner, p.amount{...}` → `Vested %(amount)s for %(owner)s`. 33 withdraw: `p.owner, p.amount{...}` → `Withdrew %(amount)s vested`.
- 49 htlc_create: `p.from, p.to, p.amount{...}, p.htlc_id` → `HTLC %(id)s: %(amount)s from %(from)s to %(to)s`. 50 redeem: `p.redeemer, p.htlc_id` → `Redeemed HTLC %(id)s`. 51 redeemed (virtual): `p.htlc_id, p.from, p.to, p.amount{...}` → `HTLC %(id)s claimed`. 52 extend: `p.htlc_id` → `Extended HTLC %(id)s`. 53 refund (virtual): `p.htlc_id` → `HTLC %(id)s refunded`.
- 57 ticket_create: `p.account, p.value{...}` → `Created ticket %(amount)s`. 58 update: `p.account, p.ticket` → `Updated ticket %(ticket)s`.
- 54–56 authorities: `p.account` → `Updated authorities for %(account)s` (create/update/delete share it).
- 5 account_create: `p.registrar, p.name` → `Registered %(name)s`. 7 whitelist: `p.account_to_list` → `Listed %(account)s`. 8 upgrade: `p.account_to_upgrade` → `Upgraded %(account)s`. 9 transfer: `p.new_owner`? verify field (`account_id` + new owner) → `Transferred account to %(owner)s`.
- 35 custom: `p.payer` + required_auths count → `Custom operation by %(account)s`. 36 assert: label-only (predicates are chain logic, not prose).
- 37 balance_claim: `p.deposit_to_account, p.total_claimed{...}` → `Claimed %(amount)s`.
- 44 fba_distribute: `p.amount{...}` → `Distributed %(amount)s`. 45 bid: `p.bidder, p.additional_collateral{...}, p.debt_covered{...}` → `Bid %(coll)s for %(debt)s`. 46 execute_bid: label-only unless fields verify cleanly.
- 39/40/41 blind: input/output COUNTS only → `Blind transfer (%(in)s in, %(out)s out)`; never amounts.

Steps mirror Task 3 (commit `feat(history): governance/htlc/ticket/vesting/proposal/misc one-liners`).

---

### Task 6: Adversarial vectors + live proof + gates

**Files:**
- Modify: `tooling/history-summary-test.js` (append)

- [ ] **Step 1: Adversarial vectors**

```js
// precision-miss: unknown asset id -> dash, never raw
var r = HS._test; // (extend _test export with amount/name if not exposed)
```

Vectors: (a) tag-0 payload with `asset_id: "1.3.999999"` unjoined → summary contains `—` and NOT the raw integer; (b) tag 77 with unknown shape → no `_summary`; (c) `enrich(null)` / `enrich([])` resolves; (d) `Chain.call` throwing → rows unchanged, promise resolves. Run green.

- [ ] **Step 2: Live re-read probe** (testnet, read-only)

Extend `tooling/explorer-reprobe.mjs` usage or add `tooling/history-summary-probe.mjs`: fetch `lite-test-1` history via the app's `Account.history`, run `enrich`, assert every `_summary` contains no `\b\d{5,}\b` raw run (5+ digit runs) unless accompanied by a decimal point. Record observed node + block in the parity note. Real keys never leave testnet; reads only.

- [ ] **Step 3: Full gates**

Run: `python3 tooling/check_rot.py && bash tooling/check_types.sh && python3 tooling/check_i18n.py && grep -rn "Math.pow(10" vanilla/js/ | grep -v "api/format.js"; echo "float-hits above (want none)"`
Expected: all green, no hits. Then run the touched-area suites: `node tooling/account-ops-test.js`, `node tooling/account-deeplink-test.js`, `node tooling/my-positions-test.js`.

- [ ] **Step 4: Commit**

```bash
git add tooling/history-summary-test.js tooling/history-summary-probe.mjs
git commit -m "test(history): adversarial + live-probe vectors, gates green"
```

---

## Self-review

- Spec §2 (enrich/collect/join/cache) → Tasks 2 (skeleton) + 1 (seed). Covered.
- Spec §3 (families/templates/fallback) → Tasks 3–5. Covered (36, 46 get explicit label-only treatment, not silence).
- Spec §4 (cache + generated seed, chain gate, cap note) → Tasks 1–2. Covered.
- Spec §5 (tests + gates) → Task 6 + per-task TDD steps. Covered.
- Spec §6 non-goals (memos, relative time, explorer, sync signature) — no task violates them; caller change is additive.
- No placeholders: every step names exact files, exact commands, exact expected output; field paths ship with a verification grep against `#4` headers.
- Type consistency: `enrich(rows, viewedAcctId)`, `_summary`, `SUMMARIZERS[tag](payload, J, viewedAcctId)`, `J = { assets, names }` used identically across tasks.
