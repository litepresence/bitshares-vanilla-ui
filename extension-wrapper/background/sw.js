/* Extension service worker: install defaults + lock broadcast + Tier 2 gate.
 * Owns: chrome.runtime.onInstalled seeding, chrome.alarms auto-lock fan-out
 *   ("vb-lock" broadcast -> open app pages call Wallet.lock()), no key
 *   material ever in this file (pages hold unlock state; the SW session
 *   vault in background/session.js holds Tier 2 session keys), plus Tier 2
 *   module loading (importScripts below — dist-relative paths, the SW only
 *   ever runs from dist/) and gate listener wiring (runtime messages ->
 *   Gate.onMessage, approval alarms -> Gate.onAlarm, tab-close -> deny).
 * Tier 2 runtime contract: Bridge validators (adapter/bridge.js), session
 *   vault (background/session.js), router + crypto users (background/
 *   gate.js: Wallet with the chrome backend from adapter/storage.js, SW-owned
 *   Chain socket, Tx sign + ack broadcast). Every import is guarded — a
 *   missing module degrades to Tier 1 (lock alarms keep working, signing
 *   requests get "gate misconfigured" instead of hanging).
 * Consumes: chrome.alarms, chrome.runtime, chrome.storage, chrome.tabs.
 *   No DOM, no network except the SW Chain socket. MV3 event-driven: no
 *   persistent JS state (intents/rate budgets live in storage.session).
 * Patterns (not code) from #3 pi314x approval flow (proposal §2.2); written
 *   fresh here — nothing copied from reference/wallet-extension/.
 * Created by: extension-wrapper plan (v1 Tier 1); Tier 2 wiring added by
 *   the Tier 2 build. */
"use strict";

/* Tier 2 module load (dist-relative: background/ -> ../js/*, ../adapter/*).
 * MV2 background pages load the same files via <script> in firefox.html
 * instead — this block runs only where importScripts exists. */
try {
  if (typeof importScripts === "function") {
    importScripts(
      "../js/sdk/vendor/noble-classic.js",
      "../js/sdk/vendor/scrypt.js",
      "../js/sdk/crypto.js",
      "../js/api/format.js",
      "../js/api/tx.js",
      "../js/api/tx-send.js",
      "../js/store.js",
      "../js/api/wallet.js",
      "../adapter/storage.js",
      "../adapter/bridge.js",
      "session.js",
      "gate.js"
    );
  }
} catch (e) { /* Tier 1 behavior below stands without the gate */ }

/* Namespace compat (all four targets): Firefox/Safari expose `browser`,
 * Chromium exposes `chrome`. Feature-detected below, never assumed. */
var ext = (typeof browser !== "undefined" && browser) ||
  (typeof chrome !== "undefined" && chrome) || null;

var LOCK_ALARM = "vb-lock";
var LOCK_MS = 5 * 60 * 1000;

function onInstalled(details) {
  if (!ext || !details || details.reason !== "install") return;
  try {
    ext.storage.local.get(["bts-vanilla-settings-v1"], function (items) {
      try {
        if (ext.runtime.lastError) return;
        if (!items || !items["bts-vanilla-settings-v1"]) {
          ext.storage.local.set({
            "bts-vanilla-settings-v1": JSON.stringify({
              network: "mainnet",
              activeNode: "wss://api.bitshares.dev/ws",
              customNodes: [],
              theme: "ref-ui-theme",
              locale: "en"
            })
          });
        }
      } catch (e) { /* defaults seed best-effort */ }
    });
  } catch (e) { /* defaults seed best-effort */ }
}

function onMessage(msg) {
  if (!ext) return;
  try {
    if (msg && msg.type === "vb-unlocked") {
      ext.alarms.clear(LOCK_ALARM, function () {
        ext.alarms.create(LOCK_ALARM, { when: Date.now() + LOCK_MS });
      });
    } else if (msg && msg.type === "vb-locked") {
      ext.alarms.clear(LOCK_ALARM, function () {});
    }
  } catch (e) { /* messaging best-effort */ }
}

function onAlarm(alarm) {
  if (!ext || !alarm || alarm.name !== LOCK_ALARM) {
    /* Approval deadlines belong to the gate (60s backstop that survives
     * SW sleep — setTimeout cannot be trusted here). */
    try {
      if (typeof Gate !== "undefined" && Gate && typeof Gate.onAlarm === "function") {
        Gate.onAlarm(alarm);
      }
    } catch (e) { /* deadline best-effort; requester ceiling covers */ }
    return;
  }
  /* Lock alarm: wipe the Tier 2 session FIRST (keys must die even if no
   * page is open to hear the broadcast), then tell open pages to lock. */
  try {
    if (typeof Gate !== "undefined" && Gate && typeof Gate.wipeSession === "function") {
      Gate.wipeSession();
    }
  } catch (e) { /* broadcast below still locks pages */ }
  try {
    ext.runtime.sendMessage({ type: "vb-lock" });
  } catch (e) { /* no pages open: nothing to lock */ }
}

function onAction() {
  if (!ext) return;
  try {
    var url = ext.runtime.getURL("index.html");
    if (ext.tabs && typeof ext.tabs.create === "function") ext.tabs.create({ url: url });
  } catch (e) { /* user opens via options page instead */ }
}

/* Tier 2 gate listener (separate onMessage registration so Tier 1 lock
 * messaging above is untouched). Returns true while a reply is pending. */
function onGateMessage(msg, sender, sendReply) {
  try {
    if (typeof Gate !== "undefined" && Gate && typeof Gate.onMessage === "function") {
      return Gate.onMessage(msg, sender, sendReply);
    }
  } catch (e) { /* gate misconfigured below */ }
  try {
    if (msg && typeof msg === "object" && typeof msg.type === "string" &&
        msg.type.indexOf("vb-") === 0 && typeof sendReply === "function") {
      sendReply({ id: msg.id, ok: false, payload: null, error: "gate misconfigured" });
      return true;
    }
  } catch (e2) { /* channel gone */ }
  return false;
}

try {
  if (ext && ext.runtime && ext.runtime.onInstalled) ext.runtime.onInstalled.addListener(onInstalled);
  if (ext && ext.runtime && ext.runtime.onMessage) ext.runtime.onMessage.addListener(onMessage);
  if (ext && ext.runtime && ext.runtime.onMessage) ext.runtime.onMessage.addListener(onGateMessage);
  if (ext && ext.alarms && ext.alarms.onAlarm) ext.alarms.onAlarm.addListener(onAlarm);
  if (ext && ext.tabs && ext.tabs.onRemoved && typeof Gate !== "undefined" && Gate &&
      typeof Gate.onTabRemoved === "function") {
    /* Approval tab closed without deciding denies the intent (closing is
     * never consent). Best-effort: missing tabs API skips silently. */
    ext.tabs.onRemoved.addListener(function (tabId) {
      try { Gate.onTabRemoved(tabId); } catch (e) { /* teardown best-effort */ }
    });
  }
  /* MV3 action vs MV2 browserAction (Safari follows the MV3 name). */
  if (ext && ext.action && ext.action.onClicked) ext.action.onClicked.addListener(onAction);
  else if (ext && ext.browserAction && ext.browserAction.onClicked) ext.browserAction.onClicked.addListener(onAction);
  /* Fail-closed startup: an SW restart must never leave a request hanging
   * as approvable — journaled pendings are denied. Best-effort. */
  try {
    if (typeof Gate !== "undefined" && Gate && typeof Gate.denyPending === "function") {
      Gate.denyPending();
    }
  } catch (e) { /* intents keep prior state; deadlines still fire */ }
} catch (e) { /* event wiring best-effort */ }
