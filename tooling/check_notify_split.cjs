/* check_notify_split.cjs — offline behavior vectors for the slice-16 cap-breach
 * split (notify.js + notify-rules.js + notify-host.js + notify-ui.js).
 * Loads the REAL files in index.html script order and asserts identical
 * trigger semantics: exact compare, higher/lower incl. fire-at-equal, NaN/
 * null never fires, self-delete, fill-diff, transfer gate, same-id silence,
 * prefs round-trip, browser skip reasons, durations. Exits nonzero on failure.
 * Usage: node tooling/check_notify_split.cjs (from /workspace).
 */
"use strict";
const Notify = require("../vanilla/js/notify.js");
const NotifyRules = require("../vanilla/js/notify-rules.js");
const NotifyHost = require("../vanilla/js/notify-host.js");
const NotifyUI = require("../vanilla/js/notify-ui.js");

let pass = 0, fail = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log("ok   " + name); }
  else { fail++; console.log("FAIL " + name + " want=" + e + " got=" + a); }
}
function throwsEn(fn, name) {
  try { fn(); fail++; console.log("FAIL " + name + " (no throw)"); }
  catch (e) { pass++; console.log("ok   " + name + " (" + e.message + ")"); }
}

/* 1. Interface shape: rules fns live on NotifyRules, toast hook stays on Notify. */
eq(typeof NotifyRules.compare, "function", "NotifyRules.compare present");
eq(typeof NotifyRules.checkAlerts, "function", "NotifyRules.checkAlerts present");
eq(typeof NotifyRules.checkHistory, "function", "NotifyRules.checkHistory present");
eq(typeof NotifyRules.sweepStale, "function", "NotifyRules.sweepStale present");
eq(typeof NotifyRules.addRule, "function", "NotifyRules.addRule present");
eq(typeof NotifyRules.removeRule, "function", "NotifyRules.removeRule present");
eq(typeof NotifyRules.rulesFor, "function", "NotifyRules.rulesFor present");
eq(typeof NotifyRules.hasAny, "function", "NotifyRules.hasAny present");
eq(typeof Notify.txConfirmed, "function", "Notify.txConfirmed stays");
eq(typeof Notify.push, "function", "Notify.push stays");
eq(Notify.checkAlerts, undefined, "Notify.checkAlerts moved off");
eq(Notify.checkHistory, undefined, "Notify.checkHistory moved off");
eq(Notify.compare, undefined, "Notify.compare moved off");
eq(typeof NotifyHost.mountToasts, "function", "NotifyHost.mountToasts present");
eq(typeof NotifyHost.bellFor, "function", "NotifyHost.bellFor present");
eq(typeof NotifyHost.mark, "function", "NotifyHost.mark present");
eq(typeof NotifyHost.live, "function", "NotifyHost.live present");
eq(typeof NotifyUI.render, "function", "NotifyUI.render present");
eq(typeof NotifyUI.mountToasts, "function", "NotifyUI.mountToasts alias present");
eq(typeof NotifyUI.bellFor, "function", "NotifyUI.bellFor alias present");
eq(NotifyHost.bellFor("BTS", "USD"), null, "bellFor headless null (no DOM)");
eq(NotifyHost.mountToasts(), null, "mountToasts headless null (no DOM)");
eq(Notify.DURATIONS, { toast: 10000, alert: 30000, fill: 5000 }, "durations verbatim");
eq(NotifyRules.STALE_MS, 7 * 24 * 3600 * 1000, "stale window on NotifyRules");

/* 2. Exact compare vectors (zero float). */
eq(NotifyRules.compare("0.1", "0.10"), 0, "compare 0.1 == 0.10");
eq(NotifyRules.compare("0.1000001", "0.10"), 1, "compare 0.1000001 > 0.10");
eq(NotifyRules.compare("123456789012345678901234567890.123", "123456789012345678901234567890.122"), 1, "long-decimal exactness");
eq(NotifyRules.compare("999", "1000"), -1, "integer-length shortcut");
eq(NotifyRules.compare("1.00", "1"), 0, "trailing zeros equal");
throwsEn(() => NotifyRules.compare("NaN", "1"), "compare NaN rejects");

/* 3. checkAlerts fixture: fire-at-equal both directions, guards, self-delete. */
NotifyRules.addRule({ quote: "BTS", base: "USD", type: "1", price: "1.50" });
NotifyRules.addRule({ quote: "BTS", base: "USD", type: "2", price: "1.50" });
let r = NotifyRules.checkAlerts("BTS_USD", "1.50");
eq(r.fired.length, 2, "both fire at equal");
eq(r.kept, 0, "kept zero after self-delete");
eq(NotifyRules.rulesFor("BTS", "USD").length, 0, "fired rules deleted");
r = NotifyRules.checkAlerts("BTS_USD", null);
eq(r, { fired: [], kept: 0 }, "null price never fires");
NotifyRules.addRule({ quote: "BTS", base: "USD", type: "1", price: "9.99" });
r = NotifyRules.checkAlerts("BTS_USD", "NaN");
eq(r, { fired: [], kept: 1 }, "NaN price never fires, rule kept");
r = NotifyRules.checkAlerts("BTS_USD", "1.00");
eq(r, { fired: [], kept: 1 }, "below HIGHER threshold keeps");
NotifyRules.removeRule("BTS_USD|1|9.99");
throwsEn(() => NotifyRules.checkAlerts("BTS", "1.0"), "bad pair key rejects");

/* 4. addRule rejects. */
throwsEn(() => NotifyRules.addRule({ quote: "BTS", base: "USD", type: "3", price: "1" }), "bad type rejects");
throwsEn(() => NotifyRules.addRule({ quote: "", base: "USD", type: "1", price: "1" }), "empty pair rejects");
throwsEn(() => NotifyRules.addRule({ quote: "BTS", base: "USD", type: "1", price: "1.1234567", basePrec: 5, quotePrec: 5 }), "over-precision rejects");

/* 5. checkHistory fixture: fill fires, transfer gated, same-id + unknown silent. */
Notify.clear();
let h = NotifyRules.checkHistory(null, [{ id: "1.11.1", op: [4, {}] }], {});
eq(h, { events: [], firstId: "1.11.1" }, "no prev id -> baseline silent");
h = NotifyRules.checkHistory("1.11.1", [{ id: "1.11.1", op: [4, {}] }], {});
eq(h.events.length, 0, "same-id silent");
h = NotifyRules.checkHistory("1.11.0",
  [{ id: "1.11.2", op: [4, {}] }, { id: "1.11.1", op: [99, {}] }, { id: "1.11.0", op: [4, {}] }], {});
eq(h.events.length, 1, "fill-only fires, unknown op silent");
eq(h.events[0].kind, "fill", "fill kind");
eq(h.firstId, "1.11.2", "firstId advances");
Notify.setPrefs({ transferToMe: true });
h = NotifyRules.checkHistory("1.11.2",
  [{ id: "1.11.3", op: [0, { to: "1.2.7" }] }], { watchAccounts: ["1.2.7"] });
eq(h.events.length, 1, "transfer-to-me fires when gated on");
eq(h.events[0].kind, "transfer-to-me", "transfer kind");
Notify.setPrefs({ transferToMe: false });
h = NotifyRules.checkHistory("1.11.3",
  [{ id: "1.11.4", op: [0, { to: "1.2.7" }] }], { watchAccounts: ["1.2.7"] });
eq(h.events.length, 0, "transfer silent when pref off");
Notify.setPrefs({ transferToMe: true });

/* 6. Prefs round-trip + browser skip reasons (no DOM in node). */
eq(Notify.prefs(), { browser: false, transferToMe: true }, "prefs restore defaults");
eq(Notify.notifyBrowser("t", "b"), { skipped: "disabled" }, "browser off -> disabled");
eq(Notify.setPrefs({ browser: true }), { browser: false, transferToMe: true }, "browser:true ignored without grant");

/* 7. txConfirmed hook still queues a success toast. */
Notify.clear();
const tc = Notify.txConfirmed("block #123");
eq(typeof tc.id, "string", "txConfirmed returns id");
eq(Notify.list().length, 1, "txConfirmed queued");
eq(Notify.list()[0].level, "success", "txConfirmed level success");

/* 8. sweepStale marks then drops after 7 days. */
NotifyRules.addRule({ quote: "DEAD", base: "GONE", type: "1", price: "1" });
let s = NotifyRules.sweepStale(() => false);
eq({ kept: s.kept, dropped: s.dropped, marked: s.marked }, { kept: 1, dropped: 0, marked: 1 }, "unresolvable marked once");
s = NotifyRules.sweepStale(() => true);
eq(s.kept, 1, "resolvable clears badge");
NotifyRules.removeRule("DEAD_GONE|1|1");

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
