#!/usr/bin/env python3
"""Batch-2c i18n conversion (AFK worker): vote + explorer + gateway + notify views.

Wraps every user-facing display literal in the 9 target files with the
slice-17 precedent helper:
    t("section.key", "byte-verbatim current literal"[, {vars}])
NO rewording: every default is copied byte-verbatim from HEAD. Amounts,
dates, numbers, console strings, route hrefs, class names and chain field
names are untouched. New keys accumulate in
vanilla/locales/frag-batch2c.json (en.json + other dicts NOT touched;
a later merge task reconciles, incl. values already stubbed in en.json).

Conventions:
- Namespaces: vote.* (vote-ui, vote-slate), explorer.* (explorer-ui,
  explorer-blocks, explorer-assets, explorer-render), gateway.*
  (gateway-ui), notify.* (notify-ui, notify-host).
- Dynamic sentences keep their code structure (batch-2b precedent): only
  complete static literals are wrapped; values, punctuation glue and
  plural/ternary logic stay raw, so every default is byte-verbatim HEAD.
- 6 shadowed `t` identifiers renamed (t->tab/tx/item/type): they would
  shadow the helper inside callbacks. Behavior-identical renames.
- Proof companion: tooling/prove_i18n_batch2c.py.

Usage: python3 tooling/apply_i18n_batch2c.py  (aborts on any count mismatch)
"""
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
JS = os.path.join(HERE, "..", "vanilla", "js")
FRAG = os.path.join(HERE, "..", "vanilla", "locales", "frag-batch2c.json")
LEDGER_PATH = "/tmp/batch2c-ledger.json"

HELPER = """
  /* Batch-2c i18n (slice-17): display strings resolve via I18n.t with
   * the pre-conversion literal kept verbatim as enDefault (English-identical
   * on any transport, incl. file:// where dict fetch fails). Falls back to
   * the default when i18n.js failed to load: never blank, never throws.
   * Dynamic sentences keep their code structure (batch-2b precedent): only
   * complete static literals are wrapped, values and punctuation glue stay
   * raw, so every default below is byte-verbatim in the HEAD blob. */
  function t(key, dflt) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt);
    } catch (e) { /* default below */ }
    return dflt;
  }
"""

# (file, old, new, expected_count, [(key, default), ...])
R = []


def rep(fname, old, new, count=1, keys=()):
    R.append((fname, old, new, count, list(keys)))


def helper(fname, anchor):
    rep(fname, anchor, anchor + HELPER, 1, [])


# ---------------------------------------------------------------- vote-ui.js
helper("vote-ui.js", 'var VoteUI = (function () {\n  "use strict";')

rep("vote-ui.js",
    ': String(e || fallback || "Unexpected error");',
    ': String(e || fallback || t("vote.unexpected", "Unexpected error"));',
    1, [("vote.unexpected", "Unexpected error")])
rep("vote-ui.js",
    'if (msg.indexOf("unknown-account") !== -1) msg = fallback || "Unknown account.";',
    'if (msg.indexOf("unknown-account") !== -1) msg = fallback || t("vote.unknown_account", "Unknown account.");',
    1, [("vote.unknown_account", "Unknown account.")])
rep("vote-ui.js",
    'else if (msg.indexOf("no-account") !== -1) msg = "No on-chain account found for the wallet\'s active key. Enter an account name below.";',
    'else if (msg.indexOf("no-account") !== -1) msg = t("vote.no_account", "No on-chain account found for the wallet\'s active key. Enter an account name below.");',
    1, [("vote.no_account", "No on-chain account found for the wallet's active key. Enter an account name below.")])
rep("vote-ui.js",
    'else if (msg.indexOf("wallet-locked") !== -1) msg = "Wallet is locked.";',
    'else if (msg.indexOf("wallet-locked") !== -1) msg = t("vote.wallet_locked", "Wallet is locked.");',
    1, [("vote.wallet_locked", "Wallet is locked.")])
rep("vote-ui.js",
    'msg = "Network unavailable. Check Settings \\u2192 Nodes and retry.";',
    'msg = t("vote.offline", "Network unavailable. Check Settings \\u2192 Nodes and retry.");',
    1, [("vote.offline", "Network unavailable. Check Settings \u2192 Nodes and retry.")])
rep("vote-ui.js",
    'else if (msg.indexOf("empty-list") !== -1) msg = "The node returned no witnesses or committee members.";',
    'else if (msg.indexOf("empty-list") !== -1) msg = t("vote.empty_list", "The node returned no witnesses or committee members.");',
    1, [("vote.empty_list", "The node returned no witnesses or committee members.")])
rep("vote-ui.js",
    'showError(doc, wrap, "Voting backend missing: js/vote.js, js/tx.js, js/account.js, js/wallet.js or js/format.js failed to load.");',
    'showError(doc, wrap, t("vote.backend_missing", "Voting backend missing: js/vote.js, js/tx.js, js/account.js, js/wallet.js or js/format.js failed to load."));',
    1, [("vote.backend_missing", "Voting backend missing: js/vote.js, js/tx.js, js/account.js, js/wallet.js or js/format.js failed to load.")])
rep("vote-ui.js",
    'el(doc, "h1", "Voting")',
    'el(doc, "h1", t("vote.title", "Voting"))',
    6, [("vote.title", "Voting")] * 6)
rep("vote-ui.js",
    'el(doc, "p", "Connecting to network\\u2026", "muted")',
    'el(doc, "p", t("vote.connecting", "Connecting to network\\u2026"), "muted")',
    1, [("vote.connecting", "Connecting to network\u2026")])
rep("vote-ui.js",
    'showError(doc, failed, new Error("not-connected"), "Network unavailable.");',
    'showError(doc, failed, new Error("not-connected"), t("vote.offline_short", "Network unavailable."));',
    1, [("vote.offline_short", "Network unavailable.")])
rep("vote-ui.js",
    'el(doc, "button", "Retry")',
    'el(doc, "button", t("vote.retry", "Retry"))',
    2, [("vote.retry", "Retry")] * 2)
rep("vote-ui.js",
    '"Wallet is locked. Enter your password to manage your votes."',
    't("vote.unlock_prompt", "Wallet is locked. Enter your password to manage your votes.")',
    1, [("vote.unlock_prompt", "Wallet is locked. Enter your password to manage your votes.")])
rep("vote-ui.js",
    'var label = el(doc, "label", "Password ");',
    'var label = el(doc, "label", t("vote.password_label", "Password "));',
    1, [("vote.password_label", "Password ")])
rep("vote-ui.js",
    'var btn = touchable(el(doc, "button", "Unlock"));',
    'var btn = touchable(el(doc, "button", t("vote.unlock", "Unlock")));',
    1, [("vote.unlock", "Unlock")])
rep("vote-ui.js",
    'errBox.textContent = (e && e.message) ? e.message : String(e || "Unlock failed");',
    'errBox.textContent = (e && e.message) ? e.message : String(e || t("vote.unlock_failed", "Unlock failed"));',
    1, [("vote.unlock_failed", "Unlock failed")])
rep("vote-ui.js",
    'el(doc, "p", "Loading governance data\\u2026", "muted")',
    'el(doc, "p", t("vote.loading", "Loading governance data\\u2026"), "muted")',
    2, [("vote.loading", "Loading governance data\u2026")] * 2)
rep("vote-ui.js",
    'showError(doc, failed, e, "Could not load your account.");',
    'showError(doc, failed, e, t("vote.load_account_failed", "Could not load your account."));',
    1, [("vote.load_account_failed", "Could not load your account.")])
rep("vote-ui.js",
    'var label = el(doc, "label", "Vote as (name or 1.2.N) ");',
    'var label = el(doc, "label", t("vote.vote_as_label", "Vote as (name or 1.2.N) "));',
    1, [("vote.vote_as_label", "Vote as (name or 1.2.N) ")])
rep("vote-ui.js",
    'var btn = touchable(el(doc, "button", "Load votes"));',
    'var btn = touchable(el(doc, "button", t("vote.load_votes", "Load votes")));',
    1, [("vote.load_votes", "Load votes")])
rep("vote-ui.js",
    'errBox.textContent = (e && e.message) ? "Unknown account." : String(e || "Unknown account.");',
    'errBox.textContent = (e && e.message) ? t("vote.unknown_account", "Unknown account.") : String(e || t("vote.unknown_account", "Unknown account."));',
    1, [("vote.unknown_account", "Unknown account.")] * 2)
rep("vote-ui.js",
    'showError(doc, failed, e, "Could not load governance data.");',
    'showError(doc, failed, e, t("vote.load_failed", "Could not load governance data."));',
    1, [("vote.load_failed", "Could not load governance data.")])
rep("vote-ui.js",
    'meLine.textContent = "Voting as: " + me.name + " (" + me.id + ")";',
    'meLine.textContent = t("vote.voting_as", "Voting as: ") + me.name + " (" + me.id + ")";',
    1, [("vote.voting_as", "Voting as: ")])
rep("vote-ui.js",
    ('    line.textContent = hasProxy\n'
     '      ? "Proxy: " + (st.proxyName || st.draft.proxyId) + " \\u2014 your stake follows this account; the slate below is read-only."\n'
     '      : "Proxy: none \\u2014 voting directly.";'),
    ('    line.textContent = hasProxy\n'
     '      ? t("vote.proxy_prefix", "Proxy: ") + (st.proxyName || st.draft.proxyId) + t("vote.proxy_follows", " \\u2014 your stake follows this account; the slate below is read-only.")\n'
     '      : t("vote.proxy_none", "Proxy: none \\u2014 voting directly.");'),
    1, [("vote.proxy_prefix", "Proxy: "),
        ("vote.proxy_follows", " \u2014 your stake follows this account; the slate below is read-only."),
        ("vote.proxy_none", "Proxy: none \u2014 voting directly.")])
rep("vote-ui.js",
    ('      box.appendChild(el(doc, "p", n === 0\n'
     '        ? "This proxy has no votes set."\n'
     '        : "This proxy votes " + n + " item(s).", "muted"));'),
    ('      box.appendChild(el(doc, "p", n === 0\n'
     '        ? t("vote.proxy_empty", "This proxy has no votes set.")\n'
     '        : t("vote.proxy_votes_prefix", "This proxy votes ") + n + t("vote.proxy_votes_suffix", " item(s)."), "muted"));'),
    1, [("vote.proxy_empty", "This proxy has no votes set."),
        ("vote.proxy_votes_prefix", "This proxy votes "),
        ("vote.proxy_votes_suffix", " item(s).")])
rep("vote-ui.js",
    'input.setAttribute("placeholder", "proxy account name or 1.2.N");',
    'input.setAttribute("placeholder", t("vote.proxy_ph", "proxy account name or 1.2.N"));',
    1, [("vote.proxy_ph", "proxy account name or 1.2.N")])
rep("vote-ui.js",
    'input.setAttribute("aria-label", "Proxy account");',
    'input.setAttribute("aria-label", t("vote.proxy_aria", "Proxy account"));',
    1, [("vote.proxy_aria", "Proxy account")])
rep("vote-ui.js",
    'var setBtn = touchable(el(doc, "button", "Set proxy"));',
    'var setBtn = touchable(el(doc, "button", t("vote.set_proxy", "Set proxy")));',
    1, [("vote.set_proxy", "Set proxy")])
rep("vote-ui.js",
    'var rmBtn = touchable(el(doc, "button", "Remove proxy"));',
    'var rmBtn = touchable(el(doc, "button", t("vote.remove_proxy", "Remove proxy")));',
    1, [("vote.remove_proxy", "Remove proxy")])
rep("vote-ui.js",
    'if (!v) { msg.textContent = "Enter a proxy account name or id."; return; }',
    'if (!v) { msg.textContent = t("vote.proxy_needed", "Enter a proxy account name or id."); return; }',
    1, [("vote.proxy_needed", "Enter a proxy account name or id.")])
rep("vote-ui.js",
    'msg.textContent = "Unknown account.";',
    'msg.textContent = t("vote.unknown_account", "Unknown account.");',
    1, [("vote.unknown_account", "Unknown account.")])
rep("vote-ui.js",
    'var pub = touchable(el(doc, "button", "Publish votes"));',
    'var pub = touchable(el(doc, "button", t("vote.publish", "Publish votes")));',
    1, [("vote.publish", "Publish votes")])
rep("vote-ui.js",
    'var reset = touchable(el(doc, "button", "Reset"));',
    'var reset = touchable(el(doc, "button", t("vote.reset", "Reset")));',
    1, [("vote.reset", "Reset")])
rep("vote-ui.js",
    'bar.appendChild(el(doc, "p", "Slate matches the chain \\u2014 no changes to publish.", "muted"));',
    'bar.appendChild(el(doc, "p", t("vote.in_sync", "Slate matches the chain \\u2014 no changes to publish."), "muted"));',
    1, [("vote.in_sync", "Slate matches the chain \u2014 no changes to publish.")])
rep("vote-ui.js",
    'el(doc, "h1", "Confirm votes")',
    'el(doc, "h1", t("vote.confirm_title", "Confirm votes"))',
    3, [("vote.confirm_title", "Confirm votes")] * 3)
rep("vote-ui.js",
    'var status = showStatus(doc, wrap, "Estimating fee\\u2026");',
    'var status = showStatus(doc, wrap, t("vote.estimating_fee", "Estimating fee\\u2026"));',
    1, [("vote.estimating_fee", "Estimating fee\u2026")])
rep("vote-ui.js",
    'if (!memoKey) throw new Error("Account has no memo key.");',
    'if (!memoKey) throw new Error(t("vote.no_memo", "Account has no memo key."));',
    1, [("vote.no_memo", "Account has no memo key.")])
rep("vote-ui.js",
    'showError(doc, failed, e, "Could not prepare the vote.");',
    'showError(doc, failed, e, t("vote.prepare_failed", "Could not prepare the vote."));',
    1, [("vote.prepare_failed", "Could not prepare the vote.")])
rep("vote-ui.js",
    'el(doc, "button", "Back to voting")',
    'el(doc, "button", t("vote.back_to_voting", "Back to voting"))',
    1, [("vote.back_to_voting", "Back to voting")])
rep("vote-ui.js",
    'el(doc, "a", "Back to voting")',
    'el(doc, "a", t("vote.back_to_voting", "Back to voting"))',
    1, [("vote.back_to_voting", "Back to voting")])
rep("vote-ui.js",
    'row("Account", st.me.name + " (" + st.me.id + ")");',
    'row(t("vote.account_row", "Account"), st.me.name + " (" + st.me.id + ")");',
    1, [("vote.account_row", "Account")])
rep("vote-ui.js",
    ('    row("Proxy", hasProxy\n'
     '      ? (st.proxyName || st.draft.proxyId) + " (" + newOptions.voting_account + ")"\n'
     '      : "none \\u2014 voting directly");'),
    ('    row(t("vote.proxy_row", "Proxy"), hasProxy\n'
     '      ? (st.proxyName || st.draft.proxyId) + " (" + newOptions.voting_account + ")"\n'
     '      : t("vote.directly", "none \\u2014 voting directly"));'),
    1, [("vote.proxy_row", "Proxy"),
        ("vote.directly", "none \u2014 voting directly")])
rep("vote-ui.js",
    ('    ["witness", "committee", "worker"].forEach(function (tab) {\n'
     '      var d = VoteSlate.diffNames(st, tab);\n'
     '      var label = tab.charAt(0).toUpperCase() + tab.slice(1);\n'
     '      var finalCount = Object.keys(st.draft[tab]).length;\n'
     '      var text = "final: " + finalCount;\n'
     '      if (d.added.length) text += " \\u00b7 + " + d.added.join(", ");\n'
     '      if (d.removed.length) text += " \\u00b7 \\u2212 " + d.removed.join(", ");\n'
     '      if (!d.added.length && !d.removed.length) text += " (unchanged)";\n'
     '      row(label + " votes", text);\n'
     '    });'),
    ('    ["witness", "committee", "worker"].forEach(function (tab) {\n'
     '      var d = VoteSlate.diffNames(st, tab);\n'
     '      var label = tab.charAt(0).toUpperCase() + tab.slice(1);\n'
     '      var finalCount = Object.keys(st.draft[tab]).length;\n'
     '      var text = t("vote.row_final", "final: ") + finalCount;\n'
     '      if (d.added.length) text += " \\u00b7 + " + d.added.join(", ");\n'
     '      if (d.removed.length) text += " \\u00b7 \\u2212 " + d.removed.join(", ");\n'
     '      if (!d.added.length && !d.removed.length) text += t("vote.row_unchanged", " (unchanged)");\n'
     '      row(label + t("vote.conf_votes", " votes"), text);\n'
     '    });'),
    1, [("vote.row_final", "final: "),
        ("vote.row_unchanged", " (unchanged)"),
        ("vote.conf_votes", " votes")])
rep("vote-ui.js",
    ('    row("Fee", feeHuman + " (core)", feeRaw);\n'
     '    row("Network", network);'),
    ('    row(t("vote.fee_row", "Fee"), feeHuman + t("vote.fee_core", " (core)"), feeRaw);\n'
     '    row(t("vote.network_row", "Network"), network);'),
    1, [("vote.fee_row", "Fee"),
        ("vote.fee_core", " (core)"),
        ("vote.network_row", "Network")])
rep("vote-ui.js",
    'var backBtn = touchable(el(doc, "button", "Back"));',
    'var backBtn = touchable(el(doc, "button", t("vote.back", "Back")));',
    1, [("vote.back", "Back")])
rep("vote-ui.js",
    'var sendBtn = touchable(el(doc, "button", "Sign & Publish"));',
    'var sendBtn = touchable(el(doc, "button", t("vote.sign_publish", "Sign & Publish")));',
    1, [("vote.sign_publish", "Sign & Publish")])
rep("vote-ui.js",
    'var status = showStatus(doc, wrap, "Signing\\u2026");',
    'var status = showStatus(doc, wrap, t("vote.signing", "Signing\\u2026"));',
    1, [("vote.signing", "Signing\u2026")])
rep("vote-ui.js",
    'showError(doc, wrap, new Error("wallet-locked"), "Wallet is locked.");',
    'showError(doc, wrap, new Error("wallet-locked"), t("vote.wallet_locked", "Wallet is locked."));',
    1, [("vote.wallet_locked", "Wallet is locked.")])
rep("vote-ui.js",
    'onStep("Broadcasting\\u2026");',
    'onStep(t("vote.broadcasting", "Broadcasting\\u2026"));',
    1, [("vote.broadcasting", "Broadcasting\u2026")])
rep("vote-ui.js",
    'onStep("Node rejected the 1.2.5 proxy mode \\u2014 retrying once as self\\u2026");',
    'onStep(t("vote.retry_self", "Node rejected the 1.2.5 proxy mode \\u2014 retrying once as self\\u2026"));',
    1, [("vote.retry_self", "Node rejected the 1.2.5 proxy mode \u2014 retrying once as self\u2026")])
rep("vote-ui.js",
    ('    throw new Error("Sent (" + via + ") but the new slate was not observed within " +\n'
     '      (PROVE_TIMEOUT_MS / 1000) + "s; check #/voting before retrying " +\n'
     '      "(do NOT blindly rebroadcast).");'),
    ('    throw new Error(t("vote.sent_prefix", "Sent (") + via + t("vote.sent_middle", ") but the new slate was not observed within ") +\n'
     '      (PROVE_TIMEOUT_MS / 1000) + t("vote.sent_suffix", "s; check #/voting before retrying ") +\n'
     '      t("vote.sent_note", "(do NOT blindly rebroadcast)."));'),
    1, [("vote.sent_prefix", "Sent ("),
        ("vote.sent_middle", ") but the new slate was not observed within "),
        ("vote.sent_suffix", "s; check #/voting before retrying "),
        ("vote.sent_note", "(do NOT blindly rebroadcast).")])
rep("vote-ui.js",
    'wrap.appendChild(el(doc, "h1", errText ? "Vote failed" : "Votes published"));',
    'wrap.appendChild(el(doc, "h1", errText ? t("vote.result_failed", "Vote failed") : t("vote.result_ok", "Votes published")));',
    1, [("vote.result_failed", "Vote failed"),
        ("vote.result_ok", "Votes published")])
rep("vote-ui.js",
    'showError(doc, wrap, errText, "Vote publish failed.");',
    'showError(doc, wrap, errText, t("vote.publish_failed", "Vote publish failed."));',
    1, [("vote.publish_failed", "Vote publish failed.")])
rep("vote-ui.js",
    ('      var ok = el(doc, "p", "Observed at head block #" + String(res.blockNum) +\n'
     '        " (" + res.via + ").", "xfer-ok");'),
    ('      var ok = el(doc, "p", t("vote.observed_prefix", "Observed at head block #") + String(res.blockNum) +\n'
     '        " (" + res.via + ").", "xfer-ok");'),
    1, [("vote.observed_prefix", "Observed at head block #")])
rep("vote-ui.js",
    ('      wrap.appendChild(el(doc, "p",\n'
     '        res.retried\n'
     '          ? "The node rejected proxy mode 1.2.5, so the vote was published as self (voting_account " + st.me.id + ")."\n'
     '          : "Published voting directly (voting_account 1.2.5).", "muted"));'),
    ('      wrap.appendChild(el(doc, "p",\n'
     '        res.retried\n'
     '          ? t("vote.retried_prefix", "The node rejected proxy mode 1.2.5, so the vote was published as self (voting_account ") + st.me.id + ")."\n'
     '          : t("vote.direct_note", "Published voting directly (voting_account 1.2.5)."), "muted"));'),
    1, [("vote.retried_prefix", "The node rejected proxy mode 1.2.5, so the vote was published as self (voting_account "),
        ("vote.direct_note", "Published voting directly (voting_account 1.2.5).")])
rep("vote-ui.js",
    'showError(doc, wrap, (e && e.message) ? e.message : String(e || "Publish failed"), "Vote publish failed.");',
    'showError(doc, wrap, (e && e.message) ? e.message : String(e || t("vote.publish_fallback", "Publish failed")), t("vote.publish_failed", "Vote publish failed."));',
    1, [("vote.publish_fallback", "Publish failed"),
        ("vote.publish_failed", "Vote publish failed.")])

# -------------------------------------------------------------- vote-slate.js
helper("vote-slate.js", 'var VoteSlate = (function () {\n  "use strict";')

rep("vote-slate.js",
    ('    var tabs = [\n'
     '      ["witness", "Witnesses (" + setSize(st.draft.witness) + ")"],\n'
     '      ["committee", "Committee (" + setSize(st.draft.committee) + ")"],\n'
     '      ["worker", "Workers (" + setSize(st.draft.worker) + ")"]\n'
     '    ];'),
    ('    var tabs = [\n'
     '      ["witness", t("vote.tab_witnesses", "Witnesses (") + setSize(st.draft.witness) + ")"],\n'
     '      ["committee", t("vote.tab_committee", "Committee (") + setSize(st.draft.committee) + ")"],\n'
     '      ["worker", t("vote.tab_workers", "Workers (") + setSize(st.draft.worker) + ")"]\n'
     '    ];'),
    1, [("vote.tab_witnesses", "Witnesses ("),
        ("vote.tab_committee", "Committee ("),
        ("vote.tab_workers", "Workers (")])
rep("vote-slate.js",
    'search.setAttribute("placeholder", "Search " + st.tab + "\\u2026");',
    'search.setAttribute("placeholder", t("vote.search_prefix", "Search ") + st.tab + "\\u2026");',
    1, [("vote.search_prefix", "Search ")])
rep("vote-slate.js",
    'search.setAttribute("aria-label", "Search " + st.tab);',
    'search.setAttribute("aria-label", t("vote.search_prefix", "Search ") + st.tab);',
    1, [("vote.search_prefix", "Search ")])
rep("vote-slate.js",
    ('        rowsBox.appendChild(el(doc, "p",\n'
     '          st.tab === "worker"\n'
     '            ? "No workers found. Testnets often have none \\u2014 this is valid, not an error."\n'
     '            : "Nothing in this list.", "muted"));'),
    ('        rowsBox.appendChild(el(doc, "p",\n'
     '          st.tab === "worker"\n'
     '            ? t("vote.no_workers", "No workers found. Testnets often have none \\u2014 this is valid, not an error.")\n'
     '            : t("vote.empty_tab", "Nothing in this list."), "muted"));'),
    1, [("vote.no_workers", "No workers found. Testnets often have none \u2014 this is valid, not an error."),
        ("vote.empty_tab", "Nothing in this list.")])
rep("vote-slate.js",
    'rowsBox.appendChild(el(doc, "p", "No matches for this search.", "muted"));',
    'rowsBox.appendChild(el(doc, "p", t("vote.no_matches", "No matches for this search."), "muted"));',
    1, [("vote.no_matches", "No matches for this search.")])
rep("vote-slate.js",
    'box.setAttribute("aria-label", "Vote for " + (e.name || e.id));',
    'box.setAttribute("aria-label", t("vote.vote_for", "Vote for ") + (e.name || e.id));',
    1, [("vote.vote_for", "Vote for ")])
rep("vote-slate.js",
    'var title = el(doc, "strong", (e.name || "(unnamed)") + " ");',
    'var title = el(doc, "strong", (e.name || t("vote.unnamed", "(unnamed)")) + " ");',
    1, [("vote.unnamed", "(unnamed)")])
rep("vote-slate.js",
    'main.appendChild(el(doc, "span", e.id + (e.active ? " \\u25cf active" : ""), "muted"));',
    'main.appendChild(el(doc, "span", e.id + (e.active ? t("vote.active_mark", " \\u25cf active") : ""), "muted"));',
    1, [("vote.active_mark", " \u25cf active")])
rep("vote-slate.js",
    ('      var sub = el(doc, "div",\n'
     '        "Pay/day " + pay + " \\u00b7 " + (e.extra.work_begin_date || "?") + " \\u2192 " +\n'
     '        (e.extra.work_end_date || "?") + " \\u00b7 for " +\n'
     '        humanWeight(e.total_raw, st.supply) + " / against " +\n'
     '        humanWeight(e.extra.total_against_raw || "0", st.supply), "muted");'),
    ('      var sub = el(doc, "div",\n'
     '        t("vote.worker_pay", "Pay/day ") + pay + " \\u00b7 " + (e.extra.work_begin_date || "?") + " \\u2192 " +\n'
     '        (e.extra.work_end_date || "?") + t("vote.worker_for", " \\u00b7 for ") +\n'
     '        humanWeight(e.total_raw, st.supply) + t("vote.worker_against", " / against ") +\n'
     '        humanWeight(e.extra.total_against_raw || "0", st.supply), "muted");'),
    1, [("vote.worker_pay", "Pay/day "),
        ("vote.worker_for", " \u00b7 for "),
        ("vote.worker_against", " / against ")])

# ------------------------------------------------------------- explorer-ui.js
helper("explorer-ui.js", 'var ExplorerUI = (function () {\n  "use strict";')

rep("explorer-ui.js",
    '? e.message : String(e || fallback || "Unexpected error");',
    '? e.message : String(e || fallback || t("explorer.unexpected", "Unexpected error"));',
    1, [("explorer.unexpected", "Unexpected error")])
rep("explorer-ui.js",
    'if (msg.indexOf("unknown-block") !== -1) msg = "Unknown block.";',
    'if (msg.indexOf("unknown-block") !== -1) msg = t("explorer.unknown_block", "Unknown block.");',
    1, [("explorer.unknown_block", "Unknown block.")])
rep("explorer-ui.js",
    'else if (msg.indexOf("unknown-tx") !== -1) msg = "Unknown transaction.";',
    'else if (msg.indexOf("unknown-tx") !== -1) msg = t("explorer.unknown_tx", "Unknown transaction.");',
    1, [("explorer.unknown_tx", "Unknown transaction.")])
rep("explorer-ui.js",
    'else if (msg.indexOf("unknown-asset") !== -1) msg = fallback || "Unknown asset.";',
    'else if (msg.indexOf("unknown-asset") !== -1) msg = fallback || t("explorer.unknown_asset", "Unknown asset.");',
    1, [("explorer.unknown_asset", "Unknown asset.")])
rep("explorer-ui.js",
    'else if (msg.indexOf("unknown-object") !== -1) msg = fallback || "Nothing found for that search.";',
    'else if (msg.indexOf("unknown-object") !== -1) msg = fallback || t("explorer.not_found", "Nothing found for that search.");',
    1, [("explorer.not_found", "Nothing found for that search.")])
rep("explorer-ui.js",
    'else if (msg.indexOf("tx-expired-or-unknown") !== -1) msg = "Transaction hash lookup covers recent transactions only \\u2014 this one is expired or unknown.";',
    'else if (msg.indexOf("tx-expired-or-unknown") !== -1) msg = t("explorer.tx_expired", "Transaction hash lookup covers recent transactions only \\u2014 this one is expired or unknown.");',
    1, [("explorer.tx_expired", "Transaction hash lookup covers recent transactions only \u2014 this one is expired or unknown.")])
rep("explorer-ui.js",
    'msg = "Network unavailable. Check Settings \\u2192 Nodes and retry.";',
    'msg = t("explorer.offline", "Network unavailable. Check Settings \\u2192 Nodes and retry.");',
    1, [("explorer.offline", "Network unavailable. Check Settings \u2192 Nodes and retry.")])
rep("explorer-ui.js",
    'el(doc, "h1", "Explorer")',
    'el(doc, "h1", t("explorer.title", "Explorer"))',
    3, [("explorer.title", "Explorer")] * 3)
rep("explorer-ui.js",
    'el(doc, "p", "Connecting to network\\u2026", "muted")',
    'el(doc, "p", t("explorer.connecting", "Connecting to network\\u2026"), "muted")',
    1, [("explorer.connecting", "Connecting to network\u2026")])
rep("explorer-ui.js",
    'showError(doc, failed, new Error("not-connected"), "Network unavailable.");',
    'showError(doc, failed, new Error("not-connected"), t("explorer.offline_short", "Network unavailable."));',
    1, [("explorer.offline_short", "Network unavailable.")])
rep("explorer-ui.js",
    'el(doc, "button", "Retry")',
    'el(doc, "button", t("explorer.retry", "Retry"))',
    1, [("explorer.retry", "Retry")])
rep("explorer-ui.js",
    'showError(doc, wrap, "Explorer backend missing: js/explorer.js or js/format.js failed to load.");',
    'showError(doc, wrap, t("explorer.backend_missing", "Explorer backend missing: js/explorer.js or js/format.js failed to load."));',
    1, [("explorer.backend_missing", "Explorer backend missing: js/explorer.js or js/format.js failed to load.")])
rep("explorer-ui.js",
    'if (noted) wrap.appendChild(el(doc, "p", "Unknown tab \\u201c" + noted + "\\u201d \\u2014 showing Blocks.", "muted"));',
    'if (noted) wrap.appendChild(el(doc, "p", t("explorer.unknown_tab_prefix", "Unknown tab \\u201c") + noted + t("explorer.unknown_tab_suffix", "\\u201d \\u2014 showing Blocks."), "muted"));',
    1, [("explorer.unknown_tab_prefix", "Unknown tab \u201c"),
        ("explorer.unknown_tab_suffix", "\u201d \u2014 showing Blocks.")])
rep("explorer-ui.js",
    'input.setAttribute("placeholder", "Search: 1.x.y, account, or asset symbol");',
    'input.setAttribute("placeholder", t("explorer.search_ph", "Search: 1.x.y, account, or asset symbol"));',
    1, [("explorer.search_ph", "Search: 1.x.y, account, or asset symbol")])
rep("explorer-ui.js",
    'input.setAttribute("aria-label", "Search blocks, accounts, assets");',
    'input.setAttribute("aria-label", t("explorer.search_aria", "Search blocks, accounts, assets"));',
    1, [("explorer.search_aria", "Search blocks, accounts, assets")])
rep("explorer-ui.js",
    'var go = touchable(el(doc, "button", "Search"));',
    'var go = touchable(el(doc, "button", t("explorer.search", "Search")));',
    1, [("explorer.search", "Search")])
rep("explorer-ui.js",
    'showError(doc, msg, e, "Nothing found for that search.");',
    'showError(doc, msg, e, t("explorer.not_found", "Nothing found for that search."));',
    1, [("explorer.not_found", "Nothing found for that search.")])
# Tab buttons compute their labels ("Blocks"/"Assets"/"Feeds") from the tab id
# -- a dynamic composition with no separable literal (batch-2b leaves its
# "Buy "/"Sell " the same way), so the TABS loop below stays raw: no pair
# emitted for it (no t() inside, no rename needed).
rep("explorer-ui.js",
    ('      box.appendChild(el(doc, "p",\n'
     '        "Head #" + h.head_block_number + " \\u00b7 " + h.head_block_time +\n'
     '        " \\u00b7 irreversible #" + h.last_irreversible_block_num, "muted"));'),
    ('      box.appendChild(el(doc, "p",\n'
     '        t("explorer.head_prefix", "Head #") + h.head_block_number + " \\u00b7 " + h.head_block_time +\n'
     '        t("explorer.head_lib", " \\u00b7 irreversible #") + h.last_irreversible_block_num, "muted"));'),
    1, [("explorer.head_prefix", "Head #"),
        ("explorer.head_lib", " \u00b7 irreversible #")])
rep("explorer-ui.js",
    'box.appendChild(el(doc, "p", "Head block unavailable.", "muted"));',
    'box.appendChild(el(doc, "p", t("explorer.head_unavailable", "Head block unavailable."), "muted"));',
    1, [("explorer.head_unavailable", "Head block unavailable.")])
rep("explorer-ui.js",
    'showError(doc, wrap, "Explorer view missing: " + file + " failed to load.");',
    'showError(doc, wrap, t("explorer.view_missing_prefix", "Explorer view missing: ") + file + t("explorer.view_missing_suffix", " failed to load."));',
    1, [("explorer.view_missing_prefix", "Explorer view missing: "),
        ("explorer.view_missing_suffix", " failed to load.")])
rep("explorer-ui.js",
    'showStatus(doc, panel, "Loading " + id + "\\u2026");',
    'showStatus(doc, panel, t("explorer.loading_prefix", "Loading ") + id + "\\u2026");',
    1, [("explorer.loading_prefix", "Loading ")])
rep("explorer-ui.js",
    'showError(doc, panel, "Explorer object view missing: js/explorer-assets.js failed to load.");',
    'showError(doc, panel, t("explorer.object_missing", "Explorer object view missing: js/explorer-assets.js failed to load."));',
    1, [("explorer.object_missing", "Explorer object view missing: js/explorer-assets.js failed to load.")])
rep("explorer-ui.js",
    'showError(doc, panel, e, "Could not load " + id + ".");',
    'showError(doc, panel, e, t("explorer.object_failed_prefix", "Could not load ") + id + ".");',
    1, [("explorer.object_failed_prefix", "Could not load ")])
rep("explorer-ui.js",
    'showError(doc, body, "Explorer blocks view missing: js/explorer-blocks.js failed to load.");',
    'showError(doc, body, t("explorer.blocks_missing", "Explorer blocks view missing: js/explorer-blocks.js failed to load."));',
    1, [("explorer.blocks_missing", "Explorer blocks view missing: js/explorer-blocks.js failed to load.")])
rep("explorer-ui.js",
    'showError(doc, body, "Explorer assets view missing: js/explorer-assets.js failed to load.");',
    'showError(doc, body, t("explorer.assets_missing", "Explorer assets view missing: js/explorer-assets.js failed to load."));',
    1, [("explorer.assets_missing", "Explorer assets view missing: js/explorer-assets.js failed to load.")])
rep("explorer-ui.js",
    'showError(doc, body, "Explorer feeds view missing: js/explorer-assets.js failed to load.");',
    'showError(doc, body, t("explorer.feeds_missing", "Explorer feeds view missing: js/explorer-assets.js failed to load."));',
    1, [("explorer.feeds_missing", "Explorer feeds view missing: js/explorer-assets.js failed to load.")])

# ---------------------------------------------------------- explorer-blocks.js
helper("explorer-blocks.js", 'var ExplorerBlocks = (function () {\n  "use strict";')

rep("explorer-blocks.js",
    '? e.message : String(e || fallback || "Unexpected error");',
    '? e.message : String(e || fallback || t("explorer.unexpected", "Unexpected error"));',
    1, [("explorer.unexpected", "Unexpected error")])
rep("explorer-blocks.js",
    'if (msg.indexOf("unknown-block") !== -1) msg = "Unknown block.";',
    'if (msg.indexOf("unknown-block") !== -1) msg = t("explorer.unknown_block", "Unknown block.");',
    1, [("explorer.unknown_block", "Unknown block.")])
rep("explorer-blocks.js",
    'else if (msg.indexOf("unknown-tx") !== -1) msg = "Unknown transaction.";',
    'else if (msg.indexOf("unknown-tx") !== -1) msg = t("explorer.unknown_tx", "Unknown transaction.");',
    1, [("explorer.unknown_tx", "Unknown transaction.")])
rep("explorer-blocks.js",
    'else if (msg.indexOf("unknown-asset") !== -1) msg = fallback || "Unknown asset.";',
    'else if (msg.indexOf("unknown-asset") !== -1) msg = fallback || t("explorer.unknown_asset", "Unknown asset.");',
    1, [("explorer.unknown_asset", "Unknown asset.")])
rep("explorer-blocks.js",
    'else if (msg.indexOf("unknown-object") !== -1) msg = fallback || "Nothing found for that search.";',
    'else if (msg.indexOf("unknown-object") !== -1) msg = fallback || t("explorer.not_found", "Nothing found for that search.");',
    1, [("explorer.not_found", "Nothing found for that search.")])
rep("explorer-blocks.js",
    'else if (msg.indexOf("tx-expired-or-unknown") !== -1) msg = "Transaction hash lookup covers recent transactions only \\u2014 this one is expired or unknown.";',
    'else if (msg.indexOf("tx-expired-or-unknown") !== -1) msg = t("explorer.tx_expired", "Transaction hash lookup covers recent transactions only \\u2014 this one is expired or unknown.");',
    1, [("explorer.tx_expired", "Transaction hash lookup covers recent transactions only \u2014 this one is expired or unknown.")])
rep("explorer-blocks.js",
    'msg = "Network unavailable. Check Settings \\u2192 Nodes and retry.";',
    'msg = t("explorer.offline", "Network unavailable. Check Settings \\u2192 Nodes and retry.");',
    1, [("explorer.offline", "Network unavailable. Check Settings \u2192 Nodes and retry.")])
rep("explorer-blocks.js",
    'return el(doc, "p", "Operation view unavailable.", "muted");',
    'return el(doc, "p", t("explorer.op_unavailable", "Operation view unavailable."), "muted");',
    1, [("explorer.op_unavailable", "Operation view unavailable.")])
rep("explorer-blocks.js",
    'showStatus(doc, body, "Loading blocks\\u2026");',
    'showStatus(doc, body, t("explorer.loading_blocks", "Loading blocks\\u2026"));',
    1, [("explorer.loading_blocks", "Loading blocks\u2026")])
rep("explorer-blocks.js",
    'body.appendChild(el(doc, "p", "No blocks found.", "muted"));',
    'body.appendChild(el(doc, "p", t("explorer.no_blocks", "No blocks found."), "muted"));',
    1, [("explorer.no_blocks", "No blocks found.")])
rep("explorer-blocks.js",
    'body.appendChild(scrollTable(doc, ["Height", "Time", "Witness", "Txs"], tableRows));',
    'body.appendChild(scrollTable(doc, [t("explorer.th_height", "Height"), t("explorer.th_time", "Time"), t("explorer.th_witness", "Witness"), t("explorer.th_txs", "Txs")], tableRows));',
    1, [("explorer.th_height", "Height"),
        ("explorer.th_time", "Time"),
        ("explorer.th_witness", "Witness"),
        ("explorer.th_txs", "Txs")])
rep("explorer-blocks.js",
    'var older = touchable(el(doc, "button", "Older blocks"));',
    'var older = touchable(el(doc, "button", t("explorer.older", "Older blocks")));',
    1, [("explorer.older", "Older blocks")])
rep("explorer-blocks.js",
    'showError(doc, body, e, "Could not load blocks.");',
    'showError(doc, body, e, t("explorer.blocks_failed", "Could not load blocks."));',
    1, [("explorer.blocks_failed", "Could not load blocks.")])
rep("explorer-blocks.js",
    'el(doc, "button", "Retry")',
    'el(doc, "button", t("explorer.retry", "Retry"))',
    1, [("explorer.retry", "Retry")])
rep("explorer-blocks.js",
    'showError(doc, wrap, "Explorer backend missing: js/explorer.js failed to load.");',
    'showError(doc, wrap, t("explorer.backend_missing_core", "Explorer backend missing: js/explorer.js failed to load."));',
    2, [("explorer.backend_missing_core", "Explorer backend missing: js/explorer.js failed to load.")] * 2)
rep("explorer-blocks.js",
    'wrap.appendChild(el(doc, "h1", "Block"));',
    'wrap.appendChild(el(doc, "h1", t("explorer.block_title", "Block")));',
    1, [("explorer.block_title", "Block")])
rep("explorer-blocks.js",
    'showError(doc, wrap, new Error("unknown-block"), "Unknown block.");',
    'showError(doc, wrap, new Error("unknown-block"), t("explorer.unknown_block", "Unknown block."));',
    1, [("explorer.unknown_block", "Unknown block.")])
rep("explorer-blocks.js",
    'el(doc, "h1", "Block #" + h)',
    'el(doc, "h1", t("explorer.block_prefix", "Block #") + h)',
    2, [("explorer.block_prefix", "Block #")] * 2)
rep("explorer-blocks.js",
    'el(doc, "h1", "Block #" + b.height)',
    'el(doc, "h1", t("explorer.block_prefix", "Block #") + b.height)',
    1, [("explorer.block_prefix", "Block #")])
rep("explorer-blocks.js",
    'showStatus(doc, wrap, "Loading block\\u2026");',
    'showStatus(doc, wrap, t("explorer.loading_block", "Loading block\\u2026"));',
    1, [("explorer.loading_block", "Loading block\u2026")])
rep("explorer-blocks.js",
    'row("Time", b.timestamp || "\\u2014");',
    'row(t("explorer.time_row", "Time"), b.timestamp || "\\u2014");',
    1, [("explorer.time_row", "Time")])
rep("explorer-blocks.js",
    'row("Witness", witnessCell(doc, b.witness_account_id, myGen));',
    'row(t("explorer.witness_row", "Witness"), witnessCell(doc, b.witness_account_id, myGen));',
    1, [("explorer.witness_row", "Witness")])
rep("explorer-blocks.js",
    'row("Transactions", String(b.tx_count));',
    'row(t("explorer.txs_row", "Transactions"), String(b.tx_count));',
    1, [("explorer.txs_row", "Transactions")])
rep("explorer-blocks.js",
    'row("Irreversible", b.height <= head.last_irreversible_block_num ? "yes" : "no (recent)");',
    'row(t("explorer.irreversible_row", "Irreversible"), b.height <= head.last_irreversible_block_num ? t("explorer.yes", "yes") : t("explorer.no_recent", "no (recent)"));',
    1, [("explorer.irreversible_row", "Irreversible"),
        ("explorer.yes", "yes"),
        ("explorer.no_recent", "no (recent)")])
rep("explorer-blocks.js",
    'wrap.appendChild(el(doc, "p", "No transactions in this block.", "muted"));',
    'wrap.appendChild(el(doc, "p", t("explorer.no_txs", "No transactions in this block."), "muted"));',
    1, [("explorer.no_txs", "No transactions in this block.")])
rep("explorer-blocks.js",
    ('        b.transactions.forEach(function (t) {\n'
     '          var line = el(doc, "div", null, "xplore-txline");\n'
     '          line.appendChild(anchor(doc, "Tx " + t.index + " (" + t.op_count + " op" +\n'
     '            (t.op_count === 1 ? "" : "s") + ")", "#/block/" + b.height + "/" + t.index));\n'
     '          var chips = t.ops.map(function (o) {'),
    ('        b.transactions.forEach(function (tx) {\n'
     '          var line = el(doc, "div", null, "xplore-txline");\n'
     '          line.appendChild(anchor(doc, t("explorer.tx_prefix", "Tx ") + tx.index + " (" + tx.op_count + " op" +\n'
     '            (tx.op_count === 1 ? "" : "s") + ")", "#/block/" + b.height + "/" + tx.index));\n'
     '          var chips = tx.ops.map(function (o) {'),
    1, [("explorer.tx_prefix", "Tx ")])
rep("explorer-blocks.js",
    'el(doc, "h1", "Transaction " + h + " / " + txIndex)',
    'el(doc, "h1", t("explorer.tx_title_prefix", "Transaction ") + h + " / " + txIndex)',
    2, [("explorer.tx_title_prefix", "Transaction ")] * 2)
rep("explorer-blocks.js",
    'showError(doc, wrap, new Error("unknown-tx"), "Unknown transaction.");',
    'showError(doc, wrap, new Error("unknown-tx"), t("explorer.unknown_tx", "Unknown transaction."));',
    1, [("explorer.unknown_tx", "Unknown transaction.")])
rep("explorer-blocks.js",
    'showStatus(doc, wrap, "Loading transaction\\u2026");',
    'showStatus(doc, wrap, t("explorer.loading_tx", "Loading transaction\\u2026"));',
    1, [("explorer.loading_tx", "Loading transaction\u2026")])
rep("explorer-blocks.js",
    ('    Explorer.tx(h, ix).then(function (t) {\n'
     '      if (!isCurrent(myGen)) return;\n'
     '      while (wrap.firstChild) wrap.removeChild(wrap.firstChild);\n'
     '      wrap.appendChild(el(doc, "h1", "Transaction " + t.block + " / " + t.index));\n'
     '      wrap.appendChild(anchor(doc, "\\u2190 Block #" + t.block, "#/block/" + t.block));\n'
     '      var ctx = { gen: myGen, root: root, tab: "blocks" };\n'
     '      if (t.ops.length === 0) wrap.appendChild(el(doc, "p", "No operations in this transaction.", "muted"));\n'
     '      t.ops.forEach(function (op, k) {\n'
     '        wrap.appendChild(opSection(doc, op, ctx, "Op " + k));\n'
     '      });\n'
     '      if (t.signatures.length > 0) {\n'
     '        wrap.appendChild(el(doc, "h3", "Signatures (" + t.signatures.length + ")"));\n'
     '        var ul = doc.createElement("ul");\n'
     '        t.signatures.forEach(function (sig) {'),
    ('    Explorer.tx(h, ix).then(function (tx) {\n'
     '      if (!isCurrent(myGen)) return;\n'
     '      while (wrap.firstChild) wrap.removeChild(wrap.firstChild);\n'
     '      wrap.appendChild(el(doc, "h1", t("explorer.tx_title_prefix", "Transaction ") + tx.block + " / " + tx.index));\n'
     '      wrap.appendChild(anchor(doc, t("explorer.back_to_block_prefix", "\\u2190 Block #") + tx.block, "#/block/" + tx.block));\n'
     '      var ctx = { gen: myGen, root: root, tab: "blocks" };\n'
     '      if (tx.ops.length === 0) wrap.appendChild(el(doc, "p", t("explorer.no_ops", "No operations in this transaction."), "muted"));\n'
     '      tx.ops.forEach(function (op, k) {\n'
     '        wrap.appendChild(opSection(doc, op, ctx, t("explorer.op_prefix", "Op ") + k));\n'
     '      });\n'
     '      if (tx.signatures.length > 0) {\n'
     '        wrap.appendChild(el(doc, "h3", t("explorer.signatures_prefix", "Signatures (") + tx.signatures.length + ")"));\n'
     '        var ul = doc.createElement("ul");\n'
     '        tx.signatures.forEach(function (sig) {'),
    1, [("explorer.tx_title_prefix", "Transaction "),
        ("explorer.back_to_block_prefix", "\u2190 Block #"),
        ("explorer.no_ops", "No operations in this transaction."),
        ("explorer.op_prefix", "Op "),
        ("explorer.signatures_prefix", "Signatures (")])
rep("explorer-blocks.js",
    'showError(doc, wrap, e, "Unknown transaction.");',
    'showError(doc, wrap, e, t("explorer.unknown_tx", "Unknown transaction."));',
    1, [("explorer.unknown_tx", "Unknown transaction.")])
rep("explorer-blocks.js",
    'showError(doc, wrap, e, "Unknown block.");',
    'showError(doc, wrap, e, t("explorer.unknown_block", "Unknown block."));',
    1, [("explorer.unknown_block", "Unknown block.")])

# ---------------------------------------------------------- explorer-assets.js
helper("explorer-assets.js", 'var ExplorerAssets = (function () {\n  "use strict";')

rep("explorer-assets.js",
    '? e.message : String(e || fallback || "Unexpected error");',
    '? e.message : String(e || fallback || t("explorer.unexpected", "Unexpected error"));',
    1, [("explorer.unexpected", "Unexpected error")])
rep("explorer-assets.js",
    'if (msg.indexOf("unknown-block") !== -1) msg = "Unknown block.";',
    'if (msg.indexOf("unknown-block") !== -1) msg = t("explorer.unknown_block", "Unknown block.");',
    1, [("explorer.unknown_block", "Unknown block.")])
rep("explorer-assets.js",
    'else if (msg.indexOf("unknown-tx") !== -1) msg = "Unknown transaction.";',
    'else if (msg.indexOf("unknown-tx") !== -1) msg = t("explorer.unknown_tx", "Unknown transaction.");',
    1, [("explorer.unknown_tx", "Unknown transaction.")])
rep("explorer-assets.js",
    'else if (msg.indexOf("unknown-asset") !== -1) msg = fallback || "Unknown asset.";',
    'else if (msg.indexOf("unknown-asset") !== -1) msg = fallback || t("explorer.unknown_asset", "Unknown asset.");',
    1, [("explorer.unknown_asset", "Unknown asset.")])
rep("explorer-assets.js",
    'else if (msg.indexOf("unknown-object") !== -1) msg = fallback || "Nothing found for that search.";',
    'else if (msg.indexOf("unknown-object") !== -1) msg = fallback || t("explorer.not_found", "Nothing found for that search.");',
    1, [("explorer.not_found", "Nothing found for that search.")])
rep("explorer-assets.js",
    'else if (msg.indexOf("tx-expired-or-unknown") !== -1) msg = "Transaction hash lookup covers recent transactions only \\u2014 this one is expired or unknown.";',
    'else if (msg.indexOf("tx-expired-or-unknown") !== -1) msg = t("explorer.tx_expired", "Transaction hash lookup covers recent transactions only \\u2014 this one is expired or unknown.");',
    1, [("explorer.tx_expired", "Transaction hash lookup covers recent transactions only \u2014 this one is expired or unknown.")])
rep("explorer-assets.js",
    'msg = "Network unavailable. Check Settings \\u2192 Nodes and retry.";',
    'msg = t("explorer.offline", "Network unavailable. Check Settings \\u2192 Nodes and retry.");',
    1, [("explorer.offline", "Network unavailable. Check Settings \u2192 Nodes and retry.")])
rep("explorer-assets.js",
    'showStatus(doc, body, "Loading assets\\u2026");',
    'showStatus(doc, body, t("explorer.loading_assets", "Loading assets\\u2026"));',
    1, [("explorer.loading_assets", "Loading assets\u2026")])
rep("explorer-assets.js",
    'body.appendChild(el(doc, "p", "No assets on this page.", "muted"));',
    'body.appendChild(el(doc, "p", t("explorer.no_assets", "No assets on this page."), "muted"));',
    1, [("explorer.no_assets", "No assets on this page.")])
rep("explorer-assets.js",
    'body.appendChild(scrollTable(doc, ["Symbol", "Issuer", "Precision", "Supply"], tableRows));',
    'body.appendChild(scrollTable(doc, [t("explorer.th_symbol", "Symbol"), t("explorer.th_issuer", "Issuer"), t("explorer.th_precision", "Precision"), t("explorer.th_supply", "Supply")], tableRows));',
    1, [("explorer.th_symbol", "Symbol"),
        ("explorer.th_issuer", "Issuer"),
        ("explorer.th_precision", "Precision"),
        ("explorer.th_supply", "Supply")])
rep("explorer-assets.js",
    'var prev = touchable(el(doc, "button", "\\u2190 Prev"));',
    'var prev = touchable(el(doc, "button", t("explorer.prev", "\\u2190 Prev")));',
    1, [("explorer.prev", "\u2190 Prev")])
rep("explorer-assets.js",
    'var next = touchable(el(doc, "button", "Next \\u2192"));',
    'var next = touchable(el(doc, "button", t("explorer.next", "Next \\u2192")));',
    1, [("explorer.next", "Next \u2192")])
rep("explorer-assets.js",
    'showError(doc, body, e, "Could not load assets.");',
    'showError(doc, body, e, t("explorer.assets_failed", "Could not load assets."));',
    1, [("explorer.assets_failed", "Could not load assets.")])
rep("explorer-assets.js",
    'el(doc, "button", "Retry")',
    'el(doc, "button", t("explorer.retry", "Retry"))',
    1, [("explorer.retry", "Retry")])
rep("explorer-assets.js",
    'showError(doc, wrap, "Explorer backend missing: js/explorer.js failed to load.");',
    'showError(doc, wrap, t("explorer.backend_missing_core", "Explorer backend missing: js/explorer.js failed to load."));',
    1, [("explorer.backend_missing_core", "Explorer backend missing: js/explorer.js failed to load.")])
rep("explorer-assets.js",
    'wrap.appendChild(el(doc, "h1", "Asset"));',
    'wrap.appendChild(el(doc, "h1", t("explorer.asset_title", "Asset")));',
    1, [("explorer.asset_title", "Asset")])
rep("explorer-assets.js",
    'showError(doc, wrap, new Error("unknown-asset"), "Unknown asset.");',
    'showError(doc, wrap, new Error("unknown-asset"), t("explorer.unknown_asset", "Unknown asset."));',
    1, [("explorer.unknown_asset", "Unknown asset.")])
rep("explorer-assets.js",
    'el(doc, "h1", "Asset " + symbol)',
    'el(doc, "h1", t("explorer.asset_prefix", "Asset ") + symbol)',
    2, [("explorer.asset_prefix", "Asset ")] * 2)
rep("explorer-assets.js",
    'el(doc, "h1", "Asset " + a.symbol)',
    'el(doc, "h1", t("explorer.asset_prefix", "Asset ") + a.symbol)',
    1, [("explorer.asset_prefix", "Asset ")])
rep("explorer-assets.js",
    'showStatus(doc, wrap, "Loading asset\\u2026");',
    'showStatus(doc, wrap, t("explorer.loading_asset", "Loading asset\\u2026"));',
    1, [("explorer.loading_asset", "Loading asset\u2026")])
rep("explorer-assets.js",
    'dl.appendChild(el(doc, "dt", "ID"));',
    'dl.appendChild(el(doc, "dt", t("explorer.id_row", "ID")));',
    1, [("explorer.id_row", "ID")])
rep("explorer-assets.js",
    'dl.appendChild(el(doc, "dt", "Issuer"));',
    'dl.appendChild(el(doc, "dt", t("explorer.issuer_row", "Issuer")));',
    1, [("explorer.issuer_row", "Issuer")])
rep("explorer-assets.js",
    'dl.appendChild(el(doc, "dt", "Precision"));',
    'dl.appendChild(el(doc, "dt", t("explorer.precision_row", "Precision")));',
    1, [("explorer.precision_row", "Precision")])
rep("explorer-assets.js",
    'humanRow("Max supply", a.options && a.options.max_supply);',
    'humanRow(t("explorer.max_supply", "Max supply"), a.options && a.options.max_supply);',
    1, [("explorer.max_supply", "Max supply")])
rep("explorer-assets.js",
    'humanRow("Current supply", dyn.current_supply);',
    'humanRow(t("explorer.current_supply", "Current supply"), dyn.current_supply);',
    1, [("explorer.current_supply", "Current supply")])
rep("explorer-assets.js",
    'humanRow("Accumulated fees", dyn.accumulated_fees);',
    'humanRow(t("explorer.accumulated_fees", "Accumulated fees"), dyn.accumulated_fees);',
    1, [("explorer.accumulated_fees", "Accumulated fees")])
rep("explorer-assets.js",
    'humanRow("Fee pool", dyn.fee_pool);',
    'humanRow(t("explorer.fee_pool", "Fee pool"), dyn.fee_pool);',
    1, [("explorer.fee_pool", "Fee pool")])
rep("explorer-assets.js",
    'dl2.appendChild(el(doc, "dt", "Market fee"));',
    'dl2.appendChild(el(doc, "dt", t("explorer.market_fee", "Market fee")));',
    1, [("explorer.market_fee", "Market fee")])
rep("explorer-assets.js",
    'wrap.appendChild(el(doc, "p", "Not a smartcoin \\u2014 no price feeds.", "muted"));',
    'wrap.appendChild(el(doc, "p", t("explorer.not_smartcoin", "Not a smartcoin \\u2014 no price feeds."), "muted"));',
    1, [("explorer.not_smartcoin", "Not a smartcoin \u2014 no price feeds.")])
rep("explorer-assets.js",
    'wrap.appendChild(el(doc, "h3", "Price feeds"));',
    'wrap.appendChild(el(doc, "h3", t("explorer.feeds_h", "Price feeds")));',
    1, [("explorer.feeds_h", "Price feeds")])
rep("explorer-assets.js",
    'showStatus(doc, feedBox, "Loading feeds\\u2026");',
    'showStatus(doc, feedBox, t("explorer.loading_feeds", "Loading feeds\\u2026"));',
    1, [("explorer.loading_feeds", "Loading feeds\u2026")])
rep("explorer-assets.js",
    'feedBox.appendChild(el(doc, "p", "No live feeds published.", "muted"));',
    'feedBox.appendChild(el(doc, "p", t("explorer.no_feeds", "No live feeds published."), "muted"));',
    1, [("explorer.no_feeds", "No live feeds published.")])
rep("explorer-assets.js",
    'dd.textContent = "unavailable (quote precision unknown)";',
    'dd.textContent = t("explorer.unavailable_quote", "unavailable (quote precision unknown)");',
    1, [("explorer.unavailable_quote", "unavailable (quote precision unknown)")])
rep("explorer-assets.js",
    '} catch (e) { dd.textContent = "unavailable"; }',
    '} catch (e) { dd.textContent = t("explorer.unavailable", "unavailable"); }',
    1, [("explorer.unavailable", "unavailable")])
rep("explorer-assets.js",
    'fdl.appendChild(el(doc, "dt", "Feed lifetime"));',
    'fdl.appendChild(el(doc, "dt", t("explorer.feed_lifetime", "Feed lifetime")));',
    1, [("explorer.feed_lifetime", "Feed lifetime")])
rep("explorer-assets.js",
    'lt.title = String(f.feed_lifetime_sec) + " seconds";',
    'lt.title = String(f.feed_lifetime_sec) + t("explorer.seconds_unit", " seconds");',
    1, [("explorer.seconds_unit", " seconds")])
rep("explorer-assets.js",
    'fdl.appendChild(el(doc, "dt", "Minimum feeds"));',
    'fdl.appendChild(el(doc, "dt", t("explorer.min_feeds", "Minimum feeds")));',
    1, [("explorer.min_feeds", "Minimum feeds")])
rep("explorer-assets.js",
    'priceRow("Settlement price", f.settlement_raw);',
    'priceRow(t("explorer.settlement_row", "Settlement price"), f.settlement_raw);',
    1, [("explorer.settlement_row", "Settlement price")])
rep("explorer-assets.js",
    'priceRow("Feed price", f.feed_raw);',
    'priceRow(t("explorer.feed_row", "Feed price"), f.feed_raw);',
    1, [("explorer.feed_row", "Feed price")])
rep("explorer-assets.js",
    'showError(doc, feedBox, e, "Could not load feeds.");',
    'showError(doc, feedBox, e, t("explorer.feeds_failed", "Could not load feeds."));',
    1, [("explorer.feeds_failed", "Could not load feeds.")])
rep("explorer-assets.js",
    'showError(doc, wrap, e, "Unknown asset.");',
    'showError(doc, wrap, e, t("explorer.unknown_asset", "Unknown asset."));',
    1, [("explorer.unknown_asset", "Unknown asset.")])
rep("explorer-assets.js",
    'showStatus(doc, body, "Scanning for smartcoins\\u2026");',
    'showStatus(doc, body, t("explorer.scanning", "Scanning for smartcoins\\u2026"));',
    1, [("explorer.scanning", "Scanning for smartcoins\u2026")])
rep("explorer-assets.js",
    ('        body.appendChild(el(doc, "p",\n'
     '          "No smartcoins with feeds found on this node. User-issued assets show here once they publish feeds.", "muted"));'),
    ('        body.appendChild(el(doc, "p",\n'
     '          t("explorer.no_smartcoins", "No smartcoins with feeds found on this node. User-issued assets show here once they publish feeds."), "muted"));'),
    1, [("explorer.no_smartcoins", "No smartcoins with feeds found on this node. User-issued assets show here once they publish feeds.")])
rep("explorer-assets.js",
    'showStatus(doc, body, "Loading feeds for " + found.length + " asset(s)\\u2026");',
    'showStatus(doc, body, t("explorer.loading_feeds_for", "Loading feeds for ") + found.length + t("explorer.asset_count_suffix", " asset(s)\\u2026"));',
    1, [("explorer.loading_feeds_for", "Loading feeds for "),
        ("explorer.asset_count_suffix", " asset(s)\u2026")])
rep("explorer-assets.js",
    ('        body.appendChild(scrollTable(doc,\n'
     '          ["Symbol", "Settlement", "Feed", "MSSR"], tableRows));'),
    ('        body.appendChild(scrollTable(doc,\n'
     '          [t("explorer.th_symbol", "Symbol"), t("explorer.th_settlement", "Settlement"), t("explorer.th_feed", "Feed"), t("explorer.th_mssr", "MSSR")], tableRows));'),
    1, [("explorer.th_symbol", "Symbol"),
        ("explorer.th_settlement", "Settlement"),
        ("explorer.th_feed", "Feed"),
        ("explorer.th_mssr", "MSSR")])
rep("explorer-assets.js",
    'showError(doc, body, e, "Could not scan assets.");',
    'showError(doc, body, e, t("explorer.scan_failed", "Could not scan assets."));',
    1, [("explorer.scan_failed", "Could not scan assets.")])
rep("explorer-assets.js",
    'showError(doc, body, e, "Could not load feeds.");',
    'showError(doc, body, e, t("explorer.feeds_failed", "Could not load feeds."));',
    1, [("explorer.feeds_failed", "Could not load feeds.")])

# LIFETIME words live in explorer-assets.js (renderAsset/feed rows reuse them)
rep("explorer-assets.js",
    'if (s % 3600 === 0) return (s / 3600) + " hours";',
    'if (s % 3600 === 0) return (s / 3600) + t("explorer.hours_unit", " hours");',
    1, [("explorer.hours_unit", " hours")])
rep("explorer-assets.js",
    'if (s % 60 === 0) return (s / 60) + " minutes";',
    'if (s % 60 === 0) return (s / 60) + t("explorer.minutes_unit", " minutes");',
    1, [("explorer.minutes_unit", " minutes")])
rep("explorer-assets.js",
    'return s + " seconds";',
    'return s + t("explorer.seconds_unit", " seconds");',
    1, [("explorer.seconds_unit", " seconds")])

# ---------------------------------------------------------- explorer-render.js
helper("explorer-render.js", 'var ExplorerRender = (function () {\n  "use strict";')

rep("explorer-render.js",
    ('    var head = el(doc, "h3", (label || "Operation") + ": " + op.type_name +\n'
     '      (op.virtual ? " (virtual)" : "") + " [op " + op.type_idx + "]");'),
    ('    var head = el(doc, "h3", (label || t("explorer.op_label", "Operation")) + ": " + op.type_name +\n'
     '      (op.virtual ? t("explorer.virtual_mark", " (virtual)") : "") + t("explorer.op_badge_prefix", " [op ") + op.type_idx + "]");'),
    1, [("explorer.op_label", "Operation"),
        ("explorer.virtual_mark", " (virtual)"),
        ("explorer.op_badge_prefix", " [op ")])
rep("explorer-render.js",
    'if (keys.length === 0) box.appendChild(el(doc, "p", "No fields.", "muted"));',
    'if (keys.length === 0) box.appendChild(el(doc, "p", t("explorer.no_fields", "No fields."), "muted"));',
    1, [("explorer.no_fields", "No fields.")])
rep("explorer-render.js",
    '+ " (raw)")',
    '+ t("explorer.raw_mark", " (raw)"))',
    5, [("explorer.raw_mark", " (raw)")] * 5)
rep("explorer-render.js",
    'if (depth >= 2) { dd.appendChild(el(doc, "span", value.length + " items", "muted")); return; }',
    'if (depth >= 2) { dd.appendChild(el(doc, "span", value.length + t("explorer.items_unit", " items"), "muted")); return; }',
    1, [("explorer.items_unit", " items")])
rep("explorer-render.js",
    's.title = "base " + base.amount + " " + base.asset_id + " / quote " + quote.amount + " " + quote.asset_id;',
    's.title = t("explorer.price_base", "base ") + base.amount + " " + base.asset_id + t("explorer.price_quote", " / quote ") + quote.amount + " " + quote.asset_id;',
    1, [("explorer.price_base", "base "),
        ("explorer.price_quote", " / quote ")])
rep("explorer-render.js",
    'try { title += " \\u00b7 " + Format.formatAmount(String(votes), CORE_PRECISION) + " votes"; }',
    'try { title += " \\u00b7 " + Format.formatAmount(String(votes), CORE_PRECISION) + t("explorer.votes_unit", " votes"); }',
    1, [("explorer.votes_unit", " votes")])
rep("explorer-render.js",
    'if (entry.op) box.appendChild(opSection(doc, entry.op, ctx, "History op"));',
    'if (entry.op) box.appendChild(opSection(doc, entry.op, ctx, t("explorer.history_op", "History op")));',
    1, [("explorer.history_op", "History op")])
rep("explorer-render.js",
    ('    var note = "Full management view lives in its owning slice \\u2014 this is a read-only summary.";\n'
     '    if (entry.space === 1 && (entry.type === 7 || entry.type === 8)) note += " (orders: trading slice)";\n'
     '    else if (entry.space === 1 && entry.type === 10) note += " (proposals: governance slice)";\n'
     '    else if (entry.space === 1 && entry.type === 16) note += " (HTLC: transfers slice)";'),
    ('    var note = t("explorer.full_view_note", "Full management view lives in its owning slice \\u2014 this is a read-only summary.");\n'
     '    if (entry.space === 1 && (entry.type === 7 || entry.type === 8)) note += t("explorer.note_orders", " (orders: trading slice)");\n'
     '    else if (entry.space === 1 && entry.type === 10) note += t("explorer.note_proposals", " (proposals: governance slice)");\n'
     '    else if (entry.space === 1 && entry.type === 16) note += t("explorer.note_htlc", " (HTLC: transfers slice)");'),
    1, [("explorer.full_view_note", "Full management view lives in its owning slice \u2014 this is a read-only summary."),
        ("explorer.note_orders", " (orders: trading slice)"),
        ("explorer.note_proposals", " (proposals: governance slice)"),
        ("explorer.note_htlc", " (HTLC: transfers slice)")])

# -------------------------------------------------------------- gateway-ui.js
helper("gateway-ui.js", 'var GatewayUI = (function () {\n  "use strict";')

rep("gateway-ui.js",
    'var m = (e && e.message) ? e.message : String(e || fallback || "Unexpected error");',
    'var m = (e && e.message) ? e.message : String(e || fallback || t("gateway.unexpected", "Unexpected error"));',
    1, [("gateway.unexpected", "Unexpected error")])
rep("gateway-ui.js",
    'if (m.indexOf("gateway-rejected:") === 0) m = "Gateway refused: " + m.slice(18).trim();',
    'if (m.indexOf("gateway-rejected:") === 0) m = t("gateway.refused_prefix", "Gateway refused: ") + m.slice(18).trim();',
    1, [("gateway.refused_prefix", "Gateway refused: ")])
rep("gateway-ui.js",
    'else if (m.indexOf("gateway-down:") === 0) m = "Gateway unreachable (" + m.slice(14).trim() + "). Try Re-check.";',
    'else if (m.indexOf("gateway-down:") === 0) m = t("gateway.unreachable_prefix", "Gateway unreachable (") + m.slice(14).trim() + t("gateway.unreachable_suffix", "). Try Re-check.");',
    1, [("gateway.unreachable_prefix", "Gateway unreachable ("),
        ("gateway.unreachable_suffix", "). Try Re-check.")])
rep("gateway-ui.js",
    'else if (m.indexOf("bad-account") !== -1) m = "Enter a BitShares account name first.";',
    'else if (m.indexOf("bad-account") !== -1) m = t("gateway.bad_account", "Enter a BitShares account name first.");',
    1, [("gateway.bad_account", "Enter a BitShares account name first.")])
rep("gateway-ui.js",
    'else if (m.indexOf("bad-coin") !== -1) m = "Unknown coin for this gateway.";',
    'else if (m.indexOf("bad-coin") !== -1) m = t("gateway.bad_coin", "Unknown coin for this gateway.");',
    1, [("gateway.bad_coin", "Unknown coin for this gateway.")])
rep("gateway-ui.js",
    'else if (m.indexOf("not-connected") !== -1) m = "Network unavailable. Check Settings \\u2192 Nodes and retry.";',
    'else if (m.indexOf("not-connected") !== -1) m = t("gateway.offline", "Network unavailable. Check Settings \\u2192 Nodes and retry.");',
    1, [("gateway.offline", "Network unavailable. Check Settings \u2192 Nodes and retry.")])
rep("gateway-ui.js",
    'box.appendChild(el(doc, "p", "Network unavailable. Check Settings \\u2192 Nodes and retry.", "muted"));',
    'box.appendChild(el(doc, "p", t("gateway.offline", "Network unavailable. Check Settings \\u2192 Nodes and retry."), "muted"));',
    1, [("gateway.offline", "Network unavailable. Check Settings \u2192 Nodes and retry.")])
rep("gateway-ui.js",
    'el(doc, "button", "Retry")',
    'el(doc, "button", t("gateway.retry", "Retry"))',
    3, [("gateway.retry", "Retry")] * 3)
rep("gateway-ui.js",
    'if (miss) { showError(doc, wrap, title + " backend missing: " + miss + " failed to load."); return null; }',
    'if (miss) { showError(doc, wrap, title + t("gateway.backend_missing", " backend missing: ") + miss + t("gateway.load_failed", " failed to load.")); return null; }',
    1, [("gateway.backend_missing", " backend missing: "),
        ("gateway.load_failed", " failed to load.")])
rep("gateway-ui.js",
    'var ctx = routeGate(root, "Deposit / Withdraw", retry);',
    'var ctx = routeGate(root, t("gateway.title", "Deposit / Withdraw"), retry);',
    1, [("gateway.title", "Deposit / Withdraw")])
rep("gateway-ui.js",
    ('    ctx.wrap.appendChild(el(ctx.doc, "p",\n'
     '      "Deposits never broadcast \\u2014 you send external coins to the shown address. " +\n'
     '      "Withdraws continue in the standard transfer form with its live fee and confirm.", "muted"));'),
    ('    ctx.wrap.appendChild(el(ctx.doc, "p",\n'
     '      t("gateway.intro_a", "Deposits never broadcast \\u2014 you send external coins to the shown address. ") +\n'
     '      t("gateway.intro_b", "Withdraws continue in the standard transfer form with its live fee and confirm."), "muted"));'),
    1, [("gateway.intro_a", "Deposits never broadcast \u2014 you send external coins to the shown address. "),
        ("gateway.intro_b", "Withdraws continue in the standard transfer form with its live fee and confirm.")])
rep("gateway-ui.js",
    'showStatus(doc, ctx.healthBox, "Checking gateway health\\u2026");',
    'showStatus(doc, ctx.healthBox, t("gateway.checking_health", "Checking gateway health\\u2026"));',
    1, [("gateway.checking_health", "Checking gateway health\u2026")])
rep("gateway-ui.js",
    'var dot = el(doc, "span", " \\u25cb"); dot.title = "health unknown";',
    'var dot = el(doc, "span", " \\u25cb"); dot.title = t("gateway.health_unknown", "health unknown");',
    1, [("gateway.health_unknown", "health unknown")])
rep("gateway-ui.js",
    'if (dot) { dot.textContent = h.ok ? " \\u25cf" : " \\u2715"; dot.title = (h.ok ? "ok " + (h.ms || "?") + "ms" : (h.reason || "down")) + " \\u00b7 " + fmtTime(h.at); }',
    'if (dot) { dot.textContent = h.ok ? " \\u25cf" : " \\u2715"; dot.title = (h.ok ? t("gateway.health_ok", "ok ") + (h.ms || "?") + "ms" : (h.reason || t("gateway.down", "down"))) + " \\u00b7 " + fmtTime(h.at); }',
    1, [("gateway.health_ok", "ok "),
        ("gateway.down", "down")])
rep("gateway-ui.js",
    'return g + ": " + (r.ok ? "ok " + r.ms + "ms" : (r.reason || "down")) + " \\u00b7 " + fmtTime(r.at); }).join("  |  "), "muted"));',
    'return g + ": " + (r.ok ? t("gateway.health_ok", "ok ") + r.ms + "ms" : (r.reason || t("gateway.down", "down"))) + " \\u00b7 " + fmtTime(r.at); }).join("  |  "), "muted"));',
    1, [("gateway.health_ok", "ok "),
        ("gateway.down", "down")])
rep("gateway-ui.js",
    'var re = touchable(el(doc, "button", "Re-check")); re.type = "button";',
    'var re = touchable(el(doc, "button", t("gateway.recheck", "Re-check"))); re.type = "button";',
    1, [("gateway.recheck", "Re-check")])
rep("gateway-ui.js",
    'showStatus(doc, ctx.bodyBox, "Loading " + entry.id + " coins\\u2026");',
    'showStatus(doc, ctx.bodyBox, t("gateway.loading_prefix", "Loading ") + entry.id + t("gateway.loading_coins_suffix", " coins\\u2026"));',
    1, [("gateway.loading_prefix", "Loading "),
        ("gateway.loading_coins_suffix", " coins\u2026")])
rep("gateway-ui.js",
    'if (msg) showError(doc, ctx.bodyBox, entry.id + " reported an " + msg + ".", null);',
    'if (msg) showError(doc, ctx.bodyBox, entry.id + t("gateway.reported_an", " reported an ") + msg + ".", null);',
    1, [("gateway.reported_an", " reported an ")])
rep("gateway-ui.js",
    'showError(doc, ctx.bodyBox, e, "Could not load " + entry.id + " coins.");',
    'showError(doc, ctx.bodyBox, e, t("gateway.coins_failed_prefix", "Could not load ") + entry.id + t("gateway.coins_failed_suffix", " coins."));',
    1, [("gateway.coins_failed_prefix", "Could not load "),
        ("gateway.coins_failed_suffix", " coins.")])
rep("gateway-ui.js",
    'ctx.bodyBox.appendChild(el(doc, "h2", entry.id + " \\u2014 unavailable"));',
    'ctx.bodyBox.appendChild(el(doc, "h2", entry.id + t("gateway.unavailable_suffix", " \\u2014 unavailable")));',
    1, [("gateway.unavailable_suffix", " \u2014 unavailable")])
rep("gateway-ui.js",
    'ctx.bodyBox.appendChild(el(doc, "p", entry.reason || "This gateway is disabled.", "muted"));',
    'ctx.bodyBox.appendChild(el(doc, "p", entry.reason || t("gateway.disabled_fallback", "This gateway is disabled."), "muted"));',
    1, [("gateway.disabled_fallback", "This gateway is disabled.")])
rep("gateway-ui.js",
    ('      ctx.bodyBox.appendChild(el(doc, "p",\n'
     '        "Only manual deposit / withdraw (per the gateway\'s own status in the reference UI). " +\n'
     '        "Automatic lookup stays off until a probe answers.", "muted"));'),
    ('      ctx.bodyBox.appendChild(el(doc, "p",\n'
     '        t("gateway.gdex_manual_a", "Only manual deposit / withdraw (per the gateway\'s own status in the reference UI). ") +\n'
     '        t("gateway.gdex_manual_b", "Automatic lookup stays off until a probe answers."), "muted"));'),
    1, [("gateway.gdex_manual_a", "Only manual deposit / withdraw (per the gateway's own status in the reference UI). "),
        ("gateway.gdex_manual_b", "Automatic lookup stays off until a probe answers.")])
rep("gateway-ui.js",
    'a.setAttribute("rel", "noreferrer"); a.textContent = "Gateway status thread";',
    'a.setAttribute("rel", "noreferrer"); a.textContent = t("gateway.status_thread", "Gateway status thread");',
    1, [("gateway.status_thread", "Gateway status thread")])
rep("gateway-ui.js",
    'var re = touchable(el(doc, "button", "Retry probe")); re.type = "button";',
    'var re = touchable(el(doc, "button", t("gateway.retry_probe", "Retry probe"))); re.type = "button";',
    1, [("gateway.retry_probe", "Retry probe")])
rep("gateway-ui.js",
    ('      ctx.bodyBox.appendChild(el(doc, "p",\n'
     '        "What unblocks this tab: on-chain discovery of a BIT20-prefixed asset family " +\n'
     '        "and issuer account (see parity note). No endpoint is guessed, so there is " +\n'
     '        "nothing to retry against yet.", "muted"));'),
    ('      ctx.bodyBox.appendChild(el(doc, "p",\n'
     '        t("gateway.bit20_a", "What unblocks this tab: on-chain discovery of a BIT20-prefixed asset family ") +\n'
     '        t("gateway.bit20_b", "and issuer account (see parity note). No endpoint is guessed, so there is ") +\n'
     '        t("gateway.bit20_c", "nothing to retry against yet."), "muted"));'),
    1, [("gateway.bit20_a", "What unblocks this tab: on-chain discovery of a BIT20-prefixed asset family "),
        ("gateway.bit20_b", "and issuer account (see parity note). No endpoint is guessed, so there is "),
        ("gateway.bit20_c", "nothing to retry against yet.")])
rep("gateway-ui.js",
    'var depB = touchable(el(doc, "button", "DEPOSIT"));',
    'var depB = touchable(el(doc, "button", t("gateway.deposit_tab", "DEPOSIT")));',
    1, [("gateway.deposit_tab", "DEPOSIT")])
rep("gateway-ui.js",
    'var witB = touchable(el(doc, "button", "WITHDRAW"));',
    'var witB = touchable(el(doc, "button", t("gateway.withdraw_tab", "WITHDRAW")));',
    1, [("gateway.withdraw_tab", "WITHDRAW")])
rep("gateway-ui.js",
    'showError(doc, ctx.bodyBox, entry.id + " lists no " + (wantDeposit ? "depositable" : "withdrawable") + " coins right now.", null);',
    'showError(doc, ctx.bodyBox, entry.id + t("gateway.lists_no", " lists no ") + (wantDeposit ? t("gateway.kind_deposit", "depositable") : t("gateway.kind_withdraw", "withdrawable")) + t("gateway.coins_right_now", " coins right now."), null);',
    1, [("gateway.lists_no", " lists no "),
        ("gateway.kind_deposit", "depositable"),
        ("gateway.kind_withdraw", "withdrawable"),
        ("gateway.coins_right_now", " coins right now.")])
rep("gateway-ui.js",
    'var selRow = el(doc, "div", null, "xfer-field"), lab = el(doc, "label", "Coin ");',
    'var selRow = el(doc, "div", null, "xfer-field"), lab = el(doc, "label", t("gateway.coin_label", "Coin "));',
    1, [("gateway.coin_label", "Coin ")])
rep("gateway-ui.js",
    'ctx.bodyBox.appendChild(el(doc, "h2", "Deposit " + row.symbol + " via " + entry.id));',
    'ctx.bodyBox.appendChild(el(doc, "h2", t("gateway.deposit_prefix", "Deposit ") + row.symbol + t("gateway.via", " via ") + entry.id));',
    1, [("gateway.deposit_prefix", "Deposit "),
        ("gateway.via", " via ")])
rep("gateway-ui.js",
    ('    ctx.bodyBox.appendChild(factList(doc, [\n'
     '      ["Coin", row.symbol],\n'
     '      ["Backing coin", row.backingCoin || "\\u2014"],\n'
     '      ["Minimum deposit (gateway-stated)", fmtMoney(row.minAmountRaw, row.precision), row.minAmountRaw === null ? null : "raw: " + row.minAmountRaw],\n'
     '      ["Deposit fee (gateway-stated)", fmtMoney(row.gateFeeRaw, row.precision), row.gateFeeRaw === null ? null : "raw: " + row.gateFeeRaw],\n'
     '      ["Issuer / intermediate", row.gatewayWallet || row.issuer || "\\u2014"]\n'
     '    ]));'),
    ('    ctx.bodyBox.appendChild(factList(doc, [\n'
     '      [t("gateway.coin_fact", "Coin"), row.symbol],\n'
     '      [t("gateway.backing_fact", "Backing coin"), row.backingCoin || "\\u2014"],\n'
     '      [t("gateway.min_deposit", "Minimum deposit (gateway-stated)"), fmtMoney(row.minAmountRaw, row.precision), row.minAmountRaw === null ? null : t("gateway.raw_prefix", "raw: ") + row.minAmountRaw],\n'
     '      [t("gateway.deposit_fee", "Deposit fee (gateway-stated)"), fmtMoney(row.gateFeeRaw, row.precision), row.gateFeeRaw === null ? null : t("gateway.raw_prefix", "raw: ") + row.gateFeeRaw],\n'
     '      [t("gateway.issuer_fact", "Issuer / intermediate"), row.gatewayWallet || row.issuer || "\\u2014"]\n'
     '    ]));'),
    1, [("gateway.coin_fact", "Coin"),
        ("gateway.backing_fact", "Backing coin"),
        ("gateway.min_deposit", "Minimum deposit (gateway-stated)"),
        ("gateway.raw_prefix", "raw: "),
        ("gateway.raw_prefix", "raw: "),
        ("gateway.deposit_fee", "Deposit fee (gateway-stated)"),
        ("gateway.issuer_fact", "Issuer / intermediate")])
rep("gateway-ui.js",
    ('    ctx.bodyBox.appendChild(el(doc, "p",\n'
     '      "No QR code is shown: the reference UI renders QR via an npm component " +\n'
     '      "with no zero-dependency replacement on disk \\u2014 copy the text below instead.", "muted"));'),
    ('    ctx.bodyBox.appendChild(el(doc, "p",\n'
     '      t("gateway.no_qr_a", "No QR code is shown: the reference UI renders QR via an npm component ") +\n'
     '      t("gateway.no_qr_b", "with no zero-dependency replacement on disk \\u2014 copy the text below instead."), "muted"));'),
    1, [("gateway.no_qr_a", "No QR code is shown: the reference UI renders QR via an npm component "),
        ("gateway.no_qr_b", "with no zero-dependency replacement on disk \u2014 copy the text below instead.")])
rep("gateway-ui.js",
    'var acctRow = el(doc, "div", null, "xfer-field"), lab = el(doc, "label", "Your BitShares account ");',
    'var acctRow = el(doc, "div", null, "xfer-field"), lab = el(doc, "label", t("gateway.your_account", "Your BitShares account "));',
    1, [("gateway.your_account", "Your BitShares account ")])
rep("gateway-ui.js",
    'acct.setAttribute("placeholder", "account name"); acct.setAttribute("autocomplete", "off");',
    'acct.setAttribute("placeholder", t("gateway.account_ph", "account name")); acct.setAttribute("autocomplete", "off");',
    1, [("gateway.account_ph", "account name")])
rep("gateway-ui.js",
    'var go = touchable(el(doc, "button", "Get deposit address")); go.type = "button";',
    'var go = touchable(el(doc, "button", t("gateway.get_address", "Get deposit address"))); go.type = "button";',
    1, [("gateway.get_address", "Get deposit address")])
rep("gateway-ui.js",
    'showStatus(doc, out, "Asking " + entry.id + " for a " + row.symbol + " deposit address\\u2026");',
    'showStatus(doc, out, t("gateway.asking_prefix", "Asking ") + entry.id + t("gateway.asking_deposit_mid", " for a ") + row.symbol + t("gateway.asking_deposit_end", " deposit address\\u2026"));',
    1, [("gateway.asking_prefix", "Asking "),
        ("gateway.asking_deposit_mid", " for a "),
        ("gateway.asking_deposit_end", " deposit address\u2026")])
rep("gateway-ui.js",
    'if (res.cached) showStatus(doc, out, "Last address (cached) \\u2014 no new address minted.");',
    'if (res.cached) showStatus(doc, out, t("gateway.cached_note", "Last address (cached) \\u2014 no new address minted."));',
    1, [("gateway.cached_note", "Last address (cached) \u2014 no new address minted.")])
rep("gateway-ui.js",
    'out.appendChild(copyRow(doc, "Send to address", res.address));',
    'out.appendChild(copyRow(doc, t("gateway.send_to", "Send to address"), res.address));',
    1, [("gateway.send_to", "Send to address")])
rep("gateway-ui.js",
    'if (res.memo) out.appendChild(copyRow(doc, "With memo", res.memo));',
    'if (res.memo) out.appendChild(copyRow(doc, t("gateway.with_memo", "With memo"), res.memo));',
    1, [("gateway.with_memo", "With memo")])
rep("gateway-ui.js",
    'else out.appendChild(el(doc, "p", "No memo required for this deposit.", "muted"));',
    'else out.appendChild(el(doc, "p", t("gateway.no_memo", "No memo required for this deposit."), "muted"));',
    1, [("gateway.no_memo", "No memo required for this deposit.")])
rep("gateway-ui.js",
    'out.appendChild(el(doc, "p", "Send your external " + row.symbol + " there. This page broadcasts nothing.", "muted"));',
    'out.appendChild(el(doc, "p", t("gateway.send_external_prefix", "Send your external ") + row.symbol + t("gateway.send_external_suffix", " there. This page broadcasts nothing."), "muted"));',
    1, [("gateway.send_external_prefix", "Send your external "),
        ("gateway.send_external_suffix", " there. This page broadcasts nothing.")])
rep("gateway-ui.js",
    'showError(doc, out, e, "Deposit lookup failed.");',
    'showError(doc, out, e, t("gateway.deposit_failed", "Deposit lookup failed."));',
    1, [("gateway.deposit_failed", "Deposit lookup failed.")])
rep("gateway-ui.js",
    'ctx.bodyBox.appendChild(el(doc, "h2", "Withdraw " + row.symbol + " via " + entry.id));',
    'ctx.bodyBox.appendChild(el(doc, "h2", t("gateway.withdraw_prefix", "Withdraw ") + row.symbol + t("gateway.via", " via ") + entry.id));',
    1, [("gateway.withdraw_prefix", "Withdraw "),
        ("gateway.via", " via ")])
rep("gateway-ui.js",
    ('    ctx.bodyBox.appendChild(factList(doc, [\n'
     '      ["Coin", row.symbol],\n'
     '      ["Withdraw fee (gateway-stated)", fmtMoney(row.withdrawFeeRaw, row.precision), row.withdrawFeeRaw === null ? null : "raw: " + row.withdrawFeeRaw],\n'
     '      ["Minimum withdrawal (gateway-stated)", fmtMoney(row.minAmountRaw, row.precision), row.minAmountRaw === null ? null : "raw: " + row.minAmountRaw],\n'
     '      ["Pays to (gateway-stated)", row.gatewayWallet || row.issuer || "\\u2014"]\n'
     '    ]));'),
    ('    ctx.bodyBox.appendChild(factList(doc, [\n'
     '      [t("gateway.coin_fact", "Coin"), row.symbol],\n'
     '      [t("gateway.withdraw_fee", "Withdraw fee (gateway-stated)"), fmtMoney(row.withdrawFeeRaw, row.precision), row.withdrawFeeRaw === null ? null : t("gateway.raw_prefix", "raw: ") + row.withdrawFeeRaw],\n'
     '      [t("gateway.min_withdraw", "Minimum withdrawal (gateway-stated)"), fmtMoney(row.minAmountRaw, row.precision), row.minAmountRaw === null ? null : t("gateway.raw_prefix", "raw: ") + row.minAmountRaw],\n'
     '      [t("gateway.pays_to", "Pays to (gateway-stated)"), row.gatewayWallet || row.issuer || "\\u2014"]\n'
     '    ]));'),
    1, [("gateway.coin_fact", "Coin"),
        ("gateway.withdraw_fee", "Withdraw fee (gateway-stated)"),
        ("gateway.raw_prefix", "raw: "),
        ("gateway.min_withdraw", "Minimum withdrawal (gateway-stated)"),
        ("gateway.raw_prefix", "raw: "),
        ("gateway.pays_to", "Pays to (gateway-stated)")])
rep("gateway-ui.js",
    'var destRow = el(doc, "div", null, "xfer-field"), dlab = el(doc, "label", "Destination external address ");',
    'var destRow = el(doc, "div", null, "xfer-field"), dlab = el(doc, "label", t("gateway.dest_label", "Destination external address "));',
    1, [("gateway.dest_label", "Destination external address ")])
rep("gateway-ui.js",
    'dest.setAttribute("placeholder", "external " + (row.backingCoin || row.symbol) + " address");',
    'dest.setAttribute("placeholder", t("gateway.dest_ph_prefix", "external ") + (row.backingCoin || row.symbol) + t("gateway.dest_ph_suffix", " address"));',
    1, [("gateway.dest_ph_prefix", "external "),
        ("gateway.dest_ph_suffix", " address")])
rep("gateway-ui.js",
    'memoOut.appendChild(copyRow(doc, "Transfer memo", memo === prefix() ? prefix() + "\\u2026" : memo));',
    'memoOut.appendChild(copyRow(doc, t("gateway.memo_label", "Transfer memo"), memo === prefix() ? prefix() + "\\u2026" : memo));',
    1, [("gateway.memo_label", "Transfer memo")])
rep("gateway-ui.js",
    'var chk = touchable(el(doc, "button", "Validate address with gateway")); chk.type = "button";',
    'var chk = touchable(el(doc, "button", t("gateway.validate_btn", "Validate address with gateway"))); chk.type = "button";',
    1, [("gateway.validate_btn", "Validate address with gateway")])
rep("gateway-ui.js",
    'showError(doc, validOut, "Enter the destination external address first.", null);',
    'showError(doc, validOut, t("gateway.dest_needed", "Enter the destination external address first."), null);',
    2, [("gateway.dest_needed", "Enter the destination external address first.")] * 2)
rep("gateway-ui.js",
    'showStatus(doc, validOut, "Asking " + entry.id + "\\u2026");',
    'showStatus(doc, validOut, t("gateway.asking_prefix", "Asking ") + entry.id + "\\u2026");',
    1, [("gateway.asking_prefix", "Asking ")])
rep("gateway-ui.js",
    'showStatus(doc, validOut, "Gateway reports the address looks " + (r.valid ? "valid" : "INVALID") + " (advisory only).");',
    'showStatus(doc, validOut, t("gateway.addr_prefix", "Gateway reports the address looks ") + (r.valid ? t("gateway.addr_valid", "valid") : t("gateway.addr_invalid", "INVALID")) + t("gateway.addr_suffix", " (advisory only)."));',
    1, [("gateway.addr_prefix", "Gateway reports the address looks "),
        ("gateway.addr_valid", "valid"),
        ("gateway.addr_invalid", "INVALID"),
        ("gateway.addr_suffix", " (advisory only).")])
rep("gateway-ui.js",
    'showStatus(doc, validOut, "Validation unavailable: " + ((e && e.message) || e) + " \\u2014 you may still continue.");',
    'showStatus(doc, validOut, t("gateway.validation_prefix", "Validation unavailable: ") + ((e && e.message) || e) + t("gateway.validation_suffix", " \\u2014 you may still continue."));',
    1, [("gateway.validation_prefix", "Validation unavailable: "),
        ("gateway.validation_suffix", " \u2014 you may still continue.")])
rep("gateway-ui.js",
    'var go = touchable(el(doc, "button", "Continue to transfer \\u2192")); go.type = "button";',
    'var go = touchable(el(doc, "button", t("gateway.continue_transfer", "Continue to transfer \\u2192"))); go.type = "button";',
    1, [("gateway.continue_transfer", "Continue to transfer \u2192")])
rep("gateway-ui.js",
    'showError(doc, validOut, e, "Could not prepare the withdraw prefill.");',
    'showError(doc, validOut, e, t("gateway.prefill_failed", "Could not prepare the withdraw prefill."));',
    1, [("gateway.prefill_failed", "Could not prepare the withdraw prefill.")])
rep("gateway-ui.js",
    ('    ctx.bodyBox.appendChild(el(doc, "p",\n'
     '      "Amount, live chain fee, confirm, sign and broadcast all happen in the " +\n'
     '      "transfer form \\u2014 this page never broadcasts a gateway withdraw.", "muted"));'),
    ('    ctx.bodyBox.appendChild(el(doc, "p",\n'
     '      t("gateway.withdraw_note_a", "Amount, live chain fee, confirm, sign and broadcast all happen in the ") +\n'
     '      t("gateway.withdraw_note_b", "transfer form \\u2014 this page never broadcasts a gateway withdraw."), "muted"));'),
    1, [("gateway.withdraw_note_a", "Amount, live chain fee, confirm, sign and broadcast all happen in the "),
        ("gateway.withdraw_note_b", "transfer form \u2014 this page never broadcasts a gateway withdraw.")])
rep("gateway-ui.js",
    'var b = touchable(el(doc, "button", "Copy")); b.type = "button";',
    'var b = touchable(el(doc, "button", t("gateway.copy", "Copy"))); b.type = "button";',
    1, [("gateway.copy", "Copy")])
rep("gateway-ui.js",
    'function done(ok) { b.textContent = ok ? "Copied" : "Copy failed \\u2014 select manually"; }',
    'function done(ok) { b.textContent = ok ? t("gateway.copied", "Copied") : t("gateway.copy_failed", "Copy failed \\u2014 select manually"); }',
    1, [("gateway.copied", "Copied"),
        ("gateway.copy_failed", "Copy failed \u2014 select manually")])

# --------------------------------------------------------------- notify-ui.js
helper("notify-ui.js", 'var NotifyUI = (function () {\n  "use strict";')

rep("notify-ui.js",
    'function dirWord(t) { return t === "1" ? "Higher Than" : "Lower Than"; }',
    'function dirWord(type) { return type === "1" ? t("notify.higher", "Higher Than") : t("notify.lower", "Lower Than"); }',
    1, [("notify.higher", "Higher Than"),
        ("notify.lower", "Lower Than")])
rep("notify-ui.js",
    'wrap.appendChild(el(doc, "h1", "Price Alerts"));',
    'wrap.appendChild(el(doc, "h1", t("notify.title", "Price Alerts")));',
    1, [("notify.title", "Price Alerts")])
rep("notify-ui.js",
    'var honesty = "Rules are checked while this page is open. Timers die with the page \\u2014 alerts never fire while the app is closed.";',
    'var honesty = t("notify.honesty", "Rules are checked while this page is open. Timers die with the page \\u2014 alerts never fire while the app is closed.");',
    1, [("notify.honesty", "Rules are checked while this page is open. Timers die with the page \u2014 alerts never fire while the app is closed.")])
rep("notify-ui.js",
    'miss.textContent = "Alerts backend missing: " + what + " failed to load.";',
    'miss.textContent = t("notify.backend_prefix", "Alerts backend missing: ") + what + t("notify.backend_suffix", " failed to load.");',
    1, [("notify.backend_prefix", "Alerts backend missing: "),
        ("notify.backend_suffix", " failed to load.")])
rep("notify-ui.js",
    ('        listBox.appendChild(el(doc, "p",\n'
     '          "No price alerts yet. Use Add rule below to watch a market.", "muted"));'),
    ('        listBox.appendChild(el(doc, "p",\n'
     '          t("notify.empty_list", "No price alerts yet. Use Add rule below to watch a market."), "muted"));'),
    1, [("notify.empty_list", "No price alerts yet. Use Add rule below to watch a market.")])
# group header composes quote/base/count with punctuation glue only (no
# separable word label -- batch-2b precedent leaves such rows raw).
rep("notify-ui.js",
    'var latest = el(doc, "span", "waiting for price", "muted");',
    'var latest = el(doc, "span", t("notify.waiting", "waiting for price"), "muted");',
    1, [("notify.waiting", "waiting for price")])
rep("notify-ui.js",
    'if (m.latest) latest.textContent = "latest " + m.latest;',
    'if (m.latest) latest.textContent = t("notify.latest_prefix", "latest ") + m.latest;',
    1, [("notify.latest_prefix", "latest ")])
rep("notify-ui.js",
    'row.appendChild(el(doc, "span", "pair unresolved", "badge"));',
    'row.appendChild(el(doc, "span", t("notify.unresolved", "pair unresolved"), "badge"));',
    1, [("notify.unresolved", "pair unresolved")])
rep("notify-ui.js",
    'var del = touchable(el(doc, "button", "Delete"));',
    'var del = touchable(el(doc, "button", t("notify.delete", "Delete")));',
    1, [("notify.delete", "Delete")])
rep("notify-ui.js",
    'del.setAttribute("aria-label", "Delete alert " + dirWord(r.type) + " " + String(r.price));',
    'del.setAttribute("aria-label", t("notify.delete_aria_prefix", "Delete alert ") + dirWord(r.type) + " " + String(r.price));',
    1, [("notify.delete_aria_prefix", "Delete alert ")])
rep("notify-ui.js",
    'wrap.appendChild(el(doc, "h2", "Add rule"));',
    'wrap.appendChild(el(doc, "h2", t("notify.add_rule", "Add rule")));',
    1, [("notify.add_rule", "Add rule")])
rep("notify-ui.js",
    'var inQ = field("Quote", lq, null);',
    'var inQ = field(t("notify.quote_label", "Quote"), lq, null);',
    1, [("notify.quote_label", "Quote")])
rep("notify-ui.js",
    'var inB = field("Base", lb, null);',
    'var inB = field(t("notify.base_label", "Base"), lb, null);',
    1, [("notify.base_label", "Base")])
rep("notify-ui.js",
    'dirLab.appendChild(el(doc, "span", "Alert me when"));',
    'dirLab.appendChild(el(doc, "span", t("notify.dir_label", "Alert me when")));',
    1, [("notify.dir_label", "Alert me when")])
rep("notify-ui.js",
    '[["1", "Higher Than"], ["2", "Lower Than"]].forEach(function (o) {',
    '[["1", t("notify.higher", "Higher Than")], ["2", t("notify.lower", "Lower Than")]].forEach(function (o) {',
    1, [("notify.higher", "Higher Than"),
        ("notify.lower", "Lower Than")])
rep("notify-ui.js",
    'var inP = field("Price", "", "decimal");',
    'var inP = field(t("notify.price_label", "Price"), "", "decimal");',
    1, [("notify.price_label", "Price")])
rep("notify-ui.js",
    'var add = touchable(el(doc, "button", "Add rule"));',
    'var add = touchable(el(doc, "button", t("notify.add_rule", "Add rule")));',
    1, [("notify.add_rule", "Add rule")])
rep("notify-ui.js",
    'if (!q || !b || q === b) { err.textContent = "Enter two different symbols, e.g. BTS and USD."; return; }',
    'if (!q || !b || q === b) { err.textContent = t("notify.symbols_needed", "Enter two different symbols, e.g. BTS and USD."); return; }',
    1, [("notify.symbols_needed", "Enter two different symbols, e.g. BTS and USD.")])
rep("notify-ui.js",
    'if (!/^\\d+(?:\\.\\d+)?$/.test(price)) { err.textContent = "Enter a price like 1.234."; return; }',
    'if (!/^\\d+(?:\\.\\d+)?$/.test(price)) { err.textContent = t("notify.price_hint", "Enter a price like 1.234."); return; }',
    1, [("notify.price_hint", "Enter a price like 1.234.")])
rep("notify-ui.js",
    'err.textContent = "Too many decimals for this pair (max " + String(cap) + ").";',
    'err.textContent = t("notify.too_many_prefix", "Too many decimals for this pair (max ") + String(cap) + ").";',
    1, [("notify.too_many_prefix", "Too many decimals for this pair (max ")])
rep("notify-ui.js",
    'err.textContent = "Higher Than alerts must be above the latest price (latest " + meta.latest + ").";',
    'err.textContent = t("notify.higher_check_prefix", "Higher Than alerts must be above the latest price (latest ") + meta.latest + ").";',
    1, [("notify.higher_check_prefix", "Higher Than alerts must be above the latest price (latest ")])
rep("notify-ui.js",
    'err.textContent = "Lower Than alerts must be below the latest price (latest " + meta.latest + ").";',
    'err.textContent = t("notify.lower_check_prefix", "Lower Than alerts must be below the latest price (latest ") + meta.latest + ").";',
    1, [("notify.lower_check_prefix", "Lower Than alerts must be below the latest price (latest ")])
rep("notify-ui.js",
    '} catch (e) { err.textContent = "Could not compare against the latest price."; return; }',
    '} catch (e) { err.textContent = t("notify.compare_failed", "Could not compare against the latest price."); return; }',
    1, [("notify.compare_failed", "Could not compare against the latest price.")])
rep("notify-ui.js",
    '} catch (e) { err.textContent = "Could not save this rule (check the price)."; return; }',
    '} catch (e) { err.textContent = t("notify.save_failed", "Could not save this rule (check the price)."); return; }',
    1, [("notify.save_failed", "Could not save this rule (check the price).")])
rep("notify-ui.js",
    'wrap.appendChild(el(doc, "h2", "Browser notifications"));',
    'wrap.appendChild(el(doc, "h2", t("notify.browser_h2", "Browser notifications")));',
    1, [("notify.browser_h2", "Browser notifications")])
rep("notify-ui.js",
    ('      var words = { disabled: "Browser notifications are off.",\n'
     '        unsupported: "This browser or page (http/file) does not support notifications.",\n'
     '        denied: "Notifications are blocked \\u2014 allow them in the browser site settings.",\n'
     '        default: "Permission not granted yet \\u2014 use the button above.",\n'
     '        error: "Notifications failed to show." };\n'
     '      return (words[reason] || words.disabled) + " Toasts still work in-app.";'),
    ('      var words = { disabled: t("notify.skip_disabled", "Browser notifications are off."),\n'
     '        unsupported: t("notify.skip_unsupported", "This browser or page (http/file) does not support notifications."),\n'
     '        denied: t("notify.skip_denied", "Notifications are blocked \\u2014 allow them in the browser site settings."),\n'
     '        default: t("notify.skip_default", "Permission not granted yet \\u2014 use the button above."),\n'
     '        error: t("notify.skip_error", "Notifications failed to show.") };\n'
     '      return (words[reason] || words.disabled) + t("notify.toasts_note", " Toasts still work in-app.");'),
    1, [("notify.skip_disabled", "Browser notifications are off."),
        ("notify.skip_unsupported", "This browser or page (http/file) does not support notifications."),
        ("notify.skip_denied", "Notifications are blocked \u2014 allow them in the browser site settings."),
        ("notify.skip_default", "Permission not granted yet \u2014 use the button above."),
        ("notify.skip_error", "Notifications failed to show."),
        ("notify.toasts_note", " Toasts still work in-app.")])
rep("notify-ui.js",
    ('      var btn = touchable(el(doc, "button",\n'
     '        prefs && prefs.browser ? "Browser notifications on" : "Enable browser notifications"));'),
    ('      var btn = touchable(el(doc, "button",\n'
     '        prefs && prefs.browser ? t("notify.browser_on", "Browser notifications on") : t("notify.browser_enable", "Enable browser notifications")));'),
    1, [("notify.browser_on", "Browser notifications on"),
        ("notify.browser_enable", "Enable browser notifications")])
rep("notify-ui.js",
    'wrap.appendChild(el(doc, "h2", "Notification settings"));',
    'wrap.appendChild(el(doc, "h2", t("notify.settings_h2", "Notification settings")));',
    1, [("notify.settings_h2", "Notification settings")])
rep("notify-ui.js",
    'bLab.appendChild(el(doc, "span", "Allow browser notifications"));',
    'bLab.appendChild(el(doc, "span", t("notify.allow_browser", "Allow browser notifications")));',
    1, [("notify.allow_browser", "Allow browser notifications")])
rep("notify-ui.js",
    'tLab.appendChild(el(doc, "span", "Notify me about incoming transfers"));',
    'tLab.appendChild(el(doc, "span", t("notify.transfer_toggle", "Notify me about incoming transfers")));',
    1, [("notify.transfer_toggle", "Notify me about incoming transfers")])

# -------------------------------------------------------------- notify-host.js
helper("notify-host.js", 'var NotifyHost = (function () {\n  "use strict";')

rep("notify-host.js",
    ('    items.forEach(function (t) {\n'
     '      var card = document.createElement("div");\n'
     '      card.className = "toast toast-" + String(t.level || "info");'),
    ('    items.forEach(function (item) {\n'
     '      var card = document.createElement("div");\n'
     '      card.className = "toast toast-" + String(item.level || "info");'),
    1, [])
rep("notify-host.js",
    ('      var head = el(document, "div", null, "toast-head");\n'
     '      if (t.title) head.appendChild(el(document, "strong", t.title));\n'
     '      var x = touchable(el(document, "button", "\\u00d7", "toast-x"));\n'
     '      x.type = "button";\n'
     '      x.setAttribute("aria-label", "Dismiss notification");\n'
     '      x.addEventListener("click", function () {\n'
     '        try { Notify.dismiss(t.id); } catch (e) { /* host still repaints */ }\n'
     '      });\n'
     '      head.appendChild(x);\n'
     '      card.appendChild(head);\n'
     '      if (t.body) card.appendChild(el(document, "div", t.body, "toast-body"));\n'
     '      /* Tap-to-dismiss anywhere on the card; nothing is hover-only. */\n'
     '      card.addEventListener("click", function (ev) {\n'
     '        if (ev.target === x) return;\n'
     '        try { Notify.dismiss(t.id); } catch (e) { /* repaint follows */ }\n'
     '      });'),
    ('      var head = el(document, "div", null, "toast-head");\n'
     '      if (item.title) head.appendChild(el(document, "strong", item.title));\n'
     '      var x = touchable(el(document, "button", "\\u00d7", "toast-x"));\n'
     '      x.type = "button";\n'
     '      x.setAttribute("aria-label", t("notify.dismiss", "Dismiss notification"));\n'
     '      x.addEventListener("click", function () {\n'
     '        try { Notify.dismiss(item.id); } catch (e) { /* host still repaints */ }\n'
     '      });\n'
     '      head.appendChild(x);\n'
     '      card.appendChild(head);\n'
     '      if (item.body) card.appendChild(el(document, "div", item.body, "toast-body"));\n'
     '      /* Tap-to-dismiss anywhere on the card; nothing is hover-only. */\n'
     '      card.addEventListener("click", function (ev) {\n'
     '        if (ev.target === x) return;\n'
     '        try { Notify.dismiss(item.id); } catch (e) { /* repaint follows */ }\n'
     '      });'),
    1, [("notify.dismiss", "Dismiss notification")])
rep("notify-host.js",
    'if (more > 0) host.appendChild(el(document, "div", "+" + String(more) + " more", "muted"));',
    'if (more > 0) host.appendChild(el(document, "div", "+" + String(more) + t("notify.more_suffix", " more"), "muted"));',
    1, [("notify.more_suffix", " more")])
rep("notify-host.js",
    'a.setAttribute("aria-label", "Price Alert");',
    'a.setAttribute("aria-label", t("notify.bell", "Price Alert"));',
    1, [("notify.bell", "Price Alert")])
rep("notify-host.js",
    'a.setAttribute("title", "Price Alert");',
    'a.setAttribute("title", t("notify.bell", "Price Alert"));',
    1, [("notify.bell", "Price Alert")])

# ------------------------------------------------------------------- driver
import re

FILES = ["vote-ui.js", "vote-slate.js", "explorer-ui.js", "explorer-blocks.js",
         "explorer-assets.js", "explorer-render.js", "gateway-ui.js",
         "notify-ui.js", "notify-host.js"]


def U(s):
    """Decode \\uXXXX escapes the authoring above uses into real chars so old/new
    match file bytes (keys tuples already hold real chars via Python parsing)."""
    return re.sub(r"\\u([0-9a-fA-F]{4})", lambda m: chr(int(m.group(1), 16)), s)


TCALL = re.compile(r"""\bt\(\s*"((?:\\.|[^"\\])*)"\s*,\s*"((?:\\.|[^"\\])*)\"""")
STRTOK = re.compile(r'"((?:\\.|[^"\\])*)"|' + r"'((?:\\.|[^'\\])*)'")


def calls_of(text):
    out = []
    for m in TCALL.finditer(text):
        out.append((m.group(1).replace('\\"', '"').replace("\\\\", "\\"),
                    m.group(2).replace('\\"', '"').replace("\\\\", "\\")))
    return out


def tokens_of(text):
    """Double/single-quoted literal contents (comments must be stripped first
    by callers; snippets here are comment-free code)."""
    out = []
    for m in STRTOK.finditer(text):
        v = m.group(1) if m.group(1) is not None else m.group(2)
        out.append(v.replace('\\"', '"').replace("\\'", "'").replace("\\\\", "\\"))
    return out


def main():
    ledger = {}
    frag = {}
    total_sites = 0
    decoded = []
    for fname, old, new, count, keys in R:
        old, new = U(old), U(new)
        got = calls_of(new)
        assert not calls_of(old), (fname, old[:70])
        assert sorted(got) * count == sorted(keys), (fname, got, keys)
        decoded.append((fname, old, new, count, keys))
    # Pre-flight: verify EVERY count before touching any file (all-or-nothing).
    cache = {}
    for fname, old, new, count, keys in decoded:
        p = os.path.join(JS, fname)
        if p not in cache:
            with io.open(p, encoding="utf-8") as f:
                cache[p] = f.read()
        n = cache[p].count(old)
        if n != count:
            print("COUNT MISMATCH %s: found %d, expected %d:\n%r" % (fname, n, count, old[:160]))
            return 1
    for fname, old, new, count, keys in decoded:
        p = os.path.join(JS, fname)
        with io.open(p, encoding="utf-8") as f:
            src = f.read()
        n = src.count(old)
        if n != count:
            print("COUNT MISMATCH %s: found %d, expected %d:\n%r" % (fname, n, count, old[:160]))
            return 1
        src = src.replace(old, new)
        with io.open(p, "w", encoding="utf-8", newline="") as f:
            f.write(src)
        total_sites += len(calls_of(new)) * count
        leg = ledger.setdefault(fname, {"removed": [], "added": []})
        leg["removed"].extend(tokens_of(old) * count)
        leg["added"].extend(tokens_of(new) * count)
        for k, d in keys:
            parts = k.split(".")
            assert len(parts) == 2, k
            node = frag.setdefault(parts[0], {})
            if k in node:
                assert node[k] == d, (k, node[k], d)
            else:
                node[k] = d
    doc = {"_meta": {
        "base": "en",
        "batch": "2c",
        "note": ("vote+explorer+gateway+notify view strings (byte-verbatim HEAD "
                 "literals; dynamic sentences keep code structure per batch-2b "
                 "precedent); merge into en.json on ledger merge. Values already "
                 "stubbed in en.json under other key names (e.g. voting.s1/s2, "
                 "gateway.title/s1, notify.*, explorer_assets.s2/s3) dedupe at merge.")},
    }
    for sec in sorted(frag):
        doc[sec] = {k.split(".", 1)[1]: v for k, v in frag[sec].items()}
    with io.open(FRAG, "w", encoding="utf-8", newline="") as f:
        json.dump(doc, f, ensure_ascii=False, indent=2)
        f.write("\n")
    with io.open(LEDGER_PATH, "w", encoding="utf-8") as f:
        json.dump(ledger, f, ensure_ascii=False, indent=1)
    n_keys = sum(len(v) for v in frag.values())
    print("applied OK: %d t() sites, %d fragment keys -> %s" % (total_sites, n_keys, FRAG))
    print("ledger -> %s" % LEDGER_PATH)
    return 0


if __name__ == "__main__":
    sys.exit(main())


