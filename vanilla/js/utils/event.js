/* utils/event.js — shared delegated-event helper.
 * Owns: EventDelegate.delegate(parent, selector, eventType, handler): one
 *   listener on parent that dispatches to the closest(selector) ancestor of
 *   event.target, plus a tiny closest-less fallback (exact-tag, single-class,
 *   single-id only — compound/descendant selectors need native closest).
 * Consumes: nothing. Side effects: addEventListener/removeEventListener on
 *   the given parent only; never touches document/window otherwise.
 * Created by: shared-utilities refactor Task 3.5 (TDD: tooling/event-test.js).
 * No deps, ES5, works on file:// and http:// (classic script tag).
 * Export name is EventDelegate (NOT Event) to avoid clobbering the DOM
 * window.Event constructor. */
var EventDelegate = (function () {
  /* Match one element against a simple selector.
   * @param {any} el element candidate (may lack className/id/tagName).
   * @param {string} selector ".cls" | "#id" | "tag" (single/simple only).
   * @return {boolean} true on exact match, false otherwise (incl. any
   *   compound selector: ".a.b", "div.cls", "[attr]", ":pseudo" — LIMIT:
   *   these need native closest() and never match here by design).
   * Failure: returns false on bad input; never throws. */
  function simpleMatch(el, selector) {
    if (!el || !selector) return false;
    var first = selector.charAt(0);
    if (first === ".") {
      var cls = selector.slice(1);
      if (!cls || /[\s.#[\]:]/.test(cls)) return false;
      var names = String(el.className || "").split(/\s+/);
      for (var i = 0; i < names.length; i++) {
        if (names[i] === cls) return true;
      }
      return false;
    }
    if (first === "#") {
      var id = selector.slice(1);
      if (!id || /[\s.#[\]:]/.test(id)) return false;
      return el.id === id;
    }
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(selector)) return false;
    var tag = el.tagName || el.tag;
    if (!tag) return false;
    return String(tag).toLowerCase() === selector.toLowerCase();
  }

  /* Walk target up through parentNode chain for a simple-selector match.
   * @param {any} target event.target (closest-less env: plain object chain).
   * @param {any} parent delegation root; the walk stops after checking it.
   * @param {string} selector simple selector (see simpleMatch limits).
   * @return {any} first matching ancestor-or-self, or null.
   * Failure: returns null when nothing matches; never throws. */
  function manualClosest(target, parent, selector) {
    var node = target;
    while (node) {
      var hit = false;
      try {
        hit = simpleMatch(node, selector);
      } catch (e) {
        hit = false;
      }
      if (hit) return node;
      if (node === parent) return null;
      node = node.parentNode;
    }
    return null;
  }

  /* Attach one delegated listener.
   * @param {any} parent element owning the listener (needs addEventListener/
   *   removeEventListener; contains() consulted when present).
   * @param {string} selector selector passed to closest() (fallback: simple
   *   selectors only — see simpleMatch).
   * @param {string} eventType e.g. "click".
   * @param {Function} handler called as handler(event, matchedElement).
   * @return {Function} unbind(): removes the listener (always callable).
   * Failure: never throws — bad input yields a no-op unbind; dispatch errors
   *   (incl. handler throws) are swallowed so one row never breaks the list. */
  function delegate(parent, selector, eventType, handler) {
    function noop() {}
    if (!parent || !parent.addEventListener || typeof handler !== "function") {
      return noop;
    }
    function onEvent(evt) {
      var matched = null;
      try {
        if (!evt) return;
        var target = evt.target;
        if (!target) return;
        if (target.closest && typeof target.closest === "function") {
          try {
            matched = target.closest(selector);
          } catch (e) {
            matched = null;
          }
        } else {
          matched = manualClosest(target, parent, selector);
        }
        if (!matched) return;
        if (parent.contains && typeof parent.contains === "function") {
          try {
            if (!parent.contains(matched)) return;
          } catch (e) {
            return;
          }
        }
        try {
          handler(evt, matched);
        } catch (e) {
          /* Swallowed: a throwing row handler must not break siblings. */
        }
      } catch (e) {
        /* Swallowed: delegation dispatch never throws. */
      }
    }
    try {
      parent.addEventListener(eventType, onEvent);
    } catch (e) {
      return noop;
    }
    return function unbind() {
      try {
        parent.removeEventListener(eventType, onEvent);
      } catch (e) {
        /* Swallowed: unbind is best-effort, never throws. */
      }
    };
  }

  return {
    delegate: delegate
  };
})();

if (typeof window !== "undefined") /** @type {any} */ (window).EventDelegate = EventDelegate;
if (typeof module !== "undefined") module.exports = EventDelegate;
