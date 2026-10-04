# AFK Round 7 record — deferral UIs: load-deeper + my settlements

## Load deeper (desk recent trades — WON after a real fight)
- Button under recent list → `tradesDeep` 7-day/100 → same-envelope
  renderTrades. Failure keeps old rows + mapped error + Settings link,
  re-arms for retry. Key `market.load_deeper` (+ `market.back_to_live`).
- BUG FOUND BY VERIFYING (not by reading): the first version lost to the
  15s refill loop — deep rows painted between refills were clobbered within
  seconds, and in-flight fetches resolved into wiped hosts with zero trace
  (no error, no rows, fresh button: three silent 70s timelines). Fix is
  structural, not timing: `state.deepRows` — fill() re-renders deep rows
  instead of refetching while the flag stands; "Back to live" is the only
  exit (no auto-expiry, no surprise reverts). Proven stable across 80s of
  refills (2-row 7-day window on BTS_USD + back button, errs 0).
- Lesson for the book: any desk feature that paints async results must be
  refill-aware — the loop re-renders every 15s and silently eats anything
  it doesn't know about. The direct-backend probe (tradesDeep live: 2 rows)
  is the diagnostic that separated "backend broken" from "view raced".

## My settlements (Borrow page, after settlement bids)
- Own account field (blank = wallet, resolved like fAcct) + Look up (reused
  keys) + table reusing account.asset_th / market.th_amount /
  market.th_settle_date. Amounts via Format with per-asset precision from one
  batched get_assets (raw-in-title fallback, never bare); dates via
  I18n.date with raw fallback. history-unavailable handled HERE (keyed
  notice + Settings link — borrow showError has no history mapping, never
  delegated). Chain-empty (the current chain-wide state per R6) renders the
  honest empty note, proven by construction (probe: zero open settlements).
- Keys: borrow.my_settlements/_hint/_empty, borrow.settlements_unavailable
  (+ market.load_deeper/back_to_live) via generalized i18n_add_keys.py
  (BATCHES list — future batches append, no new scripts).
- Shots: borrow @1440 (block in place) + @390 (stacked, touch targets);
  desk deep view live. Zero console errors throughout.

## Deferred further (logged, not lost)
- Desk "my limit orders for this market": existing orders tab covers it;
  myLimitOrders backend waits for an account-page placement (future round).
- B4 cursor pager: stays first-page until the settle-cursor probe finds data.

## Gates
types PASS · rot PASS · i18n OK (3100 keys, 4000 sites) · node --check clean
both views. Money: Format-only amounts (backend vectors already cover the
raw shapes). Anti-rot: (a) platform only; (b) nothing new (2 blocks + 1 flag);
(c) deletable: deep button (30-row list stands), settlements block (bids
stand) — kept: the last two user-visible deferrals closed.
