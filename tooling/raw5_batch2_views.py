#!/usr/bin/env python3
"""RAW5 batch2 views: V2 CTA, V3 template repoint, V5/V6 gloss defaults."""
def sub(path, old, new, expect):
    src = open(path, encoding="utf-8").read()
    n = src.count(old)
    assert n == expect, f"{path}: {old!r} found {n}, expected {expect}"
    open(path, "w", encoding="utf-8").write(src.replace(old, new))
    print(f"{path}: {n}x")

V = "vanilla/js/views/"
LP = "Wallet locked — preview only. Password is asked at Sign & Send, never to view."
LS = "Wallet is locked — unlock to sign. The preview above stays visible; password is asked only here, at signing."
LH = "Unlock to sign — the password is asked only here, at signing."

# ---- V2: pre-review CTA -> Unlock & review ----
sub(V+"transfer-preview.js", 't("transfer.unlock_sign", "Unlock & Sign")', 't("transfer.unlock_sign", "Unlock & review")', 1)
sub(V+"transfer-propose.js", 't("transfer.unlock_sign", "Unlock & Sign")', 't("transfer.unlock_sign", "Unlock & review")', 1)
# trade.unlock_review already "Unlock & review" — verified, untouched.

# ---- V3: locked templates -> common.* ----
sub(V+"barter-ui.js", 't("barter.locked_preview_note", "'+LP+'")', 't("common.locked_preview", "'+LP+'")', 1)
sub(V+"barter-ui.js", 't("barter.locked_sign_note", "'+LS+'")', 't("common.locked_sign", "'+LS+'")', 1)
sub(V+"borrow-ui.js", 't("borrow.locked_preview_note", "'+LP+'")', 't("common.locked_preview", "'+LP+'")', 1)
sub(V+"borrow-ui.js", 't("borrow.locked_sign_note", "'+LS+'")', 't("common.locked_sign", "'+LS+'")', 1)
sub(V+"credit-ui.js", 't("credit.locked_preview_note", "'+LP+'")', 't("common.locked_preview", "'+LP+'")', 1)
sub(V+"credit-ui.js", 't("credit.locked_sign_note", "'+LS+'")', 't("common.locked_sign", "'+LS+'")', 1)
sub(V+"instant-trade-ui.js", 't("instant.locked_preview_note", "'+LP+'")', 't("common.locked_preview", "'+LP+'")', 1)
sub(V+"instant-trade-ui.js", 't("instant.locked_sign_note", "'+LS+'")', 't("common.locked_sign", "'+LS+'")', 1)
sub(V+"htlc-ui.js", 't("barter.locked_preview_note", "'+LP+'")', 't("common.locked_preview", "'+LP+'")', 1)
sub(V+"htlc-ui.js", 't("barter.locked_sign_note", "'+LS+'")', 't("common.locked_sign", "'+LS+'")', 1)
sub(V+"prediction-ui.js", 't("borrow.locked_preview_note", "'+LP+'")', 't("common.locked_preview", "'+LP+'")', 1)
sub(V+"prediction-ui.js", 't("borrow.locked_sign_note", "'+LS+'")', 't("common.locked_sign", "'+LS+'")', 1)
sub(V+"transfer-preview.js", 't("transfer.locked_sign_hint", "'+LH+'")', 't("common.locked_sign", "'+LS+'")', 1)
sub(V+"transfer-propose.js", 't("transfer.locked_sign_hint", "'+LH+'")', 't("common.locked_sign", "'+LS+'")', 1)
# proposal/vote/debit browsing variants deliberately kept.

# ---- V5/V6 glosses ----
sub(V+"explorer-assets.js", 't("explorer.feed_cer_premium", "CER premium (publisher-rule estimate)")', 't("explorer.feed_cer_premium", "Core exchange rate (CER) premium (publisher-rule estimate)")', 2)
sub(V+"asset-feed-ui.js", 't("asset.cer_row", "CER")', 't("asset.cer_row", "Core exchange rate (CER)")', 2)
sub(V+"asset-ui.js", 't("asset.cer_row", "CER")', 't("asset.cer_row", "Core exchange rate (CER)")', 1)
sub(V+"htlc-ui.js", 't("htlc.list_sub", "Locked transfers redeemable with a secret preimage before expiry.")', 't("htlc.list_sub", "Hash time-locked contract (HTLC) transfers redeemable with a secret preimage before expiry.")', 1)
sub(V+"vote-ui.js", 't("vote.in_sync", "Slate matches the chain — no changes to publish.")', 't("vote.in_sync", "Vote slate matches the chain — no changes to publish.")', 1)
sub(V+"vote-ui.js", 't("vote.proxies_follow_another_account_s_slate_re", "Proxies follow another account\'s slate — read how voting works before setting one.")', 't("vote.proxies_follow_another_account_s_slate_re", "Proxies follow another account\'s vote slate — read how voting works before setting one.")', 1)
sub(V+"vote-ui.js", 't("vote.proxy_follows", " — your stake follows this account; the slate below is read-only.")', 't("vote.proxy_follows", " — your stake follows this account; the vote slate below is read-only.")', 1)
