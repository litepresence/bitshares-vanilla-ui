#!/usr/bin/env python3
"""Sync prediction-portfolio i18n keys (2026-10-02 task).

Adds 27 prediction.* keys to all 10 vanilla/locales/*.json with en values,
updates en _meta.translated to list all flattened keys. Stubs stay honest
(non-en values == en). es allowlist unchanged (new keys non-allowlisted,
so es values must equal en — they do).
Stdlib only.
"""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__))
LOCALES = os.path.join(HERE, "..", "vanilla", "locales")
NEW = {
  "active": "Active",
  "expired": "Expired",
  "my": "My",
  "refresh": "Refresh",
  "portfolio": "Portfolio",
  "load_portfolio": "Load portfolio",
  "loading_portfolio": "Loading portfolio…",
  "no_holdings": "No prediction-market holdings for this account.",
  "avg_cost": "Avg cost",
  "current": "Current",
  "pnl": "PnL",
  "settle": "Settle",
  "confirm_settle": "Confirm settle",
  "my_locked_hint": "Unlock the wallet to see your markets (created or held by the wallet account).",
  "no_match_filter": "No prediction markets match this filter.",
  "no_pma_in_range": "No prediction-market assets in the scanned range. Try the lookup box above.",
  "scanned_note": "Scanned %(scanned)s assets, found %(found)s prediction markets%(trunc)s.",
  "portfolio_hint": "Holdings are PMA balances joined to the scan; avg cost replays fill history (chain-history only).",
  "filter_hint": "Active = unexpired and unsettled (closing soon first); Expired = past expiry awaiting resolution; My = created or held by the wallet account.",
  "history_unavailable": "History unavailable — avg cost shows dashes.",
  "mixed_cost": "mixed cost assets",
  "zero_cost": "zero-cost (no fills)",
  "no_price": "no price",
  "could_not_prepare_settle": "Could not prepare the settle.",
  "could_not_load_portfolio": "Could not load the portfolio.",
  "settle_broadcast": "Settle broadcast.",
  "balance": "Balance",
}
def flatten(d, prefix=""):
    out = {}
    for k, v in d.items():
        if k == "_meta":
            continue
        if isinstance(v, dict):
            out.update(flatten(v, prefix + k + "."))
        else:
            out[prefix + k] = v
    return out
def main():
    for code in ["en","de","es","fr","it","ja","ko","ru","tr","zh","hi","pt"]:
        path = os.path.join(LOCALES, code + ".json")
        d = json.load(open(path, encoding="utf-8"))
        pred = d.get("prediction")
        if not isinstance(pred, dict):
            print(code + ": no prediction section")
            return 1
        for k, v in NEW.items():
            pred[k] = v
        # en translated must list all flattened keys
        if code == "en":
            flat = flatten(d)
            d["_meta"]["translated"] = sorted(flat.keys())
        json.dump(d, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        print(code + ": synced 27 keys")
    return 0
if __name__ == "__main__":
    import sys
    sys.exit(main())
