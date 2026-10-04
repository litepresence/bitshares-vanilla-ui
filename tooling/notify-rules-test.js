/* notify-rules-test.js — pure-logic vectors for api/notify-rules.js.
 * Stdlib assert only (tooling/dom-test.js precedent). No network, no socket,
 * deterministic; exit 0 = green. Run: node tooling/notify-rules-test.js
 * Seams: pairKey, compare (exact decimal, promoted from
 *   tooling/check_notify_split.cjs patterns), addRule/removeRule/rulesFor/hasAny,
 *   checkAlerts fired-kept split, checkHistory watcher, sweepStale hygiene.
 * State note: rules persist via guarded storage (in-memory under node); every
 * vector uses unique NR/ZZ pairs and removes them, so reruns stay green.
 * GAPS: _decParts is private — covered indirectly via compare/addRule; toast
 *   queue + prefs + browser gate live in notify.js (Notify delegate, guarded);
 *   no view DOM or chain reads exist in this module.
 */
"use strict";
var path = require("path");
var assert = require("assert");
var NotifyRules = require(path.join(__dirname, "..", "vanilla", "js", "api", "notify-rules.js"));

var pass = 0, fail = 0;
var cur = null;
function section(name) {
  if (cur) console.log(cur.name + ": " + cur.n + " passed, 0 failed");
  cur = { name: name, n: 0 };
}
function eq(actual, expected, name) {
  var a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; cur.n++; }
  else { fail++; console.log("FAIL " + name + " want=" + e + " got=" + a); }
}
function throwsRe(fn, re, name) {
  try { fn(); fail++; console.log("FAIL " + name + " (no throw)"); }
  catch (e) { if (re.test(e.message)) { pass++; cur.n++; } else { fail++; console.log("FAIL " + name + " wrong error: " + e.message); } }
}

function drop(key) { try { NotifyRules.removeRule(key); } catch (e) { /* already gone */ } }

function main() {
  section("pairKey");
  eq(NotifyRules.pairKey("BTS", "USD"), "BTS_USD", "pairkey basic");
  eq(NotifyRules.pairKey("bts", "usd"), "BTS_USD", "pairkey case folds");
  eq(NotifyRules.pairKey("  BTS ", " usd"), "BTS_USD", "pairkey trims");
  throwsRe(function () { NotifyRules.pairKey("BTS", "BTS"); }, /bad-pair/, "pairkey same pair throws");
  throwsRe(function () { NotifyRules.pairKey("", "USD"); }, /bad-pair/, "pairkey empty throws");
  throwsRe(function () { NotifyRules.pairKey("BTS", ""); }, /bad-pair/, "pairkey empty base throws");
  throwsRe(function () { NotifyRules.pairKey(null, "USD"); }, /bad-pair/, "pairkey null throws");
  eq(NotifyRules.STALE_MS, 7 * 24 * 3600 * 1000, "stale window 7 days");

  section("compare");
  eq(NotifyRules.compare("0.1", "0.10"), 0, "compare trailing zero equal");
  eq(NotifyRules.compare("1.00", "1"), 0, "compare integer/decimal equal");
  eq(NotifyRules.compare("0.1000001", "0.10"), 1, "compare frac greater");
  eq(NotifyRules.compare("999", "1000"), -1, "compare int length shortcut");
  eq(NotifyRules.compare("123456789012345678901234567890.123", "123456789012345678901234567890.122"), 1, "compare long exact");
  eq(NotifyRules.compare("-1", "1"), -1, "compare negative less");
  eq(NotifyRules.compare("-2", "-10"), 1, "compare negatives flip");
  eq(NotifyRules.compare("007", "7"), 0, "compare leading zeros equal");
  eq(NotifyRules.compare(" 1.5 ", "1.50"), 0, "compare trims");
  throwsRe(function () { NotifyRules.compare("NaN", "1"); }, /bad-rule/, "compare NaN throws");
  throwsRe(function () { NotifyRules.compare("1.2.3", "1"); }, /bad-rule/, "compare malformed throws");
  throwsRe(function () { NotifyRules.compare("", "1"); }, /bad-rule/, "compare empty throws");

  section("rules-crud");
  drop("NR1_ZZ1|1|1.50");
  eq(NotifyRules.addRule({ quote: "NR1", base: "ZZ1", type: "1", price: "1.50" }), { key: "NR1_ZZ1|1|1.50" }, "addrule key shape");
  eq(NotifyRules.addRule({ quote: "NR1", base: "ZZ1", type: "1", price: "1.50" }), { key: "NR1_ZZ1|1|1.50" }, "addrule idempotent");
  eq(NotifyRules.rulesFor("nr1", "zz1").length, 1, "rulesfor case-insensitive");
  eq(NotifyRules.hasAny("NR1", "ZZ1"), true, "hasany true");
  eq(NotifyRules.hasAny("NR1", "ZZ9"), false, "hasany false");
  eq(NotifyRules.removeRule("NR1_ZZ1|1|1.50"), { removed: true }, "removerule true");
  eq(NotifyRules.removeRule("NR1_ZZ1|1|1.50"), { removed: false }, "removerule repeat false");
  throwsRe(function () { NotifyRules.addRule({ quote: "NR1", base: "ZZ1", type: "3", price: "1" }); }, /bad-rule/, "addrule bad type throws");
  throwsRe(function () { NotifyRules.addRule({ quote: "", base: "ZZ1", type: "1", price: "1" }); }, /bad-pair|bad-rule/, "addrule empty pair throws");
  throwsRe(function () { NotifyRules.addRule({ quote: "NR1", base: "ZZ1", type: "1", price: "1.50", basePrec: 1, quotePrec: 1 }); }, /bad-rule/, "addrule over cap throws");
  eq(NotifyRules.addRule({ quote: "NR1", base: "ZZ1", type: "2", price: "1.5", basePrec: 1, quotePrec: 5 }).key, "NR1_ZZ1|2|1.5", "addrule cap uses max prec");
  drop("NR1_ZZ1|2|1.5");
  throwsRe(function () { NotifyRules.checkAlerts("NR1", "1.0"); }, /bad-pair/, "checkalerts bad key throws");

  section("fired-kept");
  drop("NR2_ZZ2|1|1.50"); drop("NR2_ZZ2|2|1.50");
  NotifyRules.addRule({ quote: "NR2", base: "ZZ2", type: "1", price: "1.50" });
  NotifyRules.addRule({ quote: "NR2", base: "ZZ2", type: "2", price: "1.50" });
  var r = NotifyRules.checkAlerts("NR2_ZZ2", "1.50");
  eq(r.fired.length, 2, "both fire at equal");
  eq(r.kept, 0, "kept zero after self-delete");
  eq(NotifyRules.rulesFor("NR2", "ZZ2").length, 0, "fired rules deleted");
  r = NotifyRules.checkAlerts("NR2_ZZ2", null);
  eq(r, { fired: [], kept: 0 }, "null price never fires");
  r = NotifyRules.checkAlerts("NR2_ZZ2", "NaN");
  eq(r, { fired: [], kept: 0 }, "malformed price never fires");
  NotifyRules.addRule({ quote: "NR2", base: "ZZ2", type: "1", price: "9.99" });
  r = NotifyRules.checkAlerts("NR2_ZZ2", "1.00");
  eq(r, { fired: [], kept: 1 }, "below HIGHER threshold keeps");
  NotifyRules.addRule({ quote: "NR2", base: "ZZ2", type: "2", price: "0.01" });
  r = NotifyRules.checkAlerts("NR2_ZZ2", "0.005");
  eq([r.fired.length, r.kept], [1, 1], "below LOWER fires, HIGHER kept");
  drop("NR2_ZZ2|1|9.99"); drop("NR2_ZZ2|2|0.01");
  r = NotifyRules.checkAlerts("nr2_zz2", "1.00");
  eq(r, { fired: [], kept: 0 }, "pair key case folds");

  section("history");
  var h = NotifyRules.checkHistory(null, [{ id: "1.11.1", op: [4, {}] }], {});
  eq(h, { events: [], firstId: "1.11.1" }, "no prev id baselines silent");
  h = NotifyRules.checkHistory("1.11.1", [{ id: "1.11.1", op: [4, {}] }], {});
  eq(h.events.length, 0, "same id silent");
  h = NotifyRules.checkHistory("1.11.0",
    [{ id: "1.11.2", op: [4, {}] }, { id: "1.11.1", op: [99, {}] }, { id: "1.11.0", op: [4, {}] }], {});
  eq(h.events.length, 1, "fill fires, unknown op silent");
  eq(h.events[0].kind, "fill", "fill kind");
  eq(h.firstId, "1.11.2", "firstId advances");
  h = NotifyRules.checkHistory("1.11.2", [{ id: "1.11.3", op: [0, { to: "1.2.7" }] }], { watchAccounts: ["1.2.7"] });
  eq(h.events.length, 1, "transfer-to-me fires when unwatched-gate defaults on");
  eq(h.events[0].kind, "transfer-to-me", "transfer kind");
  h = NotifyRules.checkHistory("1.11.2", [{ id: "1.11.3", op: [0, { to: "1.2.9" }] }], { watchAccounts: ["1.2.7"] });
  eq(h.events.length, 0, "unwatched transfer silent");
  h = NotifyRules.checkHistory("1.11.2", [{ id: "1.11.3", op: ["fill_order", {}] }], {});
  eq(h.events.length, 1, "string op name fill fires");
  global.Notify = { prefs: function () { return { transferToMe: false }; }, push: function () {} };
  h = NotifyRules.checkHistory("1.11.3", [{ id: "1.11.4", op: [0, { to: "1.2.7" }] }], { watchAccounts: ["1.2.7"] });
  eq(h.events.length, 0, "transfer silent when pref off");
  delete global.Notify;
  h = NotifyRules.checkHistory("1.11.9", [], {});
  eq(h, { events: [], firstId: "1.11.9" }, "empty rows keep prev id");

  section("sweep");
  drop("NRD_ZZD|1|1");
  NotifyRules.addRule({ quote: "NRD", base: "ZZD", type: "1", price: "1" });
  var s = NotifyRules.sweepStale(function () { return false; });
  eq([s.kept, s.dropped, s.marked], [1, 0, 1], "unresolvable marked once");
  s = NotifyRules.sweepStale(function () { return true; });
  eq(s.kept, 1, "resolvable clears badge");
  eq(NotifyRules.rules().filter(function (x) { return x.key === "NRD_ZZD|1|1"; })[0].unresolvedSince, undefined, "badge cleared on resolve");
  throwsRe(function () { NotifyRules.sweepStale("nope"); }, /bad-rule/, "sweep non-function throws");
  s = NotifyRules.sweepStale(function () { throw new Error("boom"); });
  eq(s.kept >= 1, true, "resolver error keeps rules");
  drop("NRD_ZZD|1|1");

  console.log(cur.name + ": " + cur.n + " passed, 0 failed");
  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
}

main();
