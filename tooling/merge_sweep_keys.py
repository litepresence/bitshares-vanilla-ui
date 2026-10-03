#!/usr/bin/env python3
"""merge_sweep_keys.py — merge unkeyed-sweep t() keys into all locale dicts.

Reads NEW_KEYS below (full dotted keys added to code by a keying sweep),
locates each key's single t("key", "default") call site among modified JS
files (same literal regex as check_i18n.py — the CODE is the single source,
never a transcribed value), and merges key->default into all 12
vanilla/locales/*.json (non-en dicts get English = honest stubs) + syncs
en.json _meta.translated (sorted). Fails non-zero if any key has zero or
2+ call sites.

Usage: python3 tooling/merge_sweep_keys.py  (then run check_i18n.py)
"""
import io
import json
import re
import subprocess
import sys

LOCALES = ["en", "de", "es", "fr", "hi", "it", "ja", "ko",
           "pt", "ru", "tr", "zh"]

T_CALL_RE = re.compile(
    r"""\bt\(\s*"(?P<key>(?:\\.|[^"\\])*)"\s*,\s*"(?P<dflt>(?:\\.|[^"\\])*)"\s*(?:,\s*\{[^}]*\})?\s*\)"""
)

# Full dotted keys introduced by the 2026-10-04 unkeyed sweep (6 workers).
# Values are read from code at merge time — this list carries names only.
NEW_KEYS = """
wallet.show_public_keys_json wallet.write_down_brainkey_keep_safe
wallet.wrote_it_down wallet.passwords_do_not_match
wallet.wallet_created_back_it_up wallet.go_to_wallet_manager
wallet.import_existing_account wallet.enter_brainkey_checked_chain
wallet.brainkey_words_placeholder wallet.checking_chain
wallet.account_found_wallet_imported wallet.verify_and_import
account.equity_sparkline_plot account.equity_sparkline
account.replaying_recent_history
pool_detail.pool_map pool_detail.pool_curve_plot pool_detail.pool_curve
pool_detail.pool_map_unavailable_script
pool_detail.pool_map_unavailable_offline
pool_detail.no_bts_path_unverified pool_detail.bts_provenance_prefix
misc.invoice_lines_placeholder
market_book.fill_price market_book.spread_prefix
market.updated_prefix market.loading_pool_map
market.pool_map_unavailable_script market.pool_map_unavailable_offline
market.no_bts_path market.bts_provenance_prefix market.favorite_prefix
market.direct_placeholder_prefix market.use_quote_base_prefix
market.unknown_market_prefix
trade.broadcast_cancel_all_prefix
confirm.fee_ack
debit.placed_prefix debit.verify_fills_suffix debit.failed_prefix
debit.retry_suffix
swap.quote_raw_prefix swap.min_raw_suffix
prediction.scan_prefix prediction.scan_suffix
prediction.org_scanned_prefix prediction.org_found_mid
prediction.org_unit prediction.scan_bound_suffix prediction.desk_suffix
explorer.accounts_prefix_ph explorer.accounts_search_aria
explorer.search_suggestions_aria explorer.search_empty_hint
htlc.hash_match_prefix
ops.blocks_sampled_prefix ops.blocks_sampled_aria
proposal.raw_prefix proposal.inner_op_prefix
ticket.airdrop_example_ph
vote.funding_unavailable_prefix vote.top_voters_note
shell.footer_brand
settings.language_label settings.locale_unavailable
dashboard.locale_unavailable
barter.propose_encloses_both
""".split()


def unesc(s):
    return s.replace('\\"', '"').replace("\\\\", "\\")


def main():
    modified = subprocess.run(
        ["git", "diff", "--name-only"], capture_output=True, text=True,
        check=True).stdout.split()
    js_files = [f for f in modified if f.endswith(".js")]
    found = {}
    for key in NEW_KEYS:
        sites = []
        for f in js_files:
            try:
                src = open(f, encoding="utf-8").read()
            except OSError:
                continue
            for m in T_CALL_RE.finditer(src):
                if unesc(m.group("key")) == key:
                    sites.append((f, unesc(m.group("dflt"))))
        if not sites:
            print("KEY %s has 0 call sites" % key)
            return 1
        if len(set(s[1] for s in sites)) != 1:
            print("KEY %s has conflicting defaults: %s" % (key, sites))
            return 1
        found[key] = sites[0]
    for code in LOCALES:
        path = "vanilla/locales/%s.json" % code
        with io.open(path, encoding="utf-8") as f:
            data = json.load(f)
        for key in NEW_KEYS:
            fpath, dflt = found[key]
            sec, sub = key.split(".", 1)
            section = data.setdefault(sec, {})
            if section.get(sub) != dflt:
                section[sub] = dflt
        if code == "en":
            inv = data["_meta"]["translated"]
            for key in NEW_KEYS:
                if key not in inv:
                    inv.append(key)
            inv.sort()
        with io.open(path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print("merged %s (%d sweep keys)" % (path, len(NEW_KEYS)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
