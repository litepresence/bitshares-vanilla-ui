/* Extension service worker, Tier 1 (v1): install defaults + lock broadcast.
 * Owns: chrome.runtime.onInstalled seeding, chrome.alarms auto-lock fan-out
 *   ("vb-lock" broadcast -> open app pages call Wallet.lock()), no key
 *   material ever (pages hold unlock state exactly like the web build —
 *   Tier 2 moves signing behind an approval gate; see below + bridge.js).
 * Tier 2 gate contract (STUB — validators ship in adapter/bridge.js, wiring
 *   is follow-up per proposal §3.3): message protocol {type, id, payload}
 *   <-> {id, ok, payload?, error?}; 60s approval timeout
 *   (Bridge.APPROVAL_TIMEOUT_MS); HTTPS-only origins
 *   (Bridge.isHttpsOrigin); wallet-side chain_id check
 *   (Bridge.checkChainId vs Store.CHAIN_IDS); per-origin allowlist with
 *   allowedAccountIds binding (Bridge.validateRequest); persisted
 *   exponential unlock backoff (lives in vanilla/js/wallet.js: in-memory
 *   count + persisted lockout stamp — the SW never sees passwords); unlocked
 *   material holder stays chrome.storage.session in Tier 2 (memory-backed,
 *   dies with the browser — same as #3). signMessage stays UNIMPLEMENTED.
 * Consumes: chrome.alarms, chrome.runtime, chrome.storage (defaults seeding
 *   only). No DOM, no network, no wallet code. MV3 event-driven: no
 *   persistent state here beyond alarms (survives restarts by design).
 * Patterns (not code) from #3 pi314x approval flow (proposal §2.2); written
 *   fresh here — nothing copied from reference/wallet-extension/.
 * Created by: extension-wrapper plan (v1 Tier 1). */
"use strict";

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
  if (!ext || !alarm || alarm.name !== LOCK_ALARM) return;
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

try {
  if (ext && ext.runtime && ext.runtime.onInstalled) ext.runtime.onInstalled.addListener(onInstalled);
  if (ext && ext.runtime && ext.runtime.onMessage) ext.runtime.onMessage.addListener(onMessage);
  if (ext && ext.alarms && ext.alarms.onAlarm) ext.alarms.onAlarm.addListener(onAlarm);
  /* MV3 action vs MV2 browserAction (Safari follows the MV3 name). */
  if (ext && ext.action && ext.action.onClicked) ext.action.onClicked.addListener(onAction);
  else if (ext && ext.browserAction && ext.browserAction.onClicked) ext.browserAction.onClicked.addListener(onAction);
} catch (e) { /* event wiring best-effort */ }
