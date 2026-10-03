/* ViewingAs: locked viewing identity (default committee-account, user-switchable).
 * Owns: pick state {id,name}, localStorage persistence (bts-vanilla-viewing-as-v1),
 *   validation via Account.resolve, tiny subscribe fan-out, openPicker dialog (Task 2).
 * Consumes: Account.resolve (guarded at call time), I18n.t (guarded).
 * Globals/side effects: global ViewingAs only; localStorage read/write under one key.
 * Created by: brainstorming 2026-10-03 view-as-locked design.
 */
var ViewingAs = (function () {
  "use strict";
  var KEY = "bts-vanilla-viewing-as-v1";
  var DEF_ID = "1.2.0", DEF_NAME = "committee-account";
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    if (vars && typeof dflt === "string") {
      return dflt.replace(/%\(([^)]+)\)s/g, function (m, n) {
        return (vars[n] !== undefined) ? String(vars[n]) : m;
      });
    }
    return dflt;
  }
  function read() {
    try {
      if (typeof localStorage === "undefined") return null;
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || typeof o.id !== "string" || typeof o.name !== "string") return null;
      if (!o.id || !o.name) return null;
      return { id: o.id, name: o.name };
    } catch (e) { return null; }
  }
  var listeners = [];
  function emit(v) {
    var arr = listeners.slice();
    for (var i = 0; i < arr.length; i++) { try { arr[i](v); } catch (e) { /* never break */ } }
  }
  function get() { var v = read(); return v || { id: DEF_ID, name: DEF_NAME }; }
  function id() { return get().id; }
  function isDefault() { var v = get(); return v.id === DEF_ID && v.name === DEF_NAME; }
  function clear() {
    try { if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify({ id: DEF_ID, name: DEF_NAME })); } catch (e) { /* emit anyway */ }
    var v = { id: DEF_ID, name: DEF_NAME };
    emit(v);
    return v;
  }
  function set(nameOrId) {
    var s = String(nameOrId || "").trim().toLowerCase();
    if (!s) return Promise.reject(new Error("unknown-account"));
    return Promise.resolve().then(function () {
      if (typeof Account === "undefined" || !Account || typeof Account.resolve !== "function") throw new Error("network_error");
      return Account.resolve(s);
    }).then(function (a) {
      var v = { id: String(a.id), name: String(a.name) };
      try { if (typeof localStorage !== "undefined") localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) { /* persist best-effort */ }
      emit(v);
      return v;
    });
  }
  function subscribe(fn) {
    listeners.push(fn);
    return function () { var i = listeners.indexOf(fn); if (i !== -1) listeners.splice(i, 1); };
  }
  return { get: get, id: id, isDefault: isDefault, set: set, clear: clear, subscribe: subscribe, DEF_ID: DEF_ID, DEF_NAME: DEF_NAME };
})();
if (typeof globalThis !== "undefined" && typeof globalThis.ViewingAs === "undefined") { globalThis.ViewingAs = ViewingAs; }
if (typeof module !== "undefined") { module.exports = ViewingAs; }
