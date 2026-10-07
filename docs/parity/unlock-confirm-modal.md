# Parity note — shared unlock-confirm modal (full migration)

Round: trollbox login audit → `UnlockConfirm` helper + migration of all 12
signing-view inline `Wallet.unlock` rows. Spec:
`docs/superpowers/plans/2026-10-07-unlock-confirm-modal.md`.

## 1. Reference behavior

**#1 `bitshares-ui` (the model we converge on):**
- `app/actions/WalletUnlockActions.js:10-24` — `unlock()` returns a promise;
  already-unlocked resolves with NO UI; locked pops the modal.
- `app/stores/WalletUnlockStore.js:51-64` — `onUnlock` holds resolve/reject,
  resolves immediately when `WalletDb` is unlocked.
- `app/components/Wallet/WalletUnlockModal.jsx` — ONE global modal mounted
  at the app shell (password/cloud/local models, remember-me, auto-lock).
- Callers are signing flows, never pages:
  `app/components/Blockchain/Transaction.jsx:189`,
  `app/actions/WalletActions.js:404`, `app/stores/WalletDb.js:148,347`,
  `Showcases/Borrow.jsx:54`, `Wallet/ImportKeys.jsx:551`,
  `Account/CreateAccount.jsx:118`, `PrivateKeyView.jsx:188`,
  `Layout/Header.jsx:191`. No signing view owns a password input.

**#2 `astro-ui` (explicitly NOT copied):**
- `src/components/Trollbox.jsx:1816` — "Prepare a custom operation for
  signing in Beet": signing is outsourced to the Beet/BeetEOS multiwallet,
  no local keystore, no local password anywhere. Vanilla keeps #1's local
  keystore model (AGENTS.md §5.4) — Beet is behavior reference only.

**Difference ours keeps on purpose:** #1 shows TransactionConfirm first and
pops the unlock modal second (two dialogs). Ours bundles review rows + unlock
into ONE dialog — one decision, one password entry, same guarantee (nothing
signs without review + unlock).

## 2. Vanilla implementation

- `vanilla/js/ui/unlock-confirm.js` — `UnlockConfirm.open(cfg)`; composes
  `Overlay` + `ConfirmDialog`; owns unlock, wipes on both outcomes, password
  never leaves it; confirm-only mode; hashchange dismiss; single-fire
  onCancel. Wired in `vanilla/index.html:97`, declared in
  `vanilla/js/globals.d.ts:185`.
- Migrations (modal rows + preserved downstream confirm; post-unlock
  re-review kept wherever the locked review names the viewing-as account):
  - `js/views/trollbox-ui.js` — review modal (Channel/Language/Size/Message/
    Fee) → existing publish chain; inline row deleted; local el/clearRoot →
    `DOM.*` (rule 9); `computeFee` shared by preview + modal.
  - `js/views/transfer-preview.js`, `js/views/transfer-propose.js` —
    summary modals; `showConfirm`/`showProposeConfirm` stay the confirm.
  - `js/views/trade-panels.js` — single/scaled summary modals
    (`singleSummaryRows`/`scaledSummaryRows`/`openUnlockModal`);
    `paintConfirm*` stay the confirm.
  - `js/views/instant-trade-ui.js` — sign-gate modal → re-review note
    (R.me is viewing-as when locked — auto-send refused, fix 61c5854).
  - `js/views/credit-ui.js` (`attemptSend`), `js/views/htlc-ui.js`
    (`attemptSend`) — modal with the confirm's own rows → re-review note;
    `unlockInline` defs + `_ui` exports deleted.
  - `js/views/borrow-ui.js` (`signGateLocked` + rows), `js/views/debit-ui.js`
    (per-order modal), `js/views/pool-ui.js` (pre-review modal retry),
    `js/views/barter-ui.js` (rows + live fee), `js/views/prediction-flows.js`
    (`signGateLockedP` + rows) — all re-review preserving.
- Kept inline (no tx to review — a password-only modal would BE the odd
  login): `#/login` (`auth-ui.js`), `#/wallet` manager (`wallet-ui.js`),
  password change (`password-ui.js`), creation password
  (`create-account-ui.js`), view gates `#/accounts` (`accounts-ui.js:170`),
  `#/account/me` (`account-ui.js:1177`).
- Census proof: `grep Wallet.unlock vanilla/js/views` now returns only the
  six keepers above + the helper.

## 3. Manual test steps + observed result

Automated (this round, all green — see §8): `unlock-confirm-test.js`
(23 asserts: render/empty/bad/good/confirm-only/Esc-once/double-submit/
throws) + reruns of `confirm-test.js` (28), `overlay-test.js` (18),
`trollbox-test.js` (75), `transfer-confirm-test.js` (14),
`transfer-share-test.js` (16), `trade-depth-test.js` (27),
`proposal-htlc-test.js` (80), `pool-stake-test.js` (47),
`pool-history-test.js` (46).
BROWSER + TESTNET (queued for the human — AFK, no browser here, never
fabricated): open each migrated flow locked at 360px + desktop × 3 themes;
wrong password (in-modal error, stays open); Esc/backdrop (single cancel);
unlock → downstream confirm shows; testnet post/broadcast per slice habit.

## 4. Raw→human test vectors

No new amount paths: every modal fee row reuses the view's existing
`Format.formatAmount(raw, precision)` + raw-in-title path (principle #6
unchanged; vectors live in the slices' own notes). Helper renders caller
strings verbatim via textContent — no math inside.

## 5. Theme/viewport checks

Queued with §3 (human pass). By construction: modal skin is
`.credit-loan-overlay/.credit-loan-panel` + `.confirm-dialog` panel tokens
only (no hardcoded colors); overlay scrolls with 12px gutters (fits 360px);
44px floor via `touchable()`; `role=dialog aria-modal`, `aria-live` error,
focus-in + return-focus via `Overlay`.

## 6. Readability (§3.7)

Every touched file keeps its module header (updated Consumes/owns lines);
every new function has what/params/returns/failure notes; no TODO/FIXME,
no commented-out code, no dead exports (credit/htlc `unlockInline` exports
removed after last-caller migration; verified by grep).

## 7. Anti-rot gate (§4.5)

- (a) Ten years untouched: ES5 + platform DOM + two in-repo modules; the
  helper dies exactly when `Overlay`/`ConfirmDialog` die — no new coupling
  class, no package, no service, no hosted asset.
- (b) Newly depended on: nothing. One `<script>` tag + one `globals.d.ts`
  line (dev-only). i18n keys are data, not deps.
- (c) Smallest deletable subset: confirm-only branch (locked-only modal
  still unlocks); kept because already-unlocked posting/reviewing is the
  common returning-user path and a password re-ask would be a UX bug.

## 8. Gate evidence

- `python3 tooling/check_rot.py` → PASS (dependency-free, static-servable).
- `bash tooling/check_types.sh` → PASS (tsc checkJs, no emit).
- `python3 tooling/check_i18n.py` → OK (12 dicts key-complete; stubs
  honest; call-site drift-free).
- `node --check` on every touched view + `node tooling/*-test.js` above.
- i18n scripts (rerunnable, idempotent): `add_unlockconfirm_i18n.py`,
  `add_trollbox_review_i18n.py`, `add_transfer_uc_title_i18n.py`,
  `add_trade_instant_uc_i18n.py`, `add_credit_borrow_pool_debit_uc_i18n.py`,
  `add_htlc_barter_prediction_uc_i18n.py`, `remove_modal_orphan_i18n.py`.

## 9. Follow-ups (not this round)

- Browser/theme/viewport + testnet pass (§3, §5) — human.
- Focus trap in `Overlay` (Tab can leave the dialog; password autofocus
  mitigates) — shared improvement, all modal callers benefit.
- `accounts-ui.js` / `account-ui.js` view gates: stay inline by decision §2;
  revisit only if a review-carrying unlock is ever wanted there.
- Auto-rereview after modal unlock (borrow/htlc/barter/prediction/instant
  show the note instead): product decision, not a migration.
