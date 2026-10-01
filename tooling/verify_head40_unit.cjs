/* verify_head40_unit.cjs — offline unit for the 40-hex head-block fix.
 *
 * What it owns: proves vanilla/js/sdk/chain.js assertPropsShape + vanilla/js/api/tx-send.js
 *   assertHeadProps accept 40-hex RIPEMD160 block ids (chain truth
 *   protocol/types.hpp:304 `using block_id_type = fc::ripemd160`) and reject
 *   39/41-hex, non-hex, bad time, zero head (plus 64-hex, the old wrong demand).
 * Consumes: the REAL vanilla sources loaded in vm sandboxes (chain.js via
 *   StubWS connect path; tx-send.js via mocked Chain buildTx path). No network,
 *   no secrets, stdlib only.
 * Globals/side effects: none (all sandboxed). Created by: 40-hex signing-restore task.
 *
 * Usage: node /workspace/tooling/verify_head40_unit.cjs
 * Exit 0 all PASS, 1 any FAIL.
 */
"use strict";
const fs = require("fs");
const vm = require("vm");

const CHAIN_SRC = "/workspace/vanilla/js/sdk/chain.js";
const TXSEND_SRC = "/workspace/vanilla/js/api/tx-send.js";

let fails = [];
function pass(n) { console.log("PASS " + n); }
function fail(n, why) { fails.push(n + ": " + why); console.log("FAIL " + n + " — " + why); }

const GOOD40 = "060560c4c0d58ccb50f17443302bdc8096e7f34a"; // 40 hex, live testnet shape
const GOOD40_UP = GOOD40.toUpperCase();
if (GOOD40.length !== 40) { console.log("FAIL fixture GOOD40 length != 40"); process.exit(1); }

// ---- 0. file-content gate: both files must demand {40}, not {64} ----
(function fileGate() {
  const c = fs.readFileSync(CHAIN_SRC, "utf8");
  const t = fs.readFileSync(TXSEND_SRC, "utf8");
  if (!c.includes("{40}")) fail("chain.js reads {40}", "missing {40}");
  else pass("chain.js reads {40}");
  if (/head_block_id[^]*\{64\}/.test(c)) fail("chain.js no {64}", "still demands 64");
  else pass("chain.js no {64} demand");
  if (!t.includes("{40}")) fail("tx-send.js reads {40}", "missing {40}");
  else pass("tx-send.js reads {40}");
  if (/head_block_id[^]*\{64\}/.test(t)) fail("tx-send.js no {64}", "still demands 64");
  else pass("tx-send.js no {64} demand");
})();

// ---- 1. chain.js assertPropsShape via real Chain.connect (StubWS) ----
function chainConnectWithProps(props, rawMode) {
  return new Promise((resolve) => {
    let sockets = [];
    class StubWS {
      constructor(url) { this.url = url; this.readyState = 0; this.sent = []; sockets.push(this); }
      send(text) {
        let msg; try { msg = JSON.parse(text); } catch (e) { return; }
        const p = msg.params || []; const method = p[1];
        const respond = (result) => {
          setImmediate(() => { if (this.onmessage) this.onmessage({ data: JSON.stringify({ id: msg.id, result }) }); });
        };
        const respondErr = (err) => {
          setImmediate(() => { if (this.onmessage) this.onmessage({ data: JSON.stringify({ id: msg.id, error: err }) }); });
        };
        if (method === "login") respond(null);
        else if (method === "database") respond(2);
        else if (method === "set_block_applied_callback") respond(null);
        else if (method === "get_chain_id") respond("39f5e2ede1f8bc1a3a54a7914414e3779e33193f1f5693510e73cb7a87617447");
        else if (method === "get_dynamic_global_properties") {
          if (rawMode === "missing") respond(null);
          else respond(props);
        }
        else respondErr({ message: "unknown method" });
      }
      close() { this.readyState = 3; if (this.onclose) this.onclose(); }
      open() { this.readyState = 1; if (this.onopen) this.onopen(); }
    }
    const sandbox = {
      console, setTimeout, clearTimeout, setInterval, clearInterval,
      WebSocket: StubWS,
      localStorage: { getItem: () => null, setItem: () => {} },
      document: { getElementById: () => null },
      Store: { emitConnection: () => {}, loadSettings: () => ({}) },
      module: { exports: {} },
    };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(CHAIN_SRC, "utf8"), sandbox, { filename: "sdk/chain.js" });
    const Chain = sandbox.Chain;
    const pr = Chain.connect("wss://fake/ws", { timeoutMs: 4000, heartbeatMs: 60000 });
    setImmediate(() => { try { sockets[0].open(); } catch (e) {} });
    pr.then(
      (ok) => { try { Chain.disconnect(); } catch (e) {} resolve({ ok: true, status: Chain.status(), conn: ok }); },
      (err) => { try { Chain.disconnect(); } catch (e) {} resolve({ ok: false, error: String((err && err.message) || err) }); }
    );
    setTimeout(() => resolve({ ok: false, error: "harness timeout" }), 6000);
  });
}

async function chainVectors() {
  const V = [
    { name: "chain 40-hex passes", props: { head_block_number: 101015748, head_block_id: GOOD40, time: "2026-09-30T18:56:27" }, want: true },
    { name: "chain 40-hex UPPER passes", props: { head_block_number: 101, head_block_id: GOOD40_UP, time: "2026-01-01T00:00:00" }, want: true },
    { name: "chain 39-hex fails", props: { head_block_number: 101, head_block_id: GOOD40.slice(0, 39), time: "2026-01-01T00:00:00" }, want: false },
    { name: "chain 41-hex fails", props: { head_block_number: 101, head_block_id: GOOD40 + "a", time: "2026-01-01T00:00:00" }, want: false },
    { name: "chain 64-hex fails (old demand gone)", props: { head_block_number: 101, head_block_id: "00" + "ab".repeat(31), time: "2026-01-01T00:00:00" }, want: false },
    { name: "chain non-hex fails", props: { head_block_number: 101, head_block_id: "zz" + GOOD40.slice(2), time: "2026-01-01T00:00:00" }, want: false },
    { name: "chain bad time fails", props: { head_block_number: 101, head_block_id: GOOD40, time: "not-a-time" }, want: false },
    { name: "chain zero head fails", props: { head_block_number: 0, head_block_id: GOOD40, time: "2026-01-01T00:00:00" }, want: false },
  ];
  for (const v of V) {
    const r = await chainConnectWithProps(v.props);
    if (v.want && r.ok) pass(v.name);
    else if (v.want && !r.ok) fail(v.name, "rejected: " + r.error);
    else if (!v.want && !r.ok && /bad-head-shape/.test(r.error)) pass(v.name + " (" + r.error + ")");
    else if (!v.want && !r.ok) fail(v.name, "rejected without bad-head-shape: " + r.error);
    else fail(v.name, "should have rejected but connected");
  }
}

// ---- 2. tx-send.js assertHeadProps via real Tx.buildTx (mocked Chain) ----
async function txVectors() {
  const V = [
    { name: "tx 40-hex passes", props: { head_block_number: 101015748, head_block_id: GOOD40, time: "2026-09-30T18:56:27" }, want: true },
    { name: "tx 39-hex fails", props: { head_block_number: 101, head_block_id: GOOD40.slice(0, 39), time: "2026-01-01T00:00:00" }, want: false },
    { name: "tx 41-hex fails", props: { head_block_number: 101, head_block_id: GOOD40 + "a", time: "2026-01-01T00:00:00" }, want: false },
    { name: "tx non-hex fails", props: { head_block_number: 101, head_block_id: "zz" + GOOD40.slice(2), time: "2026-01-01T00:00:00" }, want: false },
    { name: "tx bad time fails", props: { head_block_number: 101, head_block_id: GOOD40, time: "not-a-time" }, want: false },
    { name: "tx zero head fails", props: { head_block_number: 0, head_block_id: GOOD40, time: "2026-01-01T00:00:00" }, want: false },
    { name: "tx 64-hex fails (old demand gone)", props: { head_block_number: 101, head_block_id: "00" + "ab".repeat(31), time: "2026-01-01T00:00:00" }, want: false },
  ];
  for (const v of V) {
    const sandbox = {
      console,
      setTimeout, clearTimeout, setInterval, clearInterval,
      TextEncoder, TextDecoder,
      Chain: {
        db: async () => 2,
        call: async (api, method) => {
          if (method === "get_dynamic_global_properties") return v.props;
          throw new Error("unexpected method " + method);
        },
      },
      Tx: {},
      Crypto: {},
      Format: { formatAmount: () => "0" },
      module: { exports: {} },
    };
    sandbox.globalThis = sandbox;
    // tx-send.js reads globalThis.Tx / Tx at load; provide both
    sandbox.Tx = sandbox.Tx;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(TXSEND_SRC, "utf8"), sandbox, { filename: "api/tx-send.js" });
    const Tx = sandbox.Tx;
    // minimal op-0 envelope shape buildTx validates structurally
    const ops = [[0, { fee: { amount: 0, asset_id: "1.3.0" }, from: "1.2.1", to: "1.2.0", amount: { amount: "1", asset_id: "1.3.0" }, extensions: [] }]];
    try {
      const tx = await sandbox.Tx.buildTx(ops);
      if (v.want) {
        if (tx && tx.ref_block_num !== undefined && tx.ref_block_prefix !== undefined) pass(v.name);
        else fail(v.name, "resolved without envelope fields");
      } else {
        fail(v.name, "should have rejected but built");
      }
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (v.want) fail(v.name, "rejected: " + msg);
      else if (/bad-head-block/.test(msg)) pass(v.name + " (" + msg + ")");
      else fail(v.name, "rejected without bad-head-block: " + msg);
    }
  }
}

(async function main() {
  await chainVectors();
  await txVectors();
  if (fails.length) { console.log("UNIT RED (" + fails.length + " failures)"); process.exit(1); }
  console.log("UNIT GREEN (40-hex accepts, 39/41/non-hex/bad-time/zero-head/64-hex reject)");
})().catch((e) => { console.log("FAIL harness: " + ((e && e.message) || String(e))); process.exit(1); });
