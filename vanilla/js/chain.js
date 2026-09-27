/* Chain: sole WebSocket owner. Raw JSON-RPC: login -> database -> queries. */
var Chain = (function () {
  "use strict";
  var ws = null, nextId = 1, pending = {}, lastStatus = {state: "unknown"};

  function setStatus(patch) {
    lastStatus = Object.assign({state: "unknown", node: null, latencyMs: null, chainId: null}, lastStatus, patch);
    Store.emitConnection(lastStatus);
    var badge = document.getElementById("conn-badge");
    if (badge) {
      badge.setAttribute("data-state", lastStatus.state);
      badge.textContent = lastStatus.state === "open"
        ? "connected · " + (lastStatus.chainId || "").slice(0, 8) + " · " + lastStatus.latencyMs + "ms"
        : lastStatus.state;
    }
  }

  function call(apiId, method, params, timeoutMs) {
    return new Promise(function (resolve, reject) {
      if (!ws || ws.readyState !== 1) { reject(new Error("not connected")); return; }
      var id = nextId++;
      var timer = setTimeout(function () { delete pending[id]; reject(new Error("call timeout: " + method)); }, timeoutMs || 8000);
      pending[id] = {resolve: resolve, reject: reject, timer: timer};
      ws.send(JSON.stringify({id: id, method: "call", params: [apiId, method, params || []]}));
    });
  }

  /* Probe: latency + chain ID on a throwaway socket. Never touches the shared
     connection, emits no status — safe to run for every node in a list. */
  function probe(url, timeoutMs) {
    timeoutMs = timeoutMs || 6000;
    var t0 = Date.now();
    return new Promise(function (resolve, reject) {
      var sock, ids = 1, waiting = {}, done = false, guard;
      function fail(e) { if (done) return; done = true; clearTimeout(guard); try { sock.close(); } catch (err) {} reject(e); }
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
    disconnect();
    setStatus({state: "connecting", node: url});
    var t0 = Date.now();
    return new Promise(function (resolve, reject) {
      var done = false;
      try { ws = new WebSocket(url); } catch (e) { setStatus({state: "error", node: url}); reject(e); return; }
      var guard = setTimeout(function () { if (!done) { done = true; try { ws.close(); } catch (e) {} setStatus({state: "error", node: url}); reject(new Error("connect timeout")); } }, timeoutMs);
      ws.onopen = function () {
        call(1, "login", ["", ""]).then(function () { return call(1, "database", []); }).then(function (dbId) {
          return Promise.all([call(dbId, "get_chain_id", []), call(dbId, "get_dynamic_global_properties", [])]);
        }).then(function (res) {
          if (done) return; done = true; clearTimeout(guard);
          var latencyMs = Date.now() - t0;
          setStatus({state: "open", node: url, latencyMs: latencyMs, chainId: res[0]});
          resolve({chainId: res[0], headBlockTime: res[1].time, latencyMs: latencyMs});
        }).catch(function (e) {
          if (done) return; done = true; clearTimeout(guard);
          try { ws.close(); } catch (err) {}
          setStatus({state: "error", node: url}); reject(e);
        });
      };
      ws.onmessage = function (ev) {
        var msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (msg.id !== undefined && pending[msg.id]) {
          var p = pending[msg.id]; delete pending[msg.id]; clearTimeout(p.timer);
          if (msg.error) p.reject(new Error(JSON.stringify(msg.error))); else p.resolve(msg.result);
        }
      };
      ws.onclose = function () { if (!done) { done = true; clearTimeout(guard); setStatus({state: "closed", node: url}); reject(new Error("socket closed")); } else if (lastStatus.state === "open") { setStatus({state: "closed", node: url}); } };
      ws.onerror = function () { /* onclose carries the failure */ };
    });
  }

  function disconnect() { try { if (ws) ws.close(); } catch (e) {} ws = null; }
  var _dbId = null;
  function db() {
    if (_dbId !== null) return Promise.resolve(_dbId);
    return call(1, "database", []).then(function (id) { _dbId = id; return id; });
  }
  var _historyId = null;
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
