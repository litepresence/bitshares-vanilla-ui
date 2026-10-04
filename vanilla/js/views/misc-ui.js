/* misc-ui.js — #/authorities + #/lists + #/invoice/:data (vesting split OUT to
 * vesting-ui.js on the cap).
 * Owns: custom authority lookup/detail + create
 *   (zero-restriction default; any restriction row -> "restrictions-unproven"
 *   VIEW gate — ambiguity G) + row update (changed-fields-only) / delete;
 *   whitelist/blacklist manager (add ORs the bit, remove subtracts it —
 *   ambiguity K); invoice parse view (base58 UTF-8 JSON, foreign #1 URLs ->
 *   invoice-unparseable + sample link, never a crash) + human invoice + pay
 *   deep-link + create tab (copyable URL, no QR lib). Op-38 override_transfer
 *   has NO UI (issuer-only — honest note only).
 * Consumes: ProposalUI._ui (proposal-ui.js loads first: route gate,
 *   confirm+publish flow, tables, human formatters), Proposal
 *   (fee/sendAndProve/unpackInvoice/packInvoice), ProposalMisc
 *   (reads/listing converters/builders 7/54/55/56), Tx (buildTx), Format, Account, Asset, Wallet, Chain.
 *   Own gen + two-counter live() (samet-ui.js precedent). Exposes MiscUI only.
 * Created by: building-vanilla-slices skill, slice-14-proposals plan Task 3.
 * CHAIN TRUTH (#4 wins): op-7 enum <- account.hpp:197-220;
 *   op-54/55/56 <- custom_authority.hpp:36-122; spaces
 *   1.17 <- types.hpp:380. Invoice pack shape ports #1
 *   InvoiceRequest.jsx:53-60 MINUS the zip (no compress lib vendored — see
 *   proposal.js header; vanilla URLs are base58 of UTF-8 JSON).
 * MONEY DISCIPLINE (#6): amounts stay RAW digit strings; Format renders.
 *   No Number()/parseFloat on money — ever. Op-37 confirm shows "fee: 0".
 */
var MiscUI = (function () {
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
  /* Shared-_ui accessor: ProposalUI._ui (proposal-ui.js loads first); throws proposal-ui-missing otherwise. */
  function U() {
    if (typeof ProposalUI === "undefined" || !ProposalUI._ui) throw new Error(t("misc.proposal_ui_missing_proposal_ui_js_first", "proposal-ui-missing (proposal-ui.js first)"));
    return ProposalUI._ui;
  }
  /* Two-counter liveness: own gen (this route) + ProposalUI uiGen (shared gate). */
  function live(myGen, uiGen) {
    if (myGen !== gen) return false;
    try { return U().live(uiGen); } catch (e) { return false; }
  }
  /* headIcon: swap the shared-gate plain h1 for a DOM.pageHead one carrying
   * this route's icon (heading-icons batch M3). WHY post-hoc: the h1 is
   * painted inside ProposalUI routeReady (shared owner, out of batch scope),
   * so the icon is applied here with identical text — t() keys/defaults stay
   * byte-identical and textContent-only holds. No-op when no h1 is present;
   * never throws (heading stands without the icon). */
  function headIcon(doc, scope, iconName) {
    try {
      var h = scope && scope.querySelector ? scope.querySelector("h1") : null;
      if (!h || !h.parentNode) return;
      h.parentNode.replaceChild(DOM.pageHead(doc, h.textContent || "", iconName), h);
    } catch (e) { /* heading stands without the icon */ }
  }
  /* Resolve the shared _ui or paint the missing-backend box; returns ui or null. */
  function entry(root) {
    try { return U(); } catch (e) {
      DOM.clear(root);
      var d0 = root.ownerDocument || document, w0 = d0.createElement("div");
      w0.className = "wrap"; root.appendChild(w0);
      w0.appendChild(d0.createTextNode(t("misc.vesting_backend_missing_proposal_ui_js_failed", "Vesting backend missing: proposal-ui.js failed to load.")));
      return null;
    }
  }
  function iso16(v) { v = String(v || "").trim(); return v.length === 16 ? v + ":00" : v; }
  function dateHuman(iso) {
    if (!iso) return t("misc.none", "none");
    var ts = Date.parse(/Z$/.test(iso) ? iso : iso + "Z");
    return isNaN(ts) ? String(iso) : new Date(ts).toLocaleString();
  }
  /* Op-type number -> "N (name)" via ProposalUI.opName (same table the
   * proposal desk uses); degrades to the bare number if unavailable. */
  function typeName(n) {
    try {
      if (typeof ProposalUI !== "undefined" && ProposalUI.opName) return " (" + ProposalUI.opName(n) + ")";
    } catch (e) { /* bare number below */ }
    return "";
  }
  /* Route entry: #/vesting lives in vesting-ui.js (split OUT on the cap). */
  /* Route entry: #/authorities — lookup/detail + create + update/delete. */
  function renderAuthorities(root) {
    if (!root) return;
    var ui = entry(root);
    if (!ui) return;
    var ctx = ui.routeReady(root, t("misc.custom_authorities", "Custom Authorities"), function () { renderAuthorities(root); },
      ["Proposal", "ProposalMisc", "Tx", "Account", "Wallet", "Format", "Asset", "Chain", "Store"]);
    if (!ctx) { headIcon(root.ownerDocument || document, root, "key"); return; }
    headIcon(ctx.doc, ctx.wrap, "key");
    var doc = ctx.doc, uiGen = ctx.myGen, myGen = ++gen;
    ctx.wrap.appendChild(ui.el(doc, "p", t("misc.custom_authorities_restrict_which_operations", "Custom authorities restrict which operations an account key may sign. The chain has no list method — look authorities up by explicit 1.17.x id. Issuer-only override_transfer (op 38) is not offered here."), "muted"));
    try {
      if (typeof Wallet === "undefined" || !Wallet.isUnlocked()) {
        var _v = (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.get === "function") ? ViewingAs.get() : { id: "1.2.0", name: "committee-account" };
        ctx.wrap.appendChild(ui.el(doc, "p", t("viewing.notice_locked", "Viewing as %(name)s (%(id)s) — unlock to act as yourself.", { name: _v.name, id: _v.id }), "muted"));
      }
    } catch (e) { /* notice is display-only */ }
    var fA = ui.field(doc, t("misc.account_or_authority_id", "Account or authority id"), { placeholder: t("misc.name_1_2_n_or_1_17_n", "name, 1.2.N or 1.17.N"), value: (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0" });
    ctx.wrap.appendChild(fA.row);
    var go = ui.touchable(ui.el(doc, "button", t("misc.look_up", "Look up"))); go.type = "button"; ctx.wrap.appendChild(go);
    var box = ui.el(doc, "div"); ctx.wrap.appendChild(box);
    /* Authority detail table + Update/Delete boxes (blank update fields = unchanged). Params: a (authority row). */
    function drawAuth(a) {
      ui.clearBox(box);
      box.appendChild(ui.deskTable(doc, [t("misc.field", "Field"), t("misc.value", "Value")], [
        { cells: [{ text: t("misc.id", "ID") }, { text: String(a.id) }], cardLines: ["ID " + String(a.id)] },
        { cells: [{ text: t("misc.account", "Account") }, { text: String(a.account || "?") }], cardLines: ["Account " + String(a.account || "?")] },
        { cells: [{ text: t("misc.enabled", "Enabled") }, { text: a.enabled ? "yes" : "no" }], cardLines: ["Enabled: " + (a.enabled ? t("misc.yes", "yes") : t("misc.no", "no"))] },
        { cells: [{ text: t("misc.valid", "Valid") }, { text: dateHuman(a.valid_from) + " → " + dateHuman(a.valid_to) }],
          cardLines: ["Valid " + dateHuman(a.valid_from) + " → " + dateHuman(a.valid_to)] },
        { cells: [{ text: t("misc.operation_type", "Operation type") }, { text: String(a.operation_type) }], cardLines: ["Operation type " + String(a.operation_type)] },
        { cells: [{ text: t("misc.restrictions", "Restrictions") }, { text: String((a.restrictions || []).length) }], cardLines: [String((a.restrictions || []).length) + " restriction(s)"] }]));
      var up = ui.touchable(ui.el(doc, "button", t("misc.update", "Update"))); up.type = "button"; box.appendChild(up);
      var del = ui.touchable(ui.el(doc, "button", t("misc.delete", "Delete"))); del.type = "button"; box.appendChild(del);
      var o2 = ui.el(doc, "div", null, "xfer-out"); box.appendChild(o2);
      up.addEventListener("click", function () {
        if (!live(myGen, uiGen)) return;
        ui.clearBox(o2);
        o2.appendChild(ui.el(doc, "p", t("misc.blank_leave_unchanged_only_changed_fields_are", "Blank = leave unchanged. Only changed fields are sent."), "muted"));
        var sE = doc.createElement("select"); ui.touchable(sE);
        [["", t("misc.enabled_unchanged", "enabled: unchanged")], ["true", t("misc.enabled_yes", "enabled: yes")], ["false", t("misc.enabled_no", "enabled: no")]].forEach(function (o) {
          var op = doc.createElement("option"); op.value = o[0]; op.textContent = o[1]; sE.appendChild(op);
        });
        o2.appendChild(sE);
        var vF = ui.field(doc, t("misc.new_valid_from_blank_keep", "New valid-from (blank = keep)"), { type: "datetime-local" });
        var vT = ui.field(doc, t("misc.new_valid_to_blank_keep", "New valid-to (blank = keep)"), { type: "datetime-local" });
        var vTh = ui.field(doc, t("misc.new_threshold_blank_keep", "New threshold (blank = keep)"), { placeholder: "", inputmode: "numeric" });
        o2.appendChild(vF.row); o2.appendChild(vT.row); o2.appendChild(vTh.row);
        var ibox = ui.el(doc, "div"); o2.appendChild(ibox);
        ui.reviewSection(doc, ibox, uiGen, t("misc.review_update", "Review update"), {
          build: async function () {
            var th = vTh.input.value.trim();
            var authOrNull = th === "" ? null : { weight_threshold: parseInt(th, 10), account_auths: [], key_auths: [], address_auths: [] };
            var pair = ProposalMisc.buildAuthorityUpdate({ accountId: String(a.account), authorityId: String(a.id),
              newEnabledOrNull: sE.value === "" ? null : sE.value === "true",
              newValidFromOrNull: iso16(vF.input.value), newValidToOrNull: iso16(vT.input.value),
              newAuthOrNull: authOrNull, restrictionsToRemove: [], restrictionsToAdd: [] });
            await Proposal.fee(pair, "1.3.0");
            return { pair: pair, fee: pair[1].fee,
              prove: async function () { return ProposalMisc.authority(String(a.id)); } };
          },
          title: t("misc.confirm_authority_update_op_55", "Confirm authority update (op 55)"),
          rows: function (built, f) {
            var r = [[t("misc.authority", "Authority"), String(a.id)], [t("misc.account", "Account"), String(a.account)]];
            if (sE.value !== "") r.push([t("misc.enabled", "Enabled"), (a.enabled ? t("misc.yes", "yes") : t("misc.no", "no")) + " → " + (sE.value === "true" ? t("misc.yes", "yes") : t("misc.no", "no"))]);
            if (vF.input.value.trim() !== "") r.push([t("misc.valid_from", "Valid-from"), dateHuman(a.valid_from) + " → " + dateHuman(iso16(vF.input.value))]);
            if (vT.input.value.trim() !== "") r.push([t("misc.valid_to", "Valid-to"), dateHuman(a.valid_to) + " → " + dateHuman(iso16(vT.input.value))]);
            if (vTh.input.value.trim() !== "") r.push([t("misc.threshold", "Threshold"), "→ " + vTh.input.value.trim()]);
            if (r.length === 2) r.push([t("misc.changed_fields", "Changed fields"), t("misc.none_this_would_be_a_no_op", "none — this would be a no-op")]);
            r.push([t("misc.fee_live", "Fee (live)"), f]);
            return r;
          },
          ok: function () { return t("misc.authority_updated_and_re_read_on_chain", "Authority updated and re-read on chain."); } });
      });
      del.addEventListener("click", function () {
        if (!live(myGen, uiGen)) return;
        var o3 = ui.el(doc, "div", null, "xfer-out"); box.appendChild(o3);
        ui.reviewPaid(doc, o3, uiGen, { btn: del,
          build: async function () {
            var pair = ProposalMisc.buildAuthorityDelete({ accountId: String(a.account), authorityId: String(a.id) });
            await Proposal.fee(pair, "1.3.0");
            return { pair: pair, fee: pair[1].fee,
              prove: async function () {
                try { await ProposalMisc.authority(String(a.id)); return null; }
                catch (e) { return String((e && e.message) || e).indexOf("unknown-authority") !== -1 ? { gone: true } : null; }
              } };
          },
          title: t("misc.confirm_authority_delete_op_56", "Confirm authority delete (op 56)"),
          rows: function (built, f) { return [[t("misc.authority", "Authority"), String(a.id)], [t("misc.account", "Account"), String(a.account)], [t("misc.fee_live", "Fee (live)"), f]]; },
          ok: function () { return t("misc.authority_deleted_re_read_confirms_it_is_gone", "Authority deleted (re-read confirms it is gone)."); } });
      });
    }
    go.addEventListener("click", function () {
      if (!live(myGen, uiGen)) return; go.disabled = true; ui.clearBox(box);
      ui.showStatus(doc, box, t("misc.loading", "Loading…"));
      ProposalMisc.authorities(fA.input.value.trim() || "").then(function (rows) {
        if (!live(myGen, uiGen)) return;
        ui.clearBox(box);
        if (!rows.length) { box.appendChild(ui.el(doc, "p", t("misc.no_authorities_listed_the_chain_has_no_list_m", "No authorities listed — the chain has no list method, so enter an explicit 1.17.x id."), "muted")); go.disabled = false; return; }
        drawAuth(rows[0]); go.disabled = false;
      }).catch(function (e) { if (!live(myGen, uiGen)) return; ui.clearBox(box); ui.showError(doc, box, e, t("misc.lookup_failed", "Lookup failed.")); go.disabled = false; });
    });
    ctx.wrap.appendChild(ui.el(doc, "h2", t("misc.create_authority_op_54", "Create authority (op 54)")));
    var cA = ui.field(doc, t("misc.account", "Account"), { placeholder: t("misc.name_or_1_2_n", "name or 1.2.N"), value: (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0" });
    var cF = ui.field(doc, t("misc.valid_from_2", "Valid from"), { type: "datetime-local" });
    var cT = ui.field(doc, t("misc.valid_to_2", "Valid to"), { type: "datetime-local" });
    var cO = ui.field(doc, t("misc.operation_type_number", "Operation type number"), { placeholder: t("misc.0_transfer", "0 = transfer"), inputmode: "numeric" });
    var cTh = ui.field(doc, t("misc.threshold", "Threshold"), { placeholder: "1", inputmode: "numeric" });
    var cK = ui.field(doc, t("misc.key_auth_public_key_weight_1", "Key auth (public key, weight 1)"), { placeholder: "BTS…" });
    ctx.wrap.appendChild(cA.row); ctx.wrap.appendChild(cF.row); ctx.wrap.appendChild(cT.row);
    ctx.wrap.appendChild(cO.row); ctx.wrap.appendChild(cTh.row); ctx.wrap.appendChild(cK.row);
    var en = doc.createElement("input"); en.type = "checkbox"; en.checked = true; ui.touchable(en);
    /* Forms seam (Task 2.2): single-field row — div.xfer-field > label > checkbox. */
    var enRow = Forms.fieldRow(doc, t("misc.enabled_2", "Enabled "), en);
    ctx.wrap.appendChild(enRow);
    ctx.wrap.appendChild(ui.el(doc, "p", t("misc.restrictions_default_to_zero_the_proven_path", "Restrictions default to zero (the proven path). Adding any restriction is blocked until testnet proves it."), "muted"));
    /* LOW punchlist: multiple key/account/address auth rows. This form
     * supports one key-auth plus threshold only — extra rows stay a
     * disabled, honestly labelled control (no new serializers here). Batch-3 i18n: keyed. */
    (function authRowsNote() {
      var p = ui.el(doc, "p", t("misc.one_key_auth_row_is_supported_here_key_ab", "One key-auth row is supported here (key above + threshold). Multiple key, account or address rows are not built in this form."), "muted");
      var b = ui.touchable(ui.el(doc, "button", t("misc.add_auth_row_unsupported", "Add auth row (unsupported)")));
      b.type = "button";
      b.disabled = true;
      b.title = t("misc.only_one_key_auth_row_is_supported_extra_", "Only one key-auth row is supported — extra authority rows need new serializers.");
      b.setAttribute("aria-disabled", "true");
      ctx.wrap.appendChild(p);
      ctx.wrap.appendChild(b);
    })();
    var crbox = ui.el(doc, "div"); ctx.wrap.appendChild(crbox);
    ui.reviewSection(doc, crbox, uiGen, t("misc.review_authority", "Review authority"), {
      build: async function () {
        var acct = await Account.resolve(cA.input.value.trim() || ((typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0"));
        var auth = { weight_threshold: parseInt(cTh.input.value.trim() || "1", 10), account_auths: [], key_auths: [], address_auths: [] };
        if (cK.input.value.trim() !== "") auth.key_auths = [[cK.input.value.trim(), 1]];
        var pair = ProposalMisc.buildAuthorityCreate({ accountId: acct.id, enabled: !!en.checked,
          validFromIso: iso16(cF.input.value), validToIso: iso16(cT.input.value),
          opType: parseInt(cO.input.value.trim() || "0", 10), auth: auth, restrictions: [] });
        await Proposal.fee(pair, "1.3.0");
        var before = 0;
        try { before = (await ProposalMisc.authorities(acct.name || acct.id)).length; } catch (e) { before = 0; }
        return { pair: pair, fee: pair[1].fee, before: before, acct: acct,
          prove: async function () {
            var now = await ProposalMisc.authorities(acct.name || acct.id);
            return now.length > before ? now[now.length - 1] : null;
          } };
      },
      title: t("misc.confirm_authority_create_op_54", "Confirm authority create (op 54)"),
      rows: function (built, f) {
        return [[t("misc.account", "Account"), built.pair[1].account], [t("misc.enabled", "Enabled"), built.pair[1].enabled ? t("misc.yes", "yes") : t("misc.no", "no")],
          [t("misc.valid", "Valid"), dateHuman(built.pair[1].valid_from) + " → " + dateHuman(built.pair[1].valid_to)],
          [t("misc.operation_type", "Operation type"), String(built.pair[1].operation_type) + typeName(built.pair[1].operation_type)], [t("misc.threshold", "Threshold"), String(built.pair[1].auth.weight_threshold)],
          [t("misc.restrictions", "Restrictions"), t("misc.none_proven_path", "none (proven path)")], [t("misc.fee_live", "Fee (live)"), f]];
      },
      ok: function () { return t("misc.authority_created", "Authority created."); },
      fail: t("misc.could_not_build_the_authority_check_account_d", "Could not build the authority (check account, dates, op type and key).") });
  }
  /* Route entry: #/lists — whitelist/blacklist manager (op 7). */
  function renderLists(root) {
    if (!root) return;
    var ui = entry(root);
    if (!ui) return;
    var ctx = ui.routeReady(root, t("misc.account_lists", "Account Lists"), function () { renderLists(root); },
      ["Proposal", "ProposalMisc", "Tx", "Account", "Wallet", "Format", "Asset", "Chain", "Store"]);
    if (!ctx) { headIcon(root.ownerDocument || document, root, "list"); return; }
    headIcon(ctx.doc, ctx.wrap, "list");
    var doc = ctx.doc, uiGen = ctx.myGen, myGen = ++gen;
    ctx.wrap.appendChild(ui.el(doc, "p", t("misc.listing_is_a_bitfield_none_0_whitelisted_1_bl", "Listing is a bitfield: none 0, whitelisted 1, blacklisted 2, both 3. Adding ORs the bit; removing subtracts it."), "muted"));
    try {
      if (typeof Wallet === "undefined" || !Wallet.isUnlocked()) {
        var _v2 = (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.get === "function") ? ViewingAs.get() : { id: "1.2.0", name: "committee-account" };
        ctx.wrap.appendChild(ui.el(doc, "p", t("viewing.notice_locked", "Viewing as %(name)s (%(id)s) — unlock to act as yourself.", { name: _v2.name, id: _v2.id }), "muted"));
      }
    } catch (e) { /* notice is display-only */ }
    var fA = ui.field(doc, t("misc.authorizing_account", "Authorizing account"), { placeholder: t("misc.name_or_1_2_n", "name or 1.2.N"), value: (typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0" });
    var fL = ui.field(doc, t("misc.counterparty", "Counterparty"), { placeholder: t("misc.name_or_1_2_n", "name or 1.2.N") });
    ctx.wrap.appendChild(fA.row); ctx.wrap.appendChild(fL.row);
    var go = ui.touchable(ui.el(doc, "button", t("misc.check_current", "Check current"))); go.type = "button"; ctx.wrap.appendChild(go);
    var box = ui.el(doc, "div"); ctx.wrap.appendChild(box);
    /* Apply one listing bit change via an op-7 confirm (toAdd ? listingAdd : listingRemove). Params: authId, listeeId, cur, bit, toAdd. */
    function setListing(authId, listeeId, cur, bit, toAdd) {
      var next = toAdd ? ProposalMisc.listingAdd(cur, bit) : ProposalMisc.listingRemove(cur, bit);
      var o2 = ui.el(doc, "div", null, "xfer-out"); box.appendChild(o2);
      ui.reviewPaid(doc, o2, uiGen, { btn: null,
        build: async function () {
          var pair = ProposalMisc.buildWhitelist({ authorizerId: authId, listeeId: listeeId, newListing: next });
          await Proposal.fee(pair, "1.3.0");
          return { pair: pair, fee: pair[1].fee, prove: async function () { return { listed: true }; } };
        },
        title: t("misc.confirm_whitelist_op_7", "Confirm whitelist (op 7)"),
        rows: function (built, f) {
          return [[t("misc.authorizer", "Authorizer"), authId], [t("misc.account", "Account"), listeeId],
            [t("misc.listing", "Listing"), ProposalMisc.listingLabel(cur) + " → " + ProposalMisc.listingLabel(next), cur + "→" + next],
            [t("misc.fee_live", "Fee (live)"), f]];
        },
        ok: function () { return t("misc.listing_updated_re_check_the_counterparty_to", "Listing updated (re-check the counterparty to see the echoed state)."); } });
    }
    go.addEventListener("click", function () {
      if (!live(myGen, uiGen)) return; go.disabled = true; ui.clearBox(box);
      ui.showStatus(doc, box, t("misc.reading_current_listing", "Reading current listing…"));
      Promise.resolve().then(async function () {
        var auth = await Account.resolve(fA.input.value.trim() || ((typeof ViewingAs !== "undefined" && ViewingAs && typeof ViewingAs.id === "function") ? ViewingAs.id() : "1.2.0")), listee = await Account.resolve(fL.input.value.trim() || "1.2.0");
        var rows = await Chain.call(await Chain.db(), "get_accounts", [[auth.id]]);
        var full = (rows && rows[0]) || {};
        var cur = ((full.whitelisted_accounts || []).indexOf(listee.id) !== -1 ? 1 : 0) +
          ((full.blacklisted_accounts || []).indexOf(listee.id) !== -1 ? 2 : 0);
        return { auth: auth, listee: listee, cur: cur };
      }).then(function (st) {
        if (!live(myGen, uiGen)) return; ui.clearBox(box);
        box.appendChild(ui.el(doc, "p", st.listee.name + " (" + st.listee.id + ") is currently: " + ProposalMisc.listingLabel(st.cur) + " (" + st.cur + ").", ""));
        [[t("misc.whitelist", "Whitelist"), 1], [t("misc.blacklist", "Blacklist"), 2]].forEach(function (p) {
          var on = (st.cur & p[1]) !== 0;
          var b = ui.touchable(ui.el(doc, "button", (on ? "Remove from " : "Add to ") + p[0].toLowerCase())); b.type = "button";
          box.appendChild(b);
          b.addEventListener("click", function () { setListing(st.auth.id, st.listee.id, st.cur, p[1], !on); });
        });
        go.disabled = false;
      }).catch(function (e) { if (!live(myGen, uiGen)) return; ui.clearBox(box); ui.showError(doc, box, e, t("misc.could_not_read_the_listing", "Could not read the listing.")); go.disabled = false; });
    });
  }
  /* Invoice object -> human lines (tolerant: {to,asset,lines[],note,id} or {to,asset,amount}). */
  function invoiceLines(inv) {
    if (Array.isArray(inv.lines) && inv.lines.length) return inv.lines.map(function (l) {
      return { label: String(l.label || l.memo || ""), amount: String(l.amount || "") };
    });
    if (inv.amount !== undefined) return [{ label: "", amount: String(inv.amount) }];
    return [];
  }
  /* Route entry: #/invoice/:data — parse view + pay deep-link + create tab.
   * CHECKOUT CONTRACT (bitshares-pay survey verdict ADAPT, zero backend): a
   *   second worker builds the bitshares: parser against this same contract, so
   *   THIS side is exact — renderInvoice reads #/invoice?to=&asset=&amount=
   *   &memo= query pairs (URL-decoded; amount stays a HUMAN string, converted
   *   only via Format at display/match time; invalid params -> honest inline
   *   note, never throw). Empty query = pre-existing behavior, unchanged.
   * QR VERDICT (deferred, 2026-10-03): a hand-rolled QR encoder is a
   *   Reed-Solomon project — NOT written here; no sub-15KB licensed QR lib is
   *   vendored (a new third-party surface for one view fails the §4.5 boring
   *   rule), so checkout ships text-payload (copyable URL) + printable view
   *   with the same honest no-QR wording as gateway-ui.js. Paid-watcher polls
   *   Account.history on the `to` account on load + on re-check tap ONLY
   *   (never set_subscribe, never auto) for a matching inbound op-0 (same
   *   asset id + raw amount via Format.parseAmount + memo substring on the
   *   visible memo field); incoming transfers are irreversible once in a block,
   *   so state is simply paid/unpaid (no confirmation counting). No
   *   auto-refund, no custody — survey REJECT stands. */
  function renderInvoice(root, data) {
    if (!root) return;
    var ui = entry(root);
    if (!ui) return;
    var ctx = ui.routeReady(root, t("misc.invoice", "Invoice"), function () { renderInvoice(root, data); },
      ["Proposal", "ProposalMisc", "Tx", "Account", "Wallet", "Format", "Asset", "Chain", "Store"]);
    if (!ctx) { headIcon(root.ownerDocument || document, root, "clippy"); return; }
    headIcon(ctx.doc, ctx.wrap, "clippy");
    var doc = ctx.doc, uiGen = ctx.myGen, myGen = ++gen;
    /* Checkout query reader (this function owns the contract — router.js
     * currentPath() strips queries, so the hash is re-read here). Returns the
     * raw string map (possibly empty). Never throws: bad escapes keep raw. */
    function readQuery() {
      var q = {};
      try {
        var h = (typeof window !== "undefined" && window.location && typeof window.location.hash === "string") ? window.location.hash : "";
        var qi = h.indexOf("?");
        if (qi === -1) return q;
        h.slice(qi + 1).split("&").forEach(function (pair) {
          if (!pair) return;
          var eq = pair.indexOf("="), k = eq === -1 ? pair : pair.slice(0, eq), v = eq === -1 ? "" : pair.slice(eq + 1);
          try { k = decodeURIComponent(k.replace(/\+/g, " ")); } catch (e) { /* raw stands */ }
          try { v = decodeURIComponent(v.replace(/\+/g, " ")); } catch (e2) { /* raw stands */ }
          if (k && !Object.prototype.hasOwnProperty.call(q, k)) q[k] = v;
        });
      } catch (e) { /* empty stands */ }
      return q;
    }
    /* shareHash: the exact contract string the bitshares: parser mirrors. */
    function shareHash(to, asset, amount, memo) {
      return "#/invoice?to=" + encodeURIComponent(to) + "&asset=" + encodeURIComponent(asset) +
        "&amount=" + encodeURIComponent(amount) + "&memo=" + encodeURIComponent(memo);
    }
    var AMOUNT_RE = /^\d+(\.\d+)?$/;
    var qp = readQuery();
    var qTo = String(qp.to || "").trim(), qAsset = String(qp.asset || "").trim();
    var qAmount = String(qp.amount || "").trim(), qMemo = String(qp.memo || "");
    var hasQuery = !!(qTo || qAsset || qAmount || qMemo);
    var amountOk = AMOUNT_RE.test(qAmount);
    var queryOk = !!(qTo && qAsset && qAmount && amountOk);
    /* Create-form refs (declared early: the checkout panel's copy button reads
     * live form values at tap time, after the fields below exist). */
    var cT = null, cA = null, cN = null, area = null;
    var box = ui.el(doc, "div"); ctx.wrap.appendChild(box);
    if (data) {
      try {
        var inv = Proposal.unpackInvoice(data), lines = invoiceLines(inv);
        if (!inv.to || !inv.asset || !lines.length) throw new Error(t("misc.invoice_unparseable_missing_to_asset_amount", "invoice-unparseable (missing to/asset/amount)"));
        ctx.wrap.appendChild(ui.confirmList(doc, [
          [t("misc.recipient", "Recipient"), String(inv.to)], [t("misc.asset", "Asset"), String(inv.asset)],
          [t("misc.note", "Note"), String(inv.note || inv.memo || t("misc.none", "none"))], [t("misc.identifier", "Identifier"), String(inv.id || t("misc.none", "none"))]]));
        Promise.resolve().then(async function () {
          var info = await Asset.describe(String(inv.asset)), total = 0n;
          lines.forEach(function (l) { total += BigInt(Format.parseAmount(l.amount, info.precision)); });
          if (!live(myGen, uiGen)) return;
          box.appendChild(ui.deskTable(doc, [t("misc.line", "Line"), t("misc.amount", "Amount")], lines.map(function (l, i) {
            var h = Format.formatAmount(Format.parseAmount(l.amount, info.precision), info.precision) + " " + info.symbol;
            return { cells: [{ text: l.label || ("line " + (i + 1)) }, { text: h, raw: l.amount }],
              cardLines: [(l.label || ("line " + (i + 1))) + ": " + h] };
          })));
          box.appendChild(ui.el(doc, "p", "Total: " + Format.formatAmount(String(total), info.precision) + " " + info.symbol, ""));
          var pay = ui.touchable(ui.el(doc, "a", t("misc.pay_via_transfer", "Pay via transfer")));
          pay.setAttribute("href", "#/transfer/" + encodeURIComponent(String(inv.to)));
          box.appendChild(pay);
          box.appendChild(ui.el(doc, "p", "Paying opens the transfer page for " + String(inv.to) + " — enter the total above there.", "muted"));
        }).catch(function (e) { if (live(myGen, uiGen)) ui.showError(doc, box, e, t("misc.could_not_render_the_invoice_amounts", "Could not render the invoice amounts.")); });
      } catch (e) {
        ui.showError(doc, ctx.wrap, e, t("misc.this_invoice_link_cannot_be_parsed", "This invoice link cannot be parsed."));
        var sample = Proposal.packInvoice({ to: "alice", asset: "BTS", lines: [{ label: "coffee", amount: "1.5" }], note: "sample", id: "demo-1" });
        var a = ui.touchable(ui.el(doc, "a", t("misc.open_a_sample_invoice", "Open a sample invoice")));
        a.setAttribute("href", "#/invoice/" + sample); ctx.wrap.appendChild(a);
        ctx.wrap.appendChild(ui.el(doc, "p", t("misc.foreign_compressed_invoice_urls_from_the_old", "Foreign (compressed) invoice URLs from the old UI cannot be parsed — only links created below."), "muted"));
      }
    } else if (hasQuery) {
      /* Query IS data: a checkout request summary (amount shown as-given —
       * human string, zero conversion here). Validity is flagged below, and
       * the paid-watcher + share row follow the create form. */
      ctx.wrap.appendChild(ui.confirmList(doc, [
        [t("misc.recipient", "Recipient"), qTo || t("misc.none", "none")],
        [t("misc.asset", "Asset"), qAsset || t("misc.none", "none")],
        [t("misc.amount", "Amount"), qAmount || t("misc.none", "none")],
        [t("misc.note", "Note"), qMemo || t("misc.none", "none")]]));
      if (!qTo || !qAsset || !qAmount) {
        ctx.wrap.appendChild(ui.el(doc, "p",
          t("misc.invoice_query_missing", "This invoice link is missing “to”, “asset” or “amount” — complete the form below and share a fresh link."), "error"));
      } else if (!amountOk) {
        ctx.wrap.appendChild(ui.el(doc, "p",
          t("misc.invoice_query_bad_amount", "Amount “%(amount)s” is not a plain decimal — correct it below.", { amount: qAmount }), "error"));
      }
    } else {
      ctx.wrap.appendChild(ui.el(doc, "p", t("misc.no_invoice_data_in_the_url_create_one_below", "No invoice data in the URL — create one below."), "muted"));
    }
    ctx.wrap.appendChild(ui.el(doc, "h2", t("misc.create_invoice", "Create invoice")));
    cT = ui.field(doc, t("misc.recipient", "Recipient"), { placeholder: t("misc.account_name", "account name"), value: qTo });
    cA = ui.field(doc, t("misc.asset", "Asset"), { placeholder: "BTS", value: qAsset || "BTS" });
    cN = ui.field(doc, t("misc.note_optional", "Note (optional)"), { placeholder: "", value: qMemo });
    ctx.wrap.appendChild(cT.row); ctx.wrap.appendChild(cA.row); ctx.wrap.appendChild(cN.row);
    area = doc.createElement("textarea");
    area.setAttribute("placeholder", t("misc.invoice_lines_placeholder", "coffee|1.5\ncake|2")); area.setAttribute("rows", "4");
    if (qAmount || qMemo) area.value = qAmount ? (qMemo ? qMemo + "|" + qAmount : qAmount) : "";
    ui.touchable(area); area.style.width = "100%"; ctx.wrap.appendChild(area);
    var mk = ui.touchable(ui.el(doc, "button", t("misc.make_invoice_link", "Make invoice link"))); mk.type = "button"; ctx.wrap.appendChild(mk);
    var o2 = ui.el(doc, "div"); ctx.wrap.appendChild(o2);
    mk.addEventListener("click", function () {
      if (!live(myGen, uiGen)) return; ui.clearBox(o2);
      try {
        var to = cT.input.value.trim(), asset = cA.input.value.trim() || "BTS";
        if (!to) throw new Error(t("misc.recipient_is_required", "Recipient is required."));
        var out = [];
        area.value.split("\n").forEach(function (ln, i) {
          var line = ln.trim();
          if (!line) return;
          var parts = line.split("|"), amount = (parts.length > 1 ? parts[1] : parts[0]).trim();
          if (!amount) throw new Error("Line " + (i + 1) + ": amount is required.");
          out.push({ label: parts.length > 1 ? parts[0].trim() : "", amount: amount });
        });
        if (!out.length) throw new Error(t("misc.add_at_least_one_amount_line", "Add at least one amount line."));
        var url = "#/invoice/" + Proposal.packInvoice({ to: to, asset: asset, lines: out, note: cN.input.value.trim(), id: "inv-" + Date.now() });
        var link = ui.el(doc, "a", t("misc.open_invoice", "Open invoice")); link.setAttribute("href", url); o2.appendChild(link);
        var ta = doc.createElement("textarea"); ta.value = url; ta.setAttribute("rows", "3");
        ui.touchable(ta); ta.style.width = "100%"; o2.appendChild(ta);
      } catch (e) { ui.showError(doc, o2, e, t("misc.could_not_create_the_invoice", "Could not create the invoice.")); }
    });
    /* Checkout extras (query links only — empty query keeps prior behavior).
     * Paid-watcher: one Account.history read on load + one per re-check tap
     * (no timers, no subscribe daemon). Share row: live form values rebuilt
     * into the contract URL at tap time; clipboard with execCommand fallback
     * (explorer-assets.js shareRow precedent), aria-live result. */
    if (hasQuery) {
      ctx.wrap.appendChild(ui.el(doc, "h2", t("misc.checkout_request", "Checkout request")));
      if (queryOk) {
        var wantEl = ui.el(doc, "p", "", "muted"); wantEl.setAttribute("aria-live", "polite"); ctx.wrap.appendChild(wantEl);
        var stateEl = ui.el(doc, "p", t("misc.checking_payment", "Checking payment…"), "muted");
        stateEl.setAttribute("aria-live", "polite"); ctx.wrap.appendChild(stateEl);
        var reBtn = ui.touchable(ui.el(doc, "button", t("misc.recheck_payment", "Re-check payment")));
        reBtn.type = "button"; ctx.wrap.appendChild(reBtn);
        /* One paid check: resolve the `to` account, describe the asset, then
         * Format-only human->raw for the match, then scan recent history for
         * the inbound op-0 (pair-or-object rows, tx-send.js
         * pollHistoryForTransfer precedent). Honest lines only; never throws. */
        async function checkPaid() {
          if (!live(myGen, uiGen)) return;
          reBtn.disabled = true;
          stateEl.textContent = t("misc.checking_payment", "Checking payment…");
          try {
            var acct = await Account.resolve(qTo);
            var info = await Asset.describe(qAsset);
            var expectedRaw = Format.parseAmount(qAmount, info.precision);
            wantEl.textContent = t("misc.invoice_expecting", "Expecting %(amount)s to %(to)s%(memo)s.",
              { amount: Format.formatAmount(expectedRaw, info.precision) + " " + info.symbol,
                to: acct.name + " (" + acct.id + ")",
                memo: qMemo ? " — memo contains “" + qMemo + "”" : "" });
            var rows = await Account.history(acct.id, 100);
            var list = Array.isArray(rows) ? rows : [], found = null, i;
            for (i = 0; i < list.length; i++) {
              var entry = (list[i] && list[i][1]) || list[i];
              if (!entry || !Array.isArray(entry.op) || entry.op[0] !== 0) continue;
              var d = entry.op[1] || {};
              if (String(d.to) !== String(acct.id)) continue;
              var got = d.amount || {};
              if (String(got.asset_id) !== String(info.id)) continue;
              if (String(got.amount) !== String(expectedRaw)) continue;
              if (qMemo) {
                var hay = typeof d.memo === "string" ? d.memo : JSON.stringify(d.memo || "");
                if (hay.indexOf(qMemo) === -1) continue;
              }
              found = entry; break;
            }
            if (!live(myGen, uiGen)) return;
            if (found) {
              stateEl.textContent = t("misc.invoice_paid",
                "Paid — matching inbound transfer found (block %(block)s).", { block: String(found.block_num || "?") });
            } else {
              stateEl.textContent = t("misc.invoice_unpaid",
                "Unpaid — no matching inbound transfer in the last %(n)s history events.", { n: String(list.length) });
            }
          } catch (e) {
            if (!live(myGen, uiGen)) return;
            var m = String((e && e.message) || e);
            if (m.indexOf("unknown-account") !== -1) m = t("misc.invoice_unknown_account", "unknown account “%(to)s”.", { to: qTo });
            else if (m.indexOf("unknown-asset") !== -1) m = t("misc.invoice_unknown_asset", "unknown asset “%(asset)s”.", { asset: qAsset });
            else if (m.indexOf("history-unavailable") !== -1) m = t("misc.invoice_history_unavailable", "payment history is unavailable — check Settings → Nodes and retry.");
            stateEl.textContent = t("misc.invoice_check_failed", "Could not check payment: %(msg)s", { msg: m });
          }
          if (live(myGen, uiGen)) reBtn.disabled = false;
        }
        reBtn.addEventListener("click", function () { checkPaid(); });
        if (qMemo) ctx.wrap.appendChild(ui.el(doc, "p",
          t("misc.invoice_memo_note", "Memo matching is a substring on the visible memo field — encrypted memos only match on asset + amount."), "muted"));
        checkPaid();
      }
      ctx.wrap.appendChild(ui.el(doc, "h2", t("misc.shareable_link", "Shareable link")));
      var shareTa = doc.createElement("textarea");
      shareTa.value = shareHash(qTo, qAsset || "BTS", qAmount, qMemo);
      shareTa.setAttribute("rows", "3"); shareTa.readOnly = true;
      ui.touchable(shareTa); shareTa.style.width = "100%"; ctx.wrap.appendChild(shareTa);
      var copyBtn = ui.touchable(ui.el(doc, "button", t("misc.copy_link", "Copy link"))); copyBtn.type = "button";
      var printBtn = ui.touchable(ui.el(doc, "button", t("misc.print", "Print"))); printBtn.type = "button";
      var shareNote = ui.el(doc, "span", "", "muted"); shareNote.setAttribute("aria-live", "polite");
      ctx.wrap.appendChild(copyBtn); ctx.wrap.appendChild(doc.createTextNode(" ")); ctx.wrap.appendChild(printBtn);
      ctx.wrap.appendChild(doc.createTextNode(" ")); ctx.wrap.appendChild(shareNote);
      /* First amount line of the live create form ("label|amount" or bare) —
       * the share URL always reflects what the form holds at tap time. */
      function firstFormAmount() {
        try {
          var found = "";
          String(area.value).split("\n").forEach(function (ln) {
            if (found) return;
            var line = ln.trim();
            if (!line) return;
            var parts = line.split("|"), a = (parts.length > 1 ? parts[1] : parts[0]).trim();
            if (a) found = a;
          });
          return found;
        } catch (e) { return ""; }
      }
      copyBtn.addEventListener("click", function () {
        if (!live(myGen, uiGen)) return;
        var to = cT.input.value.trim(), asset = cA.input.value.trim() || "BTS";
        var memo = cN.input.value.trim(), amt = firstFormAmount();
        if (!to || !amt) {
          shareNote.textContent = t("misc.share_needs_to_amount", "A shareable link needs a recipient and at least one amount line.");
          return;
        }
        var hash = shareHash(to, asset, amt, memo), url = hash;
        try {
          if (typeof location !== "undefined" && location.href) url = location.href.split("#")[0] + hash;
        } catch (e) { url = hash; }
        shareTa.value = url;
        copyBtn.disabled = true;
        shareNote.textContent = t("misc.copying", "Copying…");
        function done(ok) {
          if (!live(myGen, uiGen)) return;
          copyBtn.disabled = false;
          shareNote.textContent = ok ? t("misc.copied", "Copied")
            : t("misc.copy_failed_select_manually", "Copy failed — select the link manually");
        }
        function fallback() {
          try {
            var ta = doc.createElement("textarea");
            ta.value = url; doc.body.appendChild(ta); ta.select();
            var ok = false;
            try { ok = doc.execCommand("copy"); } catch (e) { ok = false; }
            try { ta.parentNode.removeChild(ta); } catch (e2) { /* gone */ }
            done(!!ok);
          } catch (e) { done(false); }
        }
        try {
          if (typeof navigator !== "undefined" && navigator.clipboard &&
              typeof navigator.clipboard.writeText === "function") {
            navigator.clipboard.writeText(url).then(function () { done(true); }, function () { fallback(); });
          } else fallback();
        } catch (e) { fallback(); }
      });
      printBtn.addEventListener("click", function () {
        try { if (typeof window !== "undefined" && typeof window.print === "function") window.print(); } catch (e) { /* dialog stands */ }
      });
      ctx.wrap.appendChild(ui.el(doc, "p",
        t("misc.invoice_no_qr", "No QR code is shown: a hand-rolled QR encoder is a Reed-Solomon project with no small licensed library vendored — copy or print the link instead."), "muted"));
    }
  }

  return { renderAuthorities: renderAuthorities, renderLists: renderLists, renderInvoice: renderInvoice };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.MiscUI === "undefined") { globalThis.MiscUI = MiscUI; }
if (typeof module !== "undefined") { module.exports = MiscUI; }
