# Slice 16 parity note — notifications + alerts

Plan: `docs/superpowers/plans/2026-09-28-slice-16-notify.md` (Tasks 1–3).
Reads-only slice (no signing): toast engine + alert rules + watcher + prefs +
`#/alerts` view + toast host + desk bell. Replaces #1's
`react-notification-system` with native DOM + opt-in Web Notifications.

## What landed (vanilla file:line)
- `vanilla/js/notify.js` (196: queue + prefs + browser gate + txConfirmed) +
  `vanilla/js/notify-rules.js` (298: rule store + engine) — cap-split.
- `vanilla/js/notify-ui.js` (360: `#/alerts` view) + `vanilla/js/notify-host.js`
  (141: toast host + bell) — cap-split.
- Wiring (F1 fix): `market-ui.js:961` checkAlerts on ticker refresh;
  `account-ui.js:379-385` history diff; `notify-ui.js:204-205` sweep on entry;
  `transfer-ui.js:560` + `trade-ui.js:296-297` txConfirmed. All guarded silent.
- Styling (F2 fix): `app.css:143-195` toast/alert/bell skin + level stripes;
  `themes.css` `--toast-shadow` per theme.
- Freshness (F3 fix): `notify-ui.js:252-263` connect subscribe refreshes rows.
- Route `router.js:130`, tags `index.html`; bell hook in `market-ui.js` desk header.

## Reference behavior (file:line)
- #1 trigger table: `NotificationStore.js:4-26`, `PriceAlertNotifications.jsx`
  (pair key, HIGHER/LOWER, NaN guard), `Notifier.jsx:18-54` (fill-only diff),
  `BrowserNotifications.jsx:19-65` (settings→permission→diff chain),
  `SettingsStore.js:718-734` (prefs), `TransactionConfirm.jsx:131-149`.
- #3 toast shape `popup.js:736-748` followed. #2 Electron-only — nothing to port.
- Deviation from #1: browser notifications default OFF + click-only permission
  (never mount-time request).

## Test vectors (real notify.js, offline 56/56 + live)
- HIGHER hit-at-equal fires + self-deletes; LOWER miss then hit; null/undefined/
  `"abc"` never fire, rule kept; fill-diff fires once, same-id silent, op-1 silent;
  transfer-to-me gated on watch + pref; validation throws; prefs round-trip;
  sweep mark→drop; `compare("0.1","0.10")=0`, `("2","10")=-1`.
- LIVE: `LOWER BTS/CNY@0.00001` vs ticker `"0"` → fired + self-deleted;
  HIGHER silent + kept. Live history row `1.11.151699056` → transfer-to-me.
  Toasts carry no amounts by design (rule words + pair + actual price only) —
  no raw integers reach the screen.
- In-page wired-path proof: planted HIGHER → fired:1, toast cards
  `.toast-info`/`.toast-success` with 44px ×, zero console errors.

## Manual test (headless, --network testnet, zero console errors ×7+3)
- `#/alerts` @1440 blue/dark/light + 390: rule groups, form, permission section,
  empty states, hamburger + stacked rows on phone.
- Market desk: bell 🔔● with `has-alerts`; toasts bottom-right with level
  stripes (blue info ≠ green success), × clear of text.
- Persistence: delete → reload → empty, `notify_alerts_v1` envelope correct.

## Tester pass (queued)
- Add rule → trigger live → toast click-through; permission Enable flow;
  transfer-to-me on watched account; trio; 390.

## Anti-rot gate (§4.5): (a) yes — static + existing ticker/history paths, no new
sockets; (b) nothing new depended on (`Notification` API optional, guarded);
(c) smallest deletable: browser-note path (in-app toasts stand). `check_rot.py` PASS.
