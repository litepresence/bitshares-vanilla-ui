# AFK Round 1 record — notice builder + ops backend + live buckets

Committed together (one round, disjoint files). Workers W1/W2 + director.

## W1 — Phase 2 shared history notice (`history-notice.js` + 10-surface swap)
- New `api/history-notice.js` (HistoryNotice.actionLink(doc,t,kind), pure DOM;
  kinds "settings"→`#/settings`, "help-es"→`#/help` — no dedicated ES article
  id exists in help-ui.js TOPICS, the ES directory lives on the `#/help`
  index (`help-ui.js:711-713`)).
- 11 sites across 8 views append the anchor after existing errors; message
  `t()` calls byte-identical (check_i18n drift-free proves it).
- Assumption: no `.touchable` CSS rule exists (JS helper only) — builder sets
  the class for forward-compat PLUS inline minHeight, so the 44px floor holds
  regardless. Unknown kind → null (fail-soft).
- Test `tooling/history-notice-test.js` 14/14. New keys: `notice.open_settings`,
  `notice.open_help` (10 dicts, en inventory extended).

## W2 — Phase 4c backend (`opsFiltered` in `api/account.js`)
- Signature triple-verified, no conflict: `get_account_history_operations(
  account, operation_type, start, stop, limit)` — start BEFORE stop (reverse
  of get_account_history). Sources: `api.hpp:146-152` (single int64 type,
  cap 100), astro `DexLiveOrderBook.ts:92-98` / `MarketTradeHistory.ts:142-148`
  (`[id, 4, "1.11.0", "1.11.0", 50]`), live sweep (`["1.2.0", 0, "1.11.0",
  "1.11.0", 1]` ok 9/9).
- Decision: singular method, one call per op type (Promise.all merge newest-
  first by 1.11 seq); `get_account_history_by_operations` (flat_set) exists
  in header but was never sweep-probed — live beats header, not used.
- Same "history-unavailable" contract as siblings; `bad-args` pre-network.
- Test `tooling/account-ops-test.js` 27/27 (stubbed Chain, no network).

## Director — A3 live-bucket reconcile (`market-ind.js` + `market-desk.js`)
- Gap found: desk intersected hardcoded PREF with live, silently dropping
  node-offered 60s/weekly buckets. `reconcileBuckets(live)`: PREF order first,
  live extras appended ascending; pool POOL_BUCKETS correctly untouched (local
  tape-bucketing, no chain leg). Fallback `avail==[] → raw live` preserved.
- 6 new vectors in chart-zoom-test (42/42, was 36).

## Gates (this round)
types PASS · rot PASS · i18n OK (3082 keys) · suites: 30/14/27/45/42/37/33/61/11
all green. Money math: none (no amounts touched). Viewports/themes: no visual
change except an appended link (44px floor, token-free anchor inherits row
style) — trio shots deferred to R5 final pass.
Anti-rot: (a) platform only; (b) nothing new (one module + 3 pure functions);
(c) deletable: builder (errors stand alone), opsFiltered (history() stands),
reconcile (old intersect restorable) — kept: every later phase reads them.
