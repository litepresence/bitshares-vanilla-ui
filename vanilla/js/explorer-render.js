/* ExplorerRender: generic chain-value -> DOM rendering for the explorer.
 * Owns: the whole value-rendering layer — amount/price spans (human via
 *   Format, raw ints in titles only), account/asset/object links, the
 *   named field-row recursion (fieldRow/fillValue), op sections, and the
 *   generic 1.x.y object panel (renderObjectPanel). No route logic, no
 *   paging, no asset/fee tables (those stay in explorer-assets.js, which
 *   loads AFTER this file and aliases opSection/accountLink/
 *   renderObjectPanel back onto the ExplorerAssets global so
 *   explorer-blocks.js + explorer-ui.js keep working unchanged).
 * Consumes: Explorer.asset/resolveObject (precision/symbol joins, read-only
 *   via global), Account.resolve (account-name links), Format.formatAmount/
 *   formatPrice (money math only — never float, never inline Math.pow),
 *   ExplorerUI._isCurrent (single generation counter, lazy — the shell
 *   loads after this file, with a local fallback that only matters if the
 *   shell failed to load, same pattern as explorer-assets.js).
 * Globals/side effects: DOM under the given parent only; global
 *   ExplorerRender only. Tiny DOM helpers (el/touchable/anchor) are private
 *   verbatim copies of the explorer-ui.js originals (same per-file
 *   convention as the market-ui split) so moved bodies stay byte-identical.
 * MONEY DISCIPLINE (principle #6): every amount through
 *   Format.formatAmount(raw, precision); every price pair through
 *   Format.formatPrice(base, basePrec, quote, quotePrec, 8) with BOTH
 *   precisions; market-fee-style percents from hundredths ints (2000->20%)
 *   and MCR/MSSR ratios from thousandths ints (1100->1.1x, the #1
 *   Asset.jsx:738-748 convention) via BigInt/string math — never float,
 *   never inline Math.pow. Raw ints stay in `title` attributes only.
 * Created by: building-vanilla-slices skill, slice-18 audit (explorer split).
 *   Bodies moved verbatim from js/explorer-assets.js (consts + the
 *   isIntLike→renderObjectPanel layer); pctHundredths/ratio1000/
 *   lifetimeText stayed behind (renderAsset/feedsTab + _test use them).
 */
var ExplorerRender = (function () {
  "use strict";
  /* Batch-2c i18n (slice-17): display strings resolve via I18n.t with
   * the pre-conversion literal kept verbatim as enDefault (English-identical
   * on any transport, incl. file:// where dict fetch fails). Falls back to
   * the default when i18n.js failed to load: never blank, never throws.
   * Dynamic sentences keep their code structure (batch-2b precedent): only
   * complete static literals are wrapped, values and punctuation glue stay
   * raw, so every default below is byte-verbatim in the HEAD blob. */
  function t(key, dflt) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt);
    } catch (e) { /* default below */ }
    return dflt;
  }


  var PRICE_PLACES = 8; /* market.js/market-orders.js convention */

  var ID_RE = /^1\.\d+\.\d+$/;
  var ACCT_RE = /^1\.2\.\d+$/;
  var ASSET_RE = /^1\.3\.\d+$/;

  /* Op/object leaves known to be hundredths-of-a-percent ints. */
  var HUNDREDTH_KEYS = { market_fee_percent: 1, force_settlement_offset_percent: 1 };
  /* Feed ratio leaves in thousandths (1000 = 1.0x, #1 Asset.jsx:738-748). */
  var RATIO1000_KEYS = { maximum_short_squeeze_ratio: 1, maintenance_collateral_ratio: 1 };
  /* Core-asset precision for stake-style leaves (GRAPHENE_BLOCKCHAIN_PRECISION
   * = 10^5, config.hpp:29-30): witness/committee total_votes are uint64 stake
   * in core units; fee_pool is "in core asset" (asset_object.hpp:65). */
  var CORE_PRECISION = 5;
  /* Bare leaves carrying CORE-precision amounts (no lookup needed). */
  var CORE_AMOUNT_KEYS = { total_votes: 1, total_votes_for: 1, total_votes_against: 1,
    fee_pool: 1 };
  /* Bare leaves in the OWNING asset's precision (asset_object.hpp:61-65:
   * max_supply, current_supply, confidential_supply, accumulated_fees,
   * accumulated_collateral_fees). Precision comes from ctx.assetPrecision
   * (set by renderObjectPanel) or ctx.assetId; unresolvable keeps raw. */
  var OWN_AMOUNT_KEYS = { max_supply: 1, current_supply: 1, confidential_supply: 1,
    accumulated_fees: 1, accumulated_collateral_fees: 1 };

  /* Local fallback counter, used ONLY when explorer-ui.js failed to load
   * (impossible in the shipped app — script tags are load-bearing). In
   * practice isCurrent below reaches the shell's single counter, so stale
   * async work bails across routes instead of touching detached DOM.
   * Verbatim copy of the explorer-assets.js delegate pair. */
  var localGen = 0;

  /* True while myGen is still the latest route entry (shell-owned single
   * generation counter; local fallback only when the shell is missing). */
  function isCurrent(myGen) {
    if (typeof ExplorerUI !== "undefined" && ExplorerUI &&
        typeof ExplorerUI._isCurrent === "function") return ExplorerUI._isCurrent(myGen);
    return myGen === localGen;
  }

  /* Create an element with optional text + class (textContent only — user
   * and chain strings never reach innerHTML). Verbatim copy. */
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /* Touch target floor (principle #7): interactive elements are >=44px in
   * at least one dimension. Verbatim copy. */
  function touchable(n) {
    n.style.minHeight = "44px";
    return n;
  }

  /* Link helper (textContent only, touch-sized, inline-block). Verbatim copy. */
  function anchor(doc, text, href) {
    var a = el(doc, "a", text);
    a.setAttribute("href", href);
    touchable(a);
    a.style.display = "inline-block";
    return a;
  }

  /* Integer-like leaf (string or number); share_type/vote leaves arrive
   * as either shape depending on the node. */
  function isIntLike(v) {
    if (typeof v === "number") return Number.isInteger(v);
    return typeof v === "string" && /^-?\d+$/.test(v);
  }

  /* Sync human amount span via Format only (never float); raw int stays in
   * the title. Throws on bad input — callers fall back to raw + marker. */
  function humanAmount(doc, raw, precision) {
    var s = el(doc, "span", Format.formatAmount(String(raw), precision));
    s.title = String(raw);
    return s;
  }

  /* Owning-asset amount span with async precision resolve (Explorer.asset):
   * shows raw + " (raw)" meanwhile, and keeps it when unresolvable. */
  function ownedAmountSpan(doc, raw, assetId, myGen) {
    var s = el(doc, "span", String(raw) + t("explorer.raw_mark", " (raw)"));
    s.title = String(raw) + " " + assetId;
    Explorer.asset(assetId).then(function (j) {
      if (!isCurrent(myGen)) return;
      try {
        s.textContent = Format.formatAmount(String(raw), j.asset.precision) + " " + j.asset.symbol;
        s.title = String(raw);
      } catch (e) { /* raw + marker stands — honest, never blank */ }
    }).catch(function () { /* raw + marker stands */ });
    return s;
  }

  /* Amount leaf -> span that fills in human text once the asset precision
   * resolves. Shows the raw int meanwhile (with a "raw" marker, never as
   * a final money display). */
  function amountSpan(doc, raw, assetId, myGen) {
    var s = el(doc, "span", String(raw) + t("explorer.raw_mark", " (raw)"));
    s.title = String(raw) + " " + assetId;
    Explorer.asset(assetId).then(function (j) {
      if (!isCurrent(myGen)) return;
      try {
        s.textContent = Format.formatAmount(String(raw), j.asset.precision) + " " + j.asset.symbol;
        s.title = String(raw);
      } catch (e) { s.textContent = String(raw) + " " + assetId; }
    }).catch(function () {
      if (!isCurrent(myGen)) return;
      s.textContent = String(raw) + " " + assetId;
    });
    return s;
  }

  /* Price-pair leaf -> span filled in once both precisions resolve. */
  function priceSpan(doc, base, quote, myGen) {
    var s = el(doc, "span", "…");
    s.title = t("explorer.price_base", "base ") + base.amount + " " + base.asset_id + t("explorer.price_quote", " / quote ") + quote.amount + " " + quote.asset_id;
    var pb = Explorer.asset(base.asset_id).then(function (j) { return j.asset.precision; });
    var pq = Explorer.asset(quote.asset_id).then(function (j) { return j.asset.precision; });
    Promise.all([pb, pq]).then(function (precs) {
      if (!isCurrent(myGen)) return;
      try {
        s.textContent = Format.formatPrice(String(base.amount), precs[0], String(quote.amount), precs[1], PRICE_PLACES);
      } catch (e) { s.textContent = s.title; }
    }).catch(function () {
      if (!isCurrent(myGen)) return;
      s.textContent = s.title;
    });
    return s;
  }

  /* Account-id string -> link to the slice-3 account route (name resolved
   * first so the URL reads like the old UI); falls back to plain text. */
  function accountLink(doc, id, myGen) {
    var s = el(doc, "span", id);
    if (typeof Account === "undefined" || !Account || typeof Account.resolve !== "function") return s;
    Account.resolve(id).then(function (a) {
      if (!isCurrent(myGen)) return;
      var link = anchor(doc, a.name + " (" + a.id + ")", "#/account/" + a.name);
      s.parentNode.replaceChild(link, s);
    }).catch(function () { /* plain id stands — honest, never blank */ });
    return s;
  }

  /* Asset-id string -> link to #/asset/:symbol once the symbol resolves. */
  function assetLink(doc, id, myGen) {
    var s = el(doc, "span", id);
    Explorer.asset(id).then(function (j) {
      if (!isCurrent(myGen)) return;
      var link = anchor(doc, j.asset.symbol, "#/asset/" + j.asset.symbol);
      s.parentNode.replaceChild(link, s);
    }).catch(function () { /* plain id stands */ });
    return s;
  }

  /* Exotic 1.x.y id -> inline human row on #/explorer (no new routes):
   * stashes the id in the shell and re-renders the explorer shell's object
   * panel. (Pending state + render entry live in explorer-ui.js, reached
   * via lazy globals — that file loads after this one.) */
  function objectLink(doc, id, root, tab) {
    var a = anchor(doc, id, "#/explorer");
    a.addEventListener("click", function (ev) {
      ev.preventDefault();
      if (typeof ExplorerUI === "undefined" || !ExplorerUI) return;
      if (typeof ExplorerUI._setPending === "function") ExplorerUI._setPending(id, tab);
      if (typeof ExplorerUI.renderExplorer === "function") ExplorerUI.renderExplorer(root, tab || "blocks");
    });
    return a;
  }

  /* {amount, asset_id} shape (asset_transfer-style leaves). */
  function isAmountLike(v) {
    return v && typeof v === "object" && !Array.isArray(v) &&
      typeof v.amount !== "undefined" && typeof v.asset_id === "string";
  }

  /* {base:{amount,asset_id}, quote:{...}} shape (price_feed-style leaves). */
  function isPriceLike(v) {
    return v && typeof v === "object" && !Array.isArray(v) &&
      isAmountLike(v.base) && isAmountLike(v.quote);
  }

  /* One named field -> [dt, dd] pair inside a dl. Depth-capped recursion
   * for nested option objects; arrays render as item lists.
   * Params: doc, dl (appended to), key (dt term), value (any chain leaf),
   *   ctx ({gen, root, tab, assetPrecision?, assetId?}), depth (int).
   * Returns nothing — the pair is appended. Fails: never (fillValue's
   *   final branch stringifies anything left over). */
  function fieldRow(doc, dl, key, value, ctx, depth) {
    var dt = el(doc, "dt", key);
    var dd = doc.createElement("dd");
    dl.appendChild(dt);
    dl.appendChild(dd);
    fillValue(doc, dd, key, value, ctx, depth || 0);
  }

  /* Render ANY chain leaf into a dd (or li): named rows, never raw JSON,
   * nothing hits innerHTML. Branch order matters — first match wins:
   *  1. amount-like {amount, asset_id} -> async human amountSpan (raw +
   *     "raw" marker meanwhile; precision resolves via Explorer.asset).
   *  2. price-like {base, quote} -> async priceSpan (both precisions; "…"
   *     meanwhile, raw pair in the title when unresolvable).
   *  3. account-id string (1.2.N) -> accountLink (name + id link).
   *  4. asset-id string (1.3.N) -> assetLink (symbol link).
   *  5. other object-id string (1.x.y) -> objectLink (inline explorer row).
   *  6. hundredths-percent leaves (HUNDREDTH_KEYS: market_fee_percent,
   *     force_settlement_offset_percent) -> "20%" via local hundredths
   *     math, raw int in the title.
   *  7. thousandths-ratio leaves (RATIO1000_KEYS: MSSR/MCR) -> "1.1×",
   *     raw int in the title.
   *  8. bare CORE-precision leaves (CORE_AMOUNT_KEYS: total_votes*,
   *     fee_pool) -> humanAmount at CORE_PRECISION; unformattable keeps
   *     raw + marker.
   *  9. bare owning-asset leaves (OWN_AMOUNT_KEYS: *_supply,
   *     accumulated_*_fees) -> ctx.assetPrecision when the panel knows it,
   *     else async ownedAmountSpan via ctx.assetId, else raw + marker.
   * 10. arrays -> "—" when empty, "N items" past depth 2, else a ul where
   *     objects recurse via fieldRow and scalars recurse via fillValue.
   * 11. objects -> "…" past depth 2, else a nested dl via fieldRow.
   * 12. anything else -> String(value), or "—" for null/undefined/"".
   * Params: doc, dd (or li — appended to, never replaced), key (drives
   *   branches 6-9 only; array items pass their index), value (any chain
   *   leaf), ctx ({gen (stale-route guard for async fills), root + tab
   *   (objectLink target), assetPrecision?/assetId? (branch 9 hints)}),
   *   depth (recursion cap 2).
   * Returns nothing. Fails: never — every branch ends in appended DOM;
   *   async fills bail silently on stale generations (isCurrent) or failed
   *   lookups (raw + marker stands). Stale-generation fills never touch
   *   detached DOM. */
  function fillValue(doc, dd, key, value, ctx, depth) {
    var myGen = ctx.gen, root = ctx.root, tab = ctx.tab;
    if (isAmountLike(value)) {
      dd.appendChild(amountSpan(doc, String(value.amount), value.asset_id, myGen));
      return;
    }
    if (isPriceLike(value)) {
      dd.appendChild(priceSpan(doc, value.base, value.quote, myGen));
      return;
    }
    if (typeof value === "string" && ACCT_RE.test(value)) {
      dd.appendChild(accountLink(doc, value, myGen));
      return;
    }
    if (typeof value === "string" && ASSET_RE.test(value)) {
      dd.appendChild(assetLink(doc, value, myGen));
      return;
    }
    if (typeof value === "string" && ID_RE.test(value)) {
      dd.appendChild(objectLink(doc, value, root, tab));
      return;
    }
    if (typeof key === "string" && HUNDREDTH_KEYS[key] && /^\d+$/.test(String(value))) {
      var pct = el(doc, "span", pctHundredths(String(value)));
      pct.title = String(value);
      dd.appendChild(pct);
      return;
    }
    if (typeof key === "string" && RATIO1000_KEYS[key] && /^\d+$/.test(String(value))) {
      var ratio = el(doc, "span", ratio1000(String(value)));
      ratio.title = String(value);
      dd.appendChild(ratio);
      return;
    }
    /* Bare stake leaves (witness/committee/worker votes, core fee pool):
     * human via core precision, Format only. Unformattable keeps raw. */
    if (typeof key === "string" && CORE_AMOUNT_KEYS[key] && isIntLike(value)) {
      var coreSpan;
      try { coreSpan = humanAmount(doc, String(value), CORE_PRECISION); }
      catch (e) {
        coreSpan = el(doc, "span", String(value) + t("explorer.raw_mark", " (raw)"));
        coreSpan.title = String(value);
      }
      dd.appendChild(coreSpan);
      return;
    }
    /* Bare supply/fee leaves in the owning asset's precision: hint from the
     * panel ctx, else async resolve via Explorer.asset, else raw + marker. */
    if (typeof key === "string" && OWN_AMOUNT_KEYS[key] && isIntLike(value)) {
      if (ctx && typeof ctx.assetPrecision === "number") {
        var ownSpan;
        try { ownSpan = humanAmount(doc, String(value), ctx.assetPrecision); }
        catch (e) {
          ownSpan = el(doc, "span", String(value) + t("explorer.raw_mark", " (raw)"));
          ownSpan.title = String(value);
        }
        dd.appendChild(ownSpan);
      } else if (ctx && typeof ctx.assetId === "string" && ctx.assetId) {
        dd.appendChild(ownedAmountSpan(doc, String(value), ctx.assetId, myGen));
      } else {
        var rawSpan = el(doc, "span", String(value) + t("explorer.raw_mark", " (raw)"));
        rawSpan.title = String(value);
        dd.appendChild(rawSpan);
      }
      return;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) { dd.appendChild(el(doc, "span", "—", "muted")); return; }
      if (depth >= 2) { dd.appendChild(el(doc, "span", value.length + t("explorer.items_unit", " items"), "muted")); return; }
      var ul = doc.createElement("ul");
      value.forEach(function (item, i) {
        var li = doc.createElement("li");
        if (item && typeof item === "object") {
          var sub = el(doc, "dl", null, "xplore-sub");
          Object.keys(item).forEach(function (k) { fieldRow(doc, sub, k, item[k], ctx, depth + 1); });
          li.appendChild(sub);
        } else {
          fillValue(doc, li, String(i), item, ctx, depth + 1);
        }
        ul.appendChild(li);
      });
      dd.appendChild(ul);
      return;
    }
    if (value && typeof value === "object") {
      if (depth >= 2) { dd.appendChild(el(doc, "span", "…", "muted")); return; }
      var sub2 = el(doc, "dl", null, "xplore-sub");
      Object.keys(value).forEach(function (k) { fieldRow(doc, sub2, k, value[k], ctx, depth + 1); });
      dd.appendChild(sub2);
      return;
    }
    dd.textContent = (value === null || value === undefined || value === "") ? "—" : String(value);
  }

  /* Hundredths int string -> "20%" (2000), "20.5%" (2050); "" on garbage.
   * Local copy (explorer-assets.js keeps the original for its tables). */
  function pctHundredths(raw) {
    if (!/^\d+$/.test(String(raw || ""))) return "";
    var v = BigInt(String(raw));
    var whole = (v / 100n).toString();
    var frac = (v % 100n).toString().padStart(2, "0").replace(/0+$/, "");
    return frac ? whole + "." + frac + "%" : whole + "%";
  }

  /* Thousandths ratio int -> "1.1×" (1100), "1.75×" (1750); "" on garbage.
   * Local copy (same note as pctHundredths). */
  function ratio1000(raw) {
    if (!/^\d+$/.test(String(raw || ""))) return "";
    var v = BigInt(String(raw));
    var whole = (v / 1000n).toString();
    var frac = (v % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
    return frac ? whole + "." + frac + "×" : whole + "×";
  }

  /* One op -> headed section with named field rows (the field-coverage
   * checklist role #1's operations/ directory plays, kept generic). Shared
   * with explorer-blocks.js (tx drill-down) via the ExplorerAssets alias.
   * Params: doc, op ({type_name, type_idx, virtual, fields}), ctx
   *   (fillValue shape), label (default "Operation"). Returns: the section
   *   div. Fails: never (missing fields render "No fields."). */
  function opSection(doc, op, ctx, label) {
    var box = el(doc, "div", null, "xplore-op");
    var head = el(doc, "h3", (label || t("explorer.op_label", "Operation")) + ": " + op.type_name +
      (op.virtual ? t("explorer.virtual_mark", " (virtual)") : "") + t("explorer.op_badge_prefix", " [op ") + op.type_idx + "]");
    box.appendChild(head);
    var dl = el(doc, "dl", null, "xplore-fields");
    var fields = (op.fields && typeof op.fields === "object") ? op.fields : {};
    var keys = Object.keys(fields);
    if (keys.length === 0) box.appendChild(el(doc, "p", t("explorer.no_fields", "No fields."), "muted"));
    keys.forEach(function (k) { fieldRow(doc, dl, k, fields[k], ctx, 0); });
    box.appendChild(dl);
    /* Punchlist: raw-JSON toggle (Transaction.jsx:42-73 concept) — the
     * named rows above stay the primary view; the triangle shows the
     * verbatim op for proof. Plain literal label, never throws. */
    try {
      var det = doc.createElement("details");
      det.className = "raw";
      var sum = doc.createElement("summary");
      sum.setAttribute("aria-label", t("explorer.raw_op_aria", "Show raw operation JSON"));
      sum.textContent = t("explorer.raw_json", "Raw JSON");
      det.appendChild(sum);
      var pre = doc.createElement("pre");
      pre.textContent = JSON.stringify(op, null, 2);
      det.appendChild(pre);
      box.appendChild(det);
    } catch (e) { /* named rows stand */ }
    return box;
  }

  /* Inline human rows for exotic objects (orders, proposals, HTLC, tickets,
   * pools, credit terms…): type header + key fields via the generic
   * renderer; owning slices get a "full view" note, never a dead end.
   * Params: doc, entry ({id, space, type, typeName, object, op?}), ctx
   *   ({gen, root, tab} — extended here with the owning-asset hint).
   * Returns: the panel div. Fails: never (vote header failures keep id +
   *   type; field failures render per-leaf inside fillValue). */
  function renderObjectPanel(doc, entry, ctx) {
    var box = el(doc, "div", null, "xplore-object-rows");
    var title = entry.id + ": " + entry.typeName;
    /* Header also names human votes when present (witness/committee/worker
     * total_votes at core precision) — sync Format math, never float. */
    var votes = entry.object && entry.object.total_votes;
    if (isIntLike(votes)) {
      try { title += " · " + Format.formatAmount(String(votes), CORE_PRECISION) + t("explorer.votes_unit", " votes"); }
      catch (e) { /* header stays id + type */ }
    }
    box.appendChild(el(doc, "h3", title));
    if (entry.op) box.appendChild(opSection(doc, entry.op, ctx, t("explorer.history_op", "History op")));
    var dl = el(doc, "dl", null, "xplore-fields");
    var obj = entry.object || {};
    /* Owning-asset hint for bare supply/fee leaves: asset objects carry
     * their own precision; anything else resolves via ctx or stays raw. */
    var full = { gen: ctx.gen, root: ctx.root, tab: ctx.tab,
      assetPrecision: (typeof obj.precision === "number") ? obj.precision : ctx.assetPrecision,
      assetId: (entry.space === 1 && entry.type === 3) ? entry.id : ctx.assetId };
    var keys = Object.keys(obj);
    var shown = 0;
    keys.forEach(function (k) {
      if (k === "op" || shown >= 24) return;
      fieldRow(doc, dl, k, obj[k], full, 0);
      shown++;
    });
    box.appendChild(dl);
    var note = t("explorer.full_view_note", "Full management view lives in its owning slice — this is a read-only summary.");
    if (entry.space === 1 && (entry.type === 7 || entry.type === 8)) note += t("explorer.note_orders", " (orders: trading slice)");
    else if (entry.space === 1 && entry.type === 10) note += t("explorer.note_proposals", " (proposals: governance slice)");
    else if (entry.space === 1 && entry.type === 16) note += t("explorer.note_htlc", " (HTLC: transfers slice)");
    box.appendChild(el(doc, "p", note, "muted"));
    return box;
  }

  return {
    fieldRow: fieldRow,
    fillValue: fillValue,
    opSection: opSection,
    renderObjectPanel: renderObjectPanel,
    accountLink: accountLink,
    assetLink: assetLink,
    PRICE_PLACES: PRICE_PLACES
  };
})();

if (typeof module !== "undefined") { module.exports = ExplorerRender; }
