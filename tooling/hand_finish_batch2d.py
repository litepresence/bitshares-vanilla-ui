#!/usr/bin/env python3
"""Batch-2d hand-finish: whole static display literals the line-level
converter mechanically missed (documented gaps, same t() shape).

Gap classes (worker-verified, precedent credit-ui.js:301 wraps every header):
  G1 modeSel option labels (pairs-guard createElement collision).
  G2 asset create tab labels (no-space B-side rule).
  G3 multi-line tableHead second lines + debit ternary header (single-line regex).
  G4 paren-gated header lines (depth A->B/B->A, history Event).
  G5 'Pool' confirm-row labels (same literal is a backend-id token in the
      routeReady need-array, so KEYMAP excluded it; only row positions wrapped).
  G6 lock() 'Unlock failed' + htlc 'password' placeholder (TOKEN_SKIP overlap:
      'password' is also an input-type token; comparison strings untouched).

Decisions mirror apply_i18n_batch2d reuse policy exactly: en.json reuse where
byte-identical (auth.unlock_failed, barter.password, market.title,
instant.limit, prediction.hdr_status), frag reuse where already minted
(asset.smartcoin_row, asset.nft_row), else new short keys below.
Left raw deliberately (stated, not attempted): mid-expression glue
('A < B by id: ', ' (core)', 'Observed at head block #'+n), PRESETS duration
labels, PERMS/FLAGS checkbox labels (dynamic p[1]), tile t[3] suffixes,
'Open '+x / 'Sell '+sym links, quote sentences, numeric/example placeholders.

Usage: python3 tooling/hand_finish_batch2d.py [--apply]
  Default: dry run (assert replacements resolve, print plan).
  --apply: patch the 8 files + extend vanilla/locales/frag-batch2d.json.
"""
import json
import os
import sys

WS = "/workspace"
JS = os.path.join(WS, "vanilla", "js")
FRAG = os.path.join(WS, "vanilla", "locales", "frag-batch2d.json")
LEDGER = "/tmp/batch2d-handfinish.json"

NEW_KEYS = {  # (ns, literal) -> short (reuse cases need no entry)
    ("asset", "UIA"): "tab_uia",
    ("asset", "PMA"): "tab_pma",
    ("htlc", "Type a new preimage"): "secret_type",
    ("htlc", "Paste an existing hash"): "secret_paste",
    ("pool", "Asset A qty"): "asset_a_qty_col",
    ("pool", "Asset B qty"): "asset_b_qty_col",
    ("pool", "Stake/Unstake"): "stake_unstake_col",
    ("debit", "Used"): "used_col",
    ("debit", "Available"): "avail_col",
    ("pool", "A→B out (raw)"): "a_to_b_col",
    ("pool", "B→A out (raw)"): "b_to_a_col",
    ("pool", "Event"): "event_col",
    ("pool", "Pool"): "pool_row",
}

# (file, old, new, expected_count). t() args reuse-or-new per module docstring.
T = lambda key, lit: 't("%s", "%s")' % (key, lit.replace("\\", "\\\\").replace('"', '\\"'))

EDITS = [
    ("asset-ui.js",
     'box.textContent = (e && e.message) ? e.message : "Unlock failed";',
     'box.textContent = (e && e.message) ? e.message : ' + T("auth.unlock_failed", "Unlock failed") + ';', 1),
    ("asset-manage-ui.js",
     'box.textContent = (e && e.message) ? e.message : "Unlock failed";',
     'box.textContent = (e && e.message) ? e.message : ' + T("auth.unlock_failed", "Unlock failed") + ';', 1),
    ("asset-feed-ui.js",
     'box.textContent = (e && e.message) ? e.message : "Unlock failed";',
     'box.textContent = (e && e.message) ? e.message : ' + T("auth.unlock_failed", "Unlock failed") + ';', 1),
    ("asset-ui.js",
     '[["uia", "UIA"], ["smart", "Smartcoin"], ["nft", "NFT"], ["pma", "PMA"]]',
     '[["uia", ' + T("asset.tab_uia", "UIA") + '], ["smart", ' + T("asset.smartcoin_row", "Smartcoin") +
     '], ["nft", ' + T("asset.nft_row", "NFT") + '], ["pma", ' + T("asset.tab_pma", "PMA") + ']]', 1),
    ("htlc-ui.js",
     'inp.setAttribute("placeholder", "password");',
     'inp.setAttribute("placeholder", ' + T("barter.password", "password") + ');', 1),
    ("htlc-ui.js",
     '[["type", "Type a new preimage"], ["paste", "Paste an existing hash"]]',
     '[["type", ' + T("htlc.secret_type", "Type a new preimage") + '], ["paste", ' +
     T("htlc.secret_paste", "Paste an existing hash") + ']]', 1),
    ("pool-ui.js",
     '"Asset A", "Asset A qty",',
     T("pool.asset_a_field", "Asset A") + ', ' + T("pool.asset_a_qty_col", "Asset A qty") + ',', 1),
    ("pool-ui.js",
     '"Asset B", "Asset B qty", "Taker fee", "Withdrawal fee", "Exchange", "Stake/Unstake"',
     T("pool.asset_b_field", "Asset B") + ', ' + T("pool.asset_b_qty_col", "Asset B qty") + ', ' +
     T("pool.taker_row", "Taker fee") + ', ' + T("pool.withdrawal_row", "Withdrawal fee") + ', ' +
     T("market.title", "Exchange") + ', ' + T("pool.stake_unstake_col", "Stake/Unstake"), 1),
    ("debit-ui.js",
     'side === "giver" ? "Authorized" : "Giver",',
     'side === "giver" ? ' + T("debit.auth_row", "Authorized") + ' : ' + T("debit.giver_row", "Giver") + ',', 1),
    ("debit-ui.js",
     '"Limit", "Used", "Available", "Period", "Status"',
     T("instant.limit", "Limit") + ', ' + T("debit.used_col", "Used") + ', ' +
     T("debit.avail_col", "Available") + ', ' + T("debit.period_row", "Period") + ', ' +
     T("prediction.hdr_status", "Status") + '', 1),
    ("pool-detail-ui.js",
     '"A→B out (raw)", "B→A out (raw)"',
     T("pool.a_to_b_col", "A→B out (raw)") + ', ' + T("pool.b_to_a_col", "B→A out (raw)") + '', 1),
    ("pool-detail-ui.js",
     '["Time (UTC)", "Event"]',
     'replaceme', 1),  # filled below (needs the live t() left side)
    ("pool-detail-ui.js",
     '[["Pool", r.id],', '[[ ' + T("pool.pool_row", "Pool") + ', r.id],', 5),
    ("pool-swap-ui.js",
     '[["Pool", Q.r.id +',
     '[[ ' + T("pool.pool_row", "Pool") + ', Q.r.id +', 1),
]

def main():
    apply = "--apply" in sys.argv
    srcs = {}
    for f, _, _, _ in EDITS:
        if f not in srcs:
            srcs[f] = open(os.path.join(JS, f), encoding="utf-8").read()
    out = dict(srcs)
    # Time/Event: find the converted line first.
    pl = [l for l in out["pool-detail-ui.js"].split("\n") if '"Event"' in l]
    assert len(pl) == 1, pl
    assert 't("pool.time_col"' in pl[0], pl[0]  # left side already t()
    new_time_line = pl[0].replace('"Event"', T("pool.event_col", "Event"))
    plan = []
    for f, old, new, n in EDITS:
        if old == '["Time (UTC)", "Event"]':
            old, new, n = pl[0], new_time_line, 1
        c = out[f].count(old)
        assert c == n, "%s: found %d, expected %d for %r" % (f, c, n, old[:70])
        out[f] = out[f].replace(old, new)
        plan.append((f, old[:60], n))
    # NEW_KEYS actually used by the edits above.
    used = set(NEW_KEYS.values())
    frag = json.load(open(FRAG, encoding="utf-8"))
    for (ns, lit), short in sorted(NEW_KEYS.items()):
        if short not in str(out):
            continue
        sec = frag.setdefault(ns, {})
        assert sec.get(short, lit) == lit, "frag collision %s.%s" % (ns, short)
        sec[short] = lit
    if apply:
        for f, s in out.items():
            open(os.path.join(JS, f), "w", encoding="utf-8").write(s)
        frag = {ns: dict(sorted(sec.items())) for ns, sec in sorted(frag.items())}
        json.dump(frag, open(FRAG, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        open(FRAG, "a", encoding="utf-8").write("\n")
        json.dump([{"file": f, "old": o, "count": n} for f, o, n in plan],
                  open(LEDGER, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print("hand-finish applied: %d edits, frag now %d keys" %
              (len(plan), sum(len(v) for v in frag.values())))
    for f, o, n in plan:
        print("%-20s x%d %s..." % (f, n, o[:60]))


if __name__ == "__main__":
    main()
