/* I18n: locale string resolution (registry + t() + locale->en->key fallback +
 * %(name)s interpolation + Intl wrappers + dict cache + Store-envelope pref).
 * Consumes locales/*.json + localStorage. No view DOM; callers toast on
 * {ok:false}. Slice-17. Plurals deferred (batch-1 needs none). Failures are
 * {ok:false} ('bad-locale' | 'fetch-failed'), never throws. */
var I18n = (function () {
  "use strict";

  var VERSION = 1;
  var PREF_KEY = "bts-vanilla-locale-v1";
  var CACHE_KEY = "bts-vanilla-i18n-v1";
  var DICT_PATH = "locales/";

  /* Shipped locale codes (bitshares-ui/app/assets/locales.js:1-3 = 9 + en). */
  var CODES = ["en", "de", "es", "fr", "it", "ja", "ko", "ru", "tr", "zh"];

  /* Switcher display names, Reference #7 verbatim (identifiers, untranslated). */
  var NAMES = { de: "Deutsch", en: "English", es: "Español", fr: "Français", it: "Italiano",
    ja: "日本語", ko: "한국어", ru: "Русский", tr: "Türkçe", zh: "简体中文" };

  var registry = {}; /* code -> nested dict (sections); en seeded at init */
  var current = "en";

  /* Strict dotted-key lookup (=== per segment, never prefix/truthy). */
  function lookup(dict, key) {
    if (!dict || typeof key !== "string") return undefined;
    var node = dict;
    var parts = key.split(".");
    for (var i = 0; i < parts.length; i++) {
      if (node === null || typeof node !== "object") return undefined;
      if (!Object.prototype.hasOwnProperty.call(node, parts[i])) return undefined;
      node = node[parts[i]];
    }
    return (typeof node === "string") ? node : undefined;
  }

  /* Allowlist gate: non-en values count only for _meta.translated keys. */
  function allowlisted(code, key) {
    if (code === "en") return true;
    var dict = registry[code];
    if (!dict || !dict._meta || !Array.isArray(dict._meta.translated)) return false;
    return dict._meta.translated.indexOf(key) !== -1;
  }

  /* %(name)s interpolation (ported verbatim from #1's counterpart syntax so
   * #1 strings stay reusable). Missing var: placeholder stays + warn, no throw. */
  function interpolate(s, vars) {
    if (!vars || typeof vars !== "object") return s;
    return String(s).replace(/%\(([^)]+)\)s/g, function (m, name) {
      if (Object.prototype.hasOwnProperty.call(vars, name)) return String(vars[name]);
      if (typeof console !== "undefined" && console.warn) console.warn("i18n: missing var " + name);
      return m;
    });
  }

  /* t(key, enDefault, vars?) -> string. Chain: current locale (allowlisted)
   * -> en registry -> enDefault (call-site copy, the file:// guarantee) ->
   * key id itself. Last resort is NEVER blank and NEVER throws. */
  function t(key, enDefault, vars) {
    if (typeof key !== "string" || !key) return "";
    var hit;
    if (current !== "en" && allowlisted(current, key)) {
      hit = lookup(registry[current], key);
      if (hit !== undefined) return interpolate(hit, vars);
    }
    hit = lookup(registry.en, key);
    if (hit !== undefined) return interpolate(hit, vars);
    if (typeof enDefault === "string") return interpolate(enDefault, vars);
    return key;
  }

  /* Locale pref: an explicitly-stored envelope value wins (slice-17
   * architecture); else the standalone PREF_KEY (pre-migration users +
   * boot-order fallback — i18n.js loads before store.js); else "en".
   * Store access is lazy + guarded. */
  function readPref() {
    try {
      if (typeof Store !== "undefined" && Store && typeof Store.storedLocale === "function") {
        var env = Store.storedLocale();
        if (env && CODES.indexOf(env) !== -1) return env;
      }
    } catch (e) { /* fall through to standalone key */ }
    try {
      if (typeof localStorage === "undefined") return "en";
      var v = localStorage.getItem(PREF_KEY);
      return (CODES.indexOf(v) !== -1) ? v : "en";
    } catch (e) { return "en"; }
  }

  function writePref(code) {
    try {
      if (typeof Store !== "undefined" && Store && typeof Store.saveSettings === "function") {
        Store.saveSettings({ locale: code });
      }
    } catch (e) { /* envelope unavailable: standalone key still applies */ }
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(PREF_KEY, code);
    } catch (e) { /* storage blocked: memory locale still applies */ }
  }

  function readCache(code) {
    try {
      if (typeof localStorage === "undefined") return null;
      var raw = localStorage.getItem(CACHE_KEY + ":" + code);
      if (!raw) return null;
      var env = JSON.parse(raw);
      if (!env || env.v !== VERSION || env.locale !== code || !env.dict) return null;
      return env.dict; /* envelope mismatch -> drop, caller refetches */
    } catch (e) { return null; }
  }

  function writeCache(code, dict) {
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(CACHE_KEY + ":" + code, JSON.stringify({ v: VERSION, at: Date.now(), locale: code, dict: dict }));
    } catch (e) { /* cache optional: memory registry still applies */ }
  }

  /* THE single fetch call site in this file (grep-provable): dict loader. */
  function fetchDict(code, fetcher) {
    var f = fetcher || ((typeof fetch !== "undefined") ? fetch : null);
    if (!f) return Promise.resolve({ ok: false, reason: "fetch-failed" });
    var url = DICT_PATH + code + ".json";
    return f(url).then(function (r) {
      if (!r || (typeof r.ok === "boolean" && !r.ok)) return { ok: false, reason: "fetch-failed" };
      return r.json().then(function (d) { return { ok: true, dict: d }; },
        function () { return { ok: false, reason: "fetch-failed" }; });
    }, function () { return { ok: false, reason: "fetch-failed" }; });
  }

  /* setLocale(code) -> Promise. 'bad-locale' unless shipped; memory+cache
   * first, fetch on miss (file://+uncached -> {ok:false}, caller toasts). */
  function setLocale(code, fetcher) {
    if (CODES.indexOf(code) === -1) return Promise.resolve({ ok: false, reason: "bad-locale" });
    var hit = (code === "en") ? registry.en : (code === current ? registry[code] : null);
    if (hit) { current = code; writePref(code); return Promise.resolve({ ok: true, code: code }); }
    var cached = readCache(code);
    if (cached) {
      registry[code] = cached; current = code; writePref(code);
      return Promise.resolve({ ok: true, code: code });
    }
    return fetchDict(code, fetcher).then(function (r) {
      if (!r.ok) return r;
      registry[code] = r.dict; writeCache(code, r.dict);
      current = code; writePref(code);
      return { ok: true, code: code };
    });
  }

  function locale() { return current; }
  function names() {
    var out = {}, i;
    for (i = 0; i < CODES.length; i++) out[CODES[i]] = NAMES[CODES[i]];
    return out;
  }

  /* Intl wrappers, DISPLAY only. Prefs-locale tag; no Intl -> String(value). */
  function date(isoString) {
    var d = new Date(isoString);
    if (typeof Intl === "undefined" || typeof Intl.DateTimeFormat === "undefined") return String(isoString);
    return new Intl.DateTimeFormat(current, { dateStyle: "medium", timeStyle: "medium" }).format(d);
  }

  function num(n, opts) {
    if (typeof Intl === "undefined" || typeof Intl.NumberFormat === "undefined") return String(n);
    return new Intl.NumberFormat(current, opts).format(n);
  }

  /* Boot: pref + cache validate (mismatch drops, lazy refetch, never throw).
   * Write-back keeps the envelope reflecting the resolved choice. */
  function loadCached(fetcher) {
    current = readPref();
    writePref(current);
    var codes = (current === "en") ? ["en"] : ["en", current];
    var chain = Promise.resolve();
    codes.forEach(function (code) {
      chain = chain.then(function () {
        if (registry[code]) return null;
        var cached = readCache(code);
        if (cached) { registry[code] = cached; return null; }
        return fetchDict(code, fetcher).then(function (r) {
          if (r.ok) { registry[code] = r.dict; writeCache(code, r.dict); }
          return null;
        });
      });
    });
    return chain.then(function () { return { ok: true, code: current }; });
  }

  /* Test seam (headless vectors): seed registry without transport. */
  function _seed(code, dict) { registry[code] = dict; }
  function _setCurrent(code) { current = code; }

  return { t: t, setLocale: setLocale, locale: locale, names: names,
    date: date, num: num, loadCached: loadCached, CODES: CODES.slice(),
    _seed: _seed, _setCurrent: _setCurrent };
})();

if (typeof module !== "undefined") { module.exports = I18n; }
