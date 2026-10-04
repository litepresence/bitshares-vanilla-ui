/* forms/field.js — shared labeled form-row builders.
 * Owns: div.xfer-field rows (label text + field nested in one label, per
 *   vanilla/css/app.css section (a): stacked below ~720px, 2-col label|input
 *   grid above; checkboxes/radios keep native width via the CSS guard).
 * Consumes: DOM global (el/append — never reimplemented here), touchable()
 *   global for the 44px touch floor (guarded: skipped when absent, e.g. Node).
 * Side effects: mutates/creates DOM elements only; no storage, no network.
 * Origin: Task 2.1 of docs/superpowers/plans/2026-10-04-shared-utilities-refactor.md;
 *   extracts the fieldRow/field pattern repeated in transfer-ui.js,
 *   credit-ui.js, wallet-ui.js, trade-form.js, create-account-ui.js, etc.
 * No deps, ES5, works on file:// and http:// (classic script tag). */
var Forms = (function () {
  /* Resolve the shared DOM helper without capturing it (script order in
   * index.html guarantees window.DOM exists before this file runs).
   * @return {object|null} DOM global or null when absent (Node without shim).
   * Failure: returns null — callers fall back to raw doc.createElement. */
  function dom() {
    if (typeof DOM !== "undefined" && DOM) return DOM;
    return null;
  }

  /* Apply the 44px touch floor when the helper exists.
   * @param {HTMLElement} el element to floor (may be null).
   * @return {HTMLElement} same element, possibly style-mutated.
   * Failure: no-op when touchable is absent (Node tests, minimal pages). */
  function floor(el) {
    if (el && typeof touchable === "function") touchable(el);
    return el;
  }

  /* Build the row shell: div.xfer-field > label.
   * @param {Document} doc owner document.
   * @param {string} labelText label text (trailing space kept: matches the
   *   existing "Label " + input inline contract in transfer-ui.js).
   * @param {string} extraClass optional extra row class (e.g. xfer-unlock-row).
   * @return {{row: HTMLElement, label: HTMLElement}} shell pair.
   * Failure: labelText null/undefined renders as empty text (never "null"). */
  function shell(doc, labelText, extraClass) {
    var D = dom();
    var text = (labelText === undefined || labelText === null) ? "" : labelText;
    var row;
    var label;
    if (D) {
      row = D.el(doc, "div", null, "xfer-field" + (extraClass ? " " + extraClass : ""));
      label = D.el(doc, "label", text);
    } else {
      row = doc.createElement("div");
      row.className = "xfer-field" + (extraClass ? " " + extraClass : "");
      label = doc.createElement("label");
      label.textContent = text;
    }
    return { row: row, label: label };
  }

  /* Copy one string attribute onto an element when present.
   * @param {HTMLElement} el target element.
   * @param {object} attrs source attribute bag.
   * @param {string} name attribute name.
   * Failure: absent/null/undefined values leave the element untouched. */
  function passthrough(el, attrs, name) {
    if (attrs && attrs[name] !== undefined && attrs[name] !== null) {
      el.setAttribute(name, attrs[name]);
    }
  }

  /* Labeled row around a caller-built field. The shared xfer-field contract:
   * div.xfer-field > label(text + field); CSS grids label|field above 720px.
   * @param {Document} doc owner document.
   * @param {string} labelText label text shown before the field.
   * @param {HTMLElement} inputEl field element (input/select/textarea).
   * @param {object} [opts] optional {extraClass: string} appended to the row.
   * @return {HTMLElement} row div (append it; inputEl stays the caller's).
   * Failure: inputEl null still returns a labeled empty row (never throws). */
  function fieldRow(doc, labelText, inputEl, opts) {
    var D = dom();
    var extra = (opts && opts.extraClass) || "";
    var parts = shell(doc, labelText, extra);
    if (inputEl) {
      floor(inputEl);
      parts.label.appendChild(inputEl);
    }
    if (D) D.append(parts.row, parts.label);
    else parts.row.appendChild(parts.label);
    return parts.row;
  }

  /* Apply the common input attribute bag (id/value/type + passthroughs).
   * @param {HTMLElement} input target input element.
   * @param {object} attrs bag: id, value, type, placeholder, inputmode,
   *   autocomplete, readonly, name, min, max, step, maxlength, disabled.
   * @return {HTMLElement} same input element.
   * Failure: unknown keys are ignored (never copied blindly). */
  function applyInputAttrs(input, attrs) {
    attrs = attrs || {};
    input.type = attrs.type || "text";
    if (attrs.id) input.id = attrs.id;
    if (attrs.value !== undefined && attrs.value !== null) input.value = attrs.value;
    if (attrs.name) input.setAttribute("name", attrs.name);
    passthrough(input, attrs, "placeholder");
    passthrough(input, attrs, "inputmode");
    passthrough(input, attrs, "autocomplete");
    passthrough(input, attrs, "min");
    passthrough(input, attrs, "max");
    passthrough(input, attrs, "step");
    passthrough(input, attrs, "maxlength");
    if (attrs.readonly) input.setAttribute("readonly", "readonly");
    if (attrs.disabled) input.setAttribute("disabled", "disabled");
    return input;
  }

  /* Labeled text-ish input row (text/password/number/datetime-local/...).
   * @param {Document} doc owner document.
   * @param {string} labelText label text.
   * @param {object} [inputAttrs] attribute bag (see applyInputAttrs).
   * @return {{row: HTMLElement, input: HTMLInputElement}} row + field.
   * Failure: returns empty-valued input on missing attrs (never throws). */
  function labeledInput(doc, labelText, inputAttrs) {
    var input = doc.createElement("input");
    applyInputAttrs(input, inputAttrs);
    return { row: fieldRow(doc, labelText, input), input: input };
  }

  /* Labeled select row from [value,label] pairs with a preselected value.
   * @param {Document} doc owner document.
   * @param {string} labelText label text.
   * @param {Array} options [value,label] pairs (labels via textContent only).
   * @param {string} [value] preselected option value (String-compared).
   * @return {{row: HTMLElement, select: HTMLSelectElement}} row + field.
   * Failure: empty/missing options yields an empty select (never throws). */
  function labeledSelect(doc, labelText, options, value) {
    var select = doc.createElement("select");
    var i;
    var pair;
    var opt;
    options = options || [];
    if (options.length) {
      for (i = 0; i < options.length; i++) {
        pair = options[i];
        opt = doc.createElement("option");
        opt.value = pair[0];
        opt.textContent = pair[1];
        if (value !== undefined && value !== null && String(pair[0]) === String(value)) {
          opt.selected = true;
          opt.setAttribute("selected", "selected");
        }
        select.appendChild(opt);
      }
    }
    return { row: fieldRow(doc, labelText, select), select: select };
  }

  /* Labeled textarea row.
   * @param {Document} doc owner document.
   * @param {string} labelText label text.
   * @param {object} [attrs] bag: id, value, placeholder, rows, readonly, name.
   * @return {{row: HTMLElement, input: HTMLTextAreaElement}} row + field
   *   (named `input` to match labeledInput destructuring at call sites).
   * Failure: missing attrs yields an empty textarea (never throws). */
  function labeledTextarea(doc, labelText, attrs) {
    var area = doc.createElement("textarea");
    attrs = attrs || {};
    if (attrs.id) area.id = attrs.id;
    if (attrs.value !== undefined && attrs.value !== null) area.value = attrs.value;
    if (attrs.name) area.setAttribute("name", attrs.name);
    if (attrs.rows) area.rows = attrs.rows;
    passthrough(area, attrs, "placeholder");
    if (attrs.readonly) area.setAttribute("readonly", "readonly");
    return { row: fieldRow(doc, labelText, area), input: area };
  }

  return {
    fieldRow: fieldRow,
    labeledInput: labeledInput,
    labeledSelect: labeledSelect,
    labeledTextarea: labeledTextarea
  };
})();

if (typeof window !== "undefined") /** @type {any} */ (window).Forms = Forms;
if (typeof module !== "undefined") module.exports = Forms;
