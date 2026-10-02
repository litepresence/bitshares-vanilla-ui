/* explorer-readability-test.js — offline vectors for the explorer
 * readability extension (2026-10-02): op-sentence shaping (incl.
 * unknown-op fallback + virtual labeling), search-input routing (incl.
 * ambiguous input), and share-URL formation.
 * Stdlib only: `node tooling/explorer-readability-test.js` (exit 0 = green).
 * No network, no DOM (a minimal fake document feeds sentenceFor/pillFor —
 * account/asset joins stay raw spans in Node because Explorer/ExplorerAssets
 * are undefined there, same fail-open as the offline view).
 */
"use strict";
var assert = require("assert");
var ExplorerBlocks = require("../vanilla/js/views/explorer-blocks.js");
var Explorer = require("../vanilla/js/api/explorer.js");
global.Format = global.Format || require("../vanilla/js/api/format.js");

var passed = 0;
function eq(actual, expected, name) {
  assert.strictEqual(actual, expected, name + " (got " + JSON.stringify(actual) + ")");
  passed++;
}
function has(hay, needle, name) {
  assert.ok(String(hay).indexOf(needle) !== -1, name + " (missing " + JSON.stringify(needle) + " in " + JSON.stringify(String(hay).slice(0, 200)) + ")");
  passed++;
}
function hasNot(hay, needle, name) {
  assert.ok(String(hay).indexOf(needle) === -1, name + " (unexpected " + JSON.stringify(needle) + ")");
  passed++;
}

/* Minimal fake document: createElement nodes with textContent + children.
 * textOf aggregates node + subtree (mirrors DOM textContent reads). */
function fakeDoc() {
  function node(tag, text) {
    var n = {
      tagName: tag, textContent: (text === undefined || text === null) ? "" : String(text),
      className: "", title: "", style: {}, children: [], parentNode: null,
      appendChild: function (c) { c.parentNode = n; n.children.push(c); return c; },
      removeChild: function (c) {
        var i = n.children.indexOf(c);
        if (i >= 0) n.children.splice(i, 1);
        c.parentNode = null;
        return c;
      },
      replaceChild: function (nw, old) {
        var i = n.children.indexOf(old);
        if (i >= 0) n.children[i] = nw;
        nw.parentNode = n;
        return old;
      },
      setAttribute: function () {},
      addEventListener: function () {},
      select: function () {},
      get firstChild() { return n.children[0] || null; },
      get lastChild() { return n.children[n.children.length - 1] || null; }
    };
    return n;
  }
  return {
    createElement: function (tag) { return node(tag, ""); },
    createTextNode: function (s) { return node("#text", s); },
    body: node("body", ""),
    execCommand: function () { return false; }
  };
}
function textOf(n) {
  var out = n.textContent || "";
  (n.children || []).forEach(function (c) { out += textOf(c); });
  return out;
}
function sentText(idx, name, fields) {
  var doc = fakeDoc();
  var op = { block: 100, type_idx: idx, type_name: name, fields: fields || {} };
  return textOf(ExplorerBlocks._test.sentenceFor(doc, op, 1));
}
function pillText(idx, name) {
  var doc = fakeDoc();
  return textOf(ExplorerBlocks._test.pillFor(doc, { type_idx: idx, type_name: name }));
}

/* ---- 1. sentence shaping: pre-existing high-frequency ops still read ---- */
has(sentText(0, "transfer", { from: "1.2.1", to: "1.2.2",
  amount: { amount: "100000", asset_id: "1.3.0" } }), "transferred", "op-0 transfer verb");
has(sentText(2, "limit_order_cancel", { fee_paying_account: "1.2.1", order: "1.7.9" }),
  "cancelled order #9", "op-2 cancel order number");
has(sentText(4, "fill_order", { account_id: "1.2.1",
  pays: { amount: "5", asset_id: "1.3.0" }, receives: { amount: "1", asset_id: "1.3.1" } }),
  "filled order", "op-4 fill verb");
has(sentText(6, "account_update", { account: "1.2.7" }), "updated account", "op-6 update verb");
has(sentText(14, "asset_issue", { issuer: "1.2.1", issue_to_account: "1.2.2",
  asset_to_issue: { amount: "10", asset_id: "1.3.5" } }), "issued", "op-14 issue verb");

/* ---- 2. new sentences: vote/account ops users actually meet ---- */
has(sentText(7, "account_whitelist", { authorizing_account: "1.2.1",
  account_to_list: "1.2.9", new_listing: 1 }), "whitelisted", "op-7 whitelist word");
has(sentText(7, "account_whitelist", { authorizing_account: "1.2.1",
  account_to_list: "1.2.9", new_listing: 2 }), "blacklisted", "op-7 blacklist word");
has(sentText(7, "account_whitelist", { authorizing_account: "1.2.1",
  account_to_list: "1.2.9", new_listing: 0 }), "cleared the listing for", "op-7 clear word");
has(sentText(8, "account_upgrade", { account_to_upgrade: "1.2.3",
  upgrade_to_lifetime_member: true }), "lifetime membership", "op-8 lifetime");
has(sentText(8, "account_upgrade", { account_to_upgrade: "1.2.3",
  upgrade_to_lifetime_member: false }), "annual membership", "op-8 annual");

/* ---- 3. new sentences: asset ops ---- */
has(sentText(10, "asset_create", { issuer: "1.2.1", symbol: "AFKTEST", precision: 4 }),
  "created asset AFKTEST (precision 4)", "op-10 create symbol+precision");
has(sentText(11, "asset_update", { issuer: "1.2.1", asset_to_update: "1.3.5" }),
  "updated asset 1.3.5", "op-11 update id");
has(sentText(15, "asset_reserve", { payer: "1.2.1",
  amount_to_reserve: { amount: "500", asset_id: "1.3.5" } }), "reserved", "op-15 reserve verb");
has(sentText(16, "asset_fund_fee_pool", { from_account: "1.2.1", asset_id: "1.3.5", amount: "100000" }),
  "funded the fee pool of 1.3.5", "op-16 fund verb+asset");
has(sentText(16, "asset_fund_fee_pool", { from_account: "1.2.1", asset_id: "1.3.5", amount: "100000" }),
  "1.00000 (core)", "op-16 core-precision human (100000 p5)");
has(sentText(17, "asset_settle", { account: "1.2.4",
  amount: { amount: "7", asset_id: "1.3.5" } }), "requested settlement of", "op-17 settle verb");

/* ---- 4. new sentences: governance / vesting / HTLC / order update ---- */
has(sentText(23, "proposal_update", { fee_paying_account: "1.2.1", proposal: "1.10.5",
  active_approvals_to_add: ["1.2.2", "1.2.3"], active_approvals_to_remove: [] }),
  "updated proposal 1.10.5", "op-23 proposal id");
has(sentText(23, "proposal_update", { fee_paying_account: "1.2.1", proposal: "1.10.5",
  active_approvals_to_add: ["1.2.2", "1.2.3"], active_approvals_to_remove: [] }),
  "+2", "op-23 approval count");
has(sentText(33, "vesting_balance_withdraw", { owner: "1.2.6", vesting_balance: "1.13.3",
  amount: { amount: "9", asset_id: "1.3.0" } }), "withdrew", "op-33 withdraw verb");
has(sentText(33, "vesting_balance_withdraw", { owner: "1.2.6", vesting_balance: "1.13.3",
  amount: { amount: "9", asset_id: "1.3.0" } }), "vesting 1.13.3", "op-33 balance id");
has(sentText(49, "htlc_create", { from: "1.2.1", to: "1.2.2",
  amount: { amount: "11", asset_id: "1.3.0" } }), "locked", "op-49 lock verb");
has(sentText(49, "htlc_create", { from: "1.2.1", to: "1.2.2",
  amount: { amount: "11", asset_id: "1.3.0" } }), "for", "op-49 recipient glue");
has(sentText(50, "htlc_redeem", { redeemer: "1.2.2", htlc_id: "1.16.9" }),
  "claimed HTLC 1.16.9", "op-50 claim id");
has(sentText(77, "limit_order_update", { seller: "1.2.1", order: "1.7.123" }),
  "updated order #123", "op-77 update order number");

/* ---- 5. virtual ops get honest labeling; unknown ops never blank ---- */
has(sentText(4, "fill_order", { account_id: "1.2.1",
  pays: { amount: "5", asset_id: "1.3.0" }, receives: { amount: "1", asset_id: "1.3.1" } }),
  "(virtual)", "op-4 virtual marker");
has(sentText(46, "execute_bid", {}), "(virtual)", "op-46 virtual marker on fallback");
has(sentText(46, "execute_bid", {}), "execute bid", "op-46 spaced name still reads");
has(sentText(999, "unknown", {}), "op 999", "unknown op id preserved");
has(sentText(999, "unknown", {}), "#100", "unknown op block link");
has(pillText(4, "fill_order"), "(virtual)", "pill virtual marker");
has(pillText(0, "transfer"), "Transfer", "pill transfer label");
hasNot(pillText(0, "transfer"), "(virtual)", "pill transfer has no virtual marker");
has(pillText(999, "unknown"), "op 999", "pill unknown fallback");
eq(ExplorerBlocks._test.opAccount({ authorizing_account: "1.2.5" }), "1.2.5", "opAccount new key");
eq(ExplorerBlocks._test.opAccount({}), "", "opAccount empty");
eq(ExplorerBlocks._test.orderNum("1.7.574981117"), "574981117", "orderNum instance");

/* ---- 6. search routing: numeric-block + object-id + tx-hash + text ---- */
eq(Explorer.classifySearchInput("12345").kind, "block", "numeric -> block");
eq(Explorer.classifySearchInput("12345").height, 12345, "block height value");
eq(Explorer.classifySearchInput("  42 ").height, 42, "whitespace trimmed");
eq(Explorer.classifySearchInput("1.2.3").kind, "object", "account id -> object");
eq(Explorer.classifySearchInput("2.3.5").kind, "object", "space-2 id -> object");
/* Ambiguous: "1.2.0" is BOTH an object id and an account — one route must
 * win. Object-kind wins here and the shell redirects 1.2.x to #/account/,
 * the same endpoint an account search would land on. Never two answers. */
eq(Explorer.classifySearchInput("1.2.0").kind, "object", "ambiguous 1.2.0 stays object (shell redirects to account)");
eq(Explorer.classifySearchInput("1.2").kind, "text", "partial id is text");
eq(Explorer.classifySearchInput("0").kind, "text", "zero height is not a block");
var HEX40 = "abcdef0123456789abcdef0123456789abcdef01";
eq(HEX40.length, 40, "fixture is 40 hex");
eq(Explorer.classifySearchInput(HEX40).kind, "txhash", "40-hex -> txhash (deferred path)");
eq(Explorer.classifySearchInput(HEX40 + "00").kind, "text", "64-hex is not a tx id shape");
/* Ambiguous: "BTS" may name an account AND an asset symbol. Kind text is
 * the only honest answer here — resolution order (account first, then
 * asset) lives in Explorer.search, documented, never guessed by routing. */
eq(Explorer.classifySearchInput("BTS").kind, "text", "ambiguous BTS stays text (account-first search order)");
eq(Explorer.classifySearchInput("alice").kind, "text", "name -> text");
eq(Explorer.classifySearchInput("").kind, "empty", "empty string");
eq(Explorer.classifySearchInput("   ").kind, "empty", "whitespace only");

/* ---- 7. share-URL formation (router-resolvable hash deep links) ---- */
eq(Explorer.shareUrl("https://wallet.example/", "#/block/123"), "https://wallet.example/#/block/123", "block share url");
eq(Explorer.shareUrl("https://wallet.example/", "#/block/123/0"), "https://wallet.example/#/block/123/0", "tx share url");
eq(Explorer.shareUrl("", "#/asset/BTS"), "#/asset/BTS", "empty base keeps bare hash");
eq(Explorer.shareUrl("https://wallet.example/", "#/account/alice"), "https://wallet.example/#/account/alice", "account share url");

/* ---- 8. lookup_accounts pair-shape normalizer ---- */
var pairs = Explorer._normSuggestPairs([["alice", "1.2.100"], ["alicia", "1.2.101"]], 8);
eq(pairs.length, 2, "pair array shape");
eq(pairs[0].name, "alice", "pair name");
eq(pairs[0].id, "1.2.100", "pair id");
eq(Explorer._normSuggestPairs({ bob: "1.2.7" }, 8).length, 1, "object map shape");
eq(Explorer._normSuggestPairs(null, 8).length, 0, "null -> []");
eq(Explorer._normSuggestPairs("garbage", 8).length, 0, "garbage -> []");

console.log("explorer-readability-test: " + passed + " passed, 0 failed");
