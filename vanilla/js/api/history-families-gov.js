/* history-families-gov.js — Task 5 governance/HTLC/tickets/vesting/proposals/
 * misc/blind summarizers (witness 20-21, committee 29-30, worker 34, proposals
 * 22-24, vesting 32-33, HTLC 49-53, tickets 57-58, authorities 54-56, account
 * admin 5/7/8/9, custom 35, balance claim 37, bid 45, blind 39-41).
 * Owns: the 24 per-tag summarizers + verbatim copies of the t/amount/name
 *   helpers they call (same per-file convention as the market-desk splits:
 *   duplicated so bodies stay plain — doctrine prefers duplication over a
 *   shared helper abstraction). Tags 31/36/44/46 stay label-only (see below),
 *   so they attach nothing. Blind transfers render input/output COUNTS only,
 *   never amounts.
 *   Attaches its entries to HistorySummary.SUMMARIZERS (created here if
 *   absent); the history-summary.js facade (tagged AFTER this file) keeps the
 *   registry by reference. No DOM, no signing.
 * Consumes: Format.formatAmount, I18n.t (both via the local verbatim copies).
 *   Globals/side effects: attaches HistorySummary.SUMMARIZERS[*] and
 *   republishes globalThis.HistorySummary.
 * Created by: history one-liners Task 5 (spec docs/superpowers/specs/2026-10-04-history-one-liners-design.md). */
var HistorySummary = (typeof globalThis !== "undefined" && globalThis.HistorySummary) ? globalThis.HistorySummary : ((typeof HistorySummary !== "undefined") ? HistorySummary : {});
HistorySummary.SUMMARIZERS = HistorySummary.SUMMARIZERS || {};
(function () {
  "use strict";

  /* Verbatim copies of history-summary.js t/amount/name (same per-file convention as the market-desk splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared helper abstraction. */
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    return dflt;
  }

  /* {amount, asset_id} -> human string or em dash (never raw). */
  function amount(leg, assets) {
    if (!leg || leg.amount === undefined || leg.amount === null || !leg.asset_id) return t("settings.dash", "—");
    var meta = (assets || {})[String(leg.asset_id)];
    if (!meta || typeof meta.prec !== "number" || !/^-?\d+$/.test(String(leg.amount))) return t("settings.dash", "—");
    try { return Format.formatAmount(String(leg.amount), meta.prec) + " " + meta.sym; }
    catch (e) { return t("settings.dash", "—"); }
  }

  /* Account id -> name or raw id (identifiers may show raw; money may not). */
  function name(id, names) { return (names && names[id]) || String(id); }

  /* Task 5 families below. Field paths verified against reference #4
   * (bitshares-core/libraries/protocol); #4 wins conflicts (Task 3 tag-77 style):
   * - committee 29/30 carry committee_member_account (committee_member.hpp:44,66),
   *   NOT witness_account — the brief's "same shape" shorthand was wrong.
   * - ticket create 57 carries amount (ticket.hpp:54), NOT p.value.
   * - params update 31 carries fee + new_parameters only
   *   (committee_member.hpp:84-93; fee_payer() is the empty id) — no account
   *   leg, so label-only, no key.
   * - fba distribute 44 carries a BARE share_type amount + account_id + fba_id
   *   (fba.hpp:34-38), NOT an asset object — no asset leg exists in the
   *   payload, so no honest money string is buildable within the 2-join
   *   design; label-only, no key (#3's popup.js likewise shows "-" there).
   * - execute_bid 46 fields verify cleanly (bidder/debt/collateral,
   *   market.hpp:262-276) but the brief ships no template for it — label-only,
   *   no invented wording.
   * - assert 36 is label-only per the brief (predicates are chain logic).
   * - htlc refund 53 renames sides (to = original from, htlc.hpp:187-196);
   *   the template names the htlc id only, so no side confusion is possible.
   * - blind 39/40/41 (confidential.hpp:150-191): input/output COUNTS only,
   *   never amounts; the structurally-absent side counts 0 (39 has no inputs
   *   array, 41 has no outputs array).
   * - proposal 1.10.x / htlc 1.16.x / ticket 1.18.x / vesting 1.13.x /
   *   authority 1.17.x / witness 1.6.x / committee 1.5.x ids render raw —
   *   identifiers may show raw; money may not.
   * Op tag numbers from operations.hpp:56-113. */
  /* Tag 20 witness_create (witness.hpp:37-49): owning account named. */
  function sumWitnessCreate(p, J) {
    if (!p || !p.witness_account) return null;
    return t("account.sum_witness_create", "Became witness: %(account)s",
      { account: name(p.witness_account, J.names) });
  }
  /* Tag 21 witness_update (witness.hpp:55-74): owning account named. */
  function sumWitnessUpdate(p, J) {
    if (!p || !p.witness_account) return null;
    return t("account.sum_witness_update", "Updated witness %(account)s",
      { account: name(p.witness_account, J.names) });
  }
  /* Tag 29 committee_member_create (committee_member.hpp:38-49). */
  function sumCommitteeCreate(p, J) {
    if (!p || !p.committee_member_account) return null;
    return t("account.sum_committee_create", "Became committee member: %(account)s",
      { account: name(p.committee_member_account, J.names) });
  }
  /* Tag 30 committee_member_update (committee_member.hpp:58-71). */
  function sumCommitteeUpdate(p, J) {
    if (!p || !p.committee_member_account) return null;
    return t("account.sum_committee_update", "Updated committee member %(account)s",
      { account: name(p.committee_member_account, J.names) });
  }
  /* Tag 34 worker_create (worker.hpp:79-95): name is inline, no join. */
  function sumWorkerCreate(p) {
    if (!p || typeof p.name !== "string" || !p.name) return null;
    return t("account.sum_worker_create", "Created worker \"%(name)s\"", { name: p.name });
  }
  /* Tag 22 proposal_create (proposal.hpp:70-92): COUNT of proposed_ops only,
   * never recursed (op_wrappers carry full nested ops). */
  function sumProposalCreate(p) {
    if (!p || Object.prototype.toString.call(p.proposed_ops) !== "[object Array]") return null;
    return t("account.sum_proposal_create", "Proposed %(n)s operations",
      { n: String(p.proposed_ops.length) });
  }
  /* Tag 23 proposal_update (proposal.hpp:119-139): proposal id stays raw
   * (1.10.x ids are identifiers). Voter add/remove lists counted nowhere —
   * the template names the proposal only. */
  function sumProposalUpdate(p) {
    if (!p || !p.proposal) return null;
    return t("account.sum_proposal_update", "Approved proposal %(proposal)s",
      { proposal: String(p.proposal) });
  }
  /* Tag 24 proposal_delete (proposal.hpp:156-168): proposal id stays raw. */
  function sumProposalDelete(p) {
    if (!p || !p.proposal) return null;
    return t("account.sum_proposal_delete", "Deleted proposal %(proposal)s",
      { proposal: String(p.proposal) });
  }
  /* Tag 32 vesting_balance_create (vesting.hpp:74-90): amount leg + owner. */
  function sumVestingCreate(p, J) {
    if (!p || !p.owner || !p.amount) return null;
    return t("account.sum_vesting_create", "Vested %(amount)s for %(owner)s",
      { amount: amount(p.amount, J.assets), owner: name(p.owner, J.names) });
  }
  /* Tag 33 vesting_balance_withdraw (vesting.hpp:101-117): amount leg. */
  function sumVestingWithdraw(p, J) {
    if (!p || !p.owner || !p.amount) return null;
    return t("account.sum_vesting_withdraw", "Withdrew %(amount)s vested",
      { amount: amount(p.amount, J.assets) });
  }
  /* Tag 49 htlc_create (htlc.hpp:45-67): amount leg + named sides + raw id. */
  function sumHtlcCreate(p, J) {
    if (!p || !p.htlc_id || p.from === undefined || p.from === null ||
        p.to === undefined || p.to === null || !p.amount) return null;
    return t("account.sum_htlc_create", "HTLC %(id)s: %(amount)s from %(from)s to %(to)s",
      { id: String(p.htlc_id), amount: amount(p.amount, J.assets),
        from: name(p.from, J.names), to: name(p.to, J.names) });
  }
  /* Tag 50 htlc_redeem (htlc.hpp:90-104): id only. */
  function sumHtlcRedeem(p) {
    if (!p || !p.htlc_id || !p.redeemer) return null;
    return t("account.sum_htlc_redeem", "Redeemed HTLC %(id)s", { id: String(p.htlc_id) });
  }
  /* Tag 51 htlc_redeemed, virtual (htlc.hpp:127-151): id only. */
  function sumHtlcClaimed(p) {
    if (!p || !p.htlc_id || !p.from || !p.to || !p.amount) return null;
    return t("account.sum_htlc_claimed", "HTLC %(id)s claimed", { id: String(p.htlc_id) });
  }
  /* Tag 52 htlc_extend (htlc.hpp:153-184): id only. */
  function sumHtlcExtend(p) {
    if (!p || !p.htlc_id) return null;
    return t("account.sum_htlc_extend", "Extended HTLC %(id)s", { id: String(p.htlc_id) });
  }
  /* Tag 53 htlc_refund, virtual (htlc.hpp:187-196): id only. */
  function sumHtlcRefund(p) {
    if (!p || !p.htlc_id) return null;
    return t("account.sum_htlc_refund", "HTLC %(id)s refunded", { id: String(p.htlc_id) });
  }
  /* Tag 57 ticket_create (ticket.hpp:47-60): amount leg (NOT p.value). */
  function sumTicketCreate(p, J) {
    if (!p || !p.account || !p.amount) return null;
    return t("account.sum_ticket_create", "Created ticket %(amount)s",
      { amount: amount(p.amount, J.assets) });
  }
  /* Tag 58 ticket_update (ticket.hpp:66-80): ticket id stays raw. */
  function sumTicketUpdate(p) {
    if (!p || !p.account || !p.ticket) return null;
    return t("account.sum_ticket_update", "Updated ticket %(ticket)s",
      { ticket: String(p.ticket) });
  }
  /* Tags 54/55/56 custom authorities (custom_authority.hpp:36-122):
   * owning account named; all three share one template. */
  function sumAuthorities(p, J) {
    if (!p || !p.account) return null;
    return t("account.sum_authorities", "Updated authorities for %(account)s",
      { account: name(p.account, J.names) });
  }
  /* Tag 5 account_create (account.hpp:81-129): name is inline, no join. */
  function sumAccountCreate(p) {
    if (!p || !p.registrar || typeof p.name !== "string" || !p.name) return null;
    return t("account.sum_account_create", "Registered %(name)s", { name: p.name });
  }
  /* Tag 7 account_whitelist (account.hpp:197-222): listed account named. */
  function sumWhitelist(p, J) {
    if (!p || !p.account_to_list) return null;
    return t("account.sum_whitelist", "Listed %(account)s",
      { account: name(p.account_to_list, J.names) });
  }
  /* Tag 8 account_upgrade (account.hpp:235-251): upgraded account named. */
  function sumUpgrade(p, J) {
    if (!p || !p.account_to_upgrade) return null;
    return t("account.sum_upgrade", "Upgraded %(account)s",
      { account: name(p.account_to_upgrade, J.names) });
  }
  /* Tag 9 account_transfer (account.hpp:267-278): new owner named. */
  function sumAccountTransfer(p, J) {
    if (!p || !p.account_id || !p.new_owner) return null;
    return t("account.sum_account_transfer", "Transferred account to %(owner)s",
      { owner: name(p.new_owner, J.names) });
  }
  /* Tag 35 custom (custom.hpp:38-54): payer named (auth counts verified
   * present but not enumerated — the template names the payer only). */
  function sumCustom(p, J) {
    if (!p || !p.payer ||
        Object.prototype.toString.call(p.required_auths) !== "[object Array]") return null;
    return t("account.sum_custom", "Custom operation by %(account)s",
      { account: name(p.payer, J.names) });
  }
  /* Tag 37 balance_claim (balance.hpp:40-53): claimed amount leg. */
  function sumBalanceClaim(p, J) {
    if (!p || !p.deposit_to_account || !p.total_claimed) return null;
    return t("account.sum_balance_claim", "Claimed %(amount)s",
      { amount: amount(p.total_claimed, J.assets) });
  }
  /* Tag 45 bid_collateral (market.hpp:241-254): collateral + debt legs. */
  function sumBid(p, J) {
    if (!p || !p.bidder || !p.additional_collateral || !p.debt_covered) return null;
    return t("account.sum_bid", "Bid %(coll)s for %(debt)s",
      { coll: amount(p.additional_collateral, J.assets),
        debt: amount(p.debt_covered, J.assets) });
  }
  /* Tags 39/40/41 blind (confidential.hpp:150-191): input/output COUNTS only,
   * never amounts (crypto stays unaudited/deferred per the design). */
  function sumBlind(p) {
    if (!p || typeof p !== "object") return null;
    var hasIn = Object.prototype.toString.call(p.inputs) === "[object Array]";
    var hasOut = Object.prototype.toString.call(p.outputs) === "[object Array]";
    if (!hasIn && !hasOut) return null;
    return t("account.sum_blind", "Blind transfer (%(in)s in, %(out)s out)",
      { in: String(hasIn ? p.inputs.length : 0),
        out: String(hasOut ? p.outputs.length : 0) });
  }
  HistorySummary.SUMMARIZERS[20] = sumWitnessCreate;
  HistorySummary.SUMMARIZERS[21] = sumWitnessUpdate;
  HistorySummary.SUMMARIZERS[29] = sumCommitteeCreate;
  HistorySummary.SUMMARIZERS[30] = sumCommitteeUpdate;
  HistorySummary.SUMMARIZERS[34] = sumWorkerCreate;
  HistorySummary.SUMMARIZERS[22] = sumProposalCreate;
  HistorySummary.SUMMARIZERS[23] = sumProposalUpdate;
  HistorySummary.SUMMARIZERS[24] = sumProposalDelete;
  HistorySummary.SUMMARIZERS[32] = sumVestingCreate;
  HistorySummary.SUMMARIZERS[33] = sumVestingWithdraw;
  HistorySummary.SUMMARIZERS[49] = sumHtlcCreate;
  HistorySummary.SUMMARIZERS[50] = sumHtlcRedeem;
  HistorySummary.SUMMARIZERS[51] = sumHtlcClaimed;
  HistorySummary.SUMMARIZERS[52] = sumHtlcExtend;
  HistorySummary.SUMMARIZERS[53] = sumHtlcRefund;
  HistorySummary.SUMMARIZERS[57] = sumTicketCreate;
  HistorySummary.SUMMARIZERS[58] = sumTicketUpdate;
  HistorySummary.SUMMARIZERS[54] = sumAuthorities;
  HistorySummary.SUMMARIZERS[55] = sumAuthorities;
  HistorySummary.SUMMARIZERS[56] = sumAuthorities;
  HistorySummary.SUMMARIZERS[5] = sumAccountCreate;
  HistorySummary.SUMMARIZERS[7] = sumWhitelist;
  HistorySummary.SUMMARIZERS[8] = sumUpgrade;
  HistorySummary.SUMMARIZERS[9] = sumAccountTransfer;
  HistorySummary.SUMMARIZERS[35] = sumCustom;
  HistorySummary.SUMMARIZERS[37] = sumBalanceClaim;
  HistorySummary.SUMMARIZERS[45] = sumBid;
  HistorySummary.SUMMARIZERS[39] = sumBlind;
  HistorySummary.SUMMARIZERS[40] = sumBlind;
  HistorySummary.SUMMARIZERS[41] = sumBlind;
  if (typeof globalThis !== "undefined") { globalThis.HistorySummary = HistorySummary; }
})();

if (typeof module !== "undefined") { module.exports = HistorySummary; }
