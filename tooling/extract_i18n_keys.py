#!/usr/bin/env python3
"""Extract i18n stub keys + inventory for slice 17 (Task 1, one-shot aid).

Reads CURRENT vanilla display literals verbatim (no rewording) and emits
deterministic per-view stub sections for locales/en.json. Batch-1 keys
(nav/settings/shell) are hand-curated; this script covers every OTHER view
so later batches add keys without churn.

Usage:
  python3 tooling/extract_i18n_keys.py inventory   # counts: vanilla literals per file + #1 leaf inventory
  python3 tooling/extract_i18n_keys.py stubs       # JSON stub sections on stdout (paste under en.json)

Method (recorded for the parity note):
  - Scans vanilla/js/*-ui.js (+ asset-ops.js, vote.js consumers render via UI
    files only) for `textContent = "..."` / `textContent = '...'` assignments
    and `placeholder("...")` titles, first-seen order, de-duplicated.
  - Skips dynamic compositions (lines containing `+`, backticks, or function
    calls) — only static string literals become stub values.
  - Skips shell/settings/router sources (batch-1, hand-curated).
  - Keys are s1..sN per section (stable while the scan list is fixed; later
    batches rename with en.json + check_i18n.py updated in the same task).
  - Values are byte-verbatim (unicode preserved, no trim).

Reference: bitshares-ui/app/assets/locales/locale-en.json (2709 leaves,
60 top-level sections, measured 2026-09-28); astro-ui/src/data/locales
(second-opinion es only). Neither reference is modified.
"""
import json
import glob
import os
import re
import sys

VANILLA = "/workspace/vanilla/js"
REF_LOCALES = "/workspace/bitshares-ui/app/assets/locales"

# View file -> dict section. Batch-1 sources (settings.js, app.js, router.js,
# index.html) are excluded here: hand-curated nav/settings/shell sections.
SECTION_OF = {
    "account-ui.js": "account",
    "asset-ui.js": "assets",
    "asset-manage-ui.js": "assets_manage",
    "asset-feed-ui.js": "assets_feed",
    "barter-ui.js": "barter",
    "borrow-ui.js": "borrow",
    "credit-ui.js": "credit",
    "credit-detail-ui.js": "credit_detail",
    "samet-ui.js": "samet",
    "debit-ui.js": "debit",
    "explorer-ui.js": "explorer",
    "explorer-blocks.js": "explorer_blocks",
    "explorer-assets.js": "explorer_assets",
    "asset-ops.js": "asset_ops",
    "gateway-ui.js": "gateway",
    "htlc-ui.js": "htlc",
    "market-ui.js": "market",
    "market-book.js": "market_book",
    "market-charts.js": "market_charts",
    "market-orders.js": "market_orders",
    "trade-ui.js": "trade",
    "misc-ui.js": "misc",
    "notify-ui.js": "notify",
    "pool-ui.js": "pools",
    "pool-detail-ui.js": "pool_detail",
    "pool-swap-ui.js": "swap",
    "proposal-ui.js": "proposals",
    "proposal-misc.js": "proposals_misc",
    "proposal-ticket.js": "proposals_ticket",
    "ticket-ui.js": "tickets",
    "transfer-ui.js": "transfer",
    "vesting-ui.js": "vesting",
    "vote-ui.js": "voting",
    "wallet-ui.js": "wallet",
}

LIT_RE = re.compile(
    r"textContent\s*=\s*(?P<q>[\"'])(?P<v>(?:\\.|(?!\1).){1,160}?)\1\s*;"
)
TITLE_RE = re.compile(r"placeholder\s*\(\s*([\"'])(?P<v>(?:\\.|(?!\1).){1,80}?)\1\s*\)")
H1_RE = re.compile(r"<h1>(?P<v>[^<]{1,80}?)</h1>")

# Primary router title per view file, VERBATIM from vanilla/js/router.js
# routes table (document.title + placeholder h1 copy). One reserved
# `<section>.title` key per view so later batches expand without key churn.
ROUTE_TITLE_OF = {
    "account-ui.js": "Account",
    "asset-ui.js": "Assets",
    "asset-manage-ui.js": "Create Asset",
    "asset-feed-ui.js": "Publish Feed",
    "barter-ui.js": "Barter",
    "borrow-ui.js": "Borrow",
    "credit-ui.js": "Credit Offer",
    "credit-detail-ui.js": "Credit Offer",
    "samet-ui.js": "Same-T Funds",
    "debit-ui.js": "Direct Debit",
    "explorer-ui.js": "Explorer",
    "explorer-blocks.js": "Block",
    "explorer-assets.js": "Asset",
    "asset-ops.js": "Asset",
    "gateway-ui.js": "Deposit / Withdraw",
    "htlc-ui.js": "HTLC",
    "market-ui.js": "Exchange",
    "market-book.js": "Exchange",
    "market-charts.js": "Exchange",
    "market-orders.js": "Exchange",
    "trade-ui.js": "Exchange",
    "misc-ui.js": "Invoice",
    "notify-ui.js": "Price Alerts",
    "pool-ui.js": "Liquidity Pools",
    "pool-detail-ui.js": "Liquidity Pool",
    "pool-swap-ui.js": "Swap",
    "proposal-ui.js": "Proposals",
    "proposal-misc.js": "Proposal",
    "proposal-ticket.js": "Tickets",
    "ticket-ui.js": "Tickets",
    "transfer-ui.js": "Transfer",
    "vesting-ui.js": "Vesting",
    "vote-ui.js": "Voting",
    "wallet-ui.js": "Wallet",
}


def unescape(v):
    return v.replace("\\'", "'").replace('\\"', '"').replace("\\\\", "\\")


def literals_of(path):
    """Static display literals in first-seen order, de-duplicated."""
    out = []
    seen = set()
    try:
        src = open(path, encoding="utf-8").read()
    except OSError:
        return out
    for m in list(LIT_RE.finditer(src)) + list(TITLE_RE.finditer(src)):
        v = unescape(m.group("v"))
        if not v.strip():
            continue
        line = src[max(0, m.start() - 120):m.start()]
        # Dynamic composition: skip (values composed in code, not dict copy).
        if "+" in src[m.start():m.end()] and "textContent" in line + "textContent":
            pass
        if v not in seen:
            seen.add(v)
            out.append(v)
    return out


def cmd_inventory():
    print("== vanilla literals per view file (static textContent/placeholder only) ==")
    total = 0
    for fname in sorted(SECTION_OF):
        p = os.path.join(VANILLA, fname)
        lits = literals_of(p)
        total += len(lits)
        print("%-22s section=%-16s literals=%d" % (fname, SECTION_OF[fname], len(lits)))
    print("total stub-candidate literals:", total)
    print()
    print("== reference #1 leaf inventory (bitshares-ui/app/assets/locales/) ==")
    for f in sorted(glob.glob(os.path.join(REF_LOCALES, "*.json"))):
        d = json.load(open(f, encoding="utf-8"))

        def leaves(o):
            n = 0
            for v in o.values():
                n += leaves(v) if isinstance(v, dict) else 1
            return n

        print("%-16s leaves=%d top-sections=%d" % (os.path.basename(f), leaves(d), len(d)))
    print()
    print("== reference #1 top-level sections (en key universe, vanilla reuses names")
    print("   only where concepts overlap; else flat vanilla sections) ==")
    d = json.load(open(os.path.join(REF_LOCALES, "locale-en.json"), encoding="utf-8"))
    print(", ".join(sorted(d.keys())))


def cmd_stubs():
    sections = {}
    for fname in sorted(SECTION_OF):
        lits = [v for v in literals_of(os.path.join(VANILLA, fname))
                if v != ROUTE_TITLE_OF.get(fname, "")][:7]
        sec = SECTION_OF[fname]
        entry = {"title": ROUTE_TITLE_OF.get(fname, sec)}
        for i, v in enumerate(lits):
            entry["s%d" % (i + 1)] = v
        sections[sec] = entry
    print(json.dumps(sections, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "inventory"
    if mode == "stubs":
        cmd_stubs()
    else:
        cmd_inventory()
