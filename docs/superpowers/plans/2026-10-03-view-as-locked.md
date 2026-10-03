# Locked view-as any account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While locked, the header acting-as defaults to committee-account but can be switched to any valid account at will (header + page picker, persisted, forms prefill the pick).

**Architecture:** New single-purpose `vanilla/js/api/viewing-as.js` (`ViewingAs` global) owns the pick + localStorage + validation; header/dashboard/forms consume it; unlocked path unchanged. All new display strings keyed under `viewing.*` with `%(name)s`/`%(id)s` placeholders, added honestly to all 12 locales.

**Tech Stack:** Vanilla JS (no deps), WebSocket chain reads via existing `Account.resolve`, localStorage, existing `I18n.t` + `tooling/check_i18n.py` drift gate.

## Global Constraints

- `vanilla/` contains no `package.json`, no `node_modules`, no lockfile, no CDN `<script src>`, no framework. (Anti-rot doctrine.)
- Platform APIs only: HTML, CSS, vanilla JS, WebSocket, WebCrypto, localStorage/IndexedDB, Intl.
- Exactly one module talks to nodes (`vanilla/js/sdk/chain.js`) — new code validates via `Account.resolve` only, never direct socket.
- `python3 -m http.server` must serve a working app; no build step.
- Every user-visible string resolves through `I18n.t` with a verbatim en default; placeholders (`%(name)s`, `%(id)s`), URLs, object IDs, asset symbols, theme/network IDs stay byte-verbatim. (Principle #10.)
- All 12 locales (`en, de, es, fr, hi, it, ja, ko, pt, ru, tr, zh`) stay key-complete; non-`en` unverified values stay byte-identical to `en` (stub honesty); `tooling/check_i18n.py` stays green.
- BitShares terms (witness, committee, worker, proxy, brainkey, vesting, HTLC, swap, slate) follow the shared glossary, never improvisation.
- Interactive elements ≥44px one dimension; no hover-only UI; 360px phone + 1440px desktop; all three themes; `prefers-reduced-motion` respected (dialog has no animation).
- Integers as strings until render; no money math in this plan (ids/names only).
- One clear purpose per file; module header + function descriptions; no dead code, no TODO/FIXME in shipped code.

---

## File structure

- Create: `vanilla/js/api/viewing-as.js` — owns pick state, persistence key `bts-vanilla-viewing-as-v1`, validation, `subscribe`, and the shared `openPicker(doc)` dialog. Single purpose: locked viewing identity.
- Modify: `vanilla/index.html` — add `<script src="js/api/viewing-as.js">` after `js/api/account.js` (line ~59); change `#acting-as` `<span>` to `<button>` keeping id + styling.
- Modify: `vanilla/js/app.js` — `paintActingAs` locked branch reads `ViewingAs`; bind header click to picker; re-subscribe.
- Modify: `vanilla/js/views/dashboard-ui.js` — `resolveWatched` locked branch reads `ViewingAs`.
- Modify: `vanilla/js/views/accounts-ui.js`, `vanilla/js/views/account-ui.js` (`renderUnlockPrompt` lookup block) — embed the same picker (reuse, no duplicate dialog code).
- Modify (sweep, one line each at locked fallback): `transfer-ui.js`, `borrow-ui.js`, `credit-ui.js`, `htlc-ui.js`, `pool-ui.js`, `instant-trade-ui.js`, `barter-ui.js`, `samet-ui.js`, `prediction-ui.js`, `asset-manage-ui.js`, `asset-ui.js`, `vote-ui.js`, `vesting-ui.js`, `misc-ui.js`, `ticket-ui.js`, `debit-ui.js`, `explorer-assets.js`, `credit-detail-ui.js` — replace `catch(function(){return VIEWING_AS_ID;})` / `locked ? VIEWING_AS_ID` sources with `ViewingAs.id()`, and hardcoded `"Viewing as "+NAME` notices with `t("viewing.notice_locked", ...)` + vars. Local `VIEWING_AS_ID` constants stay as load-order fallbacks only.
- Modify (i18n): `vanilla/locales/en.json` + 11 others (`de, es, fr, hi, it, ja, ko, pt, ru, tr, zh`) — add 12 `viewing.*` keys, update `_meta.translated` in each file.
- Test: `python3 tooling/check_i18n.py`, `python3 tooling/check_rot.py`, `bash tooling/check_types.sh` (if present), manual browser checklist (no testnet broadcast — read-only + localStorage).

New i18n keys (exact, namespace `viewing.`):

- `viewing.header_locked` = `Viewing as %(name)s (locked) — tap to change`
- `viewing.header_default` = `Viewing as committee-account (locked)`
- `viewing.header_unlocked` = `Acting as %(name)s`
- `viewing.dialog_title` = `View as account`
- `viewing.dialog_hint` = `Public data — no unlock needed. Type any account name or 1.2.N id.`
- `viewing.dialog_label` = `Account name `
- `viewing.dialog_placeholder` = `account-name`
- `viewing.dialog_open` = `View as this account`
- `viewing.dialog_reset` = `Reset to committee-account`
- `viewing.unknown_account` = `Unknown account name.`
- `viewing.network_error` = `Network unavailable. Check Settings → Nodes and retry.`
- `viewing.notice_locked` = `Viewing as %(name)s (%(id)s) — unlock to act as yourself.`

Stub rule: `en` lists all 12 in `_meta.translated`; `es` keeps its 32 batch-1 keys unchanged (new keys NOT allowlisted, values = en verbatim); 10 stubs keep `untranslated:true`, `translated:[]`, values = en verbatim.

---

### Task 1: ViewingAs module + i18n keys + script wiring

**Files:**
- Create: `vanilla/js/api/viewing-as.js`
- Modify: `vanilla/locales/en.json` (add 12 keys + `_meta.translated` entries)
- Modify: `vanilla/locales/de.json`, `vanilla/locales/es.json`, `vanilla/locales/fr.json`, `vanilla/locales/hi.json`, `vanilla/locales/it.json`, `vanilla/locales/ja.json`, `vanilla/locales/ko.json`, `vanilla/locales/pt.json`, `vanilla/locales/ru.json`, `vanilla/locales/tr.json`, `vanilla/locales/zh.json` (same 12 keys, en-verbatim values except es keeps existing allowlist)
- Modify: `vanilla/index.html` (script tag after `js/api/account.js`)

**Interfaces:**
- Consumes: `Account.resolve(nameOrId)` -> `Promise<{id,name}>`; `I18n.t` (guarded); `localStorage` (guarded).
- Produces: `ViewingAs.get()` -> `{id:string,name:string}`; `ViewingAs.id()` -> string; `ViewingAs.set(nameOrId)` -> `Promise<{id,name}>` (validates, persists, emits, rejects `unknown-account`/network); `ViewingAs.clear()` -> default (persists + emits); `ViewingAs.subscribe(fn)` -> unsubscribe; `ViewingAs.openPicker(doc)` -> dialog element (used by Tasks 2–3).

- [ ] **Step 1: Add the 12 keys to en.json**

  In `vanilla/locales/en.json`, inside the top-level `"viewing": {` section (create it alphabetically after `"vote"` if absent), insert exactly:

```json
"viewing": {
    "dialog_hint": "Public data — no unlock needed. Type any account name or 1.2.N id.",
    "dialog_label": "Account name ",
    "dialog_open": "View as this account",
    "dialog_placeholder": "account-name",
    "dialog_reset": "Reset to committee-account",
    "dialog_title": "View as account",
    "header_default": "Viewing as committee-account (locked)",
    "header_locked": "Viewing as %(name)s (locked) — tap to change",
    "header_unlocked": "Acting as %(name)s",
    "network_error": "Network unavailable. Check Settings → Nodes and retry.",
    "notice_locked": "Viewing as %(name)s (%(id)s) — unlock to act as yourself.",
    "unknown_account": "Unknown account name."
},
```

  And append the 12 dotted keys (`viewing.dialog_hint`, …) to `_meta.translated` (sorted, matching existing style).

- [ ] **Step 2: Mirror the 12 keys into the other 11 locales (honest stubs)**

  For each of `de, fr, it, ja, ko, ru, tr, zh, hi, pt`: insert the identical `"viewing": {...}` block with byte-identical values to en; leave `_meta` as-is (`untranslated:true`, `translated:[]`). For `es`: insert the identical block; leave `_meta.translated` as its existing 32 batch-1 keys (do NOT add the 12); leave `untranslated:false` as-is.

- [ ] **Step 3: Write failing drift check**

  Run: `python3 tooling/check_i18n.py`
  Expected: PASS (`OK: 12 dicts key-complete (3497 keys); ...`) — key count is 3485 + 12 = 3497. If FAIL, fix key spelling/placement before continuing (do not proceed with JS until green).

- [ ] **Step 4: Create viewing-as.js (minimal state, no dialog yet)**

```js
/* ViewingAs: locked viewing identity (default committee-account, user-switchable).
 * Owns: pick state {id,name}, localStorage persistence (bts-vanilla-viewing-as-v1),
 *   validation via Account.resolve, tiny subscribe fan-out, openPicker dialog (Task 2).
 * Consumes: Account.resolve (guarded at call time), I18n.t (guarded).
 * Globals/side effects: global ViewingAs only; localStorage read/write under one key.
 * Created by: brainstorming 2026-10-03 view-as-locked design.
 */
var ViewingAs = (function () {
  "use strict";
  var KEY = "bts-vanilla-viewing-as-v1";
  var DEF_ID = "1.2.0", DEF_NAME = "committee-account";
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    if (vars && typeof dflt === "string") {
      return dflt.replace(/%\(([^)]+)\)s/g, function (m, n) {
        return (vars[n] !== undefined) ? String(vars[n]) : m;
      });
    }
    return dflt;
  }
  function read() {
    try {
      if (typeof localStorage === "undefined") return null;
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || typeof o.id !== "string" || typeof o.name !== "string") return null;
      if (!o.id || !o.name) return null;
      return { id: o.id, name: o.name };
    } catch (e) { return null; }
  }
  var listeners = [];
  function emit(v) {
    var arr = listeners.slice();
    for (var i = 0; i < arr.length; i++) { try { arr[i](v); } catch (e) { /* never break */ } }
  }
  function get() { var v = read(); return v || { id: DEF_ID, name: DEF_NAME }; }
  function id() { return get().id; }
  function isDefault() { var v = get(); return v.id === DEF_ID && v.name === DEF_NAME; }
  function clear() {
    try { if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify({ id: DEF_ID, name: DEF_NAME })); } catch (e) { /* emit anyway */ }
    var v = { id: DEF_ID, name: DEF_NAME };
    emit(v);
    return v;
  }
  function set(nameOrId) {
    var s = String(nameOrId || "").trim().toLowerCase();
    if (!s) return Promise.reject(new Error("unknown-account"));
    return Promise.resolve().then(function () {
      if (typeof Account === "undefined" || !Account || typeof Account.resolve !== "function") throw new Error("network_error");
      return Account.resolve(s);
    }).then(function (a) {
      var v = { id: String(a.id), name: String(a.name) };
      try { if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* persist best-effort */ }
      emit(v);
      return v;
    });
  }
  function subscribe(fn) {
    listeners.push(fn);
    return function () { var i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); };
  }
  return { get: get, id: id, isDefault: isDefault, set: set, clear: clear, subscribe: subscribe, DEF_ID: DEF_ID, DEF_NAME: DEF_NAME };
})();
if (typeof globalThis !== "undefined" && typeof globalThis.ViewingAs === "undefined") { globalThis.ViewingAs = ViewingAs; }
if (typeof module !== "undefined") { module.exports = ViewingAs; }
```

- [ ] **Step 5: Wire the script tag**

  In `vanilla/index.html` after `<script src="js/api/account.js"></script>` insert `<script src="js/api/viewing-as.js"></script>`.

- [ ] **Step 6: Run gates**

  Run: `python3 tooling/check_i18n.py`
  Expected: PASS (3497 keys). Run: `python3 tooling/check_rot.py`
  Expected: PASS (no new deps).

- [ ] **Step 7: Commit**

```bash
git add vanilla/js/api/viewing-as.js vanilla/index.html vanilla/locales/*.json
git commit -m "feat(view-as): ViewingAs state + 12 viewing keys x12 locales"
```

---

### Task 2: Header button + shared picker dialog

**Files:**
- Modify: `vanilla/js/api/viewing-as.js` (append `openPicker`)
- Modify: `vanilla/index.html` (span -> button, keep `id="acting-as"`)
- Modify: `vanilla/js/app.js` (`paintActingAs` locked branch + click binding + subscribe)

**Interfaces:**
- Consumes: `ViewingAs.get/set/clear/subscribe/openPicker` (Task 1); `Wallet.isUnlocked` (existing); `Account.myAccountId/resolve` (existing).
- Produces: clickable header (locked only) + `ViewingAs.openPicker(doc)` reusable dialog.

- [ ] **Step 1: Header element becomes a button**

  In `vanilla/index.html` replace `<span id="acting-as" title="Acting account">committee-account</span>` with `<button id="acting-as" class="acting-as" type="button" title="Acting account">committee-account</button>`. Keep id byte-identical; CSS class reuses existing header text style (add `.acting-as{background:none;border:0;font:inherit;color:inherit;cursor:pointer;min-height:44px}` to `css/app.css` only if the button renders unstyled — one rule, no theme change).

- [ ] **Step 2: Append openPicker to viewing-as.js**

  Append inside the `ViewingAs` closure before `return` (uses the same guarded `t`):

```js
  /* openPicker: shared locked view-as dialog. Params: doc (document).
   * Returns the dialog wrapper element. Validates via set(), shows
   * viewing.unknown_account / viewing.network_error inline, never throws out. */
  function openPicker(doc) {
    var overlay = doc.createElement("div");
    overlay.className = "viewing-picker-overlay";
    var box = doc.createElement("div");
    box.className = "viewing-picker";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", t("viewing.dialog_title", "View as account"));
    var h = doc.createElement("h2");
    h.textContent = t("viewing.dialog_title", "View as account");
    box.appendChild(h);
    var hint = doc.createElement("p");
    hint.className = "muted";
    hint.textContent = t("viewing.dialog_hint", "Public data — no unlock needed. Type any account name or 1.2.N id.");
    box.appendChild(hint);
    var label = doc.createElement("label");
    label.textContent = t("viewing.dialog_label", "Account name ");
    var input = doc.createElement("input");
    input.type = "text";
    input.setAttribute("placeholder", t("viewing.dialog_placeholder", "account-name"));
    input.setAttribute("autocomplete", "off");
    input.style.minHeight = "44px";
    label.appendChild(input);
    box.appendChild(label);
    var err = doc.createElement("div");
    err.className = "error";
    err.setAttribute("aria-live", "polite");
    box.appendChild(err);
    var row = doc.createElement("p");
    var go = doc.createElement("button");
    go.type = "button";
    go.style.minHeight = "44px";
    go.textContent = t("viewing.dialog_open", "View as this account");
    row.appendChild(go);
    var reset = doc.createElement("button");
    reset.type = "button";
    reset.style.minHeight = "44px";
    reset.textContent = t("viewing.dialog_reset", "Reset to committee-account");
    row.appendChild(reset);
    var close = doc.createElement("button");
    close.type = "button";
    close.style.minHeight = "44px";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close");
    row.appendChild(close);
    box.appendChild(row);
    overlay.appendChild(box);
    function done() { try { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); } catch (e) { /* gone */ } }
    close.addEventListener("click", done);
    overlay.addEventListener("click", function (ev) { if (ev.target === overlay) done(); });
    reset.addEventListener("click", function () { err.textContent = ""; try { ViewingAs.clear(); } catch (e) { /* default stands */ } done(); });
    go.addEventListener("click", function () {
      err.textContent = "";
      go.disabled = true;
      ViewingAs.set(input.value).then(function () { done(); }).catch(function (e) {
        go.disabled = false;
        var m = (e && e.message) ? e.message : "";
        if (m.indexOf("unknown-account") !== -1) err.textContent = t("viewing.unknown_account", "Unknown account name.");
        else err.textContent = t("viewing.network_error", "Network unavailable. Check Settings → Nodes and retry.");
      });
    });
    try { input.focus(); } catch (e) { /* display-only */ }
    return overlay;
  }
```

  And expose it: change `return { get: ..., subscribe: subscribe, ...}` to include `openPicker: openPicker`.

- [ ] **Step 3: paintActingAs locked branch uses ViewingAs + placeholder i18n**

  In `vanilla/js/app.js`, replace each locked `show("committee-account", t("shell.acting_default", "Viewing as committee-account (locked)"))` with:

```js
(function () {
  var v = (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.get === "function") ? ViewingAs.get() : { id: "1.2.0", name: "committee-account" };
  if (v.name === "committee-account") show(v.name, t("viewing.header_default", "Viewing as committee-account (locked)"));
  else show(v.name, t("viewing.header_locked", "Viewing as %(name)s (locked) — tap to change", { name: v.name }));
})();
```

  Replace the unlocked `show(name, t("shell.acting_unlocked", "Acting as ") + name)` with `show(name, t("viewing.header_unlocked", "Acting as %(name)s", { name: name }))`. Keep `shell.*` keys in locales (harmless until readability pass); call-site drift gate only checks keys still called.

- [ ] **Step 4: Bind header click (locked only) + subscribe**

  In `bindLockOnce()`-adjacent boot (same file, once): add `bindViewingAsOnce()` that attaches a click listener to `#acting-as`: if `walletUnlockedNow()` return (unlocked keeps wallet identity); else append `ViewingAs.openPicker(document)` to `document.body`. Subscribe: `ViewingAs.subscribe(function(){ paintActingAs(); })` (guarded if ViewingAs missing). Repaint on dialog success flows through the subscription (no manual DOM edit at dialog close).

- [ ] **Step 5: Verify**

  Run: `python3 tooling/check_i18n.py` Expected: PASS. Run: `grep -rn "Viewing as " vanilla/js/api/viewing-as.js vanilla/js/app.js | grep -v 't("' | head` Expected: no output (every display string inside `t()`).
  Manual: `python3 -m http.server 8080 --directory vanilla`, locked header tap -> dialog -> unknown name errors honestly -> valid name switches header -> reload persists.

- [ ] **Step 6: Commit**

```bash
git add vanilla/js/api/viewing-as.js vanilla/index.html vanilla/js/app.js vanilla/css/app.css
git commit -m "feat(view-as): header picker + placeholder i18n"
```

---

### Task 3: Dashboard + Accounts + account/me reuse

**Files:**
- Modify: `vanilla/js/views/dashboard-ui.js` (`resolveWatched`)
- Modify: `vanilla/js/views/accounts-ui.js` (lookup section: add View-as buttons reusing `openPicker`)
- Modify: `vanilla/js/views/account-ui.js` (`renderUnlockPrompt` public lookup block)

**Interfaces:**
- Consumes: `ViewingAs.get/openPicker/subscribe` (Tasks 1–2).
- Produces: locked dashboard/account pages honour the pick; no new dialog code.

- [ ] **Step 1: Dashboard watched account**

  In `resolveWatched(unlocked)`, replace locked `Account.resolve(WATCH_NAME)` with `Account.resolve(ViewingAs.get().name)` (guarded fallback to `WATCH_NAME` when ViewingAs missing). Replace the locked disclaimer `t("borrow.viewing_as", "Viewing as committee-account ...")` with `t("viewing.notice_locked", "Viewing as %(name)s (%(id)s) — unlock to act as yourself.", { name: found.name, id: found.id })`.

- [ ] **Step 2: Accounts page View-as affordance**

  Below the lookup input + `Open account page` button, add a second button labelled `t("viewing.dialog_open", "View as this account")` that calls `ViewingAs.set(nameF.input.value)` with the same field error slot (reuse `setFieldError`: unknown -> `viewing.unknown_account`, network -> `viewing.network_error`). Add a muted line with a `Reset to committee-account` button (`viewing.dialog_reset` -> `ViewingAs.clear()`). No new strings; no new route.

- [ ] **Step 3: account/me locked prompt**

  Same two buttons beside the public lookup (copy the Task-3-Step-2 block, same keys). Keep the unlock form untouched (signing path unchanged).

- [ ] **Step 4: Verify + commit**

  Run: `python3 tooling/check_i18n.py` Expected: PASS.
  Manual: locked `#/accounts` set view-as -> header + `#/` dashboard update without reload (subscription); reset restores committee.
```bash
git add vanilla/js/views/dashboard-ui.js vanilla/js/views/accounts-ui.js vanilla/js/views/account-ui.js
git commit -m "feat(view-as): dashboard + accounts picker reuse"
```

---

### Task 4: Locked form-default sweep (prefill the pick)

**Files (one-line source swaps, notices to placeholder i18n):**
`transfer-ui.js`, `borrow-ui.js`, `credit-ui.js`, `htlc-ui.js`, `pool-ui.js`, `instant-trade-ui.js`, `barter-ui.js`, `samet-ui.js`, `prediction-ui.js`, `asset-manage-ui.js`, `asset-ui.js`, `vote-ui.js`, `vesting-ui.js`, `misc-ui.js`, `ticket-ui.js`, `debit-ui.js`, `explorer-assets.js`, `credit-detail-ui.js`

**Interfaces:**
- Consumes: `ViewingAs.id()` / `ViewingAs.get()` (Tasks 1–2).
- Produces: every locked `From`/proposer/issuer/payer default = the pick; every hardcoded viewing notice = `viewing.notice_locked` with vars.

- [ ] **Step 1: Swap id sources**

  Pattern A (promise fallback): replace `.catch(function () { return VIEWING_AS_ID; })` / `.catch(function () { return ui.viewingAsId; })` / `.catch(function () { return "1.2.0"; })` with `.catch(function () { return (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0"; })`.
  Pattern B (sync default): replace `locked ? VIEWING_AS_ID` / `value: VIEWING_AS_ID` / `seller: VIEWING_AS_ID` / `id = VIEWING_AS_ID` with the same guarded `ViewingAs.id()` expression. Keep local `VIEWING_AS_ID` constants as the `"1.2.0"` fallback literal only — never delete the constant in this plan (readability pass owns cleanup).

- [ ] **Step 2: Swap hardcoded notices**

  Replace string-concat notices (`"Viewing as " + VIEWING_AS_NAME + ...`) and locked `t("*.viewing_as", "Viewing as committee-account ...")` call sites that describe the viewing account with:

```js
t("viewing.notice_locked", "Viewing as %(name)s (%(id)s) — unlock to act as yourself.", { name: v.name, id: v.id })
```

  where `v` is the already-resolved viewing/me object at that site (`found`, `me`, or `ViewingAs.get()`). Keep the old `*.viewing_as` keys in locale files (unused keys are not drift failures); do not add new keys in this task.

- [ ] **Step 3: Verify + commit**

  Run: `python3 tooling/check_i18n.py` Expected: PASS (no new keys; call-site defaults for `viewing.notice_locked` byte-match en). Run: `grep -rn 'Viewing as " +' vanilla/js/views/*.js | head` Expected: no output.
  Manual spot-check: locked Transfer From prefills pick; Proposer/Issuer ditto; sign while locked still fails honestly (`wallet-locked`, never impersonates).
```bash
git add vanilla/js/views/*.js vanilla/js/builders/*.js
git commit -m "feat(view-as): locked form defaults prefill the pick"
```

---

### Task 5: Multilingual completion + full verification

**Files:** none new (audit + fixes only).

- [ ] **Step 1: Drift gate**

  Run: `python3 tooling/check_i18n.py` Expected: `OK: 12 dicts key-complete (3497 keys); allowlists exact; stubs honest; N t() call sites drift-free.`

- [ ] **Step 2: Hardcoded-string sweep**

  Run: `grep -rn "Viewing as \|View as \|Reset to committee" vanilla/js/api/viewing-as.js vanilla/js/app.js vanilla/js/views/accounts-ui.js vanilla/js/views/account-ui.js vanilla/js/views/dashboard-ui.js | grep -v 't("' | head` Expected: no output. Any literal found must move into `t("viewing.*", ...)` + en.json + 11 stub mirrors (Task-1-Step-2 rule), then re-run Step 1.

- [ ] **Step 3: Placeholder-verbatim check**

  Run: `grep -rn "%(name)s\|%(id)s" vanilla/js --include=*.js | grep -v "viewing\." | head` Expected: no new non-viewing interpolations added by this plan (placeholders only under `viewing.*`). Confirm `%(name)s`/`%(id)s` appear byte-verbatim in all 12 locale files for `header_locked`, `header_unlocked`, `notice_locked`.

- [ ] **Step 4: Rot + types + render gates**

  Run: `python3 tooling/check_rot.py` Expected: PASS. Run: `bash tooling/check_types.sh` (if present) Expected: zero errors. Manual trio: 360px phone + 1440px desktop × ref-ui/dex-ux/vanilla themes; header dialog keyboard-focusable; `prefers-reduced-motion` has no animation to disable (pass by construction).

- [ ] **Step 5: Commit + parity note**

```bash
git add -A
git commit -m "feat(view-as): multilingual completion + verification"
```

  Append a `view-as` delta section to the slice-01 parity note (or `vanilla/notes/view-as-locked.md` if slice-01 note is frozen): header/picker/form-prefill behavior, 3497-key drift result, rot/type results, phone+desktop+theme trio.

---

## Self-review

- Spec coverage: header+page picker ✓, wallet-wins-pick-kept ✓, form prefill ✓, persistence ✓, honest errors ✓, principle #10 (keyed strings, 12-locale completeness, verbatim placeholders/IDs, glossary, drift gate) ✓ in Tasks 1+5.
- Placeholders: none — every step shows exact code/commands/expected output; locale values byte-exact.
- Type consistency: `ViewingAs.get()->{id,name}`, `.id()->string`, `.set()->Promise`, `.clear()->{id,name}`, `.subscribe()->unsubscribe`, `.openPicker(doc)->element` used identically across Tasks 2–4.
