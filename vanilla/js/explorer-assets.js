/* ExplorerAssets: asset views for the explorer (tables + #/asset/:symbol).
 * Owns: the Assets tab table (25/page lower-bound paging), the Feeds tab
 *   (smartcoin scan), #/asset/:symbol (human supply/fees + feed section),
 *   plus the pctHundredths/ratio1000/lifetimeText helpers. The generic
 *   value-rendering layer (fieldRow/fillValue/opSection/renderObjectPanel,
 *   amount/price spans, account/asset/object links) moved to
 *   js/explorer-render.js (ExplorerRender, slice-18 split) — this file
 *   reaches it for issuer links + feed rows and re-exports three aliases
 *   (opSection/accountLink/renderObjectPanel) so explorer-blocks.js +
 *   explorer-ui.js keep working unchanged. All moved verbatim from
 *   explorer-ui.js except the generation-counter and shell-navigation
 *   references (see delegates).
 * Consumes: Explorer.asset/assetsPage/feeds/resolveObject (read-only, via
 *   global), Account.resolve (account-name links, via ExplorerRender),
 *   Format.formatAmount/formatPrice (money math only — never float, never
 *   inline Math.pow), ExplorerRender.fieldRow/accountLink (generic rows),
 *   ExplorerUI._bumpGen/_isCurrent/_waitForOpen/_setPending/renderExplorer
 *   (single generation counter, connect gate, and pending-object shell live
 *   in explorer-ui.js, which loads AFTER this file — all lookups lazy).
 * Globals/side effects: DOM under the given parent/root only; global
 *   ExplorerAssets only. Tiny DOM helpers (el/touchable/clearRoot/makeWrap/
 *   anchor/showError/showStatus/scrollTable) are private verbatim copies of
 *   the explorer-ui.js originals (same per-file convention as the market-ui
 *   split) so moved bodies stay byte-identical.
 * MONEY DISCIPLINE (principle #6): every amount through
 *   Format.formatAmount(raw, precision); every price pair through
 *   Format.formatPrice(base, basePrec, quote, quotePrec, 8) with BOTH
 *   precisions; market-fee-style percents from hundredths ints (2000->20%)
 *   and MCR/MSSR ratios from thousandths ints (1100->1.1x, the #1
 *   Asset.jsx:738-748 convention) via BigInt/string math — never float,
 *   never inline Math.pow. Raw ints stay in `title` attributes only.
 * Created by: building-vanilla-slices skill, slice-09 repair (explorer-ui split);
 *   value layer split OUT to explorer-render.js in the slice-18 audit.
 */
var ExplorerAssets = (function () {
  "use strict";

  var ASSETS_PAGE = 25; /* #1 Assets.jsx 25/page */
  var FEED_SCAN_PAGES = 4; /* asset pages scanned for smartcoins */
  var FEED_MAX = 10; /* smartcoins shown on the Feeds tab */
  var PRICE_PLACES = 8; /* market.js/market-orders.js convention (mirrors ExplorerRender.PRICE_PLACES) */
  var ACCT_RE = /^1\.2\.\d+$/; /* issuer-id check for account links (mirrors ExplorerRender's copy) */


  /* Local fallback counter, used ONLY when explorer-ui.js failed to load
   * (impossible in the shipped app — script tags are load-bearing). In
   * practice every bump/check below reaches the shell's single counter, so
   * stale async work bails across routes instead of touching detached DOM. */
  var localGen = 0;

  /* Single generation counter (shell-owned): every route entry bumps it;
   * async continuations bail when their generation no longer matches. */
  function bumpGen() {
    if (typeof ExplorerUI !== "undefined" && ExplorerUI &&
        typeof ExplorerUI._bumpGen === "function") return ExplorerUI._bumpGen();
    localGen += 1;
    return localGen;
  }

  /* True while myGen is still the latest route entry. */
  function isCurrent(myGen) {
    if (typeof ExplorerUI !== "undefined" && ExplorerUI &&
        typeof ExplorerUI._isCurrent === "function") return ExplorerUI._isCurrent(myGen);
    return myGen === localGen;
  }

  /* Connect gate (canonical implementation in explorer-ui.js): when the
   * socket is cold it paints the connecting/offline panel and returns true
   * (caller must stop). Falls through when the shell is missing — chain
   * calls then fail into the honest error panels below, never blank. */
  function waitForOpen(doc, wrap, root, myGen, rerun) {
    if (typeof ExplorerUI !== "undefined" && ExplorerUI &&
        typeof ExplorerUI._waitForOpen === "function") {
      return ExplorerUI._waitForOpen(doc, wrap, root, myGen, rerun);
    }
    return false;
  }

  /* Create an element with optional text + class (textContent only — user
   * and chain strings never reach innerHTML). */
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /* Touch target floor (principle #7): interactive elements are >=44px in
   * at least one dimension. */
  function touchable(n) {
    n.style.minHeight = "44px";
    return n;
  }

  function clearRoot(root) {
    while (root.firstChild) root.removeChild(root.firstChild);
  }

  function makeWrap(doc, root) {
    var wrap = doc.createElement("div");
    wrap.className = "wrap";
    root.appendChild(wrap);
    return wrap;
  }

  function anchor(doc, text, href) {
    var a = el(doc, "a", text);
    a.setAttribute("href", href);
    touchable(a);
    a.style.display = "inline-block";
    return a;
  }

  /* Inline error panel that is never blank: thrown values map to human
   * sentences; unknown shapes fall back to a generic message. */
  function showError(doc, wrap, e, fallback) {
    var box = el(doc, "div", null, "error");
    box.setAttribute("aria-live", "polite");
    var msg = (e && typeof e.message === "string" && e.message)
      ? e.message : String(e || fallback || "Unexpected error");
    if (msg.indexOf("unknown-block") !== -1) msg = "Unknown block.";
    else if (msg.indexOf("unknown-tx") !== -1) msg = "Unknown transaction.";
    else if (msg.indexOf("unknown-asset") !== -1) msg = fallback || "Unknown asset.";
    else if (msg.indexOf("unknown-object") !== -1) msg = fallback || "Nothing found for that search.";
    else if (msg.indexOf("tx-expired-or-unknown") !== -1) msg = "Transaction hash lookup covers recent transactions only — this one is expired or unknown.";
    else if (msg.indexOf("not-connected") !== -1 || msg.indexOf("not connected") !== -1) {
      msg = "Network unavailable. Check Settings → Nodes and retry.";
    }
    box.textContent = msg;
    wrap.appendChild(box);
    return box;
  }

  function showStatus(doc, wrap, text) {
    var p = el(doc, "p", text, "muted");
    p.setAttribute("aria-live", "polite");
    wrap.appendChild(p);
    return p;
  }

  /* Hundredths int string -> "20%" (2000), "20.5%" (2050); "" on garbage. */
  function pctHundredths(raw) {
    if (!/^\d+$/.test(String(raw || ""))) return "";
    var v = BigInt(String(raw));
    var whole = (v / 100n).toString();
    var frac = (v % 100n).toString().padStart(2, "0").replace(/0+$/, "");
    return frac ? whole + "." + frac + "%" : whole + "%";
  }

  /* Thousandths ratio int -> "1.1×" (1100), "1.75×" (1750); "" on garbage. */
  function ratio1000(raw) {
    if (!/^\d+$/.test(String(raw || ""))) return "";
    var v = BigInt(String(raw));
    var whole = (v / 1000n).toString();
    var frac = (v % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
    return frac ? whole + "." + frac + "×" : whole + "×";
  }

  /* Seconds int -> "24 hours" when whole, else "90 seconds". */
  function lifetimeText(raw) {
    if (!/^\d+$/.test(String(raw || ""))) return String(raw);
    var s = parseInt(String(raw), 10);
    if (s % 3600 === 0) return (s / 3600) + " hours";
    if (s % 60 === 0) return (s / 60) + " minutes";
    return s + " seconds";
  }

  /* Scrollable table shell (principle #7: dense tables scroll horizontally
   * on phones instead of squeezing; no new CSS — inline overflow only). */
  function scrollTable(doc, headers, rows) {
    var scroller = el(doc, "div", null, "xplore-scroll");
    scroller.style.overflowX = "auto";
    var table = doc.createElement("table");
    var thead = doc.createElement("thead");
    var hr = doc.createElement("tr");
    headers.forEach(function (h) { hr.appendChild(el(doc, "th", h)); });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tb = doc.createElement("tbody");
    rows.forEach(function (cells) {
      var tr = doc.createElement("tr");
      cells.forEach(function (c) {
        var td = doc.createElement("td");
        if (typeof c === "string") td.textContent = c;
        else if (c) td.appendChild(c);
        tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    scroller.appendChild(table);
    return scroller;
  }


  /* Assets tab: 25/page table (symbol, issuer, precision, supply human)
   * with lower-bound paging (Next/Prev stack, Reference #18 pattern). */
  function assetsTab(doc, body, root, myGen, lower, stack) {
    showStatus(doc, body, "Loading assets…");
    Explorer.assetsPage(lower, ASSETS_PAGE).then(function (rows) {
      if (!isCurrent(myGen)) return;
      while (body.firstChild) body.removeChild(body.firstChild);
      rows = rows || [];
      if (rows.length === 0) {
        body.appendChild(el(doc, "p", "No assets on this page.", "muted"));
        return;
      }
      var precById = {};
      var dynById = {};
      rows.forEach(function (a) {
        if (a) { precById[a.id] = a.precision; dynById[a.id] = a.dynamic_asset_data_id || null; }
      });
      var dynIds = Object.keys(dynById).map(function (k) { return dynById[k]; })
        .filter(function (id) { return typeof id === "string"; });
      var supplyOf = {};
      function paint(tableRows) {
        while (body.firstChild) body.removeChild(body.firstChild);
        body.appendChild(scrollTable(doc, ["Symbol", "Issuer", "Precision", "Supply"], tableRows));
        var nav = el(doc, "div", null, "xplore-nav");
        if (stack.length > 0) {
          var prev = touchable(el(doc, "button", "← Prev"));
          prev.type = "button";
          prev.addEventListener("click", function () {
            var back = stack.slice(0, -1);
            var to = stack[stack.length - 1];
            while (body.firstChild) body.removeChild(body.firstChild);
            assetsTab(doc, body, root, myGen, to === undefined ? "" : to, back);
          });
          nav.appendChild(prev);
        }
        if (rows.length >= ASSETS_PAGE) {
          var next = touchable(el(doc, "button", "Next →"));
          next.type = "button";
          next.addEventListener("click", function () {
            while (body.firstChild) body.removeChild(body.firstChild);
            assetsTab(doc, body, root, myGen, rows[rows.length - 1].symbol, stack.concat([lower]));
          });
          nav.appendChild(next);
        }
        body.appendChild(nav);
      }
      function tableRows() {
        return rows.map(function (a) {
          var sym = anchor(doc, a.symbol, "#/asset/" + a.symbol);
          sym.title = a.id;
          var issuer = (typeof a.issuer === "string" && ACCT_RE.test(a.issuer))
            ? ExplorerRender.accountLink(doc, a.issuer, myGen) : String(a.issuer);
          var supplyRaw = supplyOf[a.id];
          var supply = supplyRaw !== undefined && supplyRaw !== null
            ? (function () {
              try { return Format.formatAmount(String(supplyRaw), a.precision); }
              catch (e) { return String(supplyRaw); }
            })() : "—";
          return [sym, issuer, String(a.precision), supply];
        });
      }
      if (dynIds.length === 0) { paint(tableRows()); return; }
      Explorer.resolveObject(dynIds[0]).then(function () {
        return Promise.all(dynIds.map(function (id) {
          return Explorer.resolveObject(id).then(function (e) { return e.object; }).catch(function () { return null; });
        }));
      }).then(function (objs) {
        if (!isCurrent(myGen)) return;
        rows.forEach(function (a, i) {
          if (objs[i] && objs[i].current_supply !== undefined) supplyOf[a.id] = String(objs[i].current_supply);
        });
        paint(tableRows());
      }).catch(function () {
        if (!isCurrent(myGen)) return;
        paint(tableRows());
      });
    }).catch(function (e) {
      if (!isCurrent(myGen)) return;
      while (body.firstChild) body.removeChild(body.firstChild);
      showError(doc, body, e, "Could not load assets.");
      var retry = touchable(el(doc, "button", "Retry"));
      retry.type = "button";
      retry.addEventListener("click", function () {
        while (body.firstChild) body.removeChild(body.firstChild);
        assetsTab(doc, body, root, myGen, lower, stack);
      });
      body.appendChild(retry);
    });
  }

  /* #/asset/:symbol: header + supply/max/fees human rows + permission note
   * + feed section when is_smartcoin (both-precisions math) else the
   * "not a smartcoin" empty state. */
  function renderAsset(root, symbol) {
    if (!root) return;
    var doc = root.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (!doc) return;
    var myGen = bumpGen();
    clearRoot(root);
    var wrap = makeWrap(doc, root);
    if (typeof Explorer === "undefined" || !Explorer) {
      showError(doc, wrap, "Explorer backend missing: js/explorer.js failed to load.");
      return;
    }
    if (waitForOpen(doc, wrap, root, myGen, function () { renderAsset(root, symbol); })) return;
    if (typeof symbol !== "string" || !symbol) {
      wrap.appendChild(el(doc, "h1", "Asset"));
      showError(doc, wrap, new Error("unknown-asset"), "Unknown asset.");
      return;
    }
    wrap.appendChild(el(doc, "h1", "Asset " + symbol));
    showStatus(doc, wrap, "Loading asset…");
    Explorer.asset(symbol).then(function (j) {
      if (!isCurrent(myGen)) return;
      var a = j.asset, dyn = j.dynamic || {};
      var prec = a.precision;
      while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
      wrap.appendChild(el(doc, "h1", "Asset " + a.symbol));
      var dl = el(doc, "dl", null, "xplore-fields");
      function humanRow(term, raw) {
        dl.appendChild(el(doc, "dt", term));
        var dd = doc.createElement("dd");
        if (raw === undefined || raw === null) dd.textContent = "—";
        else {
          try { dd.textContent = Format.formatAmount(String(raw), prec); }
          catch (e) { dd.textContent = String(raw); }
          dd.title = String(raw);
        }
        dl.appendChild(dd);
      }
      dl.appendChild(el(doc, "dt", "ID"));
      var idDd = doc.createElement("dd");
      idDd.textContent = a.id;
      dl.appendChild(idDd);
      dl.appendChild(el(doc, "dt", "Issuer"));
      var issuerDd = doc.createElement("dd");
      issuerDd.appendChild((typeof a.issuer === "string" && ACCT_RE.test(a.issuer))
        ? ExplorerRender.accountLink(doc, a.issuer, myGen) : el(doc, "span", String(a.issuer)));
      dl.appendChild(issuerDd);
      dl.appendChild(el(doc, "dt", "Precision"));
      var pDd = doc.createElement("dd");
      pDd.textContent = String(prec);
      dl.appendChild(pDd);
      wrap.appendChild(dl);
      var dl2 = el(doc, "dl", null, "xplore-fields");
      wrap.appendChild(dl2);
      humanRow("Max supply", a.options && a.options.max_supply);
      humanRow("Current supply", dyn.current_supply);
      humanRow("Accumulated fees", dyn.accumulated_fees);
      humanRow("Fee pool", dyn.fee_pool);
      var feeDd = doc.createElement("dd");
      var feeKey = a.options && a.options.market_fee_percent;
      if (feeKey !== undefined && /^\d+$/.test(String(feeKey))) {
        feeDd.textContent = pctHundredths(String(feeKey));
        feeDd.title = String(feeKey);
      } else feeDd.textContent = "—";
      dl2.appendChild(el(doc, "dt", "Market fee"));
      dl2.appendChild(feeDd);
      if (!j.is_smartcoin) {
        wrap.appendChild(el(doc, "p", "Not a smartcoin — no price feeds.", "muted"));
        return;
      }
      wrap.appendChild(el(doc, "h3", "Price feeds"));
      var feedBox = el(doc, "div", null, "xplore-feed");
      wrap.appendChild(feedBox);
      showStatus(doc, feedBox, "Loading feeds…");
      Explorer.feeds([a.symbol]).then(function (rows) {
        if (!isCurrent(myGen)) return;
        while (feedBox.firstChild) feedBox.removeChild(feedBox.firstChild);
        var f = (rows || [])[0];
        if (!f || !f.is_smartcoin || !f.settlement_raw) {
          feedBox.appendChild(el(doc, "p", "No live feeds published.", "muted"));
          return;
        }
        var fdl = el(doc, "dl", null, "xplore-fields");
        function priceRow(term, pair) {
          fdl.appendChild(el(doc, "dt", term));
          var dd = doc.createElement("dd");
          if (!pair || f.quote_precision === null || f.quote_precision === undefined) {
            dd.textContent = "unavailable (quote precision unknown)";
          } else {
            try {
              dd.textContent = Format.formatPrice(String(pair.base.amount), f.base_precision,
                String(pair.quote.amount), f.quote_precision, PRICE_PLACES);
              dd.title = "base " + pair.base.amount + " / quote " + pair.quote.amount;
            } catch (e) { dd.textContent = "unavailable"; }
          }
          fdl.appendChild(dd);
        }
        priceRow("Settlement price", f.settlement_raw);
        priceRow("Feed price", f.feed_raw);
        var ctx = { gen: myGen, root: root, tab: "assets" };
        if (f.mssr_hundredths !== null && f.mssr_hundredths !== undefined) {
          ExplorerRender.fieldRow(doc, fdl, "maximum_short_squeeze_ratio", f.mssr_hundredths, ctx, 0);
        }
        if (f.mcr !== null && f.mcr !== undefined) {
          ExplorerRender.fieldRow(doc, fdl, "maintenance_collateral_ratio", f.mcr, ctx, 0);
        }
        if (f.feed_lifetime_sec !== null && f.feed_lifetime_sec !== undefined) {
          fdl.appendChild(el(doc, "dt", "Feed lifetime"));
          var lt = doc.createElement("dd");
          lt.textContent = lifetimeText(f.feed_lifetime_sec);
          lt.title = String(f.feed_lifetime_sec) + " seconds";
          fdl.appendChild(lt);
        }
        if (f.min_feeds !== null && f.min_feeds !== undefined) {
          fdl.appendChild(el(doc, "dt", "Minimum feeds"));
          var mf = doc.createElement("dd");
          mf.textContent = String(f.min_feeds);
          fdl.appendChild(mf);
        }
        feedBox.appendChild(fdl);
      }).catch(function (e) {
        if (!isCurrent(myGen)) return;
        while (feedBox.firstChild) feedBox.removeChild(feedBox.firstChild);
        showError(doc, feedBox, e, "Could not load feeds.");
      });
    }).catch(function (e) {
      if (!isCurrent(myGen)) return;
      while (wrap.firstChild) wrap.removeChild(wrap.firstChild);
      wrap.appendChild(el(doc, "h1", "Asset " + symbol));
      showError(doc, wrap, e, "Unknown asset.");
    });
  }

  /* Feeds tab: scan the first asset pages for smartcoins, then show MPA
   * rows (symbol, settlement, feed, MSSR). Verified empty state when the
   * chain has none (ambiguity C) — never faked, never blank. */
  function feedsTab(doc, body, root, myGen) {
    showStatus(doc, body, "Scanning for smartcoins…");
    var lower = "", pages = 0, found = [];
    function scan() {
      Explorer.assetsPage(lower, ASSETS_PAGE).then(function (rows) {
        if (!isCurrent(myGen)) return;
        rows = rows || [];
        rows.forEach(function (a) {
          if (a && a.bitasset_data_id && found.length < FEED_MAX) found.push(a.symbol);
        });
        pages++;
        if (rows.length >= ASSETS_PAGE && pages < FEED_SCAN_PAGES && found.length < FEED_MAX) {
          lower = rows[rows.length - 1].symbol;
          scan();
          return;
        }
        paint();
      }).catch(function (e) {
        if (!isCurrent(myGen)) return;
        while (body.firstChild) body.removeChild(body.firstChild);
        showError(doc, body, e, "Could not scan assets.");
      });
    }
    function paint() {
      while (body.firstChild) body.removeChild(body.firstChild);
      if (found.length === 0) {
        body.appendChild(el(doc, "p",
          "No smartcoins with feeds found on this node. User-issued assets show here once they publish feeds.", "muted"));
        return;
      }
      showStatus(doc, body, "Loading feeds for " + found.length + " asset(s)…");
      Explorer.feeds(found).then(function (rows) {
        if (!isCurrent(myGen)) return;
        while (body.firstChild) body.removeChild(body.firstChild);
        var tableRows = (rows || []).map(function (f) {
          var sym = anchor(doc, f.symbol, "#/asset/" + f.symbol);
          function priceCell(pair) {
            if (!pair || f.quote_precision === null || f.quote_precision === undefined) return "—";
            try {
              return Format.formatPrice(String(pair.base.amount), f.base_precision,
                String(pair.quote.amount), f.quote_precision, PRICE_PLACES);
            } catch (e) { return "—"; }
          }
          var mssr = (f.mssr_hundredths !== null && f.mssr_hundredths !== undefined &&
            /^\d+$/.test(String(f.mssr_hundredths))) ? ratio1000(String(f.mssr_hundredths)) : "—";
          return [sym, priceCell(f.settlement_raw), priceCell(f.feed_raw), mssr];
        });
        body.appendChild(scrollTable(doc,
          ["Symbol", "Settlement", "Feed", "MSSR"], tableRows));
      }).catch(function (e) {
        if (!isCurrent(myGen)) return;
        while (body.firstChild) body.removeChild(body.firstChild);
        showError(doc, body, e, "Could not load feeds.");
      });
    }
    scan();
  }

  return {
    /* Slice-18 aliases: the value layer lives in ExplorerRender (which
     * loads first) — same functions, stable ExplorerAssets paths for
     * explorer-blocks.js + explorer-ui.js. */
    opSection: ExplorerRender.opSection,
    accountLink: ExplorerRender.accountLink,
    renderObjectPanel: ExplorerRender.renderObjectPanel,
    assetsTab: assetsTab,
    renderAsset: renderAsset,
    feedsTab: feedsTab,
    _test: { pctHundredths: pctHundredths, ratio1000: ratio1000, lifetimeText: lifetimeText }
  };
})();

if (typeof module !== "undefined") { module.exports = ExplorerAssets; }
