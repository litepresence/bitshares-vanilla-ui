#!/usr/bin/env python3
"""Add the account-network i18n keys to all 12 vanilla locales.

Follows the add_deep_window_i18n.py / add_market_hops_i18n.py precedent: every
dict is fully-translated (untranslated=false), so new keys land allowlisted
with honest English values — translators refine wording, never keys. The
_meta.translated inventory is kept sorted in every dict, as check_i18n expects.

The values below must be byte-identical to the t() defaults at the call sites
in vanilla/js/views/account-network-ui.js (and menu-ui.js / router.js for the
card + SEO strings) — check_i18n.py enforces both directions.

Idempotent: re-running reports existing keys and changes nothing.
"""
import io
import json
import sys

LOCALES = ["en", "de", "es", "fr", "it", "ja", "ko", "ru", "tr", "zh", "hi", "pt"]

# Verbatim I18n.t defaults from the call sites.
NEW_KEYS = {
    # ---- page shell (account-network-ui.js) ----
    "account_net.title": "Account Network",
    "account_net.intro": "Enter one or more accounts to see who they send to, lend to and borrow from. Read from the community history index; nothing is signed and nothing is stored.",
    "account_net.seeds_label": "Accounts to map",
    "account_net.seeds_placeholder": "committee-account, alice, 1.2.42",
    "account_net.go": "Draw network",
    "account_net.idle": "Nothing drawn yet.",
    "account_net.scanning": "Reading the community index…",
    "account_net.need_seeds": "Enter at least one account to map.",
    "account_net.need_class": "Turn on at least one kind of line to draw.",
    "account_net.canvas_missing": "The network canvas is unavailable in this build; the table below still lists every line.",
    # ---- class chips: label + help (CLASS_HELP) ----
    "account_net.class_transfer": "Transfer",
    "account_net.class_transfer_help": "Direct account-to-account transfers.",
    "account_net.class_credit": "Credit",
    "account_net.class_credit_help": "Credit offers accepted and repaid.",
    "account_net.class_override": "Override transfer",
    "account_net.class_override_help": "Transfers whose fee the asset issuer pays.",
    "account_net.class_debit": "Direct debit",
    "account_net.class_debit_help": "Direct-debit permissions and withdrawals.",
    "account_net.class_htlc": "HTLC",
    "account_net.class_htlc_help": "Hash time-locked contracts and their updates.",
    "account_net.class_vesting": "Vesting",
    "account_net.class_vesting_help": "Vesting balances a third party administers.",
    # ---- honesty lines ----
    "account_net.status_scanned": "%(scanned)s indexed operations from %(n)s account(s)",
    "account_net.status_graph": "%(nodes)s accounts · %(edges)s lines",
    "account_net.status_truncated": "newest %(n)s operations per account",
    "account_net.status_node_cap": "top %(n)s counterparties shown",
    "account_net.status_edge_cap": "top %(n)s lines shown",
    "account_net.status_self": "%(n)s self-transfers skipped",
    "account_net.status_shape": "%(n)s unreadable entries skipped",
    "account_net.status_credit_index": "%(n)s credit lines resolved from the index (their offer or deal object is gone from chain)",
    "account_net.status_credit_missing": "%(n)s credit lines skipped (offer or deal not found on chain)",
    "account_net.status_unknown": "not found: %(names)s",
    # ---- detail line ----
    "account_net.detail_hint": "Tap a line for its detail; tap an account to open it.",
    "account_net.detail_line": "%(from)s → %(to)s · %(class)s · %(amount)s · %(count)s ops · %(kind)s",
    "account_net.detail_line_one": "%(from)s → %(to)s · %(class)s · %(amount)s · %(count)s op · %(kind)s",
    "account_net.detail_span": "%(first)s → %(last)s",
    "account_net.kind_flow": "flow",
    "account_net.kind_relation": "relation",
    "account_net.no_amount": "no amount",
    "account_net.more_assets": " + %(n)s more",
    # ---- table twin ----
    "account_net.twin_summary": "Table view (accessible)",
    "account_net.twin_from": "From",
    "account_net.twin_to": "To",
    "account_net.twin_class": "Kind",
    "account_net.twin_relation": "Flow/relation",
    "account_net.twin_amount": "Amount",
    "account_net.twin_count": "Ops",
    "account_net.twin_span": "First → last",
    "account_net.twin_empty": "No lines between these accounts in the indexed operations scanned.",
    # ---- index states ----
    "account_net.es_disabled": "The community index is switched off. Turn it on in Settings to draw this map.",
    "account_net.es_bad_account": "That name is not an account on this chain.",
    "account_net.es_unavailable": "The community index is not reachable right now. Try again in a moment.",
    # ---- two-hop depth words (account-network-copy.js) ----
    "account_net.depth_label": "Depth",
    "account_net.depth_1": "1 hop",
    "account_net.depth_2": "2 hops",
    "account_net.ring1_label": "Ring 1",
    "account_net.ring2_label": "Ring 2",
    "account_net.stale_settings": "Depth or neighbor settings changed — press Draw network.",
    "account_net.status_depth": "%(depth)s map",
    "account_net.status_expanded": "expanded: %(names)s",
    "account_net.status_unexpanded": "%(n)s direct counterparties unexpanded",
    "account_net.status_expansion_scanned": "%(n)s indexed operations from expansions",
    "account_net.status_expansion_truncated": "expansion scans truncated to newest operations",
    "account_net.twin_depth": "Hop",
    # ---- account page seed button (account-ui.js) ----
    "account.draw_network": "Draw network",
    # ---- sitemap card (menu-ui.js, Labs section) ----
    "menu.p_account_net": "Account Network",
    "menu.d_account_net": "transfer tracking",
    # ---- SEO meta (router.js ROUTE_META) ----
    "seo.title_account_net": "Account Network — BitShares Wallet",
    "seo.desc_account_net": "Map who an account sends to, lends to and borrows from — read from the community index. No login needed.",
}


def main():
    for code in LOCALES:
        path = "vanilla/locales/%s.json" % code
        with io.open(path, encoding="utf-8") as f:
            data = json.load(f)
        changed = False
        for full, value in NEW_KEYS.items():
            section, _, key = full.partition(".")
            bucket = data.setdefault(section, {})
            if key not in bucket:
                bucket[key] = value
                changed = True
            elif bucket[key] != value:
                print("MISMATCH %s %s: %r != %r" % (path, full, bucket[key], value))
                return 1
            inv = data["_meta"]["translated"]
            if full not in inv:
                inv.append(full)
                changed = True
        data["_meta"]["translated"] = sorted(data["_meta"]["translated"])
        if changed:
            with io.open(path, "w", encoding="utf-8", newline="\n") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
                f.write("\n")
        print(("updated " if changed else "unchanged ") + path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
