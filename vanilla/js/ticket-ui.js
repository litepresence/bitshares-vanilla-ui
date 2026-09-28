/* ticket-ui.js — #/tickets desk + #/airdrop calculator (split OUT of proposal-ui.js on the cap).
 * Owns: ticket table (id/owner/amount-human/lock WORD) + leaderboard (first
 *   page of list_tickets) + my-tickets + create form (lock radio, live fee) +
 *   row update (target radio + optional amount, DOWNGRADES blocked client-side
 *   until Task-4 proves them — ambiguity D, named error downgrade-unproven) +
 *   airdrop calculator (recipient textarea, per-line validation, total human,
 *   chunked op-14 issue batches via the slice-10 path — NO new serializer).
 *   No delete UI exists on purpose (tickets have NO delete op — honest note on
 *   screen). No signing here (WIF passes opaquely to Proposal.sendAndProve).
 * Consumes: ProposalUI._ui (proposal-ui.js loads first: route gate,
 *   confirm+publish flow, tables, human formatters), Proposal
 *   (fee/sendAndProve/buildAirdropBatch), ProposalTicket (reads/lock
 *   converters/builders 57/58), Tx (buildTx), Format, Account, Asset, Wallet,
 *   Chain. Own gen + two-counter live() (samet-ui.js precedent). Exposes
 *   global TicketUI only.
 * Created by: building-vanilla-slices skill, slice-14-proposals plan Task 3.
 * CHAIN TRUTH (#4 wins): lock enum + op-57/58 fields <- ticket.hpp:33-80;
 *   space 1.18.x <- types.hpp:381; reads <- database_api.hpp:1422-1458. Lock
 *   WORDS <- #2 CreateTicket page copy (never bare ints on screen).
 * MONEY DISCIPLINE (#6): amounts stay RAW digit strings; Format renders at
 *   each asset's precision. No Number()/parseFloat on money — ever.
 */
var TicketUI = (function () {
  "use strict";

  /* Batch-2e i18n (slice-17 precedent): display strings resolve via I18n.t with the
   * pre-conversion literal kept verbatim as enDefault (English-identical on any
   * transport, incl. file:// where dict fetch fails). Falls back to the default
   * when i18n.js failed to load: never blank, never throws. vars supports
   * %(name)s templates at a few asset/named-count labels. */
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    if (vars && typeof dflt === "string") return dflt.replace(/%\(([^)]+)\)s/g, function (m, name) {
      return (vars && Object.prototype.hasOwnProperty.call(vars, name)) ? String(vars[name]) : m;
    });
    return dflt;
  }
  var gen = 0;
  var AIRDROP_CHUNK = 10;
  /* Shared-_ui accessor: ProposalUI._ui (proposal-ui.js loads first); throws proposal-ui-missing otherwise. */
  function U() {
    if (typeof ProposalUI === "undefined" || !ProposalUI._ui) throw new Error(t("ticket.proposal_ui_missing_proposal_ui_js_first", "proposal-ui-missing (proposal-ui.js first)"));
    return ProposalUI._ui;
  }
  /* Resolve the shared _ui or paint the missing-backend box; returns ui or null. */
  function entry(root, what) {
    try { return U(); } catch (e) {
      root.innerHTML = "";
      var d0 = root.ownerDocument || document, w0 = d0.createElement("div");
      w0.className = "wrap"; root.appendChild(w0);
      w0.appendChild(d0.createTextNode(what + " backend missing: proposal-ui.js failed to load."));
      return null;
    }
  }
  /* Two-counter liveness: own gen (this route) + ProposalUI uiGen (shared gate) — stale async work bails. */
  function live(myGen, uiGen) {
    if (myGen !== gen) return false;
    try { return U().live(uiGen); } catch (e) { return false; }
  }
  /* Ticket row -> deskTable shape (human amount + raw, lock WORD never a bare int). Params: ui, r (joined row). */
  function ticketRow(ui, r) {
    var a = (typeof r.prec === "number" && /^\d+$/.test(String(r.amount_raw)))
      ? Format.formatAmount(String(r.amount_raw), r.prec) + " " + r.sym
      : String(r.amount_raw) + " (" + r.asset_id + ")";
    return { t: r, cells: [{ text: r.id }, { text: r.owner }, { text: a, raw: r.amount_raw }, { text: r.lock_word }],
      cardLines: [r.id + " · " + r.owner, a, "Lock: " + r.lock_word] };
  }
  /* Lock-type select (5 lock words, defaults to 1) wrapped in a labeled row. Returns: the select. */
  function lockSel(ui, doc, box, label) {
    var sel = doc.createElement("select"); ui.touchable(sel);
    [0, 1, 2, 3, 4].forEach(function (t) {
      var o = doc.createElement("option"); o.value = String(t);
      o.textContent = ProposalTicket.lockLabel(t); sel.appendChild(o);
    });
    sel.value = "1";
    var row = ui.el(doc, "div", null, "xfer-field"), lab = ui.el(doc, "label", label + " ");
    lab.appendChild(sel); row.appendChild(lab); box.appendChild(row);
    return sel;
  }
  /* Per-row Update button + review box (downgrades blocked client-side until testnet proves them). Params: ui, doc, box, myGen, uiGen, t (ticket row). */
  function updateBox(ui, doc, box, myGen, uiGen, tk) {
    var b = ui.touchable(ui.el(doc, "button", "Update " + tk.id)); b.type = "button"; box.appendChild(b);
    var out = ui.el(doc, "div", null, "xfer-out"); box.appendChild(out);
    b.addEventListener("click", function () {
      if (!live(myGen, uiGen)) return;
      ui.clearBox(out);
      out.appendChild(ui.el(doc, "p", "Current lock: " + tk.lock_word + ". Downgrades are blocked until testnet proves them (ambiguity D).", "muted"));
      var sel = lockSel(ui, doc, out, t("ticket.new_lock", "New lock"));
      sel.value = String(tk.target_type);
      var fM = ui.field(doc, t("ticket.new_amount_optional_blank_keep", "New amount (optional, blank = keep)"), { placeholder: t("ticket.blank_keep", "blank = keep"), inputmode: "decimal" });
      out.appendChild(fM.row);
      var ibox = ui.el(doc, "div"); out.appendChild(ibox);
      ui.reviewSection(doc, ibox, uiGen, t("ticket.review_update", "Review update"), {
        build: async function () {
          var nt = parseInt(sel.value, 10);
          if (nt < tk.target_type) throw new Error("downgrade-unproven");
          var mv = fM.input.value.trim(), amtOrNull = null, assetId = tk.asset_id;
          if (mv !== "") amtOrNull = Format.parseAmount(mv, tk.prec);
          var pair = ProposalTicket.buildTicketUpdate({ ticketId: tk.id, accountId: tk.owner,
            targetType: nt, amountRawOrNull: amtOrNull, assetIdOrNull: assetId });
          await Proposal.fee(pair, "1.3.0");
          return { pair: pair, fee: pair[1].fee,
            prove: async function () {
              var rows = await ProposalTicket.ticketsByAccount(tk.owner, {});
              for (var i = 0; i < rows.length; i++)
                if (rows[i].id === tk.id && rows[i].target_type === nt) return rows[i];
              return null;
            } };
        },
        title: t("ticket.confirm_ticket_update_op_58", "Confirm ticket update (op 58)"),
        rows: function (built, f) {
          return [[t("ticket.ticket", "Ticket"), tk.id], [t("ticket.account", "Account"), tk.owner],
            [t("ticket.lock", "Lock"), tk.lock_word + " → " + ProposalTicket.lockLabel(parseInt(sel.value, 10))],
            [t("ticket.amount", "Amount"), (fM.input.value.trim() === "" ? t("ticket.unchanged", "unchanged") : fM.input.value.trim() + " " + tk.sym)], [t("ticket.fee_live", "Fee (live)"), f]];
        },
        ok: function () { return t("ticket.ticket_updated_and_re_read_on_chain", "Ticket updated and re-read on chain."); } });
    });
  }
  /* Route entry: #/tickets — table + leaderboard + my-tickets + create + row update. */
  function renderTickets(root) {
    if (!root) return;
    var ui = entry(root, "Ticket");
    if (!ui) return;
    var ctx = ui.routeReady(root, t("ticket.tickets", "Tickets"), function () { renderTickets(root); },
      ["Proposal", "ProposalTicket", "Tx", "Account", "Wallet", "Format", "Asset", "Chain", "Store"]);
    if (!ctx) return;
    var doc = ctx.doc, uiGen = ctx.myGen, myGen = ++gen;
    ctx.wrap.appendChild(ui.el(doc, "p", t("ticket.tickets_lock_funds_for_vote_weight_there_is_n", "Tickets lock funds for vote weight. There is no delete operation, so every ticket row is permanent."), "muted"));
    try {
      if (typeof Wallet === "undefined" || !Wallet.isUnlocked())
        ctx.wrap.appendChild(ui.el(doc, "p", t("ticket.viewing_as", "Viewing as committee-account (1.2.0) — unlock to act as yourself."), "muted"));
    } catch (e) { /* notice is display-only */ }
    var go = ui.touchable(ui.el(doc, "button", t("ticket.load_leaderboard", "Load leaderboard"))); go.type = "button"; ctx.wrap.appendChild(go);
    var boardBox = ui.el(doc, "div"); ctx.wrap.appendChild(boardBox);
    var fM = ui.field(doc, t("ticket.my_account", "My account"), { placeholder: t("ticket.name_or_1_2_n", "name or 1.2.N"), value: "1.2.0" });
    ctx.wrap.appendChild(fM.row);
    var mine = ui.touchable(ui.el(doc, "button", t("ticket.my_tickets", "My tickets"))); mine.type = "button"; ctx.wrap.appendChild(mine);
    var mineBox = ui.el(doc, "div"); ctx.wrap.appendChild(mineBox);
    ctx.wrap.appendChild(ui.el(doc, "h2", t("ticket.create_ticket", "Create ticket")));
    var fA = ui.field(doc, t("ticket.account", "Account"), { placeholder: t("ticket.name_or_1_2_n", "name or 1.2.N"), value: "1.2.0" });
    var fS = ui.field(doc, t("ticket.asset", "Asset"), { placeholder: t("ticket.symbol_or_1_3_x", "symbol or 1.3.x"), value: "BTS" });
    var fQ = ui.field(doc, t("ticket.amount", "Amount"), { placeholder: "1.5", inputmode: "decimal" });
    ctx.wrap.appendChild(fA.row); ctx.wrap.appendChild(fS.row); ctx.wrap.appendChild(fQ.row);
    var lock = lockSel(ui, doc, ctx.wrap, t("ticket.lock", "Lock"));
    var cbox = ui.el(doc, "div"); ctx.wrap.appendChild(cbox);
    /* Paint ticket rows as a desk table (+ per-row update boxes when withUpdate). Params: box, rows, withUpdate. */
    function drawRows(box, rows, withUpdate) {
      ui.clearBox(box);
      box.appendChild(ui.deskTable(doc, [t("ticket.id", "ID"), t("ticket.owner", "Owner"), t("ticket.amount", "Amount"), t("ticket.lock", "Lock")], rows.map(function (r) { return ticketRow(ui, r); })));
      if (withUpdate && rows.length) {
        box.appendChild(ui.el(doc, "p", t("ticket.tickets_cannot_be_deleted_no_delete_op_exists", "Tickets cannot be deleted (no delete op exists) — rows above are permanent."), "muted"));
        rows.forEach(function (t) { updateBox(ui, doc, box, myGen, uiGen, t); });
      }
    }
    go.addEventListener("click", function () {
      if (!live(myGen, uiGen)) return; go.disabled = true; ui.clearBox(boardBox);
      ui.showStatus(doc, boardBox, t("ticket.loading_tickets", "Loading tickets…"));
      ProposalTicket.tickets({}).then(function (rows) {
        if (!live(myGen, uiGen)) return; drawRows(boardBox, rows, false); go.disabled = false;
      }).catch(function (e) { if (!live(myGen, uiGen)) return; ui.clearBox(boardBox); ui.showError(doc, boardBox, e, t("ticket.could_not_load_tickets", "Could not load tickets.")); go.disabled = false; });
    });
    mine.addEventListener("click", function () {
      if (!live(myGen, uiGen)) return; mine.disabled = true; ui.clearBox(mineBox);
      ui.showStatus(doc, mineBox, t("ticket.loading_my_tickets", "Loading my tickets…"));
      ProposalTicket.ticketsByAccount(fM.input.value.trim() || "1.2.0").then(function (rows) {
        if (!live(myGen, uiGen)) return; drawRows(mineBox, rows, true); mine.disabled = false;
      }).catch(function (e) { if (!live(myGen, uiGen)) return; ui.clearBox(mineBox); ui.showError(doc, mineBox, e, t("ticket.could_not_load_tickets", "Could not load tickets.")); mine.disabled = false; });
    });
    ui.reviewSection(doc, cbox, uiGen, t("ticket.review_ticket", "Review ticket"), {
      build: async function () {
        var acct = await Account.resolve(fA.input.value.trim() || "1.2.0"), info = await Asset.describe(fS.input.value.trim() || "BTS");
        var raw = Format.parseAmount(fQ.input.value.trim(), info.precision);
        if (BigInt(raw) <= 0n) throw new Error(t("ticket.ticket_amount_must_be_0", "Ticket amount must be > 0."));
        var before = (await ProposalTicket.ticketsByAccount(acct.name || acct.id, {})).length;
        var pair = ProposalTicket.buildTicketCreate({ accountId: acct.id,
          targetType: parseInt(lock.value, 10), amountRaw: raw, assetId: info.id });
        await Proposal.fee(pair, "1.3.0");
        return { pair: pair, fee: pair[1].fee, human: Format.formatAmount(raw, info.precision) + " " + info.symbol,
          prove: async function () {
            var now = await ProposalTicket.ticketsByAccount(acct.name || acct.id, {});
            return now.length > before ? now[now.length - 1] : null;
          } };
      },
      title: t("ticket.confirm_ticket_create_op_57", "Confirm ticket create (op 57)"),
      rows: function (built, f) {
        return [["Account", built.pair[1].account],
          [t("ticket.lock", "Lock"), ProposalTicket.lockLabel(built.pair[1].target_type), String(built.pair[1].target_type)],
          [t("ticket.amount", "Amount"), built.human, built.pair[1].amount.amount], [t("ticket.fee_live", "Fee (live)"), f]];
      },
      ok: function () { return t("ticket.ticket_created_and_re_read_on_chain", "Ticket created and re-read on chain."); },
      fail: t("ticket.could_not_build_the_ticket_check_account_asse", "Could not build the ticket (check account, asset and amount).") });
  }
  /* Parse "account,amount" lines -> [{name, human}] (validation only — ids resolve at emit). */
  function parseAirdropLines(text) {
    var rows = [];
    String(text || "").split("\n").forEach(function (ln, i) {
      var line = ln.trim();
      if (!line) return;
      var parts = line.split(",");
      if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim())
        throw new Error("Line " + (i + 1) + ' must be "account,amount".');
      rows.push({ name: parts[0].trim(), human: parts[1].trim() });
    });
    if (!rows.length) throw new Error(t("ticket.add_at_least_one_recipient_line", "Add at least one recipient line."));
    return rows;
  }
  /* Route entry: #/airdrop — off-chain calculator emitting op-14 issue batches. */
  function renderAirdrop(root) {
    if (!root) return;
    var ui = entry(root, "Airdrop");
    if (!ui) return;
    var ctx = ui.routeReady(root, t("ticket.airdrop", "Airdrop"), function () { renderAirdrop(root); },
      ["Proposal", "ProposalTicket", "Tx", "Account", "Wallet", "Format", "Asset", "Chain", "Store"]);
    if (!ctx) return;
    var doc = ctx.doc, uiGen = ctx.myGen, myGen = ++gen;
    ctx.wrap.appendChild(ui.el(doc, "p", t("ticket.airdrop_note_tpl", "No airdrop operation exists on chain — this calculator emits batches of plain asset-issue (op 14). You must be the asset issuer. Batches chunk at %(n)s issues per transaction until testnet sizes them (ambiguity J).", { n: AIRDROP_CHUNK }), "muted"));
    try {
      if (typeof Wallet === "undefined" || !Wallet.isUnlocked())
        ctx.wrap.appendChild(ui.el(doc, "p", t("ticket.viewing_as", "Viewing as committee-account (1.2.0) — unlock to act as yourself."), "muted"));
    } catch (e) { /* notice is display-only */ }
    var fI = ui.field(doc, t("ticket.issuer_account", "Issuer account"), { placeholder: t("ticket.name_or_1_2_n", "name or 1.2.N"), value: "1.2.0" });
    var fS = ui.field(doc, t("ticket.asset", "Asset"), { placeholder: t("ticket.symbol_or_1_3_x", "symbol or 1.3.x") });
    ctx.wrap.appendChild(fI.row); ctx.wrap.appendChild(fS.row);
    var area = doc.createElement("textarea");
    area.setAttribute("placeholder", "alice,10\nbob,2.5"); area.setAttribute("rows", "6");
    ui.touchable(area); area.style.width = "100%"; ctx.wrap.appendChild(area);
    var prev = ui.touchable(ui.el(doc, "button", t("ticket.preview_batches", "Preview batches"))); prev.type = "button"; ctx.wrap.appendChild(prev);
    var box = ui.el(doc, "div"); ctx.wrap.appendChild(box);
    prev.addEventListener("click", function () {
      if (!live(myGen, uiGen)) return; prev.disabled = true; ui.clearBox(box);
      ui.showStatus(doc, box, t("ticket.resolving_recipients", "Resolving recipients…"));
      Promise.resolve().then(async function () {
        var issuer = await Account.resolve(fI.input.value.trim() || "1.2.0");
        var info = await Asset.describe(fS.input.value.trim());
        var objs = await Chain.call(await Chain.db(), "get_objects", [[info.id]]);
        if (!objs || !objs[0] || objs[0].issuer !== issuer.id)
          throw new Error("Issuer mismatch: " + info.symbol + " is issued by " + ((objs && objs[0] && objs[0].issuer) || "?") + ", not " + issuer.id + ".");
        var lines = parseAirdropLines(area.value), total = 0n, resolved = [];
        for (var i = 0; i < lines.length; i++) {
          var raw = Format.parseAmount(lines[i].human, info.precision);
          if (BigInt(raw) <= 0n) throw new Error("Line " + (i + 1) + ": amount must be > 0.");
          var to = await Account.resolve(lines[i].name);
          if (!live(myGen, uiGen)) return null;
          total += BigInt(raw);
          resolved.push({ toId: to.id, name: lines[i].name, human: lines[i].human, amountRaw: raw, assetId: info.id });
        }
        return { issuer: issuer, info: info, resolved: resolved, total: total };
      }).then(function (prev) {
        if (!prev || !live(myGen, uiGen)) { prev.disabled = false; return; }
        ui.clearBox(box);
        box.appendChild(ui.el(doc, "p", prev.resolved.length + " recipients · total " +
          Format.formatAmount(String(prev.total), prev.info.precision) + " " + prev.info.symbol +
          " · " + Math.ceil(prev.resolved.length / AIRDROP_CHUNK) + " transaction(s) of up to " + AIRDROP_CHUNK + ".", ""));
        for (var c = 0; c < prev.resolved.length; c += AIRDROP_CHUNK) {
          (function (ch, ci) {
            var ibox = ui.el(doc, "div"); box.appendChild(ibox);
            ui.reviewSection(doc, ibox, uiGen, "Review batch " + (ci + 1) + " (" + ch.length + " issues)", {
              build: async function () {
                var pairs = Proposal.buildAirdropBatch(prev.issuer.id, ch.map(function (r) {
                  return { toId: r.toId, amountRaw: r.amountRaw, assetId: r.assetId, memoOrNull: null };
                }));
                for (var k = 0; k < pairs.length; k++) await Proposal.fee(pairs[k], "1.3.0");
                var first = ch[0], pre = "0";
                try {
                  var preBals = await Account.balances(first.toId);
                  preBals.forEach(function (bl) { if (bl.asset_id === first.assetId) pre = bl.raw; });
                } catch (e) { /* prove treats absence as 0 */ }
                return { ops: pairs, fee: pairs[0][1].fee, first: first, pre: pre,
                  prove: async function () {
                    var cur = await Account.balances(first.toId);
                    for (var q = 0; q < cur.length; q++)
                      if (cur[q].asset_id === first.assetId && BigInt(cur[q].raw) >= BigInt(pre) + BigInt(first.amountRaw)) return cur[q];
                    return null;
                  } };
              },
              title: "Confirm airdrop batch (op 14 × " + ch.length + ")",
              rows: function (built, f) {
                var r = ch.map(function (rc, ri) { return ["#" + (ri + 1), rc.name + " ← " + rc.human + " " + prev.info.symbol]; });
                r.push([t("ticket.fee_live_first_op", "Fee (live, first op)"), f]);
                return r;
              },
              ok: function () { return t("ticket.airdrop_batch_issued_and_first_recipient_bala", "Airdrop batch issued and first-recipient balance re-read."); } });
          })(prev.resolved.slice(c, c + AIRDROP_CHUNK), c / AIRDROP_CHUNK);
        }
        prev.disabled = false;
      }).catch(function (e) { if (!live(myGen, uiGen)) return; ui.clearBox(box); ui.showError(doc, box, e, t("ticket.could_not_preview_the_airdrop", "Could not preview the airdrop.")); prev.disabled = false; });
    });
  }

  return { renderTickets: renderTickets, renderAirdrop: renderAirdrop };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.TicketUI === "undefined") { globalThis.TicketUI = TicketUI; }
if (typeof module !== "undefined") { module.exports = TicketUI; }
