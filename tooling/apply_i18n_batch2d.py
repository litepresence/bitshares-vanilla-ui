#!/usr/bin/env python3
"""Batch-2d i18n converter: asset/htlc/debit/pool views -> t() (AFK worker).

Converts static display literals in the 8 batch-2d view files to
t("section.key", "byte-verbatim literal") per slice-17 precedent (local 2-arg
t() helper with I18n guard; batch-2c shape). New keys accumulate in
vanilla/locales/frag-batch2d.json (nested sections); en.json and all other
dicts are NOT touched (a later merge task reconciles).

Scope rules (recorded ambiguities are stated in APPLY_AMBIGUITIES below):
  CONVERT: whole-string static display literals in allowlisted syntactic
    positions (el 3rd arg, u.el 3rd arg, textContent assign, field/u.field
    labels, word-bearing placeholders, routeReady titles, showStatus/
    showError/offlineBox/unlockBox/routeFail literal args, String(e||...)
    fallbacks, reviewSection labels, title:/fail:/okText: props, ok: returns,
    row-pair first elements, tableHead headers, option labels that are full
    words, word-bearing prefix/suffix segments of dynamic sentences
    (batch-2c precedent: "Observed at head block #", " (core)", "Head #").
    htlc PRESETS select labels (stable keys; load-time evaluated, stated).
  SKIP: amounts/dates/numbers, numeric/example-value placeholders
    ("10","1.0","BTS","CNY","USD","AFKTEST01","e.g. TESTMPA"), console
    strings, comments, pure punctuation/whitespace/number glue adjacent to
    + (" ","(",").","/"," -> "," %", ...), tag/class/id/href/inputmode/type
    tokens, chain ids + WS method names, indexOf-matched message codes and
    pure-code throws ("wallet-locked","not-connected","unknown-asset",
    "symbol-taken","not-issuer","not-market-issued",...), module data-table
    tokens (PERMS/FLAGS non-display members stay), dynamic compositions
    whose literals carry no letters.
  RENAMES (behavior-identical, t()-shadow repair, batch-2c precedent):
    asset-ui.js renderAssets row `t`->`nm`; asset-ui.js create `var t`->`ntT`;
    asset-manage-ui.js half() `t`->`toF`; asset-feed-ui.js paintPrev `t`->`txt`.

Reuse policy (task instruction; AMBIGUITY A): an en.json key whose value is
byte-identical to the literal is reused instead of minting. Choice among
several identical keys: prefer a batch-domain namespace
(htlc/debit/pools/swap/assets/assets_feed/asset_ops/fees), else the
alphabetically-first key. Every reuse is logged to /tmp/batch2d-ledger.json.
New keys are stable short snake_case (never slugified sentences), assigned
explicitly in KEYMAP (no auto-slug fallback: unmapped literals are reported,
never minted).

Usage: python3 tooling/apply_i18n_batch2d.py [--apply]
  Default: dry run, prints per-file t() counts + unmapped report.
  --apply: rewrites the 8 files + writes frag-batch2d.json + ledger.
"""
import json
import os
import re
import sys

WS = "/workspace"
VANILLA = os.path.join(WS, "vanilla", "js")
LOCALES = os.path.join(WS, "vanilla", "locales")
FRAG = os.path.join(LOCALES, "frag-batch2d.json")
LEDGER = "/tmp/batch2d-ledger.json"

NS_OF = {
    "asset-ui.js": "asset",
    "asset-manage-ui.js": "asset",
    "asset-feed-ui.js": "asset",
    "htlc-ui.js": "htlc",
    "debit-ui.js": "debit",
    "pool-ui.js": "pool",
    "pool-detail-ui.js": "pool",
    "pool-swap-ui.js": "pool",
}
FILES = list(NS_OF)
DOMAIN_NS = {"htlc", "debit", "pools", "swap", "assets", "assets_feed",
             "asset_ops", "fees", "pool"}

DQ = r'"((?:\\.|[^"\\])*)"'

HELPER = (
    "\n"
    "  /* Batch-2d i18n (slice-17 precedent): display strings resolve via I18n.t with\n"
    "   * the pre-conversion literal kept verbatim as enDefault (English-identical on any\n"
    "   * transport, incl. file:// where dict fetch fails). Falls back to the default\n"
    "   * when i18n.js failed to load: never blank, never throws. Dynamic sentences keep\n"
    "   * their code structure (batch-2b precedent): only complete static literals and\n"
    "   * word-bearing segments are wrapped, values and punctuation glue stay raw, so\n"
    "   * every default below is byte-verbatim in the HEAD blob. */\n"
    "  function t(key, dflt) {\n"
    "    try {\n"
    "      if (typeof I18n !== \"undefined\" && I18n && typeof I18n.t === \"function\") return I18n.t(key, dflt);\n"
    "    } catch (e) { /* default below */ }\n"
    "    return dflt;\n"
    "  }\n"
)

# Tokens that are never display text (tags, classes, ids, hrefs, modes...).
TOKEN_SKIP = {
    "div", "wrap", "wrap mkt-wrap", "mkt", "mkt-head", "mkt-statstrip",
    "mkt-charts", "mkt-side", "mkt-book", "mkt-trades", "button", "p", "h1",
    "h2", "h3", "span", "input", "label", "textarea", "select", "option",
    "table", "thead", "tbody", "tr", "th", "td", "dl", "dt", "dd", "a",
    "strong", "section", "text", "password", "checkbox", "decimal", "numeric",
    "datetime-local", "off", "error", "muted", "xfer-field", "xfer-confirm",
    "xfer-ok", "xfer-out", "xfer-unlock-row", "xfer-sign-note", "node-table",
    "pools-table", "pools-filters", "pools-pager", "pools-page",
    "pools-scroll", "unit-wrap", "unit-suffix", "cell-icon", "asset-nav",
    "asset-list", "asset-fees", "asset-row", "asset-create", "asset-bits",
    "asset-feed", "vote-tabs", "vote-tab", "vote-tab active", "spot-grid",
    "spot-card", "click", "change", "open", "undefined", "function",
    "connection", "href", "placeholder", "autocomplete", "inputmode", "type",
    "colspan", "aria-live", "polite", "flex", "8px", "44px", "220px",
    "xplore-scroll", "xplore-fields", "current-password",
}
# Example/numeric placeholder values: guidance, not language.
PLACEHOLDER_SKIP = {
    "", "BTS", "CNY", "USD", "AFKTEST01", "e.g. TESTMPA", "1.23456", "1.0",
    "0.9", "1.1", "0.5", "0", "1", "4", "5", "10", "12", "20", "24", "175",
    "150", "86400", "1000000", "1.12.N", "1.2.0", "1.3.0", "1.19.0", "%",
    "00",
}


def unescape(v):
    return v.replace("\\'", "'").replace('\\"', '"').replace("\\\\", "\\")


def escape(v):
    return v.replace("\\", "\\\\").replace('"', '\\"')


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


EN = flatten(json.load(open(os.path.join(LOCALES, "en.json"), encoding="utf-8")))
BY_VALUE = {}
for k, v in EN.items():
    BY_VALUE.setdefault(v, []).append(k)


def reuse_key(lit):
    cands = BY_VALUE.get(lit)
    if not cands:
        return None
    dom = sorted(k for k in cands if k.split(".")[0] in DOMAIN_NS)
    return (dom or sorted(cands))[0]


def message_codes(srcs):
    substr, exact = set(), set()
    for src in srcs:
        for m in re.finditer(r"\.indexOf\(\(\s*" + DQ + r"\s*\)", src):
            pass
        for m in re.finditer(r"\.indexOf\(\s*" + DQ + r"\s*\)", src):
            substr.add(unescape(m.group(1)))
        for m in re.finditer(r"(?:===|!==)\s*" + DQ, src):
            exact.add(unescape(m.group(1)))
    return substr, exact


def has_letter(s):
    return re.search(r"[A-Za-z]", s) is not None


# Explicit new-key map: (namespace, literal) -> short key. No slug fallback.
KEYMAP = {
    ('asset', "Acting account (name or 1.2.N)"): 'acting_field',
    ('asset', "Amount (human)"): 'amount_field',
    ('asset', "Asset backend missing."): 'backend_missing',
    ('asset', "Backing (1.3.N)"): 'backing_field',
    ('asset', "Bitasset"): 'bitasset_row',
    ('asset', "Bitasset options"): 'bitasset_title',
    ('asset', "Bitasset options (op 12)"): 'bitasset_op12_title',
    ('asset', "CER"): 'cer_row',
    ('asset', "CER base (human, core)"): 'cer_base_field',
    ('asset', "CER quote (human, backing)"): 'cer_quote_backing_field',
    ('asset', "CER quote (human, new asset)"): 'cer_quote_field',
    ('asset', "Common options (op 11)"): 'common_title',
    ('asset', "Could not load fees."): 'fees_failed',
    ('asset', "Could not load issued assets."): 'issued_failed',
    ('asset', "Could not prepare the bitasset update."): 'bitasset_prepare_failed',
    ('asset', "Could not prepare the feed."): 'feed_prepare_failed',
    ('asset', "Could not prepare the producer update."): 'producers_prepare_failed',
    ('asset', "Create asset"): 'create_title',
    ('asset', "Description"): 'description_row',
    ('asset', "Enter a symbol."): 'enter_symbol',
    ('asset', "Enter an issuer account."): 'enter_issuer',
    ('asset', "Feed lifetime (hours)"): 'feed_lifetime_field',
    ('asset', "Feed producers (op 13)"): 'producers_title',
    ('asset', "Feed published"): 'feed_published',
    ('asset', "Feed read-back unavailable."): 'feed_unavailable',
    ('asset', "Feeds exist only on smartcoins. To test publishing, create your own testnet MPA, add yourself as a feed producer, then publish here."): 'feed_help',
    ('asset', "Flags"): 'flags_title',
    ('asset', "Issue / reserve"): 'issue_title',
    ('asset', "Issuer (name or 1.2.N)"): 'issuer_field',
    ('asset', "Load feed"): 'load_feed',
    ('asset', "Load issued assets"): 'load_issued',
    ('asset', "MCR"): 'mcr_row',
    ('asset', "MCR % (human, e.g. 175)"): 'mcr_field',
    ('asset', "MSSR % (human, e.g. 150)"): 'mssr_field',
    ('asset', "Market fee % (human)"): 'market_fee_field',
    ('asset', "Market-issued assets cannot be reserved."): 'no_reserve_mpa',
    ('asset', "Max market fee (human)"): 'max_market_fee_field',
    ('asset', "Max settlement vol %"): 'max_settle_vol_field',
    ('asset', "Max supply (human)"): 'max_supply_field',
    ('asset', "Max vol"): 'max_vol_row',
    ('asset', "NFT"): 'nft_row',
    ('asset', "NFT URI"): 'nft_uri_field',
    ('asset', "NFT metadata (description nft_object)"): 'nft_meta_title',
    ('asset', "NFT needs a title or URI."): 'err_nft_meta',
    ('asset', "NFT title"): 'nft_title_field',
    ('asset', "No assets issued by this account."): 'no_issued',
    ('asset', "No fee rows returned."): 'no_fee_rows',
    ('asset', "No live feed published yet."): 'no_live_feed',
    ('asset', "Not a market-issued asset — feeds exist only on smartcoins."): 'not_mpa_feed',
    ('asset', "Not a market-issued asset."): 'not_market_issued',
    ('asset', "Offset"): 'offset_row',
    ('asset', "Only the issuer can change this."): 'only_issuer',
    ('asset', "Only the issuer can edit this asset."): 'only_issuer_edit',
    ('asset', "Only the issuer can set producers."): 'only_issuer_producers',
    ('asset', "Op"): 'op_col',
    ('asset', "Payer"): 'payer_row',
    ('asset', "Precision (0–12)"): 'precision_field',
    ('asset', "Prediction market"): 'pma_row',
    ('asset', "Prediction market: is_prediction_market locked ON."): 'pma_note',
    ('asset', "Producers"): 'producers_row',
    ('asset', "Producers (one name or 1.2.N per line)"): 'producers_field',
    ('asset', "Producers updated"): 'producers_updated',
    ('asset', "Publish feed"): 'feed_title',
    ('asset', "Publish feed (op 19)"): 'publish_op19_title',
    ('asset', "Publisher"): 'publisher_row',
    ('asset', "Publisher (name or 1.2.N)"): 'publisher_field',
    ('asset', "Review bitasset update"): 'review_bitasset',
    ('asset', "Review feed"): 'review_feed',
    ('asset', "Review producers"): 'review_producers',
    ('asset', "Settlement delay (sec)"): 'settle_delay_field',
    ('asset', "Settlement offset %"): 'settle_offset_field',
    ('asset', "Settlement quote (human, backing)"): 'settle_quote_field',
    ('asset', "Smartcoin"): 'smartcoin_row',
    ('asset', "Smartcoin symbol"): 'smartcoin_field',
    ('asset', "Symbol (A-Z0-9.)"): 'symbol_field',
    ('asset', "Symbol is already taken."): 'symbol_taken',
    ('asset', "To (name or 1.2.N)"): 'to_field',
    ('asset', "Update asset"): 'update_title',
    ('asset', "Viewing as committee-account (1.2.0) — unlock to sign."): 'viewing_notice',
    ('asset', "Wallet is locked. Enter your password."): 'locked_prompt',
    ('asset', "bad-symbol (uppercased A-Z0-9.)"): 'err_bad_symbol',
    ('asset', "changed (verified by re-read)"): 'desc_changed',
    ('asset', "precision must be 0-12"): 'err_precision',
    ('debit', "Authorized"): 'auth_row',
    ('debit', "Authorized account"): 'auth_field',
    ('debit', "Available now"): 'available_row',
    ('debit', "Claim / delete"): 'action_title',
    ('debit', "Claim amount (claim only)"): 'claim_amount_field',
    ('debit', "Claim memo, optional (claim only)"): 'memo_field',
    ('debit', "Claim memos are plaintext on-chain in v1 — never put secrets in one."): 'memo_warning',
    ('debit', "Computing order ladder…"): 'computing',
    ('debit', "Confirm claim"): 'confirm_claim',
    ('debit', "Confirm delete"): 'confirm_delete',
    ('debit', "Confirm permission"): 'confirm_perm',
    ('debit', "Could not estimate the delete fee."): 'delete_fee_failed',
    ('debit', "Could not load permissions."): 'load_failed',
    ('debit', "Could not prepare the claim."): 'claim_failed',
    ('debit', "Could not prepare the permission."): 'perm_failed',
    ('debit', "Could not preview the ladder."): 'preview_failed',
    ('debit', "Fee (paid by claimant)"): 'claimant_fee_row',
    ('debit', "From (giver)"): 'from_row',
    ('debit', "Giver"): 'giver_row',
    ('debit', "HTLC backend missing: htlc-ui.js failed to load."): 'backend_missing',
    ('debit', "High price (recv per sell)"): 'high_field',
    ('debit', "High price must be above low price."): 'err_range',
    ('debit', "Limit change"): 'limit_change_row',
    ('debit', "Limit per period"): 'limit_field',
    ('debit', "Loading permissions…"): 'loading',
    ('debit', "Low price (recv per sell)"): 'low_field',
    ('debit', "Memo warning"): 'memo_warning_row',
    ('debit', "Min receive"): 'min_recv_col',
    ('debit', "New / update permission"): 'form_title',
    ('debit', "Order count (2–20)"): 'count_orders_field',
    ('debit', "Order count must be 2–20."): 'err_count',
    ('debit', "Period"): 'period_row',
    ('debit', "Period count"): 'count_field',
    ('debit', "Permission"): 'perm_col',
    ('debit', "Permission id"): 'perm_id_field',
    ('debit', "Permission id (update only, else blank)"): 'perm_field',
    ('debit', "Plaintext on-chain — visible to everyone"): 'plaintext_note',
    ('debit', "Prediction"): 'tile_prediction',
    ('debit', "Preview recurring orders"): 'preview_ladder',
    ('debit', "Receive asset"): 'recv_asset_field',
    ('debit', "Recurring orders helper"): 'recurring_title',
    ('debit', "Recurring withdrawal rights you granted or received."): 'list_sub',
    ('debit', "Review permission"): 'review_perm',
    ('debit', "Sell asset"): 'sell_asset_field',
    ('debit', "Spotlight"): 'spotlight_title',
    ('debit', "Start"): 'start_row',
    ('debit', "Start (local time)"): 'start_field',
    ('debit', "To (claimant, pays fee)"): 'claimant_row',
    ('debit', "Total must be greater than zero."): 'err_total',
    ('debit', "Total to sell"): 'total_field',
    ('debit', "Unlocked — press Preview again so the orders use your account, then sign."): 'unlocked_note',
    ('debit', "Wallet is locked — unlock to sign (preview stays visible)."): 'locked_sign_note',
    ('debit', "not placed"): 'not_placed',
    ('debit', "stored in PLAINTEXT"): 'plaintext_ph',
    ('htlc', " (ripemd160: paste a hash — hashing is sha256-only)"): 'ripemd_note',
    ('htlc', "Account not found."): 'unknown_account',
    ('htlc', "Added time"): 'added_row',
    ('htlc', "Back to HTLCs"): 'back_link',
    ('htlc', "Claim period"): 'period_row',
    ('htlc', "Confirm HTLC"): 'confirm_create',
    ('htlc', "Confirm extend"): 'confirm_extend',
    ('htlc', "Confirm redeem"): 'confirm_redeem',
    ('htlc', "Contract"): 'contract_col',
    ('htlc', "Could not estimate the extend fee."): 'extend_fee_failed',
    ('htlc', "Could not estimate the redeem fee."): 'redeem_fee_failed',
    ('htlc', "Could not load contracts."): 'load_failed',
    ('htlc', "Could not load the contract."): 'detail_failed',
    ('htlc', "Could not prepare the HTLC."): 'create_failed',
    ('htlc', "Enter a non-empty preimage."): 'enter_preimage',
    ('htlc', "Expired: the sender is refunded automatically; no redeem is possible."): 'expired_note',
    ('htlc', "Extend timelock"): 'extend_title',
    ('htlc', "Extra seconds must be a positive integer."): 'err_extra_secs',
    ('htlc', "Fee scales per day (fee_per_day)"): 'fee_per_day_note',
    ('htlc', "Hash algorithm"): 'algo_row',
    ('htlc', "Hash lock"): 'hashlock_col',
    ('htlc', "Hash: "): 'hash_label',
    ('htlc', "Hashed Timelock Contracts"): 'list_title',
    ('htlc', "Loading contracts…"): 'loading',
    ('htlc', "Loading contract…"): 'loading_detail',
    ('htlc', "Locked transfers redeemable with a secret preimage before expiry."): 'list_sub',
    ('htlc', "Network note"): 'netnote_row',
    ('htlc', "New HTLC"): 'new_title',
    ('htlc', "New expiry"): 'expiry_row',
    ('htlc', "Password"): 'password_ph',
    ('htlc', "Preimage"): 'preimage_label',
    ('htlc', "Preimage does not match the locked hash."): 'hash_mismatch',
    ('htlc', "Preimage hash"): 'hash_row',
    ('htlc', "Preimage size"): 'size_row',
    ('htlc', "Redeem"): 'redeem_title',
    ('htlc', "Redeemer"): 'redeemer_row',
    ('htlc', "Review HTLC"): 'review_create',
    ('htlc', "Review extend"): 'review_extend',
    ('htlc', "Review redeem"): 'review_redeem',
    ('htlc', "Secret: "): 'secret_label',
    ('htlc', "Unknown HTLC contract."): 'unknown_contract',
    ('htlc', "You are neither sender nor receiver: read-only for you."): 'readonly_note',
    ('htlc', "You are the receiver, but this contract expired."): 'receiver_expired_note',
    ('htlc', "hex of the preimage hash"): 'hash_ph',
    ('htlc', "preimage"): 'preimage_ph',
    ('htlc', "secret words"): 'secret_ph',
    ('pool', "Amount A"): 'amount_a_field',
    ('pool', "Amount B"): 'amount_b_field',
    ('pool', "Asset A"): 'asset_a_field',
    ('pool', "Asset B"): 'asset_b_field',
    ('pool', "Buy asset"): 'buy_asset_field',
    ('pool', "CPMM pools (x*y=k). Stake is a deposit of both legs for LP shares."): 'list_sub',
    ('pool', "Confirm pool create"): 'confirm_create',
    ('pool', "Confirm pool delete"): 'confirm_delete',
    ('pool', "Confirm pool update"): 'confirm_update',
    ('pool', "Confirm stake"): 'confirm_stake',
    ('pool', "Confirm swap"): 'confirm_swap',
    ('pool', "Confirm unstake"): 'confirm_unstake',
    ('pool', "Could not find pools."): 'find_failed',
    ('pool', "Could not load pools."): 'load_failed',
    ('pool', "Could not prepare the stake."): 'stake_failed',
    ('pool', "Could not prepare the swap."): 'swap_failed',
    ('pool', "Could not prepare the unstake."): 'unstake_failed',
    ('pool', "Could not quote the swap."): 'quote_failed',
    ('pool', "Create pool"): 'create_title',
    ('pool', "Delete is owner-only cleanup. Withdraw all liquidity first."): 'delete_warning',
    ('pool', "Depth (CPMM curve)"): 'depth_title',
    ('pool', "Depth unavailable (empty pool)."): 'depth_unavailable',
    ('pool', "Find pools"): 'find_pools',
    ('pool', "LP shares"): 'shares_field',
    ('pool', "List pools"): 'list_btn',
    ('pool', "Loading pools…"): 'loading',
    ('pool', "Loading pool…"): 'loading_detail',
    ('pool', "Loading price history…"): 'loading_history',
    ('pool', "Min to receive"): 'min_recv_row',
    ('pool', "My pools"): 'mine_title',
    ('pool', "Needs a zero-supply non-smartcoin share asset. Create one at #/assets/create first."): 'share_help',
    ('pool', "New taker fee % (blank = keep)"): 'taker_field',
    ('pool', "Next ›"): 'next_btn',
    ('pool', "No owned pools."): 'no_mine',
    ('pool', "No pool events yet."): 'no_events',
    ('pool', "No pools found."): 'no_pools',
    ('pool', "Orientation"): 'orientation_row',
    ('pool', "Per page "): 'per_page',
    ('pool', "Pool ID"): 'id_col',
    ('pool', "Pool backend missing: pool-ui.js failed to load."): 'backend_missing',
    ('pool', "Pool history"): 'pool_history_title',
    ('pool', "Price history"): 'history_title',
    ('pool', "Price impact"): 'impact_row',
    ('pool', "Quote out (raw)"): 'quote_row',
    ('pool', "Resolving assets and pools…"): 'resolving',
    ('pool', "Review stake"): 'review_stake',
    ('pool', "Review swap"): 'review_swap',
    ('pool', "Review unstake"): 'review_unstake',
    ('pool', "Sell %"): 'sell_pct_col',
    ('pool', "Sell amount"): 'sell_amount_field',
    ('pool', "Sell asset"): 'sell_asset_field',
    ('pool', "Share asset"): 'share_asset_field',
    ('pool', "Single-pool swap (one op-63). No multi-hop routing."): 'swap_sub',
    ('pool', "Slippage"): 'slippage_row',
    ('pool', "Slippage %"): 'slippage_field',
    ('pool', "Stake"): 'stake_link',
    ('pool', "Stake / unstake"): 'stake_title',
    ('pool', "Swap in pool"): 'swap_title',
    ('pool', "Swap in this pool"): 'swap_title_attr',
    ('pool', "Taker fee"): 'taker_row',
    ('pool', "Time (UTC)"): 'time_col',
    ('pool', "Unknown pool."): 'unknown_pool',
    ('pool', "Unlock to act — signing needs your wallet password."): 'unlock_notice',
    ('pool', "Update / delete"): 'manage_title',
    ('pool', "Warning"): 'warning_row',
    ('pool', "Withdrawal fee"): 'withdrawal_row',
    ('pool', "fresh UIA symbol"): 'share_ph',
    ('pool', "order-trap (sell asset is not in this pool)"): 'err_not_in_pool',
    ('pool', "order-trap (sell asset must differ from receive asset)"): 'err_same_asset',
    ('pool', "‹ Prev"): 'prev_btn',
}



class Keyer:
    def __init__(self):
        self.frag = {}
        self.ledger = []

    def T(self, ns, literal):
        rk = reuse_key(literal)
        if rk is not None:
            self.ledger.append({"ns": ns, "literal": literal, "key": rk,
                                "reuse": True})
            return 't("%s", "%s")' % (rk, escape(literal))
        short = KEYMAP.get((ns, literal))
        if short is None:
            return None
        sec = self.frag.setdefault(ns, {})
        if short in sec and sec[short] != literal:
            raise SystemExit("KEYMAP collision: %s.%s" % (ns, short))
        sec[short] = literal
        self.ledger.append({"ns": ns, "literal": literal,
                            "key": ns + "." + short, "reuse": False})
        return 't("%s.%s", "%s")' % (ns, short, escape(literal))


class Ctx:
    def __init__(self, ns, keyer, codes):
        self.ns = ns
        self.keyer = keyer
        self.substr, self.exact = codes
        self.unmapped = []

    def codey(self, lit):
        if lit in self.exact:
            return True
        for c in self.substr:
            if c and c in lit:
                return True
        return False

    def ok(self, lit):
        if not has_letter(lit):
            return False
        if lit in TOKEN_SKIP:
            return False
        if self.codey(lit):
            return False
        return True

    def wrap(self, lit):
        """t() call for lit, or None (caller keeps line unchanged + logs)."""
        if not self.ok(lit):
            return None
        t = self.keyer.T(self.ns, lit)
        if t is None:
            self.unmapped.append(lit)
            return None
        return t

    def sent(self, lit):
        return self.ok(lit) and " " in lit


def p_el(line, ctx):
    def r(m):
        t = ctx.wrap(unescape(m.group(3)))
        return m.group(1) + t + m.group(4) if t else m.group(0)
    line = re.sub(r'(\bel\(\s*d(?:oc)?\s*,\s*"((?:\\.|[^"\\])*)"\s*,\s*)' + DQ + r'(\s*[,)])', r, line)
    def r2(m):
        t = ctx.wrap(unescape(m.group(3)))
        return m.group(1) + t + m.group(4) if t else m.group(0)
    return re.sub(r'((?:\bu|HtlcUI\._ui|PoolUI\._ui)\.el\(\s*doc\s*,\s*"((?:\\.|[^"\\])*)"\s*,\s*)' + DQ + r'(\s*[,)])', r2, line)


def p_textcontent(line, ctx):
    def r(m):
        t = ctx.wrap(unescape(m.group(2)))
        return m.group(1) + t + m.group(3) if t else m.group(0)
    return re.sub(r'(\.textContent\s*=\s*)' + DQ + r'(\s*;)', r, line)


def p_field(line, ctx):
    def r(m):
        t = ctx.wrap(unescape(m.group(2)))
        return m.group(1) + t + m.group(3) if t else m.group(0)
    line = re.sub(r'(\bfield\(\s*d\s*,\s*)' + DQ + r'(\s*,)', r, line)
    return re.sub(r'((?:\bu|HtlcUI\._ui|PoolUI\._ui)\.field\(\s*doc\s*,\s*)' + DQ + r'(\s*,)', r, line)


def p_placeholder(line, ctx):
    def r(m):
        lit = unescape(m.group(2))
        if lit in PLACEHOLDER_SKIP or not ctx.ok(lit):
            return m.group(0)
        t = ctx.wrap(lit)
        return m.group(1) + t if t else m.group(0)
    line = re.sub(r'(placeholder\s*:\s*)' + DQ, r, line)
    return re.sub(r'(setAttribute\("placeholder",\s*)' + DQ, r, line)


def p_attr(line, ctx):
    def r(m):
        t = ctx.wrap(unescape(m.group(2)))
        return m.group(1) + t + m.group(3) if t else m.group(0)
    line = re.sub(r'(\.setAttribute\("aria-label",\s*)' + DQ + r'(\s*\))', r, line)
    return re.sub(r'(\.(?:title|placeholder)\s*=\s*)' + DQ + r'(\s*;)', r, line)


def p_routeready(line, ctx):
    def r(m):
        t = ctx.wrap(unescape(m.group(2)))
        return m.group(1) + t + m.group(3) if t else m.group(0)
    line = re.sub(r'(\brouteReady\(\s*root\s*,\s*)' + DQ + r'(\s*,)', r, line)
    return re.sub(r'((?:\bu|HtlcUI\._ui|PoolUI\._ui)\.routeReady\(\s*root\s*,\s*)' + DQ + r'(\s*,)', r, line)


def split_args(rest):
    args, depth, cur = [], 0, ""
    in_str, esc = False, False
    i = 0
    while i < len(rest):
        ch = rest[i]
        if in_str:
            cur += ch
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            i += 1
            continue
        if ch == '"':
            in_str = True
            cur += ch
        elif ch in "([":
            depth += 1
            cur += ch
        elif ch in ")]":
            if depth == 0 and ch == ")":
                args.append(cur)
                return args, rest[i:]
            depth -= 1
            cur += ch
        elif ch == "," and depth == 0:
            args.append(cur)
            cur = ""
        else:
            cur += ch
        i += 1
    args.append(cur)
    return args, ""


def is_lit(t):
    t = t.strip()
    m = re.match(r'^"((?:\\.|[^"\\])*)"$', t)
    return unescape(m.group(1)) if m else None


def p_panel(line, ctx):
    """showError/showStatus/offlineBox/unlockBox/routeFail/err literal args."""
    m = re.search(r'\b(?:\bu\.|HtlcUI\._ui\.|PoolUI\._ui\.)?(showError|showStatus|offlineBox|unlockBox|routeFail|err)\(', line)
    if not m:
        return line
    args, suffix = split_args(line[m.end():])
    pre = line[:m.end()]
    kind = m.group(1)
    if kind in ("showStatus", "offlineBox", "unlockBox"):
        if len(args) >= 3:
            lit = is_lit(args[2])
            if lit is not None and ctx.sent(lit):
                t = ctx.wrap(lit)
                if t:
                    return pre + args[0] + "," + args[1] + "," + t + suffix
        return line
    if kind == "routeFail":
        if len(args) >= 4:
            lit = is_lit(args[3])
            if lit is not None and ctx.sent(lit):
                t = ctx.wrap(lit)
                if t:
                    return pre + args[0] + "," + args[1] + "," + args[2] + "," + t + suffix
        return line
    # showError / err: (doc, box, e, fallback)
    if len(args) < 4:
        # 3-arg err(d, w, "literal") form (asset files)
        if len(args) == 3:
            lit = is_lit(args[2])
            if lit is not None and ctx.sent(lit):
                t = ctx.wrap(lit)
                if t:
                    return pre + args[0] + "," + args[1] + "," + t + suffix
        return line
    third = args[2].strip()
    lit4 = is_lit(args[3])
    if third.startswith("new Error"):
        if lit4 is not None and ctx.sent(lit4):
            t = ctx.wrap(lit4)
            if t:
                return pre + args[0] + "," + args[1] + "," + third + "," + t + suffix
        return line
    lit3 = is_lit(third)
    if lit3 is not None:
        return line  # (code-string, ...) stays
    if lit4 is not None and ctx.sent(lit4):
        t = ctx.wrap(lit4)
        if t:
            return pre + args[0] + "," + args[1] + "," + third + "," + t + suffix
    return line


def p_or_fallback(line, ctx):
    def r(m):
        lit = unescape(m.group(1))
        if lit == "none":
            t = ctx.wrap(lit)
            return "|| " + t if t else m.group(0)
        if not ctx.sent(lit):
            return m.group(0)
        t = ctx.wrap(lit)
        return "|| " + t if t else m.group(0)
    return re.sub(r'\|\|\s*' + DQ, r, line)


def p_review(line, ctx):
    def r(m):
        t = ctx.wrap(unescape(m.group(2)))
        return m.group(1) + t + m.group(3) if t else m.group(0)
    return re.sub(r'((?:\bu\.|HtlcUI\._ui\.|PoolUI\._ui\.)?reviewSection\(\s*doc\s*,\s*[A-Za-z0-9_.]+\s*,\s*(?:myGen|uiGen|htlcGen)\s*,\s*)' + DQ + r'(\s*,)', r, line)


def p_kv(line, ctx):
    def r(m):
        t = ctx.wrap(unescape(m.group(2)))
        return m.group(1) + t if t else m.group(0)
    return re.sub(r'(\b(?:title|fail|okText)\s*:\s*)' + DQ + r'(?=\s*[,}])', r, line)


def p_okret(line, ctx):
    m = re.match(r'^(\s*)ok\s*:\s*function\s*\([^)]*\)\s*\{\s*return\s*' + DQ + r'\s*;\s*\}?\s*,?\s*$', line)
    if m:
        lit = unescape(re.search(DQ, line).group(1))
        if ctx.sent(lit):
            t = ctx.wrap(lit)
            if t:
                return line.replace('"' + re.search(DQ, line).group(1) + '"', t)
        return line
    m = re.match(r'^(\s*)return\s*' + DQ + r'\s*;\s*$', line)
    if m:
        lit = unescape(re.search(DQ, line).group(1))
        if (re.match(r"[A-Z]", lit) and ctx.ok(lit)
                and not re.search(r"[#:./]{2}|wss|1\.[0-9]", lit)):
            t = ctx.wrap(lit)
            if t:
                return line.replace('"' + re.search(DQ, line).group(1) + '"', t)
    return line


def p_throw(line, ctx):
    def r(m):
        lit = unescape(m.group(2))
        if not ctx.sent(lit):
            return m.group(0)
        t = ctx.wrap(lit)
        return m.group(1) + t + m.group(3) if t else m.group(0)
    return re.sub(r'(\bthrow\s+new\s+Error\(\s*)' + DQ + r'(\s*\))', r, line)


def p_msgassign(line, ctx):
    def r(m):
        lit = unescape(m.group(2))
        if not ctx.sent(lit):
            return m.group(0)
        t = ctx.wrap(lit)
        return m.group(1) + t + m.group(3) if t else m.group(0)
    line = re.sub(r'(\b(?:m|msg)\s*=\s*(?:fallback\s*\|\|\s*)?)' + DQ + r'(\s*;)', r, line)
    def r2(m):
        lit = unescape(m.group(2))
        if not ctx.sent(lit):
            return m.group(0)
        t = ctx.wrap(lit)
        return m.group(1) + t + m.group(3) if t else m.group(0)
    return re.sub(r'(\bpreview\.textContent\s*=\s*)' + DQ + r'(\s*;)', r2, line)


def p_rowfirst(line, ctx):
    """["Label", ...] confirm-row first elements (capitalized words only)."""
    def r(m):
        lit = unescape(m.group(1))
        if not re.match(r"[A-Z]", lit) or not ctx.ok(lit):
            return m.group(0)
        t = ctx.wrap(lit)
        return m.group(0)[:m.group(0).index('"' + m.group(1) + '"')] + t + ", " if t else m.group(0)
    return re.sub(r'\[\s*' + DQ + r'\s*,', r, line)


def p_headers(line, ctx):
    """tableHead(doc, ["H1", ...]) spans: wrap every lettered literal."""
    m = re.search(r'tableHead\(\s*doc\s*,\s*\[(.*?)\]', line)
    if not m or 't("' in line:
        return line
    span = m.group(1)
    if re.search(r"[()]", span):
        return line

    def h(mm):
        lit = unescape(mm.group(1))
        if not ctx.ok(lit):
            return mm.group(0)
        t = ctx.wrap(lit)
        return t if t else mm.group(0)
    return line[:m.start(1)] + re.sub(DQ, h, span) + line[m.end(1):]


def p_pairs(line, ctx):
    """[["Label", "#/href"]] nav/tile pairs: A iff capitalized word; B iff
    language under empty/href A. Tile triples handled by the same shape."""
    if 't("' in line or "globalThis" in line or "need" in line and "miss" in line:
        return line
    s = line.strip()
    if not s or s.startswith("//") or s.startswith("/*") or s.startswith("*") or "console." in s:
        return line

    def r2(m):
        a, b = unescape(m.group(1)), unescape(m.group(2))
        pfx = m.group(0)[:m.group(0).index('"' + m.group(1) + '"')]
        new_a = None
        if re.match(r"[A-Z]", a) and ctx.ok(a):
            t = ctx.wrap(a)
            new_a = t if t else None
        new_b = None
        if has_letter(b) and b not in TOKEN_SKIP and not ctx.codey(b):
            a_ref = (a == "" or a.startswith("#/") or re.match(r"^[\d.]+$", a))
            if " " in b or a_ref:
                t = ctx.wrap(b)
                new_b = t if t else None
        A = new_a if new_a is not None else '"%s"' % escape(a)
        B = new_b if new_b is not None else '"%s"' % escape(b)
        return pfx + A + ", " + B
    return re.sub(r'\[\s*\[?"((?:\\.|[^"\\])*)",\s*"((?:\\.|[^"\\])*)"', r2, line)


def p_option(line, ctx):
    """o.textContent = "Full words" / customOpt / selectOpts pairs."""
    def r(m):
        lit = unescape(m.group(2))
        if not ctx.sent(lit) and not (re.match(r"[A-Z]", lit) and ctx.ok(lit) and " " not in lit and len(lit) > 2):
            return m.group(0)
        if not ctx.ok(lit):
            return m.group(0)
        t = ctx.wrap(lit)
        return m.group(1) + t if t else m.group(0)
    line = re.sub(r'((?:customOpt|oA|oB|wKeep|wZero|o)\.(?:textContent)\s*=\s*)' + DQ, r, line)
    # selectOpts pairs: [["sha256", "sha256"], ...] display B under token A
    def r3(m):
        a, b = unescape(m.group(1)), unescape(m.group(2))
        if b in ("sha256", "ripemd160"):
            return m.group(0)
        return m.group(0)
    return line


def p_prefix_suffix(line, ctx):
    """Word-bearing glue segments adjacent to + (batch-2c precedent):
    t("..prefix..", "Words: ") / t("..suffix..", " words.") — pure
    punctuation/number glue stays raw."""
    # el(doc, "h1", "Pool " + x) / ("Update " + x) / "HTLC " + ...
    def r(m):
        lit = unescape(m.group(1))
        if not ctx.ok(lit) or " " not in lit.strip():
            return m.group(0)
        t = ctx.wrap(lit)
        return m.group(0).replace('"' + m.group(1) + '"', t) if t else m.group(0)
    return line


def convert_lines(fname, src, ctx):
    out = []
    for line in src.split("\n"):
        s = line.strip()
        if (not s or s.startswith("//") or s.startswith("/*")
                or s.startswith("*") or "console." in s
                or s.startswith('"use strict"') or s.startswith("'use strict'")):
            out.append(line)
            continue
        line = p_attr(line, ctx)
        line = p_placeholder(line, ctx)
        line = p_el(line, ctx)
        line = p_textcontent(line, ctx)
        line = p_field(line, ctx)
        line = p_routeready(line, ctx)
        line = p_panel(line, ctx)
        line = p_or_fallback(line, ctx)
        line = p_review(line, ctx)
        line = p_kv(line, ctx)
        line = p_okret(line, ctx)
        line = p_throw(line, ctx)
        line = p_msgassign(line, ctx)
        line = p_rowfirst(line, ctx)
        line = p_headers(line, ctx)
        line = p_pairs(line, ctx)
        line = p_option(line, ctx)
        out.append(line)
    return "\n".join(out)


def inject_helper(src):
    if "\n  function t(key, dflt) {" in src:
        return src
    marker = '  "use strict";\n'
    assert marker in src, "no use-strict marker"
    return src.replace(marker, marker + HELPER, 1)


def apply_renames(fname, src):
    n = 0
    if fname == "asset-ui.js":
        src, c = re.subn(r"var t = el\(d, \"strong\"", 'var nm = el(d, "strong"', src)
        n += c
        src = src.replace("t.title = r.id; card.appendChild(t);",
                          "nm.title = r.id; card.appendChild(nm);")
        n += 1
        src, c = re.subn(r"if \(nft\) \{ var t = nt\.input", "if (nft) { var ntT = nt.input", src)
        n += c
        src = src.replace("if (!t && !u) throw", "if (!ntT && !u) throw")
        n += 1
        src = src.replace("nftObj = { title: t || symbol,", "nftObj = { title: ntT || symbol,")
        n += 1
    elif fname == "asset-manage-ui.js":
        src, c = re.subn(r"var t = isReserve \? null : field\(", "var toF = isReserve ? null : field(", src)
        n += c
        src = src.replace("v.appendChild(s.row); if (t) v.appendChild(t.row);",
                          "v.appendChild(s.row); if (toF) v.appendChild(toF.row);")
        n += 1
        src = src.replace("var to = isReserve ? null : await Account.resolve(t.input.value.trim());",
                          "var to = isReserve ? null : await Account.resolve(toF.input.value.trim());")
        n += 1
    elif fname == "asset-feed-ui.js":
        src, c = re.subn(r"var t;\n", "var txt;\n", src)
        n += c
        src = src.replace("try { t = \"MCR", "try { txt = \"MCR")
        n += 1
        src = src.replace("catch (e) { t = \"MCR/MSSR", "catch (e) { txt = \"MCR/MSSR")
        n += 1
        src = src.replace("prev.textContent = t;", "prev.textContent = txt;")
        n += 1
    return src, n


def main():
    apply = "--apply" in sys.argv
    srcs = {f: open(os.path.join(VANILLA, f), encoding="utf-8").read() for f in FILES}
    codes = message_codes(srcs.values())
    keyer = Keyer()
    ctxs = {f: Ctx(NS_OF[f], keyer, codes) for f in FILES}
    outs = {}
    for f in FILES:
        if "\n  function t(key, dflt) {" in srcs[f]:
            print("%-20s already converted, skipping" % f)
            outs[f] = srcs[f]
            continue
        s, _ = apply_renames(f, srcs[f])
        s = convert_lines(f, s, ctxs[f])
        s = inject_helper(s)
        outs[f] = s
    if apply:
        for f in FILES:
            open(os.path.join(VANILLA, f), "w", encoding="utf-8").write(outs[f])
        frag = {ns: dict(sorted(sec.items())) for ns, sec in sorted(keyer.frag.items())}
        with open(FRAG, "w", encoding="utf-8") as fh:
            json.dump(frag, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        with open(LEDGER, "w", encoding="utf-8") as fh:
            json.dump(keyer.ledger, fh, ensure_ascii=False, indent=2)
        total = sum(len(v) for v in frag.values())
        print("fragment new keys: %d across %d sections -> %s" % (total, len(frag), FRAG))
    for f in FILES:
        n0 = len(re.findall(r"\bt\(\s*\"", srcs[f]))
        n1 = len(re.findall(r"\bt\(\s*\"", outs[f]))
        print("%-20s t() %3d -> %3d" % (f, n0, n1))
    print("---- unmapped literals needing KEYMAP keys ----")
    seen = set()
    for f in FILES:
        for lit in ctxs[f].unmapped:
            if (ctxs[f].ns, lit) not in seen:
                seen.add((ctxs[f].ns, lit))
                print("  [%s] %r" % (ctxs[f].ns, lit[:100]))


if __name__ == "__main__":
    main()
