/* top-ops-ui.js — R1c ranked-operations page (#/top-ops): bounded chain-scan edition.
 * Owns: #/top-ops — counts operation types across the N=200 most recent blocks
 *   read live from the connected node (Chain.db/call get_dynamic_global_properties
 *   for the head, then get_block per height in CHUNK-wide waves over the one
 *   shared socket), renders a type/name/count/% table plus a hand-rolled SVG
 *   donut (arc math below, no chart lib), a Refresh button, and an honest
 *   "last 200 blocks on <node>" label with a testnet-works note.
 * Consumes: Chain.db/.call/.status (sole socket owner — no new WS surface),
 *   Store (connection subscribe for auto-reconnect), Format.pct1 (the ONLY
 *   percent formatter — 1-decimal integer math, never float), I18n.t (guarded).
 *   No wallet, no signing, no broadcasts. Virtual op ids are counted by id and
 *   labeled "(virtual)" — never signed, shown with a marker only.
 * Globals/side effects: DOM under root only; global TopOpsUI. Generation
 *   counter tears down stale async work on route change (ops-ui.js pattern).
 * Refs: astro-ui/src/pages/top-operations.astro + BlockchainTopOperations.jsx
 *   (table columns Type/Name/Quantity/% + Refresh + donut grouping <1% as Other
 *   — shape reference only, NO code, NO recharts) + nanoeffects/TopOperations.ts
 *   (off-chain POST https://es.bitshares.dev — DELIBERATELY NOT copied: an
 *   external Elasticsearch proxy is a dependency and fails the §4.5 anti-rot
 *   gate; vanilla walks 200 blocks on-chain instead. Unlike astro, which is
 *   mainnet-only, this page works on testnet too);
 *   #4 database_api.hpp:182 (get_block), :229 (get_dynamic_global_properties);
 *   vanilla/js/explorer.js:26-48 (OP_NAMES + VIRTUAL source — value-copied
 *   below with provenance; explorer.js does not export the table).
 * Created by: R1c part-1 ranked-ops task (bounded chain-scan, doctrine-refused ES).
 */
var TopOpsUI = (function () {
  "use strict";

  var N = 200; /* fixed R1c sample: the last 200 blocks, no size control */
  var CHUNK = 25; /* parallel block-fetch width (one shared socket) */
  var CONNECT_TIMEOUT_MS = 15000; /* slice-1 offline pattern */
  var MAX_SLICES = 8; /* donut shows top 8 + Other (astro groups <1%; same idea) */
  var gen = 0;

  /* Batch i18n: display strings resolve via I18n.t with the pre-conversion
   * literal kept verbatim as enDefault (English-identical on any transport,
   * incl. file:// where dict fetch fails). Falls back to the default when
   * i18n.js failed to load: never blank, never throws. */
  function t(key, dflt, vars) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt, vars);
    } catch (e) { /* default below */ }
    return dflt;
  }

  /* Op index -> short name, FC_REFLECT order <- operations.hpp:56-133.
   * PROVENANCE: value-copy of the OP_NAMES table in vanilla/js/explorer.js
   * (lines 26-48), which cites bitshares-core operations.hpp:56-133. Copied
   * (not imported) because explorer.js does not export the table; any future
   * op added to the chain appears here as "unknown" via opLabel, never a
   * throw — same never-break-reads contract as Explorer._opRef. */
  var OP_NAMES = ["transfer", "limit_order_create", "limit_order_cancel", "call_order_update",
    "fill_order", "account_create", "account_update", "account_whitelist", "account_upgrade",
    "account_transfer", "asset_create", "asset_update", "asset_update_bitasset",
    "asset_update_feed_producers", "asset_issue", "asset_reserve", "asset_fund_fee_pool",
    "asset_settle", "asset_global_settle", "asset_publish_feed", "witness_create",
    "witness_update", "proposal_create", "proposal_update", "proposal_delete",
    "withdraw_permission_create", "withdraw_permission_update", "withdraw_permission_claim",
    "withdraw_permission_delete", "committee_member_create", "committee_member_update",
    "committee_member_update_global_parameters", "vesting_balance_create",
    "vesting_balance_withdraw", "worker_create", "custom", "assert", "balance_claim",
    "override_transfer", "transfer_to_blind", "blind_transfer", "transfer_from_blind",
    "asset_settle_cancel", "asset_claim_fees", "fba_distribute", "bid_collateral",
    "execute_bid", "asset_claim_pool", "asset_update_issuer", "htlc_create", "htlc_redeem",
    "htlc_redeemed", "htlc_extend", "htlc_refund", "custom_authority_create",
    "custom_authority_update", "custom_authority_delete", "ticket_create", "ticket_update",
    "liquidity_pool_create", "liquidity_pool_delete", "liquidity_pool_deposit",
    "liquidity_pool_withdraw", "liquidity_pool_exchange", "samet_fund_create",
    "samet_fund_delete", "samet_fund_update", "samet_fund_borrow", "samet_fund_repay",
    "credit_offer_create", "credit_offer_delete", "credit_offer_update",
    "credit_offer_accept", "credit_deal_repay", "credit_deal_expired",
    "liquidity_pool_update", "credit_deal_update", "limit_order_update"];
  /* PROVENANCE: value-copy of the VIRTUAL set in vanilla/js/explorer.js:48
   * (virtual execution events — never signed, shown with a marker only). */
  var VIRTUAL = { 4: 1, 42: 1, 44: 1, 46: 1, 51: 1, 53: 1, 74: 1 };

  /* opLabel: display name + virtual flag for an op index. Params: idx
   *   (number). Returns {name, virtual}. Unknown indexes yield "unknown"
   *   (never throw — a future op must not break this page). */
  function opLabel(idx) {
    if (idx >= 0 && idx < OP_NAMES.length) {
      return { name: OP_NAMES[idx], virtual: !!VIRTUAL[idx] };
    }
    return { name: "unknown", virtual: false };
  }

  /* Donut arc math (hand-rolled, no chart lib — presentation geometry only,
   * never money, so binary float here is fine; percents stay in Format.pct1).
   * Angles in degrees, 0 = top, clockwise. */

  /* n3: path-number rounding (3 decimals keeps d attributes short).
   * Params: x (number). Returns a Number. Fails: never. */
  function n3(x) {
    return Math.round(x * 1000) / 1000;
  }

  /* polar: point on a circle. Params: cx, cy, r, angleDeg. Returns {x, y}. */
  function polar(cx, cy, r, angleDeg) {
    var rad = (angleDeg - 90) * Math.PI / 180;
    return { x: n3(cx + r * Math.cos(rad)), y: n3(cy + r * Math.sin(rad)) };
  }

  /* ringWedge: SVG path d for a donut wedge. Params: cx, cy, rOuter, rInner,
   *   startDeg, endDeg. Returns the d string; "" when the span is not
   *   positive; a full ring (two half-arcs per radius) when span >= 360.
   *   Fails: never throws (non-numbers yield ""). */
  function ringWedge(cx, cy, rOuter, rInner, startDeg, endDeg) {
    var s = Number(startDeg), e = Number(endDeg);
    if (!isFinite(s) || !isFinite(e) || !(e > s)) return "";
    var span = e - s;
    function pt(r, a) { return polar(cx, cy, r, a); }
    if (span >= 360) {
      var top = pt(rOuter, s), bot = pt(rOuter, s + 180);
      var itop = pt(rInner, s), ibot = pt(rInner, s + 180);
      return "M" + top.x + " " + top.y +
        " A" + rOuter + " " + rOuter + " 0 1 1 " + bot.x + " " + bot.y +
        " A" + rOuter + " " + rOuter + " 0 1 1 " + top.x + " " + top.y + " Z" +
        " M" + itop.x + " " + itop.y +
        " A" + rInner + " " + rInner + " 0 1 0 " + ibot.x + " " + ibot.y +
        " A" + rInner + " " + rInner + " 0 1 0 " + itop.x + " " + itop.y + " Z";
    }
    var o1 = pt(rOuter, s), o2 = pt(rOuter, e);
    var i1 = pt(rInner, e), i2 = pt(rInner, s);
    var large = span > 180 ? 1 : 0;
    return "M" + o1.x + " " + o1.y +
      " A" + rOuter + " " + rOuter + " 0 " + large + " 1 " + o2.x + " " + o2.y +
      " L" + i1.x + " " + i1.y +
      " A" + rInner + " " + rInner + " 0 " + large + " 0 " + i2.x + " " + i2.y + " Z";
  }

  /* sliceSpans: counts -> angular spans. Params: rows (sorted desc
   *   [{idx, count}]), total (op count). Returns [{idx, count, startDeg,
   *   endDeg}] with the first MAX_SLICES rows kept and the tail folded into
   *   one {idx: -1 (Other), count} slice; empty input yields []. Fails: never
   *   (zero total yields [] — the caller paints the empty state). */
  function sliceSpans(rows, total) {
    if (!(total > 0) || !rows || rows.length === 0) return [];
    var major = rows.slice(0, MAX_SLICES);
    var rest = rows.slice(MAX_SLICES);
    if (rest.length > 0) {
      var other = 0, r;
      for (r = 0; r < rest.length; r++) other += rest[r].count;
      major.push({ idx: -1, count: other });
    }
    var out = [], angle = 0, i;
    for (i = 0; i < major.length; i++) {
      var span = (major[i].count / total) * 360;
      out.push({ idx: major[i].idx, count: major[i].count, startDeg: angle, endDeg: angle + span });
      angle += span;
    }
    return out;
  }

  /* Donut slice fills: theme tokens only (no hex literals — all three themes
   * keep working). Applied via style.fill (presentation attributes do not
   * resolve var()). "Other" always takes --muted. */
  var SLICE_FILLS = ["var(--accent)", "var(--buy)", "var(--sell)", "var(--warn)",
    "var(--live)", "var(--button-bg)", "var(--danger)", "var(--accent)"];
  var OTHER_FILL = "var(--muted)";

  /* shortHost: wss:// URL -> bare host (footer parity, app.js shortHost).
   * Params: url string. Returns host or "". Fails: never throws. */
  function shortHost(url) {
    try {
      var m = /^wss?:\/\/([^/]+)/.exec(String(url || ""));
      return m ? m[1] : "";
    } catch (e) { return ""; }
  }

  /* textContent-only element (chain strings never reach HTML). */
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  /* Touch floor (principle #7): interactive elements >= 44px one dimension. */
  function touchable(n) { n.style.minHeight = "44px"; return n; }
  function clearRoot(root) { while (root.firstChild) root.removeChild(root.firstChild); }
  function makeWrap(doc, root) {
    var w = doc.createElement("div"); w.className = "wrap"; root.appendChild(w); return w;
  }
  /* Inline error panel, never blank. */
  function showError(doc, wrap, e, fallback) {
    var msg = (e && typeof e.message === "string" && e.message) ? e.message : String(e || fallback || "Unexpected error");
    if (msg.indexOf("not connected") !== -1 || msg.indexOf("not-connected") !== -1) {
      msg = t("topops.offline", "Network unavailable. Check Settings → Nodes and retry.");
    }
    var box = el(doc, "div", msg, "error");
    box.setAttribute("aria-live", "polite"); wrap.appendChild(box); return box;
  }
  function showStatus(doc, wrap, text) {
    var p = el(doc, "p", text, "muted");
    p.setAttribute("aria-live", "polite"); wrap.appendChild(p); return p;
  }

  /* Connect gate (ops-ui.js pattern): cold socket paints a connecting panel
   * with Retry and auto-reruns once on open (gen-guarded, hash-checked);
   * times out into the same panel with Retry. Returns true when the caller
   * must stop (waiting UI already shown). */
  function waitForOpen(doc, wrap, root, myGen, rerun) {
    if (typeof Chain !== "undefined" && Chain && typeof Chain.status === "function" &&
        Chain.status().state === "open") return false;
    showStatus(doc, wrap, t("topops.loading", "Reading the last 200 blocks…"));
    var tostat = showStatus(doc, wrap, "");
    var torow = el(doc, "div", null, "pools-offline-row");
    wrap.appendChild(torow);
    var retry = touchable(el(doc, "button", t("topops.retry", "Retry")));
    retry.type = "button"; torow.appendChild(retry);
    var tooff = null;
    try { tooff = (typeof Offline !== "undefined" && Offline) ? Offline : null; } catch (e) { tooff = null; }
    var torerun = function () {
      if (!settled) { settled = true; try { off(); } catch (e) { /* gone */ } clearTimeout(timer); }
      if (myGen === gen) rerun();
    };
    if (tooff && typeof tooff.wire === "function") {
      try { tooff.wire(retry, tostat, torerun, t); } catch (e) { retry.addEventListener("click", torerun); }
    } else {
      retry.addEventListener("click", torerun);
    }
    var tolink = null;
    if (tooff && typeof tooff.settingsLink === "function") {
      try { tolink = tooff.settingsLink(doc, t); } catch (e) { tolink = null; }
    }
    if (!tolink) {
      tolink = el(doc, "a", t("notice.open_settings", "Open Settings"));
      try { tolink.setAttribute("href", "#/settings"); } catch (e) { /* label stands */ }
      touchable(tolink);
    }
    torow.appendChild(tolink);
    var hashAtEntry = (typeof location !== "undefined" && location.hash) || "";
    var settled = false, off = function () {};
    if (typeof Store !== "undefined" && Store && typeof Store.subscribe === "function") {
      off = Store.subscribe("connection", function (st) {
        if (settled || myGen !== gen) return;
        if (st && st.state === "open") {
          settled = true; try { off(); } catch (e) { /* listener already gone */ }
          clearTimeout(timer);
          if (typeof location === "undefined" || location.hash === hashAtEntry) rerun();
        }
      });
    }
    var timer = setTimeout(function () {
      if (settled || myGen !== gen) return;
      settled = true; try { off(); } catch (e) { /* listener already gone */ }
    }, CONNECT_TIMEOUT_MS);
    /* Automated handshake on entry (shared Offline helper owns the throttle;
     * Retry is wired via Offline.wire above). */
    try { if (typeof Offline !== "undefined" && Offline && typeof Offline.ensure === "function") Offline.ensure(); } catch (e) { /* wait above covers */ }
    return true;
  }

  /* scanRange: head read + N get_block fetches in CHUNK-wide parallel waves
   * over the one shared socket (unbounded fan-out stalls it). Params: myGen
   * (generation). Returns {counts, total, txs, lo, head, node, skipped} with
   * blocks in any fetch order (counts are order-free); skipped = heights the
   * node would not serve (logged as a note, never a throw — one missing block
   * must not blank the page). Stale generations bail between waves (null). */
  async function scanRange(myGen) {
    var dbId = await Chain.db();
    var props = await Chain.call(dbId, "get_dynamic_global_properties", []);
    var head = props && props.head_block_number;
    if (!Number.isSafeInteger(head) || head <= 0) throw new Error("bad head block number");
    var lo = Math.max(1, head - N + 1), heights = [], h;
    for (h = lo; h <= head; h++) heights.push(h);
    var counts = {}, total = 0, txs = 0, skipped = 0, i, k;
    for (i = 0; i < heights.length; i += CHUNK) {
      if (myGen !== gen) return null;
      var wave = heights.slice(i, i + CHUNK);
      var rows = await Promise.all(wave.map(function (hh) {
        return Chain.call(dbId, "get_block", [hh]).then(function (b) { return b; }).catch(function () { return null; });
      }));
      for (k = 0; k < rows.length; k++) {
        var blk = rows[k];
        if (!blk || !Array.isArray(blk.transactions)) { skipped += 1; continue; }
        txs += blk.transactions.length;
        var ti, oi;
        for (ti = 0; ti < blk.transactions.length; ti++) {
          var ops = Array.isArray(blk.transactions[ti].operations) ? blk.transactions[ti].operations : [];
          for (oi = 0; oi < ops.length; oi++) {
            var o = ops[oi], idx;
            if (Array.isArray(o)) idx = o[0];
            else if (o && typeof o.type !== "undefined") idx = o.type;
            else continue;
            idx = parseInt(idx, 10);
            if (!(idx >= 0)) continue;
            counts[idx] = (counts[idx] || 0) + 1;
            total += 1;
          }
        }
      }
    }
    if (myGen !== gen) return null;
    var node = "";
    try { node = (Chain.status() && Chain.status().node) || ""; } catch (e) { node = ""; }
    return { counts: counts, total: total, txs: txs, lo: lo, head: head, node: node, skipped: skipped };
  }

  /* renderDonut: hand-rolled SVG donut + legend. Params: doc, wrap, rows
   * (sorted desc [{idx, count}]), total. Donut shows top MAX_SLICES + Other;
   * every share string comes from Format.pct1 (the table reuses the same
   * formatter — one percent path). SVG is presentation-only: role="img" +
   * aria-label, and the table below carries the same data as text. */
  function renderDonut(doc, wrap, rows, total) {
    var spans = sliceSpans(rows, total);
    if (spans.length === 0) return;
    var box = el(doc, "div", null, "topops-layout");
    var NS = "http://www.w3.org/2000/svg";
    var svg = doc.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 200 200");
    svg.setAttribute("class", "topops-donut");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", t("topops.chart_aria", "Donut chart of operation shares. Tabular data follows."));
    var ci = 0, s;
    for (s = 0; s < spans.length; s++) {
      var d = ringWedge(100, 100, 90, 55, spans[s].startDeg, spans[s].endDeg);
      if (!d) continue;
      var path = doc.createElementNS(NS, "path");
      path.setAttribute("d", d);
      try {
        path.style.fill = (spans[s].idx === -1) ? OTHER_FILL : SLICE_FILLS[ci++ % SLICE_FILLS.length];
        path.style.stroke = "var(--panel)";
        path.style.strokeWidth = "1";
      } catch (e) { /* unstyled wedges stand */ }
      var lab = spans[s].idx === -1 ? { name: t("topops.other", "Other"), virtual: false } : opLabel(spans[s].idx);
      try {
        var title = doc.createElementNS(NS, "title");
        title.textContent = lab.name + ": " + spans[s].count + " (" + Format.pct1(spans[s].count, total) + ")";
        path.appendChild(title);
      } catch (e) { /* title is decorative */ }
      svg.appendChild(path);
    }
    box.appendChild(svg);
    var legend = el(doc, "ul", null, "topops-legend");
    ci = 0;
    for (s = 0; s < spans.length; s++) {
      var lab2 = spans[s].idx === -1 ? { name: t("topops.other", "Other"), virtual: false } : opLabel(spans[s].idx);
      var li = doc.createElement("li");
      var sw = el(doc, "span", "", "topops-sw");
      sw.setAttribute("aria-hidden", "true");
      try {
        sw.style.background = (spans[s].idx === -1) ? OTHER_FILL : SLICE_FILLS[ci++ % SLICE_FILLS.length];
      } catch (e) { /* swatch stands unfilled */ }
      li.appendChild(sw);
      var nm = spans[s].idx === -1 ? lab2.name : (spans[s].idx + ": " + lab2.name + (lab2.virtual ? " (virtual)" : ""));
      li.appendChild(el(doc, "span", nm + " — " + spans[s].count + " (" + Format.pct1(spans[s].count, total) + ")"));
      legend.appendChild(li);
    }
    box.appendChild(legend);
    wrap.appendChild(box);
  }

  /* renderTable: sorted op-count table with Format.pct1 shares. Params: doc,
   * wrap, rows (sorted desc), total. Dense .node-table (theme-aware) inside
   * the shared .ops-scroll region (principle #7 — phones scroll, never clip). */
  function renderTable(doc, wrap, rows, total) {
    if (rows.length === 0) {
      wrap.appendChild(el(doc, "p", t("topops.empty", "No operations in the last 200 blocks — retry at the chain tip."), "muted"));
      return;
    }
    var scroller = el(doc, "div", null, "ops-scroll");
    scroller.style.overflowX = "auto";
    var table = doc.createElement("table");
    table.className = "node-table";
    var thead = doc.createElement("thead"), hr = doc.createElement("tr");
    ["Type", "Operation", "Count", "Share"].forEach(function (h) { hr.appendChild(el(doc, "th", h)); });
    thead.appendChild(hr); table.appendChild(thead);
    var tb = doc.createElement("tbody");
    rows.forEach(function (r) {
      var lab = opLabel(r.idx);
      var tr = doc.createElement("tr");
      var tdT = el(doc, "td", String(r.idx));
      tdT.style.whiteSpace = "nowrap"; tr.appendChild(tdT);
      tr.appendChild(el(doc, "td", lab.name + (lab.virtual ? " (virtual)" : "")));
      var tdC = el(doc, "td", String(r.count));
      tdC.style.textAlign = "right"; tdC.style.whiteSpace = "nowrap"; tr.appendChild(tdC);
      var tdP = el(doc, "td", Format.pct1(r.count, total));
      tdP.style.textAlign = "right"; tdP.style.whiteSpace = "nowrap"; tr.appendChild(tdP);
      tb.appendChild(tr);
    });
    table.appendChild(tb); scroller.appendChild(table); wrap.appendChild(scroller);
  }

  /* Route entry #/top-ops: honest scope + testnet notes, Refresh, then the
   * bounded head→N scan. Offline renders Retry + auto-reruns on reconnect
   * (waitForOpen above, gen-guarded). */
  function renderTopOps(root) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    var myGen = ++gen;
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    if (typeof Chain === "undefined" || !Chain ||
        typeof Chain.db !== "function" || typeof Chain.call !== "function" ||
        typeof Format === "undefined" || !Format || typeof Format.pct1 !== "function") {
      wrap.appendChild(el(doc, "h1", t("topops.title", "Top Operations")));
      showError(doc, wrap, "Chain backend missing: js/chain.js or js/format.js failed to load.");
      return;
    }
    wrap.appendChild(el(doc, "h1", t("topops.title", "Top Operations")));
    wrap.appendChild(el(doc, "p",
      t("topops.scope", "Last 200 blocks on this node — a live sample, not a chain-wide ranking."),
      "muted"));
    wrap.appendChild(el(doc, "p",
      t("topops.testnet", "Works on testnet and mainnet (unlike the reference index, which is mainnet-only)."),
      "muted"));
    var refresh = touchable(el(doc, "button", t("topops.refresh", "Refresh")));
    refresh.type = "button";
    refresh.addEventListener("click", function () { if (myGen === gen) renderTopOps(root); });
    wrap.appendChild(refresh);
    if (waitForOpen(doc, wrap, root, myGen, function () { renderTopOps(root); })) return;
    var status = showStatus(doc, wrap, t("topops.loading", "Reading the last 200 blocks…"));
    scanRange(myGen).then(function (res) {
      if (myGen !== gen || !res) return;
      status.textContent = "";
      var host = shortHost(res.node) || res.node || "this node";
      wrap.appendChild(el(doc, "p",
        t("topops.sample", "Sample: blocks %(lo)s–%(hi)s (%(blocks)s blocks, %(txs)s transactions, %(total)s operations) on %(node)s.", {
          lo: String(res.lo), hi: String(res.head),
          blocks: String(res.head - res.lo + 1 - res.skipped),
          txs: String(res.txs), total: String(res.total), node: host
        }),
        "muted"));
      if (res.skipped > 0) {
        wrap.appendChild(el(doc, "p",
          t("topops.skipped", " — %(n)s block(s) unreadable, skipped.", { n: String(res.skipped) }),
          "muted"));
      }
      var rows = Object.keys(res.counts).map(function (k) {
        return { idx: parseInt(k, 10), count: res.counts[k] };
      });
      rows.sort(function (a, b) { return b.count - a.count; });
      renderDonut(doc, wrap, rows, res.total);
      renderTable(doc, wrap, rows, res.total);
      var more = el(doc, "p", null, "muted");
      var a = doc.createElement("a");
      a.href = "#/explorer"; a.textContent = t("topops.back", "Back to Explorer");
      touchable(a); a.style.display = "inline-block";
      more.appendChild(a); wrap.appendChild(more);
    }).catch(function (e) {
      if (myGen !== gen) return;
      status.textContent = "";
      showError(doc, wrap, e, "Could not sample recent blocks.");
      var retry = touchable(el(doc, "button", t("topops.retry", "Retry")));
      retry.type = "button";
      retry.addEventListener("click", function () { if (myGen === gen) renderTopOps(root); });
      wrap.appendChild(retry);
    });
  }

  return { renderTopOps: renderTopOps,
    _test: { N: N, MAX_SLICES: MAX_SLICES, opLabel: opLabel, polar: polar,
      ringWedge: ringWedge, sliceSpans: sliceSpans, shortHost: shortHost } };
})();

if (typeof module !== "undefined") { module.exports = TopOpsUI; }
