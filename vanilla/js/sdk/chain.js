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
  /**
   * @typedef {import('../api/types.js').ChainStatus} ChainStatus
   * @typedef {import('../api/types.js').PulseResult} PulseResult
   * @typedef {import('../api/types.js').CountResult} CountResult
   * @typedef {import('../api/types.js').ChainObjectId} ChainObjectId
   */
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
  /* Market-notice subscription id (database_api.hpp:602-610:
   * subscribe_to_market(callback, A, B) — integer echoed back in notice
   * params, shape-disjoint from call/response ids like BLOCK_CB_ID.
   * Route-owned: connect() never auto-subscribes; views subscribe per
   * market and unsubscribe on teardown. Single slot (one market at a
   * time) — marketCb holds the current route's push handler or null. */
  var MARKET_CB_ID = 2;
  var marketCb = null;

  /* setStatus: merge a patch into lastStatus and fan out to subscribers.
   * Params: patch (partial status object). Returns nothing. Fails: never —
   *   Store.emitConnection swallows listener errors (see store.js emit). */
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
   *   fresh ones) — a stale cache would address the new connection wrongly.
   *   The market-notice handler dies with it too (server-side subscriptions
   *   do not survive reconnect — the route resubscribes). */
  function resetApiIds() { _dbId = null; _historyId = null; _netId = null; _customId = null; marketCb = null; _dbPending = null; _historyPending = null; _netPending = null; _customPending = null; }

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
  /* H4/M1: dynamic-props shape gate — head_block_number must be a
   *   positive safe integer, head_block_id 40 hex chars (RIPEMD160 block id,
   *   types.hpp:304 — NOT 64; a 64-char demand broke all signing), time a
   *   parseable
   *   string. Throws bad-head-shape naming the field. connect() rejects
   *   with it (error state, no tx built on garbage); beat() drops bad
   *   replies silently (the next beat retries). */
  function assertPropsShape(props) {
    if (!props || typeof props !== "object") throw new Error("bad-head-shape: dynamic props missing");
    if (!Number.isSafeInteger(props.head_block_number) || props.head_block_number <= 0) {
      throw new Error("bad-head-shape: head_block_number must be a positive safe integer");
    }
    if (typeof props.head_block_id !== "string" || !/^[0-9a-fA-F]{40}$/.test(props.head_block_id)) {
      throw new Error("bad-head-shape: head_block_id must be 40 hex chars");
    }
    if (typeof props.time !== "string") throw new Error("bad-head-shape: time does not parse");
    var t = /[Zz]$/.test(props.time) ? props.time : props.time + "Z"; // nodes send with or without Z — never double it
    if (!Number.isFinite(Date.parse(t))) {
      throw new Error("bad-head-shape: time does not parse");
    }
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
      try { assertPropsShape(props); } catch (shapeErr) { return; /* next beat retries */ }
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
  /* startHeartbeat: (re)start the 20s get_dynamic_global_properties beat.
   * Params: ms (optional override). Returns nothing. Fails: never throws —
   *   missing timers just leave the socket unguarded (heartbeat covers). */
  function startHeartbeat(ms) {
    stopHeartbeat();
    try {
      beatTimer = setInterval(beat, ms || HEARTBEAT_MS);
    } catch (e) { /* without timers the socket still works, just unguarded */ }
  }
  /* stopHeartbeat: clear the beat timer (connect/disconnect/close paths).
   * Params: none. Returns nothing. Fails: never (missing timer is a no-op). */
  function stopHeartbeat() {
    try { if (beatTimer !== null) clearInterval(beatTimer); } catch (e) { /* gone */ }
    beatTimer = null;
  }
  /* clearReconnect: cancel a pending same-node redial (manual disconnects
   * and fresh connects). Params: none. Returns nothing. Fails: never. */
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

  /* Witness participation from a recent_slots_filled value (chain-native
   * fork signal, after latencyTEST.py: bitcount/128*100). The field is
   * uint128: nodes may answer a decimal string (exact, BigInt-counted), a
   * safe number (bit-counted with precision noted), or anything else
   * (null — never guessed). Params: v (unknown). Returns 0-100 or null. */
  function participationPct(v) {
    try {
      var s = null;
      if (typeof v === "string" && /^[0-9]+$/.test(v)) s = v;
      else if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) {
        var n = 0, x = v;
        while (x > 0) { n += x % 2; x = Math.floor(x / 2); }
        return Math.min(100, (n / 128) * 100);
      } else return null;
      var big = BigInt(s);
      var bits = 0;
      while (big > BigInt(0)) { bits += Number(big % BigInt(2)); big = big / BigInt(2); }
      return Math.min(100, (bits / 128) * 100);
    } catch (e) { return null; }
  }

  /* Health verdict for one reached node (pure, unit-tested). Thresholds are
   * adapted from latencyTEST.py (whose <100 bar is too strict for the
   * 128-slot rolling window — healthy nodes wobble): GOOD ≥ 95,
   * SUSPECT 80–95 or irreversible lag > 30, FORKED < 80 (or lag > 100 with
   * soft participation), STALE when the head is older than latency + 10s
   * (the script's rule), WRONG-CHAIN on chain mismatch. Lag bands are set
   * from mainnet observation (2026-10-01: healthy nodes sit at lag ~12, so
   * the first draft's >10 line flagged the whole network — recalibrated).
   * Null health inputs (props call failed but chain-id answered) verdict
   * GOOD with unknown details — the node IS up; only the enrichment is
   * missing. Params: an object {latencyMs, chainOk, headAgeS, participation,
   * irrevLag} (numbers or null/undefined, chainOk boolean). Returns
   * {status, detail}. */
  function classifyHealth(h) {
    var hh = h && typeof h === "object" ? h : {};
    if (!hh.chainOk) return { status: "WRONG-CHAIN", detail: "chain-id mismatch" };
    var age = (typeof hh.headAgeS === "number" && isFinite(hh.headAgeS)) ? hh.headAgeS : null;
    var part = (typeof hh.participation === "number" && isFinite(hh.participation)) ? hh.participation : null;
    var lag = (typeof hh.irrevLag === "number" && isFinite(hh.irrevLag)) ? hh.irrevLag : null;
    var lat = (typeof hh.latencyMs === "number" && isFinite(hh.latencyMs)) ? hh.latencyMs : 0;
    if (age !== null && age > lat / 1000 + 10) return { status: "STALE", detail: "head old" };
    if (part !== null && part < 80) return { status: "FORKED", detail: "participation low" };
    if (lag !== null && lag > 100 && (part === null || part < 95)) {
      return { status: "FORKED", detail: "irreversible lagging" };
    }
    if ((part !== null && part < 95) || (lag !== null && lag > 30)) {
      return { status: "SUSPECT", detail: "watch" };
    }
    return { status: "GOOD", detail: "ok" };
  }

  /* Probe enrichment (pure, unit-tested): raw dynamic globals + chain id +
   * measured latency -> probe result. headAgeS from the UTC head time
   * (naive stamps read as UTC — same trap documented in explorer-blocks.js
   * parseChainTime; anything unparseable yields null age, never guessed).
   * participation via participationPct; irrevLag = head - last_irreversible
   * (null unless both are safe ints). Never throws. */
  function enrichProbe(chainId, props, latencyMs) {
    var out = { chainId: chainId || null, latencyMs: latencyMs,
      headBlock: null, headAgeS: null, participation: null, irrevLag: null };
    try {
      if (!props || typeof props !== "object") return out;
      if (Number.isSafeInteger(props.head_block_number) && props.head_block_number > 0) {
        out.headBlock = props.head_block_number;
      }
      if (typeof props.time === "string" && props.time) {
        var m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)(Z|[+-]\d{2}:?\d{2})?$/.exec(props.time);
        if (m) {
          var ms = new Date(m[1] + (m[2] || "Z")).getTime();
          if (isFinite(ms)) out.headAgeS = Math.max(0, (Date.now() - ms) / 1000);
        }
      }
      out.participation = participationPct(props.recent_slots_filled);
      if (Number.isSafeInteger(props.head_block_number) &&
          Number.isSafeInteger(props.last_irreversible_block_num)) {
        out.irrevLag = props.head_block_number - props.last_irreversible_block_num;
      }
    } catch (e) { /* partial result stands */ }
    return out;
  }

  /* Probe: latency + chain ID + health signals on a throwaway socket. Never
     touches the shared connection, emits no status — safe to run for every
     node in a list. Resolves enrichProbe() results (chainId, latencyMs,
     headBlock, headAgeS, participation, irrevLag). */
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
          return send(dbId, "get_chain_id", []).then(function (chainId) {
            /* Enrichment (one extra call, same socket): dynamic globals for
             * head age + participation + irreversible lag (latencyTEST.py
             * signals, chain-native). Fail-soft: if the props call dies but
             * chain-id answered, the node is UP with unknown health details
             * (classifier verdicts GOOD — only the enrichment is missing). */
            return send(dbId, "get_dynamic_global_properties", []).then(function (g) {
              return { chainId: chainId, props: (g && typeof g === "object") ? g : null };
            }, function () { return { chainId: chainId, props: null }; });
          });
        }).then(function (r) {
          if (done) return; done = true; clearTimeout(guard);
          var latencyMs = Date.now() - t0;
          try { sock.close(); } catch (e) {}
          resolve(enrichProbe(r.chainId, r.props, latencyMs));
        }).catch(fail);
      };
      sock.onmessage = function (ev) {
        /* M1: 4MB inbound cap on the throwaway probe socket too. */
        try {
          if (ev && typeof ev.data === "string" && ev.data.length > 4 * 1024 * 1024) {
            fail(new Error("oversize frame rejected"));
            return;
          }
        } catch (capErr) { /* parse below still guards */ }
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

  /* connect: open the shared socket (login->database handshake, chain-id +
   *   head-block fetch, block-push subscribe best-effort). Params: url string,
   *   opts {timeoutMs, heartbeatMs, reconnectDelays} optional. Returns a Promise
   *   for {chainId, headBlockTime, latencyMs}. Fails: rejects on timeout, socket
   *   error, or bad-head-shape (malformed dynamic props — no tx on garbage). */
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
          /* H4: reject the connection on malformed head props (bad-head-shape
           * carries the field) — no tx envelope is ever built on garbage. */
          try {
            assertPropsShape(res[1]);
          } catch (shapeErr) {
            try { ws.close(); } catch (closeErr) { /* closing */ }
            setStatus({state: "error", node: url});
            reject(shapeErr);
            return;
          }
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
        /* M1: 4MB inbound cap — a hostile or broken node must not grow the
         * page's memory unboundedly. Oversize frames are dropped, the socket
         * is disconnected, and the footer carries an error (no reconnect —
         * a node sending 4MB+ frames is not one to redial blindly). */
        try {
          if (ev && typeof ev.data === "string" && ev.data.length > 4 * 1024 * 1024) {
            try { ws.close(); } catch (closeErr) { /* closing */ }
            try { disconnect(); } catch (discErr) { /* state below */ }
            setStatus({state: "error", node: url});
            return;
          }
        } catch (capErr) { /* cap best-effort; the parse below still guards */ }
        var msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
        /* Push notices (no top-level id — shape-disjoint from call pairs):
         * applied-block feed for the footer (see BLOCK_CB_ID) and the
         * route-owned market feed (see MARKET_CB_ID). Unknown notices are
         * ignored; the heartbeat covers unsubscribed nodes. */
        if (msg.method === "notice" && Array.isArray(msg.params)) {
          if (msg.params[0] === BLOCK_CB_ID) { onBlockNotice(msg.params[1]); return; }
          if (msg.params[0] === MARKET_CB_ID) {
            /* M1: shape-check the market payload before route chart code —
             * a malformed notice never throws outward (heartbeat covers). */
            var pl = msg.params[1];
            if (pl && (Array.isArray(pl) || typeof pl === "object")) {
              try { if (marketCb) marketCb(pl); } catch (e) { /* route handler fault */ }
            }
            return;
          }
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

  /* disconnect: manual user disconnect (suppresses auto-reconnect, fails
   *   in-flight calls, clears api-id caches). Params: none. Returns nothing.
   *   Fails: never throws. */
  function disconnect() {
    manualClose = true;
    stopHeartbeat(); clearReconnect(); failPending("not connected"); resetApiIds();
    closeSocket();
    if (lastStatus.state === "open" || lastStatus.state === "connecting") {
      setStatus({state: "closed", node: (lastStatus && lastStatus.node) || null});
    }
  }
  var _dbId = null, _dbPending = null;
  /* In-flight dedupe: concurrent db() calls before cache warm share one
   * login "database" RPC instead of racing N identical calls (perf audit:
   * database ×6 on desk load). Rejection clears the slot so the next call
   * retries; close paths fail in-flight calls via failPending as before. */
  function db() {
    if (_dbId !== null) return Promise.resolve(_dbId);
    if (_dbPending) return _dbPending;
    _dbPending = call(1, "database", []).then(function (id) {
      _dbId = id; _dbPending = null; return id;
    }, function (e) { _dbPending = null; throw e; });
    return _dbPending;
  }
  var _historyId = null, _historyPending = null;
  /* history: cached "history" api id (mirrors db(), same in-flight dedupe).
   * Params: none. Returns a Promise for the numeric api id. Fails: rejects
   *   when not connected or on call timeout (via call()). */
  function history() {
    if (_historyId !== null) return Promise.resolve(_historyId);
    if (_historyPending) return _historyPending;
    _historyPending = call(1, "history", []).then(function (id) {
      _historyId = id; _historyPending = null; return id;
    }, function (e) { _historyPending = null; throw e; });
    return _historyPending;
  }
  /* Network-broadcast api id (mirrors db(), same in-flight dedupe): cached
   * after first login. Added for slice-04-transfer Task 2; used by
   * Tx.broadcast. */
  var _netId = null, _netPending = null;
  function net() {
    if (_netId !== null) return Promise.resolve(_netId);
    if (_netPending) return _netPending;
    _netPending = call(1, "network_broadcast", []).then(function (id) {
      _netId = id; _netPending = null; return id;
    }, function (e) { _netPending = null; throw e; });
    return _netPending;
  }
  /* Custom-operations api id (mirrors db(), same in-flight dedupe): cached
   * after first login. Added for the R1c trollbox slice; used by Trollbox
   * reads (get_storage_info) only. Resolves on plugin nodes; REJECTS on
   * nodes without the custom_operations plugin (login "custom_operations"
   * answers -32601 / "not available") — callers map that to the honest
   * "unsupported" empty state via Trollbox.isPluginMissingError, never a
   * silent blank. Broadcasts never need this api (network_broadcast). */
  var _customId = null, _customPending = null;
  function custom() {
    if (_customId !== null) return Promise.resolve(_customId);
    if (_customPending) return _customPending;
    _customPending = call(1, "custom_operations", []).then(function (id) {
      _customId = id; _customPending = null; return id;
    }, function (e) { _customPending = null; throw e; });
    return _customPending;
  }
  /* subscribeMarket: route-owned market-notice feed (database_api.hpp:602-610
   *   subscribe_to_market(callback, A, B) — asset ids, not a callback id).
   *   Params: baseId/quoteId (asset id strings like "1.3.0"), cb (push handler
   *   receiving the notice payload). Returns a Promise resolving to an unsub
   *   closure (() => unsubscribeMarket(base, quote)). No auto-subscribe in
   *   connect() — the route subscribes per market. Fails: rejects when not
   *   connected or on call timeout (via db()/call()). */
  function subscribeMarket(baseId, quoteId, cb) {
    marketCb = (typeof cb === "function") ? cb : null;
    return db().then(function (dbId) {
      return call(dbId, "subscribe_to_market", [MARKET_CB_ID, baseId, quoteId]);
    }).then(function () {
      return function () { return unsubscribeMarket(baseId, quoteId); };
    });
  }
  /* unsubscribeMarket: drop the local push handler, then best-effort tell the
   *   node (unsubscribe_from_market(A, B) — asset ids). Params: baseId/quoteId.
   *   Returns a Promise (always resolves — server errors and dead sockets are
   *   swallowed; the subscription dies with the socket anyway). */
  function unsubscribeMarket(baseId, quoteId) {
    marketCb = null;
    try {
      if (_dbId !== null) {
        return call(_dbId, "unsubscribe_from_market", [baseId, quoteId]).catch(function () {});
      }
    } catch (e) { /* best-effort only */ }
    return Promise.resolve();
  }
  return {connect: connect, probe: probe, call: call, disconnect: disconnect, db: db, history: history, net: net, custom: custom, subscribeMarket: subscribeMarket, unsubscribeMarket: unsubscribeMarket, participationPct: participationPct, classifyHealth: classifyHealth, enrichProbe: enrichProbe, status: function () { return lastStatus; }};
})();
if (typeof module !== "undefined") { module.exports = Chain; }
