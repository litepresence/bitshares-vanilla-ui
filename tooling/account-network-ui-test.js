#!/usr/bin/env node
/* account-network-ui vectors: seed parsing, chip model, the honest status /
 * detail / twin copy, and the hash round-trip. Pure helpers over stub
 * elements — no DOM, no network. */
"use strict";
globalThis.Format = require("/workspace/vanilla/js/api/format.js");
globalThis.AccountNet = require("/workspace/vanilla/js/api/account-net.js");
const AN = require("/workspace/vanilla/js/views/account-network-ui.js");

let pass = 0, fail = 0;
function eq(g, w, n) {
  if (JSON.stringify(g) === JSON.stringify(w)) pass++;
  else { fail++; console.log("FAIL " + n + "\n  got  " + JSON.stringify(g) + "\n  want " + JSON.stringify(w)); }
}
function ok(c, n) { if (c) pass++; else { fail++; console.log("FAIL " + n); } }
const T = AN._test;

/* ---- seeds ---- */
eq(T.parseSeeds("alice, bob carol\ndave"), ["alice", "bob", "carol", "dave"], "separators + trim");
eq(T.parseSeeds("alice,,alice"), ["alice"], "empty entries dropped, duplicates collapsed");
eq(T.parseSeeds("1.2.5"), ["1.2.5"], "an account id is a valid seed verbatim");
eq(T.parseSeeds(Array.from({ length: 20 }, (_, i) => "a" + i).join(" ")).length, 12, "seed cap is 12");
eq(T.parseSeeds(""), [], "empty input is no seeds");
eq(T.parseSeeds(null), [], "null input is no seeds");

/* ---- chips ---- */
{
  const chips = T.chipModel();
  eq(chips.filter((c) => c.on).map((c) => c.id).join(","), "transfer,credit", "defaults: transfer + credit");
  eq(chips.length, 6, "six classes ship as chips");
  eq(chips.find((c) => c.id === "vesting").kind, "relation", "vesting chip is a relation");
  eq(chips.find((c) => c.id === "debit").kind, "relation", "direct-debit permissions are relations");
  ok(chips.every((c) => typeof c.label === "string" && c.label.length), "every chip carries a label");
  ok(chips.every((c) => typeof c.help === "string" && c.help.length), "every chip explains itself");
}

/* ---- status: says what was scanned AND what was dropped ---- */
{
  const s = T.statusText({
    seeds: [{ id: "1.2.1", name: "alice" }], unknown: ["nope"],
    stats: { scanned: 2075, edges: 12, nodes: 9, truncated: true,
      droppedSelf: 3, droppedShape: 1, missingCredit: 2,
      caps: { nodeCapHit: true, edgeCapHit: false } }
  });
  ok(/alice/.test(s), "status names the seed (" + s + ")");
  ok(/nope/.test(s), "status names the unknown seed");
  ok(/2075/.test(s), "status states the scanned op count");
  ok(/newest/i.test(s), "a truncated scan says the window is newest-first");
  ok(/top/i.test(s), "a hit node cap is disclosed");
  ok(/3/.test(s) && /self/i.test(s), "self-edges skipped is disclosed");
  ok(/1/.test(s) && /(unreadable|skipped)/i.test(s), "unreadable entries is disclosed");
  ok(/2/.test(s) && /credit/i.test(s), "unresolvable credit lines is disclosed");
}
{
  /* Index-resolved credit lines are disclosed, not passed off as chain reads. */
  const s = T.statusText({ seeds: [{ id: "1.2.1", name: "alice" }], unknown: [],
    stats: { scanned: 90, edges: 12, nodes: 7, truncated: false, droppedSelf: 0,
      droppedShape: 0, missingCredit: 1, creditViaIndex: { offers: 5, deals: 44 },
      caps: {} } });
  ok(/index/i.test(s), "index-resolved credit lines are disclosed (" + s + ")");
  ok(/49/.test(s), "the index-resolved count is stated");
  ok(/1/.test(s) && /not found on chain/.test(s), "the still-unresolvable count is stated too");
}
{
  /* A clean run must NOT print a wall of zeros — absence of limits is the
   * default story, and a line of "0 skipped" is noise, not honesty. */
  const s = T.statusText({ seeds: [{ id: "1.2.1", name: "alice" }], unknown: [],
    stats: { scanned: 42, edges: 3, nodes: 4, truncated: false,
      droppedSelf: 0, droppedShape: 0, missingCredit: 0, caps: {} } });
  ok(!/skipped|truncat/i.test(s), "a clean run reports no skips (" + s + ")");
  ok(/42/.test(s) && /3/.test(s), "a clean run still states the counts");
}
{
  /* Expansion honesty is depth-2-only: a depth-1 map must print no expansion
   * bit at all, even when the flags are set. */
  const s = T.statusText({ seeds: [{ id: "1.2.1", name: "alice" }], unknown: [],
    stats: { scanned: 42, edges: 3, nodes: 4, truncated: false, droppedSelf: 0,
      droppedShape: 0, missingCredit: 0, caps: {}, depth: 1,
      expanded: ["1.2.2"], unexpanded: 1, expansionScanned: 4, expansionTruncated: true } });
  ok(!/expansion scans truncated/.test(s), "depth-1 hides the expansion-truncation line (" + s + ")");
  ok(!/expanded:/.test(s) && !/unexpanded/.test(s), "depth-1 hides the expanded/unexpanded bits");
  ok(!/from expansions/.test(s), "depth-1 hides the expansion scan count");
}

/* ---- detail: human amount, both ends, count, flow-vs-relation ---- */
{
  const d = T.detailText({
    edge: { a: "1.2.1", b: "1.2.2", cls: "credit", kind: "flow", count: 3,
      perAsset: { "1.3.0": "7500000" }, firstSeen: "2026-01-01T00:00:00", lastSeen: "2026-06-01T00:00:00" },
    names: { "1.2.1": "alice", "1.2.2": "bob" },
    assets: { "1.3.0": { sym: "BTS", prec: 5 } }
  });
  ok(/alice/.test(d) && /bob/.test(d), "detail names both ends");
  ok(/75(\.0+)? BTS/.test(d), "detail renders the raw amount in human terms (7500000 @ p5 = 75 BTS) (" + d + ")");
  ok(/3/.test(d), "detail states the op count");
  ok(/flow/i.test(d), "detail states flow vs relation");
  ok(/2026-01-01/.test(d) && /2026-06-01/.test(d), "detail states the time span");
  ok(/3 ops/.test(d), "plural op count reads correctly (" + d + ")");
  /* Singular: "1 ops" was the alternative and it reads like a bug. */
  const one = T.detailText({ edge: { a: "1.2.1", b: "1.2.2", cls: "transfer", kind: "flow", count: 1,
    perAsset: { "1.3.0": "100000" }, firstSeen: null, lastSeen: null },
    names: {}, assets: { "1.3.0": { sym: "BTS", prec: 5 } } });
  ok(/1 op[^s]/.test(one), "one op reads as singular (" + one + ")");
}
{
  const d = T.detailText({ edge: { a: "1.2.1", b: "1.2.2", cls: "vesting", kind: "relation", count: 1, perAsset: {} },
    names: {}, assets: {} });
  ok(/relation/i.test(d), "a relation line says so (" + d + ")");
  ok(/vesting/i.test(d), "the class name is in the detail");
}
{
  const d = T.detailText({ edge: null });
  ok(d.length > 0, "an empty selection still returns the hint");
}

/* ---- multi-asset: top asset + "+N more", never a cross-asset sum ---- */
{
  const d = T.detailText({
    edge: { a: "1.2.1", b: "1.2.2", cls: "transfer", kind: "flow", count: 5,
      perAsset: { "1.3.0": "100000000", "1.3.113": "500", "1.3.121": "7" },
      firstSeen: null, lastSeen: null },
    names: {}, assets: { "1.3.0": { sym: "BTS", prec: 5 }, "1.3.113": { sym: "CNY", prec: 4 }, "1.3.121": { sym: "USD", prec: 3 } }
  });
  ok(/1000(\.0+)? BTS/.test(d), "largest asset rendered in human terms (100000000 @ p5 = 1000 BTS)");
  ok(/\+\s*2 more/i.test(d), "remaining assets counted, not summed (" + d + ")");
}

/* ---- table twin ---- */
{
  const rows = T.twinRows({
    nodes: [{ assetId: "1.2.1", sym: "alice" }],
    edges: [{ a: "1.2.1", b: "1.2.2", poolId: "k1", cls: "transfer", kind: "flow", count: 2,
      perAsset: { "1.3.0": "1000" }, firstSeen: null, lastSeen: null },
      { a: "1.2.1", b: "1.2.3", poolId: "k2", cls: "credit", kind: "flow", count: 1,
        perAsset: {}, firstSeen: null, lastSeen: null }]
  }, { "1.2.3": "carol" }, { "1.3.0": { sym: "BTS", prec: 5 } });
  eq(rows.length, 2, "one twin row per edge");
  eq(rows.map((r) => r.rowkey).join(","), "k1,k2", "twin rows carry the edge key as rowkey");
  eq(rows[0].from, "alice", "twin row uses the node's own name");
  eq(rows[0].to, "1.2.2", "an unnamed end falls back to its id, never blank");
  ok(/transfer/i.test(rows[0].cls), "twin row names the class");
  ok(/flow/i.test(rows[0].kind), "twin row states flow vs relation");
  ok(/BTS/.test(rows[0].amount), "twin row renders the human amount");
  eq(rows[0].count, "2", "twin row states the op count");
  /* The columns must match the row keys exactly — TableRenderer reads by key,
   * so a mismatch renders an empty column instead of failing loudly. */
   eq(AccountNetworkUI._test.twinColumns().map((c) => c.key).join(","),
      "from,to,cls,kind,amount,count,span,depth", "column keys line up with the row keys");
  ok(AccountNetworkUI._test.twinColumns().every((c) => typeof c.title === "string" && c.title.length),
     "every column has a title");
}

/* ---- hash round-trip ---- */
{
  const url = T.hashFor(["alice", "bob"], ["transfer"]);
  ok(url.indexOf("seeds=") !== -1 && url.indexOf("classes=transfer") !== -1, "hash carries seeds + classes (" + url + ")");
  const q = T.parseHash(url);
  eq(q.seeds, ["alice", "bob"], "hash seeds parse back");
  eq(q.classes, ["transfer"], "hash classes parse back");
  eq(T.parseHash("#/account-network"), { seeds: [], classes: [] }, "empty hash is empty");
  eq(T.parseHash(""), { seeds: [], classes: [] }, "empty string never throws");
  eq(T.parseHash("#/account-network?seeds=a&bogus=x").seeds, ["a"], "unknown params are ignored");
}

/* ---- ES states: honest, actionable, never a fabricated zero ---- */
{
  ok(/index/i.test(T.esErrorText("es-disabled")), "ES-off copy names the index");
  ok(/settings/i.test(T.esErrorText("es-disabled")), "ES-off copy points at Settings");
  ok(/reachable/i.test(T.esErrorText("es-unavailable")), "unreachable copy says unreachable");
  ok(/not an account/i.test(T.esErrorText("bad-account-id")), "bad seed copy says it is not an account");
  ok(!/no transfers|0 candles|no data/i.test(T.esErrorText("es-disabled")), "no fabricated zero-state copy");
}

/* ---- class -> colour token (canvas ink) ---- */
{
  eq(T.classToken("transfer"), "accent", "transfer lines take the accent ink");
  eq(T.classToken("credit"), "buy", "credit lines take the buy ink");
  eq(T.classToken("vesting"), "muted", "relation lines stay muted");
  eq(T.classToken("nope"), "muted", "an unknown class stays muted (never crashes the canvas)");
}

/* ---- depth prefs + hash ---- */
{
  const d = T.parseDepth("#/account-network?seeds=a&depth=2&ring1=12&ring2=3");
  eq(d, { depth: 2, ring1: 12, ring2: 3 }, "depth hash parses depth + rings");
  eq(T.parseDepth("#/account-network?depth=9"), { depth: 1, ring1: 40, ring2: 8 }, "bad depth normalizes");
  const h = T.hashForDepth(["a"], ["transfer"], 2, 12, 3);
  ok(h.indexOf("depth=2") !== -1 && h.indexOf("ring1=12") !== -1 && h.indexOf("ring2=3") !== -1, "depth hash round-trips (" + h + ")");
  eq(T.depthLabel(2), "2 hops", "depth label is plural");
  eq(T.depthLabel(1), "1 hop", "depth label is singular");
}

/* ---- depth status + twin ---- */
{
  const s = T.statusText({ seeds: [{ id: "1.2.1", name: "alice" }], unknown: [],
    stats: { scanned: 10, edges: 3, nodes: 4, truncated: false, droppedSelf: 0,
      droppedShape: 0, missingCredit: 0, caps: {}, depth: 2, ring1: 40, ring2: 1,
      expanded: ["1.2.2"], unexpanded: 1, expansionScanned: 4, expansionTruncated: false } });
  ok(/2 hops/.test(s), "depth-2 status names the depth (" + s + ")");
  ok(/1\.2\.2/.test(s) && /unexpanded/.test(s), "expanded and unexpanded accounts are disclosed");
  const rows = T.twinRows({ nodes: [{ assetId: "1.2.1", sym: "alice" }, { assetId: "1.2.2", sym: "bob" }],
    edges: [{ a: "1.2.1", b: "1.2.2", poolId: "k1", cls: "transfer", kind: "flow", count: 2,
      perAsset: {}, firstSeen: null, lastSeen: null, depth: 2 }] }, {}, {});
  eq(rows[0].depth, "2 hops", "twin rows carry hop depth");
  eq(T.twinColumns().map((c) => c.key).join(","), "from,to,cls,kind,amount,count,span,depth", "twin adds a depth column");
}

const DepthUI = require("/workspace/vanilla/js/views/account-network-depth-ui.js");

/* ---- depth widget sanitizer ---- */
eq(DepthUI.sanitize({ depth: "2", ring1: "999", ring2: "0" }),
  { depth: 2, ring1: 40, ring2: 1 }, "widget sanitizes depth inputs through the depth policy");

console.log("account-network-ui: " + pass + " pass, " + fail + " fail");
process.exitCode = fail ? 1 : 0;