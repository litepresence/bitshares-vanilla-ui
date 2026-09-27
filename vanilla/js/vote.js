/* Vote: read-only governance data layer (witnesses, committee, workers,
 *   current vote slate, vote fee estimate).
 * Owns: BitShares governance chain reads + normalization to plain JSON.
 *   No rendering, no signing, no broadcast — the publish flow lives in the
 *   view and reuses Tx (same split as transfer-ui + Tx).
 * Consumes: Chain.db/.call (sole socket owner — this file never opens its
 *   own socket), Account.resolve (proxy id -> name, name -> id fallback),
 *   Tx.fee (fee-estimate reuse — no duplicated get_required_fees code).
 * Globals/side effects: exposes global Vote only; no DOM, no storage
 *   writes, no key material (WIFs never enter this file).
 * Created by: building-vanilla-slices skill, slice-08-voting plan Task 2.
 *
 * CHAIN TRUTH (#4 wins; references recorded in
 *   docs/superpowers/plans/2026-09-28-slice-08-voting.md References):
 * - get_witnesses / get_witness_by_account / lookup_witness_accounts /
 *   get_witness_count <- database_api.hpp:1129-1151, registered :1570-1573
 * - get_committee_members / get_committee_member_by_account /
 *   lookup_committee_member_accounts / get_committee_count
 *   <- database_api.hpp:1164-1188, registered :1576-1579
 * - get_all_workers(is_expired?) / get_workers_by_account /
 *   get_worker_count <- database_api.hpp:1201-1213, registered :1582-1584
 * - lookup_vote_ids(votes) <- database_api.hpp:1221-1233, registered
 *   :1587; lookup page limit 1000 <- application.hpp:73-75,206-208
 * - witness_object{witness_account, vote_id, total_votes u64}
 *   <- chain/witness_object.hpp:35-40; committee_member_object{
 *   committee_member_account, vote_id, total_votes u64}
 *   <- chain/committee_member_object.hpp:47-49; worker_object{
 *   work_begin_date, work_end_date, daily_pay, vote_for, vote_against,
 *   total_votes_for/_against u64} <- chain/worker_object.hpp:113-131
 * - active sets on 2.0.0: active_witnesses = flat_set<witness_id_type>,
 *   active_committee_members = vector<committee_member_id_type>
 *   <- chain/global_property_object.hpp:48-49 (OBJECT ids, compared
 *   directly against 1.6.x / 1.5.x rows)
 * - proxy sentinel "1.2.5" (GRAPHENE_PROXY_TO_SELF_ACCOUNT)
 *   <- protocol/config.hpp:150; account.options{voting_account,
 *   num_witness, num_committee, votes} <- protocol/account.hpp:39-59
 * - vote_id JSON is "type:instance" (committee=0, witness=1, worker=2)
 *   <- protocol/vote.hpp:42-70
 *
 * MONEY DISCIPLINE (principle #6): total_votes / total_votes_for /
 *   total_votes_against / daily_pay stay RAW integer STRINGS until the view
 *   formats them via Format — no Number(), no float math, ever.
 */
var Vote = (function () {
  "use strict";

  /* Proxy-to-self sentinel: voting_account == this means "no proxy, my
   * slate counts" (see header chain truth). Exported for the view. */
  var PROXY_TO_SELF = "1.2.5";
  /* Object-id batch size for 1.6.x / 1.5.x scans (plan cap: <=50/call). */
  var BATCH = 50;
  /* Lookup-paging page size and page cap for the count-missing fallback. */
  var LOOKUP_PAGE = 100;
  var LOOKUP_PAGES_MAX = 10;
  var ID_RE_12 = /^1\.2\.\d+$/;

  /* Single database-API round trip with connection errors normalized.
   * Params: method string, params array (default []).
   * Returns: Promise of the raw node result (pass-through, unmodified).
   * Fails: "not-connected" when no socket is open. */
  async function _dbCall(method, params) {
    var dbId;
    try {
      dbId = await Chain.db();
    } catch (e) {
      throw new Error("not-connected");
    }
    try {
      return await Chain.call(dbId, method, params || []);
    } catch (e) {
      var m = (e && e.message) ? e.message : String(e || "");
      if (m.indexOf("not connected") !== -1) throw new Error("not-connected");
      throw e;
    }
  }

  /* Witness count (uint64, verbatim — the node answers a small number). */
  function getWitnessCount() { return _dbCall("get_witness_count", []); }

  /* Witness objects for 1.6.x ids (null per missing id, verbatim).
   * Params: ids array of "1.6.N" strings. */
  function getWitnesses(ids) { return _dbCall("get_witnesses", [ids || []]); }

  /* Single witness by account name or 1.2.x id (null when unknown). */
  function getWitnessByAccount(nameOrId) {
    return _dbCall("get_witness_by_account", [nameOrId]);
  }

  /* name -> "1.6.x" map page. Params: lowerBound string ("" from the top),
   * limit 1..1000 (node-enforced, see header). */
  function lookupWitnessAccounts(lowerBound, limit) {
    return _dbCall("lookup_witness_accounts", [lowerBound || "", limit || LOOKUP_PAGE]);
  }

  /* Committee count (uint64, verbatim). */
  function getCommitteeCount() { return _dbCall("get_committee_count", []); }

  /* Committee objects for 1.5.x ids (null per missing id, verbatim).
   * Params: ids array of "1.5.N" strings. */
  function getCommitteeMembers(ids) {
    return _dbCall("get_committee_members", [ids || []]);
  }

  /* Single committee member by account name or 1.2.x id (null when unknown). */
  function getCommitteeMemberByAccount(nameOrId) {
    return _dbCall("get_committee_member_by_account", [nameOrId]);
  }

  /* name -> "1.5.x" map page. Params: lowerBound string ("" from the top),
   * limit 1..1000 (node-enforced, see header). */
  function lookupCommitteeMemberAccounts(lowerBound, limit) {
    return _dbCall("lookup_committee_member_accounts", [lowerBound || "", limit || LOOKUP_PAGE]);
  }

  /* All workers (verbatim objects). Params: isExpired bool or undefined —
   * false = live rows only (the voting-slate source), true = expired rows
   * only, undefined = node default (no filter). Lists use false. */
  function getAllWorkers(isExpired) {
    return _dbCall("get_all_workers", isExpired === undefined ? [] : [!!isExpired]);
  }

  /* Worker objects created by one account (name or 1.2.x id, verbatim). */
  function getWorkersByAccount(nameOrId) {
    return _dbCall("get_workers_by_account", [nameOrId]);
  }

  /* Worker count (uint64, verbatim). */
  function getWorkerCount() { return _dbCall("get_worker_count", []); }

  /* Resolve "type:instance" vote ids to their objects (witness / committee /
   * worker variants, verbatim). Params: voteIds array of "t:i" strings. */
  function lookupVoteIds(voteIds) {
    return _dbCall("lookup_vote_ids", [voteIds || []]);
  }

  /* Batch-read object space 1.6.x / 1.5.x by count via get_objects.
   * Params: prefix "1.6." or "1.5.", count non-negative int.
   * Returns: Promise of the dense non-null object array (gaps dropped).
   * Stops at the first all-null BATCH tail (dead-id cap per the plan). */
  async function _readSpace(prefix, count) {
    var out = [];
    for (var start = 0; start < count; start += BATCH) {
      var end = Math.min(start + BATCH, count);
      var ids = [];
      for (var i = start; i < end; i++) ids.push(prefix + i);
      var rows = await _dbCall("get_objects", [ids]);
      var live = 0;
      for (var k = 0; k < rows.length; k++) {
        if (rows[k]) { live++; out.push(rows[k]); }
      }
      if (live === 0) break;
    }
    return out;
  }

  /* Lookup-paged id harvest (fallback when *count is missing on the node).
   * Params: lookup(lowerBound, limit) -> Promise of a name->id map.
   * Returns: Promise of the id array (capped at LOOKUP_PAGE*PAGES_MAX;
   *   duplicates from the inclusive lower bound are collapsed). */
  async function _harvestIds(lookup) {
    var ids = [], seen = {}, lower = "", pages = 0;
    for (;;) {
      var map = await lookup(lower, LOOKUP_PAGE);
      var names = Object.keys(map || {});
      if (names.length === 0) break;
      for (var k = 0; k < names.length; k++) {
        var id = map[names[k]];
        if (typeof id === "string" && !seen[id]) { seen[id] = 1; ids.push(id); }
      }
      lower = names[names.length - 1];
      pages++;
      if (pages >= LOOKUP_PAGES_MAX || names.length < LOOKUP_PAGE) break;
    }
    return ids;
  }

  /* Count read that tolerates nodes without the *count method: returns the
   * non-negative int, or null when the method is missing (fallback path).
   * Re-throws "not-connected" — a dead socket is never a fallback. */
  async function _countOrNull(fn) {
    try {
      var n = await fn();
    } catch (e) {
      if (e && e.message === "not-connected") throw e;
      return null;
    }
    var v = (typeof n === "string") ? parseInt(n, 10) : n;
    return (typeof v === "number" && isFinite(v) && v >= 0) ? Math.floor(v) : null;
  }

  /* Normalize one witness/committee object to a list entry. Weight stays a
   * raw-int string; active compares the OBJECT id against the 2.0.0 set
   * (they are object ids per global_property_object.hpp — not account ids).
   * Params: obj raw object, accountField its 1.2.x field, activeSet Set of
   *   active object ids. Name is joined by the caller (blank here). */
  function _memberEntry(obj, accountField, activeSet) {
    return {
      id: obj.id,
      account_id: obj[accountField] || "",
      name: "",
      vote_id: String(obj.vote_id === undefined || obj.vote_id === null ? "" : obj.vote_id),
      total_raw: String(obj.total_votes === undefined || obj.total_votes === null ? "0" : obj.total_votes),
      active: activeSet ? activeSet.has(obj.id) : false,
      url: obj.url || "",
      extra: {}
    };
  }

  /* Normalize one worker object to a list entry. Weights/pay stay raw-int
   * strings; workers have no chain active flag (active is always false).
   * Params: w raw worker object (name/url fall back to "" and are
   *   account-joined by the caller when blank). */
  function _workerEntry(w) {
    return {
      id: w.id,
      account_id: w.worker_account || "",
      name: w.name || "",
      vote_id: String(w.vote_for === undefined || w.vote_for === null ? "" : w.vote_for),
      total_raw: String(w.total_votes_for === undefined || w.total_votes_for === null ? "0" : w.total_votes_for),
      active: false,
      url: w.url || "",
      extra: {
        vote_against: String(w.vote_against === undefined || w.vote_against === null ? "" : w.vote_against),
        total_against_raw: String(w.total_votes_against === undefined || w.total_votes_against === null ? "0" : w.total_votes_against),
        daily_pay_raw: String(w.daily_pay === undefined || w.daily_pay === null ? "0" : w.daily_pay),
        work_begin_date: w.work_begin_date || "",
        work_end_date: w.work_end_date || ""
      }
    };
  }

  /* Fill blank entry names with one get_accounts round trip.
   * Params: entries array (mutated in place: .name set where resolvable).
   * Unresolvable ids keep "" — a missing name is display-only, never fatal. */
  async function _joinNames(entries) {
    var want = [], seen = {}, i;
    for (i = 0; i < entries.length; i++) {
      var aid = entries[i].account_id;
      if (!entries[i].name && aid && !seen[aid]) { seen[aid] = 1; want.push(aid); }
    }
    if (want.length === 0) return;
    var rows = await _dbCall("get_accounts", [want]);
    var byId = {};
    for (i = 0; i < (rows || []).length; i++) {
      if (rows[i]) byId[rows[i].id] = rows[i].name || "";
    }
    for (i = 0; i < entries.length; i++) {
      if (!entries[i].name && byId[entries[i].account_id]) entries[i].name = byId[entries[i].account_id];
    }
  }

  /* Full governance lists for the voting tabs.
   * Returns: Promise of {witnesses, committee, workers} entry arrays where
   *   each entry is {id, account_id, name, vote_id, total_raw, active, url,
   *   extra} with total_raw a RAW integer string (Format at render).
   *   Witnesses/committee scan 1.6.x / 1.5.x by count with an all-null-tail
   *   stop, falling back to lookup_* paging when the count method is
   *   missing; workers come from get_all_workers(false), so expired rows
   *   are EXCLUDED by construction (voting for one is a chain no-op).
   * Fails: "not-connected" (socket down); "empty-list" when BOTH
   *   witnesses and committee come back empty. Workers MAY be empty
   *   (testnets often have none) and yield [], never a throw. */
  async function lists() {
    var wCount = await _countOrNull(getWitnessCount);
    var cCount = await _countOrNull(getCommitteeCount);
    var wObjs, cObjs, i;
    if (wCount === null) {
      var wIds = await _harvestIds(lookupWitnessAccounts);
      var wRows = await getWitnesses(wIds);
      wObjs = [];
      for (i = 0; i < (wRows || []).length; i++) if (wRows[i]) wObjs.push(wRows[i]);
    } else {
      wObjs = await _readSpace("1.6.", wCount);
    }
    if (cCount === null) {
      var cIds = await _harvestIds(lookupCommitteeMemberAccounts);
      var cRows = await getCommitteeMembers(cIds);
      cObjs = [];
      for (i = 0; i < (cRows || []).length; i++) if (cRows[i]) cObjs.push(cRows[i]);
    } else {
      cObjs = await _readSpace("1.5.", cCount);
    }
    var globals = await _dbCall("get_objects", [["2.0.0"]]);
    var g = (globals && globals[0]) || {};
    var wActive = new Set(Array.isArray(g.active_witnesses) ? g.active_witnesses : []);
    var cActive = new Set(Array.isArray(g.active_committee_members) ? g.active_committee_members : []);
    var witnesses = [], committee = [], workers = [];
    for (i = 0; i < wObjs.length; i++) witnesses.push(_memberEntry(wObjs[i], "witness_account", wActive));
    for (i = 0; i < cObjs.length; i++) committee.push(_memberEntry(cObjs[i], "committee_member_account", cActive));
    var wAll = await getAllWorkers(false);
    for (i = 0; i < (wAll || []).length; i++) if (wAll[i]) workers.push(_workerEntry(wAll[i]));
    await _joinNames(witnesses.concat(committee, workers));
    if (witnesses.length === 0 && committee.length === 0) throw new Error("empty-list");
    return { witnesses: witnesses, committee: committee, workers: workers };
  }

  /* Current vote slate of one account.
   * Params: accountId "1.2.N" (a name is accepted too and resolved via
   *   Account.resolve when that global is loaded).
   * Returns: Promise of {voting_account, voting_account_name, num_witness,
   *   num_committee, votes, byType:{committee, witness, worker}} where
   *   votes are verbatim "t:i" strings split by type prefix per
   *   vote.hpp (unknown prefixes stay in votes, match no bucket), and
   *   voting_account_name is "" when the proxy is the "1.2.5" sentinel.
   * Fails: "unknown-account" (bad input, unresolvable name, or the node
   *   answers null); "not-connected". */
  async function currentVotes(accountId) {
    var id = accountId;
    if (typeof id !== "string" || !id) throw new Error("unknown-account");
    if (!ID_RE_12.test(id)) {
      if (typeof Account === "undefined" || !Account.resolve) throw new Error("unknown-account");
      try {
        id = (await Account.resolve(id)).id;
      } catch (e) {
        throw new Error("unknown-account");
      }
    }
    var rows = await _dbCall("get_accounts", [[id]]);
    if (!rows || !rows[0] || !rows[0].options) throw new Error("unknown-account");
    var opts = rows[0].options;
    var votes = Array.isArray(opts.votes) ? opts.votes.slice() : [];
    var byType = { committee: [], witness: [], worker: [] };
    for (var i = 0; i < votes.length; i++) {
      var v = votes[i];
      if (typeof v !== "string") continue;
      var t = v.split(":")[0];
      if (t === "0") byType.committee.push(v);
      else if (t === "1") byType.witness.push(v);
      else if (t === "2") byType.worker.push(v);
    }
    var votingAccount = opts.voting_account || PROXY_TO_SELF;
    var proxyName = "";
    if (votingAccount !== PROXY_TO_SELF &&
        typeof Account !== "undefined" && Account.resolve) {
      try {
        proxyName = (await Account.resolve(votingAccount)).name || "";
      } catch (e) {
        proxyName = "";
      }
    }
    return {
      voting_account: votingAccount,
      voting_account_name: proxyName,
      num_witness: opts.num_witness === undefined ? 0 : opts.num_witness,
      num_committee: opts.num_committee === undefined ? 0 : opts.num_committee,
      votes: votes,
      byType: byType
    };
  }

  /* Fee estimate for an op-6 account_update vote transaction.
   * Params: accountId "1.2.N" fee payer; newOptions the account_options
   *   object ({memo_key, voting_account, num_witness, num_committee,
   *   votes}); feeAssetId string (default "1.3.0" core).
   * Returns: Promise of the RAW integer fee string (Format at render).
   * Reuses Tx.fee — no duplicated get_required_fees code; the op-6 byte
   *   layout itself is Task 1/Task 3 territory (tx.js + view), not here.
   * Fails: "tx-unavailable" when Tx.fee is not loaded; node errors pass
   *   through (incl. "not-connected"). */
  async function fee(accountId, newOptions, feeAssetId) {
    feeAssetId = feeAssetId || "1.3.0";
    if (typeof Tx === "undefined" || !Tx.fee) throw new Error("tx-unavailable");
    var opData = { fee: { amount: "0", asset_id: feeAssetId }, account: accountId };
    if (newOptions !== undefined) opData.new_options = newOptions;
    var ans = await Tx.fee(6, opData, feeAssetId);
    return String(ans.amount);
  }

  return {
    PROXY_TO_SELF: PROXY_TO_SELF,
    getWitnessCount: getWitnessCount,
    getWitnesses: getWitnesses,
    getWitnessByAccount: getWitnessByAccount,
    lookupWitnessAccounts: lookupWitnessAccounts,
    getCommitteeCount: getCommitteeCount,
    getCommitteeMembers: getCommitteeMembers,
    getCommitteeMemberByAccount: getCommitteeMemberByAccount,
    lookupCommitteeMemberAccounts: lookupCommitteeMemberAccounts,
    getAllWorkers: getAllWorkers,
    getWorkersByAccount: getWorkersByAccount,
    getWorkerCount: getWorkerCount,
    lookupVoteIds: lookupVoteIds,
    lists: lists,
    currentVotes: currentVotes,
    fee: fee
  };
})();

if (typeof module !== "undefined") { module.exports = Vote; }
