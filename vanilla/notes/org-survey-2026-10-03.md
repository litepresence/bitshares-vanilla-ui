# Org survey 2026-10-03 — bitshares/* feature trawl (8 workers, JSON verdicts)

Method: 102 repos listed (100 + 2 pages, API), 8 disjoint surveys, 1 tree call
per repo + raw fetches only (rate-limit discipline). Workers returned JSON
with ADOPT/ADAPT/DEFER/REJECT verdicts. Totals: 9 ADOPT, 19 ADAPT, 5 DEFER,
6 REJECT. Full JSON in worker reports; this note aggregates + adjudicates.

## CONFLICTS (live sweep overrules code citations — chain-doctor rule)
- C1: two surveys cite `asset_api get_asset_holders[_count]` as a live read
  path (explorer-api, open-explorer service.asset.js). OUR sweep
  (tooling/history-capabilities-2026-10-02.json, 9/9 nodes) proves
  `get_asset_holders` = `-32601 Method not found` on both api ids. Their
  code targets either a long-dead plugin or a custom patch. Verdict: the
  "rich lists off asset_api" and "holders pagination via WS" recommendations
  are NEEDS-PROBE, not ADOPT — re-probe against a stated node version before
  any implementation. Our ES-backed top-25 stands regardless.
- C2: `get_top_holders` named as a chain method (open-explorer survey). No
  such method in our sparse checkout or sweep. NEEDS-PROBE likewise.

## ADOPT (build nearly as-is) — ranked by value/effort
1. CSV history export, 11 CoinTracking columns (report) — S. Biggest gap vs
   reference exporter; pure strings + format.js.
2. Beet confirm-dialog layout (header + per-op rows + raw drill-down +
   Sign vs Sign-and-Broadcast) — M. Proves the field set; fixes a real
   confusion class in our dialogs.
3. Fail-closed defaults: 5-min-equivalent seed wipe posture, modal-close =
   reject, post-broadcast receipt (beet) — S. Trust win, timers + callbacks.
4. Pool stats strip: valuation + 24h swaps + both fees + per-share value
   (PoolTool) — S. Display math only.
5. Client TTL memo (explorer-api @cache.memoize port) — S. Responsiveness
   without a server; invalidate on sign/broadcast.
6. Bottom tab bar + locked phone shell (community-ui/mobile) — S. Serves #7.
7. Faucet availability shape (lookup + Rails-compatible POST + verbatim
   errors) — S. Closes our faucet loop.
8. SLIP-0048 doc paragraph (ledger) — S. Zero code.
9. Asset-aggregate columns spec (open-explorer service.asset.js 7 columns) —
   M. Only the COLUMN DEFINITIONS adopted (C1 applies to sourcing).

## ADAPT (idea good, vanilla rework needed) — top picks
- BSIP-0060 `bitshares:` URI parser + dispatcher (infra) — S. Accepted
  protocol no UI implements; natural invoice-route extension. Never
  auto-execute — pre-filled confirm only.
- Feed-health panel: CER premium, MCR/MSSR, staleness badges (witness-monitor)
  — S. Display math over fetched feeds.
- Invoice → merchant receive view: prefill link + QR + paid-watcher
  (report/pay) — M. Zero backend; QR hand-drawn, watcher polls history.
- QR scan-to-transfer + file fallback (btsgo) — M. Platform APIs only.
- Grid-parameter educator, read-only (DEXBot2) — M. Static copy + pure fn.
- Slippage-floor wording + anticipated-vs-minimum confirm (PoolTool) — S.
- Bottom-tab/phone patterns: compact orderbook, K-line settings, multi-fiat
  estimator (mobile) — S/M. CSS + config + Intl.
- Per-origin grant table + link/relink identity (beet) — M/L. Extension-
  wrapper Tier-2 design source.
- WS market dashboard from ticker fan-out (read-APIs) — M. Bounded + memoized.
- Committee USD fee-comparison read (committee-tools) — S.
- Holders/count + volume-bars + DEX totals (open-explorer) — M, gated on C1.

## DEFER (tracked, not built)
Beet transport, Ledger integration, report ES path + hardcoded income rules,
BSIP-0040 purpose-keys, BSIP-0084 elections. Plus standing: blind-tv suite?
No — mobile survey found full Blind/Stealth suite in bitshares-mobile-app
(TransferToBlind etc.): parked as DEFER-to-investigate (confidential
transfers need chain + serializer work first).

## REJECT (with reason)
Their 5-box search (we superset it), blind-sign passthrough (our spec
forbids), pay watcher/auto-refund (custodial daemon), bot daemons + Python
stacks (release-cycled runtimes), hosting Flask/Hug/ES servers (#3583
recurrence), biometrics/push/widgets (no web equivalent; even the native
app's manifest lacks the permissions), OTC P2P fiat marketplace (85KB
OtcManager in mobile-app: custodial mediation + off-chain rails + dispute
flow — a company, not a feature; parked explicitly).
