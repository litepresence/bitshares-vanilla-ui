/* ExplorerTabs: the six ref-parity explorer tabs (pools, accounts, witnesses,
 * committee, markets, fees) — #1 Explorer.jsx:18-64 has eight tabs
 * (blocks/assets/pools/accounts/witnesses/committee/markets/fees); vanilla
 * already owned blocks/assets (+feeds extra, kept as documented superset).
 * Owns: tab body renderers only — poolsTab/accountsTab/witnessesTab/
 *   committeeTab/marketsTab/feesTab(doc, body, root, myGen). Shell
 *   (search/tabs/head/object panel) stays in explorer-ui.js, which
 *   dispatches here by tab id (lazy globals, same pattern as
 *   ExplorerBlocks/ExplorerAssets). No signing, no storage.
 * Consumes: Pool.list (pool rows), Chain (lookup_accounts, get_top_markets),
 *   Asset.describe (market symbols, fail-open per row), Vote.lists
 *   (witness/committee entries), AssetFeedUI.feeSection (fee table),
 *   ExplorerUI gen guard via isCurrent callback passed by the shell —
 *   callers pass a live() closure, never the counter. Side effects: DOM
 *   under the given body only; global ExplorerTabs only.
 * Reads stay public (no unlock gates anywhere here — principle #9).
 * Created by: building-vanilla-slices skill, explorer-tabs plan. */
var ExplorerTabs = (function () {
  "use strict";

  /* Batch-3 i18n (slice-17 precedent): display strings resolve via I18n.t with
   * the pre-conversion literal kept verbatim as enDefault (English-identical
   * on any transport, incl. file:// where dict fetch fails). Falls back to
   * the default when i18n.js failed to load: never blank, never throws. */
  function t(key, dflt) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt);
    } catch (e) { /* default below */ }
    return dflt;
  }

  /* Local element helpers (textContent-only; per-file copies per doctrine
   * rule 5 — WHY: no shared-DOM-util module may grow inside vanilla/). */
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function touchable(n) {
    try { n.style.minHeight = "44px"; } catch (e) { /* native stands */ }
    return n;
  }
  function link(doc, href, text) {
    var a = doc.createElement("a");
    a.setAttribute("href", href);
    a.textContent = text;
    touchable(a);
    return a;
  }
  function errBox(doc, body, msg) {
    var p = el(doc, "p", msg, "error");
    p.setAttribute("aria-live", "polite");
    body.appendChild(p);
    return p;
  }
  function table(doc, heads) {
    var t = doc.createElement("table");
    t.className = "node-table";
    var thead = doc.createElement("thead"), hr = doc.createElement("tr");
    heads.forEach(function (h) { hr.appendChild(el(doc, "th", h)); });
    thead.appendChild(hr);
    t.appendChild(thead);
    var tb = doc.createElement("tbody");
    t.appendChild(tb);
    return { table: t, tbody: tb };
  }

  /* poolsTab: first 20 pools (id/share/legs) + desk link. */
  function poolsTab(doc, body, live) {
    if (typeof Pool === "undefined" || !Pool || typeof Pool.list !== "function") {
      errBox(doc, body, "Pool backend missing: js/pool.js failed to load.");
      return;
    }
    body.appendChild(el(doc, "p", "Loading pools…", "muted"));
    Pool.list({ limit: 20 }).then(function (rows) {
      if (!live()) return;
      while (body.firstChild) body.removeChild(body.firstChild);
      if (!rows || !rows.length) {
        body.appendChild(el(doc, "p", "No pools found.", "muted"));
        return;
      }
      var t = table(doc, ["Pool", "Share", "Asset A", "Asset B"]);
      rows.forEach(function (r) {
        var tr = doc.createElement("tr");
        var td = doc.createElement("td");
        td.appendChild(link(doc, "#/pools/" + r.id, r.id));
        tr.appendChild(td);
        tr.appendChild(el(doc, "td", r.sym_share || r.share_id || "—"));
        tr.appendChild(el(doc, "td", r.sym_a || r.asset_a_id || "—"));
        tr.appendChild(el(doc, "td", r.sym_b || r.asset_b_id || "—"));
        t.tbody.appendChild(tr);
      });
      body.appendChild(t.table);
      var p = el(doc, "p", null, "muted");
      p.appendChild(link(doc, "#/pools", "Open the pools desk →"));
      body.appendChild(p);
    }).catch(function (e) {
      if (!live()) return;
      while (body.firstChild) body.removeChild(body.firstChild);
      errBox(doc, body, (e && e.message) || "Could not load pools.");
    });
  }

  /* accountsTab: prefix search via lookup_accounts -> name links. */
  function accountsTab(doc, body, live) {
    var form = doc.createElement("form");
    var input = doc.createElement("input");
    input.type = "search";
    input.setAttribute("placeholder", "Account name prefix…");
    input.setAttribute("aria-label", "Search accounts by name prefix");
    touchable(input);
    form.appendChild(input);
    var go = touchable(el(doc, "button", "Search"));
    go.type = "submit";
    form.appendChild(go);
    body.appendChild(form);
    var out = doc.createElement("div");
    body.appendChild(out);
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      while (out.firstChild) out.removeChild(out.firstChild);
      var q = String(input.value || "").trim().toLowerCase();
      if (!q) return;
      out.appendChild(el(doc, "p", "Searching…", "muted"));
      Chain.db().then(function (dbId) {
        return Chain.call(dbId, "lookup_accounts", [q, 20]);
      }).then(function (names) {
        if (!live()) return;
        while (out.firstChild) out.removeChild(out.firstChild);
        if (!names || !names.length) {
          out.appendChild(el(doc, "p", "No accounts found.", "muted"));
          return;
        }
        var ul = doc.createElement("ul");
        names.forEach(function (nm) {
          var li = doc.createElement("li");
          li.appendChild(link(doc, "#/account/" + encodeURIComponent(nm), nm));
          ul.appendChild(li);
        });
        out.appendChild(ul);
      }).catch(function (e) {
        if (!live()) return;
        while (out.firstChild) out.removeChild(out.firstChild);
        errBox(doc, out, (e && e.message) || "Account search failed.");
      });
    });
  }

  /* memberTab: shared witness/committee table (name/account/active/link).
   * Vote weights are raw stake ints — intentionally NOT shown here (principle
   * #6: the voting page owns human weight math; this summary links there).
   * LOW punchlist: thin-summary honesty — the scope line below names the
   * full page for weights and slates. Batch-3 i18n: keyed. */
  function memberTab(doc, body, live, kind) {
    var isWit = kind === "witnesses";
    if (typeof Vote === "undefined" || !Vote || typeof Vote.lists !== "function") {
      errBox(doc, body, "Voting backend missing: js/vote.js failed to load.");
      return;
    }
    body.appendChild(el(doc, "p", "Loading " + kind + "…", "muted"));
    Vote.lists().then(function (all) {
      if (!live()) return;
      while (body.firstChild) body.removeChild(body.firstChild);
      var rows = (isWit ? all.witnesses : all.committee) || [];
      if (!rows.length) {
        body.appendChild(el(doc, "p", "No " + kind + " found.", "muted"));
        return;
      }
      var tbl = table(doc, ["Name", "Account", "Active"]);
      rows.slice(0, 50).forEach(function (m) {
        var tr = doc.createElement("tr");
        var td = doc.createElement("td");
        td.appendChild(link(doc, "#/account/" + encodeURIComponent(m.name || m.account_id), m.name || m.account_id));
        tr.appendChild(td);
        tr.appendChild(el(doc, "td", m.account_id || "—"));
        tr.appendChild(el(doc, "td", m.active ? "yes" : "—"));
        tbl.tbody.appendChild(tr);
      });
      body.appendChild(tbl.table);
      var p = el(doc, "p", null, "muted");
      p.appendChild(link(doc, "#/voting", "Open voting for weights and slates →"));
      body.appendChild(p);
      body.appendChild(el(doc, "p", t("explorer.thin_summary_top_50_names_and_activity", "Thin summary (top 50, names and activity only) — weights and publishing live on the voting page."), "muted"));
    }).catch(function (e) {
      if (!live()) return;
      while (body.firstChild) body.removeChild(body.firstChild);
      errBox(doc, body, (e && e.message) || ("Could not load " + kind + "."));
    });
  }
  function witnessesTab(doc, body, live) { memberTab(doc, body, live, "witnesses"); }
  function committeeTab(doc, body, live) { memberTab(doc, body, live, "committee"); }

  /* marketsTab: top markets by volume (database get_top_markets, :643).
   * Symbols resolve fail-open per row (id fallback, row never drops the
   * volume the chain reported). */
  function marketsTab(doc, body, live) {
    body.appendChild(el(doc, "p", "Loading top markets…", "muted"));
    Chain.db().then(function (dbId) {
      return Chain.call(dbId, "get_top_markets", [20]);
    }).then(function (rows) {
      if (!live()) return;
      while (body.firstChild) body.removeChild(body.firstChild);
      if (!rows || !rows.length) {
        body.appendChild(el(doc, "p", "No markets found.", "muted"));
        return;
      }
      var pend = rows.slice(0, 20).map(function (m) {
        return { m: m, quote: null, base: null };
      });
      function sym(id) {
        if (typeof Asset !== "undefined" && Asset && typeof Asset.describe === "function") {
          return Asset.describe(id).then(function (a) { return a.symbol; }).catch(function () { return String(id); });
        }
        return Promise.resolve(String(id));
      }
      var jobs = [];
      pend.forEach(function (r) {
        jobs.push(sym(r.m.quote).then(function (s) { r.quote = s; }));
        jobs.push(sym(r.m.base).then(function (s) { r.base = s; }));
      });
      return Promise.all(jobs).then(function () {
        if (!live()) return;
        var tbl = table(doc, ["Market", "Price", "Volume", "Change"]);
        pend.forEach(function (r) {
          var tr = doc.createElement("tr");
          var td = doc.createElement("td");
          var id = r.quote + "_" + r.base;
          var a = link(doc, "#/market/" + encodeURIComponent(id), id);
          td.appendChild(a);
          tr.appendChild(td);
          tr.appendChild(el(doc, "td", r.m.latest !== undefined && r.m.latest !== null ? String(r.m.latest) : "—"));
          tr.appendChild(el(doc, "td", r.m.base_volume !== undefined && r.m.base_volume !== null ? String(r.m.base_volume) : "—"));
          tr.appendChild(el(doc, "td", r.m.percent_change !== undefined && r.m.percent_change !== null ? String(r.m.percent_change) : "—"));
          tbl.tbody.appendChild(tr);
        });
        body.appendChild(tbl.table);
        body.appendChild(el(doc, "p", t("explorer.thin_summary_top_20_by_volume_full_orde", "Thin summary (top 20 by volume) — full order books, charts and trading live on each market page."), "muted"));
      });
    }).catch(function (e) {
      if (!live()) return;
      while (body.firstChild) body.removeChild(body.firstChild);
      errBox(doc, body, (e && e.message) || "Could not load top markets.");
    });
  }

  /* feesTab: the SAME shared fee table #/fees embeds (no fork). */
  function feesTab(doc, body, live) {
    void live;
    if (typeof AssetFeedUI !== "undefined" && AssetFeedUI &&
        typeof AssetFeedUI.feeSection === "function") {
      try {
        AssetFeedUI.feeSection(doc, body);
      } catch (e) {
        errBox(doc, body, (e && e.message) || "Could not load fees.");
        return;
      }
      var p = el(doc, "p", null, "muted");
      p.appendChild(link(doc, "#/fees", "Open the full fee schedule →"));
      body.appendChild(p);
    } else {
      errBox(doc, body, "Fee backend missing: js/asset-feed-ui.js failed to load.");
    }
  }

  return {
    poolsTab: poolsTab, accountsTab: accountsTab,
    witnessesTab: witnessesTab, committeeTab: committeeTab,
    marketsTab: marketsTab, feesTab: feesTab
  };
})();

if (typeof globalThis !== "undefined" && typeof globalThis.ExplorerTabs === "undefined") { globalThis.ExplorerTabs = ExplorerTabs; }
if (typeof module !== "undefined") { module.exports = ExplorerTabs; }
