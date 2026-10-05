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
  /* buildBox: the picker controls (heading + hint + input + Go/Reset/[×]).
   * Params: doc (document), closable (bool — × button only in modal use;
   *   the inline login section has no close). Returns the box element.
   * Never throws out (callers are click/render paths). */
  function buildBox(doc, closable) {
    var box = doc.createElement("div");
    box.className = "viewing-picker";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", t("viewing.dialog_title", "View as account"));
    /* Focus return (lifecycle): opener is the invoking element, falling back
     * to #acting-as (the header affordance that opens the picker). Every
     * dismiss path below refocuses it. Guarded — headless docs keep prior
     * behavior. */
    var opener = null;
    try { opener = (doc.activeElement && typeof doc.activeElement.focus === "function") ? doc.activeElement : null; } catch (e) { opener = null; }
    if (!opener) { try { opener = (typeof doc.getElementById === "function") ? doc.getElementById("acting-as") : null; } catch (e) { opener = null; } }
    function refocus() { try { if (opener && typeof opener.focus === "function") opener.focus(); } catch (e) { /* display stands */ } }
    var h = doc.createElement("h2");
    h.textContent = t("viewing.dialog_title", "View as account");
    box.appendChild(h);
    var hint = doc.createElement("p");
    hint.className = "muted";
    hint.textContent = t("viewing.dialog_hint", "Public data — no unlock needed. Type any account name or 1.2.N id.");
    box.appendChild(hint);
    var entry = doc.createElement("div");
    entry.className = "viewing-input-row";
    var label = doc.createElement("label");
    label.textContent = t("common.account_name", "Account name ");
    var input = doc.createElement("input");
    input.type = "text";
    input.setAttribute("placeholder", t("viewing.dialog_placeholder", "account-name"));
    input.setAttribute("autocomplete", "off");
    input.style.minHeight = "44px";
    label.appendChild(input);
    entry.appendChild(label);
    var go = doc.createElement("button");
    go.type = "button";
    go.style.minHeight = "44px";
    go.textContent = t("viewing.dialog_open", "View as");
    entry.appendChild(go);
    box.appendChild(entry);
    var err = doc.createElement("div");
    err.className = "error";
    err.setAttribute("aria-live", "polite");
    box.appendChild(err);
    var row = doc.createElement("p");
    var reset = doc.createElement("button");
    reset.type = "button";
    reset.style.minHeight = "44px";
    reset.textContent = t("viewing.dialog_reset", "Reset");
    row.appendChild(reset);
    if (closable) {
      var close = doc.createElement("button");
      close.type = "button";
      close.style.minHeight = "44px";
      close.textContent = "×";
      close.setAttribute("aria-label", "Close");
      row.appendChild(close);
      close.addEventListener("click", function () {
        try {
          var ov = box.parentNode;
          if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
        } catch (e) { /* gone */ }
        refocus();
      });
    }
    box.appendChild(row);
    reset.addEventListener("click", function () { err.textContent = ""; try { ViewingAs.clear(); } catch (e) { /* default stands */ } });
    go.addEventListener("click", function () {
      err.textContent = "";
      go.disabled = true;
      ViewingAs.set(input.value).then(function () {
        try {
          var ov = box.parentNode;
          if (ov && ov.className === "viewing-picker-overlay" && ov.parentNode) ov.parentNode.removeChild(ov);
        } catch (e) { /* inline section stands */ }
        refocus();
      }).catch(function (e) {
        go.disabled = false;
        var m = (e && e.message) ? e.message : "";
        if (m.indexOf("unknown-account") !== -1) err.textContent = t("viewing.unknown_account", "Unknown account name.");
        else err.textContent = t("common.network_unavailable", "Network unavailable. Check Settings → Nodes and retry.");
      });
    });
    try { input.focus(); } catch (e) { /* display-only */ }
    return box;
  }
  /* renderSection: inline locked view-as section for the bottom of #/login.
   * Params: doc (document). Returns <section id="viewing-as"> (exactly one per
   * render — the login route clears its root first, so re-renders replace,
   * never accumulate). No close button (nothing to dismiss inline). */
  function renderSection(doc) {
    var sec = doc.createElement("section");
    sec.setAttribute("id", "viewing-as");
    sec.appendChild(buildBox(doc, false));
    return sec;
  }
  /* openPicker: shared locked view-as dialog. Params: doc (document).
   * Returns the dialog wrapper element. Guards: an already-open picker is
   * returned as-is (second header click focuses it — never a duplicate).
   * Validates via set(), shows viewing.unknown_account /
   * viewing.network_error inline, never throws out. */
  function openPicker(doc) {
    var existing = null;
    try { existing = doc.getElementById("viewing-as-open"); } catch (e) { existing = null; }
    if (existing) {
      try {
        var inp = existing.querySelector ? existing.querySelector("input") : null;
        if (inp && inp.focus) inp.focus();
      } catch (e) { /* shown anyway */ }
      return existing;
    }
    var overlay = doc.createElement("div");
    overlay.className = "viewing-picker-overlay";
    overlay.setAttribute("id", "viewing-as-open");
    /* Backdrop-path opener (same rule as buildBox: invoking element, else
     * #acting-as) — buildBox owns the ×/Go paths; this covers backdrop. */
    var opener = null;
    try { opener = (doc.activeElement && typeof doc.activeElement.focus === "function") ? doc.activeElement : null; } catch (e) { opener = null; }
    if (!opener) { try { opener = (typeof doc.getElementById === "function") ? doc.getElementById("acting-as") : null; } catch (e) { opener = null; } }
    var box = buildBox(doc, true);
    overlay.appendChild(box);
    overlay.addEventListener("click", function (ev) {
      if (ev.target === overlay) {
        try { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); } catch (e) { /* gone */ }
        try { if (opener && typeof opener.focus === "function") opener.focus(); } catch (e) { /* picker stands dismissed */ }
      }
    });
    return overlay;
  }
  return { get: get, id: id, isDefault: isDefault, set: set, clear: clear, subscribe: subscribe, openPicker: openPicker, renderSection: renderSection, DEF_ID: DEF_ID, DEF_NAME: DEF_NAME };
})();
if (typeof globalThis !== "undefined" && typeof globalThis.ViewingAs === "undefined") { globalThis.ViewingAs = ViewingAs; }
if (typeof module !== "undefined") { module.exports = ViewingAs; }
