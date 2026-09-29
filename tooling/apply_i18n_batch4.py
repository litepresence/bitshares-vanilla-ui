#!/usr/bin/env python3
"""i18n batch-4: key post-batch-3 (c4582ec..HEAD) plain literals (director task).

Converts user-visible plain-English literals added since c4582ec (i18n
batch-3) in instant-trade-ui.js to t("ns.key", "byte-verbatim default") per
the slice-17 precedent. vote-ui.js changed in the same window but carries no
new display literals (comment/logic only); all other view files in scope are
NO-DIFF; help-ui.js bodies are English-first by design per its header and are
skipped. Dynamic concats keep code structure: only static segments are
wrapped. No rewording: every default is copied byte-verbatim from HEAD.
Amounts, dates, chain ids, hrefs, classes, placeholders that are
token-valued (BTS/CNY/0.00), symbol glue (" -> ", "/", " (" / ")"), and
punctuation-only glue (": ", ": --", ".", ").", em-dash alone) stay raw.

New keys accumulate in vanilla/locales/frag-batch4.json (nested sections);
merge via: python3 tooling/merge_i18n_frags.py batch4
(en.json + other dicts NOT touched here).

Usage: python3 tooling/apply_i18n_batch4.py [--apply]
  Default: dry run (asserts counts, prints per-file t() delta, frag size).
  --apply: rewrites files + writes frag-batch4.json.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
JS = os.path.join(HERE, "..", "vanilla", "js")
FRAG = os.path.join(HERE, "..", "vanilla", "locales", "frag-batch4.json")
EN = os.path.join(HERE, "..", "vanilla", "locales", "en.json")

R = []  # (file, old, new, count, [(ns, key, default)], replace_all)


def rep(fname, old, new, count=1, keys=(), all=False):
    R.append((fname, old, new, count, list(keys), all))


def K(ns, key, val):
    return (ns, key, val)


# ================================================================ header note
rep("instant-trade-ui.js",
    ' *   those keys plus untranslatable symbols (asset codes, "->", "(effective)",\n *   em-dash) \u2014 full convert copy stays deferred to a later i18n batch.',
    ' *   those keys plus untranslatable symbols (asset codes, "->", em-dash).\n *   Batch-4 i18n: the deferred convert copy below is keyed via t().',
    1, [])

# ================================================================ field labels
rep("instant-trade-ui.js",
    '    var sellSymF = fieldRow(doc, t("instant.market_quote_base", "Market (QUOTE_BASE) ").replace("Market (QUOTE_BASE) ", "Sell asset "), { id: "it-sell-sym", value: P.sellSym, placeholder: "BTS", inputmode: "text" });',
    '    var sellSymF = fieldRow(doc, t("instant.sell_asset_label", "Sell asset "), { id: "it-sell-sym", value: P.sellSym, placeholder: "BTS", inputmode: "text" });',
    1, [K("instant", "sell_asset_label", "Sell asset ")])
rep("instant-trade-ui.js",
    '    sellSymF.input.setAttribute("aria-label", "Sell asset symbol");',
    '    sellSymF.input.setAttribute("aria-label", t("instant.sell_asset_symbol_aria", "Sell asset symbol"));',
    1, [K("instant", "sell_asset_symbol_aria", "Sell asset symbol")])
rep("instant-trade-ui.js",
    '    var recvSymF = fieldRow(doc, t("instant.market_quote_base", "Market (QUOTE_BASE) ").replace("Market (QUOTE_BASE) ", "Receive asset "), { id: "it-receive-sym", value: P.receiveSym, placeholder: "CNY", inputmode: "text" });',
    '    var recvSymF = fieldRow(doc, t("instant.receive_asset_label", "Receive asset "), { id: "it-receive-sym", value: P.receiveSym, placeholder: "CNY", inputmode: "text" });',
    1, [K("instant", "receive_asset_label", "Receive asset ")])
rep("instant-trade-ui.js",
    '    recvSymF.input.setAttribute("aria-label", "Receive asset symbol");',
    '    recvSymF.input.setAttribute("aria-label", t("instant.receive_asset_symbol_aria", "Receive asset symbol"));',
    1, [K("instant", "receive_asset_symbol_aria", "Receive asset symbol")])
rep("instant-trade-ui.js",
    '    swapBtn.setAttribute("aria-label", t("swap.title", "Swap") + " sell/receive");',
    '    swapBtn.setAttribute("aria-label", t("swap.title", "Swap") + t("instant.swap_suffix_sell_receive", " sell/receive"));',
    1, [K("instant", "swap_suffix_sell_receive", " sell/receive")])

# ================================================================ walkthrough
rep("instant-trade-ui.js",
    '    walkBox.appendChild(el(doc, "p", "Trade " + ctx.sellSym + " \u2192 " + ctx.receiveSym + " \u2014 walkthrough uses bids (selling " + ctx.sellSym + " hits bids paying " + ctx.receiveSym + ").", "muted"));',
    '    walkBox.appendChild(el(doc, "p", t("instant.walkthrough_trade_prefix", "Trade ") + ctx.sellSym + " \u2192 " + ctx.receiveSym + t("instant.walkthrough_bids_mid", " \u2014 walkthrough uses bids (selling ") + ctx.sellSym + t("instant.walkthrough_paying_mid", " hits bids paying ") + ctx.receiveSym + ").", "muted"));',
    1, [K("instant", "walkthrough_trade_prefix", "Trade "),
        K("instant", "walkthrough_bids_mid", " \u2014 walkthrough uses bids (selling "),
        K("instant", "walkthrough_paying_mid", " hits bids paying ")])

# ================================================================ effective price
rep("instant-trade-ui.js",
    't("instant.price", "Price") + " (effective): \u2014"',
    't("instant.price", "Price") + t("instant.effective_suffix_dash", " (effective): \u2014")',
    8, [K("instant", "effective_suffix_dash", " (effective): \u2014")], all=True)
rep("instant-trade-ui.js",
    't("instant.price", "Price") + " (effective): "',
    't("instant.price", "Price") + t("instant.effective_suffix", " (effective): ")',
    2, [K("instant", "effective_suffix", " (effective): ")], all=True)
rep("instant-trade-ui.js",
    'row(t("instant.price", "Price") + " (effective)",',
    'row(t("instant.price", "Price") + t("instant.effective_paren", " (effective)"),',
    1, [K("instant", "effective_paren", " (effective)")])

# ================================================================ shared "per"
rep("instant-trade-ui.js",
    '+ " per " +',
    '+ t("instant.per_mid", " per ") +',
    4, [K("instant", "per_mid", " per ")], all=True)

# ================================================================ walk summary
rep("instant-trade-ui.js",
    '+ " level" +',
    '+ t("instant.level_suffix", " level") +',
    2, [K("instant", "level_suffix", " level")], all=True)
rep("instant-trade-ui.js",
    '+ " walk"',
    '+ t("instant.walk_suffix", " walk")',
    1, [K("instant", "walk_suffix", " walk")])
rep("instant-trade-ui.js",
    '+ "s walk"',
    '+ t("instant.orders_walk_suffix", "s walk")',
    1, [K("instant", "orders_walk_suffix", "s walk")])

# ================================================================ done screen
rep("instant-trade-ui.js",
    'done.appendChild(el(doc, "p", "Order " + res.found.id + " is on the book (" + ctx.sellSym + "/" + ctx.receiveSym + ")."));',
    'done.appendChild(el(doc, "p", t("instant.order_prefix", "Order ") + res.found.id + t("instant.on_the_book_mid", " is on the book (") + ctx.sellSym + "/" + ctx.receiveSym + ")."));',
    1, [K("instant", "order_prefix", "Order "),
        K("instant", "on_the_book_mid", " is on the book (")])
rep("instant-trade-ui.js",
    'done.appendChild(el(doc, "p", "Observed at head block #" + String(res.head) + " via " + res.via + ".", "muted"));',
    'done.appendChild(el(doc, "p", t("instant.observed_head_prefix", "Observed at head block #") + String(res.head) + t("instant.via_mid", " via ") + res.via + ".", "muted"));',
    1, [K("instant", "observed_head_prefix", "Observed at head block #"),
        K("instant", "via_mid", " via ")])


def main():
    apply = "--apply" in sys.argv
    en = json.load(open(EN, encoding="utf-8"))

    def flat(tree, prefix=""):
        out = {}
        for k, v in tree.items():
            if k == "_meta":
                continue
            if isinstance(v, dict):
                out.update(flat(v, prefix + k + "."))
            else:
                out[prefix + k] = v
        return out

    en_flat = flat(en)
    reuse = {}
    for dotted, val in en_flat.items():
        ns, _, key = dotted.partition(".")
        reuse[(ns, val)] = dotted

    files = {}
    for fname, _, _, _, _, _ in R:
        if fname not in files:
            p = os.path.join(JS, fname)
            files[fname] = open(p, encoding="utf-8").read()

    frag = {}
    total_keys = 0
    for fname, old, new, count, keys, use_all in R:
        src = files[fname]
        if use_all:
            n = src.count(old)
            if n != count:
                print("MISMATCH %s: expected %d, found %d\nOLD: %r" % (fname, count, n, old[:160]))
                return 1
            files[fname] = src.replace(old, new)
        else:
            n = src.count(old)
            if n != count:
                print("MISMATCH %s: expected %d, found %d\nOLD: %r" % (fname, count, n, old[:160]))
                return 1
            files[fname] = src.replace(old, new)
        for ns, key, val in keys:
            dotted = ns + "." + key
            if dotted in en_flat:
                if en_flat[dotted] != val:
                    print("CONFLICT %s: en %r vs new %r" % (dotted, en_flat[dotted], val))
                    return 1
                continue
            if (ns, val) in reuse and reuse[(ns, val)] != dotted:
                print("DUP-VALUE %s=%r already under %s; refusing near-duplicate" % (dotted, val, reuse[(ns, val)]))
                return 1
            sec = frag.setdefault(ns, {})
            if key in sec:
                if sec[key] != val:
                    print("FRAG-CONFLICT %s" % dotted)
                    return 1
            else:
                sec[key] = val
                total_keys += 1
            en_flat[dotted] = val
            reuse[(ns, val)] = dotted

    if apply:
        for fname, src in files.items():
            with open(os.path.join(JS, fname), "w", encoding="utf-8") as fh:
                fh.write(src)
        nested = {ns: dict(sorted(sec.items())) for ns, sec in sorted(frag.items())}
        with open(FRAG, "w", encoding="utf-8") as fh:
            json.dump(nested, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        print("wrote %d files, frag keys: %d -> %s" % (len(files), total_keys, FRAG))
    for fname in sorted(files):
        src_now = files[fname] if apply else open(os.path.join(JS, fname), encoding="utf-8").read()
        n0 = len(re.findall(r"\bt\(\s*\"", src_now))
        print("%-22s t() sites now %3d" % (fname, n0))
    if not apply:
        print("frag keys (dry-run): %d across %d sections" % (total_keys, len(frag)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
