# AFK Round 8 record — org-survey top 5 built

## T5-1 CSV export (`history-export.js` + account button, 23/23)
- 11 CoinTracking columns verbatim; mapping Deposit/Withdrawal/Trade clipped
  to general rules (NO hardcoded Income IDs — refused); unknown/foreign/
  malformed rows SKIP; Trade Group "" (grouping = follow-up). RFC-4180
  cells, Blob download guarded. Button verified live next to the filter.

## T5-2 BSIP-0060 URIs (`bitshares-uri.js` 77/77 + router.query)
- Grammar confirmed from bsip-0060.md (Draft). All 6 kinds; transfer →
  `#/invoice?…` contract; txhash reuses resolveTxHash (never duplicated);
  amount stays human; unknown → honest error, never auto-execute.
- Live proof: `bitshares:market/BTS/USD` → `#/market/USD_BTS` (QUOTE_BASE),
  transfer parses, garbage → unknown-type with no navigation.

## T5-3 Beet confirm layout (`transfer-confirm.js`, zero new keys)
- Header (account · chain · network) + one op-card each + raw drill-down per
  card + Back always visible. Close-path audit: fail-closed proven, one hole
  fixed (missing onBack → dead button, now falls back to #/transfer).
  Sign-only correctly NOT built (needs export UI — follow-up).

## T5-4 feed-health strip (explorer-assets, insertion-only)
- LIVE badge / CER premium / MCR-MSSR / last update / publishers, all over
  fetched objects, "—" + titled honesty elsewhere.
- MATH VERIFIED END-TO-END (not just fixture): live bitUSD legs
  (CER 16624912587×3456322783222 vs settle 12555×91129996, p4/p5) hand-computed
  to ratio 34.9132 → "+3391.32%" EXACTLY as displayed. The alarming value is
  chain truth (witness CER legs sit far from settlement), displayed with raw
  legs in title per doctrine — not a formula bug.

## T5-5 merchant invoice (misc-ui, QR deferred with reason)
- Query prefill + share-link rebuild from live form + paid-watcher (one
  history read on load/tap, paid/unpaid states, N=1 honest). QR: no
  Reed-Solomon hand-roll, no sub-15KB vendored lib — text payload + print
  instead, deferral shown as a muted note (gateway-ui precedent).
- Live proof: `#/invoice?to=&asset=&amount=&memo=` prefills all four +
  Checkout request renders, zero errors.

## Integration (director)
- index.html tags (history-export after format.js; bitshares-uri before
  router.js) + globals.d.ts declares.
- i18n: wired t()/tt() through bitshares-uri (tt rename — parse loop owns
  `t`; 77/77 caught it), upgraded explorer-assets helper to 3-arg, keyed
  all feed/misc/account literals. Fixed gate tooling gap: t() defaults with
  `\uXXXX` escapes NEVER match (gate unescapes only \" and \\) — codemodded
  to raw chars (semantics-identical), rule recorded here for all future
  workers. Keyed another session's api-lab feature (3 commits landed
  mid-round without dict entries — keying only, design NOT reviewed).
- Gates: types PASS · rot PASS · i18n OK (3196 keys, 4086 sites) · all 17 suites green.
