# Multisig UX audit + repairs — 2026-10-06

Skill: `skills/multisig-ux/SKILL.md` (new). Scope: make multisig
(shared-authority) users feel at home and in command of propose/approve
work without cluttering the simple single-key case. Canonical test:
asset updates on assets owned by multiple parties — clear propose path
for co-owners, clear approve path for co-owners, plus a login entry.

## 1. Reference behavior (file:line)

- #1 `AccountPermissions.jsx:36-77` — threshold + account/key/address
  auths round-trip (`permissionsFromImmutableObj`/`permissionsToJson`);
  `Proposals.jsx:61-100` — proposal list + required-perms unnest;
  `NestedApprovalState.jsx` — nested approval tree concept;
  `ProposedOperation.jsx` — nested-op human renderer.
- #2 `proposals.astro`, `custom_authorities.astro`,
  `Proposals.json`, `CustomAuthorities.json` — modern dialog wording
  for propose/approve/authority flows (builders taken, Beet signing
  not taken).
- #3 `popup.js` 78-op table — confirm-dialog wording spec (named rows,
  never raw JSON as the whole UI).
- #4 `protocol/authority.hpp` (authority shape + FC order),
  `protocol/proposal.hpp:70-82/:119-165` (op-22/23/24 fields),
  `chain/account_object.hpp` (active/owner on the account object).

## 2. Vanilla implementation (before -> after)

Before (gaps found):

1. `/login` (`auth-ui.js`) — Card A local unlock + Card B cloud lookup
   only. No shared-account entry; a co-owner lands with no story.
2. `#/account/:name` (`account-ui.js` `showAccount`) — Balances/Orders/
   History/Membership/Equity/Margin/Credit tabs; no threshold badge,
   no permissions surface, no link to the proposals queue.
3. `#/assets/update/:symbol` + `#/assets/issue` (`asset-manage-ui.js`)
   — direct op-11/12/13/14/15 only, `issuer == mine` guard; a multisig
   issuer fails at sign time with no pre-warning and no propose path;
   the read-only guard is a dead end for co-owners.
4. `#/proposals` (`proposal-ui.js`) — one story line + flat
   approved/pending per approver (documented: no threshold tree);
   account entry defaults to `1.2.0` with manual typing; no pointer
   to `#/txbuilder` for multi-op/multi-device work.
5. `#/txbuilder` (`txbuilder.js` backend has `wrapProposal`,
   `exportJSON`/`importJSON`, `signLocal`, `broadcastSigned`,
   `resolveAuths`; `txbuilder-ui.js` desk) — authorities pane +
   export/import exist, but the header comment's Direct/Proposal
   send-choice is unwired and the empty state linked only
   Transfer/Voting/Pools (proposals undiscoverable).

After (this repair, no new route, no new dep):

- `auth-ui.js:262` `multisigCard(doc, wrap)` — Card C "Shared /
  multisig accounts": one muted line (single-key wallet truth) +
  3-step list (propose -> share 1.10.N id -> approve op-23 / txbuilder
  co-sign) + `View proposals` + `Open transaction builder` links.
  Mounted in all three login paths: unlocked (`:308`), post-unlock
  transient (`:353`), locked (`:438`).
- `asset-manage-ui.js:139` `multisigNote(d, v)` — "Shared issuer?
  Propose it" + body + the same two links. Mounted: read-only guard
  (`:199`, with an extra co-owner hint line), below the op-11/12/13
  forms (`:328`), on issue/reserve (`:412`).
- `proposal-ui.js:592` `multisigStory()` — second muted line stating
  the co-owner story + `Open transaction builder` link (the first
  story line is unchanged).
- `account-ui.js:1433` `authBadge()` — one `get_accounts [[id]]`
  read per render; human `active M/N · owner P/Q` counts (threshold /
  authority-entry count); "Single key" vs "Shared account" wording;
  links to `#/proposals` + `#/txbuilder`; honest unavailable line.
  Never blocks balances/orders; `root.isConnected` guards stale paint.
- `txbuilder-ui.js:96` — empty-state links gain `Proposals`.
- `tooling/sync_multisig_i18n.py` (new, saved per repo policy) —
  adds the 22 keys to all 12 dicts as honest English stubs and keeps
  `_meta.translated` coverage-exact.

## 3. Manual test steps + observed result

- `node --check` on the 5 touched view files: all OK.
- `bash tooling/check_types.sh`: PASS (after fixing one 3-arg call
  to the 2-arg `multisigCard`; no behavior change).
- `python3 tooling/check_rot.py`: PASSED (no deps, no CDN, no build).
- `python3 tooling/check_i18n.py`: our 22 keys drift-free (zero hits
  for `multisig`); the gate stays red ONLY on pre-existing dirty
  `borrow-ui.js` keys (`borrow.adjust`, `borrow.repay_full`,
  `borrow.close_position`) from uncommitted work outside this repair —
  untouched here by scope discipline.
- Headless grep: `multisigCard` x3 mounts, `multisigNote` x3 mounts,
  `multisigStory` x1, `authBadge` x1, `txbuilder.link_proposals` x1;
  `en.json` values match call-site defaults verbatim (checked via
  the drift script: zero multisig hits).
- Browser pass (human tester, pending): load `#/login` locked +
  unlocked (Card C visible, links work, no password field added);
  `#/account/committee-account` (Single key badge) + a multisig
  fixture if available (Shared badge); `#/assets/update/<sym>`
  read-only + issuer views (note + links, no dead end);
  `#/proposals` (two story lines); `#/txbuilder` empty (4 links).
  Phone 360px + desktop 1440px; all three themes.

## 4. Raw -> human vectors (thresholds are counts, not money)

No `format.js` money math applies (thresholds/weights are plain u32/u16
counts, never precisions or hundredths). Display contract:

- `active {weight_threshold:1, account_auths:[], key_auths:[[pub,1]], address_auths:[]}` -> "Single key — active 1/1 · owner 1/1."
- `active {weight_threshold:2, account_auths:[[1.2.7,1],[1.2.9,1]], key_auths:[], address_auths:[]}` -> "Shared account — active 2/2 · owner …" (N = entry count, never a raw dump as the whole UI; raw JSON stays in `<details>` on proposals).
- Proposal approvals stay `required · approved` + per-approver
  active/owner lines (existing `approvalLines`/`approvalCell`,
  unchanged); missing local key reads "no local key — share the id",
  never a trace.

## 5. Themes + viewports

- No hardcoded hex in the repair (muted paragraphs, links, `h2`,
  `ul`; touch floors via shared `touchable` / `minHeight:44px`).
- Phone: Card C steps stack as a plain list; badge/links wrap;
  all targets >=44px in >=1 dimension; no hover-only UI.
- Desktop: inline links ride the existing wrap grid; no narrow-column
  stranding (no layout change beyond content lines).
- Screenshot trio + 360px/1440px flow checks: with the human tester
  (same pending browser pass as slices 2-17).

## 6. Readability

- Every touched file keeps its module header; new helpers carry
  what/params/returns/failure-modes comments (`multisigCard`,
  `multisigNote`, `authBadge`, `multisigStory` inline).
- No `TODO|FIXME|XXX|HACK`, no commented-out code, no dead files;
  `tooling/sync_multisig_i18n.py` has a module docstring + usage.
- Shared utils only (`DOM`, `Forms`, `ConfirmDialog` untouched,
  `touchable`/`Event` patterns followed); no local `el/clearRoot/
  fieldRow/confirmList` copies added (asset-manage's local `el/touch`
  is pre-existing documented duplication, reused not extended).

## 7. Anti-rot gate (§4.5 a-c)

- (a) Ten-year test: static text + one `get_accounts` read + hash
  links. No dependency, no service, no build step. Still runs.
- (b) Newly depended on: nothing. No package, no CDN, no hosted
  asset, no new route, no new toolchain. i18n additions are data.
- (c) Smallest deletable subset: the five content lines (login card,
  asset notes, proposal story, badge, txbuilder link) are each
  independently deletable; the pages work without them. Kept because
  together they are the propose -> share -> approve story a co-owner
  needs; individually they would re-create the dead ends found above.

## 8. Type + i18n gate evidence

- `bash tooling/check_types.sh` — PASS (checkJs, no emit).
- `python3 tooling/check_rot.py` — PASSED.
- `python3 tooling/check_i18n.py` — 22 new keys key-complete
  (3633 keys) and call-site drift-free for this repair; gate red only
  on outside dirty keys (see §3). Non-en values are honest English
  stubs pending human translation (principle #10).
