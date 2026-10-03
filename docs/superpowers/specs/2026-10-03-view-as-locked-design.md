# Locked view-as any account — design (2026-10-03)

Owner request: while locked, header `acting-as` should default to
`committee-account` but be switchable to any account at will. Unlocked
behavior unchanged (wallet account wins).

## Decisions (from brainstorming Q&A)

1. Picker lives in BOTH header + page (header name becomes a button opening
   a small dialog; same picker reused on `#/accounts` lookup section and
   `#/account/me` locked prompt).
2. Unlocked: wallet wins, locked pick kept (persisted, restored on relock).
3. Forms prefill the pick: all locked defaults switch from hardcoded `1.2.0`
   to the pick. Sign still gates on wallet keys (honest failure).

## Architecture

New single-purpose module `vanilla/js/api/viewing-as.js` (global `ViewingAs`):

- Owns: `get()` -> `{id, name}` (default `{1.2.0, committee-account}`),
  `set(nameOrId)` (validates before persisting), `clear()` (reset default),
  `isDefault()`, `subscribe(fn)` (light pub/sub for header repaint).
- Persists: direct `localStorage bts-vanilla-viewing-as-v1` (view-state, NOT
  `Store` settings envelope — per `store.js` design note view-state stays out
  of settings; same key pattern as `bts-vanilla-contacts-v1`).
- Consumes: `Account.resolve` (validation via `get_account_by_name` /
  `get_accounts`), `Store` NOT needed, `Chain` only indirectly.
- No DOM, no signing, no secrets. Script tag after `js/api/account.js`.

Consumers switch from hardcoded `VIEWING_AS_ID = "1.2.0"` to
`ViewingAs.get()` at render + re-render on `ViewingAs.subscribe`:

- `js/app.js paintActingAs` (locked branch): show pick + title
  `Viewing as <name> (locked) — tap to change`.
- `dashboard-ui.js resolveWatched` (locked branch).
- Locked form defaults: `transfer-ui`, `borrow-ui`, `credit-ui`,
  `htlc-ui`, `pool-ui`, `instant-trade-ui`, `barter-ui`, `samet-ui`,
  `prediction-ui`, `asset-manage-ui`, `asset-ui`, `vote-ui`, `vesting-ui`,
  `misc-ui`, `ticket-ui`, `debit-ui`, `explorer-assets` viewing notices.
  Each keeps its local constant as fallback only when `ViewingAs` missing
  (file:// script-load order), never as truth.

## Components

1. `ViewingAs` module (~120 lines, header + JSDoc per §3.7).
2. `viewingAsPicker(doc, opts)` shared dialog builder (lives in
   `viewing-as.js` to avoid a second file): input + Open + Reset button,
   inline error, `44px` targets, `textContent`-only, closes on success.
   Header button + `#/accounts` + `#/account/me` all call it — no duplication.
3. Header `#acting-as`: `<span>` -> `<button class=acting-as>` (keeps id +
   styling, adds keyboard/touch access). Title attribute honest locked state.
4. i18n keys: `viewing.set_title`, `viewing.change`, `viewing.reset`,
   `viewing.unknown_account`, `viewing.viewing_as` (all with verbatim
   en defaults; `en` full, other locales fall back to English per slice-17).

## Data flow

- Locked boot: `App.localizeShell -> paintActingAs -> ViewingAs.get()`
  (sync localStorage, no chain) -> paint pick. No async resolve at paint;
  names are stored validated, so no flicker.
- Pick change: dialog `set(name)` -> `Account.resolve(name)` (chain) ->
  persist `{id,name}` -> `emit` -> header + current view re-render via
  existing `Router.start` / view gen guards (stale-guard pattern, no new
  polling).
- Unlock: `paintActingAs` takes unlocked branch (unchanged
  `Account.myAccountId`), pick stays stored. Relock: locked branch reads
  stored pick.
- Sign: unchanged — `Tx` builders resolve `From` and fail honestly
  (`no-account` / `wallet-locked` / key-mismatch) when wallet doesn't
  control the view-as account. Preview may show another account's balances;
  signing never impersonates.

## Error handling

- Unknown name/id: dialog inline error (`Unknown account name.`), no persist,
  header unchanged. Never blank, never throws out.
- Node down: `Account.resolve` throws network error -> dialog shows
  `Network unavailable` + keeps old pick (same pattern as accounts lookup).
- Corrupt stored JSON / missing storage: `get()` returns default (never throws).
- `ViewingAs` script missing (file:// partial load): consumers fall back to
  `1.2.0` constant (safe direction).
- 2036 test: localStorage + `Account.resolve` only; no new dep, no build step,
  no CDN. `check_rot.py` stays green.

## Testing

- Manual: locked default header `committee-account` -> open picker via header
  -> type `alice` (unknown) -> error, header unchanged -> type valid testnet
  account -> header + dashboard + transfer From update -> reload -> pick
  persists -> unlock -> header shows wallet account -> lock -> pick restored.
- Phone 360px + desktop 1440px, three themes, `prefers-reduced-motion` (dialog
  has no candy).
- Rot gate: `tooling/check_rot.py`; type gate `tooling/check_types.sh` if present.
- No testnet broadcast needed (read-only + localStorage); parity note update
  in slice-01 delta (shell behavior change).

## Scope (YAGNI)

- No new route, no settings-envelope change, no Store topic, no dashboard
  redesign, no follow-list merge (contacts key untouched).
- All `VIEWING_AS_ID` constants stay as load-order fallbacks; no mass rename.

Self-review: no TBDs; architecture matches components; single-plan scope;
`viewing-as` verbatim strings explicit; conflicts none (extends principle #9,
doesn't violate: reads still never gate, password still only at signing).
