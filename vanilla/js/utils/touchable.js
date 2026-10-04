/* touchable.js — shared touch floor (44×44px minimum).
 * Owns: min-height/min-width inline styles on the element.
 * Consumes: nothing. Side effects: mutates element.style.
 * Created by: building-vanilla-slices skill, unified-buttons spec.
 * No deps, ES5, works on file:// and http://. */
function touchable(el) {
  if (el && typeof el.style === "object") {
    el.style.minHeight = "44px";
    el.style.minWidth = "44px";
  }
  return el;
}
if (typeof window !== "undefined") window.touchable = touchable;
if (typeof module !== "undefined") module.exports = touchable;