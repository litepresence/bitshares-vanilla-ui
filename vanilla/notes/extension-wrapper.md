# Extension wrapper v1 (Tier 1) — parity note

Date: 2026-09-28. Scope change approved by owner: wrapper moves from
post-v1 to v1 Tier 1 (repackage + harden; Tier 2 signing-gate stays
follow-up). Full rationale: `docs/extension-wrapper-proposal.md`.

## 1. Reference behavior

- #3 pi314x v0.8.7: MV3 + MV2 manifests, `script-src 'self'` CSP,
  `chrome.storage.local` envelope + session unlock, alarms auto-lock,
  persisted backoff, per-origin approvals. Patterns ported; chassis refused
  (proposal §2.3).
- Web-extension platform: `browser` (Firefox/Safari) vs `chrome`
  (Chromium); MV3 service_worker vs MV2 background page + browser_action.

## 2. Vanilla implementation

- Seam: `wallet.js` storage backend (`setBackend`, default localStorage —
  web-identical) + unlock rate-limit (in-memory exponential + persisted
  stamp). `store.js` untouched (sync contract preserved).
- `extension-wrapper/`: `manifest.json` (MV3, CSP locked, connect-src *
  for user nodes), `manifest.firefox.json` (MV2 + gecko id),
  `background/sw.js` (compat namespaces, install defaults, alarm lock
  fan-out), `background/firefox.html`, `adapter/storage.js` (injected
  pre-wallet), `icons/` (stdlib-generated, byte-stable).
- `tooling/pack-extension.sh`: reproducible zips (fixed timestamps, sorted
  entries), adapter injection verified, remote-code scan gate.
- `tooling/wallet-seam-test.js`: 13/13 (default path, async path,
  delay + stamp). `tooling/make_ext_icons.py`: icon generator.

## 3. Observed

- Pack: chromium.zip (653 files) + firefox.zip (654, +background page),
  manifests parse (v3/v2), adapter ahead of wallet.js, no node_modules/git,
  zip integrity OK.
- Real-DOM round trip (headless Chromium): create → pub BTS5sm… → lock →
  unlock → identical pub, zero console errors.
- Browser matrix (shipped vs documented): Chromium/Edge/Opera MV3 ✓ (shipped);
  Firefox MV2 ✓ (shipped); Safari: code-compatible (no chrome-only APIs),
  needs Xcode wrapper app (follow-up, needs Mac + Apple account);
  Firefox Android: installable via AMO (distribution step); Chrome Android:
  NO extension support exists — web build is the mobile story (honest).
- No console errors; rot/i18n gates green.

## 4. Vectors

Seam suite covers envelope shape (existing vectors), delay timing (≥900ms
on 2nd consecutive failure), stamp short-circuit, backend separation
(distinct ciphertexts). No money math in this slice.

## 5. Readability

Headers own/consume/side-effects on all new files; no dead text.

## 6. Anti-rot

(a) Wrapper dies gracefully: web build never imports it; pack script is
dev-only. (b) New deps: none (python3+zipfile already required by tooling;
icons generated, not downloaded). (c) Deletable: whole directory —
vanilla stands alone. `check_rot.py` PASS.

## 7. Ship-day ruling R5 (2026-10-01, binding)

Tier-1 human install drill GATES v1 (fresh-profile install + lock/unlock
round-trip + adapter-ahead-of-wallet check, observed + dated in TEST-PLAN).
Tier-2 (approval UI, 60s timeout, `allowedAccountIds`, session holder,
HTTPS + chain-id checks — validators ship unwired) is scheduled follow-up,
never a v1 blocker. Web-app-alone was the original proposal; the 2026-09-28
owner call moved Tier-1 into v1 and this ruling keeps it there.
