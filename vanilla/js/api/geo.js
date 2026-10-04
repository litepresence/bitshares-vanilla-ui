/* Geo: display-only node geolocation (nice-to-know, never load-bearing).
 * Owns: hostname extraction from wss:// URLs, one ipaddress.to lookup per
 *   hostname (https, no key — free fair use), a 24-hour localStorage cache
 *   plus a session-only failure set. Consumes: fetch (guarded — absent
 *   fetch resolves null), localStorage (guarded). Side effects: a single
 *   https GET per uncached hostname, nothing else. Nothing in the app may
 *   depend on this data (no sorting, no health, no selection logic reads
 *   it) — callers paint "—" on null and move on. Our CSP already allows
 *   https: so no policy change was needed for this host.
 * Source history: latencyTEST.py used ip-api.com (free tier is http-only
 *   — "SSL unavailable" verified 2026-10-04 — and our CSP connect-src
 *   blocks http fetches even on localhost, so every lookup dashed).
 *   ipaddress.to verified live 2026-10-04: https, no key, CORS *,
 *   /api/lookup/{hostname} resolves server-side, fair use (we cache 30d).
 * Privacy: the lookup host sees the visitor's address on each request —
 *   disclosed in the settings geo note, answers cached 24 hours.
 * Created by: building-vanilla-slices skill, node-table location column. */
var Geo = (function () {
  "use strict";

  /* Endpoint (verified live 2026-10-04): https, no key, CORS *, hostname
   * queries resolve server-side (/api/lookup/{ip_or_hostname}); city +
   * state + ASN org ride one reply, so the Provider column costs zero
   * extra requests. Fair use (no hard quota — cache results, which we do
   * for 24 hours). */
  var ENDPOINT = "https://ipaddress.to/api/lookup/";
  var CACHE_KEY = "bts-vanilla-node-geo-v2";
  var CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  var FETCH_TIMEOUT_MS = 8000;

  /* Session-only failure set (hostnames that already failed this page-load
   * are not retried — a down ip-api or a blocked fetch must not spam one
   * request per settings visit). Successes persist in localStorage below. */
  var failedThisSession = {};

  /* extractHost: wss:// URL -> bare hostname (port/path stripped).
   * Params: url string. Returns host or "". Fails: never throws. */
  function extractHost(url) {
    try {
      var m = /^wss?:\/\/([^/:]+)/.exec(String(url || ""));
      return m ? m[1] : "";
    } catch (e) {
      return "";
    }
  }

  /* labelOf: lookup record -> "City, Region" display string (the Location
   * column wants City/State: location.city + location.state). Params: rec
   * (parsed JSON object or null). Returns the label or null (caller paints
   * "—"). City-less records fall back to region alone; anything else is
   * unknown, never guessed. Fails: never throws. */
  function labelOf(rec) {
    try {
      if (!rec || typeof rec !== "object" || rec.success !== true) return null;
      var loc = (rec.location && typeof rec.location === "object") ? rec.location : {};
      var city = (typeof loc.city === "string" && loc.city) ? loc.city : "";
      var region = (typeof loc.state === "string" && loc.state) ? loc.state : "";
      if (city && region) return city + ", " + region;
      if (city) return city;
      if (region) return region;
      return null;
    } catch (e) {
      return null;
    }
  }

  /* providerOf: lookup record -> provider display string (the Provider
   * column: hoster like Amazon/Hetzner/Cloudflare). Prefers the ASN org
   * (the network announcing the range) over the registry company name.
   * Shortened to the first token ("Amazon.com, Inc." -> "Amazon",
   * "Hetzner Online GmbH" -> "Hetzner", "GitHub, Inc." -> "GitHub") —
   * the column is an at-a-glance signal, not a legal directory. Params:
   * rec (parsed JSON object or null). Returns the short name or null
   * (caller paints "—"). Fails: never throws. */
  function providerOf(rec) {
    try {
      if (!rec || typeof rec !== "object" || rec.success !== true) return null;
      var asn = (rec.asn && typeof rec.asn === "object") ? rec.asn : {};
      var co = (rec.company && typeof rec.company === "object") ? rec.company : {};
      var org = (typeof asn.org === "string" && asn.org) ? asn.org : "";
      var name = (typeof co.name === "string" && co.name) ? co.name : "";
      var full = (org || name || "").trim();
      if (!full) return null;
      var tok = String(full).split(/[\s.,;:'"]+/).filter(function (w) { return !!w; })[0];
      return tok || full;
    } catch (e) {
      return null;
    }
  }

  /* readCache/writeCache: {host: {label, provider, t}} JSON in
   * localStorage, 24-hour TTL, pruned on read. Labels are computed once at
   * fetch time (empty string = unknown); older shapes (v1 {label,provider}
   * under the previous key, pre-provider {label}, ip-api parts) fail the
   * shape check and are pruned, never misread — the v2 key forces one
   * clean refetch for anyone holding pre-trim full names. Storage failure
   * means no cache, never a broken lookup. Never throws. */
  function readCache() {
    try {
      if (typeof localStorage === "undefined") return {};
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return {};
      var d = JSON.parse(raw);
      if (!d || typeof d !== "object") return {};
      var cutoff = Date.now() - CACHE_TTL_MS, out = {}, changed = false;
      Object.keys(d).forEach(function (k) {
        var e = d[k];
        var shape = e && typeof e.t === "number" && e.t >= cutoff &&
          typeof e.label === "string" && typeof e.provider === "string";
        if (shape) out[k] = e;
        else changed = true;
      });
      if (changed) {
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(out)); } catch (e2) { /* cache stays stale */ }
      }
      return out;
    } catch (e) {
      return {};
    }
  }
  function writeCache(host, label, provider) {
    try {
      if (typeof localStorage === "undefined" || !host) return;
      var d = readCache();
      d[host] = { label: String(label || ""), provider: String(provider || ""), t: Date.now() };
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(d)); } catch (e) { /* best-effort */ }
    } catch (e) { /* best-effort */ }
  }

  /* fetchRecord: shared cached fetch behind lookup()/provider()/details().
   * Params: host (bare hostname), fetcher (optional override). Returns a
   *   Promise for {label, provider} (either may be "" when the service
   *   answers success-but-unknown) or null (bad host, no fetch, timeout,
   *   service fail/down — every path resolves, never rejects).
   *   Never throws. */
  function fetchRecord(host, fetcher) {
    if (!host) return Promise.resolve(null);
    if (failedThisSession[host]) return Promise.resolve(null);
    function fail() { failedThisSession[host] = true; return null; }
    try {
      var hit = readCache()[host];
      if (hit) return Promise.resolve(hit);
    } catch (e) { /* fetch below */ }
    var fetchFn = fetcher;
    try {
      if (typeof fetchFn !== "function" && typeof fetch === "function") fetchFn = fetch;
    } catch (e) { fetchFn = null; }
    if (typeof fetchFn !== "function") return Promise.resolve(null);
    var settled = false;
    return new Promise(function (resolve) {
      function done(v) { if (!settled) { settled = true; resolve(v); } }
      var timer = null;
      try {
        timer = setTimeout(function () { done(fail()); }, FETCH_TIMEOUT_MS);
      } catch (e) { /* no timeout guard */ }
      try {
        fetchFn(ENDPOINT + encodeURIComponent(host)).then(function (resp) {
          if (!resp || typeof resp.json !== "function") { done(fail()); return null; }
          return resp.json();
        }).then(function (data) {
          try { if (timer !== null) clearTimeout(timer); } catch (e) { /* done */ }
          if (data && data.success === true) {
            var label = labelOf(data) || "", provider = providerOf(data) || "";
            writeCache(host, label, provider);
            done({ label: label, provider: provider });
          }
          else done(fail());
        }).then(null, function () {
          try { if (timer !== null) clearTimeout(timer); } catch (e) { /* done */ }
          done(fail());
        });
      } catch (e) {
        try { if (timer !== null) clearTimeout(timer); } catch (ce) { /* done */ }
        done(fail());
      }
    });
  }

  /* lookup: hostname (or full wss:// URL) -> location label. Params: url
   *   string, fetcher (optional fetch override — tests inject a stub;
   *   production omits it and uses global fetch). Returns a Promise for
   *   the "City, Region" string or null (bad URL, no fetch, timeout,
   *   service fail/down — every path resolves, never rejects).
   *   Never throws. */
  function lookup(url, fetcher) {
    var host = extractHost(url);
    if (!host) return Promise.resolve(null);
    return fetchRecord(host, fetcher).then(function (rec) {
      try { return (rec && rec.label) ? rec.label : null; } catch (e) { return null; }
    });
  }

  /* provider: hostname (or full wss:// URL) -> provider name. Same
   * fail-soft contract as lookup (shares its fetch + cache — zero extra
   * requests). Params/returns mirror lookup. Never throws. */
  function provider(url, fetcher) {
    var host = extractHost(url);
    if (!host) return Promise.resolve(null);
    return fetchRecord(host, fetcher).then(function (rec) {
      try { return (rec && rec.provider) ? rec.provider : null; } catch (e) { return null; }
    });
  }

  /* details: hostname (or full wss:// URL) -> {label, provider} in ONE
   * cached fetch (two parallel lookup()+provider() calls would both miss a
   * cold cache and fire twice). Params/contract mirror lookup (null fields
   * when unknown). Never throws. */
  function details(url, fetcher) {
    var host = extractHost(url);
    if (!host) return Promise.resolve({ label: null, provider: null });
    return fetchRecord(host, fetcher).then(function (rec) {
      try {
        return { label: (rec && rec.label) ? rec.label : null,
          provider: (rec && rec.provider) ? rec.provider : null };
      } catch (e) {
        return { label: null, provider: null };
      }
    });
  }

  return { lookup: lookup, provider: provider, details: details, extractHost: extractHost,
    labelOf: labelOf, providerOf: providerOf,
    _test: { extractHost: extractHost, labelOf: labelOf, providerOf: providerOf, cacheKey: CACHE_KEY } };
})();

if (typeof module !== "undefined") { module.exports = Geo; }
