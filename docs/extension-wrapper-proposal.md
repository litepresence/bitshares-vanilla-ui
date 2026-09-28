# Browser-extension wrapper: full proposal (for review)

Author: the vanilla build agent. Audience: a working web developer.
Status: PROPOSAL — post-v1 hardening, not started, not a ship blocker.
Date: 2026-09-28.

## 0. TL;DR

- The vanilla wallet (`vanilla/`) is a static web app. Its security ceiling is
  **page-origin XSS**: any script running in the page origin can read
  `localStorage` and JS memory, which is where keys live while unlocked.
- The fix is a **wrapper, not a rewrite**: repackage the exact same
  `vanilla/` code as a browser extension. Isolated extension origin + hard
  CSP + a service-worker signing gate remove the page origin from the trust
  boundary. Wallet logic doesn't change a line; only the storage backend
  needs a seam (sync `localStorage` → async `chrome.storage`, the one real
  refactor — §5).
- pi314x's extension (reference #3, in-tree copy) is **not reused as a
  chassis** — wrong shape, wrong stack, wrong product — but its *patterns*
  (approval flow, keystore properties, validation discipline) are the spec
  for the wrapper. Details in §3.
- Sequencing is deliberate: ship the audited web wallet first, then armor
  it. Armor instead of a wallet is how you get two half-products.

## 1. Current vanilla security model (what your friend is auditing)

### 1.1 Assets and where they live

| Asset | At rest | While unlocked | Notes |
|---|---|---|---|
| Brainkey-derived keys | AES-256-GCM envelope in `localStorage` (`bts-vanilla-wallet-v1`), PBKDF2-HMAC-SHA-256/600k + per-wallet salt (`wallet.js:15,84-86,118-123`) | Plaintext in JS memory (`Wallet.keys`), never DOM | Same properties as #3's keystore |
| Password/verifier | Never stored (verification is trial-decrypt) | n/a | No hash to steal |
| Settings (nodes, theme, locale) | Plain `localStorage` (`store.js`) | n/a | Non-sensitive, but node list is trust-relevant |
| Transaction payloads | Constructed in memory, signed in memory (`tx.js`, vendored secp256k1) | WIF touches JS values only, never DOM | `crypto.js` documents provenance per fn |

Session discipline: 5-minute inactivity auto-lock + lock on tab-hide
(`wallet.js:199-202,326-327`). Chain transport: single WS module
(`chain.js`), user-editable node list, chain-id checked on connect,
heartbeat + block-push keepalive, capped auto-reconnect.

### 1.2 Trust boundaries (web deployment)

- **Trusted**: the `vanilla/` bytes you serve, the API node (for data, never
  keys), the browser's WebCrypto + sandbox.
- **Untrusted**: everything else on the network path, any third-party script
  you ever add (we add none — zero runtime deps, `check_rot.py` enforced),
  and — critically — **any script executing in the page origin**.
- Supply chain: there isn't one. No npm install, no CDN, no build step.
  `python3 -m http.server` serves it. What you audit is what runs.

### 1.3 Honest weaknesses (no-holds-barred part 1)

1. **Page-origin XSS is total.** An injected script (malicious ad, compromised
   static host, browser extension with page access — ironic) can read the
   encrypted envelope AND, while unlocked, the plaintext keys in memory.
   Mitigations in place (textContent-only rendering, no `innerHTML` for
   user/chain strings, no deps to hijack) *reduce the odds*, they don't
   change the ceiling.
2. **No unlock rate-limit.** pi314x persists exponential backoff across
   restarts (`wallet-manager.js:855+`); vanilla has none. Local attacker with
   the envelope gets unlimited guesses at JS speed (PBKDF2-600k ≈ ~1s/try on
   desktop — strong but not rate-limited). **The wrapper must close this.**
3. **Envelope metadata in `localStorage`.** Ciphertext-only, but its
   existence/fingerprint is visible to page-origin code. Minor.
4. **No CSP on `file://`/static hosting.** A CSP header is a server
   behavior; we can't ship one in a folder. The extension fixes this by
   construction (`script-src 'self'`).
5. **Node list is user-editable.** A malicious node sees) all reads and
   unsigned payloads — but never keys (signing is local). Same exposure
   class as #1/#2/#3. Chain-id check + testnet/mainnet prefixes contain it.

## 2. pi314x extension review (what it is, what we took, what we didn't)

### 2.1 What it is

`pi314x/bitshares-wallet-browser-extension` v0.8.7: a Chrome-MV3/Firefox-MV2
**signer + dApp provider bridge**. Background service worker owns keys,
popup approves operations per origin, content scripts expose
`window.bitsharesWallet` (+ `window.beet` compat). One runtime dep
(`@noble/secp256k1`), build-only script, 5 test suites, honest docs.

### 2.2 Genuinely strong (ported into vanilla as patterns)

- Zero-dep crypto core (`crypto-utils.js` + vendored curve): WebCrypto
  SHA/PBKDF2/AES + noble secp256k1, constant-time boundaries documented.
  → We byte-copied the curve with provenance; reimplemented the flows.
- Keystore properties: PBKDF2-600k + salt, AES-256-GCM, unlock in
  `chrome.storage.session` only, `chrome.alarms` auto-lock, **persisted
  unlock rate-limit**, per-account keys, watch-only.
- Approval UX: 78-op human-readable confirm table (`popup.js`) — our
  confirm-dialog wording spec, field-for-field.
- Validation discipline: HTTPS-only origins, `chain_id` verification,
  60s approval timeouts, per-origin rate limits, `allowedAccountIds`
  binding (site approved for A can't sign as B), and `signMessage`
  deliberately UNIMPLEMENTED to kill blind-signing. All of this is the
  wrapper's validation checklist (§4).

### 2.3 Why it's not the chassis (inadequate *for our job*, not in general)

1. **It's extension-only.** Service workers, `chrome.storage`, alarms, side
   panels don't exist on mobile Safari/Chrome, in-app browsers, or
   `file://`. Adopting it as the product abandons the phone-first audience
   and every non-Chromium user on day one.
2. **It has a build + a dependency + store coupling.** `scripts/build.js`,
   `@noble/secp256k1` at runtime, MV3/Firefox manifests, review queues,
   signing keys. That is release-cycle coupling — the exact rot class the
   vanilla doctrine refuses (§4.5). Google's MV2→MV3 migration rewrote the
   whole extension ecosystem; betting the wallet on `chrome.*` stability is
   React-16 thinking in a different costume.
3. **It's a signer, not a wallet UI.** No dashboard, DEX, voting, explorer,
   pools, proposals — the 33 routes + 60 astro ops we already built and
   testnet-proved. Reusing it would mean *losing* the app, not gaining one.
4. **Documented weak spot we refused to copy**: biometric auth without
   WebAuthn-PRF is flagged cosmetic in its own docs (UI gate, not
   encryption). We don't do cosmetic security.
5. **Single-maintainer bus factor + store auto-update = supply-chain
   surface.** A static folder you can diff has neither.

## 3. Wrapper proposal (the actual build)

### 3.1 Shape

New top-level `extension-wrapper/` (sibling of `vanilla/`, never imported
by it). Build artifact = store zip; source = `vanilla/` copied verbatim +
four small adapter files:

```
extension-wrapper/
  manifest.json          (MV3 primary; MV2 Firefox file if cheap, else documented out)
  background/sw.js       (signing gate + alarms auto-lock + session key holder)
  content/inject.js      (isolated-world provider: window.bitsharesWallet, no key access)
  adapter/storage.js     (chrome.storage backend behind the §5 seam)
  adapter/bridge.js      (page<->SW message validation: HTTPS-only, chain_id, approvals)
  tooling/pack-extension.sh (reproducible zip; web use never needs it)
```

- CSP: `script-src 'self'` + `object-src 'none'`, no remote code, no
  `unsafe-eval`. The vendored LWC chart lib is already in-tree — allowed
  (it ships, it doesn't phone home).
- Extension origin (`chrome-extension://<id>`) isolates `localStorage`/
  memory from page origins entirely. Content scripts run in the isolated
  world; page JS can only talk through the validated bridge.
- Keys: envelope migrates `localStorage` → `chrome.storage.local`;
  unlocked material lives in `chrome.storage.session` (memory-backed,
  survives SW restarts, dies with the browser) — same as #3.
- Auto-lock via `chrome.alarms` (SW-safe, unlike `setTimeout`) + persisted
  exponential unlock backoff (closes vanilla gap §1.3.2).
- Approvals: every signing request opens the extension page (full vanilla
  confirm dialog — already human-readable per-op), 60s timeout, per-origin
  allowlist with `allowedAccountIds` binding. `signMessage`/blind-digest
  stays unimplemented. First-run migration imports the web envelope
  (explicit user action, then wipe web copy recommended).

### 3.2 What changes in `vanilla/` (kept tiny on purpose)

1. **Storage seam (§5, the one refactor):** `wallet.js`/`store.js` touch
   `localStorage` directly. Introduce `Store.backend` (default: localStorage
   adapter; extension injects the chrome.storage adapter before boot).
   Async-ification contained to load/save paths; everything else untouched.
2. **Nothing else.** Router, views, chain client, crypto, confirm dialogs
   run unmodified — that importability is the acceptance test.

### 3.3 Explicit non-goals

No Beet-compat surface beyond what our bridge needs; no token auto-add
from dApps; no analytics; no remote blocklists; no MV2-unless-cheap;
no Safari port in v1 (list as follow-up with cost).

## 4. Acceptance (definition of done for the wrapper)

1. `tooling/pack-extension.sh` reproduces a byte-stable zip from a clean
   tree; `check_rot.py` extended to the wrapper (no npm/CDN/remote).
2. Fresh profile: install → migrate-or-create → lock/unlock/backoff →
   testnet transfer approved per-origin, denied cross-account.
3. Page-origin XSS drill: injected page script cannot read keys, envelope,
   or session (assert via test page).
4. Web build untouched: same tree still serves via `http.server`, all suites
   green (`chain-keepalive`, `pool-history`, `indicators-parity`).

## 5. Why the vanilla model beats all three references (security-wise)

Same shape where it matters (keys generated, stored, and used locally —
like #1), minus each reference's structural weakness. Per-reference,
factually:

### 5.1 vs bitshares-ui (#1, React 16 wallet)

#1's *model* is correct: local keystore (`WalletDb.js`), local signing,
keys never leave the machine. Its *implementation* of that model is what
rotted, and rot is a security property:

- **Attack surface**: ~100 npm packages with install-time scripts, several
  archived/abandoned (`foundation-apps`, `react-qr-reader`,
  `react-translate-component`… — §4.3). Any one compromised dependency =
  page-origin script = key theft under §1.3.1. Vanilla has zero packages:
  there is no dependency to hijack, and `check_rot.py` proves it per commit.
- **Patchability**: #1 cannot take security patches without the thousand-hour
  uplift first (#3583). An unmaintainable app is an unpatchable app.
  Vanilla is readable in a weekend by one person; a vuln fix is a small diff,
  not a migration.
- **Confirm discipline**: #1's 27 transaction modals are stale and uneven;
  vanilla shows every op's fields in human language before signing, using
  #3's 78-op table as the wording spec — fewer blind-signing accidents.
- **Fee honesty**: #1 estimates fees from stale tables (#3720) — wrong fees
  can strand or overpay; vanilla calls `get_required_fees` live.
- **What we kept**: the good model (local AES keystore, brainkey + cloud +
  local + import, memory-only unlock, auto-lock). Barrier parity, not
  barrier invention.

### 5.2 vs astro-ui (#2, dialog wallet + Beet signing)

#2 holds **no keys at all** — it outsources signing to Beet/BeetEOS. That
looks safer until you write down where the trust went:

- **New trusted third party.** Every transaction you ever make is handed to
  a separate closed-ish process you didn't audit here, over a bridge you
  didn't design, with its own auto-update channel. Key theft becomes
  *bridge/process compromise* — a strictly larger, less visible target than
  our single audited file set.
- **Availability coupling.** No Beet running → no wallet. Vanilla signs with
  platform APIs that ship in the browser; nothing to install, nothing to
  keep alive.
- **Metadata exposure.** The external signer sees 100% of your transaction
  flow by construction. Vanilla's only network observer is the API node you
  chose (same as #1), and nodes never see keys.
- **Same treadmill, newer shoes.** React 19 + Tailwind + Radix + Electron 44
  is #1's dependency graph five years later — a future #3583 with better
  lighting. Freshness is not a security property; auditability is.
- Net: #2 *moved* the key problem sideways to someone else's code.
  Vanilla *shrunk* it to ~25k lines of dependency-free code one person can
  read. Smaller trusted base beats relocated trust.

### 5.3 vs bitshares-dex-ux (#5, Python dashboard)

#5 is not a wallet and must not be graded as one: it manages no keys, signs
nothing, so it has no key-loss scenario — and no spending capability
either. Its security-relevant surface is its *server side* (Falcon app +
self-hosted Elasticsearch with Kibana queries), which is exactly the hosted-
infra trust we refuse for history (our pool charts use ES only as an
adapter with chain fallback, §4 of the pool-desk note). The improvement is
categorical: vanilla does everything #5's plots do from chain data, *plus*
holds keys with a #1-class local model #5 never attempted.

### 5.4 The one-line version

#1 had the right model and let it rot. #2 relocated trust to a third party
on a fresh treadmill. #5 never held keys at all. Vanilla keeps #1's model,
deletes its attack surface, refuses #2's treadmill and third party, and
leaves #5 to styling — then documents the remaining ceiling (§1.3) instead
of marketing it away.

## 6. Open questions (your call + your friend's)

1. MV2 Firefox manifest too, or MV3-only at first?
2. dApp bridge scope: full provider API, or signing-gate-only (safer, less
   compat)?
3. Rate-limit params (start at #3's 1s→60s exponential?).
4. Session-vs-memory for unlocked material (compat vs paranoia)?
5. Safari `browser.*` port — follow-up or never?
