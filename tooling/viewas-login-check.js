/* viewas-login-check.js — DOM-shape asserts for the View-As relocation.
 * Stdlib only: `node tooling/viewas-login-check.js` (exit 0 = green).
 * Proves the owner directive "relocate, not duplicate":
 *   1. #/login (locked) renders exactly one section#viewing-as, last, after
 *      the signing block — real AuthUI + real ViewingAs, stub store/wallet.
 *   2. #/login (unlocked) renders the same (both lock branches mounted).
 *   3. #/settings renders NO section#viewing-as (mount removed).
 *   4. Source-shape: app.js goToViewingAs targets #/login via the shared
 *      goToSection helper (no second mechanism); settings.js holds no
 *      renderSection mount; auth-ui.js holds two (both branches).
 * Created by: view-as-login relocation (after the d71e5b8 signing move).
 */
"use strict";
var assert = require("assert");
var fs = require("fs");
var path = require("path");

function matchSimple(el, sel) {
  sel = String(sel);
  if (sel.charAt(0) === ".") {
    var want = sel.slice(1);
    var classes = String(el.className || "").split(/\s+/);
    return classes.indexOf(want) !== -1;
  }
  var m = /^([a-zA-Z0-9]+)\[([a-zA-Z-]+)="([^"]*)"\]$/.exec(sel);
  if (m) {
    if (String(el.tag).toLowerCase() !== m[1].toLowerCase()) return false;
    var v = null;
    try { v = el.getAttribute(m[2]); } catch (e) { v = null; }
    if (v === null || v === undefined) v = el[m[2]];
    return String(v) === m[3];
  }
  if (/^[a-zA-Z0-9]+$/.test(sel)) {
    return String(el.tag).toLowerCase() === sel.toLowerCase();
  }
  return false;
}

function mkEl(tag) {
  var el = {
    tag: String(tag).toLowerCase(),
    children: [],
    textContent: "",
    className: "",
    style: {},
    value: "",
    checked: false,
    disabled: false,
    hidden: false,
    type: "",
    parentNode: null,
    _attrs: {},
    _listeners: {},
    setAttribute: function (k, v) { this._attrs[String(k)] = String(v); },
    getAttribute: function (k) {
      return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null;
    },
    appendChild: function (c) {
      if (c) { try { c.parentNode = this; } catch (e) {} this.children.push(c); }
      return c;
    },
    removeChild: function (c) {
      var i = this.children.indexOf(c);
      if (i !== -1) this.children.splice(i, 1);
      return c;
    },
    addEventListener: function (t, f) { this._listeners[t] = f; },
    focus: function () {},
    querySelectorAll: function (sel) {
      var out = [];
      (function walk(node) {
        node.children.forEach(function (c) {
          if (matchSimple(c, sel)) out.push(c);
          walk(c);
        });
      })(this);
      return out;
    },
    querySelector: function (sel) {
      var r = this.querySelectorAll(sel);
      return r.length ? r[0] : null;
    }
  };
  Object.defineProperty(el, "firstChild", {
    get: function () { return this.children.length ? this.children[0] : null; },
    configurable: true
  });
  return el;
}

function fakeDoc() {
  return {
    createElement: function (tag) { return mkEl(tag); },
    createTextNode: function (text) {
      var n = mkEl("#text");
      n.textContent = text == null ? "" : String(text);
      return n;
    },
    activeElement: null,
    getElementById: function () { return null; }
  };
}

function findById(root, id) {
  var hit = null;
  (function walk(node) {
    if (hit || !node) return;
    var v = null;
    try { v = node.getAttribute("id"); } catch (e) { v = null; }
    if (v === null || v === undefined) v = node.id;
    if (String(v) === String(id)) { hit = node; return; }
    (node.children || []).forEach(walk);
  })(root);
  return hit;
}

function countById(root, id) {
  var n = 0;
  (function walk(node) {
    if (!node) return;
    var v = null;
    try { v = node.getAttribute("id"); } catch (e) { v = null; }
    if (v === null || v === undefined) v = node.id;
    if (String(v) === String(id)) n++;
    (node.children || []).forEach(walk);
  })(root);
  return n;
}

/* Real shared modules under test. */
var DOM = require(path.join(__dirname, "..", "vanilla", "js", "utils", "dom.js"));
global.DOM = DOM;
global.touchable = function (el) { return el; };
var Forms = require(path.join(__dirname, "..", "vanilla", "js", "forms", "field.js"));
global.Forms = Forms;
var ViewingAs = require(path.join(__dirname, "..", "vanilla", "js", "api", "viewing-as.js"));
global.ViewingAs = ViewingAs;

/* Stubs: wallet lock flag, settings envelope, signing builder shell. */
var lockedFlag = true;
global.Wallet = { isUnlocked: function () { return !lockedFlag; } };
global.Store = {
  loadSettings: function () { return { network: "mainnet", signing: "browser" }; },
  saveSettings: function () {},
  DEFAULT_NODES: { mainnet: [], testnet: [] }
};
global.SettingsPrefs = {
  buildSigning: function (doc) {
    var wrap = doc.createElement("section");
    wrap.setAttribute("id", "sign-block");
    var list = doc.createElement("div");
    var empty = doc.createElement("p");
    wrap.appendChild(list);
    wrap.appendChild(empty);
    return { wrap: wrap, radios: {}, listBox: list, emptyNote: empty };
  },
  buildHistory: function (doc) {
    var wrap = doc.createElement("div");
    var box = doc.createElement("input");
    wrap.appendChild(box);
    return { wrap: wrap, checkbox: box };
  },
  buildTheme: function (doc) {
    var label = doc.createElement("label");
    var select = doc.createElement("select");
    return { label: label, select: select };
  },
  buildLocale: function (doc) {
    return {
      label: doc.createElement("label"),
      select: doc.createElement("select"),
      error: doc.createElement("div"),
      currentLocale: "en"
    };
  }
};
global.SettingsNodes = {
  allNodes: function () { return []; },
  buildNodeTable: function (doc) {
    var table = doc.createElement("table");
    var tbody = doc.createElement("tbody");
    table.appendChild(tbody);
    return { table: table, tbody: tbody };
  },
  buildNodeCards: function (doc) { return doc.createElement("div"); },
  buildProbe: function (doc) {
    return {
      probeBtn: doc.createElement("button"),
      retryBtn: doc.createElement("button"),
      offline: doc.createElement("div")
    };
  },
  buildCustom: function (doc) {
    return {
      wrap: doc.createElement("div"),
      customInput: doc.createElement("input"),
      customAdd: doc.createElement("button"),
      customError: doc.createElement("div")
    };
  },
  buildDiscover: function (doc) {
    return {
      btn: doc.createElement("button"),
      cancel: doc.createElement("button"),
      note: doc.createElement("p"),
      progress: doc.createElement("p"),
      list: doc.createElement("div")
    };
  },
  probeAll: function () {},
  unhideNode: function (h) { return h || []; }
};

var AuthUI = require(path.join(__dirname, "..", "vanilla", "js", "views", "auth-ui.js"));
var SettingsPage = require(path.join(__dirname, "..", "vanilla", "js", "settings.js"));

var pass = 0;
function ok(cond, name) {
  assert.ok(cond, name);
  pass++;
}

function renderLoginRoot() {
  var doc = fakeDoc();
  var root = mkEl("div");
  root.ownerDocument = doc;
  AuthUI.renderLogin(root);
  return root;
}

/* 1. Locked login: exactly one #viewing-as, last in the wrap, after signing. */
lockedFlag = true;
(function () {
  var root = renderLoginRoot();
  ok(countById(root, "viewing-as") === 1, "locked login holds exactly one #viewing-as");
  var wrap = root.children[0];
  var last = wrap.children[wrap.children.length - 1];
  var lastId = null;
  try { lastId = last.getAttribute("id"); } catch (e) { lastId = last.id; }
  ok(String(lastId) === "viewing-as", "locked #viewing-as is the last child (after signing)");
  ok(countById(root, "sign-block") === 1, "locked login keeps the signing block");
  var sec = findById(root, "viewing-as");
  ok(sec && String(sec.tag) === "section", "#viewing-as is a section element");
})();

/* 2. Unlocked login: same mount (visible regardless of lock state). */
lockedFlag = false;
(function () {
  var root = renderLoginRoot();
  ok(countById(root, "viewing-as") === 1, "unlocked login holds exactly one #viewing-as");
  var wrap = root.children[0];
  var last = wrap.children[wrap.children.length - 1];
  var lastId = null;
  try { lastId = last.getAttribute("id"); } catch (e) { lastId = last.id; }
  ok(String(lastId) === "viewing-as", "unlocked #viewing-as is the last child");
  ok(countById(root, "sign-block") === 1, "unlocked login keeps the signing block");
})();

/* 3. Settings: no #viewing-as anywhere (mount removed, not duplicated). */
(function () {
  var doc = fakeDoc();
  var root = mkEl("div");
  root.ownerDocument = doc;
  SettingsPage.render(root);
  ok(countById(root, "viewing-as") === 0, "settings holds no #viewing-as");
})();

/* 4. Source-shape: nav retarget reuses goToSection; mounts live only in login. */
(function () {
  var app = fs.readFileSync(path.join(__dirname, "..", "vanilla", "js", "app.js"), "utf8");
  var m = /function goToViewingAs\(\) \{\s*goToSection\("viewing-as", "([^"]+)"\);/.exec(app);
  ok(m && m[1] === "#/login", "goToViewingAs rides goToSection to #/login (got " + (m && m[1]) + ")");
  ok(app.indexOf('goToSection("viewing-as", "#/settings")') === -1, "no stale #/settings viewing target");
  var settings = fs.readFileSync(path.join(__dirname, "..", "vanilla", "js", "settings.js"), "utf8");
  ok(settings.indexOf("ViewingAs.renderSection") === -1, "settings.js holds no viewing mount");
  var auth = fs.readFileSync(path.join(__dirname, "..", "vanilla", "js", "views", "auth-ui.js"), "utf8");
  var mounts = (auth.match(/ViewingAs\.renderSection\(doc\)/g) || []).length;
  ok(mounts === 2, "auth-ui.js mounts viewing in both lock branches (got " + mounts + ")");
})();

console.log("viewas-login-check: " + pass + " passed, 0 failed");
