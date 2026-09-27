// reconnect-proof.mjs — F2 proof: cold offline panel auto-rerenders on connect.
// DEV ONLY. Starts on a dead node (offline panel + Retry expected), then
// switches to the live testnet node via settings; the Store.subscribe
// ("connection",…) hook in cold() must rerender WITHOUT a Retry click.
// Usage: PLAYWRIGHT_BROWSERS_PATH=$PWD/.browsers node reconnect-proof.mjs
import { chromium } from "playwright-core";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 300)));

await page.addInitScript(() => {
  try {
    localStorage.setItem("bts-vanilla-settings-v1", JSON.stringify({
      network: "testnet", activeNode: "wss://127.0.0.1:9/ws", customNodes: [], theme: "original-blue",
    }));
  } catch {}
});
await page.goto("http://localhost:8081/#/assets", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(3000);
await page.screenshot({ path: "/tmp/f2-offline.png" });
const offlineText = await page.evaluate(() => document.body.innerText.slice(0, 600));

await page.evaluate(() => {
  try { Store.saveSettings({ activeNode: "wss://testnet.xbts.io/ws" }); } catch (e) { return "saveSettings failed: " + e; }
  return "switched";
});
let rendered = false, badge = "";
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(1000);
  const t = await page.evaluate(() => document.body.innerText);
  if (t.includes("Network fees") && t.includes("asset_create")) { rendered = true; break; }
}
badge = await page.evaluate(() => {
  const b = document.getElementById("conn-badge");
  return b ? b.textContent : "(no badge)";
});
await page.screenshot({ path: "/tmp/f2-rerendered.png" });
console.log(JSON.stringify({ offlineText: offlineText.slice(0, 300), renderedWithoutRetryClick: rendered, badge, consoleErrors: errors }));
await browser.close();
if (!rendered || errors.length) process.exitCode = 2;
