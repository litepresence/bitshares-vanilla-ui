# Extension Tier 1 — human test plan (UNVERIFIED IN-BROWSER)

Status: SCAFFOLD ONLY. Nothing below has been run in a real browser —
headless CI cannot install an extension, so every step here is human-gated.
Do not claim Tier 1 "done" until a human has checked each box on a fresh
profile and recorded the observed result + date next to it.

Source: docs/extension-wrapper-proposal.md §4 (acceptance). Patterns (not
code) from #3 pi314x v0.8.7 (proposal §2.2); all wrapper files are fresh —
nothing copied from reference/wallet-extension/.

## 0. Reproduce the artifact (any machine, no browser needed)

- [ ] `bash tooling/pack-extension.sh` from a clean tree prints two sha256
      lines; re-running prints the SAME hashes (byte-stable: fixed
      timestamps, sorted entries, fixed perms).
- [ ] `unzip -l extension-wrapper/dist/chromium.zip` contains
      `content/inject.js`, `adapter/storage.js`, `adapter/bridge.js`,
      `background/sw.js`, `manifest.json`, `icons/`; firefox.zip the same
      plus `background/firefox.html`.
- [ ] `python3 tooling/check_rot.py` PASS (vanilla/ clean — the wrapper adds
      no runtime dep to the web build; wrapper zips contain no
      `src="https://"` script/link — the pack script's remote-code grep is
      the gate).

## 1. Install drill (fresh browser profile)

- [ ] Chromium/Edge/Opera: load `dist/chromium/` unpacked (or the zip via
      the store flow). Firefox: `dist/firefox/` (MV2 + gecko id).
- [ ] Extension loads with zero warnings (no CSP complaint, no missing
      file, no `unsafe-eval`).
- [ ] Opening the wallet page shows the exact web UI (same routes, same
      retro styling, same three themes) — Tier 1 changes no pixels.

## 2. Migrate-or-create drill

- [ ] Fresh profile, no prior web envelope: create wallet (brainkey +
      password) inside the extension page; reload; envelope persists.
- [ ] Existing web user: explicit first-run import of the web envelope,
      then WIPE the web copy (recommended step shown, never automatic).
- [ ] Settings round-trip: change theme + node, reload extension page,
      both persist (Store.backend seam: same keys as web).

## 3. Lock / unlock / backoff drill

- [ ] Unlock with correct password works; lock (manual + 5-minute
      inactivity + tab-hide) wipes in-memory keys.
- [ ] Wrong password twice in a row: second attempt waits ~1s (in-memory
      exponential 0,1,2,4,8…s cap 30s); a persisted lockout stamp blocks
      immediate retry after reload (`bts-vanilla-lockout-v1`).
- [ ] Service-worker restart (idle 30s+) does not lose the alarm: the
      `vb-lock` alarm still fires and open pages lock.

## 4. XSS drill (the ceiling test — proposal §1.3.1)

- [ ] On a plain web page (NOT the extension page), run an injected script
      that tries: `localStorage.getItem("bts-vanilla-wallet-v1")`,
      reading `window.bitsharesWallet` internals, and `postMessage`
      phishing without user approval.
- [ ] Assert: page-origin script reads NO keys, NO envelope, NO session —
      extension-origin storage is a separate origin the page cannot touch;
      `window.bitsharesWallet` exposes message-only stubs with zero key
      access (see content/inject.js header).
- [ ] Tier 2 (WIRED 2026-10-04, parity: vanilla/notes/extension-tier2.md):
      approval page shows every op field (names + humanized amounts +
      resolved account names, unknowns raw-never-blank); 60s timeout denies
      silently (alarm backstop, countdown is display-only); a site approved
      for account A cannot sign as B (allowedAccountIds binding, bridge.js);
      tab-close denies (closing is never consent); `signMessage` refuses
      loudly; HTTPS-only + chain_id check enforced; rate limit 5/min/origin
      (session-persisted, fail closed); wallet-self always prompts, never
      allowlisted. Headless proof: `node tooling/tier2-gate-test.js` (49
      checks). Browser proof below still required.

## 5. Web build untouched (regression gate)

- [ ] Same tree still serves via `python3 -m http.server` (no extension
      file is ever imported by `vanilla/index.html` — adapter injection
      happens only inside `dist/`, never in source).
- [ ] All suites green: `node tooling/wallet-seam-test.js` (13/13),
      `pool-history-test.js`, `market-fills-test.js`, `pool-graph-test.js`,
      `indicators-parity-test.js`; `check_rot.py` PASS; `check_i18n.py` OK.

## What REMAINS human-gated (explicitly not claimed)

Install drill (§1), XSS drill (§4), install-guide walkthrough (two
browsers), header-indicator states (three themes, 360px + desktop), and any
testnet approval flow: none can run headless, none has run. The Tier 2
signing gate (approvals UI, session key holder, allowlist persistence,
wallet-as-dApp seam, settings section) is WIRED and headless-tested
(`tier2-gate-test.js` 49/49, pack byte-stable) — the browser + testnet
proof above is still required before any "done" claim. See
vanilla/notes/extension-tier2.md §4 for the exact drill list.
