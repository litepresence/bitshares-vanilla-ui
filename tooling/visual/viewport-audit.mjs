#!/usr/bin/env node
/* viewport-audit.mjs — two-ended viewport sweep for the vanilla wallet
 * (DEV ONLY — never shipped, never required; the human browser pass stays
 * the gate, per AGENTS.md §4.5 rule 4).
 *
 * Owns: the audit route table, the pure verdict logic, the in-page DOM probe,
 * and the sweep runner. One purpose: decide whether each route survives at
 * each of two viewports, and say why not.
 * Consumes: playwright-core (dev-only, tooling/visual/package.json:3).
 * Side effects: writes screenshots + a JSON report; never touches vanilla/.
 * Exports: pure logic (tested in viewport-audit-test.mjs) plus sweep().
 *
 * Spec:     docs/superpowers/specs/2026-10-07-viewport-audit-design.md
 * Plan:     docs/superpowers/plans/2026-10-07-viewport-audit.md
 * Note:     docs/parity/viewport-audit-2.md
 *
 * Usage (server must be running):
 *   python3 -m http.server 8081 --directory vanilla &
 *   node tooling/visual/viewport-audit.mjs --port 8081
 *   node tooling/visual/viewport-audit.mjs --port 8081 --viewport phone
 *   node tooling/visual/viewport-audit.mjs --port 8081 --routes "#/transfer"
 *
 * Stdlib + playwright-core only. No new dependency.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");

/* Viewports (spec §4). "phone" is the 360-390px band §3.6 mandates;
 * "desk" is 2560px, the dense-view width check 7 requires. */
export const VIEWPORTS = [
  { id: "phone", width: 390, height: 844 },
  { id: "desk", width: 2560, height: 1080 },
];

/* Testnet node, pinned. Reads only; no keys, no broadcasts. */
const TESTNET_NODE = "wss://testnet.xbts.io/ws";

/* Live object ids, all recorded in existing parity notes -- never invented:
 * lite-test-1/1.2.26833 (testnet-proof-round2.md), pool 1.19.66 (slice-12),
 * htlc 1.16.621 (slice-11), credit offer 1.21.43 + deal 1.22.70 (slice-13),
 * proposal 1.10.1488 (slice-14), block 100916767 (slice-09). */
export const ROUTES = [
  { src: "/", hash: "#/", group: "static" },
  { src: "/account/:account_name", hash: "#/account/lite-test-1", group: "live-id" },
  { src: "/accounts", hash: "#/accounts", group: "static" },
  { src: "/market/:marketID", hash: "#/market/USD_TEST", group: "live-id" },
  { src: "/market/:marketID", hash: "#/market/BTS_HONEST.BTC", group: "live-id" },
  { src: "/credit-offer/:id", hash: "#/credit-offer/1.21.43", group: "live-id" },
  { src: "/deal/:id", hash: "#/deal/1.22.70", group: "live-id" },
  { src: "/credit-offer", hash: "#/credit-offer", group: "static" },
  { src: "/samet", hash: "#/samet", group: "static" },
  { src: "/settings/:tab", hash: "#/settings/nodes", group: "expanded",
    note: "renderSettings ignores the tab param (vanilla/js/settings.js) -- finding, recorded" },
  { src: "/settings", hash: "#/settings", group: "static" },
  { src: "/invoice/:data", hash: "#/invoice/:data", group: "skip",
    note: "invoice payload is per-recipient base64; no recorded fixture and fabricating one proves nothing" },
  { src: "/invoice", hash: "#/invoice", group: "static" },
  { src: "/proposals/:id", hash: "#/proposals/1.10.1488", group: "live-id" },
  { src: "/proposals", hash: "#/proposals", group: "static" },
  { src: "/tickets", hash: "#/tickets", group: "static" },
  { src: "/vesting", hash: "#/vesting", group: "static" },
  { src: "/authorities", hash: "#/authorities", group: "static" },
  { src: "/lists", hash: "#/lists", group: "static" },
  { src: "/airdrop", hash: "#/airdrop", group: "static" },
  { src: "/deposit-withdraw/:gateway", hash: "#/deposit-withdraw/XBTSX", group: "expanded" },
  { src: "/deposit-withdraw/:gateway", hash: "#/deposit-withdraw/IOB", group: "expanded" },
  { src: "/deposit-withdraw/:gateway", hash: "#/deposit-withdraw/GDEX", group: "expanded" },
  { src: "/deposit-withdraw/:gateway", hash: "#/deposit-withdraw/BIT20", group: "expanded" },
  { src: "/deposit-withdraw", hash: "#/deposit-withdraw", group: "static" },
  { src: "/create-account", hash: "#/create-account", group: "static" },
  { src: "/login", hash: "#/login", group: "static" },
  { src: "/registration", hash: "#/registration", group: "static" },
  { src: "/registration/local", hash: "#/registration/local", group: "static" },
  { src: "/registration/cloud", hash: "#/registration/cloud", group: "static" },
  { src: "/news", hash: "#/news", group: "static" },
  { src: "/voting", hash: "#/voting", group: "static" },
  { src: "/explorer", hash: "#/explorer", group: "static" },
  { src: "/explorer/:tab", hash: "#/explorer/blocks", group: "expanded" },
  { src: "/explorer/:tab", hash: "#/explorer/assets", group: "expanded" },
  { src: "/explorer/:tab", hash: "#/explorer/pools", group: "expanded" },
  { src: "/explorer/:tab", hash: "#/explorer/accounts", group: "expanded" },
  { src: "/explorer/:tab", hash: "#/explorer/witnesses", group: "expanded" },
  { src: "/explorer/:tab", hash: "#/explorer/committee", group: "expanded" },
  { src: "/explorer/:tab", hash: "#/explorer/markets", group: "expanded" },
  { src: "/explorer/:tab", hash: "#/explorer/fees", group: "expanded" },
  { src: "/explorer/:tab", hash: "#/explorer/feeds", group: "expanded" },
  { src: "/asset/:symbol", hash: "#/asset/HONEST.BTC", group: "live-id" },
  { src: "/asset/:symbol", hash: "#/asset/BTS", group: "live-id" },
  { src: "/block/:height", hash: "#/block/100916767", group: "live-id" },
  { src: "/block/:height/:txIndex", hash: "#/block/100916767/0", group: "live-id" },
  { src: "/borrow", hash: "#/borrow", group: "static" },
  { src: "/barter", hash: "#/barter", group: "static" },
  { src: "/direct-debit", hash: "#/direct-debit", group: "static" },
  { src: "/spotlight", hash: "#/spotlight", group: "static" },
  { src: "/transfer/:to", hash: "#/transfer/lite-test-1", group: "live-id" },
  { src: "/transfer", hash: "#/transfer", group: "static" },
  { src: "/wallet/password", hash: "#/wallet/password", group: "static" },
  { src: "/wallet", hash: "#/wallet", group: "static" },
  { src: "/create-wallet-brainkey", hash: "#/create-wallet-brainkey", group: "static" },
  { src: "/existing-account", hash: "#/existing-account", group: "static" },
  { src: "/create-worker", hash: "#/create-worker", group: "static" },
  { src: "/about", hash: "#/about", group: "static" },
  { src: "/community", hash: "#/community", group: "static" },
  { src: "/help/**", hash: "#/help", group: "static" },
  { src: "/help/**", hash: "#/help/disclaimer", group: "expanded" },
  { src: "/help/**", hash: "#/help/wallets", group: "expanded" },
  { src: "/help/**", hash: "#/help/dex-trading", group: "expanded" },
  { src: "/help/**", hash: "#/help/assets-mpa", group: "expanded" },
  { src: "/help/**", hash: "#/help/pools", group: "expanded" },
  { src: "/help/**", hash: "#/help/proposals", group: "expanded" },
  { src: "/help/**", hash: "#/help/charts", group: "expanded" },
  { src: "/help/**", hash: "#/help/glossary", group: "expanded" },
  { src: "/htlc/:id", hash: "#/htlc/1.16.621", group: "live-id" },
  { src: "/htlc", hash: "#/htlc", group: "static" },
  { src: "/prediction", hash: "#/prediction", group: "static" },
  { src: "/prediction/:market", hash: "#/prediction/:market", group: "skip",
    note: "no prediction market id recorded on testnet; the list route covers the renderer" },
  { src: "/instant-trade", hash: "#/instant-trade", group: "static" },
  { src: "/instant-trade/:marketID", hash: "#/instant-trade/USD_TEST", group: "live-id" },
  { src: "/pools/:id", hash: "#/pools/1.19.66", group: "live-id" },
  { src: "/pools", hash: "#/pools", group: "static" },
  { src: "/markets", hash: "#/markets", group: "static" },
  { src: "/alerts", hash: "#/alerts", group: "static" },
  { src: "/trollbox", hash: "#/trollbox", group: "static" },
  { src: "/assets", hash: "#/assets", group: "static" },
  { src: "/assets/create", hash: "#/assets/create", group: "static" },
  { src: "/assets/update/:symbol", hash: "#/assets/update/HONEST.BTC", group: "live-id" },
  { src: "/assets/issue", hash: "#/assets/issue", group: "static" },
  { src: "/assets/feed", hash: "#/assets/feed", group: "static" },
  { src: "/fees", hash: "#/fees", group: "static" },
  { src: "/referrals", hash: "#/referrals", group: "static" },
  { src: "/favourites", hash: "#/favourites", group: "static" },
  { src: "/top-ops", hash: "#/top-ops", group: "static" },
  { src: "/ops", hash: "#/ops", group: "static" },
  { src: "/txbuilder", hash: "#/txbuilder", group: "static" },
  { src: "/api-lab", hash: "#/api-lab", group: "static" },
  { src: "/es-lab", hash: "#/es-lab", group: "static" },
  { src: "/menu", hash: "#/menu", group: "static" },
  { src: "/menu/:section", hash: "#/menu/wallet", group: "expanded" },
  { src: "/menu/:section", hash: "#/menu/trade", group: "expanded" },
  { src: "/menu/:section", hash: "#/menu/earn", group: "expanded" },
  { src: "/menu/:section", hash: "#/menu/govern", group: "expanded" },
  { src: "/menu/:section", hash: "#/menu/explore", group: "expanded" },
  { src: "/menu/:section", hash: "#/menu/labs", group: "expanded" },
  { src: "/menu/:section", hash: "#/menu/personal", group: "expanded" },
  { src: "*", hash: "#/this-route-does-not-exist", group: "static" },
];

/* routerPaths: the `path:` entries parsed straight out of the router, so the
 * route table above can never claim coverage the router does not have.
 * Params: none. Returns: string[] in file order.
 * Failure: returns [] when the routes array cannot be found (the test then
 * fails loudly rather than passing on an empty table). */
export function routerPaths() {
  var src = readFileSync(join(ROOT, "vanilla", "js", "router.js"), "utf8");
  var m = src.match(/var routes = \[([\s\S]*?)\n  \];/);
  if (!m) return [];
  return m[1].split("\n").map(function (l) {
    var hit = l.match(/\{ path: "([^"]+)"/);
    return hit ? hit[1] : null;
  }).filter(Boolean);
}

/* expandRoutes: the routes to actually sweep. Params: none.
 * Returns: Array<{hash, group}> -- every ROUTES entry except the skips.
 * Pure, never throws. */
export function expandRoutes() {
  return ROUTES.filter(function (r) { return r.group !== "skip"; })
    .map(function (r) { return { hash: r.hash, group: r.group }; });
}

export const _internal = { ROOT, HERE, TESTNET_NODE };