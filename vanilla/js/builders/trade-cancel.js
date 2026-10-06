/* TradeCancel: order cancel confirm/send/result boxes + shared result screen.
 *
 * What it owns: the inline per-order cancel confirm (orderCancelBox), the
 * cancel-all box (cancelAllBox, ≥2 orders), the one-line cancel summary
 * (cancelView), and the shared result screen (paintResult — used by the
 * place-order flows in trade-form.js via TradeCancel.paintResult as well as
 * by nothing here: cancel success panels are inline, see below). No
 * book/charts/orders rendering — those stay where they are.
 * Consumes: Tx (limit_order_cancel serializer, buildTx, feeMulti, sign —
 *   sends via Chain with proveGone inclusion reads, same sendTx shape as the
 *   form side), Format (formatAmount for the cancel summary + fee lines),
 *   Wallet (active WIF as a JS value, never in the DOM), Account
 *   (myAccountId), Chain (db/call). Send/fee/prove helpers (sendTx/sleep/
 *   headBlock/proveGone/feeAssetMeta/humanFee) are private verbatim copies
 *   of the trade-form.js originals (same per-file convention as the
 *   market-ui split) so moved bodies stay byte-identical.
 * Globals/side effects: DOM under the given box/mount only; global
 *   TradeCancel only. WIFs pass as JS values into Tx.sign — never into
 *   textContent/value.
 * Created by: building-vanilla-slices skill, slice-06-trading plan Task 2.
 * Reshaped by: slice-18 audit (trade-ui split — cancel boxes + paintResult
 *   moved verbatim here; trade-ui.js keeps the stable TradeUI entries).
 *
 * Reference behavior: cancel op shape <-
 *   app/actions/MarketsActions.js:705+; confirm row names <-
 *   wallet-extension/src/popup/popup.js (Fee Paying Account / Order ID).
 */
var TradeCancel = (function () {
  "use strict";

  var FEE_ASSET = "1.3.0";
  var PROVE_TIMEOUT_MS = 30000;
  var PROVE_INTERVAL_MS = 2500;

  /* Batch-2b i18n (slice-17): display strings resolve via I18n.t with
   * the pre-conversion literal kept verbatim as enDefault (English-identical
   * on any transport, incl. file:// where dict fetch fails). Falls back to
   * the default when i18n.js failed to load: never blank, never throws. */
  function t(key, dflt) {
    try {
      if (typeof I18n !== "undefined" && I18n && typeof I18n.t === "function") return I18n.t(key, dflt);
    } catch (e) { /* default below */ }
    return dflt;
  }

  /* Element helper: textContent only, user/chain strings never reach HTML. */
  function el(doc, tag, text, cls) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function clearBox(box) {
    while (box.firstChild) box.removeChild(box.firstChild);
  }

  function sleep(ms) {
    return new Promise(function (res) { setTimeout(res, ms); });
  }

  /* Inline error panel that is never blank: any thrown value maps to text. */
  function showError(doc, wrap, e, fallback) {
    var err = el(doc, "div", null, "error");
    err.setAttribute("aria-live", "polite");
    var msg = (e && typeof e.message === "string" && e.message)
      ? e.message
      : String(e || fallback || t("common.unexpected_error", "Unexpected error"));
    if (msg.indexOf("not connected") !== -1) {
      msg = t("common.network_unavailable", "Network unavailable. Check Settings → Nodes and retry.");
    } else if (msg.indexOf("wallet-locked") !== -1) {
      msg = t("common.wallet_locked", "Wallet is locked.");
    } else if (msg.indexOf("no-account") !== -1) {
      msg = t("market.err_no_account", "No on-chain account found for the wallet's active key.");
    }
    err.textContent = msg;
    wrap.appendChild(err);
    return err;
  }

  /* Status line for multi-step flows (signing → broadcasting → confirming). */
  function showStatus(doc, wrap, text) {
    var p = el(doc, "p", text, "muted");
    p.setAttribute("aria-live", "polite");
    wrap.appendChild(p);
    return p;
  }

  /* Fee asset display meta for human fee lines. */
  async function feeAssetMeta(feeAssetId) {
    var dbId = await Chain.db();
    var rows = await Chain.call(dbId, "get_assets", [[feeAssetId]]);
    if (!rows || !rows[0] || typeof rows[0].precision !== "number") {
      throw new Error("bad-asset-shape for fee asset " + feeAssetId);
    }
    return { symbol: rows[0].symbol, precision: rows[0].precision };
  }

  function humanFee(totalRaw, meta) {
    return Format.formatAmount(String(totalRaw), meta.precision) + " " + meta.symbol;
  }

  /* Placeholder fee payer for paint-time fee quotes (trade-panels.js:128
   * QUOTE_PLACEHOLDER_SELLER): limit_order_cancel fees are account-invariant
   * (flat fee schedule per op type, answered by get_required_fees from the
   * op shape + fee asset — the payer id never changes the price; the
   * committee-account 1.2.0 always exists, so it is the honest
   * placeholder). WHY quote at paint time: every other desk shows the fee
   * BEFORE Sign & Send; op-2 cancel resolved it inside doGo AFTER Confirm
   * and showed it only on the result panel. Display-only: doGo still
   * rebuilds with the real fee_paying_account and re-runs feeMulti for the
   * tx it actually signs. */
  var QUOTE_PLACEHOLDER_PAYER = "1.2.0";

  /* Paint-time fee quote for cancel ops (display-only, never signed).
   * WHY a throwaway op set: feeMulti fills fees in place on the passed ops
   * and buildTx pins a head block — both go stale, so doGo rebuilds with
   * the real account. Never rejects: ANY failure resolves the honest dash
   * fallback (the confirm must still paint; doGo surfaces the real error
   * when the user proceeds).
   * @param {Array} ops cancel ops with the placeholder payer (mutated, discarded)
   * @returns {Promise<{feeHuman: string, feeRaw: string|null}>} display fee + raw title (null when unknown) */
  function quoteFeeHuman(ops) {
    var dash = t("settings.dash", "—");
    return Tx.buildTx(ops).then(function (unsigned) {
      return Tx.feeMulti(unsigned.operations, FEE_ASSET).then(function (feeRes) {
        return feeAssetMeta(unsigned.operations[0][1].fee.asset_id).then(function (meta) {
          return { feeHuman: humanFee(feeRes.totalRaw, meta), feeRaw: String(feeRes.totalRaw) };
        });
      });
    }).catch(function () {
      return { feeHuman: dash, feeRaw: null };
    });
  }

  /* Head block number for result screens (observation marker, not a txid —
   * history rows carry none, same convention as transfer-ui.js). */
  async function headBlock() {
    var dbId = await Chain.db();
    var props = await Chain.call(dbId, "get_dynamic_global_properties", []);
    return (props && props.head_block_number) || 0;
  }

  /* Send a signed multi-op-capable tx, then prove it with a caller poll fn.
   * WHY not Tx.broadcast: its history poll only matches op-0 transfers; order
   * txs prove via get_limit_orders_by_account reads instead. Wire shape
   * (callback id + signedTx, plain fallback) matches tx.js broadcast. */
  async function sendTx(signed, prove) {
    var netId = await Chain.net();
    var callbackId = (Math.random() * 4294967296) >>> 0;
    var via = "broadcast_transaction_with_callback";
    try {
      await Chain.call(netId, "broadcast_transaction_with_callback", [callbackId, signed]);
    } catch (e) {
      via = "broadcast_transaction";
      await Chain.call(netId, "broadcast_transaction", [signed]);
    }
    return proveTx(prove, via);
  }

  /* Prove-only tail of sendTx (Tier 2 delegation: the SW already broadcast
   * behind approval, so delegated callers prove here without re-sending).
   * Params: prove (caller poll fn), via (broadcast path label, SW proof via
   * when delegated). Resolves {found, head, via} like sendTx. */
  async function proveTx(prove, via) {
    var deadline = Date.now() + PROVE_TIMEOUT_MS;
    while (Date.now() < deadline) {
      var found = null;
      try { found = await prove(); } catch (e) { found = null; }
      if (found) {
        var head = await headBlock();
        /* Slice-16 (F1d): tx-confirmed toast supplement (inline result
         * panels stay primary). Single shared point for all trade flows
         * (place/scaled/cancel/cancel-all); guarded silent to the host. */
        try {
          if (typeof NotifyHost !== "undefined" && NotifyHost &&
              typeof NotifyHost.mountToasts === "function") {
            try { NotifyHost.mountToasts(); } catch (e) { /* host best-effort */ }
          }
          if (typeof Notify !== "undefined" && Notify &&
              typeof Notify.txConfirmed === "function") {
            try { Notify.txConfirmed(head ? "head #" + String(head) : null); } catch (e) { /* silent */ }
          }
        } catch (e) { /* notify optional here */ }
        return { found: found, head: head, via: via };
      }
      await sleep(PROVE_INTERVAL_MS);
    }
    throw new Error("Sent (" + via + ") but the order was not observed within " +
      (PROVE_TIMEOUT_MS / 1000) + "s; check your orders before retrying " +
      "(do NOT blindly rebroadcast).");
  }

  /* Prove-fn: true once every id in `ids` is gone from the account's orders. */
  function proveGone(myId, ids) {
    return async function () {
      var dbId = await Chain.db();
      var rows = await Chain.call(dbId, "get_limit_orders_by_account", [myId, 100]);
      var present = {};
      (rows || []).forEach(function (o) { if (o && o.id) present[o.id] = true; });
      for (var i = 0; i < ids.length; i++) {
        if (present[ids[i]]) return null;
      }
      return { gone: true };
    };
  }

  /* Result screen: what happened + observation block # (never a fabricated
   * txid) + a return path. Errors arrive here only as text, never blank.
   * Shared by the place-order flows (trade-form.js calls this as
   * TradeCancel.paintResult); cancel flows render their own inline panels. */
  function paintResult(doc, mount, spec) {
    clearBox(mount);
    mount.appendChild(el(doc, "h3", spec.title));
    (spec.lines || []).forEach(function (t) {
      var p = el(doc, "p", t, "xfer-ok");
      p.setAttribute("aria-live", "polite");
      mount.appendChild(p);
    });
    var back = touchable(el(doc, "button", spec.backLabel || t("trade.back", "Back")));
    back.type = "button";
    back.classList.add("btn-ghost");
    back.addEventListener("click", spec.onBack);
    mount.appendChild(back);
  }

  /* Inline per-order cancel confirm via the shared ConfirmDialog
   * (ui/confirm.js): order id 1.7.x + pair + warning rows render as
   * div.confirm-dialog (h3 + dl.confirm with Keep order carrying
   * btn-ghost + Confirm cancel in div.confirm-actions). The warning line
   * rides inside the dialog above its actions (old rows-then-notes-then-
   * buttons order, textContent-only). The fee rides feeHuman with the
   * keyed trade.row_fee term + raw title BEFORE Sign & Send (quoted at
   * paint time with the placeholder payer, display-only — doGo still
   * rebuilds with the real account and re-runs feeMulti for the actual
   * tx; the result panel keeps its paid-fee line). Unlock-gating (password
   * only at signing),
   * seller-ownership check, single-op cancel tx, proveGone inclusion
   * proof, and the inline result + dismiss path below are unchanged.
   * Paints into the box market-orders.js provides; onDone re-renders the
   * orders list (wired to a dismiss button so the result stays readable
   * until the user leaves it). */
  function orderCancelBox(doc, box, order, assets, onDone) {
    clearBox(box);
    if (typeof Tx === "undefined" || !Tx || typeof Chain === "undefined" || !Chain) {
      showError(doc, box, t("trade.cancel_backend", "Trade backend missing: js/tx.js failed to load."));
      return;
    }
    var id = order && order.id ? String(order.id) : "";
    if (!/^1\.7\.\d+$/.test(id)) {
      showError(doc, box, "Not a limit order id (want 1.7.x): " + id);
      return;
    }
    var view = cancelView(order, assets);
    /* Row terms stay the caller's keyed strings; ids/pairs/details are
     * chain/display data with no raw-integer slot (no r[2] — the order
     * id is already the chain id, not a human amount). */
    var rows = [
      [t("trade.co_orderid", "Order ID"), id],
      [t("trade.co_market", "Market"), view.pair],
      [t("trade.co_details", "Details"), view.details]
    ];
    var dlg = null;
    function doGo() {
      var btns = dlg.getElementsByTagName("button");
      var backBtn = btns[0], goBtn = btns[1];
      backBtn.disabled = true;
      goBtn.disabled = true;
      var status = showStatus(doc, box, t("trade.checking_fee", "Checking fee…"));
      var seller = (order.seller && String(order.seller)) || null;
      var wif = Wallet.keys && Wallet.keys.active ? Wallet.keys.active.wif : null;
      if (typeof Tx !== "undefined" && Tx && typeof Tx.wifOk === "function" ? !Tx.wifOk(wif) : !wif) {
        box.removeChild(status);
        showError(doc, box, new Error("wallet-locked"), t("common.wallet_locked", "Wallet is locked."));
        backBtn.disabled = false;
        goBtn.disabled = false;
        return;
      }
      Account.myAccountId().then(function (myId) {
        if (seller && seller !== myId) {
          throw new Error("Order " + id + " belongs to " + seller + ", not your account.");
        }
        var op = [Tx.OP.limit_order_cancel, {
          fee: { amount: 0, asset_id: FEE_ASSET },
          fee_paying_account: myId,
          order: id,
          extensions: []
        }];
        return Tx.buildTx([op]).then(function (unsigned) {
          return Tx.feeMulti(unsigned.operations, FEE_ASSET).then(function (feeRes) {
            return feeAssetMeta(unsigned.operations[0][1].fee.asset_id).then(function (meta) {
              return { unsigned: unsigned, feeRaw: feeRes.totalRaw, meta: meta };
            });
          });
        }).then(function (R) {
          return Tx.signRouted(R.unsigned, wif, {}).then(function (r) {
            if (r.delegated) {
              /* Extension mode: SW signed + broadcast behind approval. */
              status.textContent = t("trade.s2", "Broadcasting cancel…");
              return proveTx(proveGone(myId, [id]), r.proof.via + "+extension").then(function (res) {
                return { res: res, R: R };
              });
            }
            status.textContent = t("trade.s2", "Broadcasting cancel…");
            return sendTx(r.signed, proveGone(myId, [id])).then(function (res) {
              return { res: res, R: R };
            });
          });
        }).then(function (out) {
          clearBox(box);
          box.appendChild(el(doc, "h3", "Order " + id + " canceled"));
          var ok = el(doc, "p",
            "Confirmed gone at head block #" + String(out.res.head) + " via " + out.res.via + ".", "xfer-ok");
          ok.setAttribute("aria-live", "polite");
          box.appendChild(ok);
          box.appendChild(el(doc, "p",
            "Cancel fee: " + humanFee(out.R.feeRaw, out.R.meta) + ".", "muted"));
          var done = touchable(el(doc, "button", t("trade.back_orders", "Back to orders")));
          done.type = "button";
          done.classList.add("btn-ghost");
          done.addEventListener("click", function () { clearBox(box); onDone(); });
          box.appendChild(done);
        }).catch(function (e) {
          try { box.removeChild(status); } catch (rm) { /* already gone */ }
          showError(doc, box, e, t("trade.fail_cancel", "Cancel failed."));
          backBtn.disabled = false;
          goBtn.disabled = false;
        });
      });
    }
    /* Fee BEFORE sign (P1 defect fix): quote the display fee with the
     * placeholder payer, then paint the confirm carrying it (feeHuman +
     * keyed fee term + raw title, principle #6). doGo above is untouched —
     * it rebuilds with the real fee_paying_account and re-runs feeMulti
     * for the actual tx. Checking-fee holds the box until the quote lands;
     * a failed quote paints the honest dash and doGo still fails exactly
     * where it always did. The Promise.resolve wrapper turns a synchronous
     * quote-op build throw into the same dash fallback (never blank). */
    var pending = showStatus(doc, box, t("trade.checking_fee", "Checking fee…"));
    Promise.resolve().then(function () {
      var paintOp = [Tx.OP.limit_order_cancel, {
        fee: { amount: 0, asset_id: FEE_ASSET },
        fee_paying_account: QUOTE_PLACEHOLDER_PAYER,
        order: id,
        extensions: []
      }];
      return quoteFeeHuman([paintOp]);
    }).catch(function () {
      return { feeHuman: t("settings.dash", "—"), feeRaw: null };
    }).then(function (Q) {
      try { box.removeChild(pending); } catch (rm) { /* navigated away */ }
      dlg = ConfirmDialog.show({ title: "Cancel order " + id + "?",
        rows: rows,
        feeHuman: Q.feeHuman, feeTerm: t("trade.row_fee", "Fee"), feeRawTitle: Q.feeRaw,
        backLabel: t("trade.keep_order", "Keep order"), sendLabel: t("trade.confirm_cancel", "Confirm cancel"),
        doc: doc,
        onBack: function () { clearBox(box); },
        onSend: doGo });
      /* Warning rides between the rows and the actions (old position,
       * textContent-only; falls back to plain append when the actions row
       * is unreachable). */
      (function () {
        var warn = el(doc, "p",
          t("trade.cancel_warn", "Warning: canceling permanently removes this order from the book."), "muted");
        var acts = null;
        try { acts = (dlg.querySelector) ? dlg.querySelector(".confirm-actions") : null; } catch (e) { acts = null; }
        try {
          if (acts && acts.parentNode) { acts.parentNode.insertBefore(warn, acts); return; }
        } catch (e2) { /* fallback below */ }
        try { dlg.appendChild(warn); } catch (e3) { /* display-only */ }
      })();
      box.appendChild(dlg);
    });
  }

  /* One-line human summary of a raw order for cancel confirms (pair + side
   * + amount; BigInt display only, reuses the market-orders.js convention). */
  function cancelView(order, assets) {
    var q = assets.quote, b = assets.base;
    var pair = q.symbol + "/" + b.symbol;
    var details = "—";
    try {
      if (order && order.sell_price && order.sell_price.base && order.sell_price.quote) {
        var sp = order.sell_price;
        var sellId = sp.base.asset_id;
        var side = sellId === q.id ? "Sell " + q.symbol : (sellId === b.id ? "Buy " + q.symbol : "—");
        var sellPrec = sellId === q.id ? q.precision : (sellId === b.id ? b.precision : null);
        var amt = "?";
        if (order.for_sale !== undefined && order.for_sale !== null && typeof sellPrec === "number") {
          amt = Format.formatAmount(String(order.for_sale), sellPrec) +
            " " + (sellId === q.id ? q.symbol : b.symbol);
        }
        details = side + " " + amt;
      }
    } catch (e) { details = "—"; }
    return { pair: pair, details: details };
  }

  /* Cancel-all box (rendered only when ≥2 orders) via the shared
   * ConfirmDialog (ui/confirm.js): the COUNT rides named rows (Market +
   * Details) in div.confirm-dialog (h3 + dl.confirm with Keep orders
   * carrying btn-ghost + Confirm cancel-all in div.confirm-actions); the
   * ONE-transaction warning rides inside the dialog above its actions
   * (old rows-then-notes-then-buttons order, textContent-only). The total
   * fee rides feeHuman with the keyed trade.row_fee term + raw title
   * BEFORE Sign & Send (quoted at paint time with the placeholder payer,
   * display-only — doGo still rebuilds with the real account and re-runs
   * feeMulti; the result panel keeps its paid-total line). Unlock-gating,
   * N-op cancel tx, proveGone proof, and dismiss path below are unchanged.
   * Same prove/dismiss pattern as single cancel. */
  function cancelAllBox(doc, box, orders, assets, onDone) {
    clearBox(box);
    var ids = [];
    (orders || []).forEach(function (o) {
      if (o && o.id && /^1\.7\.\d+$/.test(String(o.id))) ids.push(String(o.id));
    });
    if (ids.length < 2) return;
    var btn = touchable(el(doc, "button", "Cancel all (" + ids.length + " orders)"));
    btn.type = "button";
    btn.id = "trade-cancel-all";
    box.appendChild(btn);
    btn.addEventListener("click", function () {
      clearBox(box);
      /* Row terms stay the caller's keyed strings; market/count are
       * display data with no raw-integer slot (no r[2], no fee). */
      var rows = [
        [t("trade.co_market", "Market"), assets.quote.symbol + "/" + assets.base.symbol],
        [t("trade.co_details", "Details"), ids.length + " orders"]
      ];
      var dlg = null;
      function doGo() {
        var btns = dlg.getElementsByTagName("button");
        var backBtn = btns[0], goBtn = btns[1];
        backBtn.disabled = true;
        goBtn.disabled = true;
        var status = showStatus(doc, box, t("trade.checking_fee", "Checking fee…"));
        var wif = Wallet.keys && Wallet.keys.active ? Wallet.keys.active.wif : null;
        if (typeof Tx !== "undefined" && Tx && typeof Tx.wifOk === "function" ? !Tx.wifOk(wif) : !wif) {
          box.removeChild(status);
          showError(doc, box, new Error("wallet-locked"), t("common.wallet_locked", "Wallet is locked."));
          backBtn.disabled = false;
          goBtn.disabled = false;
          return;
        }
        Account.myAccountId().then(function (myId) {
          var ops = ids.map(function (oid) {
            return [Tx.OP.limit_order_cancel, {
              fee: { amount: 0, asset_id: FEE_ASSET },
              fee_paying_account: myId,
              order: oid,
              extensions: []
            }];
          });
          return Tx.buildTx(ops).then(function (unsigned) {
            return Tx.feeMulti(unsigned.operations, FEE_ASSET).then(function (feeRes) {
              return feeAssetMeta(unsigned.operations[0][1].fee.asset_id).then(function (meta) {
                return { unsigned: unsigned, feeRaw: feeRes.totalRaw, meta: meta };
              });
            });
          }).then(function (R) {
            status.textContent = t("trade.broadcast_cancel_all_prefix", "Broadcasting cancel-all (") + humanFee(R.feeRaw, R.meta) + " fee)…";
            return Tx.signRouted(R.unsigned, wif, {}).then(function (r) {
              if (r.delegated) {
                /* Extension mode: SW signed + broadcast behind approval. */
                return proveTx(proveGone(myId, ids), r.proof.via + "+extension").then(function (res) {
                  return { res: res, R: R };
                });
              }
              return sendTx(r.signed, proveGone(myId, ids)).then(function (res) {
                return { res: res, R: R };
              });
            });
          });
        }).then(function (out) {
          clearBox(box);
          box.appendChild(el(doc, "h3", ids.length + " orders canceled"));
          var ok = el(doc, "p",
            "All gone at head block #" + String(out.res.head) + " via " + out.res.via +
            " (total fee " + humanFee(out.R.feeRaw, out.R.meta) + ").", "xfer-ok");
          ok.setAttribute("aria-live", "polite");
          box.appendChild(ok);
          var done = touchable(el(doc, "button", t("trade.back_orders", "Back to orders")));
          done.type = "button";
          done.classList.add("btn-ghost");
          done.addEventListener("click", function () { clearBox(box); onDone(); });
          box.appendChild(done);
        }).catch(function (e) {
          try { box.removeChild(status); } catch (rm) { /* already gone */ }
          showError(doc, box, e, t("trade.fail_cancel_all", "Cancel-all failed."));
          backBtn.disabled = false;
          goBtn.disabled = false;
        });
      }
      /* Total fee BEFORE sign (same P1 fix as single cancel): quote the
       * display total with the placeholder payer, then paint the confirm
       * carrying it. doGo above is untouched — real account + fresh
       * feeMulti for the actual tx. */
      var pendingAll = showStatus(doc, box, t("trade.checking_fee", "Checking fee…"));
      Promise.resolve().then(function () {
        var paintOps = ids.map(function (oid) {
          return [Tx.OP.limit_order_cancel, {
            fee: { amount: 0, asset_id: FEE_ASSET },
            fee_paying_account: QUOTE_PLACEHOLDER_PAYER,
            order: oid,
            extensions: []
          }];
        });
        return quoteFeeHuman(paintOps);
      }).catch(function () {
        return { feeHuman: t("settings.dash", "—"), feeRaw: null };
      }).then(function (Q) {
        try { box.removeChild(pendingAll); } catch (rm) { /* navigated away */ }
        dlg = ConfirmDialog.show({ title: "Cancel all " + ids.length + " orders?",
          rows: rows,
          feeHuman: Q.feeHuman, feeTerm: t("trade.row_fee", "Fee"), feeRawTitle: Q.feeRaw,
          backLabel: t("trade.keep_orders", "Keep orders"), sendLabel: t("trade.confirm_cancel_all", "Confirm cancel-all"),
          doc: doc,
          onBack: function () { cancelAllBox(doc, box, orders, assets, onDone); },
          onSend: doGo });
        /* ONE-transaction warning rides between the rows and the actions
         * (old position, textContent-only; falls back to plain append when
         * the actions row is unreachable). */
        (function () {
          var warn = el(doc, "p",
            "This sends ONE transaction canceling " + ids.length +
            " orders on " + assets.quote.symbol + "/" + assets.base.symbol +
            ". Warning: canceling permanently removes these orders from the book.", "muted");
          var acts = null;
          try { acts = (dlg.querySelector) ? dlg.querySelector(".confirm-actions") : null; } catch (e) { acts = null; }
          try {
            if (acts && acts.parentNode) { acts.parentNode.insertBefore(warn, acts); return; }
          } catch (e2) { /* fallback below */ }
          try { dlg.appendChild(warn); } catch (e3) { /* display-only */ }
        })();
        box.appendChild(dlg);
      });
    });
  }

  return {
    orderCancelBox: orderCancelBox,
    cancelAllBox: cancelAllBox,
    paintResult: paintResult
  };
})();

if (typeof module !== "undefined") { module.exports = TradeCancel; }
