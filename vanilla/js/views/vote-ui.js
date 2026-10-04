/* vote-ui.js — #/voting THIN FACADE (identical public surface).
 *
 * What it owns: NOTHING but assembly — renderVoting delegates to
 * VoteUI._ballot (vote-ballot.js: route entry + proxy + op-6 publish) and
 * _test keeps the headless seam over VoteSlate + the ballot's slateMatches.
 * Bodies live in the task-res-split2 files: ballot core in vote-ballot.js
 * (VoteUI._ballot), budget/analytics/join panels in vote-gov.js
 * (VoteUI._gov). _gov/_ballot are registry internals (Tx._ser precedent).
 * Consumes: VoteUI._ballot (renderVoting, slateMatches), VoteSlate (slate
 *   math aliases — vote-slate.js loads first, same as before the split).
 * Globals/side effects: publishes globalThis.VoteUI; module.exports for
 *   node suites. Load order in index.html: vote-slate.js, vote-gov.js,
 *   vote-ballot.js, vote-ui.js (facade LAST — it reads _ballot at load).
 * Created by: task-res-split2 (vote-ui.js responsibility split).
 */
var VoteUI = (typeof globalThis !== "undefined" && globalThis.VoteUI) ? globalThis.VoteUI : ((typeof VoteUI !== "undefined") ? VoteUI : {});
/* Node suites require() the facade directly while the browser loads
 * Script-tag order in index.html (vote-gov.js, vote-ballot.js, then this
 * facade) already guarantees the parts — no loader needed. */
(function () {
  "use strict";

  VoteUI.renderVoting = VoteUI._ballot.renderVoting;
  /* Headless-test seam: slate math now lives in VoteSlate (slice-18
   * split) — these aliases keep the old VoteUI._test import path working;
   * slateMatches stays publish proof (owned by vote-ballot.js). */
  VoteUI._test = {
    sharePct: VoteSlate.sharePct,
    humanWeight: VoteSlate.humanWeight,
    sameSet: VoteSlate.sameSet,
    isChanged: VoteSlate.isChanged,
    slateMatches: VoteUI._ballot.slateMatches
  };
  if (typeof globalThis !== "undefined") { globalThis.VoteUI = VoteUI; }
})();

if (typeof module !== "undefined") { module.exports = VoteUI; }
