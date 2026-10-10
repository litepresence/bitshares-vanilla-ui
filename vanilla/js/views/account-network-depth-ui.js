/* AccountNetworkDepthUI: the depth selector + Ring 1/Ring 2 pills for
 * #/account-network.
 * Owns: the two depth buttons in the controls row (1 hop default), the one
 *   .an-depth overlay pill pair (numeric Ring 1/Ring 2 inputs), the
 *   .an-depth-fallback normal-flow home used when no .pool-net-stage exists,
 *   and the sanitize() pure helper. DATA ONLY: a change persists prefs and
 *   notifies — it never scans, signs or broadcasts.
 * Consumes: AccountNetDepth normalization (guarded, literal fallbacks),
 *   AccountNetworkCopy prefs/labels (guarded, literal fallbacks), DOM.* +
 *   touchable (never reimplemented here).
 * Side effects: DOM nodes under the caller's controls/graph hosts, and one
 *   prefs write per committed change; all listeners drained by destroy()
 *   (the view pushes it into _cleanups). Global AccountNetworkDepthUI.
 * Created by: account-network two-hop plan Task 4
 *   (docs/superpowers/plans/2026-10-10-account-network-two-hop.md).
 */
var AccountNetworkDepthUI = (function () {
  "use strict";

  /**
   * depthPolicy: the AccountNetDepth module, resolved at CALL time with the
   * same guarded pattern account-net-es.js uses (globalThis first, then a
   * bound-relative module.require, then null => literal fallbacks below).
   * Never throws, never touches document.
   * @returns {any} AccountNetDepth, or null when it is not loadable here.
   */
  function depthPolicy() {
    try {
      if (typeof AccountNetDepth !== "undefined" && AccountNetDepth) return AccountNetDepth;
    } catch (e) { /* fall through */ }
    try {
      if (typeof globalThis !== "undefined" && globalThis.AccountNetDepth) return globalThis.AccountNetDepth;
    } catch (e2) { /* fall through */ }
    try {
      if (typeof module !== "undefined" && module && /** @type {any} */ (module).require) {
        return /** @type {any} */ (module).require("../api/account-net-depth.js");
      }
    } catch (e3) { /* not loadable here */ }
    return null;
  }

  /**
   * copyOf: the AccountNetworkCopy module for prefs + labels, same guarded
   * pattern (a missing script degrades to the literals below, never throws).
   * @returns {any} AccountNetworkCopy, or null when it is not loadable here.
   */
  function copyOf() {
    try {
      if (typeof AccountNetworkCopy !== "undefined" && AccountNetworkCopy) return AccountNetworkCopy;
    } catch (e) { /* fall through */ }
    try {
      if (typeof globalThis !== "undefined" && globalThis.AccountNetworkCopy) return globalThis.AccountNetworkCopy;
    } catch (e2) { /* fall through */ }
    try {
      if (typeof module !== "undefined" && module && /** @type {any} */ (module).require) {
        return /** @type {any} */ (module).require("./account-network-copy.js");
      }
    } catch (e3) { /* not loadable here */ }
    return null;
  }

  /**
   * normDepth: 1 or 2 through the policy, else the default 1 (an invalid
   * depth must never silently promote to the expensive 2-hop mode).
   * @param {*} v Raw depth value.
   * @returns {number} 1 or 2.
   */
  function normDepth(v) {
    var D = depthPolicy();
    try {
      if (D && typeof D.normalizeDepth === "function") return D.normalizeDepth(v);
    } catch (e) { /* literal fallback below */ }
    var n = Math.floor(Number(v));
    return (n === 1 || n === 2) ? n : 1;
  }

  /**
   * normRing1: retained depth-1 counterparties, 1..40, default 40.
   * @param {*} v Raw count.
   * @returns {number} 1..40.
   */
  function normRing1(v) {
    var D = depthPolicy();
    try {
      if (D && typeof D.normalizeRing1 === "function") return D.normalizeRing1(v);
    } catch (e) { /* literal fallback below */ }
    var n = Math.floor(Number(v));
    if (!isFinite(n)) return 40;
    if (n < 1) return 1;
    if (n > 40) return 40;
    return n;
  }

  /**
   * normRing2: depth-2 expansions, 1..8, default 8.
   * @param {*} v Raw count.
   * @returns {number} 1..8.
   */
  function normRing2(v) {
    var D = depthPolicy();
    try {
      if (D && typeof D.normalizeRing2 === "function") return D.normalizeRing2(v);
    } catch (e) { /* literal fallback below */ }
    var n = Math.floor(Number(v));
    if (!isFinite(n)) return 8;
    if (n < 1) return 1;
    if (n > 8) return 8;
    return n;
  }

  /**
   * sanitize: pure depth-input normalizer — every button press and ring edit
   * funnels through here, so the widget, the prefs and the hash can never
   * disagree. Never touches document (the Node vectors require this file).
   * @param {*} raw {depth, ring1, ring2} with string-or-number values.
   * @returns {{depth:number, ring1:number, ring2:number}} In exactly this key order.
   */
  function sanitize(raw) {
    var r = (raw && typeof raw === "object") ? raw : {};
    return { depth: normDepth(r.depth), ring1: normRing1(r.ring1), ring2: normRing2(r.ring2) };
  }

  /**
   * labelDepth: "1 hop" / "2 hops" via the copy module, literal fallback.
   * @param {*} depth Raw depth.
   * @returns {string}
   */
  function labelDepth(depth) {
    var C = copyOf();
    try {
      if (C && typeof C.depthLabel === "function") return C.depthLabel(depth);
    } catch (e) { /* literal below */ }
    return normDepth(depth) === 2 ? "2 hops" : "1 hop";
  }

  /**
   * labelRing: "Ring 1" / "Ring 2" via the copy module, literal fallback.
   * @param {number} which Ring number (anything but 2 reads as ring 1).
   * @returns {string}
   */
  function labelRing(which) {
    var C = copyOf();
    try {
      if (C && typeof C.ringLabel === "function") return C.ringLabel(which);
    } catch (e) { /* literal below */ }
    return Math.floor(Number(which)) === 2 ? "Ring 2" : "Ring 1";
  }

  /**
   * labelDepthField: the selector group's accessible name, literal fallback.
   * @returns {string}
   */
  function labelDepthField() {
    var C = copyOf();
    try {
      if (C && typeof C.depthFieldLabel === "function") return C.depthFieldLabel();
    } catch (e) { /* literal below */ }
    return "Depth";
  }

  /**
   * persist: save the committed prefs through the copy helper (normalized
   * first, so storage never holds an out-of-range value). Never throws.
   * @param {{depth:number, ring1:number, ring2:number}} st Committed state.
   * @returns {void}
   */
  function persist(st) {
    try {
      var C = copyOf();
      if (C && typeof C.writeDepthPrefs === "function") { C.writeDepthPrefs(st.depth, st.ring1, st.ring2); }
    } catch (e) { /* session only */ }
  }

  /**
   * mkEl: shared DOM.el when present, raw createElement otherwise (a stub
   * host without the shared module still mounts).
   * @param {Document} doc Owner document.
   * @param {string} tag Tag name.
   * @param {(string|null)} [text] Text content.
   * @param {(string|null)} [cls] Class name.
   * @returns {Element}
   */
  function mkEl(doc, tag, text, cls) {
    try {
      if (typeof DOM !== "undefined" && DOM && typeof DOM.el === "function") {
        return /** @type {Element} */ (DOM.el(doc, tag, text, cls));
      }
    } catch (e) { /* raw DOM below */ }
    var el = doc.createElement(tag);
    if (text !== undefined && text !== null) el.textContent = text;
    if (cls) el.className = cls;
    return el;
  }

  /**
   * touch: the shared 44px touch floor (same call the market/pool desks
   * use); a host without it keeps its own box.
   * @param {Element} el Control to floor.
   * @returns {Element} The same element.
   */
  function touch(el) {
    try {
      if (typeof touchable === "function") { touchable(/** @type {any} */ (el)); return el; }
    } catch (e) { /* cosmetic */ }
    return el;
  }

  /**
   * mount: build the depth selector in the caller's controls row plus the
   * overlaid Ring 1/Ring 2 pills. The SAME pill nodes move between the
   * .pool-net-stage overlay and the normal-flow fallback on place(), so a
   * canvas re-mount (PoolNetUI.mount clears its host) never orphans them.
   * @param {Document} doc Owner document.
   * @param {Object} opts {controlsRow, graphHost, fallbackHost,
   *   fallbackBefore, initial:{depth,ring1,ring2}, onChange(state)->void}.
   * @returns {{get:function, set:function, place:function, destroy:function}}
   *   get() returns a fresh {depth,ring1,ring2}; set() commits silently
   *   (no onChange); place() re-homes the pills; destroy() drains listeners.
   */
  function mount(doc, opts) {
    var o = opts || {};
    var listeners = [];
    function on(el, type, fn) {
      try { el.addEventListener(type, fn); listeners.push({ el: el, type: type, fn: fn }); }
      catch (e) { /* stub element */ }
    }

    var state = sanitize(o.initial);
    var controlsRow = o.controlsRow || null;
    var graphHost = o.graphHost || null;
    var notify = (typeof o.onChange === "function") ? o.onChange : function () { /* no view attached */ };

    /* ---- depth selector: two aria-pressed buttons, 1 hop default ---- */
    var btns = mkEl(doc, "span", null, "an-depth-btns");
    try { btns.setAttribute("role", "group"); btns.setAttribute("aria-label", labelDepthField()); } catch (e) { /* stub */ }
    var btn1 = mkEl(doc, "button", labelDepth(1), "an-depth-btn");
    var btn2 = mkEl(doc, "button", labelDepth(2), "an-depth-btn");
    try {
      btn1.setAttribute("type", "button");
      btn2.setAttribute("type", "button");
    } catch (e2) { /* stub */ }
    touch(btn1);
    touch(btn2);
    btns.appendChild(btn1);
    btns.appendChild(btn2);
    if (controlsRow) {
      try { controlsRow.appendChild(btns); } catch (e3) { /* selector stands detached */ }
    }

    /* ---- overlaid pills: one .an-depth container, two labeled inputs ---- */
    var overlay = /** @type {HTMLElement} */ (mkEl(doc, "div", null, "an-depth"));
    function numInput(ring, max) {
      var lab = mkEl(doc, "label", null, null);
      var input = /** @type {HTMLInputElement} */ (mkEl(doc, "input", null, null));
      try {
        input.setAttribute("type", "number");
        input.setAttribute("inputmode", "numeric");
        input.setAttribute("min", "1");
        input.setAttribute("max", String(max));
        input.setAttribute("step", "1");
        input.setAttribute("aria-label", labelRing(ring));
      } catch (e) { /* stub element */ }
      touch(input);
      /* The label's text node first, then the input: "Ring 1 [ 40 ]". */
      try { lab.appendChild(doc.createTextNode(labelRing(ring))); } catch (e2) { /* input only */ }
      lab.appendChild(input);
      overlay.appendChild(lab);
      return input;
    }
    var ring1Input = numInput(1, 40);
    var ring2Input = numInput(2, 8);

    /* ---- fallback home: normal flow under the graph ---- */
    var fallback = /** @type {HTMLElement} */ (mkEl(doc, "div", null, "an-depth-fallback"));
    (function homeFallback() {
      var host = o.fallbackHost || null;
      if (!host && graphHost && graphHost.parentNode) host = graphHost.parentNode;
      if (!host) host = graphHost;
      if (!host) return;
      try {
        if (o.fallbackBefore && o.fallbackBefore.parentNode === host) host.insertBefore(fallback, o.fallbackBefore);
        else host.appendChild(fallback);
      } catch (e) { /* pills still mount via place() */ }
    })();

    /**
     * refresh: repaint buttons + inputs from state (Ring 2 disabled at
     * depth 1 — a depth-1 map expands nothing, so the count is not editable).
     * @returns {void}
     */
    function refresh() {
      try { btn1.setAttribute("aria-pressed", state.depth === 1 ? "true" : "false"); } catch (e) { /* stub */ }
      try { btn2.setAttribute("aria-pressed", state.depth === 2 ? "true" : "false"); } catch (e2) { /* stub */ }
      try { ring1Input.value = String(state.ring1); } catch (e3) { /* stub */ }
      try { ring2Input.value = String(state.ring2); } catch (e4) { /* stub */ }
      try { ring2Input.disabled = state.depth < 2; } catch (e5) { /* stub */ }
    }

    /**
     * apply: commit a sanitized state — persist, repaint, notify. A no-op
     * commit repaints only (reverted inputs must still show the truth).
     * @param {{depth:number, ring1:number, ring2:number}} next Sanitized state.
     * @returns {boolean} True when the state changed.
     */
    function apply(next) {
      var changed = !next || next.depth !== state.depth || next.ring1 !== state.ring1 || next.ring2 !== state.ring2;
      if (!changed) { refresh(); return false; }
      state = { depth: next.depth, ring1: next.ring1, ring2: next.ring2 };
      persist(state);
      refresh();
      try { notify({ depth: state.depth, ring1: state.ring1, ring2: state.ring2 }); }
      catch (e) { /* the view owns its failures */ }
      return true;
    }

    /**
     * readInputs: commit the ring edits — a non-numeric box reverts to the
     * committed value (its edit is dropped); a numeric one normalizes
     * through the depth policy (999 clamps to 40, never throws).
     * @returns {void}
     */
    function readInputs() {
      var bad1 = false, bad2 = false;
      try { bad1 = !isFinite(Math.floor(Number(ring1Input.value))); } catch (e) { bad1 = true; }
      try { bad2 = !isFinite(Math.floor(Number(ring2Input.value))); } catch (e2) { bad2 = true; }
      try { if (bad1) ring1Input.value = String(state.ring1); } catch (e3) { /* stub */ }
      try { if (bad2) ring2Input.value = String(state.ring2); } catch (e4) { /* stub */ }
      apply(sanitize({ depth: state.depth, ring1: ring1Input.value, ring2: ring2Input.value }));
    }

    on(btn1, "click", function () {
      apply(sanitize({ depth: 1, ring1: state.ring1, ring2: state.ring2 }));
    });
    on(btn2, "click", function () {
      apply(sanitize({ depth: 2, ring1: state.ring1, ring2: state.ring2 }));
    });
    on(ring1Input, "change", readInputs);
    on(ring2Input, "change", readInputs);

    /**
     * place: home the SAME pill nodes — the .pool-net-stage overlay when the
     * canvas engine built one, otherwise the normal-flow fallback. Called at
     * mount and after every canvas mount (which clears its host). An empty
     * fallback hides so it leaves no stray gap.
     * @returns {void}
     */
    function place() {
      var stage = null;
      try {
        if (graphHost && typeof graphHost.querySelector === "function") {
          stage = graphHost.querySelector(".pool-net-stage");
        }
      } catch (e) { stage = null; }
      try {
        if (stage) {
          if (overlay.parentNode !== stage) stage.appendChild(overlay);
        } else if (fallback) {
          if (overlay.parentNode !== fallback) fallback.appendChild(overlay);
        }
        if (fallback && fallback.style) {
          fallback.style.display = (stage || (fallback.childNodes && fallback.childNodes.length)) ? "" : "none";
        }
      } catch (e2) { /* nodes stand where they are */ }
    }

    refresh();
    place();

    return {
      /**
       * get: a fresh copy of the committed widget state.
       * @returns {{depth:number, ring1:number, ring2:number}}
       */
      get: function () { return { depth: state.depth, ring1: state.ring1, ring2: state.ring2 }; },
      /**
       * set: programmatic commit (initial sync) — persists + repaints but
       * never notifies, so the view cannot loop back into itself.
       * @param {*} raw {depth, ring1, ring2} values.
       * @returns {{depth:number, ring1:number, ring2:number}} The committed state.
       */
      set: function (raw) {
        var next = sanitize(raw);
        state = { depth: next.depth, ring1: next.ring1, ring2: next.ring2 };
        persist(state);
        refresh();
        return { depth: state.depth, ring1: state.ring1, ring2: state.ring2 };
      },
      place: place,
      /**
       * destroy: drain every listener this mount registered. The nodes die
       * with the route's root; listeners must not outlive them.
       * @returns {void}
       */
      destroy: function () {
        var items = listeners;
        listeners = [];
        for (var i = 0; i < items.length; i++) {
          try { items[i].el.removeEventListener(items[i].type, items[i].fn); } catch (e) { /* already gone */ }
        }
      }
    };
  }

  return {
    sanitize: sanitize,
    mount: mount
  };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.AccountNetworkDepthUI === "undefined") { globalThis.AccountNetworkDepthUI = AccountNetworkDepthUI; }
if (typeof module !== "undefined") { module.exports = AccountNetworkDepthUI; }
