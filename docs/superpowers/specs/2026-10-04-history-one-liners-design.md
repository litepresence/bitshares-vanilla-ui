# History one-liners — design (2026-10-04)

Full 78-op human summaries for account history rows. Approved by owner
2026-10-04 (scope: full 78; cache + generated mainnet pool-asset seed;
family templates with honest fallbacks).

## 1. Problem

History rows render `time — label` + folded raw JSON. Labels now cover all
78 tags, but rows still don't say what happened ("Feed publish for BTS",
"Pool swap 100 BTS → 1.9 USD"). Payloads carry raw ids + raw integer
amounts only — no names, symbols, or precisions.

## 2. Data flow

New file `vanilla/js/api/history-summary.js`, one async entry:

```
enrich(rows, viewedAcctId) -> rows (each gains _summary or nothing)
```

Caller (account history section) inserts `enrich` between fetch and
`renderHistory`, which prefers `row._summary` as the headline. Fallback is
today's label-only row. Explorer reuse later is a one-line call.

Three steps inside `enrich`:

1. **Collect** every `1.2.x` / `1.3.x` / `1.19.x` id in the page's payloads
   via one generic pass (an id is an id; no per-op field maps).
2. **Join** in exactly 2 RPCs: `lookup_asset_symbols` (precisions) +
   `get_accounts` (names), over a chain-keyed asset-meta cache (below).
   Misses stay missing; `enrich` never rejects — worst case is
   label-only rows, never a blank tab.
3. **Attribute** per op family (~24 summarizers, §3) with explicit field
   paths. Unrecognized or half-missing → label-only fallback. Folded JSON
   stays underneath as the source of truth.

## 3. Families and templates

One keyed i18n template per family (placeholders `%(var)s`,
byte-verbatim); ops sharing a payload shape share a sentence. Shared
helpers: `amount({amount, asset_id})` → `"5.00000 BTS"` or `"—"` on
precision-miss (never raw); `name(id)` → chain name or raw id
(identifiers may show raw; money may not).

- Transfer-like (0, 38): direction-aware vs viewed account —
  "Sent 5.00000 BTS to bob" / "Received 5.00000 BTS from alice".
- Orders (1, 2, 77), call update (3, signed deltas), fill (4, virtual,
  pays/receives), feed (19), pool flows (59–63, 75), asset admin
  (10–15, 16, 48), credit (69–73, 76 + virtual 74), Same-T (64–68),
  debit (25–28), HTLC (49–53 incl. virtual 51/53), tickets (57–58),
  vesting (32–33), proposals (22–24), governance (20–21, 29–31, 34),
  authorities (54–56), account admin (5–9), misc
  (16–18, 35–37, 42–47).
- Blind transfers (39–41): counts only, no amount claims (crypto stays
  unaudited/deferred).
- Load-bearing rule: a summary that can't be built honestly isn't built.

## 4. Asset-meta cache + generated pool-asset seed

Symbol/precision are issuance-immutable → cacheable. Chain-keyed
`(chain_id, asset_id)` Map inside the module: session memory for all
chains; mainnet boots pre-seeded (below). Live batch joins backfill it.
Account names resolve live per session (existing no-completed-cache
invariant stands).

`tooling/generate_pool_assets` pages mainnet `list_liquidity_pools`,
joins symbols/precisions, and writes data-only
`vanilla/js/api/pool-assets.js`: provenance header (chain id, block,
date, generator command) + `{ chain_id, assets }`. Consulted only on
matching chain id (testnet never sees it); incomplete coverage falls
through to cache → live join. If mainnet holds thousands of pools, cap
the table to the most pool-connected assets and note the cap and count in
the header. Regeneration is a documented manual step; values can't rot (immutable),
only coverage extends.

## 5. Testing and gates

- `tooling/history-summary-test.js`: offline vectors per family
  (payload → exact string), plus adversarial vectors — precision-miss
  (`—`, never raw), unknown tag (label-only), degraded join
  (names-as-ids) — plus a live testnet re-read asserting no throw and no
  raw integers in any `_summary`.
- Done gates: `check_rot.py`, `check_types.sh`, `check_i18n.py` (family
  templates × 12 locales via the established one-shot script pattern),
  the `Math.pow(10`-outside-`format.js` grep, no dead text.

## 6. Non-goals

Per-row memo decryption (locked-state data stays out of summaries);
relative timestamps (adjacent, separate slice); explorer adoption
(one-line call later); changing `renderHistory`'s sync signature for
other callers (enrich happens before it, not inside it).
