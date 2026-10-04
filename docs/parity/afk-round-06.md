# AFK Round 6 record — deferral round: cursor probe, head age, pool buckets

## D1 — B4 cursor probe: UNVERIFIABLE, first-page-only stands
- `tooling/settle-cursor-probe.mjs` (stdlib, history-probe framing): 28 live
  calls across 3 mainnet + 1 testnet node — market-wide harvest on the 5
  biggest MPAs + `by_account` on 1.2.0/committee-account — ALL `ok, count 0`.
  Method exists everywhere; no open settlements exist to page through.
- Verdict per brief §2: direction UNVERIFIABLE, do not invent semantics.
  `mySettlements` keeps `("1.4.0", limit≤300)` single-page. The script
  already implements the full overlap-ladder + direction emitter — re-run it
  when an open settlement exists; no new code needed then, just the verdict.
- Disclosed gap: BTC/ETH/HERO never harvested (5-asset cap); irrelevant to
  the verdict, noted for the retry.

## D2 — head age in-row (`settings-nodes.js` + 1 key, 61/61)
- `latencyText(t, ms, ageS)` pure + `_test` seam: "621ms · 0.8s", missing age
  → bare latency (no dangling separator). Success + mismatch paths; catch
  untouched. Cards free via setRow mirror.
- Interpolation found: `t()` honors `%(n)s` (i18n.js:49-58), but the
  settings-injected `t` is 2-arg (settings.js off-limits) — so split/join at
  the call site (pool-graph precedent), unit owned by the keyed template.
- Key `settings.age_s` "%(n)ss" × 10 dicts + inventory. Shot: all rows carry
  both signals, zero errors.

## D3 — pool buckets `[…, 14400, 86400, 604800]` (39/39)
- One-line list change; both consumers audited (default 300 stays member —
  checked radio never dangles; swapsToCandles/rebucket bucket-agnostic;
  pool candles emit non-empty slots only, so bigger buckets just fill more).
- bucketLabel already covered all 8 sizes (headless-verified) — zero strings.

## Gates
types PASS · rot PASS · i18n OK (3094 keys) · health 61/61 · pool-hist 39/39.
Anti-rot: (a) platform only; (b) nothing new except one probe script (tooling,
never shipped); (c) all three deletable to prior behavior — kept: two close
real gaps, one banks a future re-probe.
