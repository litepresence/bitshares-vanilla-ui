/* market-desk-query.js — desk persistence + deep-link URL state.
 *
 * What it owns: network/defaultMarket (sole settings-owner reads),
 *   saveLast + LAST_KEY (last-visited market persistence — market-ui.js
 *   homeTarget reads the same key string, single reader + single writer),
 *   GROUP_CHOICES/KEY_RE/indKeys/flag01/keyList + readDeskQuery/
 *   buildDeskQuery/syncUrl (?tf=/over=/osc=/log=/vwap=/depth=/pmap=/dx=/
 *   dy=/trades=/group= — shareable links, back-button-safe; unknown values
 *   fall back to defaults). No DOM, no timers, no signing.
 * Consumes: Store (network), Router.query (read seed), history.replaceState
 *   (write-back, never a re-render), localStorage (LAST_KEY). Globals/side
 *   effects: attaches MarketDesk._query and republishes globalThis.MarketDesk.
 *   Split from market-desk.js (mechanical move, zero behavior change —
 *   called by the facade + fill via the registry). Facade: market-desk.js.
 * Created by: split_responsibility.py account/market frontier.
 */
var MarketDesk = (typeof globalThis !== "undefined" && globalThis.MarketDesk) ? globalThis.MarketDesk : ((typeof MarketDesk !== "undefined") ? MarketDesk : {});
MarketDesk._query = MarketDesk._query || {};
(function () {
  "use strict";

  /* Network from Store (sole settings owner); mainnet when unreadable. */
  function network() {
    try {
      if (typeof Store !== "undefined" && Store && typeof Store.loadSettings === "function") {
        var s = Store.loadSettings();
        if (s && (s.network === "testnet" || s.network === "mainnet")) return s.network;
      }
    } catch (e) { /* default stands */ }
    return "mainnet";
  }

  /* Canonical default market per bitshares-ui/app/branding.js:98-108. */
  function defaultMarket() {
    return network() === "testnet" ? "USD_TEST" : "BTS_CNY";
  }

  /* Last-visited market id (own key: Store.saveSettings drops unknown keys,
   * so view state lives here, never in settings). */
  function saveLast(id) {
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(LAST_KEY, id);
    } catch (e) { /* private mode: desk still works, just not remembered */ }
  }

  var LAST_KEY = "bts-vanilla-last-market-v1";

  /* Desk deep-link state (?tf=&over=&osc=&log=&vwap=&depth=&pmap=&dx=&dy=&
   * trades=&group= — shareable links, back-button-safe). Indicator keys are
   * stable identifiers (OSC_ORDER/OVERLAY_DEFS symbols); only non-default
   * values serialize so plain pairs stay clean (#/market/BTS_USD). Unknown
   * or malformed values fall back to current defaults — never throw, never
   * blank. Overlay instances serialize as bare keys (default params on
   * open — documented limitation, same class as the invoice worker). */
  var GROUP_CHOICES = [8, 6, 4, 2];

  var KEY_RE = /^[a-z0-9]+$/;

  /* indKeys: valid indicator keys from the MarketInd def tables (guarded —
   * tests inject fakes; absent MarketInd drops both lists, never throws). */
  function indKeys(indApi) {
    var over = {}, osc = {};
    try {
      var api = indApi || ((typeof MarketInd !== "undefined" && MarketInd) ? MarketInd : null);
      if (api) {
        (api.OVERLAY_DEFS || []).forEach(function (def) {
          if (def && KEY_RE.test(def[0])) over[def[0]] = true;
        });
        (api.OSC_ORDER || []).forEach(function (def) {
          if (def && KEY_RE.test(def[0])) osc[def[0]] = true;
        });
      }
    } catch (e) { /* empty sets below */ }
    return { over: over, osc: osc };
  }

  function flag01(v, dflt) {
    if (v === "1") return true;
    if (v === "0") return false;
    return dflt;
  }

  function keyList(raw, valid) {
    var out = [];
    try {
      String(raw || "").split(",").forEach(function (k) {
        k = k.trim().toLowerCase();
        if (k && KEY_RE.test(k) && valid[k] && out.indexOf(k) === -1) out.push(k);
      });
    } catch (e) { /* out stands */ }
    return out;
  }

  /* readDeskQuery: URL -> desk seed (unit-tested). Params: raw (query object
   * from Router.query(), or null), indApi (optional MarketInd override for
   * tests). Returns a full seed with defaults filled. Bucket bounds are
   * advisory (live reconcile corrects against the node list); indicator
   * keys outside the def tables are dropped. Never throws. */
  function readDeskQuery(raw, indApi) {
    var q = (raw && typeof raw === "object") ? raw : {};
    var keys = indKeys(indApi);
    var seed = {
      bucket: 3600, discrete: false, over: {}, osc: {},
      logScale: false, showVwap: false, showDepth: false, showPoolMap: true,
      depthLogX: true, depthLogY: true, tradesTab: "recent", groupDec: null
    };
    try {
      var tf = parseInt(q.tf, 10);
      if (Number.isInteger(tf) && tf > 0 && tf <= 86400 * 30) seed.bucket = tf;
      if (typeof q.tf === "string" && q.tf.trim().toLowerCase() === "discrete") seed.discrete = true;
      keyList(q.over, keys.over).forEach(function (k) { seed.over[k] = [{}]; });
      keyList(q.osc, keys.osc).forEach(function (k) { seed.osc[k] = true; });
      seed.logScale = flag01(q.log, false);
      seed.showVwap = flag01(q.vwap, false);
      seed.showDepth = flag01(q.depth, false);
      seed.showPoolMap = flag01(q.pmap, true);
      seed.depthLogX = flag01(q.dx, true);
      seed.depthLogY = flag01(q.dy, true);
      if (q.trades === "my" || q.trades === "recent") seed.tradesTab = q.trades;
      var g = parseInt(q.group, 10);
      if (GROUP_CHOICES.indexOf(g) !== -1) seed.groupDec = g;
    } catch (e) { /* defaults stand */ }
    return seed;
  }

  /* buildDeskQuery: desk state -> "?k=v" (unit-tested). Params: state (desk
   * state object). Returns "" when everything is default, else the query
   * string with leading "?". Pure, never throws. */
  function buildDeskQuery(state) {
    var parts = [];
    try {
      var s = state || {};
      /* Discrete mode (raw fills, no buckets): tf=discrete serializes the
       * mode; over/osc/vwap/depth/pmap are meaningless without buckets and
       * stay suppressed so a shared link never resurrects dead plots. Log,
       * depth scales, trades tab and grouping ride along (still meaningful). */
      var isDiscrete = !!(s && s.discrete);
      if (isDiscrete) parts.push("tf=discrete");
      if (!isDiscrete && Number.isInteger(s.bucket) && s.bucket > 0 && s.bucket !== 3600) parts.push("tf=" + s.bucket);
      var ol = Object.keys(s.over || {}).filter(function (k) {
        return KEY_RE.test(k) && s.over[k] && s.over[k].length;
      });
      if (!isDiscrete && ol.length) parts.push("over=" + ol.join(","));
      var sl = Object.keys(s.osc || {}).filter(function (k) {
        return KEY_RE.test(k) && !!s.osc[k];
      });
      if (!isDiscrete && sl.length) parts.push("osc=" + sl.join(","));
      if (s.logScale) parts.push("log=1");
      if (!isDiscrete && s.showVwap) parts.push("vwap=1");
      if (!isDiscrete && s.showDepth) parts.push("depth=1");
      if (!isDiscrete && s.showPoolMap === false) parts.push("pmap=0");
      if (s.depthLogX === false) parts.push("dx=0");
      if (s.depthLogY === false) parts.push("dy=0");
      if (s.tradesTab === "my") parts.push("trades=my");
      if (GROUP_CHOICES.indexOf(s.groupDec) !== -1) parts.push("group=" + s.groupDec);
    } catch (e) { /* parts stand */ }
    return parts.length ? ("?" + parts.join("&")) : "";
  }

  /* syncUrl: write current desk state into the hash without re-rendering
   * (api-lab deepLink precedent — replaceState never fires hashchange, so
   * no render loop). Params: state (desk state, needs .id). Returns
   * nothing. Fails: never (every DOM/history touch guarded — the desk
   * works identically with the URL untouched). */
  function syncUrl(state) {
    try {
      if (!state || typeof state.id !== "string" || !state.id) return;
      if (typeof location === "undefined" || !location.href) return;
      if (typeof history === "undefined" || typeof history.replaceState !== "function") return;
      history.replaceState(null, "", location.href.split("#")[0] + "#/market/" + state.id + buildDeskQuery(state));
    } catch (e) { /* URL stays; view unaffected */ }
  }
  MarketDesk._query.network = network;
  MarketDesk._query.defaultMarket = defaultMarket;
  MarketDesk._query.saveLast = saveLast;
  MarketDesk._query.readDeskQuery = readDeskQuery;
  MarketDesk._query.buildDeskQuery = buildDeskQuery;
  MarketDesk._query.syncUrl = syncUrl;
  if (typeof globalThis !== "undefined") { globalThis.MarketDesk = MarketDesk; }
})();

if (typeof module !== "undefined") { module.exports = MarketDesk; }
