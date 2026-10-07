# Unlock-Confirm Modal — spec (trollbox pilot)

Date: 2026-10-07. Origin: trollbox login audit (inline `Wallet.unlock` row in
`trollbox-ui.js:281-319` + codebase census: ~12 hand-rolled inline unlock rows,
no shared helper). Skill: `building-vanilla-slices` (shared-utility
extension, not a chain slice — no new WS surface, so `mapping-chain-calls`
is satisfied by citation, not a new mapping).

## 1. Problem

Every signing view hand-rolls its own password row against `Wallet.unlock`.
The copies drift: trollbox's fails to wipe the password on unlock failure
(`trollbox-ui.js:380-391`), has no `autocomplete`, no confirm step, and
reimplements `el/clearRoot` against rule 9. The fix is one shared helper,
piloted on the trollbox; the other ~11 rows migrate in later rounds (scope
answer 2026-10-07: pilot only).

## 2. Solution shape

A modal combining human-readable confirm + unlock in one dialog:

- Click Post → `Overlay` opens with `ConfirmDialog` rows + fee + (when
  locked) a password field + Unlock&Post / Cancel.
- Helper owns review + unlock; caller owns sign + broadcast + page progress.
- The password NEVER leaves the helper: `onUnlocked()` carries no password
  argument. Wipe-on-both-outcomes lives in exactly one place.

Non-goals: no `#/login` redirect/`returnTo` machinery; no draft caching; no
migration of the other 11 rows; no focus trap (Overlay limitation, recorded
in §7); no new CSS; no new chain calls.

## 3. New module: `vanilla/js/ui/unlock-confirm.js` → global `UnlockConfirm`

Consumes (globals, never reimplemented): `Overlay.open`, `ConfirmDialog.show`,
`DOM`, `touchable`, `Wallet.unlock`, `I18n` via caller-supplied strings.
Side effects: one overlay in `doc.body` per open; one `hashchange` listener
per open (removed on close). ES5, classic script tag, `module.exports` for
the Node fake-doc harness. Script tag in `index.html` after `overlay.js`.
`globals.d.ts` gains the `UnlockConfirm` declaration (dev-only).

### 3.1 API

```
UnlockConfirm.open(cfg) → { close: function }
cfg = {
  doc?,               // owner document (default: global document)
  title,              // string, caller-keyed (e.g. trollbox.post_review_title)
  rows,               // [[term, text, rawTitle?], ...] — ConfirmDialog shape
  feeHuman?, feeTerm?, feeRawTitle?,
  needPassword,       // boolean — caller computes via Wallet.isUnlocked()
  passwordLabel?,     // default t("unlockconfirm.password", "Password")
  submitLabel?,       // default caller provides; fallback "Unlock & post"
  cancelLabel?,       // default "Back"
  errorFor?,          // fn(err) → display string; default err.message
  onUnlocked,         // fn() — modal already closed; password wiped
  onCancel,           // fn() — any dismiss path, fires at most once
  className?, returnFocus?
}
```

Throws honestly (no overlay): no document; `Wallet`/unlock absent
(`"unlock-confirm: wallet backend missing"` — caller shows the page error);
`onUnlocked` not a function.

### 3.2 Locked-mode flow

1. Content = `ConfirmDialog.show({title, rows, feeHuman, ...})` + password
   row (`input[type=password]`, `autocomplete="current-password"`,
   `aria-label`, `touchable`) + inline error line (`aria-live="polite"`).
2. Focus the password input on open (guarded; tab order stands without it).
3. Submit with empty password → inline `unlockconfirm.empty_password`
   error, no unlock attempt, stays open.
4. Submit → disable submit, `Wallet.unlock(pw)`:
   - resolve → `pw = null`, `input.value = ""`, close modal, `onUnlocked()`.
   - reject → `pw = null`, `input.value = ""`, in-modal error
     (`errorFor(err)` or `unlockconfirm.unlock_failed`), re-enable,
     refocus password, stays open.
5. Double-submit impossible (disabled while pending).

### 3.3 Confirm-only mode (`needPassword: false`)

No password field, no password row strings. Submit goes straight to close +
`onUnlocked()`. Focus lands on the submit button (ConfirmDialog focuses Back
by default — acceptable, documented).

### 3.4 Close discipline (all paths)

Esc / backdrop click / `hashchange` / `close()` → detach overlay, remove
`hashchange` listener, `input.value = ""` (belt: unmount already drops it),
single-fire `onCancel` — EXCEPT after successful submit (settled flag), where
`onCancel` must NOT fire. Return focus via `Overlay` default (opener).

## 4. Trollbox wiring (`vanilla/js/views/trollbox-ui.js`)

DELETE: gate paragraph (`login_gate`), `pwRow` + `pwInput` + `unlockBtn`
(+ its handler), `refreshGate` + its calls. KEEP `unlockedNow()` (drives
`needPassword` + pre-submit guard).

New Post-click flow (validation unchanged: empty/over-chars guards stay):

1. `text` validated; `built = T.buildPost(...)` with `1.2.0` payer preview +
   `Tx.fee` for a FRESH fee (never the preview line's — it may be stale).
2. `UnlockConfirm.open({title: t("trollbox.post_review_title", "Review message"),
   rows: [[Channel, #ch], [Language, code], [Size, "N / M bytes"],
   [Message, text]], feeHuman, feeTerm, feeRawTitle: raw int (principle #6),
   needPassword: !unlockedNow(), submitLabel: t("trollbox.unlock_post", ...),
   onUnlocked: <existing post chain verbatim — myAccountId → resolve →
   buildPost → fee → buildTx → sign → broadcastPost → page note>,
   onCancel: no-op (page note untouched)})`.
3. Pre-submit guard stays: `if (!unlockedNow())` re-check inside `onUnlocked`
   before touching `Wallet.keys` (unlock may have lapsed while modal open —
   treat as `wallet-locked` page error, never a silent post).

No other trollbox behavior changes (probe, pager, 15s poll, budget line all
untouched). Failing closed: any helper throw → page `note` error, post does
not send.

## 5. i18n (principle #10)

Helper-owned keys (English real in `en.json`, honest English stubs in the
other 11 — convention per `building-vanilla-slices` §per-file):

- `unlockconfirm.password` — "Password"
- `unlockconfirm.empty_password` — "Enter your wallet password."
- `unlockconfirm.unlock_failed` — "Unlock failed."

Caller-owned (trollbox namespace, same 12-dict treatment):

- `trollbox.post_review_title` — "Review message"
- `trollbox.unlock_post` — "Unlock & post"
- `trollbox.size_row` — "Size" (term label)

All row content (channel id, text, fee) is data/IDs — byte-verbatim, never
translated. `python3 tooling/check_i18n.py` green before leaving hands.

## 6. Tests — `tooling/unlock-confirm-test.js` (fake-doc harness)

Mirrors `tooling/confirm-test.js` + `overlay-test.js` setup (require
`dom.js`, `touchable.js`, stub `Overlay`/`ConfirmDialog`? NO — use the real
ones with an extended fake doc: needs `doc.body.appendChild`,
`activeElement`, `addEventListener` for `hashchange`). Cases:

1. Locked render: rows + fee + password input present.
2. Empty submit → inline error, `Wallet.unlock` NOT called.
3. Bad password → `onUnlocked` not called, error shown, input wiped,
   modal still open, submit re-enabled.
4. Good password → `onUnlocked` called once, modal closed, `onCancel` NOT
   called, password local nulled (assert via stubbed Wallet capturing args).
5. Confirm-only: no password input; submit → `onUnlocked`.
6. Esc → `onCancel` exactly once; second Esc / `close()` → still once.
7. Double submit while pending → single `Wallet.unlock` call.

`Wallet` stubbed globally per case (resolve/reject/never), restored after.

## 7. Known limitations (honest, not deferred silently)

- No focus trap: Tab can leave the dialog (Overlay limitation, stated in
  `overlay.js:10`). Password input is autofocused; trap is a follow-up.
- `hashchange` close treats in-flight unlock as cancel: if unlock resolves
  after a route leave, `onUnlocked` still fires — the trollbox's existing
  `myGen !== gen` guards in the post chain absorb this (verified at build).
- Other 11 inline rows remain (later rounds); the helper API must not assume
  trollbox shapes (rows/fee/labels all caller-supplied — enforced by review).

## 8. Gates (all green before "done")

- `python3 tooling/check_rot.py` (no new deps/CDN/build artifacts).
- `bash tooling/check_types.sh` (JSDoc on every seam + `globals.d.ts`).
- `python3 tooling/check_i18n.py` (3 helper + 3 trollbox keys × 12 dicts).
- `node tooling/unlock-confirm-test.js` + rerun `confirm-test.js`,
  `overlay-test.js` (no regressions).
- Manual browser pass: phone 360px + desktop; locked post / bad password /
  cancel / Esc / unlocked confirm-only; all three themes (modal uses panel
  tokens only).
- No testnet broadcast required for the helper (no chain surface changed);
  post path proof stands via `tooling/prove-trollbox-post.cjs`. Optional:
  one testnet post through the new modal if a faucet account is handy.
- Parity: addendum to the trollbox section of
  `docs/parity/slice-14-proposals.md` (fields: ref behavior, vanilla
  file:line, manual steps + observed, no amount vectors — fee line reuses
  the existing Format path, cite it).

## 9. Anti-rot answers (§4.5)

- (a) Ten years untouched: ES5 + platform DOM + two in-repo modules. Runs
  wherever `Overlay`/`ConfirmDialog` run (same file, same fate — no new
  coupling class).
- (b) Newly depended on: nothing. Composes existing modules; script tag +
  `globals.d.ts` line only.
- (c) Smallest deletable subset: confirm-only mode branch (locked-only
  modal still works); kept because already-unlocked posting is the common
  returning-user path and a password re-ask would be a UX bug.
