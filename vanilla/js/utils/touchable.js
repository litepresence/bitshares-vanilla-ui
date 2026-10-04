/* touchable.js — shared touch floor (44×44px minimum).
 * Owns: min-height/min-width inline styles on the element.
 * Consumes: nothing. Side effects: mutates element.style.
 * Created by: building-vanilla-slices skill, unified-buttons spec.
 * No deps, ES5, works on file:// and http://. */
function touchable(el) {
  if (el && typeof el.style === "object") {
    /* Native check/radio boxes: a 44px min on the input itself renders a
     * giant box (CSS reset to 18px in app.css loses to inline style).
     * The wrapping label row carries the 44px touch target instead, so
     * skip sizing here — never restyle what the stylesheet already owns. */
    try {
      var tag = (el.tagName || "").toLowerCase();
      var type = (el.type || "").toLowerCase();
      if (tag === "input" && (type === "checkbox" || type === "radio")) return el;
    } catch (e) { /* tag/type read is advisory — fall through to floor */ }
    el.style.minHeight = "44px";
    el.style.minWidth = "44px";
  }
  return el;
}
if (typeof window !== "undefined") window.touchable = touchable;
if (typeof module !== "undefined") module.exports = touchable;