/* Duration: single duration/time-ago shaping owner (R-A-W6 V8 funnel).
 * Owns: decompose (seconds -> d/h/m/s integer parts), formatFull (htlc
 *   "1 day 1 hour"/"0 seconds" shape), agoMinutes (settings-nodes
 *   "just now"/"Nm ago" shape), countdownText (prediction "Expired 2d 3h
 *   ago"/"2d 3h" shape). All three shapes are byte-preserved from their
 *   origin files — this module is a move, not a redesign.
 * Consumes: nothing. Side effects: global Duration only. No DOM, no chain,
 *   no locale keys (value-preserving refactor only).
 * Created by: R-A-W6 time/date funnel task.
 */
/* global globalThis, module */
var Duration = (function () {
  "use strict";

  /* Seconds -> {d,h,m,s} integer parts (single division/mod site).
   * Params: sec non-negative integer. Returns parts object.
   * Fails: throws on non-integer/negative input. */
  /**
   * @param {number} sec
   * @returns {{d:number,h:number,m:number,s:number}}
   */
  function decompose(sec) {
    if (!Number.isInteger(sec) || sec < 0) throw new Error("bad duration seconds: " + JSON.stringify(sec));
    var d = Math.floor(sec / 86400);
    var h = Math.floor((sec % 86400) / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    return { d: d, h: h, m: m, s: s };
  }

  /* Seconds -> human duration ("86400" -> "1 day"; 90000 -> "1 day 1 hour").
   * Byte-preserved from htlc.js formatDuration (full unit words, pluralized,
   * "0 seconds" for zero). Integer math only.
   * @param {any} sec
   * @returns {string} */
  function formatFull(sec) {
    var n = (typeof sec === "string") ? parseInt(sec, 10) : sec;
    if (!Number.isInteger(n) || n < 0) throw new Error("bad duration seconds: " + JSON.stringify(sec));
    var p = decompose(n);
    var parts = [];
    if (p.d) parts.push(p.d + " day" + (p.d === 1 ? "" : "s"));
    if (p.h) parts.push(p.h + " hour" + (p.h === 1 ? "" : "s"));
    if (p.m) parts.push(p.m + " minute" + (p.m === 1 ? "" : "s"));
    if (p.s) parts.push(p.s + " second" + (p.s === 1 ? "" : "s"));
    return parts.length ? parts.join(" ") : "0 seconds";
  }

  /* Minutes-since text for a last-good stamp (whole minutes, floor).
   * Byte-preserved from settings-nodes.js agoMinutes.
   * Params: t epoch ms (or null), nowMs epoch ms (defaults Date.now()).
   * Returns e.g. "5m ago", "just now", or null. Never throws. */
  /**
   * @param {any} t
   * @param {number} [nowMs]
   * @returns {string|null}
   */
  function agoMinutes(t, nowMs) {
    try {
      if (!(typeof t === "number" && isFinite(t))) return null;
      var now = (typeof nowMs === "number" && isFinite(nowMs)) ? nowMs : Date.now();
      var m = Math.floor(Math.max(0, now - t) / 60000);
      return (m < 1) ? "just now" : (m + "m ago");
    } catch (e) { return null; }
  }

  /* Shaping for countdown parts (English time units, deterministic).
   * Byte-preserved from prediction.js countdownText: none->"No expiry";
   * now->"Closes now"; expired->"Expired … ago" largest nonzero unit first
   * then largest two ("Expired 2d ago", "Expired 2d 3h ago"); future->
   * largest two units ("2d 3h", "3h 5m", "5m 10s", "10s"). Sub-second
   * future shapes "0s" (honest, never invented "<1s").
   * Params: parts {state,days,hours,mins,secs}. Returns string. Never throws. */
  /**
   * @param {any} parts
   * @returns {string}
   */
  function countdownText(parts) {
    try {
      parts = parts || {};
      if (parts.state === "none") return "No expiry";
      if (parts.state === "now") return "Closes now";
      /** @param {number} d @param {number} h @param {number} m @param {number} s @returns {string} */
      function two(d, h, m, s) {
        if (d > 0) return h > 0 ? d + "d " + h + "h" : d + "d";
        if (h > 0) return m > 0 ? h + "h " + m + "m" : h + "h";
        if (m > 0) return s > 0 ? m + "m " + s + "s" : m + "m";
        return s + "s";
      }
      var body = two(parts.days || 0, parts.hours || 0, parts.mins || 0, parts.secs || 0);
      if (parts.state === "expired") return "Expired " + body + " ago";
      return body;
    } catch (e) {
      return "No expiry";
    }
  }

  return { decompose: decompose, formatFull: formatFull, agoMinutes: agoMinutes, countdownText: countdownText };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.Duration === "undefined") { globalThis.Duration = Duration; }
if (typeof module !== "undefined") { module.exports = Duration; }
