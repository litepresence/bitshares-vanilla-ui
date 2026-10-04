#!/usr/bin/env python3
"""RAW5 batch1 views: V4 repoint unlock_failed->common, V11 case, V7 elastic default.

Exact-string replacements with per-file counts asserted. Run once.
"""
import sys

def sub(path, old, new, expect):
    src = open(path, encoding="utf-8").read()
    n = src.count(old)
    assert n == expect, f"{path}: {old!r} found {n}, expected {expect}"
    open(path, "w", encoding="utf-8").write(src.replace(old, new))
    print(f"{path}: {n}x replaced")

V = "vanilla/js/views/"
S = "vanilla/js/"

# ---- V4: unlock_failed -> common.unlock_failed "Unlock failed." ----
sub(V+"barter-ui.js", 't("barter.unlock_failed", "Unlock failed.")', 't("common.unlock_failed", "Unlock failed.")', 1)
sub(V+"borrow-ui.js", 't("borrow.unlock_failed", "Unlock failed.")', 't("common.unlock_failed", "Unlock failed.")', 1)
sub(V+"credit-ui.js", 't("credit.unlock_failed", "Unlock failed.")', 't("common.unlock_failed", "Unlock failed.")', 1)
sub(V+"htlc-ui.js", 't("barter.unlock_failed", "Unlock failed.")', 't("common.unlock_failed", "Unlock failed.")', 1)
sub(V+"pool-ui.js", 't("barter.unlock_failed", "Unlock failed.")', 't("common.unlock_failed", "Unlock failed.")', 1)
sub(V+"prediction-ui.js", 't("borrow.unlock_failed", "Unlock failed.")', 't("common.unlock_failed", "Unlock failed.")', 1)
sub(V+"trollbox-ui.js", 't("trollbox.unlock_failed", "Unlock failed.")', 't("common.unlock_failed", "Unlock failed.")', 1)
sub(V+"auth-ui.js", 't("auth.unlock_failed", "Unlock failed")', 't("common.unlock_failed", "Unlock failed.")', 1)
sub(V+"instant-trade-ui.js", 't("instant.unlock_failed", "Unlock failed")', 't("common.unlock_failed", "Unlock failed.")', 1)
sub(V+"transfer-preview.js", 't("transfer.unlock_failed", "Unlock failed")', 't("common.unlock_failed", "Unlock failed.")', 1)
sub(V+"transfer-propose.js", 't("transfer.unlock_failed", "Unlock failed")', 't("common.unlock_failed", "Unlock failed.")', 1)
sub(V+"account-history.js", 't("transfer.unlock_failed", "Unlock failed")', 't("common.unlock_failed", "Unlock failed.")', 1)
sub(V+"account-membership.js", 't("transfer.unlock_failed", "Unlock failed")', 't("common.unlock_failed", "Unlock failed.")', 1)
sub(V+"account-portfolio.js", 't("transfer.unlock_failed", "Unlock failed")', 't("common.unlock_failed", "Unlock failed.")', 1)
sub(V+"accounts-ui.js", 't("transfer.unlock_failed", "Unlock failed")', 't("common.unlock_failed", "Unlock failed.")', 1)
sub(V+"trade-form.js", 't("trade.unlock_failed", "Unlock failed")', 't("common.unlock_failed", "Unlock failed.")', 2)

# ---- V11 case (en defaults in t() + plain tab labels) ----
for f in ["account-history.js", "account-membership.js", "account-portfolio.js"]:
    sub(V+f, 't("account.s4", "My Account")', 't("account.s4", "My account")', 2)
    sub(V+f, 't("account.margin_positions", "Margin Positions")', 't("account.margin_positions", "Margin positions")', 1)
    sub(V+f, 't("account.credit_management", "Credit Management")', 't("account.credit_management", "Credit management")', 1)
    # plain tab labels (not i18n — same user-visible strings)
    sub(V+f, '{ key: "margin", label: "Margin Positions"', '{ key: "margin", label: "Margin positions"', 1)
    sub(V+f, '{ key: "credit", label: "Credit Management"', '{ key: "credit", label: "Credit management"', 1)
sub(V+"menu-ui.js", 'titleDefault: "My Account"', 'titleDefault: "My account"', 1)
sub(V+"menu-ui.js", 'titleDefault: "Create Asset"', 'titleDefault: "Create asset"', 1)
sub(V+"menu-ui.js", 'titleDefault: "Publish Feed"', 'titleDefault: "Publish feed"', 1)

# ---- V7 elastic default ----
sub(V+"help-ui.js", '["help.elastic", "Chain data (Elastic)", [', '["help.elastic", "Community index (third-party history)", [', 1)
