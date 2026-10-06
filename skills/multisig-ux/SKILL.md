---
name: multisig-ux
description: Use when designing, auditing, or repairing multisig/shared-account UX in vanilla — propose/approve flows, threshold display, login entry, asset updates by co-owners
---

# Multisig UX

## Overview

Multisig (shared-authority) users must feel at home and in command of
complex propose/approve work without cluttering the UI for the common
single-key case. Rule: **simple stays simple, shared stays visible.**
Every mutating form defaults to direct Send; Propose is a revealed
secondary path. Every multisig-relevant page names the threshold, the
missing approvers, and the next step — never a bare id or a silent
failure.

## When to Use

- Adding or changing any propose (op-22) / approve (op-23) /
  unapprove-reject / delete-veto (op-24) flow
- Displaying any authority, threshold, weight, or required-approver set
- Touching login/registration, account header, asset update/issue,
  transfer/barter/borrow/credit propose paths, the proposals desk,
  or the txbuilder authorities pane
- Auditing whether a multisig user can complete a task (asset update
  by co-owners is the canonical test)

When NOT to use: pure single-key flows with no authority surface
(that is `building-vanilla-slices`); pure chain-call mapping with no
UI (that is `mapping-chain-calls`).

## Core Contract (non-negotiable)

1. **Progressive disclosure.** Direct Send is the default everywhere.
   Propose appears as a secondary toggle/button/note — never a modal
   that blocks the simple case, never a new required field on it.
2. **No clutter for the simple case.** Single-key accounts see at most
   one muted multisig line or link per page. Threshold badges read
   "Single key" and stop there.
3. **Thresholds in human terms.** `weight_threshold` + weights are
   plain integers (not money, not hundredths) — display them as
   `met/required` counts with named approvers, never as raw JSON only.
4. **Propose -> share -> approve is one story.** Every propose result
   links to the proposal id (`#/proposals/1.10.N`); every approve
   screen links back from the account and asset pages. A co-owner
   never has to guess the proposal id.
5. **Signing stays local and explicit.** Unlock is asked only at
   Sign & Send (locked previews stay readable). A multisig note never
   implies keys leave the device, and a missing local key reads as
   "no local key — share the proposal id with a co-owner", never as
   an error.

## Chain Truth (#4 wins)

- Authority shape: `{weight_threshold u32, account_auths [[1.2.N, w16]...],
  key_auths [[pub, w16]...], address_auths [[addr, w16]...]}`
  (`protocol/authority.hpp`; FC order
  `(weight_threshold)(account_auths)(key_auths)(address_auths)`).
- Account authorities live on the account object (`active`, `owner`);
  asset issuers, proposal approvers, and tx signers all resolve to
  these. Threshold met = sum(weights of available) >= threshold.
- Proposals: op-22 `proposal_create` (fee-payer = proposer,
  `proposed_ops`, `expiration_time`, `review_period_seconds`),
  op-23 `proposal_update` (approve/unapprove by fee-payer),
  op-24 `proposal_delete` (veto) — `protocol/proposal.hpp:70-82/:119-165`.
- Node helpers (best-effort cross-checks, never load-bearing):
  `get_required_signatures`, `get_potential_signatures`
  (`database_api.hpp`); client-side threshold math is authoritative
  for display.
- Fees always from `get_required_fees` at review time. Never copy
  static fee tables.

## Reference Map

| Question | Consult |
|---|---|
| How did the old UI edit thresholds? | #1 `AccountPermissions.jsx:36-77` (permissionsFrom/ToJson), `AccountPermissionsList.jsx`, `AccountPermissionsMigrate.jsx` — port the WORDS/flow, not the 500-line editor |
| How did the old UI list/approve proposals? | #1 `Proposals.jsx:61-100` (proposal list + required perms), `NestedApprovalState.jsx` (nested approval tree concept), `ProposedOperation.jsx` (nested-op renderer) |
| What is the modern dialog wording? | #2 `proposals.astro`, `custom_authorities.astro`, `Proposals.json`, `CustomAuthorities.json` — take op builders + labels, not Beet signing |
| What does a safe confirm show per op? | #3 `popup.js` 78-op table — field-level wording spec |
| What are the exact fields? | #4 `protocol/authority.hpp`, `protocol/proposal.hpp`, `chain/account_object.hpp` — ground truth |

## Login Section Spec (Card C)

`/login` is two cards today (local unlock + cloud lookup). Multisig
adds Card C — **"Shared / multisig accounts"** — below Card B, above
the footer links, in locked AND unlocked branches (plus the
post-unlock transient):

- Title + one muted line: this wallet holds one key; shared accounts
  need proposals + co-owner approvals, coordinated by proposal id.
- Three bullets (plain words, no new route): propose the op (transfer
  has Send/Propose; assets/barter/borrow link to `#/proposals`);
  share the `1.10.N` id with co-owners; co-owners approve op-23 on
  `#/proposals/1.10.N` (or sign via `#/txbuilder` export/import).
- Two touch-sized links: `View proposals`, `Open transaction builder`.
- No password field, no key handling, no chain call. Static text only.

## Propose Flow Spec (asset-update canonical example)

Asset updates on multisig-owned assets are the canonical test:

1. Asset page (`#/assets/update/:symbol`, `#/assets/issue`) shows the
   public read panel first (locked-safe), then the direct form.
2. Below the direct Review button, a muted multisig note: if the
   issuer needs more than one approval, direct Sign fails loudly —
   propose instead. Links: `#/proposals` (create + approve) and
   `#/txbuilder` (multi-op / multi-device).
3. On the `not-issuer` / read-only guard (viewer is not the issuer),
   the note becomes the primary path: "Only the issuer can edit —
   if you are a co-owner, propose it and ask co-owners to approve
   op-23", with the same links.
4. Propose result (op-22) shows the new `1.10.N` id + head block +
   "View proposals" link. Never a bare "sent".
5. Same pattern applies to transfer (already has Send/Propose),
   barter (already has Propose barter), and any future direct-only
   form: add the note + links, do not rebuild the form as a proposal
   form.

## Approve Flow Spec (co-owner)

1. Proposals desk (`#/proposals`) opens with one muted line stating
   the story: anyone proposes, approvers sign op-23, vetoes use op-24.
2. Table shows per-proposal approvals as `required · approved`
   plus a trust badge; detail (`#/proposals/:id`) shows per-approver
   active/owner lines + key approvals + enclosed-op human table +
   raw-JSON `<details>`.
3. Approve/Reject panels take an explicit approver account (defaults
   `1.2.0`, never the wallet silently) and confirm with named rows.
4. Missing-key states read "no local key — share the id", never a
   stack trace. Expired proposals read "expired", never approve-able.
5. Account header carries a threshold badge (see below) linking here,
   so a co-owner arriving from `#/account/:name` finds the queue.

## Account Threshold Badge Spec

On `#/account/:name`, below the follow row, one aria-live line:

- Loading: "Checking authorities…".
- Single key: "Single key — active 1/1 · owner 1/1." + muted
  "Shared account? Proposals live on #/proposals." (links inline).
- Multisig: "Shared account — active M/N · owner P/Q." + approver
  names where resolvable + links to `#/proposals` and `#/txbuilder`.
- Failure: honest muted "Authorities unavailable — proposals still
  list on #/proposals." Never blank, never blocks balances/orders.

One `get_accounts [[id]]` call per render; gen-guarded; no unlock gate.

## Audit Checklist (run per repair)

1. Simple-case clutter: load each touched page unlocked single-key —
   at most one muted multisig line; Send still default and primary.
2. Login Card C present in locked, unlocked, and post-unlock paths.
3. Asset update + issue carry the propose note + links; read-only
   guard points co-owners at op-23 (no dead end).
4. Proposals desk states the propose->approve->execute story up top.
5. Account badge shows single vs shared correctly (use committee
   `1.2.0` single + a known multisig fixture if available).
6. Every new string is `t(key, enDefault)` + 12-locale entries
   (`check_i18n.py` green); touch targets >=44px; themes clean
   (no hardcoded hex); `check_types.sh` + `check_rot.py` green.

## Implementation Rules

- Shared utils only (`DOM`, `Forms`, `ConfirmDialog`, `Overlay`,
  `TableRenderer`, `Event`, `touchable`) — no local `el/clearRoot/
  fieldRow/confirmList` copies (audit greps for these).
- One `get_accounts` per badge render; no polling; gen counters kill
  stale work; offline panels use the shared `Offline` helper.
- Amounts/precisions still go through `Format` (principle #6);
  thresholds/weights are counts (no decimals, no percent math).
- Phone 360px + desktop 1440px both usable; no hover-only UI.
- No new runtime dep, no new route, no new build step without a
  written §4.5 exception naming its removal plan.

## Common Mistakes

| Mistake | Fix |
|---|---|
| New `#/multisig` console route | Don't — link the existing desks (`#/proposals`, `#/txbuilder`) |
| Propose toggle on every form | Note + links only, except transfer/barter which already propose |
| Raw `weight_threshold` JSON as the whole UI | Human `M/N` + named approvers; JSON stays in `<details>` |
| Silent direct-sign failure for multisig issuers | Loud guard + propose path before any broadcast |
| Missing-key stack trace on approve | "No local key — share the id" + links |
| Hardcoded display text to "save time" | Key it now with all 12 dict entries |
| Local helper duplicating DOM/Forms/Confirm | Use the shared global (rule 9) |
