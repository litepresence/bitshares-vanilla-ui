/* Chain: sole WebSocket owner for all node traffic (principle: one chain module).
 * Owns: the shared socket (ws/pending/nextId), status (lastStatus), api-id
 *   caches (_dbId/_historyId/_netId), connect/probe/call/disconnect/db/history/net,
 *   plus keepalive (block-push feed tracking the ~3s tip with zero extra RPC,
 *   20s heartbeat refreshing RTT latency as backup) and capped same-node
 *   auto-reconnect. Status fans out via Store.emitConnection (the footer is
 *   the connectivity signal — no topbar badge, #1 parity).
 * Consumes: Store.emitConnection (status fan-out, read-only). Side effects:
 *   opens/closes WebSockets, mutates lastStatus + api-id caches.
 * Created by: building-vanilla-slices skill, slice-01-shell-settings plan. */
var Chain = (function () {
  "use strict";
  var ws = null, nextId = 1, pending = {}, lastStatus = {state: "unknown"};
  /* Keepalive state: heartbeat timer, reconnect backoff, manual-close flag.
   * Idle public-node sockets die silently (NAT/proxy ~30-60s); the heartbeat
   * keeps traffic flowing and the reconnect recovers when it still drops. */
  var HEARTBEAT_MS = 20000;
  var RECONNECT_DELAYS = [2000, 5000, 10000, 20000, 30000];
  var beatTimer = null, reconnectTimer = null, reconnectTries = 0;
  var manualClose = false, lastUrl = null, lastOpts = null;
  /* Block-push subscription id (integer echoed back in notice params —
   * routing is shape-disjoint from call/response ids, so no collision).
   * Best-effort: nodes that disallow it (some testnets) just don't push;
   * the heartbeat below covers them. */
  var BLOCK_CB_ID = 1;

  function setStatus(patch) {
    lastStatus = Object.assign({state: "unknown", node: null, latencyMs: null, chainId: null, headBlock: null}, lastStatus, patch);
    Store.emitConnection(lastStatus);
  }

  /* call: one JSON-RPC "call" on the shared socket. Params: apiId (number),
   *   method (string), params (array), timeoutMs (number, default 8000).
   *   Returns a Promise for msg.result. Fails: rejects "not connected" when
   *   the socket is down, "call timeout: <method>" on timeout, or the node's
   *   error payload. */
  function call(apiId, method, params, timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (!ws || ws.readyState !== 1) { reject(new Error("not connected")); return; }
      var id = nextId++;
      var timer = setTimeout(function () { delete pending[id]; reject(new Error("call timeout: " + method)); }, timeoutMs || 8000);
      pending[id] = {resolve: resolve, reject: reject, timer: timer};
      ws.send(JSON.stringify({id: id, method: "call", params: [apiId, method, params || []]}));
    });
  }

  /* failPending: reject every in-flight call (socket died — hanging until
   *   each 8s timeout would lie about state). Params: reason string. */
  function failPending(reason) {
    var ids = Object.keys(pending);
    ids.forEach(function (id) {
      var p = pending[id];
      delete pending[id];
      try { clearTimeout(p.timer); } catch (e) { /* timer gone */ }
      try { p.reject(new Error(reason)); } catch (e) { /* caller gone */ }
    });
  }

  /* resetApiIds: per-connection api ids die with the socket (login returns
   *   fresh ones) — a stale cache would address the new connection wrongly. */
  function resetApiIds() { _dbId = null; _historyId = null; _netId = null; }

  /* blockNumberFromId: graphene block ids lead with the 4-byte big-endian
   * block number (astro-ui BlocksLive parity). Returns the number or null. */
  function blockNumberFromId(blockId) {
    try {
      if (!blockId || typeof blockId !== "string" || blockId.length < 8) return null;
      var num = parseInt(blockId.slice(0, 8), 16);
      return (isFinite(num) && num > 0) ? num : null;
    } catch (e) { return null; }
  }

  /* onBlockNotice: applied-block push -> advance the footer head block.
   * Monotonic only (stale/reordered pushes never move it backwards). */
  function onBlockNotice(payload) {
    try {
      var list = Array.isArray(payload) ? payload : [payload];
      var num = blockNumberFromId(list[0]);
      if (num === null) return;
      var cur = lastStatus.headBlock;
      if (typeof cur !== "number" || num > cur) setStatus({headBlock: num});
    } catch (e) { /* heartbeat covers */ }
  }
  /* Heartbeat: one get_dynamic_global_properties per interval on the open
   * socket (traffic both directions defeats idle timeouts) + the reply
   * refreshes the footer head block AND latency (round-trip time — the
   * footer latency is live, not the connect-time sample). Tip updates are
   * MONOTONIC (a slow reply must never drag the tip backwards past a newer
   * block-push notice). Failures are silent — the next beat retries; a dead
   * socket surfaces via onclose. */
  function beat() {
    if (!ws || ws.readyState !== 1) return;
    var t0 = Date.now();
    db().then(function (dbId) {
      if (!ws || ws.readyState !== 1) return;
      return call(dbId, "get_dynamic_global_properties", [], 10000);
    }).then(function (props) {
      if (props && props.head_block_number && ws && ws.readyState === 1) {
        var cur = lastStatus.headBlock;
        if (typeof cur !== "number" || props.head_block_number > cur) {
          setStatus({headBlock: props.head_block_number, latencyMs: Date.now() - t0});
        } else {
          setStatus({latencyMs: Date.now() - t0});
        }
      }
    }).catch(function () { /* next beat retries */ });
  }
  function startHeartbeat(ms) {
    stopHeartbeat();
    try {
      beatTimer = setInterval(beat, ms || HEARTBEAT_MS);
    } catch (e) { /* without timers the socket still works, just unguarded */ }
  }
  function stopHeartbeat() {
    try { if (beatTimer !== null) clearInterval(beatTimer); } catch (e) { /* gone */ }
    beatTimer = null;
  }
  function clearReconnect() {
    try { if (reconnectTimer !== null) clearTimeout(reconnectTimer); } catch (e) { /* gone */ }
    reconnectTimer = null;
  }

  /* scheduleReconnect: same-node redial with capped backoff after an
   * UNEXPECTED close (manual disconnects never redial). Gives up after the
   * delay list is spent — the footer stays "closed" and the user picks a
   * node (failover), instead of hammering a dead endpoint forever. */
  function scheduleReconnect() {
    if (manualClose || !lastUrl) return;
    var delays = (lastOpts && lastOpts.reconnectDelays) || RECONNECT_DELAYS;
    if (reconnectTries >= delays.length) return;
    var wait = delays[reconnectTries++];
    clearReconnect();
    try {
      reconnectTimer = setTimeout(function () {
        reconnectTimer = null;
        if (manualClose || !lastUrl) return;
        setStatus({state: "connecting", node: lastUrl});
        connect(lastUrl, lastOpts).catch(function () { /* onclose reschedules */ });
      }, wait);
    } catch (e) { /* user Retry remains */ }
  }

  /* Probe: latency + chain ID on a throwaway socket. Never touches the shared
     connection, emits no status — safe to run for every node in a list. */
  function probe(url, timeoutMs) {
    timeoutMs = timeoutMs || 6000;
    var t0 = Date.now();
    return new Promise(function (resolve, reject) {
      var sock, ids = 1, waiting = {}, done = false, guard;
      function fail(e) { if (done) return; done = true; clearTimeout(guard); try { sock.close(); } catch (err) {} reject(e); }
      /* send: one JSON-RPC "call" on the probe's throwaway socket (mirrors
       *   call() but uses the probe-local id map). Params: apiId, method,
       *   params. Returns a Promise for msg.result. Fails: rejects via fail()
       *   on probe timeout or node error, closing the throwaway socket. */
      function send(apiId, method, params) {
        return new Promise(function (res, rej) {
          var id = ids++;
          var timer = setTimeout(function () { delete waiting[id]; fail(new Error("probe timeout: " + method)); }, timeoutMs);
          waiting[id] = {resolve: res, reject: rej, timer: timer};
          sock.send(JSON.stringify({id: id, method: "call", params: [apiId, method, params || []]}));
        });
      }
      try { sock = new WebSocket(url); } catch (e) { reject(e); return; }
      guard = setTimeout(function () { fail(new Error("probe connect timeout")); }, timeoutMs);
      sock.onopen = function () {
        send(1, "login", ["", ""]).then(function () { return send(1, "database", []); }).then(function (dbId) {
          return send(dbId, "get_chain_id", []);
        }).then(function (chainId) {
          if (done) return; done = true; clearTimeout(guard);
          var latencyMs = Date.now() - t0;
          try { sock.close(); } catch (e) {}
          resolve({chainId: chainId, latencyMs: latencyMs});
        }).catch(fail);
      };
      sock.onmessage = function (ev) {
        var msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (msg.id !== undefined && waiting[msg.id]) {
          var p = waiting[msg.id]; delete waiting[msg.id]; clearTimeout(p.timer);
          if (msg.error) fail(new Error(JSON.stringify(msg.error))); else p.resolve(msg.result);
        }
      };
      sock.onclose = function () { if (!done) fail(new Error("probe socket closed")); };
      sock.onerror = function () { /* onclose carries the failure */ };
    });
  }

  function connect(url, opts) {    var timeoutMs = (opts && opts.timeoutMs) || 12000;
    stopHeartbeat(); clearReconnect(); resetApiIds();
    manualClose = false; lastUrl = url; lastOpts = opts || null;
    closeSocket();
    setStatus({state: "connecting", node: url});
    var t0 = Date.now();
    return new Promise(function (resolve, reject) {
      var done = false;
      try { ws = new WebSocket(url); } catch (e) { setStatus({state: "error", node: url}); reject(e); return; }
      var guard = setTimeout(function () { if (!done) { done = true; try { ws.close(); } catch (e) {} setStatus({state: "error", node: url}); reject(new Error("connect timeout")); } }, timeoutMs);
      ws.onopen = function () {
        var opDbId = null;
        call(1, "login", ["", ""]).then(function () { return call(1, "database", []); }).then(function (dbId) {
          opDbId = dbId;
          return Promise.all([call(dbId, "get_chain_id", []), call(dbId, "get_dynamic_global_properties", [])]);
        }).then(function (res) {
          if (done) return; done = true; clearTimeout(guard);
          var latencyMs = Date.now() - t0;
          /* Head block stashed from the ALREADY-fetched dynamic props (footer
           * paint reads it; no extra RPC — same Promise.all as before). */
          var headBlock = (res[1] && res[1].head_block_number) || null;
          setStatus({state: "open", node: url, latencyMs: latencyMs, chainId: res[0], headBlock: headBlock});
          reconnectTries = 0;
          startHeartbeat(opts && opts.heartbeatMs);
          /* Block-push feed (best-effort): the node pushes every applied
           * block with ZERO extra RPC — the footer then tracks the ~3s
           * chain tip instead of the 20s heartbeat. Nodes that disallow it
           * (some testnets) just stay on heartbeat; never fatal. */
          try {
            if (opDbId !== null) call(opDbId, "set_block_applied_callback", [BLOCK_CB_ID]).catch(function () { /* heartbeat covers */ });
          } catch (e) { /* heartbeat covers */ }
          resolve({chainId: res[0], headBlockTime: res[1].time, latencyMs: latencyMs});
        }).catch(function (e) {
          if (done) return; done = true; clearTimeout(guard);
          try { ws.close(); } catch (err) {}
          setStatus({state: "error", node: url}); reject(e);
        });
      };
      ws.onmessage = function (ev) {
        var msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
        /* Push notices (no top-level id — shape-disjoint from call pairs):
         * applied-block feed for the footer (see BLOCK_CB_ID). Unknown
         * notices are ignored; the heartbeat covers unsubscribed nodes. */
        if (msg.method === "notice" && Array.isArray(msg.params) && msg.params[0] === BLOCK_CB_ID) {
          onBlockNotice(msg.params[1]);
          return;
        }
        if (msg.id !== undefined && pending[msg.id]) {
          var p = pending[msg.id]; delete pending[msg.id]; clearTimeout(p.timer);
          if (msg.error) p.reject(new Error(JSON.stringify(msg.error))); else p.resolve(msg.result);
        }
      };
      ws.onclose = function () {
        stopHeartbeat(); failPending("not connected"); resetApiIds();
        if (!done) {
          done = true; clearTimeout(guard);
          setStatus({state: "closed", node: url}); reject(new Error("socket closed"));
        } else if (lastStatus.state === "open") {
          setStatus({state: "closed", node: url});
          scheduleReconnect();
        }
      };
      ws.onerror = function () { /* onclose carries the failure */ };
    });
  }

  /* closeSocket: low-level close for handoffs (connect/probe paths) — never
   *   redials, never touches flags. Manual user disconnects go through
   *   disconnect() below, which suppresses the reconnect. */
  function closeSocket() { try { if (ws) ws.close(); } catch (e) {} ws = null; }

  function disconnect() {
    manualClose = true;
    stopHeartbeat(); clearReconnect(); failPending("not connected"); resetApiIds();
    closeSocket();
    if (lastStatus.state === "open" || lastStatus.state === "connecting") {
      setStatus({state: "closed", node: (lastStatus && lastStatus.node) || null});
    }
  }
  var _dbId = null;
  function db() {
    if (_dbId !== null) return Promise.resolve(_dbId);
    return call(1, "database", []).then(function (id) { _dbId = id; return id; });
  }
  var _historyId = null;
  /* history: cached "history" api id (mirrors db()). Params: none. Returns a
   *   Promise for the numeric api id. Fails: rejects when not connected or on
   *   call timeout (via call()). */
  function history() {
    if (_historyId !== null) return Promise.resolve(_historyId);
    return call(1, "history", []).then(function (id) { _historyId = id; return id; });
  }
  /* Network-broadcast api id (mirrors db()): cached after first login.
   * Added for slice-04-transfer Task 2; used by Tx.broadcast. */
  var _netId = null;
  function net() {
    if (_netId !== null) return Promise.resolve(_netId);
    return call(1, "network_broadcast", []).then(function (id) { _netId = id; return id; });
  }
  return {connect: connect, probe: probe, call: call, disconnect: disconnect, db: db, history: history, net: net, status: function () { return lastStatus; }};
})();
if (typeof module !== "undefined") { module.exports = Chain; }
