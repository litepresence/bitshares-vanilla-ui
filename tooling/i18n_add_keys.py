#!/usr/bin/env python3
"""i18n_add_keys.py — one-shot batch key inserter (Phase 3 precedent, reusable).

Adds NEW settings-namespace keys with English values to all 10
vanilla/locales/*.json (non-en dicts keep English = honest stubs, never
machine-translated) + en.json _meta.translated inventory (kept sorted, as
check_i18n expects). Stdlib only. Usage: python3 tooling/i18n_add_keys.py.
Fails non-zero if any dict lacks the anchor or check_i18n would go red.
"""
import io
import json
import sys

LOCALES = ["en", "de", "es", "fr", "it", "ja", "ko", "ru", "tr", "zh"]

# Batches: (namespace, anchor-key, {full.key: english-default}). New keys go
# after the anchor; en inventory kept sorted. Non-en dicts keep English
# (honest stubs, never machine-translated).
BATCHES = [
    ("settings", "network_testnet", {
        "settings.hist_yes": "History",
        "settings.hist_no": "No history",
        "settings.es_title": "Community history index",
        "settings.es_toggle": "Enable community history (ElasticSearch)",
        "settings.es_note": "Run by the community, not by this wallet — questions: t.me/bitsharesDEV. Turn off to use chain history only.",
        "settings.testnet_hist": "Testnet: node history works here, but the community index covers mainnet only — index-powered features are unavailable.",
    }),
    ("market", "no_price_history", {
        "market.load_deeper": "Load deeper history",
        "market.back_to_live": "Back to live trades",
    }),
    ("borrow", "blank_wallet_account", {
        "borrow.my_settlements": "My settlements",
        "borrow.my_settlements_hint": "Force-settlement orders waiting at the feed price — yours or any account's, reads are public.",
        "borrow.my_settlements_empty": "No open settlements for this account.",
        "borrow.settlements_unavailable": "Settlements unavailable on this node — switch nodes in Settings.",
    }),
    ("account", "asset_th", {
        "account.export_csv": "Export CSV",
    }),
    ("explorer", "loading_prefix", {
        "explorer.feed_badge_live": "LIVE",
        "explorer.feed_badge_stale": "STALE — feed expired",
        "explorer.feed_badge_unknown": "FEED AGE UNKNOWN",
        "explorer.feed_badge_title": "oldest factored feed %(pub)s; lifetime %(life)ss",
        "explorer.feed_badge_unknown_title": "publication time or lifetime missing",
        "explorer.feed_cer_premium": "CER premium (publisher-rule estimate)",
        "explorer.feed_cer_uncomputable": "core_exchange_rate present but premium not computable from fetched legs",
        "explorer.feed_cer_missing": "core_exchange_rate missing",
        "explorer.feed_cer_title": "cer base %(cb)s / quote %(cq)s vs settle base %(sb)s / quote %(sq)s",
        "explorer.feed_mcr_mssr": "MCR / MSSR",
        "explorer.feed_mcr_mssr_title": "mcr %(mcr)s; mssr %(mssr)s",
        "explorer.feed_last_update": "Last update",
        "explorer.feed_pubtime_missing": "current_feed_publication_time missing",
        "explorer.feed_publishers": "Publishers",
        "explorer.feed_publisher_title": "%(id)s @ %(ts)s",
        "explorer.feed_feeds_missing": "feeds missing",
        "explorer.feed_ago_suffix": " ago",
    }),
    ("misc", "invoice", {
        "misc.checkout_request": "Checkout request",
        "misc.checking_payment": "Checking payment…",
        "misc.recheck_payment": "Re-check payment",
        "misc.invoice_expecting": "Expecting %(amount)s to %(to)s%(memo)s.",
        "misc.invoice_paid": "Paid — matching inbound transfer found (block %(block)s).",
        "misc.invoice_unpaid": "Unpaid — no matching inbound transfer in the last %(n)s history events.",
        "misc.invoice_query_missing": "This invoice link is missing \u201cto\u201d, \u201casset\u201d or \u201camount\u201d — complete the form below and share a fresh link.",
        "misc.invoice_query_bad_amount": "Amount \u201c%(amount)s\u201d is not a plain decimal — correct it below.",
        "misc.invoice_memo_note": "Memo matching is a substring on the visible memo field — encrypted memos only match on asset + amount.",
        "misc.invoice_unknown_account": "unknown account \u201c%(to)s\u201d.",
        "misc.invoice_unknown_asset": "unknown asset \u201c%(asset)s\u201d.",
        "misc.invoice_history_unavailable": "payment history is unavailable — check Settings → Nodes and retry.",
        "misc.invoice_check_failed": "Could not check payment: %(msg)s",
        "misc.shareable_link": "Shareable link",
        "misc.copy_link": "Copy link",
        "misc.print": "Print",
        "misc.copying": "Copying…",
        "misc.copied": "Copied",
        "misc.copy_failed_select_manually": "Copy failed — select the link manually",
        "misc.share_needs_to_amount": "A shareable link needs a recipient and at least one amount line.",
        "misc.invoice_no_qr": "No QR code is shown: a hand-rolled QR encoder is a Reed-Solomon project with no small licensed library vendored — copy or print the link instead.",
    }),
    ("uri", None, {
        "uri.error_bad-encoding": "This BitShares link has a broken % escape and cannot be parsed.",
        "uri.error_bad-encoding-transfer": "This transfer link has a broken % escape and cannot be parsed.",
        "uri.error_unknown-param": "This transfer link carries an unsupported field \u201c%(n)s\u201d. Supported: to, asset, amount, memo, fee_asset.",
        "uri.error_bad-account": "This link names an invalid account \u201c%(n)s\u201d.",
        "uri.error_bad-account-transfer": "This transfer link names an invalid account \u201c%(n)s\u201d.",
        "uri.error_bad-asset": "This link names an invalid asset \u201c%(n)s\u201d.",
        "uri.error_bad-asset-transfer": "This transfer link names an invalid asset \u201c%(n)s\u201d.",
        "uri.error_bad-asset-fee": "This transfer link names an invalid fee asset.",
        "uri.error_bad-asset-fee-named": "This transfer link names an invalid fee asset \u201c%(n)s\u201d.",
        "uri.error_bad-uri": "This BitShares link cannot be parsed.",
        "uri.error_empty-uri": "No BitShares link was given.",
        "uri.error_bad-scheme": "Not a BitShares link (expected bitshares:…).",
        "uri.error_unknown-type": "This BitShares link has no type.",
        "uri.error_unknown-type-named": "Unsupported link type \u201c%(n)s\u201d.",
        "uri.error_supported-list": "Supported: account, asset, market, operation/transfer, block, transaction.",
        "uri.error_unsupported-type": "This BitShares link type (\u201c%(n)s\u201d) is recognized but not supported yet.",
        "uri.error_unsupported-path-empty": "This BitShares link has an empty path segment and cannot be parsed.",
        "uri.error_unsupported-path-account": "Account links look like bitshares:account/<name>.",
        "uri.error_unsupported-path-asset": "Asset links look like bitshares:asset/<symbol>.",
        "uri.error_unsupported-path-operation": "Operation links look like bitshares:operation/transfer?….",
        "uri.error_unsupported-path-block": "Block links look like bitshares:block/<number>.",
        "uri.error_unsupported-path-transaction": "Transaction links look like bitshares:transaction/<hash>.",
        "uri.error_bad-market": "Market links look like bitshares:market/<base>/<quote>.",
        "uri.error_bad-market-pair": "This link names an invalid market \u201c%(a)s/%(b)s\u201d.",
        "uri.error_bad-market-same": "This link names a market with the same asset twice.",
        "uri.error_unknown-operation": "Only transfer links are supported (\u201c%(n)s\u201d is not).",
        "uri.error_bad-block": "This link names an invalid block \u201c%(n)s\u201d.",
        "uri.error_bad-block-index": "This link names an invalid transaction index \u201c%(n)s\u201d.",
        "uri.error_bad-hash": "This link carries an invalid transaction hash (40 hex characters).",
        "uri.error_unavailable": "Transaction lookup is unavailable right now.",
        "uri.error_offline": "Network unavailable — the transaction cannot be looked up.",
        "uri.error_not-found": "Transaction not found on this node or the community index.",
    }),
    # Batch: another session's api-lab feature shipped WITHOUT dict entries
    # (gate was red on arrival). Keying only — design untouched, not reviewed.
    ("apilab", "title", {
        "apilab.confirm_broadcast": "Confirm broadcast (real transaction)",
        "apilab.confirm_no": "Cancel",
        "apilab.confirm_yes": "Broadcast now",
        "apilab.connected_to": "Connected node: ",
        "apilab.connecting": "Connecting to network…",
        "apilab.copy_link": "Copy link",
        "apilab.filter": "Filter methods…",
        "apilab.gate_ack": "I understand — open the API lab",
        "apilab.gate_back": "Back to Explorer",
        "apilab.gate_body": "This page sends hand-built API calls to a public node and shows raw chain JSON. Reads are safe; broadcasts move real funds. Only proceed if you know what you are doing.",
        "apilab.gate_broadcast": "Broadcasting sends a REAL signed transaction on the connected chain. Only proceed if you built and reviewed the transaction yourself and you know which chain (mainnet or testnet) you are on.",
        "apilab.gate_debug": "Debug and node-maintenance calls are usually DISABLED on public API nodes. Expect rejections — the rejection is the honest result, not a bug in this page.",
        "apilab.gate_title": "Advanced tool — confirm you understand",
        "apilab.go_login": "Go to Login",
        "apilab.history": "This session",
        "apilab.locked": "Wallet is locked — unlock first (top-bar lock), then confirm this broadcast.",
        "apilab.method": "API method",
        "apilab.no_result": "No result yet — fill the boxes and press Run.",
        "apilab.raw_params": "Raw params JSON (mirrors the boxes)",
        "apilab.reset": "Reset",
        "apilab.retry": "Retry",
        "apilab.run": "Run",
        "apilab.running": "Running…",
        "apilab.subtitle": "Probe the connected node by hand: pick a method, fill the boxes, read raw JSON. Reads are safe; broadcast moves real funds.",
        "apilab.title": "API Lab",
    }),
    # Batch: es-lab community-index browser ships WITH dict entries
    # (same commit as the desk — api-lab F1 lesson).
    ("eslab", None, {
        "eslab.bad_json": "Bad JSON — fix the raw body; nothing was sent.",
        "eslab.console_option": "Raw console (custom JSON)",
        "eslab.copy_link": "Copy link",
        "eslab.disabled_notice": "Community history is off — enable it in Settings to run index queries.",
        "eslab.filter": "Filter templates…",
        "eslab.hint_agg": "Counts over the window; shares are exact integer-math percents.",
        "eslab.hint_generic": "Raw index JSON below, untouched. Balances are raw integers — divide by asset precision; percent fields are hundredths of a percent (2000 = 20%).",
        "eslab.hint_holders": "Balances are raw integers — divide by the asset precision.",
        "eslab.hint_ops": "Times are block times (UTC); type ids map via the operation table.",
        "eslab.history": "This session",
        "eslab.link_copied": "Shareable link ready (also in the address bar after Run).",
        "eslab.mainnet_only": "Community index covers mainnet only — testnet accounts and new objects may be missing.",
        "eslab.no_result": "No result yet — fill the boxes and press Run.",
        "eslab.raw_body": "Query body JSON",
        "eslab.raw_dsl": "Raw query JSON (mirrors the boxes)",
        "eslab.raw_index": "Index",
        "eslab.reach_bad": "Index: unreachable",
        "eslab.reach_ok": "Index: reachable",
        "eslab.reach_unknown": "Index: not probed yet",
        "eslab.reset": "Reset",
        "eslab.resolving": "Resolving account name…",
        "eslab.retry": "Retry",
        "eslab.run": "Run",
        "eslab.running": "Running…",
        "eslab.settings_link": "Open Settings",
        "eslab.shape_notice": "Index returned an unexpected shape — raw JSON below, nothing parsed.",
        "eslab.subtitle": "Search the community index by hand: pick a query, fill the boxes, read parsed rows + raw JSON. Reads only — nothing here can move funds.",
        "eslab.template": "Query template",
        "eslab.title": "ES Lab",
        "eslab.unavailable_notice": "Index unreachable. Check your connection and retry, or review Settings.",
        "eslab.unknown_account": "Unknown account — use a 1.2.x id or check spelling.",
    }),
]


def apply_batch(data, ns, anchor, new_keys):
    """Insert one batch into data[ns] after anchor (position-preserving
    value sync; reruns self-heal to the script values, which must mirror
    the t()/tt() defaults byte-for-byte). anchor None creates a fresh
    namespace (uri only). Returns True if applied."""
    created = False
    if ns not in data or not isinstance(data.get(ns), dict):
        data[ns] = {}  # fresh namespace (uri, apilab): insert all, no anchor
        created = True
    section = data[ns]
    if not created and anchor is not None and len(section) > 0 and anchor not in section:
        return False
    shorts = {}
    for full, v in new_keys.items():
        shorts[full.split(".", 1)[1]] = v
    if created or len(section) == 0:
        # Fresh namespace: insert the whole batch (no anchor to hang from).
        data[ns] = dict(shorts)
        return True
    rebuilt = {}
    for key, val in section.items():
        rebuilt[key] = shorts.get(key, val)
        if key == anchor:
            for short, v in shorts.items():
                if short not in section:
                    rebuilt[short] = v
    data[ns] = rebuilt
    return True


def main():
    for code in LOCALES:
        path = "vanilla/locales/%s.json" % code
        with io.open(path, encoding="utf-8") as f:
            data = json.load(f)
        for ns, anchor, new_keys in BATCHES:
            if not apply_batch(data, ns, anchor, new_keys):
                print("ANCHOR %s.%s MISSING in %s" % (ns, anchor, path))
                return 1
        if code != "en":
            pass  # inventory lives in en.json only (W1 precedent)
        else:
            inv = data["_meta"]["translated"]
            for _, _, new_keys in BATCHES:
                for full in new_keys:
                    if full not in inv:
                        inv.append(full)
            inv.sort()
        with io.open(path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print("updated %s" % path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
