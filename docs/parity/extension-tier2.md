# Extension Tier 2 (signing gate) — parity note

Date: 2026-10-04 (AFK build round). Scope: full Tier 2 per the approved
8-phase plan (decisions: A dApp-gate-only · SW signs+broadcasts ·
existing fixture · auto-prefer-extension · allowlist in Settings only ·
install guide · shield badge left of lock).

## 1. What shipped (code)

- `adapter/bridge.js`: protocol constants (`vb-get-chain-id/account/request-signature`,
  `WALLET_SELF`), `isValidUnsignedTx` shape gate, sliding-window
  `checkRateLimit` (5/min/origin, persisted by the SW, inputs never mutated).
- `background/session.js`: session/local vault with MV2 memory fallback.
- `background/gate.js`: SW router — validation, rate limits, intents
  (journal + 60s alarm + one-at-a-time + tab-close denies + fail-closed
  startup), SW unlock (Wallet + chrome backend, persisted backoff),
  enrichment (78-op names via `tooling/gen_tier2_opnames.py` from the
  open-graphene spec; asset precisions/symbols + account names, unknowns
  raw-never-blank), SW sign (Tx.sign vs SW Chain) + ack broadcast,
  session wipe on lock. Wallet-self always prompts, never allowlisted.
- `background/sw.js`: dist-relative importScripts (guarded — failure
  degrades to Tier 1), gate listener, approval-deadline alarms, tab-close
  deny, lock-alarm session wipe, startup deny-pendings.
- `background/firefox.html`: MV2 script tags for the same modules.
- `approval/approval.{html,js}`: journal-receipt render, countdown display,
  password-only-when-locked (H2 wipe discipline), remember-checkbox for
  dApps only, Approve/Deny/result + Close. No inline scripts (CSP).
- `content/inpage.js` (page world) + `content/inject.js` (isolated relay,
  origin attached from platform event.origin; page claims ignored SW-side).
  Manifests: MV3 + MV2 `web_accessible_resources` + MV2 content_scripts.
- `vanilla/js/api/signmode.js`: capable/effectiveMode/firstAccountId/
  requestWalletSignature (direct runtime from extension pages, provider +
  intent polling from web pages).
- `vanilla/js/api/tx-send.js`: `Tx.signRouted` + `Tx.wifOk`; 9 call sites
  rewired (pool/credit/proposal/htlc/asset-ops sendAndProve,
  transfer-confirm, trade-cancel ×2 + proveTx split, vote-ui ×2).
- `vanilla/js/store.js`: `signing` pin (auto default, validated).
- Settings: `buildSigning` section (mode display, auto/extension/browser
  radios, browser-mode warning + install-guide CTA, connected-sites list +
  per-origin revoke) + `settings.js` wiring.
- Header: `shield-check.svg` (original art, PROVENANCE entry) + `icon.js`
  registry + `paintShieldBadge` (extension-route only, taps to settings) +
  CSS. Solid-shield-always simplification recorded below (no locked/outlined
  variant — the lock icon already carries lock state).
- Help: `extension-install` article + Labs index entry; `settings` article
  gains Signing/Connected-sites paragraphs. Settings guide link targets
  `#/help/extension-install` (verified `/help/**` wildcard route).
- i18n: 33 keys (13 settings + 20 approval) via
  `tooling/add_tier2_i18n_keys.py`, all 12 dicts, non-en honestly English
  pending translators (drift gate green: 3531 keys, 4339 sites).
- Pack: `approval/` copied for both targets; zips reproduce byte-stable
  (763/764 files, hashes compared across runs).

## 2. Verified headless

- `tooling/tier2-gate-test.js`: 49 checks (validators, shape gate, rate
  limiter incl. window reset + input immutability, origin precedence,
  enrichment incl. account names, full approve→broadcast→allowlist→wipe
  flow with stubbed chrome/Chain/Wallet/Tx, wallet-self no-allowlist).
- `tooling/wallet-seam-test.js`: 13/13 (no regression).
- `check_rot.py` PASS, `check_types.sh` PASS (incl. `SignMode` global +
  `window.bitsharesWallet` casts), `check_i18n.py` OK.
- Pack reproduces byte-stable across runs.

## 3. AFK decisions (owner absent — ruling requested on return)

1. **Solid shield only** (no outline-when-locked variant): the lock icon
   already carries lock state; pairing reads correctly. Revisit if tester
   finds it ambiguous.
2. **Page WIF hygiene deferred**: in web+extension mode the page keeps its
   normal unlock (WIF in page memory); extension mode stops *signing* without
   approval but does not yet remove page-held keys. Full watch-only page is
   specified follow-up. Warning copy covers it ("or run a copy you control").
3. **Ack-based SW broadcast** (no history poll): transfer-specific polls
   would wrongly fail valid non-transfer broadcasts; callers verify
   inclusion (wallet flows run existing prove loops on the SW proof).
4. **Approval rendering is generic** (op name + every field, amounts +
   account names humanized) rather than per-op builder prose — same fields,
   less friendly labels; per-op wording is polish, not parity.
5. **MV2 event-page memory fallback**: pending intents/rate budgets vanish
   on background unload when `storage.session` is absent — fail-closed
   (approval impossible, requester ceiling surfaces it), just less smooth.
6. **No auto-approve fast path anywhere**: allowlist binds WHO may prompt,
   every request opens approval. Strongest posture, matches proposal §3.1.

## 4. Explicitly NOT done (human-gated)

Fresh-profile install drill, per-origin testnet approval + broadcast proof
on the existing fixture, cross-account denial, 60s timeout, XSS drill,
two-browser guide walkthrough, indicator states in all three themes at
360px + desktop. None can run headless. Do not claim Tier 2 "done" until
TEST-PLAN.md Tier 2 drills are observed + dated.
