/* NodeDiscover: opt-in background node discovery (Settings, explicit user
 * action only — never automatic, never on first connect). Pipeline: GitHub
 * repo search -> candidate config files -> wss:// extraction -> dedupe vs
 * known lists -> Chain.probe + classifyHealth per candidate. Privacy: this
 * fetches github.com + raw.githubusercontent.com and opens sockets to
 * third-party nodes — the UI states that before starting, results are
 * CANDIDATES FOR REVIEW (never auto-added), everything is cancellable and
 * fail-open. Zero deps (fetch + WebSocket platform APIs); no new chain
 * surface (reuses Chain.probe). tsc-only-safe: plain JS + JSDoc, no emit.
 * Created by: opt-in discovery task 2026-10-02 (mirrors
 * tooling/discover-repos.py stages in dependency-free browser JS).
 */
var NodeDiscover = (function () {
  "use strict";

  var SEARCH_API = "https://api.github.com/search/repositories";
  var RAW_BASE = "https://raw.githubusercontent.com";
  var PATHS = ["app/api/apiConfig.js", "src/config/chains.ts",
    "src/config/nodes.ts", "src/config/config.ts",
    "src/stores/nodes.js", "config.js",
    "vuex-bitshares/config.js", "app/api/ApiInstances.js",
    "src/bts/ws/ApiInstances.ts", "lib/dexConfig.js"];
  var WANT = ["wallet", "ui", "dex", "exchange", "config", "api", "node",
    "bot", "bitshares", "trade", "gateway", "bridge"];
  var MAX_REPOS = 12;
  var MAX_FETCHES = 40;

  /* Repo name-score (higher = more likely a wallet/node holder).
   * Params: fullName string. Returns a number. Never throws. */
  function repoScore(fullName) {
    try {
      var name = String(fullName || "").toLowerCase();
      var s = 0, i;
      for (i = 0; i < WANT.length; i++) {
        if (name.indexOf(WANT[i]) !== -1) s++;
      }
      return s;
    } catch (e) { return 0; }
  }

  /* wss:// URL extraction (same shape as the py clean/parse/validate).
   * Params: text string. Returns sorted unique URLs. Never throws. */
  function extractWss(text) {
    var out = {}, list = [];
    try {
      var parts = String(text || "").replace(/["',;&]/g, " ").split(/\s+/);
      for (var i = 0; i < parts.length; i++) {
        var tok = parts[i].replace(/\/+$/, "");
        if (tok.indexOf("wss://") === 0 && tok.indexOf(".") !== -1 && tok.length < 120 && !out[tok]) {
          out[tok] = 1;
          list.push(tok);
        }
      }
    } catch (e) { /* [] stands */ }
    return list.sort();
  }

  /* Drop candidates already in the app's lists (defaults + customs).
   * Params: candidates array, known object {mainnet:[], testnet:[], customs:[]}.
   * Returns fresh URLs only. Never throws. */
  function dedupeKnown(candidates, known) {
    var seen = {};
    try {
      ["mainnet", "testnet", "customs"].forEach(function (k) {
        (known[k] || []).forEach(function (u) { seen[String(u)] = 1; });
      });
    } catch (e) { /* empty seen stands */ }
    return (candidates || []).filter(function (u) { return !seen[String(u)]; });
  }

  /* One JSON GET with fail-open null (rate limits, offline, CORS — all just
   * end discovery honestly). Params: url string. Returns parsed JSON or null. */
  function getJson(url) {
    return fetch(url, { headers: { "Accept": "application/vnd.github+json" } }).then(function (r) {
      if (!r || !r.ok) return null;
      return r.json().catch(function () { return null; });
    }).then(null, function () { return null; });
  }

  /* One text GET with fail-open null. Params: url string. */
  function getText(url) {
    return fetch(url).then(function (r) {
      if (!r || !r.ok) return null;
      return r.text().catch(function () { return null; });
    }).then(null, function () { return null; });
  }

  /* Top candidate repos (name-scored). Params: limit number, progress fn
   * (optional). Returns [{full, branch}]. Never throws (fail-open []). */
  function searchRepos(limit, onProgress) {
    return getJson(SEARCH_API + "?q=bitshares&sort=updated&order=desc&per_page=100&page=1").then(function (d) {
      var items = (d && Array.isArray(d.items)) ? d.items : [];
      items.sort(function (a, b) { return repoScore(b.full_name) - repoScore(a.full_name); });
      return items.slice(0, limit || MAX_REPOS).map(function (r) {
        return { full: r.full_name, branch: r.default_branch || "master" };
      });
    });
  }

  /* Config-file sweep for one repo (bounded fetch budget shared by caller
   * via state {left}). Params: repo {full, branch}, state {left:number}.
   * Returns [{path, nodes[]}]. Never throws. */
  function fetchConfigs(repo, state) {
    var out = [];
    var chain = Promise.resolve();
    PATHS.forEach(function (path) {
      chain = chain.then(function () {
        if (state.left <= 0) return;
        state.left--;
        return getText(RAW_BASE + "/" + repo.full + "/" + repo.branch + "/" + path).then(function (text) {
          if (typeof text === "string" && text.length > 0 && text.length < 2000000) {
            var nodes = extractWss(text);
            if (nodes.length) out.push({ path: path, nodes: nodes });
          }
        });
      });
    });
    return chain.then(function () { return out; });
  }

  /* Full run: search -> configs -> extract -> dedupe -> probe+classify each
   * fresh candidate sequentially (polite to third parties; cancellable).
   * Params: opts {known, maxRepos, onProgress(msg), isCancelled(), onCandidate(row)}.
   * Row: {url, sources[], latencyMs, pingMs, participation, headAgeS, status,
   * detail}. Resolves to row list.
   * Never throws (partial results on cancel/failure). */
  function run(opts) {
    var o = opts || {};
    var known = o.known || { mainnet: [], testnet: [], customs: [] };
    var cancelled = function () {
      try { return !!(o.isCancelled && o.isCancelled()); } catch (e) { return true; }
    };
    var progress = function (m) { try { if (o.onProgress) o.onProgress(m); } catch (e) {} };
    var rows = [];
    var state = { left: MAX_FETCHES };
    return searchRepos(o.maxRepos || MAX_REPOS).then(function (repos) {
      progress("repos");
      var chain = Promise.resolve();
      var found = {};
      repos.forEach(function (repo) {
        chain = chain.then(function () {
          if (cancelled()) return;
          progress("repo");
          return fetchConfigs(repo, state).then(function (hits) {
            hits.forEach(function (h) {
              h.nodes.forEach(function (u) {
                if (!found[u]) found[u] = [];
                if (found[u].indexOf(repo.full) === -1) found[u].push(repo.full);
              });
            });
          });
        });
      });
      return chain.then(function () { return found; });
    }).then(function (found) {
      var fresh = dedupeKnown(Object.keys(found), known);
      progress("probe");
      var chain = Promise.resolve();
      fresh.forEach(function (url, idx) {
        chain = chain.then(function () {
          if (cancelled()) return;
          progress((idx + 1) + "/" + fresh.length);
          var row = { url: url, sources: found[url] || [], latencyMs: null, pingMs: null, participation: null, headAgeS: null, status: "DOWN", detail: "" };
          if (typeof Chain === "undefined" || !Chain || typeof Chain.probe !== "function") {
            rows.push(row);
            return;
          }
          return Chain.probe(url, 8000).then(function (r) {
            row.latencyMs = (r && typeof r.latencyMs === "number") ? r.latencyMs : null;
            row.pingMs = (r && typeof r.pingMs === "number") ? r.pingMs : null;
            row.participation = (r && typeof r.participation === "number") ? r.participation : null;
            row.headAgeS = (r && typeof r.headAgeS === "number") ? r.headAgeS : null;
            var v = { status: "GOOD", detail: "ok" };
            try {
              if (Chain.classifyHealth) {
                v = Chain.classifyHealth({ latencyMs: r.latencyMs, chainOk: true,
                  headAgeS: r.headAgeS, participation: r.participation, irrevLag: r.irrevLag });
              }
            } catch (e) { /* GOOD stands */ }
            row.status = v.status;
            row.detail = v.detail;
            rows.push(row);
          }, function () { rows.push(row); });
        });
      });
      return chain.then(function () { return rows; });
    }).then(null, function () { return rows; });
  }

  return { repoScore: repoScore, extractWss: extractWss, dedupeKnown: dedupeKnown,
    searchRepos: searchRepos, fetchConfigs: fetchConfigs, run: run,
    MAX_REPOS: MAX_REPOS, MAX_FETCHES: MAX_FETCHES };
})();

if (typeof module !== "undefined") { module.exports = NodeDiscover; }
