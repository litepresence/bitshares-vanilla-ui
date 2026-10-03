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
  /* openPicker: shared locked view-as dialog. Params: doc (document).
   * Returns the dialog wrapper element. Validates via set(), shows
   * viewing.unknown_account / viewing.network_error inline, never throws out. */
  function openPicker(doc) {
    var overlay = doc.createElement("div");
    overlay.className = "viewing-picker-overlay";
    var box = doc.createElement("div");
    box.className = "viewing-picker";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", t("viewing.dialog_title", "View as account"));
    var h = doc.createElement("h2");
    h.textContent = t("viewing.dialog_title", "View as account");
    box.appendChild(h);
    var hint = doc.createElement("p");
    hint.className = "muted";
    hint.textContent = t("viewing.dialog_hint", "Public data — no unlock needed. Type any account name or 1.2.N id.");
    box.appendChild(hint);
    var label = doc.createElement("label");
    label.textContent = t("viewing.dialog_label", "Account name ");
    var input = doc.createElement("input");
    input.type = "text";
    input.setAttribute("placeholder", t("viewing.dialog_placeholder", "account-name"));
    input.setAttribute("autocomplete", "off");
    input.style.minHeight = "44px";
    label.appendChild(input);
    box.appendChild(label);
    var err = doc.createElement("div");
    err.className = "error";
    err.setAttribute("aria-live", "polite");
    box.appendChild(err);
    var row = doc.createElement("p");
    var go = doc.createElement("button");
    go.type = "button";
    go.style.minHeight = "44px";
    go.textContent = t("viewing.dialog_open", "View as this account");
    row.appendChild(go);
    var reset = doc.createElement("button");
    reset.type = "button";
    reset.style.minHeight = "44px";
    reset.textContent = t("viewing.dialog_reset", "Reset to committee-account");
    row.appendChild(reset);
    var close = doc.createElement("button");
    close.type = "button";
    close.style.minHeight = "44px";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close");
    row.appendChild(close);
    box.appendChild(row);
    overlay.appendChild(box);
    function done() { try { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); } catch (e) { /* gone */ } }
    close.addEventListener("click", done);
    overlay.addEventListener("click", function (ev) { if (ev.target === overlay) done(); });
    reset.addEventListener("click", function () { err.textContent = ""; try { ViewingAs.clear(); } catch (e) { /* default stands */ } done(); });
    go.addEventListener("click", function () {
      err.textContent = "";
      go.disabled = true;
      ViewingAs.set(input.value).then(function () { done(); }).catch(function (e) {
        go.disabled = false;
        var m = (e && e.message) ? e.message : "";
        if (m.indexOf("unknown-account") !== -1) err.textContent = t("viewing.unknown_account", "Unknown account name.");
        else err.textContent = t("viewing.network_error", "Network unavailable. Check Settings → Nodes and retry.");
      });
    });
    try { input.focus(); } catch (e) { /* display-only */ }
    return overlay;
  }
  return { get: get, id: id, isDefault: isDefault, set: set, clear: clear, subscribe: subscribe, openPicker: openPicker, DEF_ID: DEF_ID, DEF_NAME: DEF_NAME };
})();
if (typeof globalThis !== "undefined" && typeof globalThis.ViewingAs === "undefined") { globalThis.ViewingAs = ViewingAs; }
if (typeof module !== "undefined") { module.exports = ViewingAs; }
