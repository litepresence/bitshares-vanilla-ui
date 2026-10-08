/* market-count-note-test.js — the candle-count note states what is PLOTTED.
 *
 * Regression: the note used to echo the REQUESTED window ("2000 × 1h
 * candles") while leading-gap drops meant only 1610 buckets painted. The
 * note must state actual delivery ("1610 of 2000 × 1h candles") whenever
 * the candle set on state matches the current bucket+count, and keep the
 * requested-only text before the first fill or when params moved on.
 *
 * Run: node tooling/market-count-note-test.js */
var ok = 0, bad = 0;
function assert(cond, msg) { if (cond) { ok++; } else { bad++; console.log("FAIL: " + msg); } }

var MarketInd = require("../vanilla/js/views/market-ind-panes.js");
var paint = MarketInd._panes.paintCountNote;
assert(typeof paint === "function", "paintCountNote exported");

function noteFor(state) {
  var el = { textContent: "" };
  state.countNote = el;
  paint(state);
  return el.textContent;
}
function buckets(n) {
  var out = [];
  for (var i = 0; i < n; i++) out.push({ timeMs: i });
  return out;
}

/* 1. Pre-fill: no candleKey stamped yet -> requested-only text (unchanged). */
assert(noteFor({ bucket: 3600, discrete: false }) === "2000 × 1h candles",
  "pre-fill shows the requested window");

/* 2. Full delivery -> unchanged text. */
assert(noteFor({ bucket: 3600, discrete: false, candleKey: "3600|2000",
  candles: { buckets: buckets(2000) } }) === "2000 × 1h candles",
  "full delivery shows the plain window");

/* 3. Shortfall (leading gaps dropped) -> actual stated honestly. */
assert(noteFor({ bucket: 3600, discrete: false, candleKey: "3600|2000",
  candles: { buckets: buckets(1610) } }) === "1610 of 2000 × 1h candles",
  "shortfall states actual of requested");

/* 4. Empty delivery for current params -> honest zero, never blank. */
assert(noteFor({ bucket: 3600, discrete: false, candleKey: "3600|2000",
  candles: { buckets: [] } }) === "0 of 2000 × 1h candles",
  "empty window states zero of requested");

/* 5. Stale set (count moved on after the fetch) -> requested text, never
 * a mismatched "actual of requested". */
assert(noteFor({ bucket: 3600, discrete: false, candleKey: "3600|2000",
  candles: { buckets: buckets(1610) } }) !== "1610 of 500 × 1h candles",
  "sanity: fixture really is 1610");

/* 5b. Stale set, properly: key from the old params must not leak numbers
 * from the wrong window into the note. Simulate by calling with a state
 * whose key matches an OLD count while internal CANDLE_COUNT is 2000:
 * only the keyed match may show actuals. */
var stale = noteFor({ bucket: 3600, discrete: false, candleKey: "3600|500",
  candles: { buckets: buckets(500) } });
assert(stale === "2000 × 1h candles",
  "stale key falls back to requested text (got " + JSON.stringify(stale) + ")");

/* 6. Discrete mode untouched: actual FILL count, as before. */
assert(noteFor({ discrete: true, points: buckets(37) }) === "37 fills",
  "discrete still reports actual fills");

/* 7. Missing note element never throws. */
try { paint({ bucket: 3600, discrete: false, countNote: null }); ok++; }
catch (e) { bad++; console.log("FAIL: null countNote threw"); }

console.log("market-count-note: " + ok + " passed, " + bad + " failed");
if (bad > 0) process.exit(1);