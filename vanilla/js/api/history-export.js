/* HistoryExport: CoinTracking-compatible CSV export for account history.
 * Owns: the 11-column header, per-op mapping (Deposit/Withdrawal/Trade/
 *   Income/fee rows), RFC-4180 cell escaping, asset-id collection for
 *   precision joins, and the guarded client-side Blob download.
 * Consumes: Format.formatAmount at call time (raw-digit fallback when the
 *   backend is absent — never throws on chain data); Asset.describe is
 *   CALLER-side (account-ui.js builds the asset map; this file only reads
 *   the map it is given, plus any precision/symbol carried on the row's
 *   own asset objects).
 * Globals/side effects: exposes global HistoryExport only (+ module.exports
 *   for node tests). downloadCsv touches the DOM (one temp <a>) and the
 *   Blob/URL platform APIs — all guarded, false when unavailable.
 * Created by: building-vanilla-slices skill, history-export task
 *   (org-survey 2026-10-03 ADOPT-1).
 * Provenance + chain truth (PORT THE SHAPE, never import):
 *   - 11-column CoinTracking header (Type,Buy Amount,Buy Currency,Sell
 *     Amount,Sell Currency,Fee Amount,Fee Currency,Exchange,Trade Group,
 *     Comment,Date) per the bitshares-report es/src/parser.js verdict.
 *   - Op ids <- #4 operations.hpp: 0 transfer, 1 limit_order_create,
 *     2 limit_order_cancel, 3 call_order_update, 4 fill_order (VIRTUAL),
 *     5 account_create, 6 account_update, 7 account_whitelist,
 *     16 asset_fund_fee_pool, 22 proposal_create, 23 proposal_update,
 *     33 vesting_balance_withdraw, 34 worker_create.
 *   - Fill legs pays/receives/fee <- #4 market.hpp:206-220; vesting legs
 *     fee/vesting_balance/owner/amount <- #4 vesting.hpp:101-117;
 *     transfer legs from/to/amount/fee/memo <- #4 transfer.hpp + the
 *     account.js _equityLegs shape (same fields, read-only here).
 * Scope notes (v1 minimal, decided + logged):
 *   - Raw per-fill rows only: Trade Group stays "" — same-market same-day
 *     fill grouping is a follow-up, never invented here.
 *   - Unknown op types are SKIPPED (never guessed into a tax type); rows
 *     that do not involve the viewed account are skipped likewise.
 *   - Dates reuse the account-ui.js timeText field priority
 *     (timestamp/time/block_time); its block-#/id fallbacks are
 *     display-only, never dates — CSV Date stays empty instead of
 *     inventing one.
 *   - NO hardcoded Income special-cases: vesting_balance_withdraw maps to
 *     Income by op id; no 1.2.x account-id carve-outs exist here by design.
 */
var HistoryExport = (function () {
  "use strict";

  /* The 11-column CoinTracking header, byte order per the verdict. */
  var HEADER = "Type,Buy Amount,Buy Currency,Sell Amount,Sell Currency," +
    "Fee Amount,Fee Currency,Exchange,Trade Group,Comment,Date";

  /* Exchange label for every emitted row (constant, never per-node). */
  var EXCHANGE = "vanilla-dex";

  /* Fee-only op ids -> canonical op name. These carry no balance legs, so
   * each emits one Withdrawal row holding the fee only (the report's fee-row
   * convention). Any op outside this set and the mapped set (0/4/33) is
   * skipped — v1 scope, never guessed. */
  var FEE_OPS = {
    1: "limit_order_create",
    2: "limit_order_cancel",
    3: "call_order_update",
    5: "account_create",
    6: "account_update",
    7: "account_whitelist",
    16: "asset_fund_fee_pool",
    22: "proposal_create",
    23: "proposal_update",
    34: "worker_create"
  };

  /* String op-name aliases nodes never emit but tests/filters may pass
   * (mirrors the account.js _equityLegs dual acceptance). Values are the
   * numeric ids above plus the three mapped ops. */
  var NAME_TO_ID = {
    transfer: 0,
    limit_order_create: 1,
    limit_order_cancel: 2,
    call_order_update: 3,
    fill_order: 4,
    account_create: 5,
    account_update: 6,
    account_whitelist: 7,
    asset_fund_fee_pool: 16,
    proposal_create: 22,
    proposal_update: 23,
    vesting_balance_withdraw: 33,
    worker_create: 34
  };

  /* Canonical op name for a numeric id (mapped + fee sets); null outside. */
  function opNameOf(id) {
    if (id === 0) return "transfer";
    if (id === 4) return "fill_order";
    if (id === 33) return "vesting_balance_withdraw";
    if (Object.prototype.hasOwnProperty.call(FEE_OPS, id)) return FEE_OPS[id];
    return null;
  }

  /* Normalize an op tuple code (number or string alias) to its numeric id,
   * or null when unrecognized (caller skips — never guesses). */
  function opIdOf(code) {
    if (typeof code === "number" && isFinite(code) && Math.floor(code) === code && code >= 0) {
      return opNameOf(code) === null ? null : code;
    }
    if (typeof code === "string" && Object.prototype.hasOwnProperty.call(NAME_TO_ID, code)) {
      return NAME_TO_ID[code];
    }
    return null;
  }

  /* Unwrap one get_account_history row to its operation_history object.
   * Nodes return the object or a [seq, object] pair (same tolerance as
   * account.js _unwrapHist); anything else yields null (caller skips). */
  function entryOf(row) {
    if (Array.isArray(row)) {
      var i, c;
      for (i = 0; i < row.length; i++) {
        c = row[i];
        if (c && typeof c === "object" && !Array.isArray(c) && c.op) return c;
      }
      if (row[1] && typeof row[1] === "object" && !Array.isArray(row[1])) return row[1];
      return null;
    }
    return (row && typeof row === "object") ? row : null;
  }

  /* History-object id ("1.11.N") for the Comment column, or "" when the
   * shape carries none (never throws, never invented). */
  function histIdOf(row, entry) {
    if (entry && typeof entry.id === "string" && entry.id) return entry.id;
    if (Array.isArray(row) && typeof row[0] === "string" && row[0]) return row[0];
    return "";
  }

  /* Date string for the Date column: chain timestamp fields only
   * (timestamp/time/block_time, entry first then envelope). Empty when no
   * timestamp exists — block #/id fallbacks are display-only (see header). */
  function dateOf(row, entry) {
    var cands = [];
    if (entry && typeof entry === "object") cands.push(entry.timestamp, entry.time, entry.block_time);
    if (Array.isArray(row)) {
      var i;
      for (i = 0; i < row.length; i++) {
        if (row[i] && typeof row[i] === "object" && !Array.isArray(row[i])) {
          cands.push(row[i].timestamp, row[i].time, row[i].block_time);
        }
      }
    } else if (row && typeof row === "object") {
      cands.push(row.timestamp, row.time, row.block_time);
    }
    var k;
    for (k = 0; k < cands.length; k++) {
      if (cands[k] !== undefined && cands[k] !== null && String(cands[k]) !== "") return String(cands[k]);
    }
    return "";
  }

  /* One {amount, asset_id} leg -> {id, raw} plus any precision/symbol the
   * row's own asset object already carries (join fallback, see header).
   * Null on any other shape (caller skips — never throws on chain data). */
  function assetLeg(a) {
    if (!a || typeof a !== "object" || Array.isArray(a)) return null;
    if (typeof a.asset_id !== "string" || !a.asset_id) return null;
    if (a.amount === undefined || a.amount === null) return null;
    var out = { id: a.asset_id, raw: String(a.amount) };
    if (typeof a.symbol === "string" && a.symbol) out.symbol = a.symbol;
    if (typeof a.precision === "number") out.precision = a.precision;
    return out;
  }

  /* [humanAmount, symbol] for one leg: precision prefers the caller's asset
   * map (Asset.describe join), then the leg's own precision; symbol prefers
   * the map, then the leg's own symbol, then the bare asset id (never
   * blank). Unparseable raw yields ["", symbol] — the row still exports its
   * honest remainder. Never throws. */
  function fmtLeg(leg, assets) {
    if (!leg) return ["", ""];
    var sym = leg.id, prec = null;
    if (typeof leg.symbol === "string" && leg.symbol) sym = leg.symbol;
    if (typeof leg.precision === "number") prec = leg.precision;
    var meta = (assets && typeof assets === "object") ? assets[leg.id] : null;
    if (meta && typeof meta === "object") {
      if (typeof meta.symbol === "string" && meta.symbol) sym = meta.symbol;
      if (typeof meta.precision === "number") prec = meta.precision;
    }
    if (!/^\d+$/.test(leg.raw)) return ["", sym];
    if (prec === null || prec === undefined) return [leg.raw, sym];
    try {
      if (typeof Format !== "undefined" && Format && typeof Format.formatAmount === "function") {
        return [Format.formatAmount(leg.raw, prec), sym];
      }
    } catch (e) { /* raw fallback below */ }
    return [leg.raw, sym];
  }

  /* RFC-4180 cell: quote only when the value holds a comma, quote, or line
   * break; internal quotes double. Plain values pass through untouched. */
  function csvCell(v) {
    var s = String(v === null || v === undefined ? "" : v);
    if (s.indexOf(",") === -1 && s.indexOf('"') === -1 && s.indexOf("\n") === -1 && s.indexOf("\r") === -1) return s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  /* Memo suffix for the Comment column: the raw transfer memo message when
   * present (verbatim — may be ciphertext; shown as-is, never decoded).
   * Returns "" for absent/non-string messages. */
  function memoSuffix(body) {
    try {
      if (body && body.memo && typeof body.memo.message === "string" && body.memo.message) {
        return " memo:" + body.memo.message;
      }
    } catch (e) { /* no memo suffix */ }
    return "";
  }

  /* One history entry -> 11-string CoinTracking row, or null when the op is
   * outside v1 scope / malformed / not involving the viewed account.
   * Params: entry (unwrapped object), row (raw envelope for id/date),
   *   accountId ("1.2.N", "" when unknown), assets (id -> {symbol,
   *   precision}). Never throws on chain data (guards return null). */
  function rowToFields(entry, row, accountId, assets) {
    if (!entry || typeof entry !== "object" || !Array.isArray(entry.op) || entry.op.length < 2) return null;
    var id = opIdOf(entry.op[0]);
    if (id === null) return null;
    var body = entry.op[1] || {};
    if (!body || typeof body !== "object") return null;
    var name = opNameOf(id);
    var baseComment = histIdOf(row, entry);
    baseComment = baseComment ? baseComment + " " + name : name;
    var date = "";
    try { date = dateOf(row, entry); } catch (e) { date = ""; }
    var feeLeg = assetLeg(body.fee);
    var feeH = ["", ""];
    if (feeLeg) {
      try { feeH = fmtLeg(feeLeg, assets); } catch (e) { feeH = ["", feeLeg.id]; }
    }
    var buy = ["", ""], sell = ["", ""], type = null, comment = baseComment;
    if (id === 0) {
      var amt = assetLeg(body.amount);
      if (!amt) return null;
      var me = typeof accountId === "string" ? accountId : "";
      var from = body.from !== undefined && body.from !== null ? String(body.from) : "";
      var to = body.to !== undefined && body.to !== null ? String(body.to) : "";
      var human = ["", amt.id];
      try { human = fmtLeg(amt, assets); } catch (e) { human = [amt.raw, amt.id]; }
      if (to !== "" && to === me) {
        type = "Deposit";
        buy = human;
      } else if (from !== "" && from === me) {
        type = "Withdrawal";
        sell = human;
      } else {
        return null;
      }
      comment = baseComment + memoSuffix(body);
    } else if (id === 4) {
      var recv = assetLeg(body.receives), pays = assetLeg(body.pays);
      if (!recv && !pays) return null;
      type = "Trade";
      if (recv) {
        try { buy = fmtLeg(recv, assets); } catch (e) { buy = [recv.raw, recv.id]; }
      }
      if (pays) {
        try { sell = fmtLeg(pays, assets); } catch (e) { sell = [pays.raw, pays.id]; }
      }
    } else if (id === 33) {
      var got = assetLeg(body.amount);
      if (!got) return null;
      type = "Income";
      try { buy = fmtLeg(got, assets); } catch (e) { buy = [got.raw, got.id]; }
    } else {
      if (!feeLeg) return null;
      type = "Withdrawal";
    }
    return [type, buy[0], buy[1], sell[0], sell[1], feeH[0], feeH[1], EXCHANGE, "", comment, date];
  }

  /* History rows -> full CSV text (header + one line per mapped row).
   * Params: rows (raw get_account_history array, either envelope shape);
   *   meta ({accountId string, assets id->{symbol, precision}} — both
   *   optional, missing precisions fall back to raw digits per fmtLeg).
   * Returns the CSV string (header-only + trailing newline when nothing
   * maps — the UI treats that as an honest empty, never a download).
   * Never throws on chain data (bad rows skip). */
  function rowsToCsv(rows, meta) {
    var m = (meta && typeof meta === "object") ? meta : {};
    var accountId = (typeof m.accountId === "string") ? m.accountId : "";
    var assets = (m.assets && typeof m.assets === "object") ? m.assets : {};
    var list = Array.isArray(rows) ? rows : [];
    var lines = [HEADER];
    var i, entry, f;
    for (i = 0; i < list.length; i++) {
      try {
        entry = entryOf(list[i]);
        f = rowToFields(entry, list[i], accountId, assets);
      } catch (e) { f = null; }
      if (!f) continue;
      lines.push(f.map(csvCell).join(","));
    }
    return lines.join("\n") + "\n";
  }

  /* Unique asset ids touched by amount/fee/receives/pays legs across rows
   * (the Asset.describe join list for the caller). Pure; insertion order. */
  function collectAssetIds(rows) {
    var list = Array.isArray(rows) ? rows : [];
    var seen = {}, out = [];
    function grab(a) {
      if (a && typeof a === "object" && !Array.isArray(a) &&
          typeof a.asset_id === "string" && a.asset_id && !seen[a.asset_id]) {
        seen[a.asset_id] = 1;
        out.push(a.asset_id);
      }
    }
    var i, entry, body;
    for (i = 0; i < list.length; i++) {
      try {
        entry = entryOf(list[i]);
        if (!entry || !Array.isArray(entry.op) || entry.op.length < 2) continue;
        body = entry.op[1] || {};
        grab(body.amount);
        grab(body.fee);
        grab(body.receives);
        grab(body.pays);
      } catch (e) { /* row contributes nothing */ }
    }
    return out;
  }

  /* Safe download filename for an account name (alnum/dash/underscore kept,
   * all else dashed, 64 chars max, never blank). Pure. */
  function defaultFilename(name) {
    var safe = String(name === null || name === undefined ? "" : name).replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
    if (!safe) safe = "account";
    return "history-" + safe + ".csv";
  }

  /* Client-side Blob download of CSV text via a temp <a download>.
   * Params: filename (string), text (CSV string). Returns true when the
   * click was issued, false when Blob/URL/document are unavailable or any
   * step fails — never throws (callers show the honest error path). */
  function downloadCsv(filename, text) {
    try {
      if (typeof Blob === "undefined") return false;
      if (typeof URL === "undefined" || !URL || typeof URL.createObjectURL !== "function") return false;
      if (typeof document === "undefined" || !document || typeof document.createElement !== "function") return false;
      var name = String(filename || "history.csv");
      var blob = new Blob([String(text)], { type: "text/csv;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      if (!a) return false;
      try {
        if (typeof a.setAttribute === "function") a.setAttribute("href", url);
      } catch (e) { /* property fallback below */ }
      try { a.href = url; } catch (e) { /* href best-effort */ }
      try {
        if (typeof a.setAttribute === "function") a.setAttribute("download", name);
      } catch (e) { /* property fallback below */ }
      try { a.download = name; } catch (e) { /* download best-effort */ }
      var parent = null;
      try { parent = document.body; } catch (e) { parent = null; }
      try {
        if (parent && typeof parent.appendChild === "function") parent.appendChild(a);
      } catch (e) { /* click still attempted */ }
      try {
        if (typeof a.click === "function") a.click();
        else return false;
      } catch (e) { return false; }
      try {
        if (parent && a.parentNode === parent && typeof parent.removeChild === "function") parent.removeChild(a);
      } catch (e) { /* node stands harmlessly */ }
      try {
        if (typeof setTimeout === "function") {
          setTimeout(function () {
            try {
              if (typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
            } catch (e2) { /* url stands until page close */ }
          }, 1000);
        } else if (typeof URL.revokeObjectURL === "function") {
          URL.revokeObjectURL(url);
        }
      } catch (e) { /* url stands until page close */ }
      return true;
    } catch (e) {
      return false;
    }
  }

  return {
    HEADER: HEADER,
    EXCHANGE: EXCHANGE,
    FEE_OPS: FEE_OPS,
    csvCell: csvCell,
    rowsToCsv: rowsToCsv,
    collectAssetIds: collectAssetIds,
    defaultFilename: defaultFilename,
    downloadCsv: downloadCsv
  };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.HistoryExport === "undefined") { globalThis.HistoryExport = HistoryExport; }
if (typeof module !== "undefined") { module.exports = HistoryExport; }
