#!/usr/bin/env python3
"""i18n batch-3: key rounds 2-3 + lows-sweep plain literals (director task).

Converts user-visible plain-English literals added since c472d59 (i18n
batch-2) in 23 view files to t("ns.key", "byte-verbatim default") per the
slice-17 precedent. Dynamic concats keep code structure: only static
segments are wrapped. No rewording: every default is copied byte-verbatim
from HEAD. Amounts, dates, chain ids, hrefs, classes, placeholders that are
token-valued (1.3.0), and punctuation-only glue stay raw.

New keys accumulate in vanilla/locales/frag-batch3.json (nested sections);
merge via: python3 tooling/merge_i18n_frags.py batch3
(en.json + other dicts NOT touched here).

Reuse: where the byte-verbatim default already exists under the file's
namespace (auth.register..., prediction.hdr_asset, explorer.head_prefix,
explorer.next, proposal.none) the existing key is referenced and NO frag
entry is emitted.

Usage: python3 tooling/apply_i18n_batch3.py [--apply]
  Default: dry run (asserts counts, prints per-file t() delta, frag size).
  --apply: rewrites files + writes frag-batch3.json.
"""
import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
JS = os.path.join(HERE, "..", "vanilla", "js")
FRAG = os.path.join(HERE, "..", "vanilla", "locales", "frag-batch3.json")
EN = os.path.join(HERE, "..", "vanilla", "locales", "en.json")

R = []  # (file, old, new, count, [(ns, key, default)])


def rep(fname, old, new, count=1, keys=()):
    R.append((fname, old, new, count, list(keys)))


def K(ns, key, val):
    return (ns, key, val)


# ================================================================ wallet-ui.js
rep("wallet-ui.js",
    '    ways.appendChild(doc.createTextNode("Ways in: "));',
    '    ways.appendChild(doc.createTextNode(t("wallet.ways_in", "Ways in: ")));',
    1, [K("wallet", "ways_in", "Ways in: ")])
rep("wallet-ui.js",
    '      ["#/create-wallet-brainkey", "Create new wallet instead"],\n      ["#/wallet", "Wallet manager"]',
    '      ["#/create-wallet-brainkey", t("wallet.create_new_wallet_instead", "Create new wallet instead")],\n      ["#/wallet", t("wallet.wallet_manager", "Wallet manager")]',
    1, [K("wallet", "create_new_wallet_instead", "Create new wallet instead"),
        K("wallet", "wallet_manager", "Wallet manager")])
rep("wallet-ui.js",
    '    self.textContent = " \u00b7 Brainkey import (this page\'s form below)";',
    '    self.textContent = t("wallet.brainkey_import_this_page_form_below", " \u00b7 Brainkey import (this page\'s form below)");',
    1, [K("wallet", "brainkey_import_this_page_form_below", " \u00b7 Brainkey import (this page's form below)")])
rep("wallet-ui.js",
    '    honesty.textContent = "Have a .bin backup file or bare private keys " +\n      "instead? This wallet imports brainkeys only \u2014 .bin decrypt and WIF " +\n      "import are not supported. Nothing is uploaded anywhere.";',
    '    honesty.textContent = t("wallet.have_a_bin_backup_file_or_bare_private_k", "Have a .bin backup file or bare private keys instead? This wallet imports brainkeys only \u2014 .bin decrypt and WIF import are not supported. Nothing is uploaded anywhere.");',
    1, [K("wallet", "have_a_bin_backup_file_or_bare_private_k", "Have a .bin backup file or bare private keys instead? This wallet imports brainkeys only \u2014 .bin decrypt and WIF import are not supported. Nothing is uploaded anywhere.")])
rep("wallet-ui.js",
    '      have.appendChild(doc.createTextNode("A wallet already exists on this device. "));',
    '      have.appendChild(doc.createTextNode(t("wallet.a_wallet_already_exists_on_this_device_2", "A wallet already exists on this device. ")));',
    1, [K("wallet", "a_wallet_already_exists_on_this_device_2", "A wallet already exists on this device. ")])
rep("wallet-ui.js",
    '      claim.textContent = "Claim vesting balances";',
    '      claim.textContent = t("wallet.claim_vesting_balances", "Claim vesting balances");',
    1, [K("wallet", "claim_vesting_balances", "Claim vesting balances")])
rep("wallet-ui.js",
    '      dash.textContent = "Open the dashboard";',
    '      dash.textContent = t("wallet.open_the_dashboard", "Open the dashboard");',
    1, [K("wallet", "open_the_dashboard", "Open the dashboard")])
rep("wallet-ui.js",
    ' *   ZERO new t() keys: every new string in existingOptions is a plain\n *   literal for the next i18n batch (locales untouched):',
    ' *   Batch-3 i18n: the new strings in existingOptions are keyed via t()\n *   (were plain literals for the next i18n batch):',
    1, [])

# ================================================================== auth-ui.js
rep("auth-ui.js",
    '      { hint: "Best security \u2014 stays in this browser. Move it with the brainkey backup." });',
    '      { hint: t("auth.best_security_stays_in_this_browser_move", "Best security \u2014 stays in this browser. Move it with the brainkey backup.") });',
    1, [K("auth", "best_security_stays_in_this_browser_move", "Best security \u2014 stays in this browser. Move it with the brainkey backup.")])
rep("auth-ui.js",
    '      { hint: "No login from anywhere with name + password here \u2014 find the name below, then unlock the local wallet above." });',
    '      { hint: t("auth.no_login_from_anywhere_with_name_password", "No login from anywhere with name + password here \u2014 find the name below, then unlock the local wallet above.") });',
    1, [K("auth", "no_login_from_anywhere_with_name_password", "No login from anywhere with name + password here \u2014 find the name below, then unlock the local wallet above.")])
rep("auth-ui.js",
    '    local.appendChild(el(doc, "h2", "Local wallet \u2014 keys on this device"));',
    '    local.appendChild(el(doc, "h2", t("auth.local_wallet_keys_on_this_device", "Local wallet \u2014 keys on this device")));',
    1, [K("auth", "local_wallet_keys_on_this_device", "Local wallet \u2014 keys on this device")])
rep("auth-ui.js",
    '    star.textContent = "Recommended";',
    '    star.textContent = t("auth.recommended", "Recommended");',
    1, [K("auth", "recommended", "Recommended")])
rep("auth-ui.js",
    '    ["Security: High",\n     "Login by: password on this device",\n     "Back up: yes \u2014 write down the brainkey"].forEach(function (line) {',
    '    [t("auth.security_high", "Security: High"),\n     t("auth.login_by_password_on_this_device", "Login by: password on this device"),\n     t("auth.back_up_yes_write_down_the_brainkey", "Back up: yes \u2014 write down the brainkey")].forEach(function (line) {',
    1, [K("auth", "security_high", "Security: High"),
        K("auth", "login_by_password_on_this_device", "Login by: password on this device"),
        K("auth", "back_up_yes_write_down_the_brainkey", "Back up: yes \u2014 write down the brainkey")])
rep("auth-ui.js",
    '    local.appendChild(goButton(doc, "reg-card-local", "Continue", "#/registration/local"));',
    '    local.appendChild(goButton(doc, "reg-card-local", t("auth.continue", "Continue"), "#/registration/local"));',
    1, [K("auth", "continue", "Continue")])
rep("auth-ui.js",
    '    cloud.appendChild(el(doc, "h2", "Cloud-style account \u2014 name via the faucet"));',
    '    cloud.appendChild(el(doc, "h2", t("auth.cloud_style_account_name_via_the_faucet", "Cloud-style account \u2014 name via the faucet")));',
    1, [K("auth", "cloud_style_account_name_via_the_faucet", "Cloud-style account \u2014 name via the faucet")])
rep("auth-ui.js",
    '    ["Security: Medium",\n     "Login by: account-name lookup (password-derived keys are not supported here)",\n     "Back up: no file \u2014 the new account\'s brainkey is shown once at creation"].forEach(function (line) {',
    '    [t("auth.security_medium", "Security: Medium"),\n     t("auth.login_by_account_name_lookup_password_der", "Login by: account-name lookup (password-derived keys are not supported here)"),\n     t("auth.back_up_no_file_the_new_account_s_brainke", "Back up: no file \u2014 the new account\'s brainkey is shown once at creation")].forEach(function (line) {',
    1, [K("auth", "security_medium", "Security: Medium"),
        K("auth", "login_by_account_name_lookup_password_der", "Login by: account-name lookup (password-derived keys are not supported here)"),
        K("auth", "back_up_no_file_the_new_account_s_brainke", "Back up: no file \u2014 the new account's brainkey is shown once at creation")])
rep("auth-ui.js",
    '    cloud.appendChild(goButton(doc, "reg-card-cloud", "Continue", "#/registration/cloud"));',
    '    cloud.appendChild(goButton(doc, "reg-card-cloud", t("auth.continue", "Continue"), "#/registration/cloud"));',
    1, [])
rep("auth-ui.js",
    '    [["#/create-account", "Register a new on-chain account (testnet faucet)"],\n     ["#/existing-account", "Import an existing account (brainkey)"]].forEach(function (pr) {',
    '    [["#/create-account", t("auth.register_a_new_on_chain_account_testnet_fauce", "Register a new on-chain account (testnet faucet)")],\n     ["#/existing-account", t("auth.import_an_existing_account_brainkey", "Import an existing account (brainkey)")]].forEach(function (pr) {',
    1, [])
rep("auth-ui.js",
    '      ["#/existing-account", "Already have an account? Import it instead of registering."]',
    '      ["#/existing-account", t("auth.already_have_an_account_import_it_instead", "Already have an account? Import it instead of registering.")]',
    1, [K("auth", "already_have_an_account_import_it_instead", "Already have an account? Import it instead of registering.")])
rep("auth-ui.js",
    ' *   ZERO new t() keys (locales untouched so parallel rounds don\'t\n *   conflict) \u2014 every new string below is a plain literal for the next\n *   i18n batch:',
    ' *   Batch-3 i18n: the new strings below are keyed via t() (were plain\n *   literals for the next i18n batch):',
    1, [])
rep("auth-ui.js",
    '     * import page, not the faucet. Plain literal for the next i18n batch. */',
    '     * import page, not the faucet. Batch-3 i18n: keyed via t(). */',
    1, [])

# ============================================================== proposal-ui.js
rep("proposal-ui.js",
    ' *   scamAccounts + on-chain blacklist check), per-approver approval status\n *   (:399-404 NestedApprovalState concept, flat approved/pending per required\n *   approver from proposal object fields \u2014 no threshold tree), raw-JSON\n *   <details> per proposal (:313-328 JSONModal concept; market-desk.js\n *   rawDetails is module-private, so the minimal inline <details> lives here).\n *   ZERO new t() keys: every new word below is a plain literal.',
    ' *   scamAccounts + on-chain blacklist check), per-approver approval status\n *   (:399-404 NestedApprovalState concept, flat approved/pending per required\n *   approver from proposal object fields \u2014 no threshold tree), raw-JSON\n *   <details> per proposal (:313-328 JSONModal concept; market-desk.js\n *   rawDetails is module-private, so the minimal inline <details> lives here).\n *   Batch-3 i18n: the new words below are keyed via t().',
    1, [])
rep("proposal-ui.js",
    '    var DEFERRED = "No scam registry is vendored in vanilla \u2014 this is an unverified-source flag, not a scam verdict (deferred: vendor scamAccounts lists + on-chain blacklist check).";',
    '    var DEFERRED = t("proposal.no_scam_registry_is_vendored_in_vanilla", "No scam registry is vendored in vanilla \u2014 this is an unverified-source flag, not a scam verdict (deferred: vendor scamAccounts lists + on-chain blacklist check).");',
    1, [K("proposal", "no_scam_registry_is_vendored_in_vanilla", "No scam registry is vendored in vanilla \u2014 this is an unverified-source flag, not a scam verdict (deferred: vendor scamAccounts lists + on-chain blacklist check).")])
rep("proposal-ui.js",
    '          try { if (hook(touched[i])) return { label: "SCAM ATTEMPT", title: "Flagged by the local scam registry as a known scammer." }; }',
    '          try { if (hook(touched[i])) return { label: t("proposal.scam_attempt", "SCAM ATTEMPT"), title: t("proposal.flagged_by_the_local_scam_registry_as_a", "Flagged by the local scam registry as a known scammer.") }; }',
    1, [K("proposal", "scam_attempt", "SCAM ATTEMPT"),
        K("proposal", "flagged_by_the_local_scam_registry_as_a", "Flagged by the local scam registry as a known scammer.")])
rep("proposal-ui.js",
    '    if (!touched || !touched.length) return { label: "unverified", title: "Empty proposal \u2014 no touched accounts to check. " + DEFERRED };',
    '    if (!touched || !touched.length) return { label: t("proposal.unverified", "unverified"), title: t("proposal.empty_proposal_no_touched_accounts_to_", "Empty proposal \u2014 no touched accounts to check. ") + DEFERRED };',
    1, [K("proposal", "unverified", "unverified"),
        K("proposal", "empty_proposal_no_touched_accounts_to_", "Empty proposal \u2014 no touched accounts to check. ")])
rep("proposal-ui.js",
    '      if (trust.ids[id] || trust.names[String(id).toLowerCase()]) return { label: "trusted", title: "A touched account is in your local contacts or favourite accounts." };',
    '      if (trust.ids[id] || trust.names[String(id).toLowerCase()]) return { label: t("proposal.trusted", "trusted"), title: t("proposal.a_touched_account_is_in_your_local_cont", "A touched account is in your local contacts or favourite accounts.") };',
    1, [K("proposal", "trusted", "trusted"),
        K("proposal", "a_touched_account_is_in_your_local_cont", "A touched account is in your local contacts or favourite accounts.")])
rep("proposal-ui.js",
    '    return { label: "UNKNOWN SOURCE", title: "No touched account is in your local contacts or favourite accounts. " + DEFERRED };',
    '    return { label: t("proposal.unknown_source", "UNKNOWN SOURCE"), title: t("proposal.no_touched_account_is_in_your_local_con", "No touched account is in your local contacts or favourite accounts. ") + DEFERRED };',
    1, [K("proposal", "unknown_source", "UNKNOWN SOURCE"),
        K("proposal", "no_touched_account_is_in_your_local_con", "No touched account is in your local contacts or favourite accounts. ")])
rep("proposal-ui.js",
    '      lines.push(String(id) + " (active): " + (approved ? "approved" : "pending"));',
    '      lines.push(String(id) + t("proposal.active_suffix", " (active): ") + (approved ? t("proposal.approved", "approved") : t("proposal.pending", "pending")));',
    1, [K("proposal", "active_suffix", " (active): "),
        K("proposal", "approved", "approved"),
        K("proposal", "pending", "pending")])
rep("proposal-ui.js",
    '      lines.push(String(id) + " (owner): " + (approved2 ? "approved" : "pending"));',
    '      lines.push(String(id) + t("proposal.owner_suffix", " (owner): ") + (approved2 ? t("proposal.approved", "approved") : t("proposal.pending", "pending")));',
    1, [K("proposal", "owner_suffix", " (owner): ")])
rep("proposal-ui.js",
    '    if (!lines.length) lines.push("none required");\n    lines.push("key approvals: " + (avK.length ? avK.join(", ") : "none"));',
    '    if (!lines.length) lines.push(t("proposal.none_required", "none required"));\n    lines.push(t("proposal.key_approvals_prefix", "key approvals: ") + (avK.length ? avK.join(", ") : t("proposal.none", "none")));',
    1, [K("proposal", "none_required", "none required"),
        K("proposal", "key_approvals_prefix", "key approvals: ")])
rep("proposal-ui.js",
    '  /* One-line approval summary for table cells. Plain literals only. */\n  function approvalCell(p) {\n    if (!p) return "n/a";\n    var s = approvalLines(p);\n    if (!s.req) return "none required";\n    return s.req + " required \u00b7 " + s.ok + " approved";',
    '  /* One-line approval summary for table cells. Batch-3 i18n: keyed. */\n  function approvalCell(p) {\n    if (!p) return t("proposal.n_a", "n/a");\n    var s = approvalLines(p);\n    if (!s.req) return t("proposal.none_required", "none required");\n    return s.req + t("proposal.required_mid", " required \u00b7 ") + s.ok + t("proposal.approved_suffix", " approved");',
    1, [K("proposal", "n_a", "n/a"),
        K("proposal", "required_mid", " required \u00b7 "),
        K("proposal", "approved_suffix", " approved")])
rep("proposal-ui.js",
    '   * lives here per the punchlist. textContent only \u2014 chain strings never\n   * reach HTML. Plain-literal label, touch-sized summary. */',
    '   * lives here per the punchlist. textContent only \u2014 chain strings never\n   * reach HTML. Batch-3 i18n: label keyed, touch-sized summary. */',
    1, [])
rep("proposal-ui.js",
    '          listBox.appendChild(deskTable(doc, [t("proposal.id", "ID"), t("proposal.fee_payer", "Fee payer"), t("proposal.expires", "Expires"), t("proposal.review", "Review"), t("proposal.enclosed", "Enclosed"), "Trust", "Approvals"], enriched.map(function (en) {',
    '          listBox.appendChild(deskTable(doc, [t("proposal.id", "ID"), t("proposal.fee_payer", "Fee payer"), t("proposal.expires", "Expires"), t("proposal.review", "Review"), t("proposal.enclosed", "Enclosed"), t("proposal.trust", "Trust"), t("proposal.approvals", "Approvals")], enriched.map(function (en) {',
    1, [K("proposal", "trust", "Trust"),
        K("proposal", "approvals", "Approvals")])
rep("proposal-ui.js",
    '              cardLines: [r.id + " \u00b7 payer " + r.fee_paying_account, "Expires " + timeHuman(r.expiration_time),\n                ((entries.length || r.proposed_ops_count) || 0) + " enclosed op(s), first: " + first,\n                "Source: " + badge.label, "Approvals: " + ap] };',
    '              cardLines: [r.id + t("proposal.payer_mid", " \u00b7 payer ") + r.fee_paying_account, t("proposal.expires_prefix", "Expires ") + timeHuman(r.expiration_time),\n                ((entries.length || r.proposed_ops_count) || 0) + t("proposal.enclosed_ops_mid", " enclosed op(s), first: ") + first,\n                t("proposal.source_prefix", "Source: ") + badge.label, t("proposal.approvals_prefix", "Approvals: ") + ap] };',
    1, [K("proposal", "payer_mid", " \u00b7 payer "),
        K("proposal", "expires_prefix", "Expires "),
        K("proposal", "enclosed_ops_mid", " enclosed op(s), first: "),
        K("proposal", "source_prefix", "Source: "),
        K("proposal", "approvals_prefix", "Approvals: ")])
rep("proposal-ui.js",
    '          rawBox.appendChild(el(doc, "h3", "Raw JSON"));',
    '          rawBox.appendChild(el(doc, "h3", t("proposal.raw_json", "Raw JSON")));',
    1, [K("proposal", "raw_json", "Raw JSON")])
rep("proposal-ui.js",
    '            rawBox.appendChild(rawJson(doc, "Raw proposal " + en.slim.id,',
    '            rawBox.appendChild(rawJson(doc, t("proposal.raw_proposal_prefix", "Raw proposal ") + en.slim.id,',
    1, [K("proposal", "raw_proposal_prefix", "Raw proposal ")])
rep("proposal-ui.js",
    '      /* MED badges + per-approver status + raw JSON (literals only). */',
    '      /* MED badges + per-approver status + raw JSON (batch-3 keyed). */',
    1, [])
rep("proposal-ui.js",
    '      var srcLine = el(doc, "p", "Source: " + badge.label + " \u2014 " + badge.title, "muted");',
    '      var srcLine = el(doc, "p", t("proposal.source_prefix", "Source: ") + badge.label + " \u2014 " + badge.title, "muted");',
    1, [])
rep("proposal-ui.js",
    '      ctx.wrap.appendChild(el(doc, "h2", "Approver status"));',
    '      ctx.wrap.appendChild(el(doc, "h2", t("proposal.approver_status", "Approver status")));',
    1, [K("proposal", "approver_status", "Approver status")])
rep("proposal-ui.js",
    '      ctx.wrap.appendChild(rawJson(doc, "Raw proposal JSON", p));',
    '      ctx.wrap.appendChild(rawJson(doc, t("proposal.raw_proposal_json", "Raw proposal JSON"), p));',
    1, [K("proposal", "raw_proposal_json", "Raw proposal JSON")])

# ================================================================ barter-ui.js
rep("barter-ui.js",
    '   * broadcast. Plain literals below (zero new t() keys). */',
    '   * broadcast. Batch-3 i18n: literals below keyed via t(). */',
    1, [])
rep("barter-ui.js",
    '    var escrowBtn = touchable(el(doc, "button", "Add escrow")); escrowBtn.type = "button";',
    '    var escrowBtn = touchable(el(doc, "button", t("barter.add_escrow", "Add escrow"))); escrowBtn.type = "button";',
    1, [K("barter", "add_escrow", "Add escrow")])
rep("barter-ui.js",
    '      escrowBtn.textContent = escState.on ? "Remove escrow" : "Add escrow";',
    '      escrowBtn.textContent = escState.on ? t("barter.remove_escrow", "Remove escrow") : t("barter.add_escrow", "Add escrow");',
    1, [K("barter", "remove_escrow", "Remove escrow")])
rep("barter-ui.js",
    '   * proposal fee + total): plain-literal inputs (zero new t() keys); every',
    '   * proposal fee + total): batch-3-keyed inputs; every',
    1, [])
rep("barter-ui.js",
    '    var fFeeA = field(doc, "Side A fee asset (1.3.x)", { placeholder: "1.3.0", value: "1.3.0" });',
    '    var fFeeA = field(doc, t("barter.side_a_fee_asset_1_3_x", "Side A fee asset (1.3.x)"), { placeholder: "1.3.0", value: "1.3.0" });',
    1, [K("barter", "side_a_fee_asset_1_3_x", "Side A fee asset (1.3.x)")])
rep("barter-ui.js",
    '    var fFeeB = field(doc, "Side B fee asset (1.3.x)", { placeholder: "1.3.0", value: "1.3.0" });',
    '    var fFeeB = field(doc, t("barter.side_b_fee_asset_1_3_x", "Side B fee asset (1.3.x)"), { placeholder: "1.3.0", value: "1.3.0" });',
    1, [K("barter", "side_b_fee_asset_1_3_x", "Side B fee asset (1.3.x)")])
rep("barter-ui.js",
    '    var fPropFee = field(doc, "Proposal fee asset (1.3.x, due now)", { placeholder: "1.3.0", value: "1.3.0" });',
    '    var fPropFee = field(doc, t("barter.proposal_fee_asset_1_3_x_due_now", "Proposal fee asset (1.3.x, due now)"), { placeholder: "1.3.0", value: "1.3.0" });',
    1, [K("barter", "proposal_fee_asset_1_3_x_due_now", "Proposal fee asset (1.3.x, due now)")])
rep("barter-ui.js",
    '    /* MED fee recap (plain literals, zero new t() keys): timing + assets +',
    '    /* MED fee recap (batch-3 keyed): timing + assets +',
    1, [])
rep("barter-ui.js",
    '    out.appendChild(el(doc, "p", "Side A fee asset: " + (prev.feeAId || "1.3.0") +\n      "; Side B fee asset: " + (prev.feeBId || "1.3.0") +\n      "; proposal fee asset: " + (prev.propFeeId || "1.3.0") + " (due now).", "muted"));',
    '    out.appendChild(el(doc, "p", t("barter.side_a_fee_asset_prefix", "Side A fee asset: ") + (prev.feeAId || "1.3.0") +\n      t("barter.side_b_fee_asset_mid", "; Side B fee asset: ") + (prev.feeBId || "1.3.0") +\n      t("barter.proposal_fee_asset_mid", "; proposal fee asset: ") + (prev.propFeeId || "1.3.0") + t("barter.due_now_suffix", " (due now)."), "muted"));',
    1, [K("barter", "side_a_fee_asset_prefix", "Side A fee asset: "),
        K("barter", "side_b_fee_asset_mid", "; Side B fee asset: "),
        K("barter", "proposal_fee_asset_mid", "; proposal fee asset: "),
        K("barter", "due_now_suffix", " (due now).")])
rep("barter-ui.js",
    '    if (prev.propHuman) out.appendChild(el(doc, "p", "Proposal fee estimate: " + prev.propHuman, "muted"));',
    '    if (prev.propHuman) out.appendChild(el(doc, "p", t("barter.proposal_fee_estimate_prefix", "Proposal fee estimate: ") + prev.propHuman, "muted"));',
    1, [K("barter", "proposal_fee_estimate_prefix", "Proposal fee estimate: ")])
rep("barter-ui.js",
    '    if (prev.totalText) out.appendChild(el(doc, "p", "Total fees: " + prev.totalText, "muted"));',
    '    if (prev.totalText) out.appendChild(el(doc, "p", t("barter.total_fees_prefix", "Total fees: ") + prev.totalText, "muted"));',
    1, [K("barter", "total_fees_prefix", "Total fees: ")])
rep("barter-ui.js",
    '    if (esc) out.appendChild(el(doc, "p", "Escrow " + esc.name + " (" + esc.id + ") holds off-proposal \u2014 preview-only: the proposal below encloses only A\u2194B transfers (no escrow party serialized).", "muted"));',
    '    if (esc) out.appendChild(el(doc, "p", t("barter.escrow_prefix", "Escrow ") + esc.name + " (" + esc.id + t("barter.escrow_holds_off_proposal_suffix", ") holds off-proposal \u2014 preview-only: the proposal below encloses only A\u2194B transfers (no escrow party serialized)."), "muted"));',
    1, [K("barter", "escrow_prefix", "Escrow "),
        K("barter", "escrow_holds_off_proposal_suffix", ") holds off-proposal \u2014 preview-only: the proposal below encloses only A\u2194B transfers (no escrow party serialized).")])
rep("barter-ui.js",
    '    else if (escrowOn) out.appendChild(el(doc, "p", "Escrow enabled but no account set \u2014 legs settle peer-to-peer.", "muted"));',
    '    else if (escrowOn) out.appendChild(el(doc, "p", t("barter.escrow_enabled_but_no_account_set_legs_", "Escrow enabled but no account set \u2014 legs settle peer-to-peer."), "muted"));',
    1, [K("barter", "escrow_enabled_but_no_account_set_legs_", "Escrow enabled but no account set \u2014 legs settle peer-to-peer.")])
rep("barter-ui.js",
    '    var timing = (escrowOn && esc)\n      ? "Side fees: due now (escrow custodian path \u2014 legs route via escrow)."\n      : "Side fees: when proposal executes (no escrow \u2014 enclosed transfers pay on execution).";',
    '    var timing = (escrowOn && esc)\n      ? t("barter.side_fees_due_now_escrow_custodian_path", "Side fees: due now (escrow custodian path \u2014 legs route via escrow).")\n      : t("barter.side_fees_when_proposal_executes_no_escr", "Side fees: when proposal executes (no escrow \u2014 enclosed transfers pay on execution).");',
    1, [K("barter", "side_fees_due_now_escrow_custodian_path", "Side fees: due now (escrow custodian path \u2014 legs route via escrow)."),
        K("barter", "side_fees_when_proposal_executes_no_escr", "Side fees: when proposal executes (no escrow \u2014 enclosed transfers pay on execution).")])
rep("barter-ui.js",
    '      } catch (e) { hints.push(it.symbol + ": fee hint unavailable"); }',
    '      } catch (e) { hints.push(it.symbol + ": " + t("barter.fee_hint_unavailable", "fee hint unavailable")); }',
    1, [K("barter", "fee_hint_unavailable", "fee hint unavailable")])
rep("barter-ui.js",
    '      return sideName + " fee asset: " + sym + " \u2014 " + (hints.length ? hints.join("; ") : "no legs");',
    '      return sideName + t("barter.fee_asset_mid", " fee asset: ") + sym + " \u2014 " + (hints.length ? hints.join("; ") : t("barter.no_legs", "no legs"));',
    1, [K("barter", "fee_asset_mid", " fee asset: "),
        K("barter", "no_legs", "no legs")])
rep("barter-ui.js",
    '    out.appendChild(el(doc, "p", await feeAssetLine("Side A", feeAId, hintsA), "muted"));',
    '    out.appendChild(el(doc, "p", await feeAssetLine(t("barter.side_a", "Side A"), feeAId, hintsA), "muted"));',
    1, [K("barter", "side_a", "Side A")])
rep("barter-ui.js",
    '    out.appendChild(el(doc, "p", await feeAssetLine("Side B", feeBId, hintsB), "muted"));',
    '    out.appendChild(el(doc, "p", await feeAssetLine(t("barter.side_b", "Side B"), feeBId, hintsB), "muted"));',
    1, [K("barter", "side_b", "Side B")])
rep("barter-ui.js",
    '    var propHuman = "proposal fee hint unavailable", propRaw = null, propAsset = propFeeId;',
    '    var propHuman = t("barter.proposal_fee_hint_unavailable", "proposal fee hint unavailable"), propRaw = null, propAsset = propFeeId;',
    1, [K("barter", "proposal_fee_hint_unavailable", "proposal fee hint unavailable")])
rep("barter-ui.js",
    '    out.appendChild(el(doc, "p", "Proposal fee (due now, paid by " + A.acct.name + "): " + propHuman, "muted"));',
    '    out.appendChild(el(doc, "p", t("barter.proposal_fee_due_now_paid_by_prefix", "Proposal fee (due now, paid by ") + A.acct.name + t("barter.paid_by_suffix", "): ") + propHuman, "muted"));',
    1, [K("barter", "proposal_fee_due_now_paid_by_prefix", "Proposal fee (due now, paid by "),
        K("barter", "paid_by_suffix", "): ")])
rep("barter-ui.js",
    '    out.appendChild(el(doc, "p", "Total fees: " + totalText, "muted"));',
    '    out.appendChild(el(doc, "p", t("barter.total_fees_prefix", "Total fees: ") + totalText, "muted"));',
    1, [])
rep("barter-ui.js",
    '    if (!ids.length) return "fee hints unavailable";',
    '    if (!ids.length) return t("barter.fee_hints_unavailable", "fee hints unavailable");',
    1, [K("barter", "fee_hints_unavailable", "fee hints unavailable")])

# ============================================================ prediction-ui.js
rep("prediction-ui.js",
    '      var agree = doc.createElement("a"); agree.href = deskHref; agree.textContent = "Agree";',
    '      var agree = doc.createElement("a"); agree.href = deskHref; agree.textContent = t("prediction.agree", "Agree");',
    1, [K("prediction", "agree", "Agree")])
rep("prediction-ui.js",
    '      var disagree = doc.createElement("a"); disagree.href = deskHref; disagree.textContent = "Disagree";',
    '      var disagree = doc.createElement("a"); disagree.href = deskHref; disagree.textContent = t("prediction.disagree", "Disagree");',
    1, [K("prediction", "disagree", "Disagree")])
rep("prediction-ui.js",
    '     * PMA tab locking is_prediction_market ON). Plain literal, zero new\n     * t() keys. */',
    '     * PMA tab locking is_prediction_market ON). Batch-3 i18n: keyed. */',
    1, [])
rep("prediction-ui.js",
    '    var mk = touchable(el(doc, "button", "Create prediction market")); mk.type = "button";',
    '    var mk = touchable(el(doc, "button", t("prediction.create_prediction_market", "Create prediction market"))); mk.type = "button";',
    1, [K("prediction", "create_prediction_market", "Create prediction market")])
rep("prediction-ui.js",
    '   * this network; invalid = invalidReason() non-empty. Plain literals. */',
    '   * this network; invalid = invalidReason() non-empty. Batch-3 i18n: keyed. */',
    1, [])
rep("prediction-ui.js",
    '    var chkU = checkBox("Hide unknown houses", true);',
    '    var chkU = checkBox(t("prediction.hide_unknown_houses", "Hide unknown houses"), true);',
    1, [K("prediction", "hide_unknown_houses", "Hide unknown houses")])
rep("prediction-ui.js",
    '    var chkI = checkBox("Hide invalid assets", true);',
    '    var chkI = checkBox(t("prediction.hide_invalid_assets", "Hide invalid assets"), true);',
    1, [K("prediction", "hide_invalid_assets", "Hide invalid assets")])
rep("prediction-ui.js",
    '    wrap.appendChild(el(doc, "p", "New markets are created under Assets \u2192 Create \u2192 PMA tab (#/assets/create). Unknown house = issuer name not resolvable on this network.", "muted"));',
    '    wrap.appendChild(el(doc, "p", t("prediction.new_markets_are_created_under_assets_", "New markets are created under Assets \u2192 Create \u2192 PMA tab (#/assets/create). Unknown house = issuer name not resolvable on this network."), "muted"));',
    1, [K("prediction", "new_markets_are_created_under_assets_", "New markets are created under Assets \u2192 Create \u2192 PMA tab (#/assets/create). Unknown house = issuer name not resolvable on this network.")])
rep("prediction-ui.js",
    '      /* MED columns: HOUSE / MARKET CONFIDENCE / PREDICTED LIKELIHOOD /\n       * RESOLUTION DATE / ACTION (plain literals, zero new t() keys). */\n      ["Asset", "House", "Market confidence", "Predicted likelihood", "Resolution date", "Action"].forEach(function (h) {',
    '      /* MED columns: HOUSE / MARKET CONFIDENCE / PREDICTED LIKELIHOOD /\n       * RESOLUTION DATE / ACTION (batch-3 keyed). */\n      [t("prediction.hdr_asset", "Asset"), t("prediction.house", "House"), t("prediction.market_confidence", "Market confidence"), t("prediction.predicted_likelihood", "Predicted likelihood"), t("prediction.resolution_date", "Resolution date"), t("prediction.action", "Action")].forEach(function (h) {',
    1, [K("prediction", "house", "House"),
        K("prediction", "market_confidence", "Market confidence"),
        K("prediction", "predicted_likelihood", "Predicted likelihood"),
        K("prediction", "resolution_date", "Resolution date"),
        K("prediction", "action", "Action")])

# ========================================================= explorer-blocks.js
rep("explorer-blocks.js",
    '        sent.appendChild(el(doc, "span", " updated margin position"));',
    '        sent.appendChild(el(doc, "span", t("explorer.updated_margin_position", " updated margin position")));',
    1, [K("explorer", "updated_margin_position", " updated margin position")])
rep("explorer-blocks.js",
    '          sent.appendChild(el(doc, "span", " (+collateral "));',
    '          sent.appendChild(el(doc, "span", t("explorer.collateral_prefix", " (+collateral ")));',
    1, [K("explorer", "collateral_prefix", " (+collateral ")])
rep("explorer-blocks.js",
    '          sent.appendChild(el(doc, "span", " (+debt "));',
    '          sent.appendChild(el(doc, "span", t("explorer.debt_prefix", " (+debt ")));',
    1, [K("explorer", "debt_prefix", " (+debt ")])
rep("explorer-blocks.js",
    '        sent.appendChild(el(doc, "span", " filled order: "));',
    '        sent.appendChild(el(doc, "span", t("explorer.filled_order_prefix", " filled order: ")));',
    1, [K("explorer", "filled_order_prefix", " filled order: ")])
rep("explorer-blocks.js",
    '        sent.appendChild(el(doc, "span", " created account " + String(f.name || "\u2014")));',
    '        sent.appendChild(el(doc, "span", t("explorer.created_account_prefix", " created account ") + String(f.name || "\u2014")));',
    1, [K("explorer", "created_account_prefix", " created account ")])
rep("explorer-blocks.js",
    '        sent.appendChild(el(doc, "span", " updated account"));',
    '        sent.appendChild(el(doc, "span", t("explorer.updated_account", " updated account")));',
    1, [K("explorer", "updated_account", " updated account")])
rep("explorer-blocks.js",
    '        sent.appendChild(el(doc, "span", " issued "));',
    '        sent.appendChild(el(doc, "span", t("explorer.issued_mid", " issued ")));',
    1, [K("explorer", "issued_mid", " issued ")])
rep("explorer-blocks.js",
    '        sent.appendChild(amtObj(doc, f.asset_to_issue, myGen));\n        sent.appendChild(el(doc, "span", " to "));',
    '        sent.appendChild(amtObj(doc, f.asset_to_issue, myGen));\n        sent.appendChild(el(doc, "span", t("explorer.to_mid", " to ")));',
    1, [K("explorer", "to_mid", " to ")])
rep("explorer-blocks.js",
    '        sent.appendChild(el(doc, "span", " published feed for " + String(f.asset_id || "\u2014")));',
    '        sent.appendChild(el(doc, "span", t("explorer.published_feed_for_prefix", " published feed for ") + String(f.asset_id || "\u2014")));',
    1, [K("explorer", "published_feed_for_prefix", " published feed for ")])
rep("explorer-blocks.js",
    '        sent.appendChild(el(doc, "span", " proposed " + pops.length + " operation" +\n          (pops.length === 1 ? "" : "s") + (names ? " (" + names + ")" : "")));',
    '        sent.appendChild(el(doc, "span", t("explorer.proposed_prefix", " proposed ") + pops.length + t("explorer.operation_mid", " operation") +\n          (pops.length === 1 ? "" : "s") + (names ? " (" + names + ")" : "")));',
    1, [K("explorer", "proposed_prefix", " proposed "),
        K("explorer", "operation_mid", " operation")])
rep("explorer-blocks.js",
    '     * re-add it (otherwise the pre-load row is wiped on paint). */',
    '     * re-add it (otherwise the pre-load row is wiped on paint). Batch-3 i18n: keyed. */',
    1, [])
rep("explorer-blocks.js",
    '      jumpRow.appendChild(el(doc, "span", "Go to block: "));',
    '      jumpRow.appendChild(el(doc, "span", t("explorer.go_to_block_prefix", "Go to block: ")));',
    1, [K("explorer", "go_to_block_prefix", "Go to block: ")])
rep("explorer-blocks.js",
    '      jumpInput.setAttribute("placeholder", "height");',
    '      jumpInput.setAttribute("placeholder", t("explorer.height_ph", "height"));',
    1, [K("explorer", "height_ph", "height")])
rep("explorer-blocks.js",
    '      jumpInput.setAttribute("aria-label", "Block height");',
    '      jumpInput.setAttribute("aria-label", t("explorer.block_height_aria", "Block height"));',
    1, [K("explorer", "block_height_aria", "Block height")])
rep("explorer-blocks.js",
    '      var jumpBtn = touchable(el(doc, "button", "Go"));',
    '      var jumpBtn = touchable(el(doc, "button", t("explorer.go", "Go")));',
    1, [K("explorer", "go", "Go")])
rep("explorer-blocks.js",
    '         * field, so height navigation stands). A next past head renders an\n         * honest muted note instead of a dead link. Plain literals only. */',
    '         * field, so height navigation stands). A next past head renders an\n         * honest muted note instead of a dead link. Batch-3 i18n: keyed. */',
    1, [])
rep("explorer-blocks.js",
    '          nav.appendChild(anchor(doc, "\u2190 Prev block", "#/block/" + (b.height - 1)));',
    '          nav.appendChild(anchor(doc, t("explorer.prev_block", "\u2190 Prev block"), "#/block/" + (b.height - 1)));',
    1, [K("explorer", "prev_block", "\u2190 Prev block")])
rep("explorer-blocks.js",
    '          nav.appendChild(el(doc, "span", "\u2190 Genesis (first block)", "muted"));',
    '          nav.appendChild(el(doc, "span", t("explorer.genesis_first_block", "\u2190 Genesis (first block)"), "muted"));',
    1, [K("explorer", "genesis_first_block", "\u2190 Genesis (first block)")])
rep("explorer-blocks.js",
    '          nav.appendChild(el(doc, "span", "Next \u2192 (no newer block yet)", "muted"));',
    '          nav.appendChild(el(doc, "span", t("explorer.next_no_newer_block", "Next \u2192 (no newer block yet)"), "muted"));',
    1, [K("explorer", "next_no_newer_block", "Next \u2192 (no newer block yet)")])
rep("explorer-blocks.js",
    '          var nx = anchor(doc, "Next \u2192", "#/block/" + (b.height + 1));',
    '          var nx = anchor(doc, t("explorer.next", "Next \u2192"), "#/block/" + (b.height + 1));',
    1, [])
rep("explorer-blocks.js",
    '          if (headNum !== null) nx.title = "Head #" + headNum;',
    '          if (headNum !== null) nx.title = t("explorer.head_prefix", "Head #") + headNum;',
    1, [])
rep("explorer-blocks.js",
    '         * button, smooth scroll with instant fallback. Plain literal only. */',
    '         * button, smooth scroll with instant fallback. Batch-3 i18n: keyed. */',
    1, [])
rep("explorer-blocks.js",
    '        var topBtn = touchable(el(doc, "button", "Return to top"));',
    '        var topBtn = touchable(el(doc, "button", t("explorer.return_to_top", "Return to top")));',
    1, [K("explorer", "return_to_top", "Return to top")])

# ================================================================== htlc-ui.js
rep("htlc-ui.js",
    '   * i18n keys per punchlist rules); pre-existing t() keys below are reused. */',
    '   * i18n keys per punchlist rules); pre-existing t() keys below are reused.\n   * Batch-3 i18n: new strings keyed via t(). */',
    1, [])
rep("htlc-ui.js",
    '      box.appendChild(el(doc, "h2", "Sent (" + found.data.sent.length + ") \u00b7 Received (" + found.data.received.length + ")"));',
    '      box.appendChild(el(doc, "h2", t("htlc.sent_prefix", "Sent (") + found.data.sent.length + t("htlc.sent_received_mid", ") \u00b7 Received (") + found.data.received.length + ")"));',
    1, [K("htlc", "sent_prefix", "Sent ("),
        K("htlc", "sent_received_mid", ") \u00b7 Received (")])
rep("htlc-ui.js",
    '    filter.setAttribute("placeholder", "Filter by id, account, or hash\u2026");',
    '    filter.setAttribute("placeholder", t("htlc.filter_ph", "Filter by id, account, or hash\u2026"));',
    1, [K("htlc", "filter_ph", "Filter by id, account, or hash\u2026")])
rep("htlc-ui.js",
    '    filter.setAttribute("aria-label", "Filter contracts");',
    '    filter.setAttribute("aria-label", t("htlc.filter_aria", "Filter contracts"));',
    1, [K("htlc", "filter_aria", "Filter contracts")])
rep("htlc-ui.js",
    '    table.appendChild(tableHead(doc, [t("htlc.contract_col", "Contract"), "Direction", "From", "To",',
    '    table.appendChild(tableHead(doc, [t("htlc.contract_col", "Contract"), t("htlc.direction", "Direction"), t("htlc.from", "From"), t("htlc.to", "To"),',
    1, [K("htlc", "direction", "Direction"),
        K("htlc", "from", "From"),
        K("htlc", "to", "To")])
rep("htlc-ui.js",
    '    var all = (Array.isArray(sent) ? sent : []).map(function (r) { return { r: r, dir: "Sent" }; })\n      .concat((Array.isArray(received) ? received : []).map(function (r) { return { r: r, dir: "Received" }; }));',
    '    var all = (Array.isArray(sent) ? sent : []).map(function (r) { return { r: r, dir: t("htlc.sent", "Sent") }; })\n      .concat((Array.isArray(received) ? received : []).map(function (r) { return { r: r, dir: t("htlc.received", "Received") }; }));',
    1, [K("htlc", "sent", "Sent"),
        K("htlc", "received", "Received")])
rep("htlc-ui.js",
    '        note.textContent = "No contracts.";',
    '        note.textContent = t("htlc.no_contracts", "No contracts.");',
    1, [K("htlc", "no_contracts", "No contracts.")])
rep("htlc-ui.js",
    '        tr.appendChild(el(doc, "td", r.expired ? exp + " (expired)" : exp)); tr.appendChild(td);',
    '        tr.appendChild(el(doc, "td", r.expired ? exp + t("htlc.expired_suffix", " (expired)") : exp)); tr.appendChild(td);',
    1, [K("htlc", "expired_suffix", " (expired)")])
rep("htlc-ui.js",
    '      note.textContent = q ? ("Showing " + n + " of " + all.length + " contracts.") : "";',
    '      note.textContent = q ? (t("htlc.showing_prefix", "Showing ") + n + t("htlc.of_mid", " of ") + all.length + t("htlc.contracts_suffix", " contracts.")) : "";',
    1, [K("htlc", "showing_prefix", "Showing "),
        K("htlc", "of_mid", " of "),
        K("htlc", "contracts_suffix", " contracts.")])

# ================================================================ credit-ui.js
rep("credit-ui.js",
    '   * modal. Header words Available/Expiration/Loan are plain literals (no new\n   * t() keys \u2014 locales untouched). */',
    '   * modal. Header words Available/Expiration/Loan are batch-3-keyed. */',
    1, [])
rep("credit-ui.js",
    '      t("credit.total", "Total"), "Available", t("credit.min_deal_amount", "Min deal amount"),',
    '      t("credit.total", "Total"), t("credit.available", "Available"), t("credit.min_deal_amount", "Min deal amount"),',
    1, [K("credit", "available", "Available")])
rep("credit-ui.js",
    '      "Expiration", t("credit.collateral", "Collateral"),\n      "Loan", ""]));',
    '      t("credit.expiration", "Expiration"), t("credit.collateral", "Collateral"),\n      t("credit.loan", "Loan"), ""]));',
    1, [K("credit", "expiration", "Expiration"),
        K("credit", "loan", "Loan")])
rep("credit-ui.js",
    '      c.appendChild(el(doc, "div", "Total " + tot.text + " / Available " + availC));',
    '      c.appendChild(el(doc, "div", t("credit.total_prefix", "Total ") + tot.text + t("credit.available_mid", " / Available ") + availC));',
    1, [K("credit", "total_prefix", "Total "),
        K("credit", "available_mid", " / Available ")])
rep("credit-ui.js",
    '      c.appendChild(el(doc, "div", t("credit.fee_rate", "Fee rate") + " " + safeRate(o.rate_units).text + " \u00b7 " + t("credit.max_duration", "Max duration") + " " + Credit.durToHuman(o.max_dur_sec) + " \u00b7 Expiration " + expC));',
    '      c.appendChild(el(doc, "div", t("credit.fee_rate", "Fee rate") + " " + safeRate(o.rate_units).text + " \u00b7 " + t("credit.max_duration", "Max duration") + " " + Credit.durToHuman(o.max_dur_sec) + t("credit.expiration_mid", " \u00b7 Expiration ") + expC));',
    1, [K("credit", "expiration_mid", " \u00b7 Expiration ")])

# =============================================================== vesting-ui.js
rep("vesting-ui.js",
    '      var b = ui.touchable(ui.el(doc, "button", "Claim " + vr.r.id)); b.type = "button"; host.appendChild(b);',
    '      var b = ui.touchable(ui.el(doc, "button", t("vesting.claim_prefix", "Claim ") + vr.r.id)); b.type = "button"; host.appendChild(b);',
    1, [K("vesting", "claim_prefix", "Claim ")])
rep("vesting-ui.js",
    '           * no re-fetch. All words are plain literals (no new t() keys). */',
    '           * no re-fetch. Batch-3 i18n: keyed via t(). */',
    1, [])
rep("vesting-ui.js",
    '          var fQ2 = ui.field(doc, "Filter", { placeholder: "Search id, owner, asset\u2026" });',
    '          var fQ2 = ui.field(doc, t("vesting.filter", "Filter"), { placeholder: t("vesting.search_id_owner_asset_ph", "Search id, owner, asset\u2026") });',
    1, [K("vesting", "filter", "Filter"),
        K("vesting", "search_id_owner_asset_ph", "Search id, owner, asset\u2026")])
rep("vesting-ui.js",
    '          try { fQ2.input.setAttribute("type", "search"); fQ2.input.setAttribute("aria-label", "Filter vesting rows"); } catch (e) { /* label wraps input already */ }',
    '          try { fQ2.input.setAttribute("type", "search"); fQ2.input.setAttribute("aria-label", t("vesting.filter_vesting_rows_aria", "Filter vesting rows")); } catch (e) { /* label wraps input already */ }',
    1, [K("vesting", "filter_vesting_rows_aria", "Filter vesting rows")])
rep("vesting-ui.js",
    '              results.appendChild(ui.el(doc, "p", needle ? "No matching vesting rows." : t("vesting.no_vesting_balances_for_this_account", "No vesting balances for this account."), "muted"));',
    '              results.appendChild(ui.el(doc, "p", needle ? t("vesting.no_matching_vesting_rows", "No matching vesting rows.") : t("vesting.no_vesting_balances_for_this_account", "No vesting balances for this account."), "muted"));',
    1, [K("vesting", "no_matching_vesting_rows", "No matching vesting rows.")])
rep("vesting-ui.js",
    '            results.appendChild(ui.deskTable(doc, [t("vesting.id", "ID"), t("vesting.owner", "Owner"), t("vesting.balance", "Balance"), t("vesting.policy", "Policy"),\n              "Required (days)", "Earned (days)", "Remaining (days)", "Available"], shown));',
    '            results.appendChild(ui.deskTable(doc, [t("vesting.id", "ID"), t("vesting.owner", "Owner"), t("vesting.balance", "Balance"), t("vesting.policy", "Policy"),\n              t("vesting.required_days", "Required (days)"), t("vesting.earned_days", "Earned (days)"), t("vesting.remaining_days", "Remaining (days)"), t("vesting.available", "Available")], shown));',
    1, [K("vesting", "required_days", "Required (days)"),
        K("vesting", "earned_days", "Earned (days)"),
        K("vesting", "remaining_days", "Remaining (days)"),
        K("vesting", "available", "Available")])

# ============================================================== accounts-ui.js
rep("accounts-ui.js",
    '     * Both targets exist \u2014 plain literals, no new routes. */',
    '     * Both targets exist \u2014 batch-3-keyed, no new routes. */',
    1, [])
rep("accounts-ui.js",
    '      a.textContent = "Restore your account";',
    '      a.textContent = t("account.restore_your_account", "Restore your account");',
    1, [K("account", "restore_your_account", "Restore your account")])
rep("accounts-ui.js",
    '      b.textContent = "Advanced form";',
    '      b.textContent = t("account.advanced_form", "Advanced form");',
    1, [K("account", "advanced_form", "Advanced form")])

# ================================================================= asset-ui.js
rep("asset-ui.js",
    '           * #/assets/issue \u2014 cross-link, no new route). Plain literal. */',
    '           * #/assets/issue \u2014 cross-link, no new route). Batch-3 i18n: keyed. */',
    1, [])
rep("asset-ui.js",
    '          var isl = d.createElement("a"); isl.href = "#/assets/issue"; isl.textContent = "Issue"; touch(isl); card.appendChild(isl);',
    '          var isl = d.createElement("a"); isl.href = "#/assets/issue"; isl.textContent = t("asset.issue", "Issue"); touch(isl); card.appendChild(isl);',
    1, [K("asset", "issue", "Issue")])
rep("asset-ui.js",
    '     * the viewing-as account; opening it from an account page keeps context.\n     * Plain literals only. */',
    '     * the viewing-as account; opening it from an account page keeps context.\n     * Batch-3 i18n: keyed. */',
    1, [])
rep("asset-ui.js",
    '      var p = el(d, "p", "Issuer defaults to the viewing-as account (1.2.0 locked, your account unlocked) \u2014 type any issuer you control. Opened from an account page, paste that account name here.", "muted");',
    '      var p = el(d, "p", t("asset.issuer_defaults_to_the_viewing_as_accoun", "Issuer defaults to the viewing-as account (1.2.0 locked, your account unlocked) \u2014 type any issuer you control. Opened from an account page, paste that account name here."), "muted");',
    1, [K("asset", "issuer_defaults_to_the_viewing_as_accoun", "Issuer defaults to the viewing-as account (1.2.0 locked, your account unlocked) \u2014 type any issuer you control. Opened from an account page, paste that account name here.")])
rep("asset-ui.js",
    '      var a = el(d, "a", "Open an account");',
    '      var a = el(d, "a", t("asset.open_an_account", "Open an account"));',
    1, [K("asset", "open_an_account", "Open an account")])
rep("asset-ui.js",
    '       * JSON-ish text. Plain literal only. */',
    '       * JSON-ish text. Batch-3 i18n: keyed. */',
    1, [])
rep("asset-ui.js",
    '      body.appendChild(el(d, "p", "Description is one text box: write the full description here (main, short name, market pair and details as plain text).", "muted"));',
    '      body.appendChild(el(d, "p", t("asset.description_is_one_text_box_write_the_fu", "Description is one text box: write the full description here (main, short name, market pair and details as plain text)."), "muted"));',
    1, [K("asset", "description_is_one_text_box_write_the_fu", "Description is one text box: write the full description here (main, short name, market pair and details as plain text).")])

# ======================================================== create-account-ui.js
rep("create-account-ui.js",
    '     * (original create-account.png). Plain literals, existing routes only. */',
    '     * (original create-account.png). Batch-3 i18n: keyed, existing routes only. */',
    1, [])
rep("create-account-ui.js",
    '      a.textContent = "Restore your account";',
    '      a.textContent = t("createaccount.restore_your_account", "Restore your account");',
    1, [K("createaccount", "restore_your_account", "Restore your account")])
rep("create-account-ui.js",
    '      b.textContent = "Advanced form";',
    '      b.textContent = t("createaccount.advanced_form", "Advanced form");',
    1, [K("createaccount", "advanced_form", "Advanced form")])

# ========================================================= create-worker-ui.js
rep("create-worker-ui.js",
    '     * texts (CreateWorker concept). Plain literals only, no new routes. */',
    '     * texts (CreateWorker concept). Batch-3 i18n: keyed, no new routes. */',
    1, [])
rep("create-worker-ui.js",
    '    wrap.appendChild(el(doc, "p", "Publishing a worker requires a lifetime-member account \u2014 basic accounts cannot pay this fee. The owner below must already be upgraded.", "muted"));',
    '    wrap.appendChild(el(doc, "p", t("createworker.publishing_a_worker_requires_a_lifeti", "Publishing a worker requires a lifetime-member account \u2014 basic accounts cannot pay this fee. The owner below must already be upgraded."), "muted"));',
    1, [K("createworker", "publishing_a_worker_requires_a_lifeti", "Publishing a worker requires a lifetime-member account \u2014 basic accounts cannot pay this fee. The owner below must already be upgraded.")])
rep("create-worker-ui.js",
    '    wrap.appendChild(el(doc, "p", "Owner pays the fee and receives the worker pay \u2014 use a lifetime-member account you control.", "muted"));',
    '    wrap.appendChild(el(doc, "p", t("createworker.owner_pays_the_fee_and_receives_the_", "Owner pays the fee and receives the worker pay \u2014 use a lifetime-member account you control."), "muted"));',
    1, [K("createworker", "owner_pays_the_fee_and_receives_the_", "Owner pays the fee and receives the worker pay \u2014 use a lifetime-member account you control.")])
rep("create-worker-ui.js",
    '    wrap.appendChild(el(doc, "p", "Start date must be before the end date (chain rule) \u2014 pick both in UTC.", "muted"));',
    '    wrap.appendChild(el(doc, "p", t("createworker.start_date_must_be_before_the_end_da", "Start date must be before the end date (chain rule) \u2014 pick both in UTC."), "muted"));',
    1, [K("createworker", "start_date_must_be_before_the_end_da", "Start date must be before the end date (chain rule) \u2014 pick both in UTC.")])
rep("create-worker-ui.js",
    '    wrap.appendChild(el(doc, "p", "End date must be after the start date; pay accrues only inside this window.", "muted"));',
    '    wrap.appendChild(el(doc, "p", t("createworker.end_date_must_be_after_the_start_dat", "End date must be after the start date; pay accrues only inside this window."), "muted"));',
    1, [K("createworker", "end_date_must_be_after_the_start_dat", "End date must be after the start date; pay accrues only inside this window.")])
rep("create-worker-ui.js",
    '    wrap.appendChild(el(doc, "p", "Daily pay in core asset (BTS, precision 5), greater than zero and below the chain maximum.", "muted"));',
    '    wrap.appendChild(el(doc, "p", t("createworker.daily_pay_in_core_asset_bts_precision", "Daily pay in core asset (BTS, precision 5), greater than zero and below the chain maximum."), "muted"));',
    1, [K("createworker", "daily_pay_in_core_asset_bts_precision", "Daily pay in core asset (BTS, precision 5), greater than zero and below the chain maximum.")])
rep("create-worker-ui.js",
    '    wrap.appendChild(el(doc, "p", "Short name under 63 bytes \u2014 shown on the voting page.", "muted"));',
    '    wrap.appendChild(el(doc, "p", t("createworker.short_name_under_63_bytes_shown_on_th", "Short name under 63 bytes \u2014 shown on the voting page."), "muted"));',
    1, [K("createworker", "short_name_under_63_bytes_shown_on_th", "Short name under 63 bytes \u2014 shown on the voting page.")])
rep("create-worker-ui.js",
    '    wrap.appendChild(el(doc, "p", "Link to the full proposal text, under 127 bytes.", "muted"));',
    '    wrap.appendChild(el(doc, "p", t("createworker.link_to_the_full_proposal_text_under_1", "Link to the full proposal text, under 127 bytes."), "muted"));',
    1, [K("createworker", "link_to_the_full_proposal_text_under_1", "Link to the full proposal text, under 127 bytes.")])
rep("create-worker-ui.js",
    '    wrap.appendChild(el(doc, "p", "Vesting choice only: whole days 0..65535 for the vesting pay destination; hidden otherwise.", "muted"));',
    '    wrap.appendChild(el(doc, "p", t("createworker.vesting_choice_only_whole_days_0_6553", "Vesting choice only: whole days 0..65535 for the vesting pay destination; hidden otherwise."), "muted"));',
    1, [K("createworker", "vesting_choice_only_whole_days_0_6553", "Vesting choice only: whole days 0..65535 for the vesting pay destination; hidden otherwise.")])

# ============================================================= dashboard-ui.js
rep("dashboard-ui.js",
    '      section.appendChild(el(doc, "p", "Top holdings for the watched account \u2014 the reference dashboard shows market tabs instead; full balances live on the account page.", "muted"));',
    '      section.appendChild(el(doc, "p", t("dashboard.top_holdings_for_the_watched_account_", "Top holdings for the watched account \u2014 the reference dashboard shows market tabs instead; full balances live on the account page."), "muted"));',
    1, [K("dashboard", "top_holdings_for_the_watched_account_", "Top holdings for the watched account \u2014 the reference dashboard shows market tabs instead; full balances live on the account page.")])
rep("dashboard-ui.js",
    '          (list.length > 5 ? " (" + list.length + ")" : " \u2014 full balances")]',
    '          (list.length > 5 ? " (" + list.length + ")" : t("dashboard.full_balances_suffix", " \u2014 full balances"))]',
    1, [K("dashboard", "full_balances_suffix", " \u2014 full balances")])

# ============================================================ explorer-tabs.js
# NOTE: memberTab/marketsTab declare `var t = table(...)` which would shadow
# the t() helper at the two insertion points (batch-2c/2e precedent) — rename
# to tbl first (behavior-identical).
rep("explorer-tabs.js",
    '      var t = table(doc, ["Name", "Account", "Active"]);',
    '      var tbl = table(doc, ["Name", "Account", "Active"]);',
    1, [])
rep("explorer-tabs.js",
    '        tr.appendChild(el(doc, "td", m.active ? "yes" : "\u2014"));\n        t.tbody.appendChild(tr);',
    '        tr.appendChild(el(doc, "td", m.active ? "yes" : "\u2014"));\n        tbl.tbody.appendChild(tr);',
    1, [])
rep("explorer-tabs.js",
    '      body.appendChild(t.table);\n      var p = el(doc, "p", null, "muted");\n      p.appendChild(link(doc, "#/voting", "Open voting for weights and slates \u2192"));',
    '      body.appendChild(tbl.table);\n      var p = el(doc, "p", null, "muted");\n      p.appendChild(link(doc, "#/voting", "Open voting for weights and slates \u2192"));',
    1, [])
rep("explorer-tabs.js",
    '        var t = table(doc, ["Market", "Price", "Volume", "Change"]);',
    '        var tbl = table(doc, ["Market", "Price", "Volume", "Change"]);',
    1, [])
rep("explorer-tabs.js",
    '          tr.appendChild(el(doc, "td", r.m.percent_change !== undefined && r.m.percent_change !== null ? String(r.m.percent_change) : "\u2014"));\n          t.tbody.appendChild(tr);\n        });\n        body.appendChild(t.table);',
    '          tr.appendChild(el(doc, "td", r.m.percent_change !== undefined && r.m.percent_change !== null ? String(r.m.percent_change) : "\u2014"));\n          tbl.tbody.appendChild(tr);\n        });\n        body.appendChild(tbl.table);',
    1, [])
rep("explorer-tabs.js",
    'var ExplorerTabs = (function () {\n  "use strict";\n',
    'var ExplorerTabs = (function () {\n  "use strict";\n\n  /* Batch-3 i18n (slice-17 precedent): display strings resolve via I18n.t with\n   * the pre-conversion literal kept verbatim as enDefault (English-identical\n   * on any transport, incl. file:// where dict fetch fails). Falls back to\n   * the default when i18n.js failed to load: never blank, never throws. */\n  function t(key, dflt) {\n    try {\n      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt);\n    } catch (e) { /* default below */ }\n    return dflt;\n  }\n',
    1, [])
rep("explorer-tabs.js",
    '   * full page for weights and slates. Plain literals only. */',
    '   * full page for weights and slates. Batch-3 i18n: keyed. */',
    1, [])
rep("explorer-tabs.js",
    '      body.appendChild(el(doc, "p", "Thin summary (top 50, names and activity only) \u2014 weights and publishing live on the voting page.", "muted"));',
    '      body.appendChild(el(doc, "p", t("explorer.thin_summary_top_50_names_and_activity", "Thin summary (top 50, names and activity only) \u2014 weights and publishing live on the voting page."), "muted"));',
    1, [K("explorer", "thin_summary_top_50_names_and_activity", "Thin summary (top 50, names and activity only) \u2014 weights and publishing live on the voting page.")])
rep("explorer-tabs.js",
    '        body.appendChild(el(doc, "p", "Thin summary (top 20 by volume) \u2014 full order books, charts and trading live on each market page.", "muted"));',
    '        body.appendChild(el(doc, "p", t("explorer.thin_summary_top_20_by_volume_full_orde", "Thin summary (top 20 by volume) \u2014 full order books, charts and trading live on each market page."), "muted"));',
    1, [K("explorer", "thin_summary_top_20_by_volume_full_orde", "Thin summary (top 20 by volume) \u2014 full order books, charts and trading live on each market page.")])

# =============================================================== gateway-ui.js
rep("gateway-ui.js",
    '     * terms/agreement disclosure. Plain literals only; toggles hide tab',
    '     * terms/agreement disclosure. Batch-3-keyed literals; toggles hide tab',
    1, [])
rep("gateway-ui.js",
    '      sum.textContent = "Gateway display + terms";',
    '      sum.textContent = t("gateway.display_terms", "Gateway display + terms");',
    1, [K("gateway", "display_terms", "Gateway display + terms")])
rep("gateway-ui.js",
    '        box.setAttribute("aria-label", "Show " + id);',
    '        box.setAttribute("aria-label", t("gateway.show_prefix", "Show ") + id);',
    1, [K("gateway", "show_prefix", "Show ")])
rep("gateway-ui.js",
    '        lab.appendChild(ctx.doc.createTextNode(" Show " + id + " "));',
    '        lab.appendChild(ctx.doc.createTextNode(t("gateway.show_mid", " Show ") + id + " "));',
    1, [K("gateway", "show_mid", " Show ")])
rep("gateway-ui.js",
    '      var terms = el(ctx.doc, "p", "Gateway use is at your own risk: external hosts set fees, minimums and addresses. Verify every address and memo before sending \u2014 deposits cannot be reversed.", "muted");',
    '      var terms = el(ctx.doc, "p", t("gateway.use_at_your_own_risk_external_hosts_set_", "Gateway use is at your own risk: external hosts set fees, minimums and addresses. Verify every address and memo before sending \u2014 deposits cannot be reversed."), "muted");',
    1, [K("gateway", "use_at_your_own_risk_external_hosts_set_", "Gateway use is at your own risk: external hosts set fees, minimums and addresses. Verify every address and memo before sending \u2014 deposits cannot be reversed.")])

# =============================================================== market-desk.js
rep("market-desk.js",
    '     * reference Personalize dialog is not rebuilt). Plain literals only. */',
    '     * reference Personalize dialog is not rebuilt). Batch-3 i18n: keyed. */',
    1, [])
rep("market-desk.js",
    '      starBtn.setAttribute("aria-label", "Favourite " + id);',
    '      starBtn.setAttribute("aria-label", t("market.favourite_prefix", "Favourite ") + id);',
    1, [K("market", "favourite_prefix", "Favourite ")])
rep("market-desk.js",
    '        starBtn.title = fav ? "Starred \u2014 click to unstar" : "Star this market";',
    '        starBtn.title = fav ? t("market.starred_click_to_unstar", "Starred \u2014 click to unstar") : t("market.star_this_market", "Star this market");',
    1, [K("market", "starred_click_to_unstar", "Starred \u2014 click to unstar"),
        K("market", "star_this_market", "Star this market")])
rep("market-desk.js",
    '      gearBtn.textContent = "\u2699 Columns (fixed)";',
    '      gearBtn.textContent = t("market.columns_fixed", "\u2699 Columns (fixed)");',
    1, [K("market", "columns_fixed", "\u2699 Columns (fixed)")])
rep("market-desk.js",
    '      gearBtn.title = "Column chooser is not offered \u2014 the book, history and orders tables have fixed columns.";',
    '      gearBtn.title = t("market.column_chooser_is_not_offered_the_book_h", "Column chooser is not offered \u2014 the book, history and orders tables have fixed columns.");',
    1, [K("market", "column_chooser_is_not_offered_the_book_h", "Column chooser is not offered \u2014 the book, history and orders tables have fixed columns.")])

# =================================================================== misc-ui.js
rep("misc-ui.js",
    '     * disabled, honestly labelled control (no new serializers here). */',
    '     * disabled, honestly labelled control (no new serializers here). Batch-3 i18n: keyed. */',
    1, [])
rep("misc-ui.js",
    '      var p = ui.el(doc, "p", "One key-auth row is supported here (key above + threshold). Multiple key, account or address rows are not built in this form.", "muted");',
    '      var p = ui.el(doc, "p", t("misc.one_key_auth_row_is_supported_here_key_ab", "One key-auth row is supported here (key above + threshold). Multiple key, account or address rows are not built in this form."), "muted");',
    1, [K("misc", "one_key_auth_row_is_supported_here_key_ab", "One key-auth row is supported here (key above + threshold). Multiple key, account or address rows are not built in this form.")])
rep("misc-ui.js",
    '      var b = ui.touchable(ui.el(doc, "button", "Add auth row (unsupported)"));',
    '      var b = ui.touchable(ui.el(doc, "button", t("misc.add_auth_row_unsupported", "Add auth row (unsupported)")));',
    1, [K("misc", "add_auth_row_unsupported", "Add auth row (unsupported)")])
rep("misc-ui.js",
    '      b.title = "Only one key-auth row is supported \u2014 extra authority rows need new serializers.";',
    '      b.title = t("misc.only_one_key_auth_row_is_supported_extra_", "Only one key-auth row is supported \u2014 extra authority rows need new serializers.");',
    1, [K("misc", "only_one_key_auth_row_is_supported_extra_", "Only one key-auth row is supported \u2014 extra authority rows need new serializers.")])

# =================================================================== news-ui.js
rep("news-ui.js",
    '    wrap.appendChild(el(doc, "p", "No feed fetch is attempted, so there is no feed loading spinner or fetch-error panel \u2014 the live connection line below is the loading/error indicator for this page.", "muted"));',
    '    wrap.appendChild(el(doc, "p", t("news.no_feed_fetch_is_attempted_so_there_is_no", "No feed fetch is attempted, so there is no feed loading spinner or fetch-error panel \u2014 the live connection line below is the loading/error indicator for this page."), "muted"));',
    1, [K("news", "no_feed_fetch_is_attempted_so_there_is_no", "No feed fetch is attempted, so there is no feed loading spinner or fetch-error panel \u2014 the live connection line below is the loading/error indicator for this page.")])
rep("news-ui.js",
    '    var conn = el(doc, "p", "Checking connection\u2026", "muted");',
    '    var conn = el(doc, "p", t("news.checking_connection", "Checking connection\u2026"), "muted");',
    1, [K("news", "checking_connection", "Checking connection\u2026")])
rep("news-ui.js",
    '    try { conn.textContent = connectionLine(); } catch (e) { conn.textContent = "Network: unknown \u00b7 connection: unknown (see Settings \u2192 Nodes)"; }',
    '    try { conn.textContent = connectionLine(); } catch (e) { conn.textContent = t("news.network_unknown_connection_unknown_see_se", "Network: unknown \u00b7 connection: unknown (see Settings \u2192 Nodes)"); }',
    1, [K("news", "network_unknown_connection_unknown_see_se", "Network: unknown \u00b7 connection: unknown (see Settings \u2192 Nodes)")])

# =============================================================== pool-swap-ui.js
rep("pool-swap-ui.js",
    '      var p = u.el(doc, "p", "Balances for the sell and buy assets live on the account page \u2014 open it to check before swapping.", "muted");',
    '      var p = u.el(doc, "p", t("pool.balances_for_the_sell_and_buy_assets_live_", "Balances for the sell and buy assets live on the account page \u2014 open it to check before swapping."), "muted");',
    1, [K("pool", "balances_for_the_sell_and_buy_assets_live_", "Balances for the sell and buy assets live on the account page \u2014 open it to check before swapping.")])
rep("pool-swap-ui.js",
    '      a.textContent = "Open account balances";',
    '      a.textContent = t("pool.open_account_balances", "Open account balances");',
    1, [K("pool", "open_account_balances", "Open account balances")])

# ================================================================ trade-form.js
rep("trade-form.js",
    '    body.appendChild(el(doc, "p", side === "buy" ? "Lowest ask lives in the order book above \u2014 click an ask row to fill the price." : "Highest bid lives in the order book above \u2014 click a bid row to fill the price.", "muted"));',
    '    body.appendChild(el(doc, "p", side === "buy" ? t("trade.lowest_ask_lives_in_the_order_book_above", "Lowest ask lives in the order book above \u2014 click an ask row to fill the price.") : t("trade.highest_bid_lives_in_the_order_book_above", "Highest bid lives in the order book above \u2014 click a bid row to fill the price."), "muted"));',
    1, [K("trade", "lowest_ask_lives_in_the_order_book_above", "Lowest ask lives in the order book above \u2014 click an ask row to fill the price."),
        K("trade", "highest_bid_lives_in_the_order_book_above", "Highest bid lives in the order book above \u2014 click a bid row to fill the price.")])

# =============================================================== transfer-ui.js
rep("transfer-ui.js",
    '    wrap.appendChild(el(doc, "p", "No scam list is loaded here \u2014 double-check the recipient name before reviewing.", "muted"));',
    '    wrap.appendChild(el(doc, "p", t("transfer.no_scam_list_is_loaded_here_double_che", "No scam list is loaded here \u2014 double-check the recipient name before reviewing."), "muted"));',
    1, [K("transfer", "no_scam_list_is_loaded_here_double_che", "No scam list is loaded here \u2014 double-check the recipient name before reviewing.")])

# =================================================================== vote-ui.js
rep("vote-ui.js",
    '     * concept). Plain literal, no new route. */',
    '     * concept). Batch-3 i18n: keyed, no new route. */',
    1, [])
rep("vote-ui.js",
    '      q.textContent = "? What is a proxy?";',
    '      q.textContent = t("vote.what_is_a_proxy", "? What is a proxy?");',
    1, [K("vote", "what_is_a_proxy", "? What is a proxy?")])
rep("vote-ui.js",
    '      q.title = "Proxies follow another account\'s slate \u2014 read how voting works before setting one.";',
    '      q.title = t("vote.proxies_follow_another_account_s_slate_re", "Proxies follow another account\'s slate \u2014 read how voting works before setting one.");',
    1, [K("vote", "proxies_follow_another_account_s_slate_re", "Proxies follow another account's slate \u2014 read how voting works before setting one.")])


def main():
    apply = "--apply" in sys.argv
    en = json.load(open(EN, encoding="utf-8"))

    def flat(tree, prefix=""):
        out = {}
        for k, v in tree.items():
            if k == "_meta":
                continue
            if isinstance(v, dict):
                out.update(flat(v, prefix + k + "."))
            else:
                out[prefix + k] = v
        return out

    en_flat = flat(en)
    # Reuse table: (ns, literal) -> existing key (same default already shipped)
    reuse = {}
    for dotted, val in en_flat.items():
        ns, _, key = dotted.partition(".")
        reuse[(ns, val)] = dotted

    files = {}
    for fname, _, _, _, _ in R:
        if fname not in files:
            p = os.path.join(JS, fname)
            files[fname] = open(p, encoding="utf-8").read()

    frag = {}
    total_keys = 0
    for fname, old, new, count, keys in R:
        src = files[fname]
        n = src.count(old)
        if n != count:
            print("MISMATCH %s: expected %d, found %d\nOLD: %r" % (fname, count, n, old[:160]))
            return 1
        files[fname] = src.replace(old, new)
        for ns, key, val in keys:
            dotted = ns + "." + key
            if dotted in en_flat:
                if en_flat[dotted] != val:
                    print("CONFLICT %s: en %r vs new %r" % (dotted, en_flat[dotted], val))
                    return 1
                continue  # already shipped (e.g. reused auth/prediction/explorer keys)
            if (ns, val) in reuse and reuse[(ns, val)] != dotted:
                print("DUP-VALUE %s=%r already under %s; refusing near-duplicate" % (dotted, val, reuse[(ns, val)]))
                return 1
            sec = frag.setdefault(ns, {})
            if key in sec:
                if sec[key] != val:
                    print("FRAG-CONFLICT %s" % dotted)
                    return 1
            else:
                sec[key] = val
                total_keys += 1
            en_flat[dotted] = val
            reuse[(ns, val)] = dotted

    if apply:
        for fname, src in files.items():
            with open(os.path.join(JS, fname), "w", encoding="utf-8") as fh:
                fh.write(src)
        nested = {ns: dict(sorted(sec.items())) for ns, sec in sorted(frag.items())}
        with open(FRAG, "w", encoding="utf-8") as fh:
            json.dump(nested, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        print("wrote %d files, frag keys: %d -> %s" % (len(files), total_keys, FRAG))
    for fname in sorted(files):
        n0 = len(re.findall(r"\bt\(\s*\"", open(os.path.join(JS, fname), encoding="utf-8").read() if not apply else files[fname]))
        print("%-22s t() sites now %3d" % (fname, n0))
    if not apply:
        print("frag keys (dry-run): %d across %d sections" % (total_keys, len(frag)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
