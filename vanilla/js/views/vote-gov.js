/* vote-gov.js — #/voting governance side panels (budget + analytics + join).
 *
 * What it owns: the worker-budget line (fillBudget), the governance
 * analytics section (renderAnalytics via GovAnalytics — funding shares,
 * active/standby splits, top voters + proxy-vote matrix), the small helpers
 * commas/fundHuman, and the join/update entry flows (renderJoinWitness with
 * isUpdate mode, renderJoinCommittee, showJoinConfirm with named rows,
 * sendJoinAndProve with object-read proof, showJoinResult). No route entry,
 * no proxy picker, no op-6 publish (those stay in vote-ballot.js, which
 * calls renderAnalytics/fillBudget/renderJoinWitness/renderJoinCommittee
 * via VoteUI._gov at call time).
 * Consumes: VoteUI._ballot.isLive (generation guard — late-bound, the ballot
 *   owns the only counter), Vote (fee/getWitnessByAccount/
 *   getCommitteeMemberByAccount), Tx.fee/buildTx/sign, Wallet, Account,
 *   Format.formatAmount, Chain, GovAnalytics, DOM, Forms. Tiny t/el/
 *   showError/showStatus/sleep/headBlock/const copies are verbatim from
 *   vote-ballot.js (vote-slate split precedent — no shared layer for two
 *   files). Side effects: DOM under the caller's boxes only; attaches
 *   VoteUI._gov and republishes globalThis.VoteUI. WIFs are JS values.
 * Created by: task-res-split2 (vote-ui.js responsibility split — panels
 *   half; bodies moved verbatim, only `myGen !== gen` reads rewritten to
 *   VoteUI._ballot.isLive). Facade: vote-ui.js.
 */
var VoteUI = (typeof globalThis !== "undefined" && globalThis.VoteUI) ? globalThis.VoteUI : ((typeof VoteUI !== "undefined") ? VoteUI : {});
VoteUI._gov = VoteUI._gov || {};
(function () {
  "use strict";

  /* Verbatim copy of vote-ballot.js t (same per-file convention as the explorer/vote-slate splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared chart/vote abstraction. */
  /* Batch-2c i18n (slice-17): display strings resolve via I18n.t with
   * the pre-conversion literal kept verbatim as enDefault (English-identical
   * on any transport, incl. file:// where dict fetch fails). Falls back to
   * the default when i18n.js failed to load: never blank, never throws.
   * Dynamic sentences keep their code structure (batch-2b precedent): only
   * complete static literals are wrapped, values and punctuation glue stay
   * raw, so every default below is byte-verbatim in the HEAD blob. vars
   * fills %(name)s placeholders; without I18n the raw default returns
   * unfilled. */
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    if (vars && typeof dflt === "string") return dflt.replace(/%\(([^)]+)\)s/g, function (m, name) {
      return (vars && Object.prototype.hasOwnProperty.call(vars, name)) ? String(vars[name]) : m;
    });
    return dflt;
  }

  /* Verbatim copy of vote-ballot.js el (same per-file convention as the explorer/vote-slate splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared chart/vote abstraction. */
  /* Create an element with optional text + class (textContent only — user
   * and chain strings never reach innerHTML). */
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /* Verbatim copy of vote-ballot.js showError (same per-file convention as the explorer/vote-slate splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared chart/vote abstraction. */
  /* Inline error panel that is never blank: thrown values map to human
   * sentences; unknown shapes fall back to a generic message. */
  function showError(doc, wrap, e, fallback) {
    var box = el(doc, "div", null, "error");
    box.setAttribute("aria-live", "polite");
    var msg = (e && typeof e.message === "string" && e.message)
      ? e.message
      : String(e || fallback || t("common.unexpected_error", "Unexpected error"));
    if (msg.indexOf("unknown-account") !== -1) msg = fallback || t("common.unknown_account", "Unknown account.");
    else if (msg.indexOf("no-account") !== -1) msg = t("vote.no_account", "No on-chain account found for the wallet's active key. Enter an account name below.");
    else if (msg.indexOf("wallet-locked") !== -1) msg = t("common.wallet_locked", "Wallet is locked.");
    else if (msg.indexOf("not-connected") !== -1 || msg.indexOf("not connected") !== -1) {
      msg = t("common.network_unavailable", "Network unavailable. Check Settings → Nodes and retry.");
    } else if (msg.indexOf("empty-list") !== -1) msg = t("vote.empty_list", "The node returned no witnesses or committee members.");
    box.textContent = msg;
    wrap.appendChild(box);
    return box;
  }

  /* Verbatim copy of vote-ballot.js showStatus (same per-file convention as the explorer/vote-slate splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared chart/vote abstraction. */
  function showStatus(doc, wrap, text) {
    var p = el(doc, "p", text, "muted");
    p.setAttribute("aria-live", "polite");
    wrap.appendChild(p);
    return p;
  }

  /* Verbatim copy of vote-ballot.js sleep (same per-file convention as the explorer/vote-slate splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared chart/vote abstraction. */
  function sleep(ms) {
    return new Promise(function (res) { setTimeout(res, ms); });
  }

  /* Verbatim copy of vote-ballot.js headBlock (same per-file convention as the explorer/vote-slate splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared chart/vote abstraction. */
  /* Head block number for result screens (observation marker, not a txid —
   * history rows carry none, same convention as transfer-ui.js). */
  async function headBlock() {
    var dbId = await Chain.db();
    var props = await Chain.call(dbId, "get_dynamic_global_properties", []);
    return (props && props.head_block_number) || 0;
  }

  /* Verbatim copy of vote-ballot.js PROXY_SENTINEL (same per-file convention as the explorer/vote-slate splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared chart/vote abstraction. */
  var PROXY_SENTINEL = "1.2.5";

  /* Verbatim copy of vote-ballot.js CORE_ASSET (same per-file convention as the explorer/vote-slate splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared chart/vote abstraction. */
  var CORE_ASSET = "1.3.0";

  /* Verbatim copy of vote-ballot.js CORE_PRECISION_FALLBACK (same per-file convention as the explorer/vote-slate splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared chart/vote abstraction. */
  var CORE_PRECISION_FALLBACK = 5;

  /* Verbatim copy of vote-ballot.js PROVE_TIMEOUT_MS (same per-file convention as the explorer/vote-slate splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared chart/vote abstraction. */
  var PROVE_TIMEOUT_MS = 30000;

  /* Verbatim copy of vote-ballot.js PROVE_INTERVAL_MS (same per-file convention as the explorer/vote-slate splits): duplicated so moved bodies stay byte-identical — doctrine prefers duplication over a shared chart/vote abstraction. */
  var PROVE_INTERVAL_MS = 2500;
  /* Worker-budget line (best-effort read-only): the per-day cap off 2.0.0
   * parameters, formatted at core p5; total stays a dash (budget-record id
   * not cleanly derivable — deferred, see header). Never fatal: a missing
   * Chain global or a failed read renders dashes, never a throw.
   * Params: doc, line (mutated in place), myGen (generation guard). */
  function fillBudget(doc, line, myGen) {
    if (typeof Chain === "undefined" || !Chain || typeof Chain.db !== "function") {
      line.textContent = t("vote.worker_budget", "Worker budget: —");
      return;
    }
    Chain.db().then(function (dbId) {
      return Chain.call(dbId, "get_objects", [["2.0.0"]]);
    }).then(function (rows) {
      if (!VoteUI._ballot.isLive(myGen)) return;
      var params = rows && rows[0] && rows[0].parameters;
      var raw = params ? params.worker_budget_per_day : null;
      var human = null;
      if (raw !== undefined && raw !== null && /^\d+$/.test(String(raw))) {
        try { human = Format.formatAmount(String(raw), CORE_PRECISION_FALLBACK); } catch (e) { human = null; }
      }
      line.textContent = human
        ? "Worker budget: " + human + " (core)/day · Total: —"
        : "Worker budget: —";
    }).catch(function () {
      if (!VoteUI._ballot.isLive(myGen)) return;
      line.textContent = t("vote.worker_budget", "Worker budget: —");
    });
  }

  /* Governance analytics section (GovAnalytics joins — all bounded, see that
   * file's header for the #4 citations). Renders, in order: active/standby
   * splits (from the already-loaded lists snapshot — zero new RPCs), worker
   * funding shares (live workers + 2.0.0 per-day cap), top voters by vp_active
   * (one get_top_voters, N=10), and the proxy-vote matrix (top-10 voters x
   * top-10 witnesses + top-10 committee, one batched get_accounts). Voting
   * power (vp_active) is a unitless uint64 — rendered as a plain integer with
   * thousands commas, NEVER via Format.formatAmount (that would mislabel it
   * as core money). Worker pay IS core money (Format p5) and funding % is
   * GovAnalytics.fundingShare (exact BigInt). Every sub-panel fails open with
   * an honest line. Plain literals only (no new i18n keys). Params: doc, box
   * (emptied by nobody — appended once), st (lists snapshot), myGen. */
  function renderAnalytics(doc, box, st, myGen) {
    if (typeof GovAnalytics === "undefined" || !GovAnalytics) return;
    box.appendChild(el(doc, "h2", "Governance analytics"));
    /* Splits: zero new RPCs (st.lists already carries the active flags). */
    try {
      var w = GovAnalytics.splitCounts(st.lists.witnesses);
      var c = GovAnalytics.splitCounts(st.lists.committee);
      box.appendChild(el(doc, "p",
        "Active splits — witnesses: " + w.active + " active / " + w.standby +
        " standby (" + w.total + " total) · committee: " + c.active +
        " active / " + c.standby + " standby (" + c.total + " total).", "muted"));
    } catch (e) { box.appendChild(el(doc, "p", "Active splits unavailable.", "muted")); }
    /* Worker funding shares (best-effort live join). */
    var fundP = el(doc, "p", "Worker funding: loading…", "muted");
    box.appendChild(fundP);
    GovAnalytics.workerFunding().then(function (fr) {
      if (!VoteUI._ballot.isLive(myGen)) return;
      while (fundP.firstChild) fundP.removeChild(fundP.firstChild);
      var rows = GovAnalytics.fundingRows(fr.workers).slice(0, 10);
      var head = "Worker funding (pay/day share of " +
        (fr.budgetRaw ? fundHuman(fr.budgetRaw) + " (core)/day" : "unknown budget") + "):";
      fundP.textContent = head;
      if (rows.length === 0) {
        box.appendChild(el(doc, "p", "No live workers on chain — valid, not an error.", "muted"));
        return;
      }
      /* Shared renderer (TableRenderer pilot): the table shell comes from the
       * shared renderer (fragment-backed detached build, single insert below
       * on data arrival); cell strings are computed verbatim with the old
       * inline logic — same titles, order, and text. No clicks before, none
       * added (read-only table, no tabindex). */
      var fundRows = rows.map(function (r) {
        var payHuman;
        try {
          payHuman = Format.formatAmount(String((r.extra || {}).daily_pay_raw || "0"), CORE_PRECISION_FALLBACK);
        } catch (e2) { payHuman = String((r.extra || {}).daily_pay_raw || "0"); }
        return {
          id: r.id,
          worker: (r.name || r.id) + " (" + r.id + ")",
          pay: payHuman,
          share: GovAnalytics.fundingShare((r.extra || {}).daily_pay_raw, fr.budgetRaw)
        };
      });
      var table = TableRenderer.render({
        columns: [
          { key: "worker", title: "Worker" },
          { key: "pay", title: "Pay/day" },
          { key: "share", title: "Share" }
        ],
        rows: fundRows,
        keyExtractor: function (r) { return r.id; }
      });
      /* Insert the table right after the heading line. */
      if (fundP.nextSibling) box.insertBefore(table, fundP.nextSibling);
      else box.appendChild(table);
      var totalHuman;
      try { totalHuman = Format.formatAmount(fr.totalPayRaw, CORE_PRECISION_FALLBACK); }
      catch (e3) { totalHuman = fr.totalPayRaw; }
      var totLine = el(doc, "p",
        "Total requested: " + totalHuman + " (core)/day" +
        (fr.budgetRaw ? " (" + GovAnalytics.fundingShare(fr.totalPayRaw, fr.budgetRaw) + " of budget)" : "") +
        " — top 10 shown.", "muted");
      if (table.nextSibling) box.insertBefore(totLine, table.nextSibling);
      else box.appendChild(totLine);
    }).catch(function (e) {
      if (!VoteUI._ballot.isLive(myGen)) return;
      fundP.textContent = t("vote.funding_unavailable_prefix", "Worker funding unavailable (") +
        ((e && e.message) || "read failed") + ").";
    });
    /* Top voters + proxy-vote matrix (best-effort bounded join). */
    var topP = el(doc, "p", "Top voters: loading…", "muted");
    box.appendChild(topP);
    GovAnalytics.proxyMatrix(10, 10, 10).then(function (mx) {
      if (!VoteUI._ballot.isLive(myGen)) return;
      topP.textContent = t("vote.top_voters_note", "Top 10 voters by voting power (get_top_voters — sample, not a full proxy census):");
      if (mx.voters.length === 0) {
        box.appendChild(el(doc, "p", "No top voters returned.", "muted"));
        return;
      }
      /* Shared renderer (same pilot as the funding table above): detached
       * build, single append; cell strings verbatim — same titles, order,
       * and text, no clicks. */
      var voterRows = mx.voters.map(function (v) {
        return {
          id: v.id,
          voter: v.name + " (" + v.id + ")",
          power: commas(v.vpRaw),
          proxy: v.proxy && v.proxy !== PROXY_SENTINEL ? v.proxy : "—"
        };
      });
      var vt = TableRenderer.render({
        columns: [
          { key: "voter", title: "Voter" },
          { key: "power", title: "Voting power" },
          { key: "proxy", title: "Proxy" }
        ],
        rows: voterRows,
        keyExtractor: function (r) { return r.id; }
      });
      box.appendChild(vt);
      /* Matrix: rows = voters, columns = top candidates (W = witness votes,
       * C = committee votes). "✓" = the voter's on-chain slate contains that
       * vote id; "·" = absent. Read-only, keyboard-scrollable region. */
      box.appendChild(el(doc, "p",
        "Proxy-vote matrix (rows: top-10 voters; columns: top-10 witnesses + top-10 committee by weight) — ✓ means the voter's slate carries that vote.", "muted"));
      var scroller = doc.createElement("div");
      scroller.style.overflowX = "auto";
      var cands = mx.candidates.witness.concat(mx.candidates.committee);
      /* Shared renderer (same pilot): dynamic columns per candidate
       * (W:/C: titles verbatim), ✓/· cells verbatim, single append into the
       * keyboard-scrollable region. No clicks before, none added. */
      var mCols = [{ key: "voter", title: "Voter \\ candidate" }];
      cands.forEach(function (cid, i) {
        var kind = i < mx.candidates.witness.length ? "W" : "C";
        mCols.push({ key: cid, title: kind + ":" + cid });
      });
      var mRows = mx.matrix.map(function (row) {
        var who = null;
        for (var k = 0; k < mx.voters.length; k++) {
          if (mx.voters[k].id === row.voter) { who = mx.voters[k]; break; }
        }
        var rec = { voterId: row.voter, voter: (who ? who.name : row.voter) };
        cands.forEach(function (cid) {
          rec[cid] = row.cells[cid] ? "✓" : "·";
        });
        return rec;
      });
      var mt = TableRenderer.render({
        columns: mCols,
        rows: mRows,
        keyExtractor: function (r) { return r.voterId; }
      });
      scroller.appendChild(mt);
      box.appendChild(scroller);
    }).catch(function (e) {
      if (!VoteUI._ballot.isLive(myGen)) return;
      var m = (e && e.message) || "";
      topP.textContent = m === "unavailable"
        ? "Top voters unavailable on this node (no get_top_voters) — switch nodes in Settings to see them."
        : "Top voters unavailable (" + (m || "read failed") + ").";
    });
  }

  /* Thousands commas on a digit string (display only — vp/power counts, never
   * money; money still formats via Format before reaching here). */
  function commas(digits) {
    return String(digits).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  /* Core-money human for the funding heading (Format p5; raw fallback). */
  function fundHuman(raw) {
    try { return Format.formatAmount(String(raw), CORE_PRECISION_FALLBACK); }
    catch (e) { return String(raw); }
  }

  /* Join/Update-witness entry form (reference Witnesses.jsx:57-66 +
   * JoinWitnessesModal field set: account, url, block signing key).
   * Reads stay public; the fee is a live chain estimate; the password gate
   * lives ONLY at Sign (showJoinConfirm below). Update mode offers a
   * "Load current" prefill via Vote.getWitnessByAccount; a missing object
   * points at Join instead of failing silently.
   * Params: doc, box (emptied first), root (route root for Back), st
   *   (needs me), myGen (generation guard), isUpdate bool. */
  function renderJoinWitness(doc, box, root, st, myGen, isUpdate) {
    while (box.firstChild) box.removeChild(box.firstChild);
    box.appendChild(el(doc, "h2", isUpdate ? t("vote.update_witness", "Update witness") : t("vote.join_as_witness", "Join as witness")));
    var acctF = Forms.labeledInput(doc, t("vote.account_row", "Account") + " ", { value: st.me.name, placeholder: t("common.name_or_id_hint", "name or 1.2.N"), autocomplete: "off" });
    box.appendChild(acctF.row);
    var urlF = Forms.labeledInput(doc, t("vote.url", "URL") + " ", { value: "", placeholder: "https://example.com", autocomplete: "off" });
    box.appendChild(urlF.row);
    var keyF = Forms.labeledInput(doc, t("vote.block_signing_key", "Block signing key") + " ", { value: "", placeholder: "BTS…", autocomplete: "off" });
    box.appendChild(keyF.row);
    var acctIn = acctF.input, urlIn = urlF.input, keyIn = keyF.input;
    var msg = el(doc, "div", "", "error");
    msg.setAttribute("aria-live", "polite");
    box.appendChild(msg);
    if (isUpdate) {
      var reload = touchable(el(doc, "button", t("vote.load_current", "Load current")));
      reload.type = "button";
      box.appendChild(reload);
      reload.addEventListener("click", function () {
        msg.textContent = "";
        reload.disabled = true;
        Account.resolve(acctIn.value.trim() || st.me.id).then(function (acct) {
          return Vote.getWitnessByAccount(acct.id);
        }).then(function (w) {
          reload.disabled = false;
          if (!VoteUI._ballot.isLive(myGen)) return;
          if (!w) { msg.textContent = t("vote.no_witness_object_for_this_account_use_join_a", "No witness object for this account — use Join as witness instead."); return; }
          urlIn.value = w.url || "";
          keyIn.value = w.signing_key || "";
        }).catch(function (e) {
          reload.disabled = false;
          msg.textContent = (e && e.message) ? e.message : t("vote.lookup_failed", "Lookup failed.");
        });
      });
    }
    var review = touchable(el(doc, "button", isUpdate ? t("vote.review_update", "Review update") : t("vote.review_join", "Review join")));
    review.type = "button";
    box.appendChild(review);
    review.addEventListener("click", function () {
      msg.textContent = "";
      /* Reference JoinWitnessesModal lowercases + sanitizes the url. */
      var url = urlIn.value.trim().toLowerCase();
      var signingKey = keyIn.value.trim();
      if (!url) { msg.textContent = t("vote.enter_a_url", "Enter a URL."); return; }
      if (!signingKey || signingKey.length < 20) { msg.textContent = t("vote.enter_the_block_signing_public_key", "Enter the block signing public key."); return; }
      review.disabled = true;
      var opId = isUpdate ? 21 : 20;
      Account.resolve(acctIn.value.trim() || st.me.id).then(function (acct) {
        var opData = isUpdate
          ? { fee: { amount: "0", asset_id: CORE_ASSET }, witness: "", witness_account: acct.id, new_url: url, new_signing_key: signingKey }
          : { fee: { amount: "0", asset_id: CORE_ASSET }, witness_account: acct.id, url: url, block_signing_key: signingKey };
        var shaped = isUpdate
          ? Vote.getWitnessByAccount(acct.id).then(function (w) {
              if (!w) throw new Error(t("vote.no_witness_object_for_this_account_use_join_a", "No witness object for this account — use Join as witness instead."));
              opData.witness = w.id;
              return { acct: acct, opData: opData };
            })
          : Promise.resolve({ acct: acct, opData: opData });
        return shaped;
      }).then(function (ctx) {
        /* Tx.fee is a pure chain get_required_fees call; the node also
         * validates the account/key shape here, so bad input fails
         * honestly at review (before anything is signed). */
        return Tx.fee(opId, ctx.opData, CORE_ASSET).then(function (fee) {
          ctx.opData.fee = { amount: String(fee.amount), asset_id: fee.asset_id || CORE_ASSET };
          return { acct: ctx.acct, opData: ctx.opData, feeRaw: String(fee.amount) };
        });
      }).then(function (ctx) {
        review.disabled = false;
        if (!VoteUI._ballot.isLive(myGen)) return;
        showJoinConfirm(doc, box, root, st, myGen, {
          kind: "witness", opId: opId, isUpdate: isUpdate,
          account: ctx.acct, opData: ctx.opData, feeRaw: ctx.feeRaw
        });
      }).catch(function (e) {
        review.disabled = false;
        msg.textContent = (e && e.message) ? e.message : t("vote.could_not_prepare_the_join", "Could not prepare the join.");
      });
    });
  }

  /* Join-committee entry form (reference Committee.jsx:47 +
   * JoinCommitteeModal field set: account, url). No update mode exists in
   * the reference, so none is offered here. Same public-reads / live-fee /
   * sign-gate contract as renderJoinWitness. */
  function renderJoinCommittee(doc, box, root, st, myGen) {
    while (box.firstChild) box.removeChild(box.firstChild);
    box.appendChild(el(doc, "h2", t("vote.join_committee", "Join committee")));
    var acctF = Forms.labeledInput(doc, t("vote.account_row", "Account") + " ", { value: st.me.name, placeholder: t("common.name_or_id_hint", "name or 1.2.N"), autocomplete: "off" });
    box.appendChild(acctF.row);
    var urlF = Forms.labeledInput(doc, t("vote.url", "URL") + " ", { value: "", placeholder: "https://example.com", autocomplete: "off" });
    box.appendChild(urlF.row);
    var acctIn = acctF.input, urlIn = urlF.input;
    var msg = el(doc, "div", "", "error");
    msg.setAttribute("aria-live", "polite");
    box.appendChild(msg);
    var review = touchable(el(doc, "button", t("vote.review_join", "Review join")));
    review.type = "button";
    box.appendChild(review);
    review.addEventListener("click", function () {
      msg.textContent = "";
      var url = urlIn.value.trim().toLowerCase();
      if (!url) { msg.textContent = t("vote.enter_a_url", "Enter a URL."); return; }
      review.disabled = true;
      Account.resolve(acctIn.value.trim() || st.me.id).then(function (acct) {
        var opData = { fee: { amount: "0", asset_id: CORE_ASSET }, committee_member_account: acct.id, url: url };
        return Tx.fee(29, opData, CORE_ASSET).then(function (fee) {
          opData.fee = { amount: String(fee.amount), asset_id: fee.asset_id || CORE_ASSET };
          return { acct: acct, opData: opData, feeRaw: String(fee.amount) };
        });
      }).then(function (ctx) {
        review.disabled = false;
        if (!VoteUI._ballot.isLive(myGen)) return;
        showJoinConfirm(doc, box, root, st, myGen, {
          kind: "committee", opId: 29, isUpdate: false,
          account: ctx.acct, opData: ctx.opData, feeRaw: ctx.feeRaw
        });
      }).catch(function (e) {
        review.disabled = false;
        msg.textContent = (e && e.message) ? e.message : t("vote.could_not_prepare_the_join", "Could not prepare the join.");
      });
    });
  }

  /* Named-row confirm for a join op (same idiom as showConfirm: dl rows,
   * human fee, locked-sign note; password gate ONLY at Send).
   * Params: doc, box (emptied first), root, st (form re-render on Back),
   *   myGen, spec {kind, opId, isUpdate, account {id,name}, opData, feeRaw}. */
  function showJoinConfirm(doc, box, root, st, myGen, spec) {
    while (box.firstChild) box.removeChild(box.firstChild);
    box.appendChild(el(doc, "h2", spec.isUpdate ? t("vote.confirm_witness_update_op_21", "Confirm witness update (op %(op)s)", { op: 21 })
      : (spec.kind === "witness" ? "Confirm witness join (op 20)" : "Confirm committee join (op 29)")));
    var list = el(doc, "dl", null, "vote-confirm");
    function row(term, text, title) {
      var dt = el(doc, "dt", term);
      var dd = el(doc, "dd", text);
      if (title) dd.title = title;
      list.appendChild(dt);
      list.appendChild(dd);
    }
    row(t("vote.account_row", "Account"), spec.account.name + " (" + spec.account.id + ")");
    row(t("vote.role", "Role"), spec.kind === "witness" ? t("vote.witness", "Witness") : t("vote.committee_member", "Committee member"));
    row(t("vote.url", "URL"), spec.kind === "witness"
      ? (spec.isUpdate ? spec.opData.new_url : spec.opData.url)
      : spec.opData.url);
    if (spec.kind === "witness") {
      var k = spec.isUpdate ? spec.opData.new_signing_key : spec.opData.block_signing_key;
      row(t("vote.signing_key", "Signing key"), k.length > 18 ? k.slice(0, 12) + "…" + k.slice(-6) : k, k);
    }
    var feeHuman;
    try {
      feeHuman = Format.formatAmount(spec.feeRaw, CORE_PRECISION_FALLBACK);
    } catch (e) { feeHuman = spec.feeRaw; }
    row(t("vote.fee_row", "Fee"), feeHuman + t("vote.fee_core", " (core)"), spec.feeRaw);
    var network = "mainnet";
    try {
      if (typeof Store !== "undefined" && Store.loadSettings) {
        network = Store.loadSettings().network || network;
      }
    } catch (e) { /* default stands */ }
    row(t("vote.network_row", "Network"), network);
    box.appendChild(list);
    try {
      if (typeof Wallet === "undefined" || typeof Wallet.isUnlocked !== "function" || !Wallet.isUnlocked())
        box.appendChild(el(doc, "p", t("vote.locked_sign_note", "Wallet is locked — browsing is public; unlock to sign."), "muted"));
    } catch (e) { /* notice is display-only */ }

    var backBtn = touchable(el(doc, "button", t("vote.back", "Back")));
    backBtn.type = "button";
    backBtn.className = "btn-ghost";
    box.appendChild(backBtn);
    var sendBtn = touchable(el(doc, "button", spec.isUpdate ? t("vote.sign_update", "Sign & Update") : t("vote.sign_join", "Sign & Join")));
    sendBtn.type = "button";
    box.appendChild(sendBtn);

    backBtn.addEventListener("click", function () {
      if (spec.kind === "witness") renderJoinWitness(doc, box, root, st, myGen, spec.isUpdate);
      else renderJoinCommittee(doc, box, root, st, myGen);
    });
    sendBtn.addEventListener("click", function () {
      backBtn.disabled = true;
      sendBtn.disabled = true;
      var status = showStatus(doc, box, t("common.status_signing", "Signing…"));
      var wif = Wallet.keys && Wallet.keys.active ? Wallet.keys.active.wif : null;
      if (!wif) {
        box.removeChild(status);
        showError(doc, box, new Error("wallet-locked"), t("common.wallet_locked", "Wallet is locked."));
        backBtn.disabled = false;
        return;
      }
      sendJoinAndProve(spec, wif, function (text) {
        status.textContent = text;
      }).then(function (res) {
        if (!VoteUI._ballot.isLive(myGen)) return;
        while (box.firstChild) box.removeChild(box.firstChild);
        showJoinResult(doc, box, spec, null, res);
      }).catch(function (e) {
        if (!VoteUI._ballot.isLive(myGen)) return;
        box.removeChild(status);
        showError(doc, box, (e && e.message) ? e.message : String(e || t("vote.join_failed_2", "Join failed")), t("vote.join_failed", "Join failed."));
        backBtn.disabled = false;
      });
    });
  }

  /* Join broadcast (vote-publish wiring, other op): envelope via Tx.buildTx,
   * sign with the FRESH wif (never stored), callback/plain fallback, then
   * prove by re-reading the affected object (create: object exists; update:
   * url matches). Node rejections (e.g. the LTM-membership assert on ops
   * 20/29 for basic accounts) surface inline with the node's own message.
   * Returns {blockNum, via, obj} where blockNum is the observed head block. */
  async function sendJoinAndProve(spec, wif, onStep) {
    if (typeof Tx !== "undefined" && Tx && typeof Tx.wifOk === "function" ? !Tx.wifOk(wif) : !wif) {
      throw new Error("wallet-locked");
    }
    var unsigned = await Tx.buildTx([[spec.opId, spec.opData]]);
    var routed = await Tx.signRouted(unsigned, wif, {});
    var txSigned = routed.signed;
    onStep(t("common.status_broadcasting", "Broadcasting…"));
    var via;
    if (routed.delegated) {
      /* Extension mode: the SW signed + broadcast behind approval. */
      via = ((routed.proof && routed.proof.via) ? routed.proof.via : "extension") + "+extension";
    } else {
    var netId = await Chain.net();
    var callbackId = (Math.random() * 4294967296) >>> 0;
    via = "broadcast_transaction_with_callback";
    try {
      await Chain.call(netId, "broadcast_transaction_with_callback", [callbackId, txSigned]);
    } catch (e) {
      via = "broadcast_transaction";
      await Chain.call(netId, "broadcast_transaction", [txSigned]);
    }
    }
    var wantUrl = spec.kind === "witness"
      ? (spec.isUpdate ? spec.opData.new_url : spec.opData.url)
      : spec.opData.url;
    var deadline = Date.now() + PROVE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      var cur = null;
      try {
        cur = spec.kind === "witness"
          ? await Vote.getWitnessByAccount(spec.account.id)
          : await Vote.getCommitteeMemberByAccount(spec.account.id);
      } catch (e2) { cur = null; }
      if (cur && cur.id && (spec.isUpdate !== true || cur.url === wantUrl)) {
        return { head: await headBlock(), via: via + "+object-read", obj: cur.id };
      }
      await sleep(PROVE_INTERVAL_MS);
    }
    throw new Error(t("vote.sent_prefix", "Sent (") + via + t("vote.but_the_new_object_was_not_observed_within", ") but the new object was not observed within ") +
      (PROVE_TIMEOUT_MS / 1000) + "s; check #/voting before retrying (do NOT blindly rebroadcast).");
  }

  /* Join result: observed head block + object id, or the node error inline
   * (e.g. the LTM-membership message for basic accounts on ops 20/29) —
   * never blank, never a fabricated txid.
   * Params: doc, box (emptied by the caller), spec, errText (null |
   *   message), res. */
  function showJoinResult(doc, box, spec, errText, res) {
    if (errText) {
      box.appendChild(el(doc, "h2", t("vote.join_failed_2", "Join failed")));
      showError(doc, box, errText, t("vote.join_failed", "Join failed."));
    } else {
      box.appendChild(el(doc, "h2", spec.isUpdate ? t("vote.witness_updated", "Witness updated") : t("vote.join_published", "Join published")));
      var ok = el(doc, "p", t("vote.observed_prefix", "Observed at head block #") + String(res.head) +
        " (" + res.via + "). Object " + res.obj + ".", "xfer-ok");
      ok.setAttribute("aria-live", "polite");
      box.appendChild(ok);
    }
    var back = touchable(el(doc, "a", t("vote.back_to_voting", "Back to voting")));
    back.setAttribute("href", "#/voting");
    back.className = "subtle-btn";
    box.appendChild(back);
  }
  VoteUI._gov.fillBudget = fillBudget;
  VoteUI._gov.renderAnalytics = renderAnalytics;
  VoteUI._gov.renderJoinWitness = renderJoinWitness;
  VoteUI._gov.renderJoinCommittee = renderJoinCommittee;
  if (typeof globalThis !== "undefined") { globalThis.VoteUI = VoteUI; }
})();

if (typeof module !== "undefined") { module.exports = VoteUI; }
