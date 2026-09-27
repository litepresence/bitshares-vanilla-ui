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
  var gen = 0;
  var AIRDROP_CHUNK = 10;
  function U() {
    if (typeof ProposalUI === "undefined" || !ProposalUI._ui) throw new Error("proposal-ui-missing (proposal-ui.js first)");
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
  function live(myGen, uiGen) {
    if (myGen !== gen) return false;
    try { return U().live(uiGen); } catch (e) { return false; }
  }
  function ticketRow(ui, r) {
    var a = (typeof r.prec === "number" && /^\d+$/.test(String(r.amount_raw)))
      ? Format.formatAmount(String(r.amount_raw), r.prec) + " " + r.sym
      : String(r.amount_raw) + " (" + r.asset_id + ")";
    return { t: r, cells: [{ text: r.id }, { text: r.owner }, { text: a, raw: r.amount_raw }, { text: r.lock_word }],
      cardLines: [r.id + " · " + r.owner, a, "Lock: " + r.lock_word] };
  }
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
  function updateBox(ui, doc, box, myGen, uiGen, t) {
    var b = ui.touchable(ui.el(doc, "button", "Update " + t.id)); b.type = "button"; box.appendChild(b);
    var out = ui.el(doc, "div", null, "xfer-out"); box.appendChild(out);
    b.addEventListener("click", function () {
      if (!live(myGen, uiGen)) return;
      ui.clearBox(out);
      out.appendChild(ui.el(doc, "p", "Current lock: " + t.lock_word + ". Downgrades are blocked until testnet proves them (ambiguity D).", "muted"));
      var sel = lockSel(ui, doc, out, "New lock");
      sel.value = String(t.target_type);
      var fM = ui.field(doc, "New amount (optional, blank = keep)", { placeholder: "blank = keep", inputmode: "decimal" });
      out.appendChild(fM.row);
      var ibox = ui.el(doc, "div"); out.appendChild(ibox);
      ui.reviewSection(doc, ibox, uiGen, "Review update", {
        build: async function () {
          var nt = parseInt(sel.value, 10);
          if (nt < t.target_type) throw new Error("downgrade-unproven");
          var mv = fM.input.value.trim(), amtOrNull = null, assetId = t.asset_id;
          if (mv !== "") amtOrNull = Format.parseAmount(mv, t.prec);
          var pair = ProposalTicket.buildTicketUpdate({ ticketId: t.id, accountId: t.owner,
            targetType: nt, amountRawOrNull: amtOrNull, assetIdOrNull: assetId });
          await Proposal.fee(pair, "1.3.0");
          return { pair: pair, fee: pair[1].fee,
            prove: async function () {
              var rows = await ProposalTicket.ticketsByAccount(t.owner, {});
              for (var i = 0; i < rows.length; i++)
                if (rows[i].id === t.id && rows[i].target_type === nt) return rows[i];
              return null;
            } };
        },
        title: "Confirm ticket update (op 58)",
        rows: function (built, f) {
          return [["Ticket", t.id], ["Account", t.owner],
            ["Lock", t.lock_word + " → " + ProposalTicket.lockLabel(parseInt(sel.value, 10))],
            ["Amount", (fM.input.value.trim() === "" ? "unchanged" : fM.input.value.trim() + " " + t.sym)], ["Fee (live)", f]];
        },
        ok: function () { return "Ticket updated and re-read on chain."; } });
    });
  }
  /* Route entry: #/tickets — table + leaderboard + my-tickets + create + row update. */
  function renderTickets(root) {
    if (!root) return;
    var ui = entry(root, "Ticket");
    if (!ui) return;
    var ctx = ui.routeReady(root, "Tickets", function () { renderTickets(root); },
      ["Proposal", "ProposalTicket", "Tx", "Account", "Wallet", "Format", "Asset", "Chain", "Store"]);
    if (!ctx) return;
    var doc = ctx.doc, uiGen = ctx.myGen, myGen = ++gen;
    ctx.wrap.appendChild(ui.el(doc, "p", "Tickets lock funds for vote weight. There is no delete operation, so every ticket row is permanent.", "muted"));
    var go = ui.touchable(ui.el(doc, "button", "Load leaderboard")); go.type = "button"; ctx.wrap.appendChild(go);
    var boardBox = ui.el(doc, "div"); ctx.wrap.appendChild(boardBox);
    var fM = ui.field(doc, "My account", { placeholder: "name or 1.2.N" });
    ctx.wrap.appendChild(fM.row);
    var mine = ui.touchable(ui.el(doc, "button", "My tickets")); mine.type = "button"; ctx.wrap.appendChild(mine);
    var mineBox = ui.el(doc, "div"); ctx.wrap.appendChild(mineBox);
    ctx.wrap.appendChild(ui.el(doc, "h2", "Create ticket"));
    var fA = ui.field(doc, "Account", { placeholder: "name or 1.2.N" });
    var fS = ui.field(doc, "Asset", { placeholder: "symbol or 1.3.x", value: "BTS" });
    var fQ = ui.field(doc, "Amount", { placeholder: "1.5", inputmode: "decimal" });
    ctx.wrap.appendChild(fA.row); ctx.wrap.appendChild(fS.row); ctx.wrap.appendChild(fQ.row);
    var lock = lockSel(ui, doc, ctx.wrap, "Lock");
    var cbox = ui.el(doc, "div"); ctx.wrap.appendChild(cbox);
    function drawRows(box, rows, withUpdate) {
      ui.clearBox(box);
      box.appendChild(ui.deskTable(doc, ["ID", "Owner", "Amount", "Lock"], rows.map(function (r) { return ticketRow(ui, r); })));
      if (withUpdate && rows.length) {
        box.appendChild(ui.el(doc, "p", "Tickets cannot be deleted (no delete op exists) — rows above are permanent.", "muted"));
        rows.forEach(function (t) { updateBox(ui, doc, box, myGen, uiGen, t); });
      }
    }
    go.addEventListener("click", function () {
      if (!live(myGen, uiGen)) return; go.disabled = true; ui.clearBox(boardBox);
      ui.showStatus(doc, boardBox, "Loading tickets…");
      ProposalTicket.tickets({}).then(function (rows) {
        if (!live(myGen, uiGen)) return; drawRows(boardBox, rows, false); go.disabled = false;
      }).catch(function (e) { if (!live(myGen, uiGen)) return; ui.clearBox(boardBox); ui.showError(doc, boardBox, e, "Could not load tickets."); go.disabled = false; });
    });
    mine.addEventListener("click", function () {
      if (!live(myGen, uiGen)) return; mine.disabled = true; ui.clearBox(mineBox);
      ui.showStatus(doc, mineBox, "Loading my tickets…");
      ProposalTicket.ticketsByAccount(fM.input.value.trim() || "").then(function (rows) {
        if (!live(myGen, uiGen)) return; drawRows(mineBox, rows, true); mine.disabled = false;
      }).catch(function (e) { if (!live(myGen, uiGen)) return; ui.clearBox(mineBox); ui.showError(doc, mineBox, e, "Could not load tickets."); mine.disabled = false; });
    });
    ui.reviewSection(doc, cbox, uiGen, "Review ticket", {
      build: async function () {
        var acct = await Account.resolve(fA.input.value.trim()), info = await Asset.describe(fS.input.value.trim() || "BTS");
        var raw = Format.parseAmount(fQ.input.value.trim(), info.precision);
        if (BigInt(raw) <= 0n) throw new Error("Ticket amount must be > 0.");
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
      title: "Confirm ticket create (op 57)",
      rows: function (built, f) {
        return [["Account", built.pair[1].account],
          ["Lock", ProposalTicket.lockLabel(built.pair[1].target_type), String(built.pair[1].target_type)],
          ["Amount", built.human, built.pair[1].amount.amount], ["Fee (live)", f]];
      },
      ok: function () { return "Ticket created and re-read on chain."; },
      fail: "Could not build the ticket (check account, asset and amount)." });
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
    if (!rows.length) throw new Error("Add at least one recipient line.");
    return rows;
  }
  /* Route entry: #/airdrop — off-chain calculator emitting op-14 issue batches. */
  function renderAirdrop(root) {
    if (!root) return;
    var ui = entry(root, "Airdrop");
    if (!ui) return;
    var ctx = ui.routeReady(root, "Airdrop", function () { renderAirdrop(root); },
      ["Proposal", "ProposalTicket", "Tx", "Account", "Wallet", "Format", "Asset", "Chain", "Store"]);
    if (!ctx) return;
    var doc = ctx.doc, uiGen = ctx.myGen, myGen = ++gen;
    ctx.wrap.appendChild(ui.el(doc, "p", "No airdrop operation exists on chain — this calculator emits batches of plain asset-issue (op 14). You must be the asset issuer. Batches chunk at " + AIRDROP_CHUNK + " issues per transaction until testnet sizes them (ambiguity J).", "muted"));
    var fI = ui.field(doc, "Issuer account", { placeholder: "name or 1.2.N" });
    var fS = ui.field(doc, "Asset", { placeholder: "symbol or 1.3.x" });
    ctx.wrap.appendChild(fI.row); ctx.wrap.appendChild(fS.row);
    var area = doc.createElement("textarea");
    area.setAttribute("placeholder", "alice,10\nbob,2.5"); area.setAttribute("rows", "6");
    ui.touchable(area); area.style.width = "100%"; ctx.wrap.appendChild(area);
    var prev = ui.touchable(ui.el(doc, "button", "Preview batches")); prev.type = "button"; ctx.wrap.appendChild(prev);
    var box = ui.el(doc, "div"); ctx.wrap.appendChild(box);
    prev.addEventListener("click", function () {
      if (!live(myGen, uiGen)) return; prev.disabled = true; ui.clearBox(box);
      ui.showStatus(doc, box, "Resolving recipients…");
      Promise.resolve().then(async function () {
        var issuer = await Account.resolve(fI.input.value.trim());
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
                r.push(["Fee (live, first op)", f]);
                return r;
              },
              ok: function () { return "Airdrop batch issued and first-recipient balance re-read."; } });
          })(prev.resolved.slice(c, c + AIRDROP_CHUNK), c / AIRDROP_CHUNK);
        }
        prev.disabled = false;
      }).catch(function (e) { if (!live(myGen, uiGen)) return; ui.clearBox(box); ui.showError(doc, box, e, "Could not preview the airdrop."); prev.disabled = false; });
    });
  }

  return { renderTickets: renderTickets, renderAirdrop: renderAirdrop };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.TicketUI === "undefined") { globalThis.TicketUI = TicketUI; }
if (typeof module !== "undefined") { module.exports = TicketUI; }
