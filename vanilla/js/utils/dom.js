/* dom.js — shared DOM utilities.
 * Owns: element creation, clearing, text/attribute manipulation, status/error helpers, append.
 * Consumes: nothing. Side effects: mutates DOM elements.
 * Created by: building-vanilla-slices skill, shared utilities spec.
 * No deps, ES5, works on file:// and http://. */
var DOM = (function () {
  function createElementWithMethods(doc, tag) {
    var element = doc.createElement(tag);
    if (!element.hasAttribute) {
      element.hasAttribute = function(name) {
        return Object.prototype.hasOwnProperty.call(this, name);
      };
    }
    if (!element.getAttribute) {
      element.getAttribute = function(name) {
        return this[name];
      };
    }
    if (!element.removeAttribute) {
      element.removeAttribute = function(name) {
        delete this[name];
      };
    }
    return element;
  }

  function makeElement(tag) {
    var el = { tag: tag, children: [], textContent: "", className: "", style: {} };
    el.setAttribute = function(k, v) { this[k] = v; };
    el.getAttribute = function(k) { return this[k]; };
    el.hasAttribute = function(k) { return Object.prototype.hasOwnProperty.call(this, k); };
    el.removeAttribute = function(k) { delete this[k]; };
    el.appendChild = function(c) { this.children.push(c); return c; };
    return el;
  }

  function getDoc(wrap) {
    if (wrap && wrap.ownerDocument) return wrap.ownerDocument;
    if (wrap && wrap.createElement) return wrap;
    if (typeof document !== "undefined") return document;
    return null;
  }

  function el(doc, tag, text, cls) {
    var element = createElementWithMethods(doc, tag);
    if (text !== undefined && text !== null) {
      element.textContent = text;
    }
    if (cls) {
      element.className = cls;
    }
    return element;
  }

  function clear(root) {
    if (!root) return;
    while (root.firstChild) {
      root.removeChild(root.firstChild);
    }
    if (root.children) {
      root.children.length = 0;
    }
  }

  function text(el, text) {
    if (!el) return;
    el.textContent = text === undefined || text === null ? "" : text;
    return el;
  }

  function attrs(el, obj) {
    if (!el || !obj) return el;
    for (var key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        var val = obj[key];
        if (val === undefined || val === null) {
          if (el.removeAttribute) el.removeAttribute(key);
          else delete el[key];
        } else {
          if (el.setAttribute) el.setAttribute(key, val);
          else el[key] = val;
        }
      }
    }
    return el;
  }

  function status(wrap, text) {
    var doc = getDoc(wrap);
    var p = doc ? createElementWithMethods(doc, "p") : makeElement("p");
    p.textContent = text === undefined || text === null ? "" : text;
    p.setAttribute("aria-live", "polite");
    if (wrap && wrap.appendChild) {
      wrap.appendChild(p);
    }
    return p;
  }

  function error(wrap, text) {
    var doc = getDoc(wrap);
    var p = doc ? createElementWithMethods(doc, "p") : makeElement("p");
    p.textContent = text === undefined || text === null ? "" : text;
    p.className = "error";
    p.setAttribute("aria-live", "polite");
    if (wrap && wrap.appendChild) {
      wrap.appendChild(p);
    }
    return p;
  }

  function append(wrap) {
    if (!wrap) return wrap;
    for (var i = 1; i < arguments.length; i++) {
      var node = arguments[i];
      if (node) {
        wrap.appendChild(node);
      }
    }
    return wrap;
  }

  /* pageHead: page h1 + optional heading icon (uniform heading-icons plan).
   * Same guarded pattern as auth-ui.js loginHead: icon appended only when
   * iconName is a non-empty string AND the Icon global with img() exists;
   * any failure leaves the heading standing without the icon. Null,
   * undefined, or "" iconName (gap pages) returns a plain text-only h1.
   * Full-color PNG art (login "lock-blue") is marked icon-state so the
   * theme invert skips it (img.icon-state in app.css); monochrome SVGs
   * keep h-title-icon alone and follow --icon-filter. The .png check reads
   * Icon.url() (no duplicated registry knowledge). Params: doc (document),
   * titleText (string, set textContent-only), iconName (string|null|undefined).
   * Returns the h1 element. */
  function pageHead(doc, titleText, iconName) {
    var h = el(doc, "h1", titleText);
    try {
      if (typeof iconName === "string" && iconName &&
          typeof Icon !== "undefined" && Icon && typeof Icon.img === "function") {
        h.appendChild(doc.createTextNode(" "));
        var cls = "h-title-icon";
        try {
          if (typeof Icon.url === "function" && /\.png$/i.test(Icon.url(iconName))) cls += " icon-state";
        } catch (e) { /* monochrome default stands */ }
        h.appendChild(Icon.img(iconName, cls, ""));
      }
    } catch (e) { /* heading stands without the icon */ }
    return h;
  }

  return {
    el: el,
    clear: clear,
    text: text,
    attrs: attrs,
    status: status,
    error: error,
    append: append,
    pageHead: pageHead
  };
})();

if (typeof window !== "undefined") window.DOM = DOM;
if (typeof module !== "undefined") module.exports = DOM;