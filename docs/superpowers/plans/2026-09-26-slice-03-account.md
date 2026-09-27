# Slice 03 (Account View) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Public account pages — balances in human terms plus operation history — for any account by name, with a my-account shortcut through the wallet keystore. Principle #6 debuts here.

**Architecture:** `format.js` (pure string math, zero deps, no float) feeds `account.js` (read-only data layer on `Chain`), rendered by `account-ui.js`. No signing, no keystore writes, no unlock required except `/account/me`.

**Tech Stack:** Vanilla JS + existing `Chain`/`Store`/`Wallet`/`Crypto`. Node 20 stdlib for checks. Python 3 for rot gate.

## Global Constraints

- Zero runtime dependencies; platform APIs only; `python3 -m http.server`-servable.
- NO binary float for money: `Number()`, `parseFloat`, `/ Math.pow(10` are forbidden outside `format.js` — and inside it too (string ops only). The audit greps for this.
- Amounts stay integer STRINGS until render; inputs parse back to integer strings.
- Test keys only on testnet (reading mainnet public data for vectors is allowed; OUR keys never touch mainnet).
- Viewport 360px→4K; targets ≥44px; no hover-only UI.
- Each `js/*.js` one global + trailing `module.exports` guard.
- API facts (verified): `get_account_by_name(string)` (database_api.hpp:326); `get_account_balances(name_or_id, assets?)` (:371); `get_assets([symbols_or_ids])` (:425, returns `{id,symbol,precision}` — assert at runtime, STOP if shape differs); history api id via login `"history"` (extension bitshares-api.js:335); `get_account_history [id,"1.11.0",limit,"1.11.0"]`.

---

## File Structure

```
vanilla/
├── js/
│   ├── format.js      ← TASK 1: string-math amounts (exact algorithms below)
│   ├── account.js     ← TASK 3: resolve/balances/history/myAccountId
│   ├── account-ui.js  ← TASK 4: renderAccount + /account/me flow
│   └── chain.js       ← TASK 2: +Chain.history() (append-only edit)
└── notes/
    └── slice-03-account.md  ← TASK 5: parity note
```

---

### Task 1: `format.js` — amounts-only formatting module

**Files:**
- Create: `vanilla/js/format.js`

**Interfaces:**
- Consumes: nothing.
- Produces: global `Format` with EXACTLY:
  - `Format.formatAmount(raw, precision)` — raw integer string → display string, full precision digits, no float. Exact code:

```js
function formatAmount(raw, precision) {
  if (typeof raw !== "string") raw = String(raw);
  var neg = raw.charAt(0) === "-";
  if (neg) raw = raw.slice(1);
  if (!/^\d+$/.test(raw)) throw new Error("bad amount: " + raw);
  if (precision === 0) return (neg ? "-" : "") + raw;
  while (raw.length <= precision) raw = "0" + raw;
  return (neg ? "-" : "") + raw.slice(0, raw.length - precision) + "." + raw.slice(raw.length - precision);
}
```

  - `Format.parseAmount(str, precision)` — display string → integer string, throws on excess decimals. Exact code:

```js
function parseAmount(str, precision) {
  str = String(str).trim();
  var m = /^(\d+)(?:\.(\d+))?$/.exec(str);
  if (!m) throw new Error("bad amount: " + str);
  var frac = m[2] || "";
  if (frac.length > precision) throw new Error("too many decimals for precision " + precision);
  while (frac.length < precision) frac += "0";
  var out = (m[1] + frac).replace(/^0+(?=\d)/, "");
  return out === "" ? "0" : out;
}
```

  - Prices/percents are OUT OF SCOPE (later slices extend this file).

- [ ] **Step 1: Write `vanilla/js/format.js`** with the two functions verbatim + module header + `var Format` global + module guard.
- [ ] **Step 2: Property test in node**

Run:
```
node --check vanilla/js/format.js && node -e "
const F = require('/workspace/vanilla/js/format.js');
const cases = [['123456789',5,'1234.56789'],['0',5,'0.00000'],['1',0,'1'],['100',2,'1.00'],['5',5,'0.00005']];
for (const [raw,p,want] of cases) { const got=F.formatAmount(raw,p); if (got!==want) throw new Error(raw+'=>'+got); if (F.parseAmount(got,p)!==String(BigInt(raw))) throw new Error('roundtrip '+raw); }
console.log('FORMAT VECTORS GREEN');"
```
Expected: `FORMAT VECTORS GREEN`, exit 0.

---

### Task 2: `Chain.history()` helper (append-only edit to `chain.js`)

**Files:**
- Modify: `vanilla/js/chain.js` (append helper + export entry ONLY).

- [ ] **Step 1: Read `chain.js`, then append** (next to `db()`):

```js
  var _historyId = null;
  function history() {
    if (_historyId !== null) return Promise.resolve(_historyId);
    return call(1, "history", []).then(function (id) { _historyId = id; return id; });
  }
```

and add `history: history` to the returned object. NOTE: some nodes lack the history plugin — `call(1,"history",[])` may reject; callers surface that as "history unavailable", never blank.

- [ ] **Step 2: Syntax check** — `node --check vanilla/js/chain.js`, exit 0.

---

### Task 3: `account.js` — read-only data layer

**Files:**
- Create: `vanilla/js/account.js`

**Interfaces:**
- Consumes: `Chain` (`db()`, `history()`, `call`), `Format`, `Crypto` (active pub derivation), `Wallet` (unlocked keys — READ `wallet.js` first for the exact accessor to in-memory keys; use it, do not modify `wallet.js`).
- Produces: global `Account`:
  - `Account.resolve(nameOrId)` → `{id, name}`. If `/^1\.2\.\d+$/`: `get_accounts [[id]]` → first or throw `"unknown-account"`. Else `get_account_by_name [name]` → null throws `"unknown-account"`.
  - `Account.balances(id)` → `get_account_balances [id, []]` → `get_assets [[asset_ids]]` → array of `{asset_id, symbol, precision, raw, display}` where `display = Format.formatAmount(String(raw), precision)`; assert `typeof precision === "number"` per asset (STOP/throw `"bad-asset-shape"` otherwise).
  - `Account.history(id, limit=20)` → `Chain.history()` + `get_account_history [id, "1.11.0", limit, "1.11.0"]` → raw array (history-plugin absence → throw `"history-unavailable"`).
  - `Account.myAccountId()` → throws `"wallet-locked"` unless unlocked; derives active (seq1) pub via `Crypto`, `get_key_references [[pub]]` → first account id or throws `"no-account"`.

- [ ] **Step 1: Write `vanilla/js/account.js`** (~120 lines, header + descriptions + guard).
- [ ] **Step 2: Syntax check** — `node --check vanilla/js/account.js`, exit 0.

---

### Task 4: `account-ui.js` + router + script tags

**Files:**
- Create: `vanilla/js/account-ui.js`
- Modify: `vanilla/js/router.js` (`/account/:account_name` entry ONLY), `vanilla/index.html` (script tags ONLY).

**Interfaces:**
- Consumes: `Account`, `Format`, `Wallet`, `Store`.
- Produces: global `AccountUI` with `renderAccount(root, name)`:
  - loading state → header (name + id) → balances table (Asset | Balance; raw integer in `title` attr, display text formatted) → history list: each row `time + OP_LABEL + <details>raw JSON</details>`; `OP_LABELS = {0:"Transfer",1:"Limit order create",2:"Limit order cancel",3:"Call order update",4:"Fill order",5:"Account create",6:"Account update",7:"Account whitelist",8:"Account upgrade",9:"Account transfer",10:"Asset create"}`, fallback `"Operation #"+n`.
  - `/account/me` (name exactly `"me"`): unlocked → `myAccountId()` → render; locked → unlock prompt with `Wallet.unlock` + return-to-`#/account/me` after success; `unknown-account`/`no-account`/`history-unavailable` render as inline error panels, never blank.
  - Tables collapse to cards <560px (reuse `.node-table`/`.node-cards` CSS patterns — add `.acct-*` classes to `app.css` ONLY if needed; prefer reuse, record choice).

- [ ] **Step 1: Write `vanilla/js/account-ui.js`** (~180 lines).
- [ ] **Step 2: Repoint the `/account/:account_name` router entry** to `AccountUI.renderAccount`; leave `/accounts` as placeholder. Append script tags to `index.html` in order: `js/format.js`, `js/account.js`, `js/account-ui.js` (after `chain.js`, before `router.js` — read current order first).
- [ ] **Step 3: Syntax checks** — `node --check` on all three JS files, exit 0.

---

### Task 5: Verify, parity note, audit, gate

**Files:**
- Create: `vanilla/notes/slice-03-account.md` (+ throwaway `/tmp/acct-vectors.js`, NOT committed).

- [ ] **Step 1: Rot gate + math grep** — `python3 tooling/check_rot.py` exit 0; `grep -rn "Math.pow(10\|parseFloat" vanilla/js/ || echo CLEAN` (want CLEAN — no float money math anywhere).
- [ ] **Step 2: Live vectors** — write `/tmp/acct-vectors.js` (stdlib WS client modeled on `tooling/ws-probe.mjs` handshake + `get_account_balances`/`get_assets`/`get_account_history`): pick a testnet account WITH balances+history (try `faucet`, `init0`, then any; record which; fallback: mainnet `committee-account` for READ-ONLY format proof — our keys never involved). For each balance: hand-verify `display === Format-equivalent` computed independently in the script (no shared code with `format.js` — reimplement the pad/slice inline). Balances count >0 and history length recorded; unknown name `no-such-acct-xyz-9` → clean error observed.
- [ ] **Step 3: Error paths** — unknown account, locked `/account/me`, history-unavailable (if node lacks plugin — record node), corrupt precision shape (unit-level: feed bad asset object to the assert path).
- [ ] **Step 4: Parity note** (seven fields + §3.7 item: reference file:lines — core `:326,:371,:425`, extension `:460-476`, ; implementation file:lines; manual steps + observed incl. vectors with a non-BTS precision REQUIRED (if the test account holds only TEST, say so and add a second asset vector); theme trio + both viewports PENDING-BROWSER with tester steps; §4.5(a–c)).
- [ ] **Step 5: Audit** (`auditing-vanilla-slices`, all eight checks; browser-dependent checks recorded PENDING-BROWSER honestly). No slice 4 until green-minus-browser.
